// India GST helpers: GSTIN validation, state codes, invoice numbering
// periods, amounts in words and per-line tax for invoices and returns.
// Pure, shared by the server and the editor.
import { computeTotals } from "./pricing";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
  "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

/** GST state code → two-letter state code, as used for locations and suppliers. */
export const GST_CODE_STATE: Record<string, string> = { "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA" };

export const stateCode = (state: string) => Object.entries(GST_STATES).find(([, n]) => n.toLowerCase() === state.trim().toLowerCase())?.[0] ?? null;

function checkChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** Checks the GSTIN format, state code and check digit. */
export function validateGstin(raw: string): { ok: true; gstin: string; state: string } | { ok: false; reason: string } {
  const g = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, reason: "A GSTIN has 15 characters, like 29ABCDE1234F1Z5" };
  const state = GST_STATES[g.slice(0, 2)];
  if (!state) return { ok: false, reason: "The first two digits are not a valid state code" };
  if (checkChar(g.slice(0, 14)) !== g[14]) return { ok: false, reason: "The GSTIN check digit is wrong — please check for typos" };
  return { ok: true, gstin: g, state };
}

/** Indian financial year label (April–March), e.g. "2026-27". */
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", two(n % 100)].filter(Boolean).join(" ");

/** Rupees in words using the Indian system (lakh, crore), e.g. for invoices. */
export function rupeesInWords(paise: number) {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? rupeesInWords(crore * 100).replace(/ Rupees Only$/, "") : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  const words = parts.join(" ") || "Zero";
  return `${words} Rupees${p ? ` and ${two(p)} Paise` : ""} Only`;
}

export type InvoiceLine = { key: string; title: string; hsn: string; quantity: number; unitPrice: number; taxBps: number };

/**
 * Taxable value and tax for each line of an order, recomputed with the same
 * rules checkout used (discount allocated by value). Shipping tax is the part
 * of the order's tax not explained by the lines.
 */
export function orderTaxLines(lines: InvoiceLine[], o: { discountTotal: number; shippingTotal: number; taxTotal: number; taxIncluded: boolean }) {
  const t = computeTotals({ lines: lines.map((l) => ({ key: l.key, unitPrice: l.unitPrice, quantity: l.quantity, taxBps: l.taxBps, weightGrams: 0 })), discount: o.discountTotal ? { kind: "fixed", value: o.discountTotal, minSubtotal: 0, code: "" } : null, shipping: 0, pricesIncludeTax: o.taxIncluded });
  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  let allocated = 0;
  const out = lines.map((l, i) => {
    const gross = l.unitPrice * l.quantity;
    const share = i === lines.length - 1 ? o.discountTotal - allocated : subtotal ? Math.round((o.discountTotal * gross) / subtotal) : 0;
    allocated += share;
    const net = Math.max(0, gross - share);
    const tax = t.lineTax[l.key] ?? 0;
    return { ...l, discount: share, taxable: o.taxIncluded ? net - tax : net, tax };
  });
  const lineTax = out.reduce((a, l) => a + l.tax, 0);
  const shippingTax = Math.max(0, o.taxTotal - lineTax);
  const shippingTaxable = o.taxIncluded ? o.shippingTotal - shippingTax : o.shippingTotal;
  return { lines: out, shipping: { taxable: shippingTaxable, tax: shippingTax } };
}

/** Splits tax by place of supply: same state → CGST + SGST, otherwise IGST. */
export function splitTax(tax: number, intraState: boolean) {
  if (!intraState) return { igst: tax, cgst: 0, sgst: 0 };
  const cgst = Math.floor(tax / 2);
  return { igst: 0, cgst, sgst: tax - cgst };
}
