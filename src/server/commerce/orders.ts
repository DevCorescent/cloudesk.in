import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { recordTestWebhook } from "./payment-test";
import { db, schema } from "@/db";
import { toBaseMinor } from "@/lib/store/fx";
import { financialYear } from "@/lib/store/gst";
import { formatMoney } from "@/lib/store/money";
import { CARRIERS, type Address } from "@/lib/store/shipping";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { decryptSecret } from "../security/secrets";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl, sendMail } from "../services/mail";
import { adjustStock } from "./catalog";
import { creditGiftCard, findGiftCard, giftCardRefunded } from "./giftcards";
import { notifyOrderWhatsApp } from "./whatsapp";
import { markBookingPaid } from "../bookings/bookings";
import { fulfillNonPhysical } from "./digital";
import { emitEvent } from "../events/bus";
import { handleSubscriptionEvent, startSubscriptionCheckout, subscriptionTerms } from "./subscriptions";
import { quoteCart, type CartRow } from "./cart";
import { paypal, providerInfo, razorpay, stripe, type Creds, type PayOrder, type ProviderId } from "./payments";
import { contains } from "../security/like";

export type OrderRow = typeof schema.storeOrders.$inferSelect;
export const RESERVATION_MINUTES = 30;

export const orderLabel = (prefix: string, n: number) => `${prefix}${n}`;

/** Storefront base paths the platform serves sites under; anything else is rejected. */
export function safeBase(base: string | null | undefined): string {
  const b = (base ?? "").replace(/\/+$/, "");
  return /^\/(s\/[a-z0-9-]+\/[a-z0-9-]+|sites\/[0-9a-f-]{36})$/i.test(b) ? b : "";
}

async function event(orderId: string, kind: string, message: string, data?: unknown, actorId?: string | null, exec: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db) {
  await exec.insert(schema.storeOrderEvents).values({ orderId, kind, message, data: data as object, actorId: actorId ?? null });
}

// ─── Placing orders ──────────────────────────────────────────────────────────

export type CheckoutInput = { email: string; phone: string; address: Address; note?: string; marketingConsent?: boolean };

/**
 * Creates an order from a cart atomically: re-quotes against live data,
 * locks variant rows, verifies and decrements stock, consumes the discount
 * and allocates the order number. Online payments reserve stock for
 * RESERVATION_MINUTES; unpaid orders are released afterwards.
 */
