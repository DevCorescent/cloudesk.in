import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { orderTaxLines, splitTax, stateCode } from "@/lib/store/gst";
import type { Address } from "@/lib/store/shipping";
import { ApiError, notFound } from "../http/errors";

// Monthly GST summary in the shape of GSTR-1 sections, from paid orders
// (by invoice date) and refunds. A working summary for the owner and their
// accountant — not a filing.

/** Inter-state B2C invoices above this value are reported individually (B2CL). */
export const B2CL_LIMIT = 100_000_00;

const IST = 330 * 60_000;
function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("validation_failed", "Use a month like 2026-10");
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) - IST), to: new Date(Date.UTC(y, m, 1) - IST) };
}

type Amounts = { taxable: number; igst: number; cgst: number; sgst: number; total: number };
const zero = (): Amounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, total: 0 });
const add = (a: Amounts, b: Amounts) => ({ taxable: a.taxable + b.taxable, igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst, total: a.total + b.total });

export async function gstReport(projectId: string, month: string) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!store) throw notFound("Store");
  if (store.country !== "IN" || store.currency !== "INR") throw new ApiError("conflict", "GST reports are for stores in India selling in INR");
  const { from, to } = monthRange(month);
  const orders = await db
    .select()
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), isNotNull(schema.storeOrders.invoiceNumber), gte(schema.storeOrders.paidAt, from), lt(schema.storeOrders.paidAt, to)));
  const items = orders.length ? await db.select().from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, orders.map((o) => o.id))) : [];
  const ownState = store.region;

  const b2b: (Amounts & { invoice: string; date: string; gstin: string; name: string; placeOfSupply: string })[] = [];
  const b2cl: (Amounts & { invoice: string; date: string; placeOfSupply: string })[] = [];
  const b2cs = new Map<string, Amounts & { placeOfSupply: string; rate: number }>();
  const hsn = new Map<string, Amounts & { hsn: string; description: string; quantity: number; rate: number }>();
  let totals = zero();

  for (const o of orders) {
    const a = o.shippingAddress as Address;
    const intra = !!ownState && ownState.trim().toLowerCase() === (a.region ?? "").trim().toLowerCase();
    const pos = `${stateCode(a.region) ?? "??"}-${a.region}`;
    const lines = items.filter((i) => i.orderId === o.id);
    const calc = orderTaxLines(lines.map((i) => ({ key: i.id, title: i.title, hsn: i.hsn, quantity: i.quantity, unitPrice: i.unitPrice, taxBps: i.taxBps })), o);
    const rows = [
      ...calc.lines.map((l) => ({ hsn: l.hsn || "NA", description: l.title, quantity: l.quantity, rate: l.taxBps, taxable: l.taxable, tax: l.tax })),
      ...(o.shippingTotal ? [{ hsn: "996812", description: "Shipping", quantity: 1, rate: calc.shipping.taxable ? Math.round((calc.shipping.tax / calc.shipping.taxable) * 10000) : 0, taxable: calc.shipping.taxable, tax: calc.shipping.tax }] : []),
    ];
    let orderAmt = zero();
    for (const r of rows) {
      const t = splitTax(r.tax, intra);
      const amt = { taxable: r.taxable, ...t, total: r.taxable + r.tax };
      orderAmt = add(orderAmt, amt);
      const hk = `${r.hsn}|${r.rate}`;
      const h = hsn.get(hk) ?? { ...zero(), hsn: r.hsn, description: r.description, quantity: 0, rate: r.rate };
      hsn.set(hk, { ...add(h, amt), hsn: h.hsn, description: h.description, quantity: h.quantity + r.quantity, rate: r.rate });
      if (!o.buyerGstin && !(!intra && o.total > B2CL_LIMIT)) {
        const k = `${pos}|${r.rate}`;
        const c = b2cs.get(k) ?? { ...zero(), placeOfSupply: pos, rate: r.rate };
        b2cs.set(k, { ...add(c, amt), placeOfSupply: pos, rate: r.rate });
      }
    }
    totals = add(totals, orderAmt);
    const date = new Date(o.paidAt!.getTime() + IST).toISOString().slice(0, 10);
    if (o.buyerGstin) b2b.push({ ...orderAmt, invoice: o.invoiceNumber!, date, gstin: o.buyerGstin, name: o.buyerBusinessName || a.name, placeOfSupply: pos });
    else if (!intra && o.total > B2CL_LIMIT) b2cl.push({ ...orderAmt, invoice: o.invoiceNumber!, date, placeOfSupply: pos });
  }

  // Refunds issued this month on invoiced orders (credit notes to raise).
  const refunds = await db.execute<{ invoice: string; amount: number; at: Date; tax_included: boolean; total: number; tax_total: number }>(sql`
    select o.invoice_number as invoice, (e.data->>'amount')::int as amount, e.created_at as at, o.tax_included, o.total, o.tax_total
    from store_order_events e join store_orders o on o.id = e.order_id
    where o.project_id = ${projectId} and e.kind = 'refunded' and o.invoice_number is not null and e.created_at >= ${from} and e.created_at < ${to} and e.data ? 'amount'`);
  const creditNotes = refunds.rows.map((r) => {
    // Tax is apportioned in the same proportion as the order's tax to its total.
    const tax = r.total ? Math.round((Number(r.amount) * Number(r.tax_total)) / Number(r.total)) : 0;
    return { invoice: r.invoice, date: new Date(new Date(r.at).getTime() + IST).toISOString().slice(0, 10), amount: Number(r.amount), taxable: Number(r.amount) - tax, tax };
  });

  return {
    month,
    store: { name: store.name, gstin: store.taxId, state: ownState },
    invoices: orders.length,
    totals,
    b2b,
    b2cl,
    b2cs: [...b2cs.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate),
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    creditNotes,
    notes: [
      "Based on paid orders by invoice date and refunds recorded in the store. Cash-on-delivery orders count when marked paid on delivery.",
      "Check with your accountant before filing; this is not a GST return.",
      "Gift-card sales are not supplies and are excluded; orders paid with gift cards are reported at their full value.",
    ],
  };
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

