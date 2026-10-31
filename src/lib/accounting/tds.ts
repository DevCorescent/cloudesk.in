// TDS on what the business pays suppliers. Sections, rates and thresholds are
// the ones in force for FY 2025-26 (Finance Act 2025) as Cloudesk ships them;
// they change with each budget, so a workspace can override any rate, and the
// screens say to check with a chartered accountant. Money is in paise.
import { z } from "zod";

export type Deductee = "company" | "other";
export type TdsSection = {
  label: string;
  /** Percent, by who's paid. */
  rate: Record<Deductee, number>;
  /** Deduct when a single bill is above this… */
  single?: number;
  /** …or this year's total to the supplier (including this bill) is above this. */
  aggregate?: number;
  /** Rent: above this per month. */
  monthly?: number;
  /** Purchase of goods: only on the part of the year's purchases above this. */
  above?: number;
};

export const TDS_SECTIONS: Record<string, TdsSection> = {
  "194C": { label: "Contractors (194C)", rate: { company: 2, other: 1 }, single: 30000_00, aggregate: 100000_00 },
  "194J-prof": { label: "Professional fees (194J)", rate: { company: 10, other: 10 }, aggregate: 50000_00 },
  "194J-tech": { label: "Technical services (194J)", rate: { company: 2, other: 2 }, aggregate: 50000_00 },
  "194I-building": { label: "Rent — land, building, furniture (194I)", rate: { company: 10, other: 10 }, monthly: 50000_00 },
  "194I-plant": { label: "Rent — plant and machinery (194I)", rate: { company: 2, other: 2 }, monthly: 50000_00 },
  "194H": { label: "Commission or brokerage (194H)", rate: { company: 2, other: 2 }, aggregate: 20000_00 },
  "194Q": { label: "Purchase of goods (194Q)", rate: { company: 0.1, other: 0.1 }, above: 5000000_00 },
};
/** Without a valid PAN, tax is deducted at 20% (or the section's rate, if higher). */
export const NO_PAN_RATE = 20;
export const isPan = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase());

export const tdsSettingsSchema = z.object({
  /** Tax deduction account number, for returns. */
  tan: z.string().trim().toUpperCase().regex(/^([A-Z]{4}[0-9]{5}[A-Z])?$/, "A TAN looks like ABCD12345E").default(""),
  /** Rate overrides by section, in percent. */
  rates: z.record(z.string(), z.object({ company: z.number().min(0).max(40), other: z.number().min(0).max(40) })).default({}),
});

export function rateFor(section: string, deductee: Deductee, pan: string, overrides: Record<string, { company: number; other: number }> = {}) {
  const sec = TDS_SECTIONS[section];
  if (!sec) return null;
  const rate = (overrides[section] ?? sec.rate)[deductee];
  return isPan(pan) ? rate : Math.max(NO_PAN_RATE, rate);
}

/**
 * What to deduct on a bill: the section's rate on the amount before GST, once
 * the bill or the year's total crosses the threshold. For purchase of goods,
 * only on the part of the year's purchases above the limit. Returns 0 when no
 * deduction is due yet, with the reason.
 */
export function suggest(section: string, opts: { deductee: Deductee; pan: string; amount: number; yearBefore: number; overrides?: Record<string, { company: number; other: number }> }) {
  const sec = TDS_SECTIONS[section];
  if (!sec) return { rate: 0, amount: 0, why: "No section picked" };
  const rate = rateFor(section, opts.deductee, opts.pan, opts.overrides) ?? 0;
  const year = opts.yearBefore + opts.amount;
  if (sec.above !== undefined) {
    const over = Math.max(0, year - Math.max(sec.above, opts.yearBefore));
    return over ? { rate, amount: Math.round((over * rate) / 100), why: `On the part of this year's purchases above ₹${sec.above / 100 / 100000} lakh` } : { rate, amount: 0, why: `This year's purchases are still under ₹${sec.above / 100 / 100000} lakh` };
  }
  const crosses = (sec.single !== undefined && opts.amount > sec.single) || (sec.aggregate !== undefined && year > sec.aggregate) || (sec.monthly !== undefined && opts.amount > sec.monthly);
  if (!crosses) return { rate, amount: 0, why: "Under the threshold so far this year" };
  // Crossing the yearly total: tax is due on the year's amount, including what wasn't deducted before.
  const base = sec.aggregate !== undefined && opts.yearBefore <= sec.aggregate && year > sec.aggregate && !(sec.single !== undefined && opts.amount > sec.single) ? year : opts.amount;
  return { rate, amount: Math.round((base * rate) / 100), why: base === year && opts.yearBefore ? "Crosses the yearly threshold: deducted on the year's total so far" : isPan(opts.pan) ? "" : `No valid PAN: at least ${NO_PAN_RATE}%` };
}

/** "2026-27 Q2" for a date, with April as the first month. */
export function tdsQuarter(day: string) {
  const [y, m] = day.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 && m <= 12 ? 3 : 4;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")} Q${q}`;
}