export async function placeOrder(projectId: string, cart: CartRow, input: CheckoutInput) {
  const placed = await db.transaction(async (tx) => {
    const variantIds = (cart.items as { variantId: string }[]).map((i) => i.variantId);
    if (!variantIds.length) throw new ApiError("conflict", "Your cart is empty");
    // Lock the variants so concurrent checkouts cannot oversell.
    await tx.select({ id: schema.storeVariants.id }).from(schema.storeVariants).where(and(eq(schema.storeVariants.projectId, projectId), inArray(schema.storeVariants.id, variantIds))).for("update");
    // Lock the gift card too, so two orders cannot spend the same balance.
    if (cart.giftCardCode) await findGiftCard(projectId, cart.giftCardCode, tx, true);
    const q = await quoteCart(projectId, { ...cart, address: input.address }, tx);
    if (q.giftCard && !q.giftCard.ok) throw new ApiError("conflict", q.giftCard.reason ?? "The gift card cannot be used");
    if (q.problems.length) throw new ApiError("conflict", q.problems.join(" "));
    if (!q.lines.length) throw new ApiError("conflict", "Your cart is empty");
    if (q.lines.some((l) => l.isSample)) throw new ApiError("conflict", "This store is still showing sample products, so checkout is not open yet.");
    if (!q.selectedRate) throw new ApiError("conflict", "Choose a delivery option");
    const pay = q.payments.find((p) => p.id === cart.paymentMethod);
    if (!pay) throw new ApiError("conflict", "Choose a payment method");
    if (q.discount && !q.discount.ok) throw new ApiError("conflict", q.discount.reason ?? "The discount code is not valid");

    const [store] = await tx
      .update(schema.stores)
      .set({ nextOrderNumber: sql`${schema.stores.nextOrderNumber} + 1` })
      .where(eq(schema.stores.projectId, projectId))
      .returning();
    const number = store.nextOrderNumber - 1;
    const key = randomToken(18);

    // Customers are unique per store by case-insensitive email.
    const [existingCustomer] = await tx.select().from(schema.storeCustomers).where(and(eq(schema.storeCustomers.projectId, projectId), sql`lower(${schema.storeCustomers.email}) = ${input.email.toLowerCase()}`));
    const customer = existingCustomer
      ? (await tx.update(schema.storeCustomers).set({ name: input.address.name, phone: input.phone, ...(input.marketingConsent ? { acceptsMarketing: true } : {}) }).where(eq(schema.storeCustomers.id, existingCustomer.id)).returning())[0]
      : (await tx.insert(schema.storeCustomers).values({ projectId, email: input.email, name: input.address.name, phone: input.phone, acceptsMarketing: !!input.marketingConsent }).returning())[0];

    const [order] = await tx
      .insert(schema.storeOrders)
      .values({
        projectId,
        number,
        accessKeyHash: sha256(key),
        customerId: customer.id,
        email: input.email,
        phone: input.phone,
        shippingAddress: input.address,
        currency: q.currency,
        exchangeRate: q.exchangeRate,
        baseTotal: q.exchangeRate ? toBaseMinor(q.totals.total, q.store.currency, { code: q.currency, rate: q.exchangeRate, rounding: "none" }) : q.totals.total,
        subtotal: q.totals.subtotal,
        discountTotal: q.totals.discount,
        shippingTotal: q.totals.shipping,
        taxTotal: q.totals.tax,
        feeTotal: q.totals.fee,
        total: q.totals.total,
        taxIncluded: q.totals.taxIncluded,
        discountCode: q.discount?.ok ? q.discount.code : null,
        shippingMethod: { id: q.selectedRate.id, name: q.selectedRate.name, eta: q.selectedRate.eta, pickup: q.selectedRate.kind === "pickup" },
        paymentMethod: pay.id,
        note: (input.note ?? "").slice(0, 1000),
        reservedUntil: pay.online ? new Date(Date.now() + RESERVATION_MINUTES * 60_000) : null,
        whatsappOptIn: cart.whatsappOptIn,
        buyerGstin: cart.buyerGstin,
        buyerBusinessName: cart.buyerBusinessName,
        giftCardTotal: q.giftCard?.applied ?? 0,
        giftCardCode: q.giftCard?.applied ? q.giftCard.code.toUpperCase() : null,
        ...(pay.id === "giftcard" ? { financialStatus: "paid" as const, paidAt: new Date() } : {}),
      })
      .returning();
    if (pay.id === "giftcard") await assignInvoiceNumber(order.id, tx);
    if (q.giftCard?.applied && q.giftCard.id) {
      const spent = await tx
        .update(schema.storeGiftCards)
        .set({ balance: sql`${schema.storeGiftCards.balance} - ${q.giftCard.applied}` })
        .where(and(eq(schema.storeGiftCards.id, q.giftCard.id), sql`${schema.storeGiftCards.balance} >= ${q.giftCard.applied}`))
        .returning({ id: schema.storeGiftCards.id });
      if (!spent.length) throw new ApiError("conflict", "The gift card balance changed. Please try again.");
      await tx.insert(schema.storeGiftCardTxns).values({ giftCardId: q.giftCard.id, orderId: order.id, amount: -q.giftCard.applied, reason: `Order ${orderLabel(store.orderPrefix, number)}` });
    }
    await tx.insert(schema.storeOrderItems).values(
      q.lines.map((l) => ({
        orderId: order.id,
        productId: l.productId,
        variantId: l.variantId,
        title: l.title,
        variantTitle: l.variantTitle,
        sku: l.sku,
        image: l.image,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        quantity: l.quantity,
        taxBps: l.taxBps,
        hsn: l.hsn,
        kind: l.kind,
        total: l.unitPrice * l.quantity,
      })),
    );
    for (const l of q.lines) {
      const [v] = await tx.select({ track: schema.storeVariants.trackInventory }).from(schema.storeVariants).where(eq(schema.storeVariants.id, l.variantId));
      if (v?.track) await adjustStock(projectId, l.variantId, -l.quantity, "Order", null, orderLabel(store.orderPrefix, number), tx);
    }
    if (q.discount?.ok) {
      const code = q.discount.code.toLowerCase();
      const [d] = await tx.select().from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`lower(${schema.storeDiscounts.code}) = ${code}`));
      if (d?.oncePerCustomer) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.storeOrders)
          .where(and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt), sql`lower(${schema.storeOrders.discountCode}) = ${code}`, sql`lower(${schema.storeOrders.email}) = ${input.email.toLowerCase()}`, sql`${schema.storeOrders.id} <> ${order.id}`));
        if (n > 0) throw new ApiError("conflict", "This discount code can only be used once per customer");
      }
      // Conditional increment: concurrent checkouts cannot exceed the usage limit.
      const used = await tx
        .update(schema.storeDiscounts)
        .set({ usedCount: sql`${schema.storeDiscounts.usedCount} + 1` })
        .where(and(eq(schema.storeDiscounts.projectId, projectId), sql`lower(${schema.storeDiscounts.code}) = ${code}`, sql`(${schema.storeDiscounts.usageLimit} is null or ${schema.storeDiscounts.usedCount} < ${schema.storeDiscounts.usageLimit})`))
        .returning({ id: schema.storeDiscounts.id });
      if (!used.length) throw new ApiError("conflict", "This discount code has reached its usage limit");
    }
    await tx.update(schema.storeCarts).set({ orderId: order.id, email: input.email, updatedAt: new Date() }).where(eq(schema.storeCarts.id, cart.id));
    await event(order.id, "placed", `Order placed with ${pay.name}`, { payment: pay.id }, null, tx);
    // Variants this order took to or below the alert level; each alerts once until restocked.
    const lowStock = await tx
      .update(schema.storeVariants)
      .set({ lowStockNotifiedAt: new Date() })
      .where(and(inArray(schema.storeVariants.id, q.lines.map((l) => l.variantId)), eq(schema.storeVariants.trackInventory, true), isNull(schema.storeVariants.lowStockNotifiedAt), sql`${schema.storeVariants.stock} <= ${store.lowStockThreshold}`))
      .returning({ id: schema.storeVariants.id, stock: schema.storeVariants.stock });
    const low = lowStock.map((v) => ({ ...v, title: q.lines.find((l) => l.variantId === v.id)!.title, variant: q.lines.find((l) => l.variantId === v.id)!.variantTitle }));
    return { order, key, store: q.store, online: pay.online, lowStock: low };
  });
  // Paid in full by gift card: grant access / deliver digital items now.
  if (placed.order.paymentMethod === "giftcard") await fulfillNonPhysical(placed.order.id);
  await emitEvent(projectId, "order.placed", orderEventPayload(placed.order, placed.store.orderPrefix));
  return placed;
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function providerCreds(projectId: string, provider: string) {
  const [p] = await db.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.provider, provider)));
  if (!p?.secrets) return null;
  return { creds: JSON.parse(decryptSecret(p.secrets)) as Creds, mode: p.mode, settings: p.settings as Record<string, unknown> };
}

