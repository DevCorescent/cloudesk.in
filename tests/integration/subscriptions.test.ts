import { createHmac } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { DEFAULT_PLANS } from "@/lib/billing/catalog";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as signupStart from "@/app/api/v1/auth/signup/start/route";
import * as signupVerify from "@/app/api/v1/auth/signup/verify/route";
import * as signupResend from "@/app/api/v1/auth/signup/resend/route";
import * as signupInvited from "@/app/api/v1/auth/signup/invited/route";
import { createInvitation } from "@/server/services/orgs";
import { cancelAtEnd, startTrial } from "@/server/billing/subscriptions";
import * as loginCode from "@/app/api/v1/auth/login/code/route";
import * as loginCodeVerify from "@/app/api/v1/auth/login/code/verify/route";
import * as plansApi from "@/app/api/v1/plans/route";
import * as subApi from "@/app/api/v1/orgs/[orgId]/subscription/[[...slug]]/route";
import * as modulesApi from "@/app/api/v1/orgs/[orgId]/modules/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import { setBillingHttp } from "@/server/billing/billing";
import { adminAct, assertEntitled, changePlan, clearEntitlement, entitlementFor, markPaid, previewChange, subscriptionTick } from "@/server/billing/subscriptions";
import { resetRateLimits } from "@/server/security/rate-limit";
import { call, cookieFrom, resetDb } from "../helpers";

