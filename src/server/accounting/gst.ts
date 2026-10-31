// GST returns as working summaries: GSTR-1 (outward supplies) from invoices,
// credit notes and store/POS orders, and GSTR-3B (tax payable after input
// credit) from the same sales and from bills. They're built to hand to whoever
// files — Cloudesk doesn't file with the GST portal.
import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { NOT_POSTED } from "@/lib/accounting/model";
import { csvEscape } from "@/lib/data/model";
import { db, schema } from "@/db";
import { computeDocTotals } from "@/lib/invoicing/totals";
import type { Adjustments, Line, TaxMode } from "@/lib/invoicing/model";
import { GST_STATES, stateCode } from "@/lib/store/gst";
import { ApiError } from "../http/errors";
import { B2CL_LIMIT, gstReport } from "../commerce/gst-report";
import { log } from "../log";
import type { Scope } from "./access";

type Amounts = { taxable: number; igst: number; cgst: number; sgst: number };
const zero = (): Amounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const add = (a: Amounts, b: Amounts): Amounts => ({ taxable: a.taxable + b.taxable, igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst });
const neg = (a: Amounts): Amounts => ({ taxable: -a.taxable, igst: -a.igst, cgst: -a.cgst, sgst: -a.sgst });

function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("validation_failed", "Use a month like 2026-10");
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

type Doc = { id: string; type: string; number: string; issue_date: string; total: number; tax_total: number; taxes: { label: string; rateBps: number; taxable: number; amount: number }[]; lines: Line[]; adjustments: Adjustments; tax_mode: TaxMode; inclusive: boolean; currency: string; place_of_supply: string; client: { name?: string; company?: string; gstin?: string } };

/** An invoice's taxable value and tax by head, from its printed tax rows. */
function amountsOf(d: Doc): Amounts {
  const a = zero();
  for (const t of d.taxes ?? []) {
    if (/^igst/i.test(t.label)) {
      a.igst += t.amount;
      a.taxable += t.taxable;
    } else if (/^cgst/i.test(t.label)) {
      a.cgst += t.amount;
      a.taxable += t.taxable;
    } else if (/^sgst|^utgst/i.test(t.label)) a.sgst += t.amount;
  }
  // Supplies with no tax still count at their value.
  if (!a.taxable) a.taxable = Number(d.total) - Number(d.tax_total);
  return a;
}

const posLabel = (state: string) => {
  const code = stateCode(state) ?? (Object.entries(GST_STATES).find(([c]) => c === state)?.[0] ?? null);
  return code ? `${code}-${GST_STATES[code]}` : state || "—";
};

