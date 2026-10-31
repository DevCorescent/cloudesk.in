// Money in integer minor units. Formatting is locale-aware.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX"]);

export const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: "INR", label: "Indian rupee", symbol: "₹" },
  { code: "USD", label: "US dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British pound", symbol: "£" },
  { code: "AED", label: "UAE dirham", symbol: "د.إ" },
  { code: "SGD", label: "Singapore dollar", symbol: "S$" },
  { code: "AUD", label: "Australian dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian dollar", symbol: "C$" },
  { code: "JPY", label: "Japanese yen", symbol: "¥" },
];

export const minorDigits = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2);

export function formatMoney(minor: number, currency: string, locale = currency === "INR" ? "en-IN" : "en-US") {
  const d = minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(minor / 10 ** d);
  } catch {
    return `${currency} ${(minor / 10 ** d).toFixed(d)}`;
  }
}

/** Short form for storefront prices: drops “.00”. */
export function formatPrice(minor: number, currency: string) {
  const full = formatMoney(minor, currency);
  return minor % 10 ** minorDigits(currency) === 0 ? full.replace(/[.,]00(?=\D*$)/, "") : full;
}

/** Parses a user-typed amount ("1,499.50") into minor units. */
export function parseMoney(input: string | number, currency: string): number | null {
  const s = String(input).replace(/[^\d.-]/g, "");
  if (!s || Number.isNaN(Number(s))) return null;
  return Math.round(Number(s) * 10 ** minorDigits(currency));
}

export const toMajor = (minor: number, currency: string) => minor / 10 ** minorDigits(currency);