const C: Record<string, string> = {};
const U: Record<string, string> = {};
let org = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const S = (method: string, path: string, body?: unknown, who = "owner") => call((subApi as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${org}/subscription/${path}`, params: { orgId: org, slug: seg(path) } });
const A = (method: string, path: string, body?: unknown) => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie: C.staff, body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const sub = async (id = org) => (await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, id)))[0]!;
const setSub = async (v: Partial<typeof schema.orgSubscriptions.$inferInsert>, id = org) => {
  await db.update(schema.orgSubscriptions).set(v).where(eq(schema.orgSubscriptions.orgId, id));
  clearEntitlement();
};
const codeFor = async (email: string) => {
  const [m] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, email)).orderBy(desc(schema.outboundEmails.createdAt)).limit(1);
  return /(\d{6})/.exec(m?.subject ?? "")?.[1] ?? "";
};
const DAY = 86_400_000;

// Razorpay, as the tests' payment provider: orders and payments are faked at the HTTP layer only.
const RZP = { RAZORPAY_KEY_ID: "rzp_test_sub", RAZORPAY_KEY_SECRET: "rzp_sub_secret" };
const payments = new Map<string, { order_id: string; amount: number; currency: string; status: string }>();
let orderN = 0;

beforeAll(async () => {
  await resetDb();
  Object.assign(process.env, RZP);
  setBillingHttp(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      const b = JSON.parse(String(init.body)) as { amount: number; currency: string };
      return Response.json({ id: `order_${++orderN}`, amount: b.amount, currency: b.currency });
    }
    const pay = /\/payments\/([^/]+)$/.exec(url);
    if (pay) return payments.has(pay[1]!) ? Response.json({ id: pay[1], ...payments.get(pay[1]!) }) : Response.json({ error: { description: "not found" } }, { status: 404 });
    return Response.json({ error: { description: `unexpected ${url}` } }, { status: 500 });
  });
  for (const [k, name, email] of [["owner", "Asha Rao", "asha@kiln.in"], ["member", "Dev Nair", "dev@kiln.in"], ["staff", "Pat Platform", "pat@cloudesk.example"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    const m = (await call(me.GET, { cookie: C[k] })).json;
    U[k] = m.user.id;
    if (k === "owner") org = m.organizations[0].id;
  }
  await db.insert(schema.memberships).values({ orgId: org, userId: U.member!, role: "editor" });
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, U.staff!));
});
afterAll(async () => {
  setBillingHttp(null);
  for (const k of Object.keys(RZP)) delete process.env[k];
  await closeDb();
});

const pay = async (invoiceId: string, opts: { tamper?: boolean } = {}) => {
  const started = await S("POST", `invoices/${invoiceId}/pay`, { provider: "razorpay" });
  expect(started.status).toBe(200);
  const { orderId, amount, currency } = started.json;
  const paymentId = `pay_${orderId}`;
  payments.set(paymentId, { order_id: orderId, amount, currency, status: "captured" });
  const signature = createHmac("sha256", opts.tamper ? "wrong" : RZP.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return S("POST", `invoices/${invoiceId}/confirm`, { provider: "razorpay", orderId, paymentId, signature });
};

describe("the free trial", () => {
  it("starts every new workspace on 30 days of everything", async () => {
    const s = await sub();
    expect(s).toMatchObject({ status: "trialing", planId: "trial", modules: null });
    expect(Math.round((s.trialEndsAt!.getTime() - s.trialStartedAt!.getTime()) / DAY)).toBe(30);
    const o = (await S("GET", "")).json;
    expect(o).toMatchObject({ state: "trial", entitled: null, stats: { trialDaysLeft: 30, trialDays: 30 } });
    expect(o.plans.map((p: { id: string }) => p.id)).toEqual(["workday", "starter", "growth", "business", "enterprise"]);
    // The session tells the app what the plan includes.
    const m = (await call(me.GET, { cookie: C.owner })).json;
    expect(m.organizations[0].plan).toMatchObject({ state: "trial", name: "Free trial" });
  });

  it("shows the catalogue publicly, and billing only to owners and the billing role", async () => {
    const pub = await call(plansApi.GET, { path: "/api/v1/plans" });
    expect(pub.json.plans).toHaveLength(5);
    expect(pub.json.pricing).toMatchObject({ trialDays: 30, taxBps: 1800 });
    expect((await S("GET", "", undefined, "member")).status).toBe(403);
  });

  it("prices a plan you build yourself on the server", async () => {
    const q = (await S("POST", "quote", { kind: "custom", modules: ["hr", "inventory"], seats: 4, interval: "month" })).json;
    expect(q.amount).toBe(19900 + 49900 + 49900 + 9900);
    expect((await S("POST", "quote", { kind: "custom", modules: ["nope"], seats: 4, interval: "month" })).status).toBe(422);
  });
});

let first = "";

describe("choosing and paying during the trial", () => {
  it("records the plan for after the trial and raises its first invoice", async () => {
    const r = await S("POST", "change", { kind: "plan", planId: "starter", interval: "month" });
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe("trial");
    const inv = r.json.overview.invoices[0];
    first = inv.id;
    expect(inv).toMatchObject({ kind: "first", subtotal: 99900, tax: 17982, total: 117882, status: "open", taxLabel: "GST" });
    expect(new Date(inv.dueAt).getTime()).toBe((await sub()).trialEndsAt!.getTime());
    // Still everything until the trial ends.
    expect(r.json.overview).toMatchObject({ state: "trial", entitled: null, subscription: { planName: "Starter" } });
  });

  it("only accepts a payment Razorpay confirms (signature, then the payment itself)", async () => {
    expect((await pay(first, { tamper: true })).status).toBe(400);
    const ok = await pay(first);
    expect(ok.status).toBe(200);
    expect(ok.json.paid).toBe(true);
    const s = await sub();
    // The paid month starts when the trial ends — no trial days are lost.
    expect(s.currentPeriodStart!.getTime()).toBe(s.trialEndsAt!.getTime());
    expect(s.status).toBe("trialing");
    // Confirming again changes nothing.
    const again = await S("POST", `invoices/${first}/confirm`, { provider: "razorpay", orderId: "order_1", paymentId: "pay_order_1", signature: "x" });
    expect(again.json.paid).toBe(true);
    expect(await db.select().from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.orgId, org), eq(schema.subscriptionEvents.kind, "paid")))).toHaveLength(1);
  });

  it("moves to the paid plan when the trial ends, with only its features", async () => {
    await setSub({ trialEndsAt: new Date(Date.now() - 1000), currentPeriodStart: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() + 30 * DAY - 1000) });
    await subscriptionTick();
    const e = await entitlementFor(org);
    expect(e).toMatchObject({ state: "active", planName: "Starter" });
    expect(e.modules).toContain("store");
    expect(e.modules).not.toContain("hr");
    const req = (m: string) => new Request(`http://localhost/api/v1/orgs/${org}/hr/people`, { method: m });
    await expect(assertEntitled(org, req("GET"), "hr")).rejects.toThrow(/isn't in your Starter plan/);
    await expect(assertEntitled(org, req("GET"), "store")).resolves.toBeUndefined();
  });
});

