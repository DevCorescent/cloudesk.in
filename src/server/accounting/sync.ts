// Posting from the rest of Cloudesk. A sync works out the journal every source
// document should have — invoices, credit notes and their payments; store and
// POS sales and refunds; bills (including those made from goods received in
// Inventory) and their payments; stock adjustments and counts; payroll runs
// and claims — and makes the ledger match: new ones are added, changed ones
// replaced, and ones whose source is gone (a voided invoice) removed. Nothing
// dated in a locked period, and nothing matched to a bank statement, is
// touched; those are listed as notes instead.
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { NOT_POSTED, cr, dr, type PostLine } from "@/lib/accounting/model";
import { bookedFor, dayAfter, inrOf, monthEnds, revaluation } from "@/lib/accounting/fx";
import { rateOn } from "@/lib/org/model";
import { minorDigits } from "@/lib/store/money";
import { splitTax } from "@/lib/store/gst";
import type { Address } from "@/lib/store/shipping";
import { isOn } from "@/lib/workspace/modules";
import { log } from "../log";
import { addMissingAccounts, nextNumber, systemScope, todayIst, type Scope } from "./access";
import { totalsOf } from "../horeca/orders";
import { totalsOf as payTotals } from "../hr/payroll";
import { resolver, type Resolver } from "../org/resolve";
import { closedTest } from "./periods";
import { assetWants, scheduleWants } from "./finance";
import { depositWants } from "./payables";
import { receiptWants } from "./receivables";
import { intercompanyWants } from "./group";
import { productionWants } from "../manufacturing/production";
import { settlementWants } from "../hr/plus";
import { travelWants } from "../hr/travel";
import { maintenanceWants } from "../maintenance/core";
import { logisticsWants } from "../logistics/core";
import { educationWants } from "../education/core";
import { clinicWants } from "../clinic/core";
import { constructionWants } from "../construction/core";
import { accountKeys, postJournal } from "./ledger";

type Want = { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: PostLine[]; companyId?: string; branchId?: string | null };
type Note = { source: string; ref: string; why: string };

const istDate = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : todayIst());
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const rowsOf = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[]));

/** Accounts for the output tax in a tax row's label: "CGST 9%" → cgst_out. */
const outKey = (label: string) => (/^cgst/i.test(label) ? "cgst_out" : /^sgst|^utgst/i.test(label) ? "sgst_out" : /^igst/i.test(label) ? "igst_out" : "tax_other");

// ─── Invoices ───

