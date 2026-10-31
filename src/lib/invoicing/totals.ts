// Document totals: line discounts, a document discount shared across lines
// by value, extra charges, tax (exclusive or inclusive) with the India GST
// split, and round-off. Pure and deterministic — the editor, the printed
// document and the server all use this one function.
import { minorDigits } from "../store/money";
import type { Adjustments, Line, TaxMode } from "./model";

export type TaxRow = { label: string; rateBps: number; taxable: number; amount: number };
export type LineTotal = { id: string; gross: number; discount: number; taxable: number; tax: number; amount: number };
export type DocTotals = {
  lines: LineTotal[];
  /** Sum of quantity × rate. */
  subtotal: number;
  /** Line discounts plus the document discount. */
  discount: number;
  charges: number;
  taxable: number;
  taxes: TaxRow[];
  tax: number;
  roundOff: number;
  total: number;
  /** HSN/SAC-wise summary for GST invoices. */
  hsn: { hsn: string; taxable: number; rateBps: number; tax: number }[];
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0).replace(/\.?0+$/, "")}%`;

export function lineGross(l: Pick<Line, "quantity" | "rate">) {
  return Math.round(l.quantity * l.rate);
}

export function computeDocTotals(input: { lines: Line[]; adjustments: Adjustments; taxMode: TaxMode; inclusive: boolean; intraState: boolean; currency: string; taxLabel?: string }): DocTotals {
  const { lines, adjustments: adj, taxMode } = input;
  const gross = lines.map(lineGross);
  const lineDisc = lines.map((l, i) => {
    if (!l.discount) return 0;
    const d = l.discount.kind === "percent" ? Math.round((gross[i] * Math.min(100, l.discount.value)) / 100) : Math.round(l.discount.value);
    return Math.min(gross[i], Math.max(0, d));
  });
  const afterLine = gross.map((g, i) => g - lineDisc[i]);
  const base = afterLine.reduce((a, b) => a + b, 0);
  let docDisc = 0;
  if (adj.discount) docDisc = Math.min(base, Math.max(0, adj.discount.kind === "percent" ? Math.round((base * Math.min(100, adj.discount.value)) / 100) : Math.round(adj.discount.value)));
  // Share the document discount by value; the last line takes the rounding difference.
  let given = 0;
  const share = afterLine.map((v, i) => {
    if (i === afterLine.length - 1) return docDisc - given;
    const s = base ? Math.round((docDisc * v) / base) : 0;
    given += s;
    return s;
  });

  const taxed = (net: number, bps: number) => {
    if (taxMode === "none" || !bps) return { taxable: net, tax: 0 };
    if (input.inclusive) {
      const taxable = Math.round(net / (1 + bps / 10_000));
      return { taxable, tax: net - taxable };
    }
    return { taxable: net, tax: Math.round((net * bps) / 10_000) };
  };

  const out: LineTotal[] = lines.map((l, i) => {
    const net = Math.max(0, afterLine[i] - share[i]);
    const t = taxed(net, l.taxBps);
    return { id: l.id, gross: gross[i], discount: lineDisc[i] + share[i], taxable: t.taxable, tax: t.tax, amount: input.inclusive ? net : net + t.tax };
  });
  const chargeRows = adj.charges.map((c) => taxed(c.amount, c.taxBps));
  const charges = adj.charges.reduce((a, c) => a + c.amount, 0);

  // Tax by rate (lines and charges together).
  const byRate = new Map<number, { taxable: number; tax: number }>();
  const addRate = (bps: number, taxable: number, tax: number) => {
    if (taxMode === "none" || !bps) return;
    const r = byRate.get(bps) ?? { taxable: 0, tax: 0 };
    r.taxable += taxable;
    r.tax += tax;
    byRate.set(bps, r);
  };
  out.forEach((l, i) => addRate(lines[i].taxBps, l.taxable, l.tax));
  chargeRows.forEach((c, i) => addRate(adj.charges[i].taxBps, c.taxable, c.tax));

  const taxes: TaxRow[] = [];
  for (const [bps, r] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    if (taxMode === "gst" && input.intraState) {
      const half = Math.floor(r.tax / 2);
      taxes.push({ label: `CGST ${pct(bps / 2)}`, rateBps: bps / 2, taxable: r.taxable, amount: half });
      taxes.push({ label: `SGST ${pct(bps / 2)}`, rateBps: bps / 2, taxable: r.taxable, amount: r.tax - half });
    } else taxes.push({ label: `${taxMode === "gst" ? "IGST" : input.taxLabel || "Tax"} ${pct(bps)}`, rateBps: bps, taxable: r.taxable, amount: r.tax });
  }
  const tax = taxes.reduce((a, t) => a + t.amount, 0);
  const lineTaxable = out.reduce((a, l) => a + l.taxable, 0);
  const chargeTaxable = chargeRows.reduce((a, c) => a + c.taxable, 0);
  const subtotal = gross.reduce((a, b) => a + b, 0);
  const discount = lineDisc.reduce((a, b) => a + b, 0) + docDisc;
  // Inclusive prices already contain the tax.
  const raw = input.inclusive ? subtotal - discount + charges : subtotal - discount + charges + tax;
  const unit = 10 ** minorDigits(input.currency);
  const rounded = adj.roundOff && unit > 1 ? Math.round(raw / unit) * unit : raw;

  const hsnMap = new Map<string, { hsn: string; taxable: number; rateBps: number; tax: number }>();
  out.forEach((l, i) => {
    const key = `${lines[i].hsn}|${lines[i].taxBps}`;
    const r = hsnMap.get(key) ?? { hsn: lines[i].hsn, taxable: 0, rateBps: lines[i].taxBps, tax: 0 };
    r.taxable += l.taxable;
    r.tax += l.tax;
    hsnMap.set(key, r);
  });

  return { lines: out, subtotal, discount, charges, taxable: lineTaxable + chargeTaxable, taxes, tax, roundOff: rounded - raw, total: rounded, hsn: [...hsnMap.values()] };
}

/** Same state of supply as the business: CGST + SGST; otherwise IGST. */
export function isIntraState(businessState: string, placeOfSupply: string) {
  const a = businessState.trim().toLowerCase();
  const b = placeOfSupply.trim().toLowerCase();
  return !!a && (!b || a === b);
}
