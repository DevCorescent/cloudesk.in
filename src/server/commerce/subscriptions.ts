// Customer subscriptions (subscribe-and-save boxes, memberships billed
// monthly …) through Stripe Billing or Razorpay Subscriptions.
//
// A subscription is checked out on its own. The recurring charge is the first
// order's total (items, delivery and tax). Each paid renewal — confirmed only by
// the provider's signed webhook — creates a new paid order to fulfil.
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { sha256 } from "../security/tokens";
import { adjustStock } from "./catalog";
import { providerHttp, type Creds } from "./payments";

export type Interval = "week" | "month" | "year";
type OrderRow = typeof schema.storeOrders.$inferSelect;

export const intervalLabel = (i: string, n: number) => (n === 1 ? { week: "Weekly", month: "Monthly", year: "Yearly" }[i] ?? i : `Every ${n} ${i}s`);

async function call(provider: "stripe" | "razorpay", creds: Creds, path: string, body?: { form?: Record<string, string>; json?: unknown }) {
  const url = provider === "stripe" ? `https://api.stripe.com/v1${path}` : `https://api.razorpay.com/v1${path}`;
  const headers: Record<string, string> = provider === "stripe" ? { Authorization: `Bearer ${creds.secretKey}` } : { Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}` };
  if (body?.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (body?.json) headers["Content-Type"] = "application/json";
  const res = await providerHttp(url, { method: body ? "POST" : "GET", headers, body: body?.form ? new URLSearchParams(body.form) : body?.json ? JSON.stringify(body.json) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; description?: string } };
  if (!res.ok) throw new ApiError("provider_error", `${provider === "stripe" ? "Stripe" : "Razorpay"}: ${json.error?.message ?? json.error?.description ?? `HTTP ${res.status}`}`);
  return json;
}

/** The subscription terms of an order's (single) subscription product, if any. */
export async function subscriptionTerms(orderId: string) {
  const [r] = await db
    .select({ title: schema.storeOrderItems.title, interval: schema.storeProducts.subscriptionInterval, count: schema.storeProducts.subscriptionIntervalCount })
    .from(schema.storeOrderItems)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeOrderItems.productId))
    .where(and(eq(schema.storeOrderItems.orderId, orderId), sql`${schema.storeProducts.subscriptionInterval} is not null`));
  return r?.interval ? { title: r.title, interval: r.interval as Interval, count: r.count } : null;
}

/** Starts a subscription checkout for an order; returns where to send the shopper. */
export async function startSubscriptionCheckout(order: OrderRow, provider: "stripe" | "razorpay", creds: Creds, urls: { success: string; cancel: string }, storeName: string) {
  const t = await subscriptionTerms(order.id);
  if (!t) throw new ApiError("conflict", "This order has no subscription product");
  const name = `${t.title} — ${intervalLabel(t.interval, t.count).toLowerCase()} (${storeName})`.slice(0, 250);
  if (provider === "stripe") {
    const s = await call("stripe", creds, "/checkout/sessions", {
      form: {
        mode: "subscription",
        success_url: urls.success,
        cancel_url: urls.cancel,
        client_reference_id: order.id,
        customer_email: order.email,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": order.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(order.total),
        "line_items[0][price_data][recurring][interval]": t.interval,
        "line_items[0][price_data][recurring][interval_count]": String(t.count),
        "line_items[0][price_data][product_data][name]": name,
        "metadata[order_id]": order.id,
        "subscription_data[metadata][order_id]": order.id,
        "subscription_data[metadata][project_id]": order.projectId,
      },
    });
    return { redirectUrl: String(s.url), ref: String(s.id) };
  }
  const plan = await call("razorpay", creds, "/plans", { json: { period: { week: "weekly", month: "monthly", year: "yearly" }[t.interval], interval: t.count, item: { name, amount: order.total, currency: order.currency } } });
  const sub = await call("razorpay", creds, "/subscriptions", { json: { plan_id: plan.id, total_count: t.interval === "week" ? 260 : t.interval === "month" ? 120 : 10, quantity: 1, customer_notify: 1, notes: { order_id: order.id, project_id: order.projectId } } });
  return { redirectUrl: String(sub.short_url), ref: String(sub.id) };
}

async function upsertSubscription(order: OrderRow, provider: "stripe" | "razorpay", providerSubId: string, patch: { status: string; periodEnd?: Date | null; cancelAtPeriodEnd?: boolean }) {
  const t = await subscriptionTerms(order.id);
  const [s] = await db
    .insert(schema.storeSubscriptions)
    .values({ projectId: order.projectId, firstOrderId: order.id, email: order.email, title: t?.title ?? "Subscription", amount: order.total, currency: order.currency, interval: t?.interval ?? "month", intervalCount: t?.count ?? 1, provider, providerSubId, status: patch.status, currentPeriodEnd: patch.periodEnd ?? null, cancelAtPeriodEnd: patch.cancelAtPeriodEnd ?? false })
    .onConflictDoUpdate({ target: [schema.storeSubscriptions.provider, schema.storeSubscriptions.providerSubId], set: { status: patch.status, ...(patch.periodEnd !== undefined ? { currentPeriodEnd: patch.periodEnd } : {}), ...(patch.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: patch.cancelAtPeriodEnd } : {}), updatedAt: new Date() } })
    .returning();
  await db.update(schema.storeOrders).set({ subscriptionId: s.id }).where(eq(schema.storeOrders.id, order.id));
  return s;
}

/** A paid renewal: a new paid order copying the first one (items, address, totals). */
async function createRenewalOrder(sub: typeof schema.storeSubscriptions.$inferSelect, amount: number, captureRef: string | null) {
  const [first] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, sub.firstOrderId));
  if (!first) return null;
  const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, first.id));
  const { markPaid, orderLabel } = await import("./orders");
  const order = await db.transaction(async (tx) => {
    const [store] = await tx.update(schema.stores).set({ nextOrderNumber: sql`${schema.stores.nextOrderNumber} + 1` }).where(eq(schema.stores.projectId, sub.projectId)).returning();
    const { id: _id, number: _n, accessKeyHash: _k, paymentRef: _r, paymentCaptureRef: _c, invoiceNumber: _i, createdAt: _cr, paidAt: _p, fulfilledAt: _f, tracking: _t, shipment: _s, ...rest } = first;
    void [_id, _n, _k, _r, _c, _i, _cr, _p, _f, _t, _s];
    const [o] = await tx
      .insert(schema.storeOrders)
      .values({ ...rest, number: store.nextOrderNumber - 1, accessKeyHash: sha256(`renewal:${sub.id}:${sub.renewals + 1}:${Date.now()}`), financialStatus: "pending", fulfillmentStatus: "unfulfilled", refundedTotal: 0, cancelledAt: null, cancelReason: null, reservedUntil: null, note: `Subscription renewal ${sub.renewals + 1} (first order ${orderLabel(store.orderPrefix, first.number)})`, subscriptionId: sub.id, paymentRef: `renewal:${sub.providerSubId}:${sub.renewals + 1}`, total: amount, giftCardTotal: 0, giftCardCode: null })
      .returning();
    await tx.insert(schema.storeOrderItems).values(items.map(({ id: _x, orderId: _y, downloads: _d, ...i }) => (void [_x, _y, _d], { ...i, orderId: o.id })));
    // Each renewal ships again, so it takes stock like any order.
    for (const i of items) {
      if (!i.variantId) continue;
      const [v] = await tx.select({ track: schema.storeVariants.trackInventory }).from(schema.storeVariants).where(eq(schema.storeVariants.id, i.variantId));
      if (v?.track) await adjustStock(sub.projectId, i.variantId, -i.quantity, "Subscription renewal", null, orderLabel(store.orderPrefix, o.number), tx);
    }
    await tx.update(schema.storeSubscriptions).set({ renewals: sql`${schema.storeSubscriptions.renewals} + 1`, status: "active", updatedAt: new Date() }).where(eq(schema.storeSubscriptions.id, sub.id));
    await tx.insert(schema.storeOrderEvents).values({ orderId: o.id, kind: "placed", message: `Renewal of subscription ${sub.title}` });
    return o;
  });
  await markPaid(order.id, `${sub.provider === "stripe" ? "Stripe" : "Razorpay"} subscription renewal`, captureRef);
  return order;
}

/**
 * Subscription webhook events (signature already verified, event de-duplicated).
 * Returns handled: false when the regular order-payment flow should continue.
 */
export async function handleSubscriptionEvent(projectId: string, provider: "stripe" | "razorpay", raw: string): Promise<{ handled: boolean; result?: Record<string, unknown> }> {
  const evt = JSON.parse(raw) as Record<string, unknown>;
  if (provider === "stripe") {
    const type = String(evt.type);
    const obj = ((evt.data as { object?: Record<string, unknown> })?.object ?? {}) as Record<string, unknown>;
    if (type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
      const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.paymentRef, String(obj.id))));
      if (o) await upsertSubscription(o, "stripe", String(obj.subscription), { status: "active" });
      return { handled: false }; // the order itself is marked paid by the regular flow
    }
    if (type === "invoice.paid" && obj.subscription && obj.billing_reason === "subscription_cycle") {
      const [s] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.projectId, projectId), eq(schema.storeSubscriptions.provider, "stripe"), eq(schema.storeSubscriptions.providerSubId, String(obj.subscription))));
      if (!s) return { handled: true, result: { unmatched: true } };
      const o = await createRenewalOrder(s, Number(obj.amount_paid), obj.payment_intent ? String(obj.payment_intent) : null);
      return { handled: true, result: { renewalOrder: o?.number } };
    }
    if (type.startsWith("customer.subscription.")) {
      const [s] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.projectId, projectId), eq(schema.storeSubscriptions.provider, "stripe"), eq(schema.storeSubscriptions.providerSubId, String(obj.id))));
      if (s) {
        const end = Number(obj.current_period_end ?? ((obj.items as { data?: { current_period_end?: number }[] })?.data?.[0]?.current_period_end ?? 0));
        await db.update(schema.storeSubscriptions).set({ status: type === "customer.subscription.deleted" ? "canceled" : String(obj.status) === "unpaid" ? "past_due" : String(obj.status), cancelAtPeriodEnd: !!obj.cancel_at_period_end, currentPeriodEnd: end ? new Date(end * 1000) : s.currentPeriodEnd, updatedAt: new Date() }).where(eq(schema.storeSubscriptions.id, s.id));
      }
      return { handled: true, result: { updated: !!s } };
    }
    return { handled: false };
  }
  // Razorpay
  const name = String(evt.event ?? "");
  if (!name.startsWith("subscription.")) return { handled: false };
  const payload = (evt.payload ?? {}) as { subscription?: { entity: Record<string, unknown> }; payment?: { entity: Record<string, unknown> } };
  const sub = payload.subscription?.entity;
  if (!sub) return { handled: true };
  const orderId = String((sub.notes as Record<string, string> | undefined)?.order_id ?? "");
  const [first] = /^[0-9a-f-]{36}$/i.test(orderId) ? await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, orderId), eq(schema.storeOrders.projectId, projectId))) : [];
  if (!first) return { handled: true, result: { unmatched: true } };
  const status = ({ active: "active", authenticated: "incomplete", pending: "past_due", halted: "past_due", cancelled: "canceled", completed: "canceled", expired: "canceled" } as Record<string, string>)[String(sub.status)] ?? "incomplete";
  const periodEnd = sub.current_end ? new Date(Number(sub.current_end) * 1000) : undefined;
  const [existing] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.provider, "razorpay"), eq(schema.storeSubscriptions.providerSubId, String(sub.id))));
  if (name === "subscription.charged") {
    const pay = payload.payment?.entity ?? {};
    const amount = Number(pay.amount ?? 0);
    if (!existing || first.financialStatus === "pending") {
      // The first charge pays the original order.
      const s = await upsertSubscription(first, "razorpay", String(sub.id), { status: "active", periodEnd });
      if (amount < first.total) return { handled: true, result: { mismatch: true, subscription: s.id } };
      const { markPaid } = await import("./orders");
      await markPaid(first.id, "Razorpay subscription", pay.id ? String(pay.id) : null);
      return { handled: true, result: { firstOrderPaid: first.number } };
    }
    await db.update(schema.storeSubscriptions).set({ currentPeriodEnd: periodEnd ?? existing.currentPeriodEnd }).where(eq(schema.storeSubscriptions.id, existing.id));
    const o = await createRenewalOrder(existing, amount, pay.id ? String(pay.id) : null);
    return { handled: true, result: { renewalOrder: o?.number } };
  }
  await upsertSubscription(first, "razorpay", String(sub.id), { status, periodEnd, ...(name === "subscription.cancelled" ? { cancelAtPeriodEnd: false } : {}) });
  return { handled: true, result: { status } };
}

export async function listSubscriptions(projectId: string) {
  return db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.projectId, projectId)).orderBy(desc(schema.storeSubscriptions.createdAt)).limit(500);
}

/** Cancels at the end of the paid period (customer via their order link, or staff). */
export async function cancelStoreSubscription(projectId: string, subscriptionId: string, creds: Creds, by: "customer" | "staff") {
  const [s] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.id, subscriptionId), eq(schema.storeSubscriptions.projectId, projectId)));
  if (!s) throw notFound("Subscription");
  if (s.status === "canceled" || s.cancelAtPeriodEnd) throw new ApiError("conflict", "This subscription is already cancelled");
  if (s.provider === "stripe") await call("stripe", creds, `/subscriptions/${encodeURIComponent(s.providerSubId)}`, { form: { cancel_at_period_end: "true" } });
  else await call("razorpay", creds, `/subscriptions/${encodeURIComponent(s.providerSubId)}/cancel`, { json: { cancel_at_cycle_end: 1 } });
  await db.update(schema.storeSubscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(schema.storeSubscriptions.id, s.id));
  await db.insert(schema.storeOrderEvents).values({ orderId: s.firstOrderId, kind: "note", message: `Subscription cancelled by the ${by}; it ends after the current period.` });
  log.info("store_subscription_cancelled", { projectId, subscriptionId, by });
}