describe("changing plan mid-period", () => {
  it("prorates an upgrade to the second and applies it once paid", async () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    const now = new Date("2026-11-11T00:00:00Z");
    await setSub({ currentPeriodStart: start, currentPeriodEnd: end });
    const pv = await previewChange(org, { kind: "plan", planId: "growth", interval: "month" }, now);
    expect(pv).toMatchObject({ mode: "upgrade", credit: 66600, charge: 199933, subtotal: 133333, tax: 24000, total: 157333 });
    const r = await changePlan(org, U.owner!, { kind: "plan", planId: "growth", interval: "month" }, now);
    expect(r.invoice!.total).toBe(157333);
    expect((await sub()).planName).toBe("Starter"); // not until it's paid
    await markPaid(r.invoice!.id, { via: "manual", ref: "NEFT-001" }, now);
    const s = await sub();
    expect(s).toMatchObject({ planName: "Growth", amount: 299900, status: "active" });
    expect(s.currentPeriodEnd).toEqual(end);
  });

  it("schedules a downgrade for the end of the period, then bills it at renewal", async () => {
    const soon = new Date(Date.now() + 3 * DAY);
    await setSub({ currentPeriodStart: new Date(Date.now() - 27 * DAY), currentPeriodEnd: soon });
    const r = await S("POST", "change", { kind: "plan", planId: "workday", interval: "month" });
    expect(r.json.mode).toBe("downgrade");
    expect(r.json.invoiceId).toBeNull();
    expect((await sub()).pending).toMatchObject({ planName: "Workday" });
    expect((await entitlementFor(org)).planName).toBe("Growth");
    await subscriptionTick();
    const [renewal] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, org), eq(schema.subscriptionInvoices.kind, "renewal"), eq(schema.subscriptionInvoices.status, "open")));
    expect(renewal).toMatchObject({ subtotal: 19900, total: 19900 + 3582 });
    expect(renewal!.periodStart).toEqual(soon);
    // A second tick doesn't raise it twice.
    await subscriptionTick();
    expect(await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, org), eq(schema.subscriptionInvoices.kind, "renewal")))).toHaveLength(1);
    expect((await pay(renewal!.id)).status).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ planName: "Workday", pending: null, status: "active" });
    expect(s.currentPeriodStart).toEqual(soon);
  });
});

