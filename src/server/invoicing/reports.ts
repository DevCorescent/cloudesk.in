// Invoicing reports, computed from issued documents and recorded payments
// only (drafts and void documents never count). Every figure here is a sum
// of real rows; nothing is estimated.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { displayStatus, type DocStatus, type DocType, type Party } from "@/lib/invoicing/model";
import { computeDocTotals, type TaxRow } from "@/lib/invoicing/totals";
import type { Adjustments, Line, TaxMode } from "@/lib/invoicing/model";
import { minorDigits } from "@/lib/store/money";
import { listPayments, today } from "./service";

const ISSUED = ["sent", "viewed", "partial", "paid", "accepted", "declined", "converted"];
const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const monthOf = (d: string) => d.slice(0, 7);

export async function invoicingReport(projectId: string, range: { from: string; to: string }) {
  const t = today();
  const docs = await db.select().from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, projectId), inArray(schema.invoiceDocuments.status, ISSUED)));
  const invoices = docs.filter((d) => d.type === "invoice");
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const invRange = invoices.filter((d) => inRange(iso(d.issueDate)));
  const credits = docs.filter((d) => d.type === "credit_note" && inRange(iso(d.issueDate)));
  const payments = await listPayments(projectId, range);
  const currency = invoices[0]?.currency ?? docs[0]?.currency ?? "INR";

  // Receivables now, by age past the due date.
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const d of invoices) {
    const bal = d.total - d.amountPaid;
    if (bal <= 0) continue;
    outstanding += bal;
    const due = d.dueDate ? iso(d.dueDate) : null;
    const late = due ? Math.floor((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000) : 0;
    if (late <= 0) aging.current += bal;
    else {
      overdue += bal;
      overdueCount++;
      if (late <= 30) aging.d1_30 += bal;
      else if (late <= 60) aging.d31_60 += bal;
      else if (late <= 90) aging.d61_90 += bal;
      else aging.d90 += bal;
    }
  }

  // Last 12 months: invoiced (by issue date) vs collected (by payment date).
  const months: { month: string; invoiced: number; collected: number }[] = [];
  const end = new Date(`${range.to}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    months.push({ month: m, invoiced: 0, collected: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const d of invoices) {
    const m = byMonth.get(monthOf(iso(d.issueDate)));
    if (m) m.invoiced += d.total;
  }
  const allPayments = await listPayments(projectId, { from: `${months[0].month}-01`, to: range.to });
  for (const p of allPayments) {
    const m = byMonth.get(monthOf(iso(p.paidOn)));
    if (m) m.collected += p.amount;
  }

  // Clients by value invoiced in the range.
  const clientMap = new Map<string, { name: string; invoiced: number; paid: number; balance: number; count: number }>();
  for (const d of invRange) {
    const c = d.client as Party;
    const key = d.clientId ?? `name:${(c.company || c.name).toLowerCase()}`;
    const r = clientMap.get(key) ?? { name: c.company || c.name, invoiced: 0, paid: 0, balance: 0, count: 0 };
    r.invoiced += d.total;
    r.paid += d.amountPaid;
    r.balance += d.total - d.amountPaid;
    r.count++;
    clientMap.set(key, r);
  }
  const topClients = [...clientMap.values()].sort((a, b) => b.invoiced - a.invoiced).slice(0, 10);

  // Quotes issued in the range and what happened to them.
  const quotes = docs.filter((d) => d.type === "quote" && inRange(iso(d.issueDate)));
  const won = quotes.filter((q) => q.status === "accepted" || q.status === "converted");
  const quoteStats = {
    count: quotes.length,
    value: quotes.reduce((a, q) => a + q.total, 0),
    won: won.length,
    wonValue: won.reduce((a, q) => a + q.total, 0),
    declined: quotes.filter((q) => q.status === "declined").length,
    open: quotes.filter((q) => (q.status === "sent" || q.status === "viewed") && displayStatus({ type: "quote", status: q.status as DocStatus, total: q.total, amountPaid: 0, dueDate: q.dueDate ? iso(q.dueDate) : null }, t) !== "expired").length,
    conversion: quotes.length ? won.length / quotes.length : null,
  };

  // Days from issue to full payment, for invoices paid in the range.
  const paidDays = invoices.filter((d) => d.paidAt && inRange(iso(d.paidAt))).map((d) => Math.max(0, Math.round((d.paidAt!.getTime() - Date.parse(`${iso(d.issueDate)}T00:00:00Z`)) / 86_400_000)));
  const avgDaysToPay = paidDays.length ? Math.round(paidDays.reduce((a, b) => a + b, 0) / paidDays.length) : null;

  // Tax collected on invoices issued in the range, less credit notes.
  const taxMap = new Map<string, { label: string; taxable: number; amount: number }>();
  const addTax = (rows: TaxRow[], sign: 1 | -1) => {
    for (const r of rows) {
      const x = taxMap.get(r.label) ?? { label: r.label, taxable: 0, amount: 0 };
      x.taxable += sign * r.taxable;
      x.amount += sign * r.amount;
      taxMap.set(r.label, x);
    }
  };
  invRange.forEach((d) => addTax(d.taxes as TaxRow[], 1));
  credits.forEach((d) => addTax(d.taxes as TaxRow[], -1));
  const taxes = [...taxMap.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const gst = { cgst: 0, sgst: 0, igst: 0, other: 0 };
  for (const x of taxes) {
    if (x.label.startsWith("CGST")) gst.cgst += x.amount;
    else if (x.label.startsWith("SGST")) gst.sgst += x.amount;
    else if (x.label.startsWith("IGST")) gst.igst += x.amount;
    else gst.other += x.amount;
  }

  const methods = new Map<string, { method: string; amount: number; count: number }>();
  for (const p of payments) {
    const m = methods.get(p.method) ?? { method: p.method, amount: 0, count: 0 };
    m.amount += p.amount;
    m.count++;
    methods.set(p.method, m);
  }

  const statusCounts: Record<string, number> = {};
  for (const d of docs.filter((x) => x.type === "invoice")) {
    const s = displayStatus({ type: "invoice", status: d.status as DocStatus, total: d.total, amountPaid: d.amountPaid, dueDate: d.dueDate ? iso(d.dueDate) : null }, t);
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  const invoiced = invRange.reduce((a, d) => a + d.total, 0);
  const credited = credits.reduce((a, d) => a + d.total, 0);
  const collected = payments.reduce((a, p) => a + p.amount, 0);
  return {
    range,
    currency,
    mixedCurrencies: new Set(docs.map((d) => d.currency)).size > 1,
    kpis: { invoiced, credited, net: invoiced - credited, collected, outstanding, overdue, overdueCount, invoiceCount: invRange.length, avgDaysToPay, avgInvoice: invRange.length ? Math.round(invoiced / invRange.length) : null },
    months,
    aging,
    topClients,
    quotes: quoteStats,
    taxes,
    gst,
    methods: [...methods.values()].sort((a, b) => b.amount - a.amount),
    statusCounts,
  };
}

// ── CSV exports ─────────────────────────────────────────────────────────────

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
const major = (minor: number, currency = "INR") => (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency));

export async function exportCsv(projectId: string, kind: "documents" | "payments" | "tax" | "clients", range: { from: string; to: string }, type?: DocType) {
  const t = today();
  if (kind === "payments") {
    const rows = await listPayments(projectId, range);
    return csv([["Date", "Invoice", "Client", "Method", "Reference", "Amount", "Currency", "Note"], ...rows.map((p) => [iso(p.paidOn), p.number, p.client, p.method, p.reference, major(p.amount, p.currency), p.currency, p.note])]);
  }
  if (kind === "clients") {
    const rows = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.projectId, projectId), sql`${schema.invoiceClients.archivedAt} is null`));
    return csv([["Name", "Company", "Email", "Phone", "GSTIN", "Address", "City", "State", "Postal code"], ...rows.map((c) => { const a = c.billing as Party["billing"]; return [c.name, c.company, c.email, c.phone, c.gstin, [a.line1, a.line2].filter(Boolean).join(", "), a.city, a.state, a.postalCode]; })]);
  }
  const docs = await db
    .select()
    .from(schema.invoiceDocuments)
    .where(and(eq(schema.invoiceDocuments.projectId, projectId), sql`${schema.invoiceDocuments.status} <> 'draft'`, sql`${schema.invoiceDocuments.issueDate} >= ${range.from}`, sql`${schema.invoiceDocuments.issueDate} <= ${range.to}`, ...(type ? [eq(schema.invoiceDocuments.type, type)] : [])))
    .orderBy(schema.invoiceDocuments.issueDate);
  if (kind === "tax") {
    const header = ["Date", "Type", "Number", "Client", "Client GSTIN", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Other tax", "Total", "Currency", "Status"];
    const rows = docs.filter((d) => d.status !== "void" && (d.type === "invoice" || d.type === "credit_note")).map((d) => {
      const sign = d.type === "credit_note" ? -1 : 1;
      const tx = d.taxes as TaxRow[];
      const sum = (p: string) => tx.filter((x) => x.label.startsWith(p)).reduce((a, x) => a + x.amount, 0);
      const other = tx.filter((x) => !/^(CGST|SGST|IGST)/.test(x.label)).reduce((a, x) => a + x.amount, 0);
      const c = d.client as Party;
      // Taxable value recomputed exactly from the stored lines.
      const taxable = computeDocTotals({ lines: d.lines as Line[], adjustments: d.adjustments as Adjustments, taxMode: d.taxMode as TaxMode, inclusive: d.inclusive, intraState: tx.some((x) => x.label.startsWith("CGST")), currency: d.currency }).taxable;
      const m = (n: number) => major(sign * n, d.currency);
      return [iso(d.issueDate), d.type === "credit_note" ? "Credit note" : "Invoice", d.number, c.company || c.name, c.gstin, d.placeOfSupply || c.billing.state, m(taxable), m(sum("CGST")), m(sum("SGST")), m(sum("IGST")), m(other), m(d.total), d.currency, d.status];
    });
    return csv([header, ...rows]);
  }
  return csv([
    ["Type", "Number", "Issue date", "Due date", "Client", "Email", "GSTIN", "Subtotal", "Discount", "Tax", "Total", "Paid", "Balance", "Currency", "Status"],
    ...docs.map((d) => {
      const c = d.client as Party;
      const s = displayStatus({ type: d.type as DocType, status: d.status as DocStatus, total: d.total, amountPaid: d.amountPaid, dueDate: d.dueDate ? iso(d.dueDate) : null }, t);
      const m = (n: number) => major(n, d.currency);
      return [d.type, d.number, iso(d.issueDate), d.dueDate ? iso(d.dueDate) : "", c.company || c.name, c.email, c.gstin, m(d.subtotal), m(d.discountTotal), m(d.taxTotal), m(d.total), m(d.amountPaid), m(Math.max(0, d.total - d.amountPaid)), d.currency, s];
    }),
  ]);
}
