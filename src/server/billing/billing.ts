// Platform billing with Stripe Billing or Razorpay Subscriptions.
//
// Configuration (platform environment):
//   Stripe:   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS
//   Razorpay: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_PRO, RAZORPAY_PLAN_BUSINESS
// Prices shown to people come from the provider (the configured Price/Plan).
// A browser returning from checkout proves nothing: subscriptions are only
// applied from the provider's API or its signed webhooks.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isPlanId, PLAN_IDS, PLANS, UNLIMITED, type Limits, type PlanId } from "@/lib/platform/plans";
import { ApiError } from "../http/errors";
import { cfg } from "../platform/config";
import { settings } from "../platform/settings";
import { audit } from "../services/audit";
import { appUrl } from "../services/mail";

export type BillingProvider = "stripe" | "razorpay";
type Paid = Exclude<PlanId, "free">;

type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
/** Test hook. */
export function setBillingHttp(f: Fetch | null) {
  http = f ?? ((input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }));
}

const env = (k: string) => cfg(k) ?? "";
const priceId = (p: BillingProvider, plan: Paid) => env(p === "stripe" ? `STRIPE_PRICE_${plan.toUpperCase()}` : `RAZORPAY_PLAN_${plan.toUpperCase()}`);

export function configuredProviders(): BillingProvider[] {
  const out: BillingProvider[] = [];
  if (env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET") && priceId("stripe", "pro") && priceId("stripe", "business")) out.push("stripe");
  if (env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET") && env("RAZORPAY_WEBHOOK_SECRET") && priceId("razorpay", "pro") && priceId("razorpay", "business")) out.push("razorpay");
  return out;
}

/** Limits are enforced only when the platform can actually take payment. */
export const billingEnforced = () => configuredProviders().length > 0;

const planFromPrice = (provider: BillingProvider, id: string): PlanId => (id && id === priceId(provider, "business") ? "business" : id && id === priceId(provider, "pro") ? "pro" : "free");

/** The provider APIs, shared with subscription payments (src/server/billing/subscriptions.ts). */
export const providerApi = (provider: BillingProvider, path: string, init: { method?: string; form?: Record<string, string>; json?: unknown; idempotencyKey?: string } = {}) => call(provider, path, init);
export const providerKey = (k: string) => env(k);

async function call(provider: BillingProvider, path: string, init: { method?: string; form?: Record<string, string>; json?: unknown; idempotencyKey?: string } = {}) {
  const url = provider === "stripe" ? `https://api.stripe.com/v1${path}` : `https://api.razorpay.com/v1${path}`;
  const headers: Record<string, string> =
    provider === "stripe" ? { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` } : { Authorization: `Basic ${Buffer.from(`${env("RAZORPAY_KEY_ID")}:${env("RAZORPAY_KEY_SECRET")}`).toString("base64")}` };
  if (init.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.json) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey && provider === "stripe") headers["Idempotency-Key"] = init.idempotencyKey;
  const res = await http(url, { method: init.method ?? (init.form || init.json ? "POST" : "GET"), headers, body: init.form ? new URLSearchParams(init.form) : init.json ? JSON.stringify(init.json) : undefined });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; description?: string } };
  if (!res.ok) throw new ApiError("provider_error", `${provider === "stripe" ? "Stripe" : "Razorpay"}: ${body.error?.message ?? body.error?.description ?? `HTTP ${res.status}`}`);
  return body;
}

// ─── Prices ──────────────────────────────────────────────────────────────────

const priceCache = new Map<string, { at: number; v: { amount: number; currency: string; interval: string } | null }>();
export async function priceFor(provider: BillingProvider, plan: Paid) {
  const id = priceId(provider, plan);
  const key = `${provider}:${id}`;
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  let v: { amount: number; currency: string; interval: string } | null = null;
  try {
    if (provider === "stripe") {
      const p = await call("stripe", `/prices/${encodeURIComponent(id)}`);
      v = { amount: Number(p.unit_amount), currency: String(p.currency).toUpperCase(), interval: String((p.recurring as { interval?: string })?.interval ?? "month") };
    } else {
      const p = await call("razorpay", `/plans/${encodeURIComponent(id)}`);
      const item = p.item as { amount: number; currency: string };
      v = { amount: Number(item.amount), currency: String(item.currency).toUpperCase(), interval: String(p.period ?? "monthly").replace(/ly$/, "") };
    }
  } catch {
    v = null; // shown as "price unavailable"; never invented
  }
  priceCache.set(key, { at: Date.now(), v });
  return v;
}

// ─── Plans, limits and usage ─────────────────────────────────────────────────

type Org = typeof schema.organizations.$inferSelect;

async function getOrg(orgId: string) {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!o) throw new ApiError("not_found", "Organization not found");
  return o;
}

/** The plan in force: paid plans count while active, trialing or in the payment grace period. */
export function effectivePlan(o: Pick<Org, "plan" | "subscriptionStatus" | "currentPeriodEnd"> & { trialPlan?: string | null; trialEndsAt?: Date | null; compPlan?: string | null }, now = new Date()): PlanId {
  const better = (a: PlanId, b: PlanId) => (PLAN_IDS.indexOf(a) >= PLAN_IDS.indexOf(b) ? a : b);
  let plan = paidPlan(o, now);
  // A trial the platform gave: the better of it and the paid plan, until it ends.
  if (o.trialPlan && isPlanId(o.trialPlan) && o.trialEndsAt && o.trialEndsAt > now) plan = better(o.trialPlan, plan);
  // A complimentary plan the platform gave, while it's set.
  if (o.compPlan && isPlanId(o.compPlan)) plan = better(o.compPlan, plan);
  return plan;
}

/** A plan's limits with the platform's overrides (Admin → Plans) applied. */
export async function planLimits(plan: PlanId): Promise<Limits> {
  const o = (await settings()).plans[plan] ?? {};
  return { ...PLANS[plan].limits, ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) };
}

function paidPlan(o: Pick<Org, "plan" | "subscriptionStatus" | "currentPeriodEnd">, now: Date): PlanId {
  if (!isPlanId(o.plan) || o.plan === "free") return "free";
  if (["active", "trialing", "past_due"].includes(o.subscriptionStatus ?? "")) return o.plan;
  // Cancelled subscriptions keep their plan until the paid period ends.
  if (o.subscriptionStatus === "canceled" && o.currentPeriodEnd && o.currentPeriodEnd > now) return o.plan;
  return "free";
}

export async function limitsFor(orgId: string): Promise<Limits> {
  // Workspaces on subscriptions (all of them since 2026-10) follow their plan.
  const sub = await import("./subscriptions");
  if ((await sub.pricing()).enforce && (await sub.subscriptionOf(orgId))) return (await sub.entitlementFor(orgId)).limits;
  if (!billingEnforced()) return UNLIMITED;
  return planLimits(effectivePlan(await getOrg(orgId)));
}

export async function usageFor(orgId: string) {
  const [[p], [m], [inv], [d]] = await Promise.all([
    db.select({ n: count() }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), isNull(schema.projects.archivedAt))),
    db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId)),
    db.select({ n: count() }).from(schema.invitations).where(and(eq(schema.invitations.orgId, orgId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), sql`${schema.invitations.expiresAt} > now()`)),
    db
      .select({ n: count() })
      .from(schema.siteDomains)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.siteDomains.projectId))
      .where(eq(schema.projects.orgId, orgId)),
  ]);
  return { projects: p.n, seats: m.n + inv.n, customDomains: d.n };
}

const LIMIT_TEXT: Record<keyof Limits, string> = { projects: "projects", seats: "team members (including pending invitations)", customDomains: "custom domains", automationsPerProject: "automations in a project" };

/** Throws a clear "upgrade" error when creating one more would pass the plan's limit. */
export async function assertWithinLimit(orgId: string, resource: keyof Limits, current?: number) {
  const limits = await limitsFor(orgId);
  if (!Number.isFinite(limits[resource])) return;
  const used = current ?? (resource === "automationsPerProject" ? 0 : (await usageFor(orgId))[resource]);
  if (used >= limits[resource]) {
    const sub = await import("./subscriptions");
    if ((await sub.pricing()).enforce && (await sub.subscriptionOf(orgId))) {
      const e = await sub.entitlementFor(orgId);
      if (e.state === "expired") throw new ApiError("conflict", "Your subscription has ended. Choose a plan in Settings → Billing to add more.", { limit: [resource] });
      throw new ApiError("conflict", `${e.state === "trial" ? "Your free trial" : `Your ${e.planName} plan`} includes ${limits[resource]} ${LIMIT_TEXT[resource]}. Change plan in Settings → Billing to add more.`, { limit: [resource], plan: [e.planName] });
    }
    const plan = effectivePlan(await getOrg(orgId));
    throw new ApiError("conflict", `Your ${PLANS[plan].name} plan includes ${limits[resource]} ${LIMIT_TEXT[resource]}. Upgrade in Settings → Billing to add more.`, { limit: [resource], plan: [plan] });
  }
}

export async function billingOverview(orgId: string) {
  const o = await getOrg(orgId);
  const providers = configuredProviders();
  const prices = Object.fromEntries(await Promise.all(providers.map(async (p) => [p, { pro: await priceFor(p, "pro"), business: await priceFor(p, "business") }] as const)));
  const history = await db.select().from(schema.billingEvents).where(eq(schema.billingEvents.orgId, orgId)).orderBy(desc(schema.billingEvents.createdAt)).limit(30);
  return {
    enforced: providers.length > 0,
    providers,
    prices,
    plan: effectivePlan(o),
    subscription: o.subscriptionId ? { provider: o.billingProvider, status: o.subscriptionStatus, plan: o.plan, currentPeriodEnd: o.currentPeriodEnd, cancelAtPeriodEnd: o.cancelAtPeriodEnd } : null,
    limits: await limitsFor(orgId),
    usage: await usageFor(orgId),
    history: history.map((h) => ({ id: h.id, type: h.type, amount: h.amount, currency: h.currency, status: h.status, invoiceUrl: h.invoiceUrl, description: h.description, createdAt: h.createdAt })),
  };
}

// ─── Checkout ────────────────────────────────────────────────────────────────

async function stripeCustomer(o: Org, email: string) {
  if (o.billingProvider === "stripe" && o.billingCustomerId) return o.billingCustomerId;
  const c = await call("stripe", "/customers", { form: { email, name: o.name, "metadata[org_id]": o.id }, idempotencyKey: `customer-${o.id}` });
  await db.update(schema.organizations).set({ billingCustomerId: String(c.id), billingProvider: "stripe", billingEmail: email }).where(eq(schema.organizations.id, o.id));
  return String(c.id);
}

/** Starts a subscription; returns where to send the person to pay. */
export async function startCheckout(orgId: string, userId: string, email: string, input: { plan: Paid; provider: BillingProvider }) {
  if (!configuredProviders().includes(input.provider)) throw new ApiError("conflict", "That payment provider isn't set up on this platform");
  const o = await getOrg(orgId);
  if (o.subscriptionId && ["active", "trialing", "past_due"].includes(o.subscriptionStatus ?? "")) throw new ApiError("conflict", "This organization already has a subscription. Change the plan instead.");
  if (input.provider === "stripe") {
    const customer = await stripeCustomer(o, email);
    const s = await call("stripe", "/checkout/sessions", {
      form: {
        mode: "subscription",
        customer,
        client_reference_id: o.id,
        "line_items[0][price]": priceId("stripe", input.plan),
        "line_items[0][quantity]": "1",
        "subscription_data[metadata][org_id]": o.id,
        "metadata[org_id]": o.id,
        allow_promotion_codes: "true",
        success_url: appUrl("/settings/billing?checkout=stripe&session_id={CHECKOUT_SESSION_ID}"),
        cancel_url: appUrl("/settings/billing?checkout=cancelled"),
      },
    });
    await audit({ orgId, actorId: userId, action: "billing.checkout_started", metadata: { provider: "stripe", plan: input.plan } });
    return { url: String(s.url) };
  }
  const sub = await call("razorpay", "/subscriptions", { json: { plan_id: priceId("razorpay", input.plan), total_count: 120, quantity: 1, customer_notify: 1, notes: { org_id: o.id, plan: input.plan } } });
  await db.update(schema.organizations).set({ billingProvider: "razorpay", subscriptionId: String(sub.id), subscriptionStatus: "incomplete", plan: input.plan, billingEmail: email }).where(eq(schema.organizations.id, o.id));
  await audit({ orgId, actorId: userId, action: "billing.checkout_started", metadata: { provider: "razorpay", plan: input.plan } });
  return { url: String(sub.short_url) };
}

/** cancelAtPeriodEnd undefined: keep what we have (Razorpay doesn't report scheduled cancellations). */
type SubState = { id: string; status: string; plan: PlanId; periodEnd: Date | null; cancelAtPeriodEnd?: boolean; customerId?: string | null };

async function applySubscription(orgId: string, provider: BillingProvider, s: SubState) {
  const [before] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!before) return;
  // A stale event for an older subscription must not overwrite the current one.
  if (before.subscriptionId && before.subscriptionId !== s.id && ["active", "trialing", "past_due"].includes(before.subscriptionStatus ?? "") && s.status === "canceled") return;
  await db
    .update(schema.organizations)
    .set({ billingProvider: provider, subscriptionId: s.id, subscriptionStatus: s.status, plan: s.plan, currentPeriodEnd: s.periodEnd, cancelAtPeriodEnd: s.status === "canceled" ? false : (s.cancelAtPeriodEnd ?? (before.subscriptionId === s.id ? before.cancelAtPeriodEnd : false)), ...(s.customerId ? { billingCustomerId: s.customerId } : {}) })
    .where(eq(schema.organizations.id, orgId));
  if (before.plan !== s.plan || before.subscriptionStatus !== s.status) await audit({ orgId, action: "billing.subscription_changed", metadata: { provider, from: `${before.plan}/${before.subscriptionStatus ?? "-"}`, to: `${s.plan}/${s.status}` } });
}

const stripeSub = (sub: Record<string, unknown>): SubState => {
  const items = ((sub.items as { data?: { price: { id: string }; current_period_end?: number }[] })?.data ?? [])[0];
  const end = Number(sub.current_period_end ?? items?.current_period_end ?? 0);
  return { id: String(sub.id), status: String(sub.status) === "unpaid" ? "past_due" : String(sub.status), plan: planFromPrice("stripe", items?.price.id ?? ""), periodEnd: end ? new Date(end * 1000) : null, cancelAtPeriodEnd: !!sub.cancel_at_period_end, customerId: sub.customer ? String(sub.customer) : null };
};

/** The browser came back from Stripe Checkout: ask Stripe what actually happened. */
export async function confirmStripeCheckout(orgId: string, sessionId: string) {
  if (!/^cs_[\w]+$/.test(sessionId)) throw new ApiError("validation_failed", "Invalid session");
  const s = await call("stripe", `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`);
  if (s.client_reference_id !== orgId) throw new ApiError("forbidden", "This checkout belongs to another organization");
  if (s.status !== "complete" || !s.subscription) return { applied: false };
  await applySubscription(orgId, "stripe", stripeSub(s.subscription as Record<string, unknown>));
  return { applied: true };
}

const rzpStatus = (s: string) => ({ active: "active", authenticated: "incomplete", created: "incomplete", pending: "past_due", halted: "halted", cancelled: "canceled", completed: "canceled", expired: "canceled", paused: "past_due" })[s] ?? s;
const rzpSub = (sub: Record<string, unknown>): SubState => ({
  id: String(sub.id),
  status: rzpStatus(String(sub.status)),
  plan: planFromPrice("razorpay", String(sub.plan_id ?? "")),
  periodEnd: sub.current_end ? new Date(Number(sub.current_end) * 1000) : null,
  customerId: sub.customer_id ? String(sub.customer_id) : null,
});

// ─── Managing a subscription ─────────────────────────────────────────────────

async function currentSub(orgId: string) {
  const o = await getOrg(orgId);
  if (!o.subscriptionId || !o.billingProvider) throw new ApiError("conflict", "This organization has no subscription");
  return o;
}

export async function changePlan(orgId: string, userId: string, plan: Paid) {
  const o = await currentSub(orgId);
  if (o.billingProvider === "stripe") {
    const sub = await call("stripe", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}`);
    const item = ((sub.items as { data: { id: string }[] }).data ?? [])[0];
    const updated = await call("stripe", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}`, { form: { "items[0][id]": item.id, "items[0][price]": priceId("stripe", plan), proration_behavior: "create_prorations", cancel_at_period_end: "false" } });
    await applySubscription(orgId, "stripe", stripeSub(updated));
  } else {
    // Razorpay applies plan changes from the next billing cycle.
    const updated = await call("razorpay", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}`, { method: "PATCH", json: { plan_id: priceId("razorpay", plan), schedule_change_at: "cycle_end" } });
    await applySubscription(orgId, "razorpay", { ...rzpSub(updated), plan: effectivePlan(o) });
  }
  await audit({ orgId, actorId: userId, action: "billing.plan_change_requested", metadata: { plan } });
}