function payOrder(o: OrderRow, storeName: string, prefix: string): PayOrder {
  const addr = o.shippingAddress as Address;
  // Providers charge only what the gift card did not cover.
  return { id: o.id, number: o.number, label: `${storeName} order ${orderLabel(prefix, o.number)}`, total: o.total - o.giftCardTotal, currency: o.currency, email: o.email, phone: o.phone, name: addr.name };
}

/** Starts hosted checkout with the provider and returns the redirect URL. */
export async function startPayment(order: OrderRow, store: { name: string; orderPrefix: string }, key: string, base: string) {
  const p = await providerCreds(order.projectId, order.paymentMethod);
  if (!p) throw new ApiError("provider_not_configured", "This payment method is not available right now.");
  const qs = `order=${order.id}&key=${encodeURIComponent(key)}&base=${encodeURIComponent(base)}`;
  const urls = {
    success: appUrl(`/api/v1/store/${order.projectId}/pay/${order.paymentMethod}/return?${qs}`) + (order.paymentMethod === "stripe" ? "&session_id={CHECKOUT_SESSION_ID}" : ""),
    cancel: appUrl(`/api/v1/store/${order.projectId}/pay/${order.paymentMethod}/cancel?${qs}`),
  };
  const po = payOrder(order, store.name, store.orderPrefix);
  // Subscriptions start a recurring checkout instead of a one-off payment.
  const subscription = (order.paymentMethod === "stripe" || order.paymentMethod === "razorpay") && (await subscriptionTerms(order.id));
  const r = subscription
    ? await startSubscriptionCheckout(order, order.paymentMethod as "stripe" | "razorpay", p.creds, urls, store.name)
    : order.paymentMethod === "stripe"
      ? await stripe.create(p.creds, po, urls)
      : order.paymentMethod === "razorpay"
        ? await razorpay.create(p.creds, po, urls)
        : order.paymentMethod === "paypal"
          ? await paypal.create(p.creds, po, urls, p.mode, store.name)
          : null;
  if (!r) throw new ApiError("bad_request", "Unsupported payment method");
  await db.update(schema.storeOrders).set({ paymentRef: r.ref }).where(eq(schema.storeOrders.id, order.id));
  await event(order.id, "payment_started", `Redirected to ${providerInfo(order.paymentMethod)?.name}`, { ref: r.ref });
  return r.redirectUrl;
}

/** Marks an order paid exactly once (webhooks and returns may both arrive). */
/**
 * Gives a paid order its tax invoice number: consecutive within the store's
 * financial year (INV/2026-27/0001), assigned once.
 */
