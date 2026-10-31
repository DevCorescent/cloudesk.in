// Foreign currency in the books. A document in another currency is posted in
// rupees at its rate; each payment settles its share at that same rate, and
// the rupees actually received or paid differ by the exchange gain or loss.
// Open balances are revalued at the month-end rate (and reversed the next day).
// Amounts in a currency are in its minor units; rupees are paise.
import { minorDigits } from "@/lib/store/money";

/** Rupees (paise) for an amount in a currency at a rate (₹ per unit). */
export const inrOf = (minor: number, currency: string, rate: number) => Math.round((minor / 10 ** minorDigits(currency)) * rate * 100);

/**
 * Rupees booked against the first `paid` (minor units) of a document whose
 * total is `total` and was posted as `totalInr`. Settling it in full books
 * exactly `totalInr`, so no paisa is left behind by rounding.
 */
export function bookedFor(paid: number, total: number, totalInr: number, currency: string, rate: number) {
  if (paid >= total) return totalInr;
  return Math.min(totalInr, inrOf(paid, currency, rate));
}

/** Each payment's booked share, in the order given. */
export function bookedShares(payments: number[], total: number, totalInr: number, currency: string, rate: number) {
  let cum = 0;
  return payments.map((p) => {
    const before = bookedFor(cum, total, totalInr, currency, rate);
    cum += p;
    return bookedFor(cum, total, totalInr, currency, rate) - before;
  });
}

/** The unrealised difference on an open balance: what it's worth at `closing`, less what it's booked at. */
export const revaluation = (openMinor: number, bookedOpen: number, currency: string, closing: number) => inrOf(openMinor, currency, closing) - bookedOpen;

/** Month ends after `from` (YYYY-MM-DD) up to the last one before `today`, oldest first, at most `max`. */
export function monthEnds(from: string, today: string, max = 24) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end >= today) break;
    out.push(end);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.slice(-max);
}

export const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