/** Cancels at the end of the paid period; nothing is deleted. */
export async function cancelSubscription(orgId: string, userId: string) {
  const o = await currentSub(orgId);
  if (o.billingProvider === "stripe") {
    const updated = await call("stripe", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}`, { form: { cancel_at_period_end: "true" } });
    await applySubscription(orgId, "stripe", stripeSub(updated));
  } else {
    const updated = await call("razorpay", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}/cancel`, { json: { cancel_at_cycle_end: 1 } });
    await applySubscription(orgId, "razorpay", { ...rzpSub(updated), cancelAtPeriodEnd: true, status: "active" });
  }
  await audit({ orgId, actorId: userId, action: "billing.cancel_requested" });
}

export async function resumeSubscription(orgId: string, userId: string) {
  const o = await currentSub(orgId);
  if (o.billingProvider !== "stripe") throw new ApiError("conflict", "Razorpay subscriptions can't be resumed once cancelled; start a new one after the period ends");
  const updated = await call("stripe", `/subscriptions/${encodeURIComponent(o.subscriptionId!)}`, { form: { cancel_at_period_end: "false" } });
  await applySubscription(orgId, "stripe", stripeSub(updated));
  await audit({ orgId, actorId: userId, action: "billing.resumed" });
}

/** Stripe's hosted portal: payment methods, invoices, tax ids. */
export async function portalUrl(orgId: string) {
  const o = await getOrg(orgId);
  if (o.billingProvider !== "stripe" || !o.billingCustomerId) throw new ApiError("conflict", "The billing portal is available for Stripe subscriptions");
  const s = await call("stripe", "/billing_portal/sessions", { form: { customer: o.billingCustomerId, return_url: appUrl("/settings/billing") } });
  return { url: String(s.url) };
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const hmacHex = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");
/** A webhook's signing secret. Without one nothing is accepted: an HMAC under an empty key is one anybody can make. */
const webhookSecret = (k: "STRIPE_WEBHOOK_SECRET" | "RAZORPAY_WEBHOOK_SECRET") => {
  const s = env(k);
  if (!s) throw new ApiError("forbidden", "Webhooks aren't set up on this platform");
  return s;
};
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function recordEvent(provider: BillingProvider, eventId: string, orgId: string | null, e: { type: string; amount?: number | null; currency?: string | null; status?: string | null; invoiceUrl?: string | null; description?: string }) {
  const r = await db
    .insert(schema.billingEvents)
    .values({ provider, eventId, orgId, type: e.type, amount: e.amount ?? null, currency: e.currency?.toUpperCase() ?? null, status: e.status ?? null, invoiceUrl: e.invoiceUrl ?? null, description: e.description ?? "" })
    .onConflictDoNothing()
    .returning({ id: schema.billingEvents.id });
  return r.length > 0;
}

async function orgForStripe(obj: Record<string, unknown>) {
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const fromMeta = meta.org_id || (obj.client_reference_id as string | undefined);
  if (fromMeta) return fromMeta;
  const ids = [obj.subscription, obj.id].filter(Boolean).map(String);
  const [o] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(and(eq(schema.organizations.billingProvider, "stripe"), inArray(schema.organizations.subscriptionId, ids.length ? ids : ["-"])));
  if (o) return o.id;
  if (obj.customer) {
    const [c] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.billingCustomerId, String(obj.customer)));
    return c?.id ?? null;
  }
  return null;
}