export async function gstr1(s: Scope, month: string) {
  const { from, to } = monthBounds(month);
  const docs = ((await db.execute(sql`
    select d.id, d.type, d.number, d.issue_date::text, d.total, d.tax_total, d.taxes, d.lines, d.adjustments, d.tax_mode, d.inclusive, d.currency, d.place_of_supply, d.client
    from invoice_documents d join invoice_owners o on o.id = d.project_id
    left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${s.orgId} and d.type in ('invoice','credit_note') and d.status not in ('draft','void')
      and d.number <> '' and d.tax_mode = 'gst' and d.currency = 'INR' and d.issue_date between ${from} and ${to}`)) as unknown as { rows: Doc[] }).rows;

  const b2b: (Amounts & { gstin: string; name: string; invoice: string; date: string; value: number; placeOfSupply: string; source: string })[] = [];
  const b2cl: (Amounts & { invoice: string; date: string; value: number; placeOfSupply: string; source: string })[] = [];
  const b2cs = new Map<string, Amounts & { placeOfSupply: string; rate: number }>();
  const cdn: (Amounts & { gstin: string; name: string; note: string; date: string; value: number; source: string })[] = [];
  const hsn = new Map<string, Amounts & { hsn: string; rate: number }>();
  let totals = zero();

  for (const d of docs) {
    const amt = amountsOf(d);
    const party = d.client?.company || d.client?.name || "";
    const inter = amt.igst > 0;
    if (d.type === "credit_note") {
      cdn.push({ ...amt, gstin: d.client?.gstin ?? "", name: party, note: d.number, date: d.issue_date, value: Number(d.total), source: "Invoices" });
      totals = add(totals, neg(amt));
      continue;
    }
    totals = add(totals, amt);
    const pos = posLabel(d.place_of_supply);
    if (d.client?.gstin) b2b.push({ ...amt, gstin: d.client.gstin, name: party, invoice: d.number, date: d.issue_date, value: Number(d.total), placeOfSupply: pos, source: "Invoices" });
    else if (inter && Number(d.total) > B2CL_LIMIT) b2cl.push({ ...amt, invoice: d.number, date: d.issue_date, value: Number(d.total), placeOfSupply: pos, source: "Invoices" });
    else
      for (const t of (d.taxes ?? []).filter((x) => /^igst|^cgst/i.test(x.label))) {
        const rate = /^cgst/i.test(t.label) ? t.rateBps * 2 : t.rateBps;
        const k = `${pos}|${rate}`;
        const c = b2cs.get(k) ?? { ...zero(), placeOfSupply: pos, rate };
        const share = /^igst/i.test(t.label) ? { taxable: t.taxable, igst: t.amount, cgst: 0, sgst: 0 } : { taxable: t.taxable, igst: 0, cgst: t.amount, sgst: t.amount };
        b2cs.set(k, { ...add(c, share), placeOfSupply: pos, rate });
      }
    // HSN summary needs each line's taxable value; recompute it the way the invoice was.
    try {
      const calc = computeDocTotals({ lines: d.lines, adjustments: d.adjustments, taxMode: d.tax_mode, inclusive: d.inclusive, intraState: !inter, currency: d.currency });
      calc.lines.forEach((l, i) => {
        const line = d.lines[i];
        const k = `${line.hsn || "NA"}|${line.taxBps}`;
        const h = hsn.get(k) ?? { ...zero(), hsn: line.hsn || "NA", rate: line.taxBps };
        const half = Math.floor(l.tax / 2);
        hsn.set(k, { ...add(h, inter ? { taxable: l.taxable, igst: l.tax, cgst: 0, sgst: 0 } : { taxable: l.taxable, igst: 0, cgst: half, sgst: l.tax - half }), hsn: h.hsn, rate: h.rate });
      });
    } catch (e) {
      log.warn("gstr1 hsn recompute failed", { doc: d.id, error: String(e) });
    }
  }

  // Store and POS orders, from each store's own GST summary.
  const stores = await db.select({ projectId: schema.stores.projectId, name: schema.stores.name, country: schema.stores.country, currency: schema.stores.currency }).from(schema.stores).innerJoin(schema.projects, eq(schema.projects.id, schema.stores.projectId)).where(eq(schema.projects.orgId, s.orgId));
  const storeNotes: string[] = [];
  for (const st of stores) {
    if (st.country !== "IN" || st.currency !== "INR") continue;
    const r = await gstReport(st.projectId, month);
    if (!r.invoices && !r.creditNotes.length) continue;
    const src = `Store: ${st.name}`;
    totals = add(totals, r.totals);
    for (const x of r.b2b) b2b.push({ taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, gstin: x.gstin, name: x.name, invoice: x.invoice, date: x.date, value: x.total, placeOfSupply: x.placeOfSupply, source: src });
    for (const x of r.b2cl) b2cl.push({ taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, invoice: x.invoice, date: x.date, value: x.total, placeOfSupply: x.placeOfSupply, source: src });
    for (const x of r.b2cs) {
      const k = `${x.placeOfSupply}|${x.rate}`;
      const c = b2cs.get(k) ?? { ...zero(), placeOfSupply: x.placeOfSupply, rate: x.rate };
      b2cs.set(k, { ...add(c, x), placeOfSupply: x.placeOfSupply, rate: x.rate });
    }
    for (const x of r.hsn) {
      const k = `${x.hsn}|${x.rate}`;
      const h = hsn.get(k) ?? { ...zero(), hsn: x.hsn, rate: x.rate };
      hsn.set(k, { ...add(h, x), hsn: x.hsn, rate: x.rate });
    }
    for (const c of r.creditNotes) {
      // Store refunds are reported by value; the tax share is split as the order's was.
      cdn.push({ taxable: c.taxable, igst: 0, cgst: Math.floor(c.tax / 2), sgst: c.tax - Math.floor(c.tax / 2), gstin: "", name: "", note: `Refund on ${c.invoice}`, date: c.date, value: c.amount, source: src });
      totals = add(totals, neg({ taxable: c.taxable, igst: 0, cgst: Math.floor(c.tax / 2), sgst: c.tax - Math.floor(c.tax / 2) }));
    }
    storeNotes.push(`${st.name}: ${r.invoices} invoice${r.invoices === 1 ? "" : "s"}`);
  }
  return {
    month,
    gstin: s.settings.gstin,
    totals,
    b2b,
    b2cl,
    b2cs: [...b2cs.values()].sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate),
    cdn,
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    sources: [`Invoices: ${docs.filter((d) => d.type === "invoice").length}, credit notes: ${docs.filter((d) => d.type === "credit_note").length}`, ...storeNotes],
    notes: [
      "A working summary in GSTR-1's sections — not a filing. Check it with your accountant and file on the GST portal.",
      "Only invoices in rupees with GST switched on are included. Store refunds are listed as credit notes to raise.",
    ],
  };
}