export async function assignInvoiceNumber(orderId: string, exec: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db) {
  const [o] = await exec.select({ projectId: schema.storeOrders.projectId, invoiceNumber: schema.storeOrders.invoiceNumber, paidAt: schema.storeOrders.paidAt }).from(schema.storeOrders).where(eq(schema.storeOrders.id, orderId));
  if (!o || o.invoiceNumber) return o?.invoiceNumber ?? null;
  const fy = financialYear(o.paidAt ?? new Date());
  const [c] = await exec
    .insert(schema.invoiceCounters)
    .values({ projectId: o.projectId, fy, next: 2 })
    .onConflictDoUpdate({ target: [schema.invoiceCounters.projectId, schema.invoiceCounters.fy], set: { next: sql`${schema.invoiceCounters.next} + 1` } })
    .returning({ next: schema.invoiceCounters.next });
  const number = `INV/${fy}/${String(c.next - 1).padStart(4, "0")}`;
  const [u] = await exec.update(schema.storeOrders).set({ invoiceNumber: number }).where(and(eq(schema.storeOrders.id, orderId), isNull(schema.storeOrders.invoiceNumber))).returning({ n: schema.storeOrders.invoiceNumber });
  return u?.n ?? null;
}

export async function markPaid(orderId: string, source: string, captureRef?: string | null, actorId?: string | null) {
  const [o] = await db
    .update(schema.storeOrders)
    .set({ financialStatus: "paid", paidAt: new Date(), reservedUntil: null, ...(captureRef ? { paymentCaptureRef: captureRef } : {}) })
    .where(and(eq(schema.storeOrders.id, orderId), eq(schema.storeOrders.financialStatus, "pending"), isNull(schema.storeOrders.cancelledAt)))
    .returning();
  if (!o) return false;
  await assignInvoiceNumber(o.id);
  await fulfillNonPhysical(o.id);
  await event(orderId, "paid", `Payment confirmed (${source})`, { captureRef }, actorId);
  await notifyPaid(o).catch((e) => log.warn("order_mail_failed", { error: (e as Error).message }));
  const [store] = await db.select({ prefix: schema.stores.orderPrefix }).from(schema.stores).where(eq(schema.stores.projectId, o.projectId));
  await emitEvent(o.projectId, "order.paid", orderEventPayload(o, store?.prefix ?? ""));
  return true;
}

/** What automations see about an order. Amounts are in major units (e.g. 1499.00). */
function orderEventPayload(o: OrderRow, prefix: string) {
  const addr = (o.shippingAddress ?? {}) as { name?: string; city?: string };
  return {
    id: o.id,
    number: o.number,
    label: orderLabel(prefix, o.number),
    email: o.email,
    customerName: addr.name ?? "",
    city: addr.city ?? "",
    total: (o.total / 100).toFixed(2),
    currency: o.currency,
    paymentMethod: o.paymentMethod,
    financialStatus: o.financialStatus,
  };
}

export async function verifyReturn(projectId: string, provider: ProviderId, order: OrderRow, params: URLSearchParams) {
  if (order.financialStatus !== "pending") return order.financialStatus === "paid";
  const p = await providerCreds(projectId, provider);
  if (!p || !order.paymentRef) return false;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const po = payOrder(order, store.name, store.orderPrefix);
  const ref = provider === "stripe" ? (params.get("session_id") === order.paymentRef ? order.paymentRef : "") : provider === "paypal" ? (params.get("token") === order.paymentRef ? order.paymentRef : "") : order.paymentRef;
  if (!ref) return false;
  const r = provider === "stripe" ? await stripe.verify(p.creds, ref, po) : provider === "razorpay" ? await razorpay.verify(p.creds, ref, po, params) : await paypal.verify(p.creds, ref, po, params, p.mode);
  if (r.paid) await markPaid(order.id, `${providerInfo(provider)?.name} confirmation`, r.captureRef);
  return r.paid;
}

/** Handles a provider webhook: verifies the signature, ignores duplicates, settles the order. */
export async function handleWebhook(projectId: string, provider: ProviderId, raw: string, headers: Headers) {
  const p = await providerCreds(projectId, provider);
  if (!p) throw new ApiError("not_found", "Provider not configured");
  const evt = provider === "stripe" ? stripe.webhook(p.creds, raw, headers) : provider === "razorpay" ? razorpay.webhook(p.creds, raw, headers) : provider === "paypal" ? await paypal.webhook(p.creds, raw, headers, p.mode) : null;
  if (!evt) throw new ApiError("bad_request", "Unsupported provider");
  const fresh = await db.insert(schema.storeWebhookEvents).values({ provider, eventId: evt.eventId, projectId }).onConflictDoNothing().returning();
  if (fresh.length && (provider === "stripe" || provider === "razorpay")) {
    const sub = await handleSubscriptionEvent(projectId, provider, raw);
    if (sub.handled) return { duplicate: false, ...sub.result };
  }
  // A live payment test (signature already verified above).
  if (fresh.length && "ref" in evt && evt.ref && (await recordTestWebhook(projectId, provider, evt))) return { duplicate: false, test: true };
  if (!fresh.length || !("ref" in evt) || !evt.ref || !evt.paid) return { duplicate: !fresh.length };
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.paymentRef, evt.ref)));
  if (!o) {
    // Paid bookings use the same providers and webhooks.
    const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.projectId, projectId), eq(schema.bookings.paymentRef, evt.ref)));
    if (!b) return { duplicate: false, unmatched: true };
    if ("amount" in evt && evt.amount !== undefined && evt.amount < b.amount) return { duplicate: false };
    await markBookingPaid(b.id, evt.captureRef);
    return { duplicate: false };
  }
  if ("amount" in evt && evt.amount !== undefined && evt.amount < o.total - o.giftCardTotal) {
    await event(o.id, "payment_mismatch", "Webhook amount was lower than the order total; not marked paid", { amount: evt.amount });
    return { duplicate: false };
  }
  try {
    await markPaid(o.id, `${providerInfo(provider)?.name} webhook`, evt.captureRef);
  } catch (e) {
    // Forget the event so the provider's retry is processed instead of skipped as a duplicate.
    await db.delete(schema.storeWebhookEvents).where(and(eq(schema.storeWebhookEvents.provider, provider), eq(schema.storeWebhookEvents.eventId, evt.eventId)));
    throw e;
  }
  return { duplicate: false };
}

