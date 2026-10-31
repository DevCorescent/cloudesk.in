// Amounts in words for printed documents: the Indian system (lakh, crore)
// for rupees, the international one (million, billion) for other currencies.
import { rupeesInWords } from "../store/gst";
import { minorDigits } from "../store/money";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`);
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", two(n % 100)].filter(Boolean).join(" ");

function international(n: number) {
  if (n === 0) return "Zero";
  const scales = ["", "Thousand", "Million", "Billion", "Trillion"];
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < scales.length; i++) {
    const chunk = n % 1000;
    if (chunk) parts.unshift([three(chunk), scales[i]].filter(Boolean).join(" "));
    n = Math.floor(n / 1000);
  }
  return parts.join(" ");
}

const NAMES: Record<string, [string, string]> = {
  USD: ["Dollars", "Cents"], CAD: ["Canadian Dollars", "Cents"], AUD: ["Australian Dollars", "Cents"], SGD: ["Singapore Dollars", "Cents"], NZD: ["New Zealand Dollars", "Cents"],
  EUR: ["Euros", "Cents"], GBP: ["Pounds", "Pence"], AED: ["Dirhams", "Fils"], SAR: ["Riyals", "Halalas"], JPY: ["Yen", ""], CHF: ["Francs", "Centimes"], ZAR: ["Rand", "Cents"], NPR: ["Nepalese Rupees", "Paisa"], LKR: ["Sri Lankan Rupees", "Cents"], BDT: ["Taka", "Poisha"],
};

export function amountInWords(minor: number, currency: string) {
  const code = currency.toUpperCase();
  if (code === "INR") return rupeesInWords(minor);
  const digits = minorDigits(code);
  const unit = 10 ** digits;
  const whole = Math.floor(Math.abs(minor) / unit);
  const frac = Math.abs(minor) % unit;
  const [major, small] = NAMES[code] ?? [code, ""];
  return `${international(whole)} ${major}${frac && small ? ` and ${two(frac)} ${small}` : frac ? ` and ${frac}/${unit}` : ""} Only`;
}