async function invoiceWants(orgId: string, notes: Note[], r: Resolver, rate: RateOf) {
  const docs = rowsOf<{ id: string; owner_id: string; type: string; number: string; status: string; issue_date: string; currency: string; total: number; tax_total: number; taxes: { label: string; amount: number }[]; adjustments: { roundOff?: boolean }; client: { name?: string; company?: string }; fx_rate: string | null }>(
    await db.execute(sql`
      select d.id, d.project_id as owner_id, d.type, d.number, d.status, d.issue_date::text, d.currency, d.total, d.tax_total, d.taxes, d.adjustments, d.client, d.fx_rate
      from invoice_documents d join invoice_owners o on o.id = d.project_id
      left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
      where coalesce(p.org_id, b.org_id) = ${orgId} and d.type in ('invoice','credit_note') and d.status not in ('draft','void') and d.number <> ''`),
  );
  const pays = rowsOf<{ id: string; owner_id: string; document_id: string; amount: number; method: string; paid_on: string; reference: string; number: string; currency: string; client: { name?: string; company?: string }; account_id: string | null; inr_amount: number | null }>(
    await db.execute(sql`
      select pay.id, d.project_id as owner_id, pay.document_id, pay.amount, pay.method, pay.paid_on::text, pay.reference, d.number, d.currency, d.client, pay.account_id, pay.inr_amount
      from invoice_payments pay join invoice_documents d on d.id = pay.document_id join invoice_owners o on o.id = d.project_id
      left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
      where coalesce(p.org_id, b.org_id) = ${orgId} and d.status <> 'void'
      order by pay.paid_on, pay.created_at, pay.id`),
  );
  const out: Want[] = [];
  // A foreign document is posted at its own rate, or the workspace's rate on its date.
  const booked = new Map<string, { rate: number; total: number; totalInr: number; currency: string }>();
  for (const d of docs) {
    const what = d.type === "invoice" ? "Invoice" : "Credit note";
    const fx = d.currency === "INR" ? 1 : d.fx_rate ? Number(d.fx_rate) : rate(d.currency, String(d.issue_date));
    if (!fx) {
      notes.push({ source: what, ref: d.number, why: `In ${d.currency} with no exchange rate on or before ${d.issue_date} — add one in Settings → Organisation → Currencies, or set a rate on the invoice` });
      continue;
    }
    const conv = (n: number) => (d.currency === "INR" ? Number(n) : inrOf(Number(n), d.currency, fx));
    booked.set(d.id, { rate: fx, total: Number(d.total), totalInr: conv(d.total), currency: d.currency });
    const party = d.client?.company || d.client?.name || "";
    const taxes = (d.taxes ?? []).filter((t) => t.amount).map((t) => ({ ...t, amount: conv(t.amount) }));
    const tax = taxes.reduce((a, t) => a + t.amount, 0);
    // Everything that isn't tax is income (any round-off included).
    const total = conv(d.total);
    const income = total - tax;
    const sign = d.type === "credit_note" ? -1 : 1;
    const lines: PostLine[] = [dr("ar", sign * total), cr(d.type === "credit_note" ? "returns" : "sales", sign * income)];
    for (const t of taxes) lines.push(cr(outKey(t.label), sign * t.amount, t.label));
    const at = d.currency === "INR" ? "" : ` · ${d.currency} ${(Number(d.total) / 10 ** minorDigits(d.currency)).toFixed(minorDigits(d.currency))} at ${fx}`;
    out.push({ sourceType: d.type === "credit_note" ? "credit_note" : "invoice", sourceId: d.id, date: String(d.issue_date), narration: `${d.type === "credit_note" ? "Credit note" : "Invoice"} ${d.number}${at}`, sourceRef: d.number, party, lines, ...r.ofOwner(d.owner_id) });
  }
  const paidSoFar = new Map<string, number>();
  for (const p of pays) {
    const doc = booked.get(p.document_id);
    if (!doc) continue;
    // Into the account a receipt named, cash for cash, the bank otherwise; an advance used comes out of customer advances.
    const into = (n: number): PostLine => (p.account_id ? { accountId: p.account_id, debit: n, credit: 0 } : dr(p.method === "advance" ? "customer_advances" : p.method === "cash" ? "cash" : "bank", n));
    const base = { sourceType: "invoice_payment", sourceId: p.id, date: String(p.paid_on), sourceRef: p.number, party: p.client?.company || p.client?.name || "", ...r.ofOwner(p.owner_id) };
    if (p.currency === "INR") {
      out.push({ ...base, narration: `Payment for ${p.number}${p.reference ? ` · ${p.reference}` : ""}`, lines: [into(Number(p.amount)), cr("ar", Number(p.amount))] });
      continue;
    }
    // It settles its share of the receivable at the invoice's rate; the rupees received differ by the exchange gain or loss.
    const before = paidSoFar.get(p.document_id) ?? 0;
    paidSoFar.set(p.document_id, before + Number(p.amount));
    const settles = bookedFor(before + Number(p.amount), doc.total, doc.totalInr, doc.currency, doc.rate) - bookedFor(before, doc.total, doc.totalInr, doc.currency, doc.rate);
    const onDay = rate(p.currency, String(p.paid_on));
    const received = p.inr_amount !== null && p.inr_amount !== undefined ? Number(p.inr_amount) : onDay ? inrOf(Number(p.amount), p.currency, onDay) : null;
    if (received === null || p.method === "advance") {
      notes.push({ source: "Invoice payment", ref: p.number, why: p.method === "advance" ? `Advances are in rupees — record ${p.currency} payments as received` : `In ${p.currency} with no rate on ${p.paid_on} — enter the rupees received on the payment, or add a rate` });
      continue;
    }
    const gain = received - settles;
    out.push({ ...base, narration: `Payment for ${p.number} · ${p.currency} ${(Number(p.amount) / 10 ** minorDigits(p.currency)).toFixed(minorDigits(p.currency))}${p.reference ? ` · ${p.reference}` : ""}`, lines: [into(received), cr("ar", settles), gain > 0 ? cr("fx_gain_loss", gain) : dr("fx_gain_loss", -gain)] });
  }
  return out;
}

type RateOf = (currency: string, day: string) => number | null;

/** The workspace's exchange rates: the latest on or before a day, per currency. */
async function ratesOf(orgId: string): Promise<RateOf> {
  const rows = await db.select({ currency: schema.orgFxRates.currency, date: schema.orgFxRates.date, rate: schema.orgFxRates.rate }).from(schema.orgFxRates).where(eq(schema.orgFxRates.orgId, orgId));
  const by = new Map<string, { date: string; rate: number }[]>();
  for (const x of rows) by.set(x.currency, [...(by.get(x.currency) ?? []), { date: String(x.date), rate: Number(x.rate) }]);
  return (currency, day) => (currency === "INR" ? 1 : rateOn(by.get(currency) ?? [], day)?.rate ?? null);
}

// ─── Revaluation ───

/**
 * At each completed month end, open foreign invoices and bills are restated at
 * that day's rate; the difference is an unrealised exchange gain or loss,
 * reversed the next day so payments settle against the original rate.
 */
