import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkDiscount } from "@/lib/store/discounts";
import { convertMinor, presentment, type StoreCurrency } from "@/lib/store/fx";
import { computeTotals, type Totals } from "@/lib/store/pricing";
import { checkGiftCard, findGiftCard, type GiftCardRow } from "./giftcards";
import { availableRates, type Address, type Rate, type Zone } from "@/lib/store/shipping";
import { randomToken, sha256 } from "../security/tokens";
import { getStore, type Exec, type StoreRow } from "./catalog";

export const cartCookieName = (projectId: string) => `cc_cart_${projectId.replace(/-/g, "").slice(0, 12)}`;
export const MAX_LINE_QTY = 99;

export type CartItem = { variantId: string; qty: number };
export type CartRow = typeof schema.storeCarts.$inferSelect;

export async function findCart(projectId: string, token: string | undefined | null): Promise<CartRow | null> {
  if (!token) return null;
  const [c] = await db.select().from(schema.storeCarts).where(and(eq(schema.storeCarts.projectId, projectId), eq(schema.storeCarts.tokenHash, sha256(token))));
  if (!c || c.orderId) return null;
  return c;
}

export async function createCart(projectId: string) {
  const token = randomToken(24);
  const [c] = await db.insert(schema.storeCarts).values({ projectId, tokenHash: sha256(token) }).returning();
  return { cart: c, token };
}

export async function saveCart(cartId: string, patch: Partial<typeof schema.storeCarts.$inferInsert>) {
  await db.update(schema.storeCarts).set({ ...patch, updatedAt: new Date() }).where(eq(schema.storeCarts.id, cartId));
}

export type QuoteLine = {
  key: string;
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  slug: string;
  sku: string;
  image: string;
  unitPrice: number;
  compareAt: number | null;
  unitCost: number | null;
  quantity: number;
  taxBps: number;
  weightGrams: number;
  available: number;
  isSample: boolean;
  hsn: string;
  kind: string;
  /** Set for subscription products. */
  subscription: { interval: string; count: number } | null;
};

export type PaymentOption = { id: string; name: string; description: string; online: boolean; fee: number };

export type Quote = {
  store: StoreRow;
  lines: QuoteLine[];
  problems: string[];
  totals: Totals;
  rates: (Rate & { price: number })[];
  selectedRate: (Rate & { price: number }) | null;
  payments: PaymentOption[];
  discount: { code: string; ok: boolean; reason?: string } | null;
  /** Gift card applied to this order; `applied` is taken off the amount the payment method charges. */
  giftCard: { code: string; ok: boolean; reason?: string; applied: number; balance: number; id?: string } | null;
  /** What the customer still pays after any gift card. */
  amountDue: number;
  zone: Zone | null;
  /** The currency every amount in this quote is in (the shopper's choice or the store's base). */
  currency: string;
  /** Set when that differs from the base currency: 1 base unit = rate units. */
  exchangeRate: string | null;
};

/** Tax rate for a destination: explicit rate row, else the default for domestic orders, else zero. */
export async function destinationTaxBps(store: StoreRow, addr: Pick<Address, "country" | "region"> | null, exec: Exec = db) {
  if (!addr) return store.defaultTaxBps;
  const rows = await exec.select().from(schema.storeTaxRates).where(and(eq(schema.storeTaxRates.projectId, store.projectId), eq(schema.storeTaxRates.country, addr.country.toUpperCase())));
  const exact = rows.find((r) => r.region && r.region.toLowerCase() === addr.region.toLowerCase());
  const country = rows.find((r) => !r.region);
  if (exact) return exact.rateBps;
  if (country) return country.rateBps;
  return addr.country.toUpperCase() === store.country.toUpperCase() ? store.defaultTaxBps : 0;
}

export async function shippingSetup(projectId: string, exec: Exec = db) {
  const [zones, rates] = await Promise.all([
    exec.select().from(schema.storeShippingZones).where(eq(schema.storeShippingZones.projectId, projectId)).orderBy(asc(schema.storeShippingZones.sort)),
    exec.select().from(schema.storeShippingRates).where(eq(schema.storeShippingRates.projectId, projectId)).orderBy(asc(schema.storeShippingRates.sort)),
  ]);
  return { zones: zones as Zone[], rates: rates.map((r) => ({ ...r, weightTiers: r.weightTiers as Rate["weightTiers"] })) as Rate[] };
}

const PAYPAL_CURRENCIES = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "JPY", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "HKD", "MXN", "INR"]);