describe("missed renewals", () => {
  it("gives a grace period, then falls back to the Free plan (read-only if Free is switched off) until paid", async () => {
    // The period ended yesterday and the renewal wasn't paid.
    const ended = new Date(Date.now() - DAY);
    await setSub({ currentPeriodStart: new Date(Date.now() - 31 * DAY), currentPeriodEnd: ended });
    await subscriptionTick();
    let s = await sub();
    expect(s.status).toBe("past_due");
    expect((await entitlementFor(org)).state).toBe("grace");
    // Grace runs out.
    await setSub({ graceEndsAt: new Date(Date.now() - 1000) });
    await subscriptionTick();
    expect((await sub()).status).toBe("expired");
    // On Free: the Free plan's features only, nothing read-only.
    const free = await entitlementFor(org);
    expect(free).toMatchObject({ state: "free", planName: "Free", modules: ["mail", "calendar", "chat", "invoicing", "crm"] });
    expect(free.quotas).toEqual(DEFAULT_PLANS.find((p) => p.id === "free")!.quotas);
    await expect(assertEntitled(org, new Request(`http://localhost/api/v1/orgs/${org}/hr/people`, { method: "POST" }), "hr")).rejects.toThrow(/isn't in your Free plan/);
    await expect(assertEntitled(org, new Request(`http://localhost/api/v1/orgs/${org}/crm/contacts`, { method: "POST" }), "crm")).resolves.toBeUndefined();
    // With the Free plan switched off it's read-only instead: reading works; changing anything doesn't — except paying.
    const { saveSection, settings } = await import("@/server/platform/settings");
    await saveSection(U.staff!, "pricing", { ...(await settings()).pricing, freePlan: false });
    clearEntitlement();
    expect((await entitlementFor(org)).state).toBe("expired");
    const put = await call(modulesApi.PUT, { method: "PUT", cookie: C.owner, body: { modules: null }, path: `/api/v1/orgs/${org}/modules`, params: { orgId: org } });
    expect(put.status).toBe(403);
    expect(put.json.error.message).toMatch(/read-only/);
    expect((await call(modulesApi.GET, { cookie: C.owner, path: `/api/v1/orgs/${org}/modules`, params: { orgId: org } })).status).toBe(200);
    await saveSection(U.staff!, "pricing", { ...(await settings()).pricing, freePlan: true });
    clearEntitlement();
    const [open] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, org), eq(schema.subscriptionInvoices.status, "open")));
    expect(open!.kind).toBe("renewal");
    expect((await pay(open!.id)).status).toBe(200);
    s = await sub();
    // Paid after the grace period: a full period from today.
    expect(s.status).toBe("active");
    expect(Math.abs(s.currentPeriodStart!.getTime() - Date.now())).toBeLessThan(60_000);
    expect((await entitlementFor(org)).state).toBe("active");
  });

  it("ends a cancelled subscription when its period ends", async () => {
    expect((await S("POST", "cancel")).json.subscription.cancelAtPeriodEnd).toBe(true);
    expect((await entitlementFor(org)).state).toBe("canceling");
    expect((await S("POST", "resume")).json.subscription.cancelAtPeriodEnd).toBe(false);
    await S("POST", "cancel");
    await setSub({ currentPeriodEnd: new Date(Date.now() - 1000) });
    await subscriptionTick();
    expect((await sub()).status).toBe("expired");
  });
});

describe("the platform team", () => {
  it("sees the numbers and every subscription", async () => {
    const r = await A("GET", "subscriptions");
    expect(r.status).toBe(200);
    expect(r.json.stats.counts.total).toBe(3);
    expect(r.json.rows.find((x: { orgId: string }) => x.orgId === org)).toMatchObject({ status: "expired", planName: "Workday" });
    const csv = await A("GET", "subscriptions/csv");
    expect(csv.text).toContain("workspace_id,workspace,plan,status");
  });

  it("extends a trial, gives a complimentary plan, adds credit and records a payment", async () => {
    const ext = await A("POST", `subscriptions/${org}`, { action: "extend_trial", days: 14 });
    expect(ext.status).toBe(200);
    expect(ext.json.state).toBe("trial");
    // Money moves need a fresh sign-in through the API (this admin signed in 20 minutes ago)…
    await db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 20 * 60_000), reauthAt: null }).where(eq(schema.sessions.userId, U.staff!));
    expect((await A("POST", `subscriptions/${org}`, { action: "credit", amount: 5000, note: "Sorry for the outage" })).status).toBe(403);
    // …and are done (and logged) by the engine.
    await adminAct(U.staff!, org, { action: "credit", amount: 5000, note: "Sorry for the outage" });
    expect((await sub()).credit).toBe(5000);
    const comp = await adminAct(U.staff!, org, { action: "assign", choice: { kind: "plan", planId: "enterprise", interval: "month" }, complimentary: true, months: 3 });
    expect(comp).toMatchObject({ state: "active", subscription: { planName: "Enterprise", complimentary: true } });
    expect((await S("POST", "change", { kind: "plan", planId: "starter", interval: "month" })).status).toBe(409);
    await adminAct(U.staff!, org, { action: "end_complimentary" });
    const inv = await adminAct(U.staff!, org, { action: "assign", choice: { kind: "custom", modules: ["crm"], seats: 3, interval: "month" }, complimentary: false });
    const open = inv.invoices.find((i: { status: string }) => i.status === "open")!;
    const paid = await adminAct(U.staff!, org, { action: "record_payment", invoiceId: open.id, reference: "UPI 4471" });
    expect(paid.subscription).toMatchObject({ planName: "Your plan", status: "active" });
    expect(paid.entitled).toEqual(expect.arrayContaining(["crm", "mail", "calendar", "chat"]));
    const events = (await S("GET", "")).json.events.map((e: { kind: string }) => e.kind);
    expect(events).toEqual(expect.arrayContaining(["trial_extended", "credit", "complimentary_given", "complimentary_ended", "plan_assigned", "paid"]));
  });

  it("edits the catalogue without changing what subscribers already pay", async () => {
    const plans = (await A("GET", "billing-plans")).json;
    // The four on sale and the Free plan.
    expect(plans.plans).toHaveLength(6);
    const { savePlan } = await import("@/server/billing/subscriptions");
    const starter = plans.plans.find((p: { id: string }) => p.id === "starter");
    await savePlan(U.staff!, { ...starter, monthly: 129900 });
    const pub = await call(plansApi.GET, { path: "/api/v1/plans" });
    expect(pub.json.plans.find((p: { id: string }) => p.id === "starter").monthly).toBe(129900);
    expect((await sub()).amount).toBe(19900 + 29900); // the custom plan bought above (base + CRM), unchanged
  });
});