async function revaluationWants(orgId: string, r: Resolver, rate: RateOf, notes: Note[]) {
  const docs = rowsOf<{ id: string; owner_id: string; issue_date: string; currency: string; total: number; fx_rate: string | null }>(
    await db.execute(sql`
      select d.id, d.project_id as owner_id, d.issue_date::text, d.currency, d.total, d.fx_rate
      from invoice_documents d join invoice_owners o on o.id = d.project_id
      left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
      where coalesce(p.org_id, b.org_id) = ${orgId} and d.type = 'invoice' and d.status not in ('draft','void') and d.number <> '' and d.currency <> 'INR'`),
  );
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, orgId), notInArray(schema.accBills.status, NOT_POSTED), sql`${schema.accBills.currency} <> 'INR'`));
  if (!docs.length && !bills.length) return [];
  const docPays = docs.length ? rowsOf<{ document_id: string; amount: number; paid_on: string }>(await db.execute(sql`select document_id, amount, paid_on::text from invoice_payments where document_id in (${sql.join(docs.map((d) => sql`${d.id}`), sql`, `)})`)) : [];
  const billPays = bills.length ? await db.select().from(schema.accBillPayments).where(inArray(schema.accBillPayments.billId, bills.map((b) => b.id))) : [];
  const first = [...docs.map((d) => String(d.issue_date)), ...bills.map((b) => String(b.date))].sort()[0];
  const out: Want[] = [];
  const missing = new Set<string>();
  for (const end of monthEnds(first, todayIst())) {
    // Per company: the change on receivables and on payables.
    const by = new Map<string, { ar: number; ap: number }>();
    const add = (company: string, k: "ar" | "ap", n: number) => {
      const x = by.get(company) ?? { ar: 0, ap: 0 };
      x[k] += n;
      by.set(company, x);
    };
    for (const d of docs) {
      if (String(d.issue_date) > end) continue;
      const fx = d.fx_rate ? Number(d.fx_rate) : rate(d.currency, String(d.issue_date));
      const closing = rate(d.currency, end);
      if (!fx) continue;
      if (!closing) {
        missing.add(`${d.currency} on ${end}`);
        continue;
      }
      const paid = docPays.filter((p) => p.document_id === d.id && String(p.paid_on) <= end).reduce((a, p) => a + Number(p.amount), 0);
      const open = Number(d.total) - paid;
      if (open <= 0) continue;
      const totalInr = inrOf(Number(d.total), d.currency, fx);
      add(r.ofOwner(d.owner_id).companyId, "ar", revaluation(open, totalInr - bookedFor(paid, Number(d.total), totalInr, d.currency, fx), d.currency, closing));
    }
    for (const b of bills) {
      if (String(b.date) > end || !b.fxTotal || !b.fxRate) continue;
      const closing = rate(b.currency, end);
      if (!closing) {
        missing.add(`${b.currency} on ${end}`);
        continue;
      }
      const ps = billPays.filter((p) => p.billId === b.id && String(p.date) <= end);
      const paidFx = ps.reduce((a, p) => a + Number(p.fxAmount ?? 0), 0);
      const open = b.fxTotal - paidFx;
      if (open <= 0) continue;
      add(r.ofBranch(b.branchId, b.companyId).companyId, "ap", revaluation(open, b.total - ps.reduce((a, p) => a + p.amount, 0), b.currency, closing));
    }
    for (const [companyId, { ar, ap }] of by) {
      // A receivable worth more is a gain; a payable costing more is a loss.
      const net = ar - ap;
      if (!ar && !ap) continue;
      const lines: PostLine[] = [ar > 0 ? dr("ar", ar) : cr("ar", -ar), ap > 0 ? cr("ap", ap) : dr("ap", -ap), net > 0 ? cr("fx_gain_loss", net) : dr("fx_gain_loss", -net)];
      const reversed = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
      const base = { sourceRef: `FX ${end.slice(0, 7)}`, party: "", companyId };
      out.push({ ...base, sourceType: "fx_revaluation", sourceId: `${end}:${companyId}`, date: end, narration: `Foreign balances restated at the rates on ${end}`, lines });
      out.push({ ...base, sourceType: "fx_revaluation_reversal", sourceId: `${end}:${companyId}`, date: dayAfter(end), narration: `Reversal of the restatement on ${end}`, lines: reversed });
    }
  }
  for (const m of [...missing].slice(0, 5)) notes.push({ source: "Revaluation", ref: m.split(" ")[0], why: `No rate for ${m} — foreign balances weren't restated that month` });
  return out;
}

// ─── Store and POS ───