/** Cancels online-payment orders whose reservation expired, returning stock. */
export async function releaseExpired(projectId: string) {
  const expired = await db
    .select()
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.financialStatus, "pending"), isNull(schema.storeOrders.cancelledAt), lt(schema.storeOrders.reservedUntil, new Date())));
  for (const o of expired) await cancelOrder(o.projectId, o.id, null, "Payment not completed in time");
  return expired.length;
}

// ─── Admin actions ───────────────────────────────────────────────────────────

export async function getOrder(projectId: string, orderId: string) {
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, orderId), eq(schema.storeOrders.projectId, projectId)));
  if (!o) throw notFound("Order");
  const [items, events] = await Promise.all([
    db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id)),
    db
      .select({ id: schema.storeOrderEvents.id, kind: schema.storeOrderEvents.kind, message: schema.storeOrderEvents.message, data: schema.storeOrderEvents.data, createdAt: schema.storeOrderEvents.createdAt, actorName: schema.users.name })
      .from(schema.storeOrderEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.storeOrderEvents.actorId))
      .where(eq(schema.storeOrderEvents.orderId, o.id))
      .orderBy(desc(schema.storeOrderEvents.createdAt)),
  ]);
  return { order: o, items, events };
}

export async function getOrderByKey(projectId: string, number: number, key: string) {
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, number), eq(schema.storeOrders.accessKeyHash, sha256(key))));
  if (!o) return null;
  const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
  return { order: o, items };
}

export async function findOrderForTracking(projectId: string, number: number, email: string) {
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, number), sql`lower(${schema.storeOrders.email}) = ${email.trim().toLowerCase()}`));
  if (!o) return null;
  const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
  return { order: o, items };
}

export type OrderFilter = { q?: string; status?: string; limit?: number; offset?: number };

export async function listOrders(projectId: string, f: OrderFilter) {
  const conds = [eq(schema.storeOrders.projectId, projectId)];
  const s = f.status;
  if (s === "unpaid") conds.push(eq(schema.storeOrders.financialStatus, "pending"), isNull(schema.storeOrders.cancelledAt));
  if (s === "to_fulfill") conds.push(inArray(schema.storeOrders.fulfillmentStatus, ["unfulfilled", "packed"]), isNull(schema.storeOrders.cancelledAt), or(eq(schema.storeOrders.financialStatus, "paid"), eq(schema.storeOrders.paymentMethod, "cod"))!);
  if (s === "shipped") conds.push(eq(schema.storeOrders.fulfillmentStatus, "shipped"));
  if (s === "delivered") conds.push(eq(schema.storeOrders.fulfillmentStatus, "delivered"));
  if (s === "cancelled") conds.push(sql`${schema.storeOrders.cancelledAt} is not null`);
  if (s === "refunded") conds.push(inArray(schema.storeOrders.financialStatus, ["refunded", "partially_refunded"]));
  if (f.q) {
    const n = Number(f.q.replace(/\D/g, ""));
    conds.push(or(ilike(schema.storeOrders.email, contains(f.q)), sql`${schema.storeOrders.shippingAddress}->>'name' ilike ${contains(f.q)}`, ...(n ? [eq(schema.storeOrders.number, n)] : []))!);
  }
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.storeOrders.id,
        number: schema.storeOrders.number,
        email: schema.storeOrders.email,
        name: sql<string>`${schema.storeOrders.shippingAddress}->>'name'`,
        total: schema.storeOrders.total,
        currency: schema.storeOrders.currency,
        paymentMethod: schema.storeOrders.paymentMethod,
        financialStatus: schema.storeOrders.financialStatus,
        fulfillmentStatus: schema.storeOrders.fulfillmentStatus,
        cancelledAt: schema.storeOrders.cancelledAt,
        createdAt: schema.storeOrders.createdAt,
        items: sql<number>`(select coalesce(sum(quantity),0)::int from store_order_items i where i.order_id = ${sql.raw('"store_orders"."id"')})`,
      })
      .from(schema.storeOrders)
      .where(where)
      .orderBy(desc(schema.storeOrders.createdAt))
      .limit(Math.min(f.limit ?? 50, 200))
      .offset(f.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.storeOrders).where(where),
  ]);
  return { orders: rows, total };
}