describe("sign-up after onboarding, with an emailed code", () => {
  const email = "neha@sunrise.in";
  let ticket = "";

  it("sends a code and keeps nothing but a hash of it", async () => {
    resetRateLimits();
    const r = await call(signupStart.POST, { method: "POST", body: { name: "Neha Shah", email, password: "correct-horse-42", workspaceName: "Sunrise Bakery", industry: "food", modules: ["pos", "inventory"], onboarding: { brief: "A bakery with two counters" }, choice: { kind: "plan", planId: "starter", interval: "year" }, acceptTerms: true } });
    expect(r.status).toBe(200);
    ticket = r.json.ticket;
    const code = await codeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    const [row] = await db.select().from(schema.emailOtps).where(eq(schema.emailOtps.id, ticket));
    expect(row!.codeHash).not.toContain(code);
    expect(JSON.stringify(row!.payload)).not.toContain("correct-horse-42");
    // No account yet.
    expect(await db.select().from(schema.users).where(eq(schema.users.email, email))).toHaveLength(0);
    // Terms must be accepted.
    expect((await call(signupStart.POST, { method: "POST", body: { name: "X", email: "x@y.in", password: "correct-horse-42", workspaceName: "X" } })).status).toBe(422);
  });

  it("counts wrong codes and creates everything on the right one", async () => {
    const wrong = await call(signupVerify.POST, { method: "POST", body: { ticket, code: "000000" } });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.message).toMatch(/4 tries left/);
    // Asking again replaces the code.
    await db.update(schema.emailOtps).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(schema.emailOtps.id, ticket));
    const again = await call(signupResend.POST, { method: "POST", body: { ticket } });
    expect(again.status).toBe(200);
    expect((await call(signupVerify.POST, { method: "POST", body: { ticket, code: await codeFor(email) } })).status).toBe(400);
    ticket = again.json.ticket;
    const ok = await call(signupVerify.POST, { method: "POST", body: { ticket, code: await codeFor(email) } });
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ email, workspace: "Sunrise Bakery" });
    // No session: they sign in next.
    expect(ok.headers.get("set-cookie")).toBeNull();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(u!.emailVerifiedAt).not.toBeNull();
    expect(u!.onboardedAt).not.toBeNull();
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, u!.id));
    const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, m!.orgId));
    expect(o).toMatchObject({ name: "Sunrise Bakery", industry: "food" });
    expect(o!.modules).toEqual(expect.arrayContaining(["pos", "inventory"]));
    const s = await sub(o!.id);
    expect(s).toMatchObject({ status: "trialing", planName: "Starter", interval: "year" });
    // A code works once.
    expect((await call(signupVerify.POST, { method: "POST", body: { ticket, code: await codeFor(email) } })).status).toBe(400);
  });

  it("signs in with a code", async () => {
    resetRateLimits();
    expect((await call(loginCode.POST, { method: "POST", body: { email } })).json.sent).toBe(true);
    // Unknown addresses get the same answer, and no email.
    expect((await call(loginCode.POST, { method: "POST", body: { email: "ghost@nowhere.in" } })).json.sent).toBe(true);
    expect(await codeFor("ghost@nowhere.in")).toBe("");
    const r = await call(loginCodeVerify.POST, { method: "POST", body: { email, code: await codeFor(email) } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("cc_session=");
  });
});

