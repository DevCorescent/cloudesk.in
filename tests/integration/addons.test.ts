import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as subApi from "@/app/api/v1/orgs/[orgId]/subscription/[[...slug]]/route";
import { changePlan, clearEntitlement, entitlementFor, markPaid, previewChange, subscriptionTick } from "@/server/billing/subscriptions";
import { call, cookieFrom, resetDb } from "../helpers";

// Add-ons on a paid plan: priced into the plan's bill, prorated mid-period,
// switched on once paid, carried into every renewal, and dropped at renewal.
let cookie = "";
let org = "";
let owner = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const S = (method: string, path: string, body?: unknown) => call((subApi as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie, body, path: `/api/v1/orgs/${org}/subscription/${path}`, params: { orgId: org, slug: seg(path) } });
const sub = async () => (await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, org)))[0]!;
const setSub = async (v: Partial<typeof schema.orgSubscriptions.$inferInsert>) => {
  await db.update(schema.orgSubscriptions).set(v).where(eq(schema.orgSubscriptions.orgId, org));
  clearEntitlement();
};
const DAY = 86_400_000;
const GROWTH = 299900;
const ADDONS = { modules: ["quality" as const], packs: { invoicesPerMonth: 2, seats: 1 } };
const WITH = GROWTH + 29900 + 2 * 9900 + 9900;

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Asha Rao", email: "asha@kiln.in", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie })).json;
  org = m.organizations[0].id;
  owner = m.user.id;
  // On Growth, paid, ten days into November.
  const r = await changePlan(org, owner, { kind: "plan", planId: "growth", interval: "month" });
  await markPaid(r.invoice!.id, { via: "manual", ref: "NEFT-1" });
  await setSub({ status: "active", trialEndsAt: new Date("2026-10-01T00:00:00Z"), currentPeriodStart: new Date("2026-11-01T00:00:00Z"), currentPeriodEnd: new Date("2026-12-01T00:00:00Z") });
});
afterAll(() => closeDb());

describe("add-ons on a paid plan", () => {
  const now = new Date("2026-11-11T00:00:00Z");

  it("shows what each pack costs", async () => {
    const o = (await S("GET", "")).json;
    expect(o.pricing.packs.invoicesPerMonth).toEqual({ size: 500, price: 9900 });
    expect(o.subscription).toMatchObject({ planName: "Growth", amount: GROWTH });
  });

  it("prorates the add-ons for the rest of the period, to the paisa", async () => {
    const pv = await previewChange(org, { kind: "plan", planId: "growth", interval: "month", addons: ADDONS }, now);
    // 20 of 30 days left: the new bill for those days, less what's unused of the old one.
    const credit = Math.round((GROWTH * 20) / 30);
    const charge = Math.round((WITH * 20) / 30);
    const subtotal = charge - credit;
    const tax = Math.round(subtotal * 0.18);
    expect(pv).toMatchObject({ mode: "upgrade", credit, charge, subtotal, tax, total: subtotal + tax });
    expect(pv.quote.amount).toBe(WITH);
  });

  it("switches them on once paid, and keeps the period", async () => {
    const r = await changePlan(org, owner, { kind: "plan", planId: "growth", interval: "month", addons: ADDONS }, now);
    expect(r.invoice!.lines[0]!.label).toMatch(/^Growth with 3 add-ons, /);
    expect((await entitlementFor(org)).modules).not.toContain("quality"); // not until it's paid
    await markPaid(r.invoice!.id, { via: "manual", ref: "NEFT-2" }, now);
    const s = await sub();
    expect(s).toMatchObject({ planName: "Growth", amount: WITH, monthly: WITH, seats: 26 });
    expect(s.currentPeriodEnd).toEqual(new Date("2026-12-01T00:00:00Z"));
    const e = await entitlementFor(org);
    expect(e.modules).toContain("quality");
    expect(e.limits.seats).toBe(26);
    expect(e.quotas.invoicesPerMonth).toBe(3000 + 1000);
  });

  it("knows the same add-ons again are no change", async () => {
    const pv = await previewChange(org, { kind: "plan", planId: "growth", interval: "month", addons: ADDONS }, now);
    expect(pv.mode).toBe("same");
    const r = await S("POST", "change", { kind: "plan", planId: "growth", interval: "month", addons: ADDONS });
    expect(r.status).toBe(409);
  });

  it("refuses counts it can't sell", async () => {
    const r = await S("POST", "preview", { kind: "plan", planId: "growth", interval: "month", addons: { packs: { contacts: 5000 } } });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("renews with the add-ons on the invoice, line by line", async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    await setSub({ currentPeriodStart: new Date(Date.now() - 27 * DAY), currentPeriodEnd: soon });
    await subscriptionTick();
    const [renewal] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, org), eq(schema.subscriptionInvoices.kind, "renewal"), eq(schema.subscriptionInvoices.status, "open")));
    expect(renewal).toMatchObject({ subtotal: WITH, tax: Math.round(WITH * 0.18), total: WITH + Math.round(WITH * 0.18) });
    expect(renewal!.lines.map((l) => l.label)).toEqual(["Growth plan, monthly", "Quality (add-on)", "+1 seat (add-on)", "+1,000 invoices a month (add-on)"]);
    expect(renewal!.lines.reduce((n, l) => n + l.amount, 0)).toBe(WITH);
  });

  it("drops an add-on at the next renewal, and bills without it", async () => {
    const r = await S("POST", "change", { kind: "plan", planId: "growth", interval: "month", addons: { packs: { seats: 1 } } });
    expect(r.json.mode).toBe("downgrade");
    expect((await entitlementFor(org)).modules).toContain("quality"); // kept until then
    await subscriptionTick();
    const [renewal] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, org), eq(schema.subscriptionInvoices.kind, "renewal"), eq(schema.subscriptionInvoices.status, "open")));
    expect(renewal!.subtotal).toBe(GROWTH + 9900);
  });
});
