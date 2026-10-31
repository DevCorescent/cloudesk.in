import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { esc } from "@/lib/site/html";
import { formatMoney, minorDigits } from "@/lib/store/money";
import { orderTaxLines, rupeesInWords, splitTax, stateCode } from "@/lib/store/gst";
import type { Address } from "@/lib/store/shipping";
import { notFound } from "../http/errors";
import { getStore } from "./catalog";
import { getOrder, orderLabel } from "./orders";
import { contains } from "../security/like";

// ─── Customers ───────────────────────────────────────────────────────────────

export async function listCustomers(projectId: string, f: { q?: string; limit?: number; offset?: number }) {
  const conds = [eq(schema.storeCustomers.projectId, projectId)];
  if (f.q) conds.push(or(ilike(schema.storeCustomers.email, contains(f.q)), ilike(schema.storeCustomers.name, contains(f.q)), ilike(schema.storeCustomers.phone, contains(f.q)))!);
  const where = and(...conds);
  // Spend counts orders that were not cancelled, net of refunds.
  const stats = sql`(select coalesce(sum(o.total - o.refunded_total),0)::bigint from store_orders o where o.customer_id = ${sql.raw('"store_customers"."id"')} and o.cancelled_at is null)`;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.storeCustomers.id,
        email: schema.storeCustomers.email,
        name: schema.storeCustomers.name,
        phone: schema.storeCustomers.phone,
        acceptsMarketing: schema.storeCustomers.acceptsMarketing,
        createdAt: schema.storeCustomers.createdAt,
        orders: sql<number>`(select count(*)::int from store_orders o where o.customer_id = ${sql.raw('"store_customers"."id"')} and o.cancelled_at is null)`,
        spent: sql<number>`${stats}`,
        lastOrderAt: sql<string | null>`(select max(o.created_at) from store_orders o where o.customer_id = ${sql.raw('"store_customers"."id"')})`,
      })
      .from(schema.storeCustomers)
      .where(where)
      .orderBy(desc(stats))
      .limit(Math.min(f.limit ?? 50, 200))
      .offset(f.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.storeCustomers).where(where),
  ]);
  return { customers: rows.map((r) => ({ ...r, spent: Number(r.spent) })), total };
}

export async function getCustomer(projectId: string, id: string) {
  const [c] = await db.select().from(schema.storeCustomers).where(and(eq(schema.storeCustomers.id, id), eq(schema.storeCustomers.projectId, projectId)));
  if (!c) throw notFound("Customer");
  const orders = await db
    .select({ id: schema.storeOrders.id, number: schema.storeOrders.number, total: schema.storeOrders.total, currency: schema.storeOrders.currency, financialStatus: schema.storeOrders.financialStatus, fulfillmentStatus: schema.storeOrders.fulfillmentStatus, cancelledAt: schema.storeOrders.cancelledAt, createdAt: schema.storeOrders.createdAt, address: schema.storeOrders.shippingAddress })
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.customerId, c.id)))
    .orderBy(desc(schema.storeOrders.createdAt))
    .limit(100);
  return { customer: c, orders };
}

