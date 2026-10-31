// Finance arithmetic shared by the server and the screens: depreciation
// schedules, disposals, repeating and spread journals, and how balances turn
// into a cash flow statement. Money is in paise (integers).
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const money = z.number().int("Use whole paise").min(0).max(1e13);

export const ASSET_METHODS = ["slm", "wdv", "none"] as const;
export const METHOD_LABEL: Record<(typeof ASSET_METHODS)[number], string> = { slm: "Straight line", wdv: "Written-down value", none: "Not depreciated (e.g. land)" };

export const assetSchema = z.object({
  code: z.string().trim().max(20).default(""),
  name: z.string().trim().min(1, "Name the asset").max(160),
  category: z.string().trim().max(60).default(""),
  assetAccountId: z.uuid(),
  purchaseDate: day,
  inUseDate: day,
  cost: money.refine((v) => v > 0, "Enter what it cost"),
  residual: money.default(0),
  method: z.enum(ASSET_METHODS).default("slm"),
  lifeMonths: z.number().int().min(1).max(1200).default(60),
  rate: z.number().min(0).max(100).default(0),
  companyId: z.uuid().nullable().default(null),
  branchId: z.uuid().nullable().default(null),
  costCentreId: z.uuid().nullable().default(null),
  billId: z.uuid().nullable().default(null),
  holderId: z.uuid().nullable().default(null),
  serial: z.string().trim().max(80).default(""),
  location: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(2000).default(""),
});
export type AssetInput = z.infer<typeof assetSchema>;
export const disposeSchema = z.object({ date: day, amount: money.default(0), accountId: z.uuid().nullable().default(null) });

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recurring"),
    name: z.string().trim().min(1, "Name it").max(120),
    lines: z.array(z.object({ accountId: z.uuid(), debit: money.default(0), credit: money.default(0), description: z.string().trim().max(200).default(""), costCentreId: z.uuid().nullable().default(null) })).min(2).max(50),
    every: z.enum(["month", "quarter", "year"]).default("month"),
    startDate: day,
    endDate: day.nullable().default(null),
    autoReverse: z.boolean().default(false),
    companyId: z.uuid().nullable().default(null),
    active: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("spread"),
    name: z.string().trim().min(1, "Name it").max(120),
    total: money.refine((v) => v > 0, "Enter the amount to spread"),
    months: z.number().int().min(1).max(120),
    startDate: day,
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    costCentreId: z.uuid().nullable().default(null),
    companyId: z.uuid().nullable().default(null),
    active: z.boolean().default(true),
  }),
]);
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const budgetSchema = z.object({
  name: z.string().trim().min(1, "Name the budget").max(120),
  year: z.string().regex(/^\d{4}-\d{2}$|^\d{4}$/, "Pick a financial year"),
  companyId: z.uuid().nullable().default(null),
  costCentreId: z.uuid().nullable().default(null),
  amounts: z.record(z.uuid(), z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().int().min(-1e13).max(1e13))).default({}),
});

// ── Dates ────────────────────────────────────────────────────────────────────

export const monthOf = (d: string) => d.slice(0, 7);
export const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const daysIn = (month: string) => Number(lastDay(month).slice(8, 10));
export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

// ── Depreciation ─────────────────────────────────────────────────────────────

type DepAsset = { cost: number; residual: number; method: string; lifeMonths: number; rate: number; inUseDate: string; disposedOn?: string | null };
export type DepRow = { month: string; amount: number; accumulated: number; bookValue: number };

/**
 * Depreciation month by month, up to and including a month. The first month
 * is counted from the day it went into use; a disposed asset depreciates up to
 * its disposal day and stops. Straight line spreads cost less residual evenly
 * over the life (the last month takes the rounding); written-down value
 * applies a twelfth of the yearly rate to what's left, never going below the
 * residual value.
 */
export function depreciation(a: DepAsset, upTo: string): DepRow[] {
  if (a.method === "none") return [];
  const out: DepRow[] = [];
  const base = a.cost - a.residual;
  if (base <= 0) return out;
  const start = monthOf(a.inUseDate);
  const stop = a.disposedOn && monthOf(a.disposedOn) < upTo ? monthOf(a.disposedOn) : upTo;
  let acc = 0;
  let used = 0;
  for (let month = start; month <= stop && acc < base; month = addMonths(month, 1)) {
    // Days of the month it was in use: from the in-use day (first month) to the disposal day (last month).
    const from = month === start ? Number(a.inUseDate.slice(8, 10)) : 1;
    const to = a.disposedOn && month === monthOf(a.disposedOn) ? Number(a.disposedOn.slice(8, 10)) : daysIn(month);
    const share = Math.max(0, to - from + 1) / daysIn(month);
    let amount: number;
    if (a.method === "slm") {
      // Each month brings the total to its share of the life so far, so rounding never piles up.
      used += share;
      amount = Math.round((base * Math.min(used, a.lifeMonths)) / a.lifeMonths) - acc;
    } else {
      const left = a.cost - acc;
      amount = Math.round(((left * a.rate) / 100 / 12) * share);
      if (acc + amount > base) amount = base - acc;
    }
    if (amount <= 0) continue;
    acc += amount;
    out.push({ month, amount, accumulated: acc, bookValue: a.cost - acc });
  }
  return out;
}