export async function manualMarkPaid(projectId: string, orderId: string, actorId: string) {
  const { order } = await getOrder(projectId, orderId);
  if (order.cancelledAt) throw new ApiError("conflict", "Cancelled orders cannot be marked paid");
  if (order.financialStatus !== "pending") throw new ApiError("conflict", "This order is already paid");
  await markPaid(order.id, "marked paid by staff", null, actorId);
}

export async function updateFulfillment(projectId: string, orderId: string, actorId: string | null, input: { status: "packed" | "shipped" | "delivered"; carrier?: string; trackingNumber?: string; trackingUrl?: string; notify?: boolean }) {
  const { order } = await getOrder(projectId, orderId);
  if (order.cancelledAt) throw new ApiError("conflict", "This order is cancelled");
  const carrier = CARRIERS.find((c) => c.id === input.carrier);
  const tracking = input.status === "shipped" && input.trackingNumber ? { carrier: carrier?.name ?? input.carrier ?? "", number: input.trackingNumber, url: input.trackingUrl ?? carrier?.url(input.trackingNumber) ?? "" } : (order.tracking as object | null);
  const [o] = await db
    .update(schema.storeOrders)
    .set({ fulfillmentStatus: input.status, tracking, ...(input.status === "shipped" || input.status === "delivered" ? { fulfilledAt: order.fulfilledAt ?? new Date() } : {}) })
    .where(eq(schema.storeOrders.id, order.id))
    .returning();
  const label = { packed: "Marked as packed", shipped: `Shipped${tracking ? ` with ${(tracking as { carrier: string }).carrier} · ${(tracking as { number: string }).number}` : ""}`, delivered: "Marked as delivered" }[input.status];
  await event(order.id, input.status, label, tracking, actorId);
  if (input.status === "delivered" && order.paymentMethod === "cod" && order.financialStatus === "pending") await markPaid(order.id, "cash collected on delivery", null, actorId);
  if (input.notify !== false && input.status !== "packed") await notifyFulfillment(o).catch(() => {});
  if (input.status === "shipped") {
    const [store] = await db.select({ prefix: schema.stores.orderPrefix }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
    const t = (tracking ?? {}) as { carrier?: string; number?: string; url?: string };
    await emitEvent(projectId, "order.shipped", { ...orderEventPayload(o, store?.prefix ?? ""), carrier: t.carrier ?? "", trackingNumber: t.number ?? "", trackingUrl: t.url ?? "" });
  }
}

export async function cancelOrder(projectId: string, orderId: string, actorId: string | null, reason: string, opts: { restock?: boolean } = {}) {
  const { order, items } = await getOrder(projectId, orderId);
  if (order.cancelledAt) throw new ApiError("conflict", "This order is already cancelled");
  if (order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "delivered") throw new ApiError("conflict", "Shipped orders cannot be cancelled; refund or record a return instead");
  await db.transaction(async (tx) => {
    const [o] = await tx
      .update(schema.storeOrders)
      .set({ cancelledAt: new Date(), cancelReason: reason, reservedUntil: null, financialStatus: order.financialStatus === "pending" ? "voided" : order.financialStatus, stockReleased: opts.restock !== false })
      .where(and(eq(schema.storeOrders.id, order.id), isNull(schema.storeOrders.cancelledAt)))
      .returning();
    if (!o) throw new ApiError("conflict", "This order is already cancelled");
    if (opts.restock !== false) {
      for (const i of items) {
        if (!i.variantId) continue;
        const [v] = await tx.select({ track: schema.storeVariants.trackInventory }).from(schema.storeVariants).where(eq(schema.storeVariants.id, i.variantId));
        if (v?.track) await adjustStock(projectId, i.variantId, i.quantity, "Order cancelled", actorId, `#${order.number}`, tx);
      }
    }
    // The gift card share goes straight back to the card.
    const cardBack = order.giftCardTotal - (await giftCardRefunded(order.id, tx));
    if (cardBack > 0 && order.giftCardCode) {
      const card = await findGiftCard(projectId, order.giftCardCode, tx, true);
      if (card) {
        await creditGiftCard(card.id, order.id, cardBack, `Order ${orderLabel("#", order.number)} cancelled`, tx);
        const refunded = order.refundedTotal + cardBack;
        await tx
          .update(schema.storeOrders)
          .set({ refundedTotal: refunded, ...(order.financialStatus === "paid" || order.financialStatus === "partially_refunded" ? { financialStatus: refunded >= order.total ? ("refunded" as const) : ("partially_refunded" as const) } : {}) })
          .where(eq(schema.storeOrders.id, order.id));
        await event(order.id, "refunded", `${formatMoney(cardBack, order.currency)} returned to gift card ${order.giftCardCode}`, { amount: cardBack, giftCard: true }, actorId, tx);
      }
    }
    await event(order.id, "cancelled", `Cancelled: ${reason}`, null, actorId, tx);
  });
  if (order.financialStatus === "paid") {
    await event(order.id, "note", "This order was paid. Issue a refund to return the money to the customer.", null, null);
  }
  const [store] = await db.select({ prefix: schema.stores.orderPrefix }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  await emitEvent(projectId, "order.cancelled", { ...orderEventPayload(order, store?.prefix ?? ""), reason });
}

/**
 * Refunds the payment method first (through the provider when it is online,
 * otherwise recorded for the owner to pay back), then credits any remainder
 * to the gift card used on the order.
 */
export async function refundOrder(projectId: string, orderId: string, actorId: string, amount: number, reason: string, restockItems: boolean) {
  const { order, items } = await getOrder(projectId, orderId);
  if (!["paid", "partially_refunded"].includes(order.financialStatus)) throw new ApiError("conflict", "Only paid orders can be refunded");
  const remaining = order.total - order.refundedTotal;
  if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) throw new ApiError("validation_failed", `Refund between 1 and ${formatMoney(remaining, order.currency)}`, { amount: ["Out of range"] });
  const cardRefunded = await giftCardRefunded(order.id);
  const paidByMethod = order.total - order.giftCardTotal;
  const methodRefunded = order.refundedTotal - cardRefunded;
  const methodPart = Math.min(amount, Math.max(0, paidByMethod - methodRefunded));
  const cardPart = amount - methodPart;
  let ref: string | null = null;
  const online = ["stripe", "razorpay", "paypal"].includes(order.paymentMethod);
  if (online && methodPart > 0) {
    const p = await providerCreds(projectId, order.paymentMethod);
    if (!p || !order.paymentCaptureRef) throw new ApiError("provider_not_configured", "The payment provider is not connected, so the refund cannot be sent automatically.");
    ref =
      order.paymentMethod === "stripe"
        ? await stripe.refund(p.creds, order.paymentCaptureRef, methodPart)
        : order.paymentMethod === "razorpay"
          ? await razorpay.refund(p.creds, order.paymentCaptureRef, methodPart)
          : await paypal.refund(p.creds, order.paymentCaptureRef, methodPart, order.currency, p.mode);
  }
  await db.transaction(async (tx) => {
    if (cardPart > 0) {
      const card = order.giftCardCode ? await findGiftCard(projectId, order.giftCardCode, tx, true) : null;
      if (!card) throw new ApiError("conflict", "The gift card used on this order no longer exists");
      await creditGiftCard(card.id, order.id, cardPart, `Refund on order ${orderLabel("#", order.number)}`, tx);
    }
    const refunded = order.refundedTotal + amount;
    await tx
      .update(schema.storeOrders)
      .set({ refundedTotal: refunded, financialStatus: refunded >= order.total ? "refunded" : "partially_refunded" })
      .where(eq(schema.storeOrders.id, order.id));
  });
  if (restockItems && !order.stockReleased) {
    for (const i of items) if (i.variantId) await adjustStock(projectId, i.variantId, i.quantity, "Refund restock", actorId, `#${order.number}`);
    await db.update(schema.storeOrders).set({ stockReleased: true }).where(eq(schema.storeOrders.id, order.id));
  }
  const parts = [
    methodPart > 0 ? `${online ? "Refunded" : "Recorded a refund of"} ${formatMoney(methodPart, order.currency)}${online ? "" : " (send the money to the customer yourself)"}` : "",
    cardPart > 0 ? `${formatMoney(cardPart, order.currency)} returned to gift card ${order.giftCardCode}` : "",
  ].filter(Boolean);
  await event(order.id, "refunded", `${parts.join("; ")}${reason ? ` — ${reason}` : ""}`, { amount, methodPart, cardPart, ref }, actorId);
  await audit({ actorId, action: "store.order_refunded", targetType: "order", targetId: order.id, metadata: { amount } });
}

export async function addOrderNote(projectId: string, orderId: string, actorId: string, note: string) {
  const { order } = await getOrder(projectId, orderId);
  await event(order.id, "note", note.slice(0, 2000), null, actorId);
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function storeFor(o: OrderRow) {
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, o.projectId));
  return s;
}

