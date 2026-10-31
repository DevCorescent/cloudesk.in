// Point of sale: selling in the shop. Sales become ordinary paid, delivered
// orders (channel "pos") so stock, invoices, GST reports, refunds, customers
// and automations all work exactly as they do for online orders.
import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isValidEan13, normaliseGtin, storeEan13 } from "@/lib/store/barcode";
import { computeTotals, type DiscountRule } from "@/lib/store/pricing";
import { emitEvent } from "../events/bus";
import { ApiError, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { adjustStock, getStore, loadProducts } from "./catalog";
import { assignInvoiceNumber, orderLabel } from "./orders";

export const POS_METHODS = ["cash", "upi", "card"] as const;
export type PosMethod = (typeof POS_METHODS)[number];

export const posSaleSchema = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1).max(10_000),
        /** Price override (managers only); defaults to the variant's price. */
        unitPrice: z.number().int().min(0).max(1_000_000_000).optional(),
      }),
    )
    .min(1)
    .max(300),
  discount: z.object({ kind: z.enum(["percent", "fixed"]), value: z.number().min(0).max(1_000_000_000) }).nullable().default(null),
  customer: z.object({ name: z.string().trim().max(120).default(""), phone: z.string().trim().max(30).default(""), email: z.union([z.email().max(200), z.literal("")]).default("") }).default({ name: "", phone: "", email: "" }),
  payment: z.object({ method: z.enum(POS_METHODS), tendered: z.number().int().min(0).max(1_000_000_000).optional(), reference: z.string().trim().max(80).default("") }),
  buyerGstin: z.string().trim().toUpperCase().max(15).default(""),
  note: z.string().trim().max(500).default(""),
  /** The cashier confirmed selling items the system shows as out of stock. */
  allowOversell: z.boolean().default(false),
  /** Sent by the till so a retried request can't charge twice. */
  clientRef: z.string().trim().min(8).max(64),
});
export type PosSaleInput = z.infer<typeof posSaleSchema>;

/** Everything the till needs: sellable products with stock, price, barcode and tax. Samples and archived items are left out. */
export async function posCatalog(projectId: string) {
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const products = (await loadProducts(projectId)).filter((p) => p.status !== "archived" && !p.isSample && p.kind === "physical");
  // The UPI ID from "UPI / bank transfer" payments, for the till's pay-by-UPI QR.
  const [manual] = await db.select({ enabled: schema.storePaymentProviders.enabled, settings: schema.storePaymentProviders.settings }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.provider, "manual")));
  const upiId = ((manual?.settings ?? {}) as { upiId?: string }).upiId?.trim() ?? "";
  return {
    store: { name: store.name, currency: store.currency, pricesIncludeTax: store.pricesIncludeTax, defaultTaxBps: store.defaultTaxBps, orderPrefix: store.orderPrefix, upiId },
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status,
      image: (p.images as string[])[0] ?? "",
      taxBps: p.taxBps ?? store.defaultTaxBps,
      variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, barcode: v.barcode, price: v.price, compareAt: v.compareAt, stock: v.stock, trackInventory: v.trackInventory })),
    })),
  };
}

/** Resolves a scanned code: a barcode, a SKU, or a product QR (its page URL, with ?v=variant). */
export async function lookupCode(projectId: string, raw: string) {
  const code = raw.trim();
  if (!code) return null;
  let variantId: string | null = null;
  let slug: string | null = null;
  const url = /^https?:\/\//i.test(code) ? safeUrl(code) : null;
  if (url) {
    variantId = url.searchParams.get("v");
    slug = /\/product\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  }
  const base = and(eq(schema.storeVariants.projectId, projectId), ne(schema.storeProducts.status, "archived"));
  const conds = variantId && /^[0-9a-f-]{36}$/i.test(variantId)
    ? eq(schema.storeVariants.id, variantId)
    : slug
      ? eq(schema.storeProducts.slug, decodeURIComponent(slug))
      : or(eq(schema.storeVariants.barcode, normaliseGtin(code)), eq(schema.storeVariants.barcode, code), sql`lower(${schema.storeVariants.sku}) = ${code.toLowerCase()}`);
  const rows = await db
    .select({ variantId: schema.storeVariants.id, productId: schema.storeProducts.id })
    .from(schema.storeVariants)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
    .where(and(base, conds))
    .orderBy(schema.storeVariants.position)
    .limit(slug && !variantId ? 50 : 2);
  if (!rows.length) return null;
  // A product QR without a variant: the till asks which one if there are several.
  return { variantId: rows.length === 1 || variantId || !slug ? rows[0].variantId : null, productId: rows[0].productId, ambiguous: !!slug && !variantId && rows.length > 1 };
}