async function storeWants(orgId: string, notes: Note[], r: Resolver) {
  const stores = await db
    .select({ projectId: schema.stores.projectId, region: schema.stores.region, currency: schema.stores.currency })
    .from(schema.stores)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.stores.projectId))
    .where(eq(schema.projects.orgId, orgId));
  if (!stores.length) return [];
  const byProject = new Map(stores.map((s) => [s.projectId, s]));
  const orders = await db
    .select()
    .from(schema.storeOrders)
    .where(and(inArray(schema.storeOrders.projectId, stores.map((s) => s.projectId)), isNotNull(schema.storeOrders.paidAt), inArray(schema.storeOrders.financialStatus, ["paid", "partially_refunded", "refunded"])));
  const items = orders.length ? await db.select().from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, orders.map((o) => o.id))) : [];
  // Cost of what was sold, for products tracked in Inventory.
  const tracked = await db.select({ variantId: schema.invItems.variantId, avgCost: schema.invItems.avgCost }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), isNotNull(schema.invItems.variantId)));
  const costOf = new Map(tracked.map((t) => [t.variantId!, t.avgCost]));
  const out: Want[] = [];
  for (const o of orders) {
    const st = byProject.get(o.projectId)!;
    if (o.currency !== "INR") {
      notes.push({ source: "Store order", ref: o.invoiceNumber ?? `#${o.number}`, why: `In ${o.currency} — not posted` });
      continue;
    }
    const pos = o.channel === "pos";
    const addr = (o.shippingAddress ?? {}) as Address;
    const intra = pos || (!!st.region && st.region.trim().toLowerCase() === (addr.region ?? "").trim().toLowerCase());
    const t = splitTax(o.taxTotal, intra);
    const method = (o.pos as { method?: string } | null)?.method;
    const into = pos ? (method === "cash" ? "cash" : "bank") : "clearing";
    const ref = o.invoiceNumber ?? `#${o.number}`;
    const lines: PostLine[] = [dr(into, o.total), cr("store_sales", o.total - o.taxTotal), cr("cgst_out", t.cgst), cr("sgst_out", t.sgst), cr("igst_out", t.igst)];
    const cogs = items.filter((i) => i.orderId === o.id && i.variantId && costOf.has(i.variantId)).reduce((a, i) => a + i.quantity * (i.unitCost || costOf.get(i.variantId!)!), 0);
    if (cogs > 0) lines.push(dr("cogs", cogs, "Cost of goods sold"), cr("inventory", cogs, "Cost of goods sold"));
    out.push({ sourceType: "store_sale", sourceId: o.id, date: istDate(o.paidAt), narration: `${pos ? "Counter sale" : "Store order"} ${ref}`, sourceRef: ref, party: (addr as { name?: string }).name ?? "", lines, ...r.ofProject(o.projectId) });
  }
  // Refunds: tax comes back in the same proportion as on the order.
  const refunds = rowsOf<{ id: string; order_id: string; project_id: string; amount: number; at: string; total: number; tax_total: number; channel: string; pos: { method?: string } | null; invoice_number: string | null; number: number; currency: string }>(
    await db.execute(sql`
      select e.id, e.order_id, o.project_id, (e.data->>'amount')::bigint as amount, e.created_at as at, o.total, o.tax_total, o.channel, o.pos, o.invoice_number, o.number, o.currency
      from store_order_events e join store_orders o on o.id = e.order_id
      join projects p on p.id = o.project_id
      where p.org_id = ${orgId} and e.kind = 'refunded' and e.data ? 'amount'`),
  );
  for (const rf of refunds) {
    if (rf.currency !== "INR" || !Number(rf.amount)) continue;
    const o = orders.find((x) => x.id === rf.order_id);
    const st = o ? byProject.get(o.projectId) : undefined;
    const addr = ((o?.shippingAddress ?? {}) as Address).region ?? "";
    const intra = rf.channel === "pos" || (!!st?.region && st.region.trim().toLowerCase() === addr.trim().toLowerCase());
    const amount = Number(rf.amount);
    const tax = Number(rf.total) ? Math.round((amount * Number(rf.tax_total)) / Number(rf.total)) : 0;
    const t = splitTax(tax, intra);
    const from = rf.channel === "pos" ? (rf.pos?.method === "cash" ? "cash" : "bank") : "clearing";
    const ref = rf.invoice_number ?? `#${rf.number}`;
    out.push({ sourceType: "store_refund", sourceId: rf.id, date: istDate(rf.at), narration: `Refund on ${ref}`, sourceRef: ref, party: "", lines: [dr("returns", amount - tax), dr("cgst_out", t.cgst), dr("sgst_out", t.sgst), dr("igst_out", t.igst), cr(from, amount)], ...r.ofProject(rf.project_id) });
  }
  return out;
}

// ─── Restaurants (Cloudesk for Horeca) ───

/** Paid restaurant bills: money in by how it was paid; food, service and delivery as restaurant sales; GST; tips owed to staff. */
async function horecaWants(orgId: string, r: Resolver) {
  const venues = await db
    .select({ v: schema.horecaVenues, name: schema.projects.name })
    .from(schema.horecaVenues)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.horecaVenues.projectId))
    .where(eq(schema.projects.orgId, orgId));
  if (!venues.length) return [];
  const orders = await db.select().from(schema.horecaOrders).where(and(inArray(schema.horecaOrders.projectId, venues.map((v) => v.v.projectId)), eq(schema.horecaOrders.status, "paid")));
  const items = orders.length ? await db.select().from(schema.horecaOrderItems).where(inArray(schema.horecaOrderItems.orderId, orders.map((o) => o.id))) : [];
  const into: Record<string, string> = { cash: "cash", upi: "bank", card: "bank", other: "bank", room: "ar", points: "returns" };
  const out: Want[] = [];
  for (const o of orders) {
    const venue = venues.find((v) => v.v.projectId === o.projectId)!;
    const t = totalsOf(o, items.filter((i) => i.orderId === o.id), venue.v);
    const half = Math.floor(t.tax / 2);
    const pays = (o.payments as { method: string; amount: number }[]) ?? [];
    const lines: PostLine[] = pays.map((p) => dr(into[p.method] ?? "bank", p.amount, p.method === "points" ? "Paid with loyalty points" : p.method === "room" ? "Charged to the room" : ""));
    lines.push(cr("restaurant_sales", t.subtotal - t.discount + t.service + t.delivery), cr("cgst_out", t.tax - half), cr("sgst_out", half), cr("tips_payable", t.tip));
    // Anything the payments and the bill don't agree on (round-off, change kept) is round-off.
    const diff = lines.reduce((a, l) => a + l.debit - l.credit, 0);
    if (diff) lines.push(cr("round_off", diff));
    out.push({ sourceType: "restaurant_sale", sourceId: o.id, date: istDate(o.closedAt ?? o.billedAt ?? o.createdAt), narration: `Bill #${o.number} · ${venue.name}`, sourceRef: `#${o.number}`, party: "", lines, ...r.ofProject(o.projectId) });
  }
  return out;
}

