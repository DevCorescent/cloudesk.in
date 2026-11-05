import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as rzpHook from "@/app/api/v1/billing/webhooks/razorpay/route";
import * as stripeHook from "@/app/api/v1/billing/webhooks/stripe/route";
import * as billing from "@/app/api/v1/orgs/[orgId]/billing/[[...slug]]/route";
import * as orgInvites from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import { setBillingHttp } from "@/server/billing/billing";
import { clearEntitlement } from "@/server/billing/subscriptions";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const STRIPE = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_stripe", STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_BUSINESS: "price_biz" };
const RZP = { RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "rzp_secret", RAZORPAY_WEBHOOK_SECRET: "rzp_whsec", RAZORPAY_PLAN_PRO: "plan_pro", RAZORPAY_PLAN_BUSINESS: "plan_biz" };
const setEnv = (on: Record<string, string>[]) => {
  for (const k of [...Object.keys(STRIPE), ...Object.keys(RZP)]) delete process.env[k];
  for (const e of on) Object.assign(process.env, e);
};

type Req = { url: string; method: string; body: string };
let reqs: Req[] = [];
const now = Math.floor(Date.now() / 1000);
const stripeSub = (price: string, extra: Record<string, unknown> = {}) => ({ id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, current_period_end: now + 30 * 86400, items: { data: [{ id: "si_1", price: { id: price } }] }, ...extra });

let cookie = "";
let orgId = "";
const B = (method: string, slug: string[] = [], body?: unknown) => call(billing[method as "GET"], { method, cookie, body, params: { orgId, slug } });
const newProject = (name: string) => call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name } });