function safeUrl(s: string) {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

const storeNumber = (projectId: string) => parseInt(sha256(projectId).slice(0, 8), 16) % 10000;

/** Gives every variant without a barcode an in-store EAN-13 (prefix 20, GS1's in-store range). */
export async function assignBarcodes(projectId: string, productIds?: string[]) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`barcodes:${projectId}`}))`);
    const sn = storeNumber(projectId);
    const prefix = `20${String(sn).padStart(4, "0")}`;
    const used = await tx.select({ barcode: schema.storeVariants.barcode }).from(schema.storeVariants).where(and(eq(schema.storeVariants.projectId, projectId), sql`${schema.storeVariants.barcode} like ${prefix + "%"}`));
    let next = Math.max(0, ...used.map((u) => Number(u.barcode.slice(6, 12)) || 0)) + 1;
    const missing = await tx
      .select({ id: schema.storeVariants.id })
      .from(schema.storeVariants)
      .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
      .where(and(eq(schema.storeVariants.projectId, projectId), eq(schema.storeVariants.barcode, ""), eq(schema.storeProducts.isSample, false), productIds?.length ? inArray(schema.storeVariants.productId, productIds) : undefined))
      .orderBy(schema.storeProducts.createdAt, schema.storeVariants.position);
    for (const v of missing) {
      await tx.update(schema.storeVariants).set({ barcode: storeEan13(sn, next++) }).where(eq(schema.storeVariants.id, v.id));
    }
    return { assigned: missing.length };
  });
}

/** Records a counter sale: checks stock, takes payment details, and creates a paid, handed-over order. */
export async function posSale(projectId: string, staff: { id: string; name: string }, input: PosSaleInput) {
  // The same till request (e.g. after a network retry) returns the first sale.
  const [dup] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.channel, "pos"), sql`${schema.storeOrders.pos}->>'clientRef' = ${input.clientRef}`));
  if (dup) return { order: dup, duplicate: true, change: Number((dup.pos as { change?: number }).change ?? 0) };

  const result = await db.transaction(async (tx) => {
    const ids = [...new Set(input.lines.map((l) => l.variantId))];
    const variants = await tx
      .select({ v: schema.storeVariants, p: schema.storeProducts })
      .from(schema.storeVariants)
      .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
      .where(and(eq(schema.storeVariants.projectId, projectId), inArray(schema.storeVariants.id, ids)))
      .for("update", { of: schema.storeVariants });
    if (variants.length !== ids.length) throw new ApiError("conflict", "An item in this sale no longer exists. Remove it and scan again.");
    const [store] = await tx.update(schema.stores).set({ nextOrderNumber: sql`${schema.stores.nextOrderNumber} + 1` }).where(eq(schema.stores.projectId, projectId)).returning();
    if (!store) throw notFound("Store");
    const number = store.nextOrderNumber - 1;
    const label = orderLabel(store.orderPrefix, number);

    // Merge repeated scans of the same item.
    const merged = new Map<string, { variantId: string; quantity: number; unitPrice?: number }>();
    for (const l of input.lines) {
      const key = `${l.variantId}:${l.unitPrice ?? ""}`;
      const cur = merged.get(key);
      merged.set(key, cur ? { ...cur, quantity: cur.quantity + l.quantity } : { ...l });
    }
    const lines = [...merged.values()].map((l, i) => {
      const row = variants.find((x) => x.v.id === l.variantId)!;
      if (row.p.isSample) throw new ApiError("conflict", `“${row.p.title}” is a sample product and can't be sold`);
      if (row.p.status === "archived") throw new ApiError("conflict", `“${row.p.title}” is archived`);
      return { key: String(i), row, quantity: l.quantity, unitPrice: l.unitPrice ?? row.v.price, taxBps: row.p.taxBps ?? store.defaultTaxBps, weightGrams: 0 };
    });
    const short = lines.filter((l) => l.row.v.trackInventory && l.row.v.stock < lines.filter((x) => x.row.v.id === l.row.v.id).reduce((n, x) => n + x.quantity, 0));
    if (short.length && !input.allowOversell) {
      throw new ApiError("conflict", `Not enough stock: ${short.map((l) => `${l.row.p.title}${l.row.v.title !== "Default" ? ` (${l.row.v.title})` : ""} has ${Math.max(0, l.row.v.stock)}`).join(", ")}`, { oversell: short.map((l) => l.row.v.id) });
    }
    const discount: DiscountRule | null = input.discount && input.discount.value > 0 ? { kind: input.discount.kind, value: input.discount.kind === "percent" ? Math.min(100, input.discount.value) : Math.round(input.discount.value), minSubtotal: 0, code: "POS" } : null;
    const totals = computeTotals({ lines: lines.map((l) => ({ key: l.key, unitPrice: l.unitPrice, quantity: l.quantity, taxBps: l.taxBps, weightGrams: 0 })), discount, shipping: 0, pricesIncludeTax: store.pricesIncludeTax });

    const pay = input.payment;
    let change = 0;
    if (pay.method === "cash") {
      const tendered = pay.tendered ?? totals.total;
      if (tendered < totals.total) throw new ApiError("validation_failed", "Cash received is less than the total", { tendered: ["Too little"] });
      change = tendered - totals.total;
    }

    // Walk-in customers are optional; with an email or phone they join the customer list.
    let customerId: string | null = null;
    const c = input.customer;
    if (c.email || c.phone) {
      const [existing] = await tx
        .select()
        .from(schema.storeCustomers)
        .where(and(eq(schema.storeCustomers.projectId, projectId), c.email ? sql`lower(${schema.storeCustomers.email}) = ${c.email.toLowerCase()}` : eq(schema.storeCustomers.phone, c.phone)));
      customerId = existing
        ? existing.id
        : (await tx.insert(schema.storeCustomers).values({ projectId, email: c.email || `pos-${randomToken(8)}@walk-in.invalid`, name: c.name, phone: c.phone }).returning({ id: schema.storeCustomers.id }))[0].id;
    }

    const now = new Date();
    const address = (store.address as Record<string, string> | null) ?? {};
    const [order] = await tx
      .insert(schema.storeOrders)
      .values({
        projectId,
        number,
        accessKeyHash: sha256(randomToken(18)),
        customerId,
        email: c.email,
        phone: c.phone,
        // In-store sales: the place of supply is the shop itself (intra-state GST).
        shippingAddress: { name: c.name || "Walk-in customer", line1: address.line1 ?? "", line2: address.line2 ?? "", city: address.city ?? "", region: store.region, postalCode: address.postalCode ?? "", country: store.country },
        currency: store.currency,
        baseTotal: totals.total,
        subtotal: totals.subtotal,
        discountTotal: totals.discount,
        shippingTotal: 0,
        taxTotal: totals.tax,
        total: totals.total,
        taxIncluded: totals.taxIncluded,
        shippingMethod: { id: "pos", name: "In store", eta: "", pickup: true },
        paymentMethod: `pos_${pay.method}`,
        paymentRef: pay.reference || null,
        channel: "pos",
        pos: { method: pay.method, tendered: pay.method === "cash" ? (pay.tendered ?? totals.total) : null, change, staffId: staff.id, staffName: staff.name, clientRef: input.clientRef },
        buyerGstin: input.buyerGstin,
        note: input.note,
        financialStatus: "paid",
        fulfillmentStatus: "delivered",
        paidAt: now,
        fulfilledAt: now,
      })
      .returning();
    await tx.insert(schema.storeOrderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        productId: l.row.p.id,
        variantId: l.row.v.id,
        title: l.row.p.title,
        variantTitle: l.row.v.title === "Default" ? "" : l.row.v.title,
        sku: l.row.v.sku,
        image: (l.row.p.images as string[])[0] ?? "",
        unitPrice: l.unitPrice,
        unitCost: l.row.v.cost,
        quantity: l.quantity,
        taxBps: l.taxBps,
        hsn: l.row.p.hsn ?? "",
        kind: l.row.p.kind,
        total: l.unitPrice * l.quantity,
      })),
    );
    for (const l of lines) if (l.row.v.trackInventory) await adjustStock(projectId, l.row.v.id, -l.quantity, "POS sale", staff.id, label, tx);
    await assignInvoiceNumber(order.id, tx);
    await tx.insert(schema.storeOrderEvents).values({ orderId: order.id, kind: "placed", message: `Sold in store by ${staff.name} · ${pay.method === "cash" ? `cash${change ? `, change ${change}` : ""}` : pay.method.toUpperCase()}`, actorId: staff.id });
    const [fresh] = await tx.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, order.id));
    return { order: fresh, change, label };
  });
  await emitEvent(projectId, "order.paid", { label: result.label, total: (result.order.total / 100).toFixed(2), currency: result.order.currency, email: result.order.email, customerName: (result.order.shippingAddress as { name?: string }).name ?? "", channel: "pos" }).catch(() => {});
  return { order: result.order, duplicate: false, change: result.change };
}

