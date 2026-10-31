// How the calculator shows numbers: Indian (1,23,45,678) or international
// (12,345,678) grouping, a chosen number of decimals, and amounts in words the
// way Indian cheques and invoices write them (crore, lakh, thousand).
export type Grouping = "indian" | "international";

export function formatNumber(x: number, opts: { grouping?: Grouping; decimals?: number | "auto" } = {}) {
  if (!Number.isFinite(x)) return String(x);
  const grouping = opts.grouping ?? "indian";
  const d = opts.decimals ?? "auto";
  const abs = Math.abs(x);
  if (d === "auto" && abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return x.toExponential(6).replace(/\.?0+e/, "e");
  const fixed = d === "auto" ? String(Number(abs.toPrecision(12))) : abs.toFixed(d);
  const [int, frac] = (fixed.includes("e") ? abs.toFixed(0) : fixed).split(".");
  let grouped: string;
  if (grouping === "indian" && int!.length > 3) {
    const last3 = int!.slice(-3);
    grouped = `${int!.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  } else grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${x < 0 ? "−" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export const formatMoney = (x: number, opts: { grouping?: Grouping; symbol?: string } = {}) => `${x < 0 ? "−" : ""}${opts.symbol ?? "₹"}${formatNumber(Math.abs(x), { grouping: opts.grouping, decimals: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function upto99(n: number) {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function upto999(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? upto99(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in words, Indian system: 1,23,45,678 → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight". */
export function wordsIndian(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  if (n >= 1e17) return "";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  if (crore) parts.push(`${crore >= 1000 ? wordsIndian(crore) : upto999(crore)} Crore`);
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  if (lakh) parts.push(`${upto99(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${upto99(thousand)} Thousand`);
  if (n) parts.push(upto999(n));
  return parts.join(" ");
}

/** An amount in rupees and paise, as on a cheque: "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
export function rupeesInWords(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e17) return "";
  const neg = x < 0;
  const paise = Math.round(Math.abs(x) * 100);
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  const words = `Rupees ${wordsIndian(r)}${p ? ` and ${upto99(p)} Paise` : ""} Only`;
  return neg ? `Minus ${words}` : words;
}

/** Short Indian form: 12500000 → "1.25 crore", 350000 → "3.5 lakh". */
export function shortIndian(x: number): string {
  const a = Math.abs(x);
  const sign = x < 0 ? "−" : "";
  const fmt = (v: number) => String(Number(v.toFixed(2)));
  if (a >= 1e7) return `${sign}${fmt(a / 1e7)} crore`;
  if (a >= 1e5) return `${sign}${fmt(a / 1e5)} lakh`;
  if (a >= 1e3) return `${sign}${fmt(a / 1e3)} thousand`;
  return "";
}