export async function exportCustomersCsv(projectId: string) {
  const { customers } = await listCustomers(projectId, { limit: 200 });
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return ["email,name,phone,accepts_marketing,orders,spent_minor_units", ...customers.map((c) => [c.email, c.name, c.phone, c.acceptsMarketing, c.orders, c.spent].map(cell).join(","))].join("\n");
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export async function listInventory(projectId: string, f: { q?: string; low?: boolean }) {
  const store = await getStore(projectId);
  const conds = [eq(schema.storeVariants.projectId, projectId), sql`${schema.storeProducts.status} <> 'archived'`];
  if (f.q) conds.push(or(ilike(schema.storeProducts.title, contains(f.q)), ilike(schema.storeVariants.sku, contains(f.q)))!);
  if (f.low) conds.push(eq(schema.storeVariants.trackInventory, true), sql`${schema.storeVariants.stock} <= ${store?.lowStockThreshold ?? 5}`);
  const rows = await db
    .select({
      variantId: schema.storeVariants.id,
      productId: schema.storeProducts.id,
      product: schema.storeProducts.title,
      variant: schema.storeVariants.title,
      sku: schema.storeVariants.sku,
      image: sql<string>`coalesce(${schema.storeProducts.images}->>0, '')`,
      trackInventory: schema.storeVariants.trackInventory,
      stock: schema.storeVariants.stock,
      price: schema.storeVariants.price,
      cost: schema.storeVariants.cost,
      // Units held by unpaid online orders still inside their payment window.
      reserved: sql<number>`(select coalesce(sum(i.quantity),0)::int from store_order_items i join store_orders o on o.id = i.order_id where i.variant_id = ${sql.raw('"store_variants"."id"')} and o.reserved_until > now() and o.cancelled_at is null)`,
    })
    .from(schema.storeVariants)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
    .where(and(...conds))
    .orderBy(asc(schema.storeProducts.title), asc(schema.storeVariants.position))
    .limit(1000);
  const value = rows.reduce((a, r) => a + (r.trackInventory ? Math.max(0, r.stock) * (r.cost ?? 0) : 0), 0);
  return { items: rows, threshold: store?.lowStockThreshold ?? 5, stockValueAtCost: value };
}

export async function inventoryHistory(projectId: string, variantId: string) {
  return db
    .select({ id: schema.storeInventoryLog.id, delta: schema.storeInventoryLog.delta, reason: schema.storeInventoryLog.reason, ref: schema.storeInventoryLog.ref, createdAt: schema.storeInventoryLog.createdAt, actorName: schema.users.name })
    .from(schema.storeInventoryLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.storeInventoryLog.actorId))
    .where(and(eq(schema.storeInventoryLog.projectId, projectId), eq(schema.storeInventoryLog.variantId, variantId)))
    .orderBy(desc(schema.storeInventoryLog.createdAt))
    .limit(100);
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export async function listReviews(projectId: string, status?: string) {
  const conds = [eq(schema.storeReviews.projectId, projectId)];
  if (status) conds.push(eq(schema.storeReviews.status, status));
  return db
    .select({ id: schema.storeReviews.id, name: schema.storeReviews.name, rating: schema.storeReviews.rating, title: schema.storeReviews.title, body: schema.storeReviews.body, verified: schema.storeReviews.verified, status: schema.storeReviews.status, createdAt: schema.storeReviews.createdAt, productId: schema.storeReviews.productId, product: schema.storeProducts.title })
    .from(schema.storeReviews)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeReviews.productId))
    .where(and(...conds))
    .orderBy(desc(schema.storeReviews.createdAt))
    .limit(300);
}

export async function moderateReview(projectId: string, id: string, status: "approved" | "rejected" | "pending") {
  const r = await db.update(schema.storeReviews).set({ status }).where(and(eq(schema.storeReviews.id, id), eq(schema.storeReviews.projectId, projectId))).returning({ id: schema.storeReviews.id });
  if (!r.length) throw notFound("Review");
}

export async function deleteReview(projectId: string, id: string) {
  const r = await db.delete(schema.storeReviews).where(and(eq(schema.storeReviews.id, id), eq(schema.storeReviews.projectId, projectId))).returning({ id: schema.storeReviews.id });
  if (!r.length) throw notFound("Review");
}

// ─── Invoice ─────────────────────────────────────────────────────────────────

/**
 * A printable invoice. For Indian stores it is a GST tax invoice: serial
 * number per financial year, GSTINs, place of supply, HSN and tax per line,
 * CGST/SGST or IGST, and the amount in words.
 */