/** What selling or scrapping an asset does: depreciation to date, book value, and the gain (positive) or loss. */
export function disposal(a: DepAsset & { disposedOn: string }, proceeds: number) {
  const rows = depreciation(a, monthOf(a.disposedOn));
  const accumulated = rows.at(-1)?.accumulated ?? 0;
  const bookValue = a.cost - accumulated;
  return { accumulated, bookValue, gain: proceeds - bookValue };
}

// ── Repeating and spread journals ───────────────────────────────────────────

const STEP = { month: 1, quarter: 3, year: 12 } as const;

/** Dates a repeating journal falls on, from its start to a day (inclusive), never past its end. Same day of month, capped at month end. */
export function occurrences(s: { startDate: string; endDate: string | null; every: "month" | "quarter" | "year" }, upTo: string) {
  const out: string[] = [];
  const dom = Number(s.startDate.slice(8, 10));
  for (let i = 0; i < 1200; i++) {
    const month = addMonths(monthOf(s.startDate), i * STEP[s.every]);
    const d = `${month}-${String(Math.min(dom, daysIn(month))).padStart(2, "0")}`;
    if (d > upTo || (s.endDate && d > s.endDate)) break;
    out.push(d);
  }
  return out;
}

/** A total split over months: equal parts, the last taking the rounding, posted on each month's last day. */
export function spread(total: number, months: number, startDate: string) {
  const each = Math.floor(total / months);
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(monthOf(startDate), i);
    return { month, date: lastDay(month), amount: i === months - 1 ? total - each * (months - 1) : each };
  });
}

// ── Cash flow ────────────────────────────────────────────────────────────────

type Acc = { id: string; type: string; subtype: string; systemKey: string | null; name: string };
export type CashFlowLine = { id: string; name: string; amount: number };

/**
 * A cash flow statement (indirect method) from account balances at the start
 * and end of a period. Profit, plus depreciation and other non-cash items,
 * adjusted for changes in working capital, is operating cash; changes in
 * fixed assets are investing; loans and owner's money are financing. The
 * three add up to the change in cash and bank (checked by `difference`).
 */
export function cashFlow(accs: Acc[], opening: Map<string, number>, closing: Map<string, number>) {
  // Balances are signed debit-positive here.
  const delta = (a: Acc) => (closing.get(a.id) ?? 0) - (opening.get(a.id) ?? 0);
  const cash = accs.filter((a) => a.subtype === "cash" || a.subtype === "bank");
  const pl = accs.filter((a) => a.type === "income" || a.type === "expense");
  const profit = -pl.reduce((n, a) => n + delta(a), 0);
  const nonCash: CashFlowLine[] = accs.filter((a) => a.systemKey === "acc_dep").map((a) => ({ id: a.id, name: "Depreciation", amount: -delta(a) }));
  const isFixed = (a: Acc) => a.subtype === "fixed" && a.systemKey !== "acc_dep";
  const isFinancing = (a: Acc) => a.type === "equity" || (a.type === "liability" && a.subtype === "other");
  const working: CashFlowLine[] = accs
    .filter((a) => !cash.includes(a) && !pl.includes(a) && !isFixed(a) && !isFinancing(a) && a.systemKey !== "acc_dep" && (a.type === "asset" || a.type === "liability"))
    .map((a) => ({ id: a.id, name: a.name, amount: -delta(a) }))
    .filter((l) => l.amount);
  const investing: CashFlowLine[] = accs.filter(isFixed).map((a) => ({ id: a.id, name: a.name, amount: -delta(a) })).filter((l) => l.amount);
  const financing: CashFlowLine[] = accs.filter(isFinancing).map((a) => ({ id: a.id, name: a.name, amount: -delta(a) })).filter((l) => l.amount);
  const operating = profit + nonCash.reduce((n, l) => n + l.amount, 0) + working.reduce((n, l) => n + l.amount, 0);
  const inv = investing.reduce((n, l) => n + l.amount, 0);
  const fin = financing.reduce((n, l) => n + l.amount, 0);
  const cashOpen = cash.reduce((n, a) => n + (opening.get(a.id) ?? 0), 0);
  const cashClose = cash.reduce((n, a) => n + (closing.get(a.id) ?? 0), 0);
  return { profit, nonCash: nonCash.filter((l) => l.amount), working, operating, investing, investingTotal: inv, financing, financingTotal: fin, net: operating + inv + fin, cashOpen, cashClose, difference: cashClose - cashOpen - (operating + inv + fin) };
}