function itemsText(items: { title: string; variantTitle: string; quantity: number; total: number }[], currency: string) {
  return items.map((i) => `  ${i.quantity} × ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""} — ${formatMoney(i.total, currency)}`).join("\n");
}

export async function notifyLowStock(projectId: string, items: { title: string; variant: string; stock: number }[]) {
  if (!items.length) return;
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const lines = items.map((i) => `  ${i.title}${i.variant && i.variant !== "Default" ? ` (${i.variant})` : ""}: ${i.stock <= 0 ? "OUT OF STOCK" : `${i.stock} left`}`).join("\n");
  for (const to of new Set([s.email, ...s.notifyEmails].filter(Boolean))) {
    await sendMail({ to, subject: `${s.name}: ${items.length === 1 ? `${items[0].title} is` : `${items.length} items are`} running low`, body: `These items are at or below your low-stock level (${s.lowStockThreshold}):\n\n${lines}\n\nRestock them from Inventory in your store dashboard.` });
  }
}

export async function notifyPlaced(o: OrderRow, key: string, base: string) {
  const s = await storeFor(o);
  const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
  const link = appUrl(`${base}/order/${o.number}?key=${encodeURIComponent(key)}`);
  await notifyOrderWhatsApp(o, "order_confirmation", link);
  await sendMail({
    fromName: s.name,
    replyTo: s.email || undefined,
    to: o.email,
    subject: `${s.name}: order ${orderLabel(s.orderPrefix, o.number)} received`,
    body: `Thank you for your order!\n\n${itemsText(items, o.currency)}\n\nTotal: ${formatMoney(o.total, o.currency)}\nPayment: ${o.paymentMethod === "cod" ? "Cash on delivery" : o.paymentMethod === "manual" ? "UPI / bank transfer (details on your order page)" : "Online"}\n\nView your order: ${link}\n\n${s.name}`,
  });
  const owners = [s.email, ...s.notifyEmails].filter(Boolean);
  for (const to of new Set(owners)) {
    await sendMail({ to, subject: `New order ${orderLabel(s.orderPrefix, o.number)} — ${formatMoney(o.total, o.currency)}`, body: `${(o.shippingAddress as Address).name} (${o.email}) placed an order.\n\n${itemsText(items, o.currency)}\n\nTotal: ${formatMoney(o.total, o.currency)}\nPayment: ${o.paymentMethod}\n\nManage it in your store dashboard.` });
  }
}