export async function invoiceHtml(projectId: string, orderId: string) {
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const { order: o, items } = await getOrder(projectId, orderId);
  const a = o.shippingAddress as Address;
  const m = (n: number) => esc(formatMoney(n, o.currency));
  const label = orderLabel(store.orderPrefix, o.number);
  const india = store.country === "IN" && o.currency === "INR";
  const paid = ["paid", "partially_refunded", "refunded"].includes(o.financialStatus);
  const intra = !!store.region && store.region.trim().toLowerCase() === (a.region ?? "").trim().toLowerCase();
  const calc = orderTaxLines(items.map((i) => ({ key: i.id, title: i.title, hsn: i.hsn, quantity: i.quantity, unitPrice: i.unitPrice, taxBps: i.taxBps })), o);
  const sa = store.address as Partial<Address> | null;
  const ship = o.shippingMethod as { name?: string } | null;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
  const title = india ? (paid ? "Tax invoice" : "Proforma invoice") : paid ? "Invoice" : "Proforma invoice";
  const code = (state: string) => stateCode(state ?? "") ?? "";

  const head = india
    ? `<tr><th>#</th><th>Item</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable value</th><th class="r">GST</th>${intra ? `<th class="r">CGST</th><th class="r">SGST</th>` : `<th class="r">IGST</th>`}<th class="r">Amount</th></tr>`
    : `<tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Tax</th><th class="r">Amount</th></tr>`;
  const rows = calc.lines
    .map((l, i) => {
      const it = items.find((x) => x.id === l.key)!;
      const name = `${esc(l.title)}${it.variantTitle && it.variantTitle !== "Default" ? `<div class="m">${esc(it.variantTitle)}</div>` : ""}${it.sku ? `<div class="m">SKU ${esc(it.sku)}</div>` : ""}`;
      if (!india) return `<tr><td>${i + 1}</td><td>${name}</td><td class="r">${l.quantity}</td><td class="r">${m(l.unitPrice)}</td><td class="r">${pct(l.taxBps)}</td><td class="r">${m(l.unitPrice * l.quantity)}</td></tr>`;
      const t = splitTax(l.tax, intra);
      return `<tr><td>${i + 1}</td><td>${name}</td><td>${esc(l.hsn || "—")}</td><td class="r">${l.quantity}</td><td class="r">${m(l.unitPrice)}</td><td class="r">${m(l.taxable)}</td><td class="r">${pct(l.taxBps)}</td>${intra ? `<td class="r">${m(t.cgst)}</td><td class="r">${m(t.sgst)}</td>` : `<td class="r">${m(t.igst)}</td>`}<td class="r">${m(l.taxable + l.tax)}</td></tr>`;
    })
    .join("");
  const shipRow =
    india && o.shippingTotal
      ? (() => {
          const t = splitTax(calc.shipping.tax, intra);
          return `<tr><td></td><td>Shipping${ship?.name ? ` (${esc(ship.name)})` : ""}</td><td>996812</td><td class="r">1</td><td class="r">${m(o.shippingTotal)}</td><td class="r">${m(calc.shipping.taxable)}</td><td class="r">${calc.shipping.taxable ? pct(Math.round((calc.shipping.tax / calc.shipping.taxable) * 10000)) : "0%"}</td>${intra ? `<td class="r">${m(t.cgst)}</td><td class="r">${m(t.sgst)}</td>` : `<td class="r">${m(t.igst)}</td>`}<td class="r">${m(o.shippingTotal)}</td></tr>`;
        })()
      : "";
  const cols = india ? (intra ? 10 : 9) : 6;
  const line = (k: string, v: string, strong = false) => `<tr${strong ? ' class="t"' : ""}><td colspan="${cols - 1}" class="r">${k}</td><td class="r">${v}</td></tr>`;
  const taxTotal = splitTax(o.taxTotal, intra);
  const taxLines = !o.taxTotal ? "" : india ? (intra ? line("CGST", m(taxTotal.cgst)) + line("SGST", m(taxTotal.sgst)) : line("IGST", m(taxTotal.igst))) : line(o.taxIncluded ? "Tax (included)" : "Tax", m(o.taxTotal));
  const buyer = o.buyerGstin
    ? `<div>${esc(o.buyerBusinessName || a.name)}</div><div class="m">GSTIN: ${esc(o.buyerGstin)}</div>`
    : `<div>${esc(a.name)}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} ${esc(o.invoiceNumber ?? label)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:960px;margin:32px auto;padding:0 24px}
h1{font-size:20px;margin:0}.m{color:#666;font-size:12px}.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:20px}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:0 0 6px}
table{width:100%;border-collapse:collapse}th,td{padding:7px 6px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:top}th{font-size:11px;color:#666;font-weight:600}.r{text-align:right}
tr.t td{font-weight:700;font-size:15px;border-bottom:0}.badge{display:inline-block;padding:2px 8px;border-radius:99px;background:#f2f2f2;font-size:12px}.words{margin-top:12px;font-size:12px}
.sign{margin-top:40px;text-align:right}.p{margin-top:24px}@media print{.p{display:none}body{margin:0}}
</style></head><body>
<div class="top"><div><h1>${esc(store.name)}</h1>${sa?.line1 ? `<div class="m">${esc([sa.line1, sa.line2, sa.city, sa.region, sa.postalCode].filter(Boolean).join(", "))}</div>` : ""}${store.email ? `<div class="m">${esc(store.email)}${store.phone ? ` · ${esc(store.phone)}` : ""}</div>` : ""}${store.taxId ? `<div class="m">${india ? "GSTIN" : "Tax ID"}: ${esc(store.taxId)}</div>` : ""}</div>
<div class="r"><h1>${esc(title)}</h1>${o.invoiceNumber ? `<div>Invoice no. ${esc(o.invoiceNumber)}</div>` : ""}<div class="m">Order ${esc(label)} · ${esc((o.paidAt ?? o.createdAt).toISOString().slice(0, 10))}</div>${o.cancelledAt ? '<span class="badge">Cancelled</span>' : ""}</div></div>
<div class="grid"><div><h2>Bill to</h2>${buyer}<div class="m">${esc(o.email)}${o.phone ? ` · ${esc(o.phone)}` : ""}</div></div>
<div><h2>Ship to</h2><div>${esc(a.name)}</div><div class="m">${esc([a.line1, a.line2, a.city, `${a.region} ${a.postalCode}`, a.country].filter(Boolean).join(", "))}</div></div>
<div><h2>Details</h2>${india ? `<div class="m">Place of supply: ${esc(a.region)}${code(a.region) ? ` (${code(a.region)})` : ""}</div><div class="m">Reverse charge: No</div>` : ""}<div class="m">Payment: ${esc({ cod: "Cash on delivery", manual: "UPI / bank transfer", stripe: "Card (Stripe)", razorpay: "Razorpay", paypal: "PayPal", giftcard: "Gift card" }[o.paymentMethod] ?? o.paymentMethod)} · ${esc(o.financialStatus.replace("_", " "))}</div></div></div>
<table><thead>${head}</thead><tbody>${rows}${shipRow}
${line("Subtotal", m(o.subtotal))}${o.discountTotal ? line(`Discount${o.discountCode ? ` (${esc(o.discountCode)})` : ""}`, `−${m(o.discountTotal)}`) : ""}${!india ? line("Shipping", o.shippingTotal ? m(o.shippingTotal) : "Free") : ""}${o.feeTotal ? line("Payment fee", m(o.feeTotal)) : ""}
${taxLines}${line("Total", m(o.total), true)}${o.giftCardTotal ? `${line(`Paid by gift card${o.giftCardCode ? ` (${esc(o.giftCardCode)})` : ""}`, `−${m(o.giftCardTotal)}`)}${line("Paid by other method", m(o.total - o.giftCardTotal))}` : ""}${o.refundedTotal ? line("Refunded", `−${m(o.refundedTotal)}`) : ""}</tbody></table>
${india ? `<p class="words"><strong>Amount in words:</strong> ${esc(rupeesInWords(o.total))}</p>` : ""}
<p class="m">${o.taxIncluded ? "Prices include tax." : "Tax is added to the listed prices."} This is a computer-generated invoice.</p>
${india ? `<div class="sign"><div class="m">For ${esc(store.name)}</div><div style="margin-top:36px" class="m">Authorised signatory</div></div>` : ""}
<p class="p m">To print or save as PDF, use your browser’s Print: ⌘P on a Mac, Ctrl+P on Windows or Linux, or Share → Print on a phone.</p></body></html>`;
}