/** Resolves a cart against live catalog data and computes everything checkout needs. */
/** The delivery "rate" for orders with nothing to ship. */
const NO_DELIVERY = { id: "digital", zoneId: "", name: "No delivery needed — instant access", kind: "pickup" as const, amount: 0, freeOver: null, weightTiers: [], eta: "", codAllowed: false, sort: 0, price: 0 };

export async function quoteCart(projectId: string, cart: Pick<CartRow, "items" | "address" | "shippingRateId" | "paymentMethod" | "discountCode"> & { giftCardCode?: string | null; currency?: string | null }, exec: Exec = db): Promise<Quote> {
  const store = await getStore(projectId, exec);
  if (!store) throw new Error("Store not set up");
  // Another currency: prices are converted at the store's own rates; eligibility
  // checks (discount minimums, free-shipping thresholds) stay in the base currency.
  const cur = presentment(store.currency, (store.currencies as StoreCurrency[]) ?? [], cart.currency);
  const conv = (n: number, price = false) => (cur ? convertMinor(n, store.currency, cur, { price }) : n);
  const items = (cart.items as CartItem[]) ?? [];
  const problems: string[] = [];
  const variantIds = items.map((i) => i.variantId);
  const rows = variantIds.length
    ? await exec
        .select({ v: schema.storeVariants, p: schema.storeProducts })
        .from(schema.storeVariants)
        .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
        .where(and(eq(schema.storeVariants.projectId, projectId), inArray(schema.storeVariants.id, variantIds)))
    : [];
  const addr = (cart.address as Address | null) ?? null;
  const destBps = await destinationTaxBps(store, addr, exec);
  const domestic = !addr || addr.country.toUpperCase() === store.country.toUpperCase();
  const lines: QuoteLine[] = [];
  for (const it of items) {
    const r = rows.find((x) => x.v.id === it.variantId);
    if (!r || r.p.status !== "active") {
      problems.push("An item in your cart is no longer available and was removed.");
      continue;
    }
    const available = r.v.trackInventory ? Math.max(0, r.v.stock) : MAX_LINE_QTY;
    let qty = Math.min(Math.max(1, Math.floor(it.qty)), MAX_LINE_QTY);
    if (qty > available) {
      if (available === 0) {
        problems.push(`${r.p.title} is sold out and was removed.`);
        continue;
      }
      problems.push(`Only ${available} of ${r.p.title} available; quantity adjusted.`);
      qty = available;
    }
    const images = r.p.images as string[];
    lines.push({
      key: r.v.id,
      variantId: r.v.id,
      productId: r.p.id,
      title: r.p.title,
      variantTitle: r.v.title === "Default" ? "" : r.v.title,
      slug: r.p.slug,
      sku: r.v.sku,
      image: images[0] ?? "",
      unitPrice: conv(r.v.price, true),
      compareAt: r.v.compareAt === null ? null : conv(r.v.compareAt, true),
      unitCost: r.v.cost === null ? null : conv(r.v.cost),
      quantity: qty,
      taxBps: domestic ? (r.p.taxBps ?? destBps) : destBps,
      weightGrams: r.v.weightGrams,
      available,
      isSample: r.p.isSample,
      hsn: r.p.hsn,
      kind: r.p.kind,
      subscription: r.p.subscriptionInterval ? { interval: r.p.subscriptionInterval, count: r.p.subscriptionIntervalCount } : null,
    });
  }
  // A subscription is checked out on its own, without codes or gift cards.
  const isSubscription = lines.some((l) => l.subscription);
  if (isSubscription && lines.length > 1) problems.push("A subscription is checked out on its own. Remove the other items, or buy them in a separate order.");
  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const baseSubtotal = cur ? lines.reduce((a, l) => a + (rows.find((x) => x.v.id === l.variantId)?.v.price ?? 0) * l.quantity, 0) : subtotal;
  const weight = lines.reduce((a, l) => a + l.weightGrams * l.quantity, 0);

  let discountRule = null;
  let discount: Quote["discount"] = null;
  if (cart.discountCode && isSubscription) {
    discount = { code: cart.discountCode, ok: false, reason: "Discount codes can't be used on subscriptions." };
  } else if (cart.discountCode) {
    const [d] = await exec.select().from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`lower(${schema.storeDiscounts.code}) = ${cart.discountCode.toLowerCase()}`));
    const check = checkDiscount(d ?? null, baseSubtotal);
    discount = { code: cart.discountCode, ok: check.ok, reason: check.ok ? undefined : check.reason };
    if (check.ok && d) discountRule = { kind: d.kind, value: d.kind === "fixed" ? conv(d.value) : d.value, minSubtotal: Math.min(conv(d.minSubtotal), subtotal), code: d.code };
  }

  const { zones, rates: allRates } = await shippingSetup(projectId, exec);
  // Orders of only digital products and memberships need no delivery.
  const requiresShipping = lines.length === 0 || lines.some((l) => l.kind === "physical");
  const shipBase = !requiresShipping ? { zone: null, rates: [NO_DELIVERY] } : addr ? availableRates(zones, allRates, addr, baseSubtotal, weight) : { zone: null, rates: [] };
  const ship = { zone: shipBase.zone, rates: shipBase.rates.map((r) => ({ ...r, price: conv(r.price) })) };
  const selectedRate = !requiresShipping ? NO_DELIVERY : (ship.rates.find((r) => r.id === cart.shippingRateId) ?? null);

  const providers = await exec.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.enabled, true)));
  const pre = computeTotals({ lines, discount: discountRule, shipping: selectedRate?.price ?? 0, pricesIncludeTax: store.pricesIncludeTax, shippingTaxBps: domestic ? destBps : 0 });
  let card: GiftCardRow | null = null;
  let giftCard: Quote["giftCard"] = null;
  if (cart.giftCardCode && isSubscription) {
    giftCard = { code: cart.giftCardCode, ok: false, reason: "Gift cards can't pay for subscriptions.", applied: 0, balance: 0 };
  } else if (cart.giftCardCode && cur) {
    giftCard = { code: cart.giftCardCode, ok: false, reason: `Gift cards can be used when paying in ${store.currency}.`, applied: 0, balance: 0 };
  } else if (cart.giftCardCode) {
    const check = checkGiftCard(await findGiftCard(projectId, cart.giftCardCode, exec), store.currency);
    if (check.ok) card = check.card;
    giftCard = { code: cart.giftCardCode, ok: check.ok, reason: check.ok ? undefined : check.reason, applied: 0, balance: check.ok ? check.card.balance : 0, id: check.ok ? check.card.id : undefined };
  }
  const coversAll = !!card && lines.length > 0 && card.balance >= pre.total;
  const payments: PaymentOption[] = [];
  // A gift card that covers the whole order is the only payment needed.
  if (coversAll) payments.push({ id: "giftcard", name: "Gift card", description: "Your gift card covers this order.", online: false, fee: 0 });
  for (const p of coversAll ? [] : providers.filter((x) => !isSubscription || ["stripe", "razorpay"].includes(x.provider))) {
    const s = p.settings as { fee?: number; maxOrder?: number; instructions?: string; label?: string };
    if (p.provider === "cod") {
      // Cash and bank transfers are settled in the store's own currency.
      if (!requiresShipping || cur) continue;
      if (selectedRate && !selectedRate.codAllowed) continue;
      if (s.maxOrder && pre.total > s.maxOrder) continue;
      payments.push({ id: "cod", name: "Cash on delivery", description: s.fee ? "Pay when your order arrives (small handling fee)." : "Pay when your order arrives.", online: false, fee: s.fee ?? 0 });
    } else if (p.provider === "manual") {
      if (cur) continue;
      payments.push({ id: "manual", name: s.label || "UPI / bank transfer", description: "Pay using the details shown after you place your order.", online: false, fee: 0 });
    } else if (p.status === "connected") {
      if (p.provider === "paypal" && !PAYPAL_CURRENCIES.has(cur?.code ?? store.currency)) continue;
      const desc = { stripe: "Cards, Apple Pay and Google Pay — secured by Stripe.", razorpay: "UPI, cards, netbanking and wallets — secured by Razorpay.", paypal: "Pay with PayPal or a card." }[p.provider] ?? "";
      payments.push({ id: p.provider, name: { stripe: "Card", razorpay: "UPI, cards & netbanking", paypal: "PayPal" }[p.provider] ?? p.provider, description: desc, online: true, fee: 0 });
    }
  }
  const order = ["razorpay", "stripe", "paypal", "manual", "cod"];
  payments.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const fee = payments.find((p) => p.id === cart.paymentMethod)?.fee ?? 0;
  const totals = computeTotals({ lines, discount: discountRule, shipping: selectedRate?.price ?? 0, fee, pricesIncludeTax: store.pricesIncludeTax, shippingTaxBps: domestic ? destBps : 0 });
  if (giftCard && card) giftCard.applied = Math.min(card.balance, totals.total);
  return { store, lines, problems, totals, rates: ship.rates, selectedRate, payments, discount, giftCard, amountDue: totals.total - (giftCard?.applied ?? 0), zone: ship.zone, currency: cur?.code ?? store.currency, exchangeRate: cur?.rate ?? null };
}