async function notifyPaid(o: OrderRow) {
  const s = await storeFor(o);
  if (o.paymentMethod === "cod") return;
  await sendMail({ fromName: s.name, replyTo: s.email || undefined, to: o.email, subject: `${s.name}: payment received for ${orderLabel(s.orderPrefix, o.number)}`, body: `We have received your payment of ${formatMoney(o.total, o.currency)}. We will let you know when your order ships.\n\n${s.name}` });
}

async function notifyFulfillment(o: OrderRow) {
  const s = await storeFor(o);
  const t = o.tracking as { carrier: string; number: string; url: string } | null;
  const shipped = o.fulfillmentStatus === "shipped";
  await notifyOrderWhatsApp(o, shipped ? "order_shipped" : "order_delivered");
  await sendMail({
    fromName: s.name,
    replyTo: s.email || undefined,
    to: o.email,
    subject: `${s.name}: order ${orderLabel(s.orderPrefix, o.number)} ${shipped ? "has shipped" : "was delivered"}`,
    body: shipped ? `Good news — your order is on its way.${t ? `\n\nCarrier: ${t.carrier}\nTracking number: ${t.number}${t.url ? `\nTrack it: ${t.url}` : ""}` : ""}\n\n${s.name}` : `Your order has been delivered. We hope you love it!\n\n${s.name}`,
  });
}

// ─── Abandoned checkouts ─────────────────────────────────────────────────────

export async function abandonedCarts(projectId: string) {
  const cutoff = new Date(Date.now() - 60 * 60_000);
  const since = new Date(Date.now() - 30 * 86400_000);
  const carts = await db
    .select()
    .from(schema.storeCarts)
    .where(and(eq(schema.storeCarts.projectId, projectId), isNull(schema.storeCarts.orderId), lt(schema.storeCarts.updatedAt, cutoff), gte(schema.storeCarts.updatedAt, since), sql`${schema.storeCarts.email} <> ''`, sql`jsonb_array_length(${schema.storeCarts.items}) > 0`))
    .orderBy(desc(schema.storeCarts.updatedAt))
    .limit(200);
  const out = [];
  for (const c of carts) {
    const q = await quoteCart(projectId, c);
    out.push({ id: c.id, email: c.email, consent: c.marketingConsent, whatsapp: c.marketingConsent && c.whatsappOptIn && !!(c.address as { phone?: string } | null)?.phone, whatsappRemindedAt: c.whatsappRemindedAt, updatedAt: c.updatedAt, recoveryEmailedAt: c.recoveryEmailedAt, items: q.lines.map((l) => ({ title: l.title, quantity: l.quantity })), value: q.totals.subtotal, currency: q.store.currency });
  }
  return out;
}