// ─── Bills (and goods received) ───

/** Goods received in Inventory become bills, so what you owe the supplier is tracked in one place. */
export async function billsFromReceipts(s: Pick<Scope, "orgId" | "settings">) {
  const pending = await db
    .select({ r: schema.invReceipts, sup: schema.invSuppliers, wh: schema.invWarehouses })
    .from(schema.invReceipts)
    .leftJoin(schema.accBills, eq(schema.accBills.receiptId, schema.invReceipts.id))
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invReceipts.supplierId))
    .innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invReceipts.warehouseId))
    // Everything rejected at inspection: nothing to bill.
    .where(and(eq(schema.invReceipts.orgId, s.orgId), isNull(schema.accBills.id), sql`${schema.invReceipts.total} > 0`));
  if (!pending.length) return 0;
  const keys = await accountKeys(s.orgId);
  const inventory = keys.get("inventory")!;
  const where = await resolver(s.orgId);
  for (const { r, sup, wh } of pending) {
    // One bill line per GST rate, valued as received.
    const byRate = new Map<number, number>();
    for (const l of r.lines) byRate.set(l.gstRate, (byRate.get(l.gstRate) ?? 0) + Math.round(l.qty * l.rate));
    const number = await nextNumber(s.orgId, "bill", s.settings.billPrefix);
    const due = sup ? new Date(Date.parse(`${r.date}T00:00:00Z`) + sup.paymentTermsDays * 86400_000).toISOString().slice(0, 10) : null;
    await db
      .insert(schema.accBills)
      .values({
        orgId: s.orgId,
        number,
        supplierId: sup?.id ?? null,
        supplierName: sup?.name ?? "Supplier not named",
        billNo: r.supplierInvoice,
        date: String(r.date),
        dueDate: due,
        lines: [...byRate.entries()].map(([gstRate, amount]) => ({ accountId: inventory, description: `Goods received ${r.number}`, amount, gstRate })),
        itc: true,
        interState: !!sup?.state && !!wh.state && sup.state !== wh.state,
        subtotal: r.subtotal,
        tax: r.tax,
        total: r.total,
        receiptId: r.id,
        notes: `Made from goods received ${r.number}.`,
        companyId: where.ofWarehouse(wh.id).companyId,
        branchId: where.ofWarehouse(wh.id).branchId,
      })
      .onConflictDoNothing();
  }
  return pending.length;
}

async function billWants(orgId: string, r: Resolver) {
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, orgId), notInArray(schema.accBills.status, NOT_POSTED)));
  const pays = await db.select({ p: schema.accBillPayments, number: schema.accBills.number, supplier: schema.accBills.supplierName }).from(schema.accBillPayments).innerJoin(schema.accBills, eq(schema.accBills.id, schema.accBillPayments.billId)).where(and(eq(schema.accBillPayments.orgId, orgId), notInArray(schema.accBills.status, NOT_POSTED)));
  const out: Want[] = [];
  for (const b of bills) {
    const half = Math.floor(b.tax / 2);
    const split = b.interState ? { igst: b.tax, cgst: 0, sgst: 0 } : { igst: 0, cgst: b.tax - half, sgst: half };
    const lines: PostLine[] = [];
    // Without input credit, the GST is part of the cost, shared across the lines.
    let given = 0;
    b.lines.forEach((l, i) => {
      const share = b.itc ? 0 : i === b.lines.length - 1 ? b.tax - given : Math.round((b.tax * l.amount) / (b.subtotal || 1));
      given += share;
      lines.push({ accountId: l.accountId, debit: l.amount + share, credit: 0, description: l.description, costCentreId: (l as { costCentreId?: string | null }).costCentreId ?? null });
    });
    if (b.itc) lines.push(dr("cgst_in", split.cgst), dr("sgst_in", split.sgst), dr("igst_in", split.igst));
    // Rounding on a goods receipt can leave the stored total a paisa off its parts.
    const diff = b.total - lines.reduce((a, l) => a + l.debit, 0);
    if (diff) lines.push(dr("round_off", diff));
    // TDS kept back is owed to the government, not the supplier.
    lines.push(cr("ap", b.total - b.tdsAmount), cr("tds_payable", b.tdsAmount));
    // A debit note is the same entry the other way round.
    const posted = b.kind === "debit_note" ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines;
    out.push({ sourceType: "bill", sourceId: b.id, date: String(b.date), narration: b.kind === "debit_note" ? `Debit note ${b.number}` : `Bill ${b.billNo || b.number}`, sourceRef: b.number, party: b.supplierName, lines: posted, ...r.ofBranch(b.branchId, b.companyId) });
  }
  const billRef = new Map(bills.map((b) => [b.id, r.ofBranch(b.branchId, b.companyId)]));
  // A foreign bill's payment settles its share at the bill's rate; paying more rupees than that is an exchange loss.
  for (const { p, number, supplier } of pays) out.push({ sourceType: "bill_payment", sourceId: p.id, date: String(p.date), narration: `Paid ${number}${p.reference ? ` · ${p.reference}` : ""}`, sourceRef: number, party: supplier, lines: [dr("ap", p.amount), { accountId: p.accountId, debit: 0, credit: p.amount + p.fxDiff }, p.fxDiff > 0 ? dr("fx_gain_loss", p.fxDiff) : cr("fx_gain_loss", -p.fxDiff)], ...(billRef.get(p.billId) ?? r.ofBranch(null)) });
  return out;
}