function stripeEvent(id: string, type: string, object: Record<string, unknown>, secret = "whsec_stripe") {
  const raw = JSON.stringify({ id, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  return stripeHook.POST(new Request(`${ORIGIN}/api/v1/billing/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig }, body: raw }));
}
function rzpEvent(event: string, sub: Record<string, unknown>, payment?: Record<string, unknown>, secret = "rzp_whsec") {
  const raw = JSON.stringify({ event, created_at: now, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) } });
  return rzpHook.POST(new Request(`${ORIGIN}/api/v1/billing/webhooks/razorpay`, { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex"), "x-razorpay-event-id": `evt_${event}_${payment?.id ?? ""}` }, body: raw }));
}

beforeAll(async () => {
  await resetDb();
  setEnv([]);
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bea Bills", email: "bea@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  // These cover the legacy Pro/Business provider subscriptions, which apply to
  // workspaces without a subscription record (new ones are in subscriptions.test.ts).
  await db.delete(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, orgId));
  clearEntitlement();
  setBillingHttp(async (input, init) => {
    const url = String(input);
    reqs.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
    if (url.includes("/prices/price_pro")) return Response.json({ id: "price_pro", unit_amount: 149900, currency: "inr", recurring: { interval: "month" } });
    if (url.includes("/prices/price_biz")) return Response.json({ id: "price_biz", unit_amount: 499900, currency: "inr", recurring: { interval: "month" } });
    if (url.endsWith("/v1/customers")) return Response.json({ id: "cus_1" });
    if (url.endsWith("/v1/checkout/sessions")) return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    if (url.includes("/checkout/sessions/cs_test_1")) return Response.json({ id: "cs_test_1", status: "complete", client_reference_id: orgId, subscription: stripeSub("price_pro") });
    if (url.includes("/checkout/sessions/cs_test_other")) return Response.json({ id: "cs_test_other", status: "complete", client_reference_id: "00000000-0000-0000-0000-000000000000", subscription: stripeSub("price_biz") });
    if (url.endsWith("/v1/subscriptions/sub_1") && (init?.method ?? "GET") === "GET") return Response.json(stripeSub("price_pro"));
    if (url.endsWith("/v1/subscriptions/sub_1")) {
      const f = new URLSearchParams(String(init?.body));
      return Response.json(stripeSub(f.get("items[0][price]") ?? "price_pro", { cancel_at_period_end: f.get("cancel_at_period_end") === "true" }));
    }
    if (url.endsWith("/v1/billing_portal/sessions")) return Response.json({ url: "https://billing.stripe.com/p/session_1" });
    if (url.includes("/plans/plan_pro")) return Response.json({ id: "plan_pro", period: "monthly", item: { amount: 149900, currency: "INR" } });
    if (url.includes("/plans/plan_biz")) return Response.json({ id: "plan_biz", period: "monthly", item: { amount: 499900, currency: "INR" } });
    if (url.endsWith("/v1/subscriptions")) return Response.json({ id: "sub_rzp_1", status: "created", short_url: "https://rzp.io/i/abc" });
    return new Response("{}", { status: 404 });
  });
});
beforeEach(() => {
  reqs = [];
});
afterAll(async () => {
  setEnv([]);
  setBillingHttp(null);
  await closeDb();
});

describe("without billing configured", () => {
  it("doesn't enforce plans (self-hosted is unlimited)", async () => {
    const o = await B("GET");
    expect(o.json).toMatchObject({ enforced: false, providers: [], plan: "free" });
    for (const n of ["One", "Two", "Three", "Four"]) expect((await newProject(n)).status).toBe(201);
  });

  it("refuses every webhook while no signing secret is set (an empty key is one anybody can sign with)", async () => {
    // Keys but no webhook secret: how a platform looks before the webhook is created.
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret";
    try {
      const forged = await rzpEvent("payment.captured", {}, { id: "pay_forged", order_id: "order_any", amount: 100, currency: "INR", status: "captured" }, "");
      expect(forged.status).toBe(403);
      expect((await stripeEvent("evt_forged", "checkout.session.completed", { mode: "payment", metadata: { invoice_id: "x" } }, "")).status).toBe(403);
    } finally {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
    }
  });
});

describe("Stripe Billing", () => {
  it("enforces the free plan once billing is on, with a clear upgrade message", async () => {
    setEnv([STRIPE]);
    const o = await B("GET");
    expect(o.json).toMatchObject({ enforced: true, providers: ["stripe"], plan: "free", limits: { projects: 3 }, usage: { projects: 4 }, prices: { stripe: { pro: { amount: 149900, currency: "INR", interval: "month" } } } });
    const blocked = await newProject("Five");
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.message).toMatch(/Free plan includes 3 projects/);
    // Seats: the owner plus 2 invitations fill the free plan's 3.
    for (const e of ["a@example.com", "b@example.com"]) expect((await call(orgInvites.POST, { method: "POST", cookie, params: { orgId }, body: { email: e, role: "editor" } })).status).toBe(201);
    expect((await call(orgInvites.POST, { method: "POST", cookie, params: { orgId }, body: { email: "c@example.com", role: "editor" } })).status).toBe(409);
  });

  it("starts checkout, and only trusts the return after asking Stripe", async () => {
    const r = await B("POST", ["checkout"], { plan: "pro", provider: "stripe" });
    expect(r.json.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const session = new URLSearchParams(reqs.find((x) => x.url.endsWith("/checkout/sessions"))!.body);
    expect(Object.fromEntries(session)).toMatchObject({ mode: "subscription", customer: "cus_1", client_reference_id: orgId, "line_items[0][price]": "price_pro" });
    expect(session.get("success_url")).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect((await B("GET")).json.plan).toBe("free"); // nothing changes until confirmed
    expect((await B("POST", ["confirm"], { sessionId: "cs_test_other" })).status).toBe(403);
    expect((await B("POST", ["confirm"], { sessionId: "cs_test_1" })).json).toEqual({ applied: true });
    const o = (await B("GET")).json;
    expect(o).toMatchObject({ plan: "pro", limits: { projects: 20 }, subscription: { provider: "stripe", status: "active", cancelAtPeriodEnd: false } });
    expect((await newProject("Five")).status).toBe(201);
  });

  it("keeps in sync from signed webhooks, records invoices once, and ignores forgeries", async () => {
    const forged = await stripeEvent("evt_x", "customer.subscription.updated", stripeSub("price_biz", { metadata: { org_id: orgId } }), "whsec_wrong");
    expect(forged.status).toBe(403);
    expect((await stripeEvent("evt_1", "customer.subscription.updated", stripeSub("price_biz", { metadata: { org_id: orgId } }))).status).toBe(200);
    expect((await B("GET")).json.plan).toBe("business");
    const inv = { id: "in_1", customer: "cus_1", subscription: "sub_1", amount_paid: 499900, currency: "inr", status: "paid", hosted_invoice_url: "https://invoice.stripe.com/i/1" };
    await stripeEvent("evt_2", "invoice.paid", inv);
    expect((await stripeEvent("evt_2", "invoice.paid", inv)).status).toBe(200);
    const history = (await B("GET")).json.history.filter((h: { type: string }) => h.type === "invoice.paid");
    expect(history).toEqual([expect.objectContaining({ amount: 499900, currency: "INR", invoiceUrl: "https://invoice.stripe.com/i/1" })]);
    await stripeEvent("evt_3", "invoice.payment_failed", { ...inv, id: "in_2", status: "open", amount_paid: 0 });
    expect((await B("GET")).json).toMatchObject({ plan: "business", subscription: { status: "past_due" } }); // grace period keeps the plan
  });

  it("changes plan, cancels at period end, resumes, and drops to free when it ends", async () => {
    await B("POST", ["change"], { plan: "pro" });
    expect(new URLSearchParams(reqs.at(-1)!.body).get("items[0][price]")).toBe("price_pro");
    expect((await B("GET")).json.plan).toBe("pro");
    await B("POST", ["cancel"]);
    expect((await B("GET")).json).toMatchObject({ plan: "pro", subscription: { cancelAtPeriodEnd: true } });
    await B("POST", ["resume"]);
    expect((await B("GET")).json.subscription.cancelAtPeriodEnd).toBe(false);
    expect((await B("POST", ["portal"])).json.url).toBe("https://billing.stripe.com/p/session_1");
    await stripeEvent("evt_4", "customer.subscription.deleted", stripeSub("price_pro", { status: "canceled", current_period_end: now - 60, metadata: { org_id: orgId } }));
    const o = (await B("GET")).json;
    expect(o.plan).toBe("free");
    // Nothing is deleted: the 5 projects remain; creating a 6th is blocked.
    expect(o.usage.projects).toBe(5);
    expect((await newProject("Six")).status).toBe(409);
  });
});

describe("Razorpay Subscriptions", () => {
  it("creates a subscription and applies it only from signed webhooks", async () => {
    setEnv([RZP]);
    await db.update(schema.organizations).set({ subscriptionId: null, subscriptionStatus: null, plan: "free", billingProvider: null }).where(eq(schema.organizations.id, orgId));
    const r = await B("POST", ["checkout"], { plan: "business", provider: "razorpay" });
    expect(r.json.url).toBe("https://rzp.io/i/abc");
    expect(JSON.parse(reqs.find((x) => x.url.endsWith("/v1/subscriptions"))!.body)).toMatchObject({ plan_id: "plan_biz", notes: { org_id: orgId, plan: "business" } });
    expect((await B("GET")).json.plan).toBe("free"); // "incomplete" until Razorpay confirms
    const sub = { id: "sub_rzp_1", plan_id: "plan_biz", status: "active", current_end: now + 30 * 86400, customer_id: "cust_1", notes: { org_id: orgId } };
    expect((await rzpEvent("subscription.activated", sub, undefined, "nope")).status).toBe(403);
    await rzpEvent("subscription.activated", sub);
    await rzpEvent("subscription.charged", sub, { id: "pay_1", amount: 499900, currency: "INR", status: "captured" });
    const o = (await B("GET")).json;
    expect(o).toMatchObject({ plan: "business", subscription: { provider: "razorpay", status: "active" } });
    expect(o.history.find((h: { type: string }) => h.type === "subscription.charged")).toMatchObject({ amount: 499900, currency: "INR" });
    await rzpEvent("subscription.halted", { ...sub, status: "halted" });
    expect((await B("GET")).json.plan).toBe("free");
  });
});