/** GSTR-3B: tax on sales less input credit from bills, set off head by head. */
export async function gstr3b(s: Scope, month: string) {
  const { from, to } = monthBounds(month);
  const out = await gstr1(s, month);
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), notInArray(schema.accBills.status, NOT_POSTED), gte(schema.accBills.date, from), lte(schema.accBills.date, to)));
  const itc = zero();
  let ineligible = 0;
  for (const b of bills) {
    // Debit notes (supplier credit notes) reduce the input credit taken on their bills.
    const sign = b.kind === "debit_note" ? -1 : 1;
    if (!b.itc) {
      ineligible += sign * b.tax;
      continue;
    }
    const half = Math.floor(b.tax / 2);
    itc.taxable += sign * b.subtotal;
    if (b.interState) itc.igst += sign * b.tax;
    else {
      itc.cgst += sign * (b.tax - half);
      itc.sgst += sign * half;
    }
  }
  // Set-off: IGST credit first against IGST, then CGST, then SGST; CGST against CGST then IGST; SGST against SGST then IGST.
  const owe = { igst: Math.max(0, out.totals.igst), cgst: Math.max(0, out.totals.cgst), sgst: Math.max(0, out.totals.sgst) };
  const credit = { igst: itc.igst, cgst: itc.cgst, sgst: itc.sgst };
  const setOff = (from: keyof typeof credit, to: keyof typeof owe) => {
    const n = Math.min(credit[from], owe[to]);
    credit[from] -= n;
    owe[to] -= n;
  };
  setOff("igst", "igst");
  setOff("igst", "cgst");
  setOff("igst", "sgst");
  setOff("cgst", "cgst");
  setOff("cgst", "igst");
  setOff("sgst", "sgst");
  setOff("sgst", "igst");
  return {
    month,
    outward: out.totals,
    itc,
    ineligible,
    bills: bills.length,
    payable: { ...owe, total: owe.igst + owe.cgst + owe.sgst },
    carryForward: { ...credit, total: credit.igst + credit.cgst + credit.sgst },
    notes: [
      "Outward supplies are the same sales as GSTR-1 for the month; input credit comes from bills dated in the month that are marked as eligible.",
      "Check input credit against GSTR-2B before you claim it — Cloudesk can't see what your suppliers filed.",
      "Reverse charge, exempt and nil-rated supplies, interest and late fees aren't worked out here.",
    ],
  };
}

const rupees = (p: number) => (p / 100).toFixed(2);
const cell = (v: unknown) => csvEscape(v === null || v === undefined ? "" : String(v));

export function gstr1Csv(r: Awaited<ReturnType<typeof gstr1>>, section: string) {
  const rows: unknown[][] =
    section === "b2b"
      ? [["GSTIN", "Receiver", "Invoice", "Date", "Invoice value", "Place of supply", "Taxable", "IGST", "CGST", "SGST", "Source"], ...r.b2b.map((x) => [x.gstin, x.name, x.invoice, x.date, rupees(x.value), x.placeOfSupply, rupees(x.taxable), rupees(x.igst), rupees(x.cgst), rupees(x.sgst), x.source])]
      : section === "b2cl"
        ? [["Invoice", "Date", "Invoice value", "Place of supply", "Taxable", "IGST", "Source"], ...r.b2cl.map((x) => [x.invoice, x.date, rupees(x.value), x.placeOfSupply, rupees(x.taxable), rupees(x.igst), x.source])]
        : section === "b2cs"
          ? [["Place of supply", "Rate %", "Taxable", "IGST", "CGST", "SGST"], ...r.b2cs.map((x) => [x.placeOfSupply, x.rate / 100, rupees(x.taxable), rupees(x.igst), rupees(x.cgst), rupees(x.sgst)])]
          : section === "cdn"
            ? [["GSTIN", "Party", "Note", "Date", "Value", "Taxable", "IGST", "CGST", "SGST", "Source"], ...r.cdn.map((x) => [x.gstin, x.name, x.note, x.date, rupees(x.value), rupees(x.taxable), rupees(x.igst), rupees(x.cgst), rupees(x.sgst), x.source])]
            : [["HSN", "Rate %", "Taxable", "IGST", "CGST", "SGST"], ...r.hsn.map((x) => [x.hsn, x.rate / 100, rupees(x.taxable), rupees(x.igst), rupees(x.cgst), rupees(x.sgst)])];
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
