// Multi-currency pricing. The store sets its own exchange rates (no live
// feed is assumed): 1 unit of the base currency = `rate` units of `code`.
// Product prices can be rounded to "charm" endings; other amounts (shipping,
// fees, discounts) are converted exactly to the nearest minor unit.
import { minorDigits } from "./money";

export type Rounding = "none" | "whole" | "x.99" | "x.95";
export type StoreCurrency = { code: string; rate: string; rounding: Rounding };

export const ROUNDING_LABELS: Record<Rounding, string> = { none: "Exact conversion", whole: "Round up to a whole amount", "x.99": "End in .99", "x.95": "End in .95" };

export function parseRate(rate: string): number {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 && n < 1e7 ? n : NaN;
}

/** Converts an amount in the base currency's minor units to the target's minor units. */
export function convertMinor(amount: number, base: string, to: StoreCurrency, opts: { price?: boolean } = {}): number {
  if (!amount) return 0;
  const rate = parseRate(to.rate);
  if (!Number.isFinite(rate)) throw new Error(`Invalid rate for ${to.code}`);
  const major = (amount / 10 ** minorDigits(base)) * rate;
  const td = minorDigits(to.code);
  const exact = major * 10 ** td;
  if (!opts.price || to.rounding === "none" || amount < 0) return Math.round(exact);
  const unit = 10 ** td;
  // Rounding never lowers a price below its exact conversion.
  if (to.rounding === "whole" || td === 0) return Math.ceil(exact / unit - 1e-9) * unit;
  let minor = Math.floor(exact / unit) * unit + (to.rounding === "x.99" ? 99 : 95);
  if (minor < exact - 1e-6) minor += unit;
  return minor;
}

/** Back to base-currency minor units (for reports). */
export function toBaseMinor(amount: number, base: string, from: StoreCurrency): number {
  const rate = parseRate(from.rate);
  const major = amount / 10 ** minorDigits(from.code) / rate;
  return Math.round(major * 10 ** minorDigits(base));
}

/** The currencies a shopper can choose (base first). */
export function availableCurrencies(base: string, extra: StoreCurrency[]) {
  return [base.toUpperCase(), ...extra.map((c) => c.code.toUpperCase()).filter((c) => c !== base.toUpperCase())];
}

export function presentment(base: string, extra: StoreCurrency[], wanted: string | null | undefined): StoreCurrency | null {
  if (!wanted || wanted.toUpperCase() === base.toUpperCase()) return null;
  const c = extra.find((x) => x.code.toUpperCase() === wanted.toUpperCase());
  return c && Number.isFinite(parseRate(c.rate)) ? { ...c, code: c.code.toUpperCase() } : null;
}