/** Today's (or a day's) counter sales, by payment method. */
export async function posSummary(projectId: string, day: Date, tzOffsetMinutes = 0) {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + tzOffsetMinutes * 60_000);
  const end = new Date(start.getTime() + 86_400_000);
  const orders = await db
    .select({ id: schema.storeOrders.id, number: schema.storeOrders.number, total: schema.storeOrders.total, refunded: schema.storeOrders.refundedTotal, taxTotal: schema.storeOrders.taxTotal, discountTotal: schema.storeOrders.discountTotal, pos: schema.storeOrders.pos, paymentMethod: schema.storeOrders.paymentMethod, createdAt: schema.storeOrders.createdAt, invoiceNumber: schema.storeOrders.invoiceNumber, cancelledAt: schema.storeOrders.cancelledAt, customer: schema.storeOrders.shippingAddress })
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.channel, "pos"), gte(schema.storeOrders.createdAt, start), lt(schema.storeOrders.createdAt, end)))
    .orderBy(desc(schema.storeOrders.createdAt));
  const live = orders.filter((o) => !o.cancelledAt);
  const byMethod = Object.fromEntries(POS_METHODS.map((m) => [m, live.filter((o) => o.paymentMethod === `pos_${m}`).reduce((n, o) => n + o.total - o.refunded, 0)]));
  const items = live.length
    ? (await db.select({ q: sql<number>`coalesce(sum(${schema.storeOrderItems.quantity}),0)::int` }).from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, live.map((o) => o.id))))[0].q
    : 0;
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    sales: live.length,
    items,
    gross: live.reduce((n, o) => n + o.total, 0),
    refunds: live.reduce((n, o) => n + o.refunded, 0),
    tax: live.reduce((n, o) => n + o.taxTotal, 0),
    discounts: live.reduce((n, o) => n + o.discountTotal, 0),
    byMethod,
    recent: orders.slice(0, 50).map((o) => ({ id: o.id, number: o.number, total: o.total, method: o.paymentMethod.replace("pos_", ""), at: o.createdAt, invoice: o.invoiceNumber, cancelled: !!o.cancelledAt, customer: (o.customer as { name?: string }).name ?? "" })),
  };
}

export { isValidEan13 };