// ─── Stock adjustments ───

async function stockWants(orgId: string, r: Resolver) {
  const moves = await db
    .select({ m: schema.invMoves, item: schema.invItems.name })
    .from(schema.invMoves)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.invMoves.itemId))
    .where(and(eq(schema.invMoves.orgId, orgId), inArray(schema.invMoves.kind, ["adjust", "count"])));
  return moves
    .map(({ m, item }) => ({ m, item, value: Math.round(m.qty * m.unitCost) }))
    .filter((x) => x.value)
    .map(({ m, item, value }) => ({ sourceType: "stock", sourceId: m.id, date: istDate(m.createdAt), narration: `${m.kind === "count" ? "Count" : "Adjustment"}: ${item}${m.note ? ` — ${m.note}` : ""}`, sourceRef: m.refNo || (m.kind === "count" ? "Count" : "Adjustment"), party: "", lines: [dr("inventory", value), cr("stock_adjust", value)], ...r.ofWarehouse(m.warehouseId) }));
}

// ─── Payroll ───

async function payrollWants(orgId: string, r: Resolver) {
  const runs = await db.select().from(schema.hrPayrollRuns).where(and(eq(schema.hrPayrollRuns.orgId, orgId), inArray(schema.hrPayrollRuns.status, ["finalised", "paid"])));
  const claims = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.orgId, orgId), eq(schema.hrClaims.status, "paid"), isNull(schema.hrClaims.payrollRunId), isNull(schema.hrClaims.tripId), eq(schema.hrClaims.paidBy, "employee")));
  const slips = runs.length ? await db.select().from(schema.hrPayslips).where(inArray(schema.hrPayslips.runId, runs.map((x) => x.id))) : [];
  const out: Want[] = [];
  for (const run of runs) {
    const label = new Date(`${run.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
    // One journal per company the people work for; salary costs split by their cost centres.
    const mine = slips.filter((p) => p.runId === run.id);
    const byCompany = new Map<string, typeof mine>();
    for (const p of mine) {
      const c = r.ofEmployee(p.employeeId).companyId;
      byCompany.set(c, [...(byCompany.get(c) ?? []), p]);
    }
    // A run made before payslips were kept, or everyone in one company: one journal from the run's totals, as before.
    const groups: [string, typeof mine | null][] = byCompany.size > 1 ? [...byCompany.entries()] : [[[...byCompany.keys()][0] ?? r.defaultCompany, null]];
    for (const [companyId, group] of groups) {
      const t = (group ? payTotals(group) : run.totals) as Record<string, number>;
      const n = (k: string) => Math.round(Number(t[k] ?? 0));
      const statutory = n("pf") + n("esi") + n("pt") + n("tds");
      const other = n("deductions") - statutory;
      // Costs by cost centre (people without one are uncharged).
      const costs: PostLine[] = [];
      const centres = new Map<string, typeof mine>();
      for (const p of group ?? mine) {
        const cc = r.ofEmployee(p.employeeId).costCentreId ?? "";
        centres.set(cc, [...(centres.get(cc) ?? []), p]);
      }
      if (centres.size > 1 || (centres.size === 1 && !centres.has(""))) {
        for (const [cc, ps] of centres) {
          const ct = payTotals(ps) as Record<string, number>;
          const m = (k: string) => Math.round(Number(ct[k] ?? 0));
          costs.push({ ...dr("salaries", m("gross")), costCentreId: cc || null }, { ...dr("employer_contrib", m("epf") + m("eesi")), costCentreId: cc || null }, { ...dr("reimbursements", m("reimbursements")), costCentreId: cc || null });
        }
      } else costs.push(dr("salaries", n("gross")), dr("employer_contrib", n("epf") + n("eesi")), dr("reimbursements", n("reimbursements")));
      const lines: PostLine[] = [
        ...costs,
        cr("pf_payable", n("pf") + n("epf")),
        cr("esi_payable", n("esi") + n("eesi")),
        cr("pt_payable", n("pt")),
        cr("tds_payable", n("tds")),
        // Deductions that aren't statutory (an advance being recovered) reduce what was advanced.
        cr("advances", other),
        cr("salaries_payable", n("net")),
      ];
      const id = groups.length > 1 ? `${run.id}:${companyId}` : run.id;
      out.push({ sourceType: "payroll", sourceId: id, date: lastDay(run.month), narration: `Payroll ${label}`, sourceRef: `Payroll ${label}`, party: "", lines, companyId, branchId: null });
      if (run.status === "paid") out.push({ sourceType: "payroll_payment", sourceId: id, date: istDate(run.paidAt), narration: `Salaries paid for ${label}`, sourceRef: `Payroll ${label}`, party: "", lines: [dr("salaries_payable", n("net")), cr("bank", n("net"))], companyId, branchId: null });
    }
  }
  for (const c of claims) {
    const e = r.ofEmployee(c.employeeId);
    out.push({ sourceType: "claim", sourceId: c.id, date: c.decidedAt ? istDate(c.decidedAt) : String(c.date), narration: `Claim paid: ${c.description || c.category}`, sourceRef: "Claim", party: "", lines: [{ ...dr("reimbursements", c.amount), costCentreId: e.costCentreId ?? null }, cr("bank", c.amount)], companyId: e.companyId, branchId: e.branchId });
  }
  return out;
}

// ─── Making the ledger match ───

const AUTO = ["invoice", "credit_note", "invoice_payment", "store_sale", "store_refund", "restaurant_sale", "bill", "bill_payment", "stock", "payroll", "payroll_payment", "claim", "depreciation", "asset_disposal", "recurring", "recurring_reversal", "spread", "tds_deposit", "receipt_advance", "fx_revaluation", "fx_revaluation_reversal", "intercompany", "production", "settlement", "travel_advance", "trip_settlement", "card_spend", "card_personal", "card_repaid", "maintenance_parts", "fuel", "trip_costs", "freight", "fee", "fee_payment", "clinic_bill", "clinic_payment", "ra_bill", "contract_receipt"];
// Company and dimensions only enter the hash when set, so entries posted before they existed aren't re-posted.
const hashOf = (w: Want, bankId: string, def: string) =>
  createHash("sha1")
    .update(JSON.stringify([w.date, w.party, w.narration, bankId, w.lines.filter((l) => l.debit || l.credit).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null && v !== undefined))), ...(w.companyId && w.companyId !== def ? [w.companyId] : [])]))
    .digest("hex");
const SOURCE: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", invoice_payment: "Invoice payment", store_sale: "Store sale", store_refund: "Store refund", restaurant_sale: "Restaurant bill", bill: "Bill", bill_payment: "Bill payment", stock: "Stock adjustment", payroll: "Payroll", payroll_payment: "Salary payment", claim: "Claim", depreciation: "Depreciation", asset_disposal: "Asset disposal", recurring: "Repeating journal", recurring_reversal: "Reversal", spread: "Spread", tds_deposit: "TDS deposit", receipt_advance: "Customer advance", fx_revaluation: "Exchange revaluation", fx_revaluation_reversal: "Revaluation reversal", intercompany: "Intercompany", production: "Production", settlement: "Full and final", travel_advance: "Travel advance", trip_settlement: "Trip settlement", card_spend: "Company card", card_personal: "Personal card spend", card_repaid: "Card spend repaid", maintenance_parts: "Spare parts", fuel: "Fuel", trip_costs: "Trip costs", freight: "Freight", fee: "Fee", fee_payment: "Fee received", clinic_bill: "Clinic bill", clinic_payment: "Clinic payment", ra_bill: "RA bill", contract_receipt: "Contract receipt" };

export async function sync(s: Scope) {
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const notes: Note[] = [];
  const on = s.settings.autoPost;
  await addMissingAccounts(s.orgId);
  if (on.inventory) await billsFromReceipts(s);
  const r = await resolver(s.orgId);
  const rate = await ratesOf(s.orgId);
  const all: Want[] = [
    ...(on.invoices && isOn(org?.modules, "invoicing") ? await invoiceWants(s.orgId, notes, r, rate) : []),
    ...(on.store ? await storeWants(s.orgId, notes, r) : []),
    ...(on.store && isOn(org?.modules, "horeca") ? await horecaWants(s.orgId, r) : []),
    ...(await billWants(s.orgId, r)),
    ...(on.inventory && isOn(org?.modules, "inventory") ? await stockWants(s.orgId, r) : []),
    ...(on.payroll && isOn(org?.modules, "hr") ? await payrollWants(s.orgId, r) : []),
    ...(await assetWants(s.orgId, r.defaultCompany)),
    ...(await scheduleWants(s.orgId, r.defaultCompany)),
    ...(await depositWants(s.orgId, r.defaultCompany)),
    ...(await receiptWants(s.orgId, r)),
    ...(await intercompanyWants(s.orgId)),
    ...(isOn(org?.modules, "manufacturing") ? await productionWants(s.orgId) : []),
    ...(on.payroll && isOn(org?.modules, "hr") ? await settlementWants(s.orgId, (id) => r.ofEmployee(id)) : []),
    ...(on.payroll && isOn(org?.modules, "hr") ? await travelWants(s.orgId, (id) => r.ofEmployee(id)) : []),
    ...(on.inventory && isOn(org?.modules, "maintenance") ? await maintenanceWants(s.orgId, (id) => r.ofWarehouse(id)) : []),
    ...(isOn(org?.modules, "logistics") ? await logisticsWants(s.orgId, (id) => r.ofWarehouse(id)) : []),
    ...(isOn(org?.modules, "education") ? await educationWants(s.orgId) : []),
    ...(isOn(org?.modules, "clinic") ? await clinicWants(s.orgId) : []),
    ...(isOn(org?.modules, "construction") ? await constructionWants(s.orgId) : []),
    ...(await revaluationWants(s.orgId, r, rate, notes)),
  ];
  const wants = all.map((w) => ({ ...w, companyId: w.companyId ?? r.defaultCompany, lines: w.lines.filter((l) => l.debit || l.credit).map((l) => (w.branchId && !l.branchId ? { ...l, branchId: w.branchId } : l)) }));
  const closed = await closedTest(s.orgId);
  const keys = await accountKeys(s.orgId);
  // "bank" means the workspace's chosen bank account.
  const bankId = s.settings.defaultBankId ?? keys.get("bank") ?? "";
  if (bankId) keys.set("bank", bankId);
  const existing = await db.select({ id: schema.accJournals.id, sourceType: schema.accJournals.sourceType, sourceId: schema.accJournals.sourceId, hash: schema.accJournals.hash, date: schema.accJournals.date, sourceRef: schema.accJournals.sourceRef, companyId: schema.accJournals.companyId }).from(schema.accJournals).where(and(eq(schema.accJournals.orgId, s.orgId), inArray(schema.accJournals.sourceType, AUTO)));
  const reconciled = new Set(
    (await db.selectDistinct({ j: schema.accLines.journalId }).from(schema.accLines).where(and(eq(schema.accLines.orgId, s.orgId), isNotNull(schema.accLines.reconciledAt)))).map((r) => r.j),
  );
  const have = new Map(existing.map((e) => [`${e.sourceType}|${e.sourceId}`, e]));
  const locked = (d: string, companyId?: string | null) => (!!s.settings.lockDate && d <= s.settings.lockDate) || closed(d, companyId);
  let added = 0;
  let changed = 0;
  let removed = 0;
  const seen = new Set<string>();
  for (const w of wants) {
    const k = `${w.sourceType}|${w.sourceId}`;
    seen.add(k);
    const hash = hashOf(w, bankId, r.defaultCompany);
    const cur = have.get(k);
    if (cur && cur.hash === hash) continue;
    const where = { source: SOURCE[w.sourceType] ?? w.sourceType, ref: w.sourceRef };
    if (locked(w.date, w.companyId) || (cur && locked(String(cur.date), cur.companyId))) {
      notes.push({ ...where, why: cur ? "Changed in a locked period — not updated" : "Dated in a locked period — not posted" });
      continue;
    }
    if (cur && reconciled.has(cur.id)) {
      notes.push({ ...where, why: "Changed, but it's matched to a bank statement — unmatch it to update" });
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        if (cur) await tx.delete(schema.accJournals).where(eq(schema.accJournals.id, cur.id));
        await postJournal(tx, s, { ...w, hash, companyId: w.companyId }, keys);
      });
      if (cur) changed++;
      else added++;
    } catch (e) {
      notes.push({ ...where, why: e instanceof Error ? e.message : "Couldn't post" });
    }
  }
  for (const e of existing) {
    const k = `${e.sourceType}|${e.sourceId}`;
    if (seen.has(k)) continue;
    if (locked(String(e.date), e.companyId) || reconciled.has(e.id)) {
      notes.push({ source: SOURCE[e.sourceType] ?? e.sourceType, ref: e.sourceRef, why: "Its source was cancelled or removed, but the entry is locked or matched to a bank statement" });
      continue;
    }
    await db.delete(schema.accJournals).where(eq(schema.accJournals.id, e.id));
    removed++;
  }
  await db.update(schema.accSettings).set({ syncedAt: new Date(), syncNotes: notes.slice(0, 200) }).where(eq(schema.accSettings.orgId, s.orgId));
  return { added, changed, removed, notes };
}

/** Sync if it hasn't run in the last minute; screens call this so the books stay current without a button. */
export async function syncIfStale(s: Scope) {
  const [row] = await db.select({ at: schema.accSettings.syncedAt }).from(schema.accSettings).where(eq(schema.accSettings.orgId, s.orgId));
  if (row?.at && Date.now() - row.at.getTime() < 60_000) return null;
  return sync(s);
}

/** For the scheduler: keep every workspace with Accounting current. */
export async function syncAll() {
  const orgs = await db.select({ orgId: schema.accSettings.orgId }).from(schema.accSettings);
  for (const o of orgs) {
    try {
      await sync(await systemScope(o.orgId));
    } catch (e) {
      log.warn("accounting sync failed", { orgId: o.orgId, error: String(e) });
    }
  }
}