export async function handleStripeWebhook(raw: string, signature: string | null, now = Date.now()) {
  const secret = webhookSecret("STRIPE_WEBHOOK_SECRET");
  const parts = (signature ?? "").split(",");
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  const v1 = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length || Math.abs(now / 1000 - t) > 300 || !v1.some((v) => safeEq(v, hmacHex(secret, `${t}.${raw}`)))) throw new ApiError("forbidden", "Invalid signature");
  const evt = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const obj = evt.data.object;
  // A subscription invoice paid through Checkout (Settings → Billing).
  const invoiceId = ((obj.metadata ?? {}) as Record<string, string>).invoice_id;
  if (evt.type === "checkout.session.completed" && obj.mode === "payment" && invoiceId) {
    const fresh = await recordEvent("stripe", evt.id, ((obj.metadata ?? {}) as Record<string, string>).org_id ?? null, { type: evt.type, amount: Number(obj.amount_total ?? 0), currency: String(obj.currency ?? ""), status: String(obj.payment_status ?? ""), invoiceUrl: null, description: "Subscription invoice payment" });
    if (fresh && obj.payment_status === "paid") await (await import("./subscriptions")).paymentFromWebhook("stripe", invoiceId, String(obj.payment_intent ?? obj.id), Number(obj.amount_total), String(obj.currency));
    return { duplicate: !fresh };
  }
  const orgId = await orgForStripe(obj);
  const isInvoice = evt.type.startsWith("invoice.");
  const fresh = await recordEvent("stripe", evt.id, orgId, {
    type: evt.type,
    amount: isInvoice ? Number(obj.amount_paid ?? obj.amount_due ?? 0) : null,
    currency: isInvoice ? String(obj.currency ?? "") : null,
    status: isInvoice ? String(obj.status ?? "") : null,
    invoiceUrl: isInvoice ? ((obj.hosted_invoice_url as string) ?? null) : null,
    description: evt.type === "invoice.payment_failed" ? "Payment failed — update the card in the billing portal" : evt.type === "invoice.paid" ? "Invoice paid" : "",
  });
  if (!fresh || !orgId) return { duplicate: !fresh };
  if (evt.type.startsWith("customer.subscription.")) await applySubscription(orgId, "stripe", { ...stripeSub(obj), status: evt.type === "customer.subscription.deleted" ? "canceled" : stripeSub(obj).status });
  else if (evt.type === "checkout.session.completed" && obj.subscription) {
    const sub = await call("stripe", `/subscriptions/${encodeURIComponent(String(obj.subscription))}`);
    await applySubscription(orgId, "stripe", stripeSub(sub));
  } else if (evt.type === "invoice.payment_failed") await db.update(schema.organizations).set({ subscriptionStatus: "past_due" }).where(and(eq(schema.organizations.id, orgId), eq(schema.organizations.subscriptionStatus, "active")));
  return { duplicate: false };
}

