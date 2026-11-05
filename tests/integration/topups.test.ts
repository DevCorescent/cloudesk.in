import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as subApi from "@/app/api/v1/orgs/[orgId]/subscription/[[...slug]]/route";
import { receiptPdf } from "@/server/billing/receipt";
import { assertQuota, clearEntitlement, entitlementFor, markPaid, topupExtras } from "@/server/billing/subscriptions";
import { call, cookieFrom, resetDb } from "../helpers";

// Top-ups: bought once on any plan (Free too), paid at once, added straight
// away, used only beyond the plan's allowance, carried over, and receipted.
let cookie = "";
let org = "";
let owner = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const S = (method: string, path: string, body?: unknown) => call((subApi as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie, body, path: `/api/v1/orgs/${org}/subscription/${path}`, params: { orgId: org, slug: seg(path) } });
const aiCalls = async (n: number, at = new Date()) => db.insert(schema.aiTasks).values(Array.from({ length: n }, () => ({ orgId: org, kind: "test", input: {}, createdAt: at })));
const AI_PACK = 29900;
const TAX = Math.round(AI_PACK * 0.18);

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Asha Rao", email: "asha@kiln.in", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie })).json;
  org = m.organizations[0].id;
  owner = m.user.id;
});
afterAll(() => closeDb());

describe("top-ups", () => {
  let invoice = "";

  it("offers a top-up when an allowance is used up", async () => {
    // The trial's fair-use allowance is 200 AI requests a month.
    await aiCalls(200);
    clearEntitlement();
    const err = await assertQuota(org, "aiPerMonth").catch((e) => e);
    expect(err.details).toMatchObject({ quota: ["aiPerMonth"], topup: ["aiPerMonth"] });
    const o = (await S("GET", "")).json;
    expect(o.topups.packs.find((p: { key: string }) => p.key === "aiPerMonth")).toMatchObject({ size: 500, price: AI_PACK, left: 0 });
  });

  it("raises one invoice to pay now, to the paisa", async () => {
    const r = await S("POST", "topup", { packs: { aiPerMonth: 1 } });
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(false);
    const inv = r.json.overview.invoices.find((i: { id: string }) => i.id === r.json.invoiceId);
    invoice = inv.id;
    expect(inv).toMatchObject({ kind: "topup", status: "open", subtotal: AI_PACK, tax: TAX, total: AI_PACK + TAX, lines: [{ label: "+500 AI requests (top-up)", amount: AI_PACK }] });
    // Choosing again replaces it, so it's never charged twice.
    const again = await S("POST", "topup", { packs: { aiPerMonth: 2 } });
    const open = again.json.overview.invoices.filter((i: { kind: string; status: string }) => i.kind === "topup" && i.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].total).toBe(2 * AI_PACK + Math.round(2 * AI_PACK * 0.18));
    invoice = open[0].id;
  });

  it("adds the allowance (and its AI spend) the moment it's paid, and emails a receipt", async () => {
    await markPaid(invoice, { via: "manual", ref: "UPI-123" });
    const e = await entitlementFor(org);
    expect(e.quotas.aiPerMonth).toBe(200 + 1000);
    expect(e.quotas.aiBudgetUsd).toBeCloseTo(2 + 1.4, 4);
    await expect(assertQuota(org, "aiPerMonth")).resolves.toBeUndefined();
    const mails = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "asha@kiln.in"), like(schema.outboundEmails.subject, "Receipt %")));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toMatch(/^Receipt CD-\d{4}-\d{6} — ₹705\.64 paid$/);
    expect(mails[0]!.body).toContain("+1,000 AI requests (top-up)");
    expect(mails[0]!.body).toMatch(/Total paid\s+₹705\.64/);
    // The bell says it too, without a second email.
    expect(await db.select().from(schema.outboundEmails).where(like(schema.outboundEmails.subject, "Payment received%"))).toHaveLength(0);
  });

  it("makes a real PDF receipt", async () => {
    const [inv] = await db.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.id, invoice));
    const pdf = await receiptPdf(inv!, "CD-2026-000001", "Kiln", { name: "Cloudesk Pvt Ltd", address: "Bengaluru", gstin: "29ABCDE1234F1Z5", email: "billing@cloudesk.in" });
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("uses only what goes beyond the plan, and carries the rest over", async () => {
    // This month: 200 in the trial's allowance + 300 more, so 300 of the 1,000 bought are used.
    await aiCalls(300);
    const dec = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 10));
    const left = await topupExtras(org, { aiPerMonth: 200, aiBudgetUsd: 2 }, dec);
    expect(left.aiPerMonth).toBe(700);
    expect(left.aiBudgetUsd).toBeCloseTo(1.4, 4); // no AI spend beyond the plan's
    // Settling is done once: asking again gives the same.
    expect((await topupExtras(org, { aiPerMonth: 200, aiBudgetUsd: 2 }, dec)).aiPerMonth).toBe(700);
    // And this month still has the whole top-up on top of the allowance.
    expect((await topupExtras(org, { aiPerMonth: 200, aiBudgetUsd: 2 })).aiPerMonth).toBe(1000);
  });

  it("works on the Free plan too", async () => {
    await db.update(schema.orgSubscriptions).set({ trialEndsAt: new Date(Date.now() - 60_000), status: "expired" }).where(eq(schema.orgSubscriptions.orgId, org));
    clearEntitlement();
    const e = await entitlementFor(org);
    expect(e.state).toBe("free");
    expect(e.quotas.aiPerMonth).toBe(25 + 1000);
    const r = await S("POST", "topup", { packs: { invoicesPerMonth: 1 } });
    expect(r.status).toBe(200);
    expect(r.json.overview.invoices[0]).toMatchObject({ kind: "topup", subtotal: 9900 });
  });

  it("refuses what can't be topped up", async () => {
    expect((await S("POST", "topup", { packs: { contacts: 1 } })).status).toBe(422);
    expect((await S("POST", "topup", { packs: { aiPerMonth: 0 } })).status).toBeGreaterThanOrEqual(400);
    expect((await S("POST", "topup", { packs: { aiPerMonth: 101 } })).status).toBeGreaterThanOrEqual(400);
    void owner;
  });
});