// ─── Order export & packing slips ────────────────────────────────────────────

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Orders as CSV, one row per line item, amounts in major units. */
export async function exportOrdersCsv(projectId: string, ids?: string[]) {
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const where = and(eq(schema.storeOrders.projectId, projectId), ids?.length ? inArray(schema.storeOrders.id, ids) : undefined);
  const orders = await db.select().from(schema.storeOrders).where(where).orderBy(desc(schema.storeOrders.createdAt)).limit(5000);
  const items = orders.length ? await db.select().from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, orders.map((o) => o.id))) : [];
  const d = minorDigits(store.currency);
  const m = (n: number) => (n / 10 ** d).toFixed(d);
  const head = ["order", "date", "email", "phone", "name", "address", "city", "state", "postal_code", "country", "payment", "financial_status", "fulfillment_status", "cancelled", "item", "variant", "sku", "quantity", "unit_price", "line_total", "subtotal", "discount", "shipping", "tax", "gift_card", "total", "refunded", "currency", "tracking"];
  const rows = [head.join(",")];
  for (const o of orders) {
    const a = o.shippingAddress as Address;
    const t = o.tracking as { carrier?: string; number?: string } | null;
    for (const [i, it] of items.filter((x) => x.orderId === o.id).entries()) {
      const first = i === 0;
      rows.push(
        [orderLabel(store.orderPrefix, o.number), o.createdAt.toISOString(), o.email, o.phone, a.name, [a.line1, a.line2].filter(Boolean).join(", "), a.city, a.region, a.postalCode, a.country, o.paymentMethod, o.financialStatus, o.fulfillmentStatus, o.cancelledAt ? "yes" : "", it.title, it.variantTitle === "Default" ? "" : it.variantTitle, it.sku, it.quantity, m(it.unitPrice), m(it.total), first ? m(o.subtotal) : "", first ? m(o.discountTotal) : "", first ? m(o.shippingTotal) : "", first ? m(o.taxTotal) : "", first ? m(o.giftCardTotal) : "", first ? m(o.total) : "", first ? m(o.refundedTotal) : "", o.currency, t?.number ? `${t.carrier ?? ""} ${t.number}`.trim() : ""]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return rows.join("\n");
}

/** Printable packing slips (no prices), one page per order. */
export async function packingSlipsHtml(projectId: string, ids: string[]) {
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const orders = ids.length ? await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), inArray(schema.storeOrders.id, ids))).orderBy(asc(schema.storeOrders.number)) : [];
  if (!orders.length) throw notFound("Order");
  const items = await db.select().from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, orders.map((o) => o.id)));
  const slips = orders.map((o) => {
    const a = o.shippingAddress as Address;
    const ship = o.shippingMethod as { name?: string } | null;
    const lines = items
      .filter((i) => i.orderId === o.id)
      .map((i) => `<tr><td class="q">${i.quantity}</td><td>${esc(i.title)}${i.variantTitle && i.variantTitle !== "Default" ? `<div class="m">${esc(i.variantTitle)}</div>` : ""}</td><td class="m">${esc(i.sku)}</td><td class="box"></td></tr>`)
      .join("");
    return `<section class="slip"><div class="top"><div><h1>${esc(store.name)}</h1><div class="m">Packing slip</div></div><div class="r"><h1>${esc(orderLabel(store.orderPrefix, o.number))}</h1><div class="m">${esc(o.createdAt.toISOString().slice(0, 10))}</div>${o.paymentMethod === "cod" && o.financialStatus === "pending" ? `<div class="cod">COLLECT CASH ON DELIVERY: ${esc(formatMoney(o.total - o.giftCardTotal, o.currency))}</div>` : ""}</div></div>
<div class="grid"><div><h2>Ship to</h2><div class="addr">${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ""}<br>${esc(a.city)}, ${esc(a.region)} ${esc(a.postalCode)}<br>${esc(a.country)}${o.phone ? `<br>${esc(o.phone)}` : ""}</div></div><div><h2>Delivery</h2><div>${esc(ship?.name ?? "")}</div>${o.note ? `<h2>Customer note</h2><div>${esc(o.note)}</div>` : ""}</div></div>
<table><thead><tr><th class="q">Qty</th><th>Item</th><th>SKU</th><th>Packed</th></tr></thead><tbody>${lines}</tbody></table>
<p class="m">Thank you for shopping with ${esc(store.name)}!${store.email ? ` Questions? ${esc(store.email)}` : ""}</p></section>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing slips</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;background:#f4f4f2}.slip{background:#fff;max-width:760px;margin:24px auto;padding:32px;break-after:page}
h1{font-size:20px;margin:0}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:12px 0 4px}.m{color:#666;font-size:12px}.r{text-align:right}
.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px}.addr{font-size:16px;line-height:1.45}
table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:top}th{font-size:12px;color:#666}.q{width:48px;font-weight:700}.box{width:56px}.box:after{content:"";display:inline-block;width:14px;height:14px;border:1.5px solid #999;border-radius:3px}
.cod{margin-top:6px;display:inline-block;padding:4px 8px;border:2px solid #111;font-weight:700;font-size:12px}
@media print{body{background:#fff}.slip{margin:0;max-width:none;padding:16px}}
</style></head><body>${slips.join("")}</body></html>`;
}