export async function handleRazorpayWebhook(raw: string, signature: string | null, eventIdHeader: string | null) {
  const secret = webhookSecret("RAZORPAY_WEBHOOK_SECRET");
  if (!signature || !safeEq(signature, hmacHex(secret, raw))) throw new ApiError("forbidden", "Invalid signature");
  const evt = JSON.parse(raw) as { event: string; created_at?: number; payload: { subscription?: { entity: Record<string, unknown> }; payment?: { entity: Record<string, unknown> } } };
  // A subscription invoice paid through Razorpay Checkout: matched by its order.
  const paid = evt.payload.payment?.entity;
  if (!evt.payload.subscription && paid && (evt.event === "payment.captured" || evt.event === "order.paid") && paid.order_id && paid.status === "captured") {
    const fresh = await recordEvent("razorpay", eventIdHeader ?? `${evt.event}:${paid.id}`, null, { type: evt.event, amount: Number(paid.amount), currency: String(paid.currency), status: String(paid.status), description: "Subscription invoice payment" });
    if (fresh) await (await import("./subscriptions")).paymentByOrder(String(paid.order_id), String(paid.id), Number(paid.amount), String(paid.currency));
    return { duplicate: !fresh };
  }
  const sub = evt.payload.subscription?.entity;
  if (!sub) return { ignored: true };
  const notes = (sub.notes ?? {}) as Record<string, string>;
  let orgId: string | null = notes.org_id ?? null;
  if (!orgId) {
    const [o] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.subscriptionId, String(sub.id)));
    orgId = o?.id ?? null;
  }
  const pay = evt.payload.payment?.entity;
  const eventId = eventIdHeader ?? `${evt.event}:${sub.id}:${pay?.id ?? evt.created_at ?? ""}`;
  const fresh = await recordEvent("razorpay", eventId, orgId, { type: evt.event, amount: pay ? Number(pay.amount) : null, currency: pay ? String(pay.currency) : null, status: pay ? String(pay.status) : String(sub.status), description: evt.event === "subscription.charged" ? "Subscription payment" : evt.event === "subscription.halted" ? "Payments failed repeatedly — the subscription is halted" : "" });
  if (!fresh || !orgId) return { duplicate: !fresh };
  const state = rzpSub(sub);
  await applySubscription(orgId, "razorpay", state);
  return { duplicate: false };
}
