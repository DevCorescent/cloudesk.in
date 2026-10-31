// Ready-made business calculations. Each takes labelled inputs and returns the
// results, the working (so the number can be checked and explained), and for
// some a table (an EMI schedule, depreciation by year). Standard textbook and
// Indian-practice formulas; tax rates are inputs, never assumed current law.
import { clean } from "./expr";
import { formatMoney, formatNumber } from "./format";

export type FieldKind = "money" | "percent" | "number" | "months" | "years" | "days" | "date" | "select";
export type Field = { id: string; label: string; kind: FieldKind; default?: number | string; options?: { value: string; label: string }[]; hint?: string; optional?: boolean };
export type OutKind = "money" | "percent" | "number" | "units" | "days" | "text";
export type Out = { label: string; value: number | string; kind: OutKind; primary?: boolean };
export type Table = { head: string[]; rows: (string | number)[][]; money?: number[] };
export type Result = { results: Out[]; steps: string[]; table?: Table };
export type Formula = { id: string; name: string; category: Category; line: string; keywords: string; fields: Field[]; compute: (v: Values) => Result };
export type Values = Record<string, number | string>;
export type Category = "tax" | "pricing" | "loans" | "invest" | "ops" | "customers" | "dates" | "everyday";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "tax", label: "GST & tax" },
  { id: "pricing", label: "Pricing & profit" },
  { id: "loans", label: "Loans & interest" },
  { id: "invest", label: "Investments & growth" },
  { id: "ops", label: "Stock & operations" },
  { id: "customers", label: "Customers & marketing" },
  { id: "dates", label: "Dates" },
  { id: "everyday", label: "Everyday" },
];

export class FormulaError extends Error {}

const num = (v: Values, id: string, o: { min?: number; above?: number; label?: string; max?: number } = {}) => {
  const raw = v[id];
  const x = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[,₹\s]/g, ""));
  const name = o.label ?? id;
  if (!Number.isFinite(x)) throw new FormulaError(`Enter ${name}`);
  if (o.above !== undefined && !(x > o.above)) throw new FormulaError(`${name} must be more than ${o.above}`);
  if (o.min !== undefined && x < o.min) throw new FormulaError(`${name} can't be below ${o.min}`);
  if (o.max !== undefined && x > o.max) throw new FormulaError(`${name} can't be above ${o.max}`);
  return x;
};
const str = (v: Values, id: string) => String(v[id] ?? "");
const r2 = (x: number) => Math.round(x * 100) / 100;
const m = (x: number) => formatMoney(x);
const p = (x: number) => `${formatNumber(clean(x), { decimals: 2 })}%`;
const n = (x: number, d: number | "auto" = "auto") => formatNumber(clean(x), { decimals: d });

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28].map((r) => ({ value: String(r), label: `${r}%` }));
const SUPPLY = [{ value: "intra", label: "Within the state (CGST + SGST)" }, { value: "inter", label: "Another state (IGST)" }];

function gstSplit(tax: number, supply: string, rate: number): Out[] {
  if (supply === "inter") return [{ label: `IGST @ ${rate}%`, value: r2(tax), kind: "money" }];
  const half = r2(tax / 2);
  return [{ label: `CGST @ ${rate / 2}%`, value: half, kind: "money" }, { label: `SGST @ ${rate / 2}%`, value: r2(tax - half), kind: "money" }];
}