describe("joining by invitation", () => {
  it("creates just the account, verified by a code, and joins the inviting workspace", async () => {
    resetRateLimits();
    const { token } = await createInvitation(org, { id: U.owner!, role: "owner", name: "Asha Rao" }, "kiran@kiln.in", "editor");
    const r = await call(signupInvited.POST, { method: "POST", body: { token, name: "Kiran Das", password: "correct-horse-42", acceptTerms: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: "kiran@kiln.in", workspace: "Asha's workspace" });
    const ok = await call(signupVerify.POST, { method: "POST", body: { ticket: r.json.ticket, code: await codeFor("kiran@kiln.in") } });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ joined: true });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "kiran@kiln.in"));
    const ms = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, u!.id));
    expect(ms).toEqual([expect.objectContaining({ orgId: org, role: "editor" })]);
    // The invitation is used up.
    expect((await call(signupInvited.POST, { method: "POST", body: { token, name: "Again", password: "correct-horse-42", acceptTerms: true } })).status).toBe(400);
  });
});

describe("second thoughts", () => {
  let other = "";
  beforeAll(async () => {
    const [o] = await db.insert(schema.organizations).values({ name: "Second Thoughts", slug: `second-${Date.now()}` }).returning();
    other = o!.id;
    await db.insert(schema.memberships).values({ orgId: other, userId: U.owner!, role: "owner" });
    await startTrial(db, other);
  });
  const openOf = (kind: string) => db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, other), eq(schema.subscriptionInvoices.kind, kind), eq(schema.subscriptionInvoices.status, "open")));

  it("resuming in the trial brings back the plan's first invoice", async () => {
    await changePlan(other, U.owner!, { kind: "plan", planId: "starter", interval: "month" });
    expect(await openOf("first")).toHaveLength(1);
    await cancelAtEnd(other, U.owner!, true);
    expect(await openOf("first")).toHaveLength(0);
    await cancelAtEnd(other, U.owner!, false);
    const [inv] = await openOf("first");
    // Starter costs ₹1,299 since the catalogue edit above.
    expect(inv).toMatchObject({ subtotal: 129900, total: 129900 + 23382 });
  });

  it("a scheduled downgrade cancels an upgrade still waiting to be paid", async () => {
    await setSub({ status: "active", trialEndsAt: new Date(Date.now() - DAY), currentPeriodStart: new Date(Date.now() - 10 * DAY), currentPeriodEnd: new Date(Date.now() + 20 * DAY) }, other);
    await changePlan(other, U.owner!, { kind: "plan", planId: "growth", interval: "month" });
    expect(await openOf("upgrade")).toHaveLength(1);
    const r = await changePlan(other, U.owner!, { kind: "plan", planId: "workday", interval: "month" });
    expect(r.preview.mode).toBe("downgrade");
    expect(await openOf("upgrade")).toHaveLength(0);
  });

  it("a preview and the invoice agree to the paisa", async () => {
    const pv = await previewChange(other, { kind: "plan", planId: "enterprise", interval: "month" });
    const r = await changePlan(other, U.owner!, { kind: "plan", planId: "enterprise", interval: "month" });
    // Both are measured to the same minute (barring a minute boundary between the two calls).
    expect(Math.abs(r.invoice!.total - pv.total)).toBeLessThanOrEqual(r.preview.total === pv.total ? 0 : 1);
    expect(r.invoice!.total).toBe(r.preview.total);
  });
});