export function gstCsv(report: Awaited<ReturnType<typeof gstReport>>, section: "b2b" | "b2cl" | "b2cs" | "hsn" | "cdn") {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows: unknown[][] = [];
  if (section === "b2b") {
    rows.push(["GSTIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Taxable value", "IGST", "CGST", "SGST"]);
    for (const r of report.b2b) rows.push([r.gstin, r.name, r.invoice, r.date, rupees(r.total), r.placeOfSupply, rupees(r.taxable), rupees(r.igst), rupees(r.cgst), rupees(r.sgst)]);
  } else if (section === "b2cl") {
    rows.push(["Invoice number", "Invoice date", "Invoice value", "Place of supply", "Taxable value", "IGST"]);
    for (const r of report.b2cl) rows.push([r.invoice, r.date, rupees(r.total), r.placeOfSupply, rupees(r.taxable), rupees(r.igst)]);
  } else if (section === "b2cs") {
    rows.push(["Place of supply", "Rate", "Taxable value", "IGST", "CGST", "SGST"]);
    for (const r of report.b2cs) rows.push([r.placeOfSupply, (r.rate / 100).toFixed(2), rupees(r.taxable), rupees(r.igst), rupees(r.cgst), rupees(r.sgst)]);
  } else if (section === "hsn") {
    rows.push(["HSN", "Description", "UQC", "Total quantity", "Rate", "Total value", "Taxable value", "IGST", "CGST", "SGST"]);
    for (const r of report.hsn) rows.push([r.hsn, r.description, "NOS", r.quantity, (r.rate / 100).toFixed(2), rupees(r.total), rupees(r.taxable), rupees(r.igst), rupees(r.cgst), rupees(r.sgst)]);
  } else {
    rows.push(["Original invoice", "Refund date", "Refund value", "Taxable value", "Tax"]);
    for (const r of report.creditNotes) rows.push([r.invoice, r.date, rupees(r.amount), rupees(r.taxable), rupees(r.tax)]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