const parseDate = (s: string, label: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime())) throw new FormulaError(`Enter ${label}`);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const human = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const FORMULAS: Formula[] = [
  // ── GST & tax ─────────────────────────────────────────────────────────────
  {
    id: "gst-add",
    name: "Add GST",
    category: "tax",
    line: "From a price before tax to the price with GST, split into CGST/SGST or IGST",
    keywords: "gst tax exclusive add cgst sgst igst invoice",
    fields: [
      { id: "amount", label: "Amount before GST", kind: "money", default: 10000 },
      { id: "rate", label: "GST rate", kind: "select", options: GST_RATES, default: "18" },
      { id: "supply", label: "Supply", kind: "select", options: SUPPLY, default: "intra" },
    ],
    compute: (v) => {
      const amt = num(v, "amount", { min: 0, label: "the amount" });
      const rate = num(v, "rate", { min: 0, max: 100, label: "the rate" });
      const tax = r2((amt * rate) / 100);
      return {
        results: [{ label: "Total with GST", value: r2(amt + tax), kind: "money", primary: true }, { label: "Taxable value", value: r2(amt), kind: "money" }, { label: "Total GST", value: tax, kind: "money" }, ...gstSplit(tax, str(v, "supply"), rate)],
        steps: [`GST = ${m(amt)} × ${rate}% = ${m(tax)}`, `Total = ${m(amt)} + ${m(tax)} = ${m(amt + tax)}`, str(v, "supply") === "inter" ? "Supply to another state: all of it is IGST." : "Supply within the state: split equally into CGST and SGST."],
      };
    },
  },
  {
    id: "gst-remove",
    name: "Remove GST",
    category: "tax",
    line: "From a GST-inclusive price back to the taxable value and the tax inside it",
    keywords: "gst inclusive reverse remove base taxable mrp",
    fields: [
      { id: "amount", label: "Amount including GST", kind: "money", default: 11800 },
      { id: "rate", label: "GST rate", kind: "select", options: GST_RATES, default: "18" },
      { id: "supply", label: "Supply", kind: "select", options: SUPPLY, default: "intra" },
    ],
    compute: (v) => {
      const total = num(v, "amount", { min: 0, label: "the amount" });
      const rate = num(v, "rate", { min: 0, max: 100, label: "the rate" });
      const base = r2(total / (1 + rate / 100));
      const tax = r2(total - base);
      return {
        results: [{ label: "Taxable value", value: base, kind: "money", primary: true }, { label: "GST included", value: tax, kind: "money" }, ...gstSplit(tax, str(v, "supply"), rate)],
        steps: [`Taxable value = ${m(total)} ÷ (1 + ${rate}%) = ${m(base)}`, `GST = ${m(total)} − ${m(base)} = ${m(tax)}`],
      };
    },
  },
  {
    id: "tds",
    name: "TDS deduction",
    category: "tax",
    line: "Tax deducted at source from a payment, and what's paid out",
    keywords: "tds deduction tax source payment contractor professional rent",
    fields: [
      { id: "amount", label: "Payment amount", kind: "money", default: 50000 },
      { id: "rate", label: "TDS rate", kind: "percent", default: 10, hint: "Check the current rate for the section that applies" },
    ],
    compute: (v) => {
      const amt = num(v, "amount", { min: 0, label: "the amount" });
      const rate = num(v, "rate", { min: 0, max: 100, label: "the rate" });
      const tds = r2((amt * rate) / 100);
      return { results: [{ label: "Pay out", value: r2(amt - tds), kind: "money", primary: true }, { label: "TDS to deposit", value: tds, kind: "money" }], steps: [`TDS = ${m(amt)} × ${rate}% = ${m(tds)}`, `Paid out = ${m(amt)} − ${m(tds)} = ${m(amt - tds)}`] };
    },
  },

  // ── Pricing & profit ──────────────────────────────────────────────────────
  {
    id: "margin",
    name: "Profit margin & markup",
    category: "pricing",
    line: "From cost and selling price: profit, margin on price and markup on cost",
    keywords: "margin markup profit cost selling price gross",
    fields: [
      { id: "cost", label: "Cost", kind: "money", default: 600 },
      { id: "price", label: "Selling price", kind: "money", default: 1000 },
    ],
    compute: (v) => {
      const cost = num(v, "cost", { min: 0, label: "the cost" });
      const price = num(v, "price", { above: 0, label: "the price" });
      const profit = price - cost;
      return {
        results: [{ label: "Profit", value: r2(profit), kind: "money", primary: true }, { label: "Margin (on price)", value: (profit / price) * 100, kind: "percent" }, ...(cost > 0 ? [{ label: "Markup (on cost)", value: (profit / cost) * 100, kind: "percent" as const }] : [])],
        steps: [`Profit = ${m(price)} − ${m(cost)} = ${m(profit)}`, `Margin = ${m(profit)} ÷ ${m(price)} = ${p((profit / price) * 100)}`, ...(cost > 0 ? [`Markup = ${m(profit)} ÷ ${m(cost)} = ${p((profit / cost) * 100)}`] : [])],
      };
    },
  },
  {
    id: "price-from-margin",
    name: "Price for a target margin",
    category: "pricing",
    line: "What to charge so a given share of the price is profit",
    keywords: "selling price target margin cost pricing",
    fields: [
      { id: "cost", label: "Cost", kind: "money", default: 600 },
      { id: "margin", label: "Target margin", kind: "percent", default: 40 },
    ],
    compute: (v) => {
      const cost = num(v, "cost", { min: 0, label: "the cost" });
      const mg = num(v, "margin", { min: 0, label: "the margin" });
      if (mg >= 100) throw new FormulaError("A margin must be below 100% of the price");
      const price = cost / (1 - mg / 100);
      return { results: [{ label: "Selling price", value: r2(price), kind: "money", primary: true }, { label: "Profit per unit", value: r2(price - cost), kind: "money" }, ...(cost > 0 ? [{ label: "Markup on cost", value: ((price - cost) / cost) * 100, kind: "percent" as const }] : [])], steps: [`Price = cost ÷ (1 − margin) = ${m(cost)} ÷ (1 − ${mg}%) = ${m(price)}`] };
    },
  },
  {
    id: "price-from-markup",
    name: "Price from markup",
    category: "pricing",
    line: "Add a markup on cost, and see the margin it gives",
    keywords: "markup cost plus pricing selling price",
    fields: [
      { id: "cost", label: "Cost", kind: "money", default: 600 },
      { id: "markup", label: "Markup on cost", kind: "percent", default: 50 },
    ],
    compute: (v) => {
      const cost = num(v, "cost", { above: 0, label: "the cost" });
      const mk = num(v, "markup", { min: 0, label: "the markup" });
      const price = cost * (1 + mk / 100);
      return { results: [{ label: "Selling price", value: r2(price), kind: "money", primary: true }, { label: "Profit per unit", value: r2(price - cost), kind: "money" }, { label: "Margin on price", value: ((price - cost) / price) * 100, kind: "percent" }], steps: [`Price = ${m(cost)} × (1 + ${mk}%) = ${m(price)}`, `Margin = ${m(price - cost)} ÷ ${m(price)} = ${p(((price - cost) / price) * 100)}`] };
    },
  },
  {
    id: "discount",
    name: "Discount",
    category: "pricing",
    line: "Final price after one or two successive discounts, and the effective discount",
    keywords: "discount sale offer off successive price",
    fields: [
      { id: "price", label: "Price", kind: "money", default: 2499 },
      { id: "d1", label: "Discount", kind: "percent", default: 20 },
      { id: "d2", label: "Extra discount", kind: "percent", default: 0, optional: true },
    ],
    compute: (v) => {
      const price = num(v, "price", { min: 0, label: "the price" });
      const d1 = num(v, "d1", { min: 0, max: 100, label: "the discount" });
      const d2 = v.d2 === "" || v.d2 === undefined ? 0 : num(v, "d2", { min: 0, max: 100, label: "the extra discount" });
      const after1 = price * (1 - d1 / 100);
      const final = after1 * (1 - d2 / 100);
      return { results: [{ label: "Final price", value: r2(final), kind: "money", primary: true }, { label: "You save", value: r2(price - final), kind: "money" }, { label: "Effective discount", value: price ? ((price - final) / price) * 100 : 0, kind: "percent" }], steps: [`After ${d1}%: ${m(price)} × ${100 - d1}% = ${m(after1)}`, ...(d2 ? [`After another ${d2}%: ${m(after1)} × ${100 - d2}% = ${m(final)}`, `Two discounts of ${d1}% and ${d2}% are ${p(((price - final) / price) * 100)} in all — not ${d1 + d2}%.`] : [])] };
    },
  },
  {
    id: "break-even",
    name: "Break-even point",
    category: "pricing",
    line: "How many units (and how much revenue) cover your fixed costs",
    keywords: "break even fixed cost variable contribution units revenue",
    fields: [
      { id: "fixed", label: "Fixed costs (per month)", kind: "money", default: 150000, hint: "Rent, salaries, subscriptions…" },
      { id: "price", label: "Price per unit", kind: "money", default: 500 },
      { id: "variable", label: "Variable cost per unit", kind: "money", default: 300 },
    ],
    compute: (v) => {
      const fixed = num(v, "fixed", { min: 0, label: "fixed costs" });
      const price = num(v, "price", { above: 0, label: "the price" });
      const vc = num(v, "variable", { min: 0, label: "the variable cost" });
      const cm = price - vc;
      if (cm <= 0) throw new FormulaError("The price must be more than the variable cost, or you never break even");
      const units = fixed / cm;
      return { results: [{ label: "Break-even units", value: Math.ceil(units), kind: "units", primary: true }, { label: "Break-even revenue", value: r2(Math.ceil(units) * price), kind: "money" }, { label: "Contribution per unit", value: r2(cm), kind: "money" }, { label: "Contribution margin", value: (cm / price) * 100, kind: "percent" }], steps: [`Contribution = ${m(price)} − ${m(vc)} = ${m(cm)} per unit`, `Units = ${m(fixed)} ÷ ${m(cm)} = ${n(units, 2)} → ${Math.ceil(units)} units`] };
    },
  },
  {
    id: "commission",
    name: "Sales commission",
    category: "pricing",
    line: "Commission on sales, with an optional target above which a higher rate applies",
    keywords: "commission sales incentive target slab",
    fields: [
      { id: "sales", label: "Sales", kind: "money", default: 500000 },
      { id: "rate", label: "Commission rate", kind: "percent", default: 2 },
      { id: "target", label: "Target (optional)", kind: "money", default: "", optional: true },
      { id: "rate2", label: "Rate above target", kind: "percent", default: "", optional: true },
    ],
    compute: (v) => {
      const sales = num(v, "sales", { min: 0, label: "sales" });
      const rate = num(v, "rate", { min: 0, max: 100, label: "the rate" });
      const hasSlab = v.target !== "" && v.target !== undefined && v.rate2 !== "" && v.rate2 !== undefined;
      if (!hasSlab) {
        const c = (sales * rate) / 100;
        return { results: [{ label: "Commission", value: r2(c), kind: "money", primary: true }], steps: [`${m(sales)} × ${rate}% = ${m(c)}`] };
      }
      const target = num(v, "target", { min: 0, label: "the target" });
      const rate2 = num(v, "rate2", { min: 0, max: 100, label: "the higher rate" });
      const below = Math.min(sales, target);
      const above = Math.max(0, sales - target);
      const c = (below * rate) / 100 + (above * rate2) / 100;
      return { results: [{ label: "Commission", value: r2(c), kind: "money", primary: true }, { label: "Effective rate", value: sales ? (c / sales) * 100 : 0, kind: "percent" }], steps: [`Up to target: ${m(below)} × ${rate}% = ${m((below * rate) / 100)}`, `Above target: ${m(above)} × ${rate2}% = ${m((above * rate2) / 100)}`] };
    },
  },

  // ── Loans & interest ──────────────────────────────────────────────────────
  {
    id: "emi",
    name: "Loan EMI",
    category: "loans",
    line: "Monthly instalment, total interest and the full repayment schedule",
    keywords: "emi loan home car business interest instalment amortization schedule",
    fields: [
      { id: "principal", label: "Loan amount", kind: "money", default: 1000000 },
      { id: "rate", label: "Interest rate (yearly)", kind: "percent", default: 9 },
      { id: "months", label: "Tenure", kind: "months", default: 60 },
    ],
    compute: (v) => {
      const P = num(v, "principal", { above: 0, label: "the loan amount" });
      const rate = num(v, "rate", { min: 0, max: 100, label: "the rate" });
      const N = num(v, "months", { above: 0, max: 600, label: "the tenure" });
      if (!Number.isInteger(N)) throw new FormulaError("Enter the tenure in whole months");
      const i = rate / 12 / 100;
      const emi = i === 0 ? P / N : (P * i * (1 + i) ** N) / ((1 + i) ** N - 1);
      const rows: (string | number)[][] = [];
      let bal = P;
      let totalInt = 0;
      for (let k = 1; k <= N; k++) {
        const int = bal * i;
        let princ = emi - int;
        if (k === N) princ = bal;
        bal = Math.max(0, bal - princ);
        totalInt += int;
        rows.push([k, r2(princ + int), r2(princ), r2(int), r2(bal)]);
      }
      return {
        results: [{ label: "Monthly EMI", value: r2(emi), kind: "money", primary: true }, { label: "Total interest", value: r2(totalInt), kind: "money" }, { label: "Total repayment", value: r2(P + totalInt), kind: "money" }, { label: "Interest share", value: (totalInt / (P + totalInt)) * 100, kind: "percent" }],
        steps: [`Monthly rate r = ${rate}% ÷ 12 = ${n(i * 100, 4)}%`, `EMI = P × r × (1+r)^n ÷ ((1+r)^n − 1) with P = ${m(P)}, n = ${N}`, `= ${m(emi)} a month`],
        table: { head: ["Month", "EMI", "Principal", "Interest", "Balance"], rows, money: [1, 2, 3, 4] },
      };
    },
  },
  {
    id: "simple-interest",
    name: "Simple interest",
    category: "loans",
    line: "Interest on the original amount only",
    keywords: "simple interest principal rate time",
    fields: [
      { id: "principal", label: "Principal", kind: "money", default: 100000 },
      { id: "rate", label: "Rate (yearly)", kind: "percent", default: 8 },
      { id: "years", label: "Time", kind: "years", default: 3 },
    ],
    compute: (v) => {
      const P = num(v, "principal", { min: 0, label: "the principal" });
      const R = num(v, "rate", { min: 0, label: "the rate" });
      const T = num(v, "years", { min: 0, label: "the time" });
      const I = (P * R * T) / 100;
      return { results: [{ label: "Interest", value: r2(I), kind: "money", primary: true }, { label: "Amount", value: r2(P + I), kind: "money" }], steps: [`Interest = P × R × T ÷ 100 = ${m(P)} × ${R} × ${T} ÷ 100 = ${m(I)}`] };
    },
  },
  {
    id: "compound",
    name: "Compound interest / FD",
    category: "loans",
    line: "Maturity value with interest compounded yearly, half-yearly, quarterly (most FDs) or monthly",
    keywords: "compound interest fd fixed deposit maturity rd quarterly",
    fields: [
      { id: "principal", label: "Deposit", kind: "money", default: 100000 },
      { id: "rate", label: "Rate (yearly)", kind: "percent", default: 7 },
      { id: "years", label: "Time", kind: "years", default: 5 },
      { id: "freq", label: "Compounded", kind: "select", default: "4", options: [{ value: "1", label: "Yearly" }, { value: "2", label: "Half-yearly" }, { value: "4", label: "Quarterly" }, { value: "12", label: "Monthly" }] },
    ],
    compute: (v) => {
      const P = num(v, "principal", { min: 0, label: "the deposit" });
      const R = num(v, "rate", { min: 0, label: "the rate" });
      const T = num(v, "years", { min: 0, label: "the time" });
      const f = num(v, "freq", { above: 0, label: "the compounding" });
      const A = P * (1 + R / 100 / f) ** (f * T);
      const eff = ((1 + R / 100 / f) ** f - 1) * 100;
      return { results: [{ label: "Maturity value", value: r2(A), kind: "money", primary: true }, { label: "Interest earned", value: r2(A - P), kind: "money" }, { label: "Effective yearly rate", value: eff, kind: "percent" }], steps: [`A = P × (1 + r/f)^(f×t) = ${m(P)} × (1 + ${R}%/${f})^(${f}×${T})`, `= ${m(A)}`] };
    },
  },

  // ── Investments & growth ──────────────────────────────────────────────────
  {
    id: "sip",
    name: "SIP returns",
    category: "invest",
    line: "What a monthly investment could grow to at an expected rate (not a guarantee)",
    keywords: "sip mutual fund monthly investment returns future value",
    fields: [
      { id: "monthly", label: "Monthly investment", kind: "money", default: 10000 },
      { id: "rate", label: "Expected return (yearly)", kind: "percent", default: 12 },
      { id: "years", label: "Period", kind: "years", default: 10 },
    ],
    compute: (v) => {
      const P = num(v, "monthly", { above: 0, label: "the monthly amount" });
      const R = num(v, "rate", { min: 0, label: "the return" });
      const Y = num(v, "years", { above: 0, max: 60, label: "the period" });
      const nM = Math.round(Y * 12);
      const i = R / 12 / 100;
      const fv = i === 0 ? P * nM : P * (((1 + i) ** nM - 1) / i) * (1 + i);
      const invested = P * nM;
      return { results: [{ label: "Estimated value", value: r2(fv), kind: "money", primary: true }, { label: "Invested", value: r2(invested), kind: "money" }, { label: "Estimated gain", value: r2(fv - invested), kind: "money" }], steps: [`FV = P × ((1+i)^n − 1) ÷ i × (1+i), with i = ${n(i * 100, 4)}% a month, n = ${nM} months`, "Assumes the same return every month; real returns vary."] };
    },
  },
  {
    id: "cagr",
    name: "CAGR",
    category: "invest",
    line: "The steady yearly growth rate between two values",
    keywords: "cagr compound annual growth rate revenue",
    fields: [
      { id: "start", label: "Starting value", kind: "money", default: 1000000 },
      { id: "end", label: "Ending value", kind: "money", default: 2500000 },
      { id: "years", label: "Years", kind: "years", default: 4 },
    ],
    compute: (v) => {
      const s = num(v, "start", { above: 0, label: "the starting value" });
      const e = num(v, "end", { min: 0, label: "the ending value" });
      const y = num(v, "years", { above: 0, label: "the years" });
      const cagr = ((e / s) ** (1 / y) - 1) * 100;
      return { results: [{ label: "CAGR", value: cagr, kind: "percent", primary: true }, { label: "Total growth", value: ((e - s) / s) * 100, kind: "percent" }], steps: [`CAGR = (end ÷ start)^(1 ÷ years) − 1 = (${m(e)} ÷ ${m(s)})^(1/${y}) − 1 = ${p(cagr)}`] };
    },
  },
  {
    id: "roi",
    name: "Return on investment",
    category: "invest",
    line: "Gain and ROI on money put in, and per year if you give the time",
    keywords: "roi return investment gain campaign",
    fields: [
      { id: "cost", label: "Amount invested", kind: "money", default: 200000 },
      { id: "value", label: "Amount returned", kind: "money", default: 260000 },
      { id: "years", label: "Over (years, optional)", kind: "years", default: "", optional: true },
    ],
    compute: (v) => {
      const c = num(v, "cost", { above: 0, label: "the amount invested" });
      const r = num(v, "value", { min: 0, label: "the amount returned" });
      const roi = ((r - c) / c) * 100;
      const out: Out[] = [{ label: "ROI", value: roi, kind: "percent", primary: true }, { label: "Gain", value: r2(r - c), kind: "money" }];
      const steps = [`ROI = (${m(r)} − ${m(c)}) ÷ ${m(c)} = ${p(roi)}`];
      if (v.years !== "" && v.years !== undefined) {
        const y = num(v, "years", { above: 0, label: "the years" });
        const yearly = ((r / c) ** (1 / y) - 1) * 100;
        out.push({ label: "Per year (CAGR)", value: yearly, kind: "percent" });
        steps.push(`Per year = (${m(r)} ÷ ${m(c)})^(1/${y}) − 1 = ${p(yearly)}`);
      }
      return { results: out, steps };
    },
  },

  // ── Stock & operations ────────────────────────────────────────────────────
  {
    id: "reorder",
    name: "Reorder point",
    category: "ops",
    line: "The stock level at which to place the next order",
    keywords: "reorder point stock inventory lead time safety",
    fields: [
      { id: "daily", label: "Average daily sales (units)", kind: "number", default: 40 },
      { id: "lead", label: "Supplier lead time", kind: "days", default: 7 },
      { id: "safety", label: "Safety stock (units)", kind: "number", default: 60 },
    ],
    compute: (v) => {
      const d = num(v, "daily", { min: 0, label: "daily sales" });
      const l = num(v, "lead", { min: 0, label: "the lead time" });
      const s = num(v, "safety", { min: 0, label: "safety stock" });
      const rp = d * l + s;
      return { results: [{ label: "Reorder at", value: Math.ceil(rp), kind: "units", primary: true }, { label: "Used while waiting", value: Math.ceil(d * l), kind: "units" }], steps: [`Reorder point = daily sales × lead time + safety stock = ${n(d)} × ${n(l)} + ${n(s)} = ${n(rp)}`] };
    },
  },
  {
    id: "eoq",
    name: "Economic order quantity",
    category: "ops",
    line: "The order size that keeps ordering plus holding costs lowest",
    keywords: "eoq economic order quantity inventory holding ordering cost",
    fields: [
      { id: "demand", label: "Yearly demand (units)", kind: "number", default: 12000 },
      { id: "order", label: "Cost per order", kind: "money", default: 1500 },
      { id: "holding", label: "Holding cost per unit per year", kind: "money", default: 20 },
    ],
    compute: (v) => {
      const D = num(v, "demand", { above: 0, label: "demand" });
      const S = num(v, "order", { above: 0, label: "the cost per order" });
      const H = num(v, "holding", { above: 0, label: "the holding cost" });
      const q = Math.sqrt((2 * D * S) / H);
      return { results: [{ label: "Order quantity", value: Math.round(q), kind: "units", primary: true }, { label: "Orders a year", value: r2(D / q), kind: "number" }, { label: "Yearly ordering + holding cost", value: r2((D / q) * S + (q / 2) * H), kind: "money" }], steps: [`EOQ = √(2 × D × S ÷ H) = √(2 × ${n(D)} × ${m(S)} ÷ ${m(H)}) = ${n(q, 1)}`] };
    },
  },
  {
    id: "depreciation",
    name: "Depreciation",
    category: "ops",
    line: "Year-by-year depreciation by straight line or written-down value",
    keywords: "depreciation asset straight line wdv written down book value",
    fields: [
      { id: "cost", label: "Asset cost", kind: "money", default: 500000 },
      { id: "salvage", label: "Salvage value", kind: "money", default: 50000 },
      { id: "life", label: "Useful life", kind: "years", default: 5 },
      { id: "method", label: "Method", kind: "select", default: "slm", options: [{ value: "slm", label: "Straight line" }, { value: "wdv", label: "Written-down value" }] },
    ],
    compute: (v) => {
      const C = num(v, "cost", { above: 0, label: "the cost" });
      const S = num(v, "salvage", { min: 0, label: "the salvage value" });
      const L = num(v, "life", { above: 0, max: 100, label: "the life" });
      if (S >= C) throw new FormulaError("Salvage value must be below the cost");
      const years = Math.ceil(L);
      const rows: (string | number)[][] = [];
      let book = C;
      if (str(v, "method") === "wdv") {
        const rate = 1 - (S / C) ** (1 / L);
        for (let y = 1; y <= years; y++) {
          const dep = y === years ? book - S : book * rate;
          book -= dep;
          rows.push([y, r2(dep), r2(book)]);
        }
        return { results: [{ label: "Yearly rate", value: rate * 100, kind: "percent", primary: true }, { label: "First-year depreciation", value: Number(rows[0]![1]), kind: "money" }], steps: [`WDV rate = 1 − (salvage ÷ cost)^(1/life) = ${p(rate * 100)}`, "Each year's depreciation is that rate on the value left."], table: { head: ["Year", "Depreciation", "Book value"], rows, money: [1, 2] } };
      }
      const dep = (C - S) / L;
      for (let y = 1; y <= years; y++) {
        const d = Math.min(dep, book - S);
        book -= d;
        rows.push([y, r2(d), r2(book)]);
      }
      return { results: [{ label: "Depreciation a year", value: r2(dep), kind: "money", primary: true }, { label: "Rate on cost", value: (dep / C) * 100, kind: "percent" }], steps: [`(cost − salvage) ÷ life = (${m(C)} − ${m(S)}) ÷ ${L} = ${m(dep)}`], table: { head: ["Year", "Depreciation", "Book value"], rows, money: [1, 2] } };
    },
  },
  {
    id: "unit-price",
    name: "Compare unit prices",
    category: "ops",
    line: "Which pack is cheaper per unit (kg, litre, piece)",
    keywords: "unit price compare cheaper per kg litre pack bulk",
    fields: [
      { id: "pa", label: "Option A price", kind: "money", default: 450 },
      { id: "qa", label: "Option A quantity", kind: "number", default: 5 },
      { id: "pb", label: "Option B price", kind: "money", default: 1000 },
      { id: "qb", label: "Option B quantity", kind: "number", default: 12 },
    ],
    compute: (v) => {
      const a = num(v, "pa", { min: 0, label: "A's price" }) / num(v, "qa", { above: 0, label: "A's quantity" });
      const b = num(v, "pb", { min: 0, label: "B's price" }) / num(v, "qb", { above: 0, label: "B's quantity" });
      const cheaper = a === b ? "Same price per unit" : a < b ? "Option A is cheaper" : "Option B is cheaper";
      return { results: [{ label: "Verdict", value: cheaper, kind: "text", primary: true }, { label: "A per unit", value: r2(a), kind: "money" }, { label: "B per unit", value: r2(b), kind: "money" }, { label: "Saving per unit", value: r2(Math.abs(a - b)), kind: "money" }], steps: [`A: ${m(a)} per unit · B: ${m(b)} per unit`] };
    },
  },

  // ── Customers & marketing ─────────────────────────────────────────────────
  {
    id: "ltv-cac",
    name: "Customer lifetime value & CAC",
    category: "customers",
    line: "What a customer is worth over time against what it costs to win one",
    keywords: "ltv clv cac lifetime value acquisition cost marketing payback",
    fields: [
      { id: "aov", label: "Average order value", kind: "money", default: 1500 },
      { id: "orders", label: "Orders per customer per year", kind: "number", default: 4 },
      { id: "margin", label: "Gross margin", kind: "percent", default: 40 },
      { id: "years", label: "Years a customer stays", kind: "years", default: 3 },
      { id: "spend", label: "Marketing spend", kind: "money", default: 100000 },
      { id: "customers", label: "New customers from it", kind: "number", default: 200 },
    ],
    compute: (v) => {
      const aov = num(v, "aov", { min: 0, label: "the order value" });
      const o = num(v, "orders", { min: 0, label: "orders a year" });
      const mg = num(v, "margin", { min: 0, max: 100, label: "the margin" });
      const y = num(v, "years", { min: 0, label: "years" });
      const spend = num(v, "spend", { min: 0, label: "spend" });
      const nc = num(v, "customers", { above: 0, label: "new customers" });
      const ltv = aov * o * (mg / 100) * y;
      const cac = spend / nc;
      const perMonth = (aov * o * (mg / 100)) / 12;
      return { results: [{ label: "LTV : CAC", value: cac ? `${n(ltv / cac, 2)} : 1` : "—", kind: "text", primary: true }, { label: "Lifetime value (profit)", value: r2(ltv), kind: "money" }, { label: "Cost to win a customer", value: r2(cac), kind: "money" }, { label: "Months to earn back CAC", value: perMonth ? r2(cac / perMonth) : 0, kind: "number" }], steps: [`LTV = ${m(aov)} × ${o} orders × ${mg}% × ${y} years = ${m(ltv)}`, `CAC = ${m(spend)} ÷ ${n(nc)} = ${m(cac)}`, "A ratio of 3 : 1 or better is a common rule of thumb."] };
    },
  },
  {
    id: "percent-change",
    name: "Percentage change",
    category: "customers",
    line: "Growth or drop from one number to another",
    keywords: "percentage change growth increase decrease month on month",
    fields: [
      { id: "from", label: "From", kind: "number", default: 80000 },
      { id: "to", label: "To", kind: "number", default: 96000 },
    ],
    compute: (v) => {
      const a = num(v, "from", { label: "the starting number" });
      const b = num(v, "to", { label: "the new number" });
      if (a === 0) throw new FormulaError("Can't measure a change from zero");
      const c = ((b - a) / Math.abs(a)) * 100;
      return { results: [{ label: c >= 0 ? "Increase" : "Decrease", value: Math.abs(c), kind: "percent", primary: true }, { label: "Difference", value: clean(b - a), kind: "number" }], steps: [`(${n(b)} − ${n(a)}) ÷ ${n(Math.abs(a))} = ${p(c)}`] };
    },
  },
  {
    id: "percent-of",
    name: "What percent is it?",
    category: "everyday",
    line: "One number as a percentage of another",
    keywords: "percent of share portion ratio",
    fields: [
      { id: "part", label: "Part", kind: "number", default: 45 },
      { id: "whole", label: "Whole", kind: "number", default: 180 },
    ],
    compute: (v) => {
      const a = num(v, "part", { label: "the part" });
      const b = num(v, "whole", { label: "the whole" });
      if (b === 0) throw new FormulaError("The whole can't be zero");
      return { results: [{ label: "Percentage", value: (a / b) * 100, kind: "percent", primary: true }], steps: [`${n(a)} ÷ ${n(b)} × 100 = ${p((a / b) * 100)}`] };
    },
  },

  // ── Dates ─────────────────────────────────────────────────────────────────
  {
    id: "days-between",
    name: "Days between dates",
    category: "dates",
    line: "Calendar days and working days between two dates",
    keywords: "days between dates working days weeks duration notice period",
    fields: [
      { id: "start", label: "From", kind: "date", default: "" },
      { id: "end", label: "To", kind: "date", default: "" },
      { id: "week", label: "Working week", kind: "select", default: "6", options: [{ value: "6", label: "Monday–Saturday" }, { value: "5", label: "Monday–Friday" }] },
    ],
    compute: (v) => {
      const a = parseDate(str(v, "start"), "the start date");
      const b = parseDate(str(v, "end"), "the end date");
      const [s, e] = a <= b ? [a, b] : [b, a];
      const days = Math.round((e.getTime() - s.getTime()) / 86_400_000);
      const six = str(v, "week") !== "5";
      let work = 0;
      for (let t = s.getTime(); t <= e.getTime(); t += 86_400_000) {
        const wd = new Date(t).getUTCDay();
        if (wd !== 0 && (six || wd !== 6)) work++;
      }
      return { results: [{ label: "Days", value: days, kind: "days", primary: true }, { label: "Including both dates", value: days + 1, kind: "days" }, { label: `Working days (${six ? "Mon–Sat" : "Mon–Fri"})`, value: work, kind: "days" }, { label: "Weeks", value: r2(days / 7), kind: "number" }], steps: [`${human(s)} to ${human(e)}`, "Working days count both dates; public holidays aren't removed."] };
    },
  },
  {
    id: "due-date",
    name: "Payment due date",
    category: "dates",
    line: "When an invoice falls due after its credit period",
    keywords: "due date credit period invoice net 30 payment terms",
    fields: [
      { id: "date", label: "Invoice date", kind: "date", default: "" },
      { id: "credit", label: "Credit period", kind: "days", default: 30 },
    ],
    compute: (v) => {
      const d = parseDate(str(v, "date"), "the invoice date");
      const c = num(v, "credit", { min: 0, max: 3650, label: "the credit period" });
      const due = new Date(d.getTime() + Math.round(c) * 86_400_000);
      return { results: [{ label: "Due on", value: human(due), kind: "text", primary: true }, { label: "Date", value: iso(due), kind: "text" }], steps: [`${human(d)} + ${Math.round(c)} days`] };
    },
  },

  // ── Everyday ──────────────────────────────────────────────────────────────
  {
    id: "split",
    name: "Split a bill",
    category: "everyday",
    line: "Share a bill with service charge or tip between people",
    keywords: "split bill share tip service charge per person",
    fields: [
      { id: "total", label: "Bill total", kind: "money", default: 4800 },
      { id: "people", label: "People", kind: "number", default: 6 },
      { id: "tip", label: "Tip / service", kind: "percent", default: 0, optional: true },
    ],
    compute: (v) => {
      const t = num(v, "total", { min: 0, label: "the total" });
      const ppl = num(v, "people", { above: 0, label: "people" });
      if (!Number.isInteger(ppl)) throw new FormulaError("Enter a whole number of people");
      const tip = v.tip === "" || v.tip === undefined ? 0 : num(v, "tip", { min: 0, max: 100, label: "the tip" });
      const all = t * (1 + tip / 100);
      return { results: [{ label: "Each pays", value: r2(all / ppl), kind: "money", primary: true }, { label: "Total with tip", value: r2(all), kind: "money" }], steps: [`${m(all)} ÷ ${ppl} = ${m(all / ppl)}`] };
    },
  },
];

export const formulaById = (id: string) => FORMULAS.find((f) => f.id === id);

export function runFormula(id: string, values: Values): Result {
  const f = formulaById(id);
  if (!f) throw new FormulaError("Unknown calculation");
  return f.compute(values);
}

/** Text for copying or saving: the main result and the working. */
export function describe(f: Formula, r: Result) {
  const fmt = (o: Out) => (o.kind === "money" && typeof o.value === "number" ? formatMoney(o.value) : o.kind === "percent" && typeof o.value === "number" ? `${formatNumber(clean(o.value), { decimals: 2 })}%` : typeof o.value === "number" ? formatNumber(clean(o.value)) : o.value);
  return `${f.name}\n${r.results.map((o) => `${o.label}: ${fmt(o)}`).join("\n")}`;
}
