// Reading a supplier's bill: the JSON shape the model fills from a PDF or
// photo, and turning what it read into a draft for the bill form — supplier
// matched by GSTIN or name, lines put to an account, GST inside or across
// states — with warnings for anything that doesn't add up. Never saved here.
import { z } from "zod";
import { GST_CODE_STATE, validateGstin } from "@/lib/store/gst";

const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];

/** What the model returns. Amounts are in the bill's currency, in major units (rupees). */
export const extractedSchema = z.object({
  isBill: z.boolean(),
  supplierName: z.string().max(200),
  supplierGstin: z.string().max(20),
  billNo: z.string().max(80),
  date: z.string().max(10),
  dueDate: z.string().max(10),
  currency: z.string().max(3),
  lines: z.array(z.object({ description: z.string().max(300), amount: z.number(), gstRate: z.number(), accountCode: z.string().max(20) })).max(100),
  taxTotal: z.number(),
  total: z.number(),
});
export type Extracted = z.infer<typeof extractedSchema>;

/** The same shape as JSON Schema, for structured output (every field required; empty when not on the bill). */
export const EXTRACT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isBill", "supplierName", "supplierGstin", "billNo", "date", "dueDate", "currency", "lines", "taxTotal", "total"],
  properties: {
    isBill: { type: "boolean", description: "false if this isn't a bill, invoice or receipt" },
    supplierName: { type: "string", description: "The seller's name" },
    supplierGstin: { type: "string", description: "The seller's GSTIN, or empty" },
    billNo: { type: "string", description: "The invoice or bill number" },
    date: { type: "string", description: "Invoice date as YYYY-MM-DD" },
    dueDate: { type: "string", description: "Due date as YYYY-MM-DD, or empty" },
    currency: { type: "string", description: "ISO code, INR unless the bill says otherwise" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "amount", "gstRate", "accountCode"],
        properties: {
          description: { type: "string" },
          amount: { type: "number", description: "Taxable value of the line before GST, in major units (e.g. rupees)" },
          gstRate: { type: "number", description: "Total GST rate in percent (CGST+SGST, or IGST), 0 if none" },
          accountCode: { type: "string", description: "Code of the best account from the list given, or empty" },
        },
      },
    },
    taxTotal: { type: "number", description: "Total GST charged" },
    total: { type: "number", description: "Grand total payable" },
  },
} as const;

export type Supplier = { id: string; name: string; gstin: string; state: string };
export type Account = { id: string; code: string; name: string };
export type BillDraft = {
  supplierId: string | null;
  supplierName: string;
  supplierGstin: string;
  billNo: string;
  date: string;
  dueDate: string | null;
  currency: string;
  interState: boolean;
  lines: { accountId: string | null; description: string; amount: number; gstRate: number }[];
};

const day = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : "");
const norm = (s: string) => s.toLowerCase().replace(/\b(private|pvt|limited|ltd|llp|co|company|the)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/** Turn what was read into a draft, with warnings. `fallbackAccountId`: the account this supplier's last bill went to. */
export function toDraft(x: Extracted, ctx: { suppliers: Supplier[]; accounts: Account[]; homeState: string; today: string; fallbackAccountId?: (supplierId: string) => string | null }) {
  const warnings: string[] = [];
  if (!x.isBill) warnings.push("This doesn't look like a bill. Check everything before saving.");
  const gstin = x.supplierGstin.trim().toUpperCase().replace(/\s+/g, "");
  let gstState = "";
  if (gstin) {
    const v = validateGstin(gstin);
    if (v.ok) gstState = GST_CODE_STATE[gstin.slice(0, 2)] ?? "";
    else warnings.push(`The supplier's GSTIN “${gstin}” doesn't check out: ${v.reason}.`);
  }
  const sup = (gstin && ctx.suppliers.find((s) => s.gstin.toUpperCase() === gstin)) || (norm(x.supplierName) && ctx.suppliers.find((s) => norm(s.name) === norm(x.supplierName))) || null;
  if (sup && gstin && sup.gstin && sup.gstin.toUpperCase() !== gstin) warnings.push(`${sup.name} has a different GSTIN on file (${sup.gstin}).`);
  if (!sup && x.supplierName.trim()) warnings.push(`“${x.supplierName.trim()}” isn't one of your suppliers yet — it will be saved by name.`);
  const theirState = sup?.state || gstState;
  const currency = /^[A-Z]{3}$/.test(x.currency.toUpperCase()) ? x.currency.toUpperCase() : "INR";

  const byCode = new Map(ctx.accounts.map((a) => [a.code, a.id]));
  const fallback = sup && ctx.fallbackAccountId ? ctx.fallbackAccountId(sup.id) : null;
  const minor = (n: number) => Math.round(n * 100);
  const lines = x.lines
    .filter((l) => Number.isFinite(l.amount) && l.amount !== 0)
    .map((l) => {
      const rate = GST_RATES.includes(l.gstRate) ? l.gstRate : 0;
      if (rate !== l.gstRate) warnings.push(`A GST rate of ${l.gstRate}% on “${l.description}” isn't a standard rate — set to 0%.`);
      return { accountId: byCode.get(l.accountCode.trim()) ?? fallback, description: l.description.trim().slice(0, 200), amount: minor(l.amount), gstRate: rate };
    });
  if (!lines.length) warnings.push("No lines could be read. Add them by hand.");
  if (lines.some((l) => !l.accountId)) warnings.push("Pick an account for each line.");

  // Does it add up? Within ₹1 per line for rounding.
  const sub = lines.reduce((n, l) => n + l.amount, 0);
  const tax = lines.reduce((n, l) => n + Math.round((l.amount * l.gstRate) / 100), 0);
  const slack = 100 * Math.max(1, lines.length);
  if (x.taxTotal && Math.abs(tax - minor(x.taxTotal)) > slack) warnings.push(`GST worked out from the lines (${(tax / 100).toFixed(2)}) differs from the bill's GST (${x.taxTotal.toFixed(2)}).`);
  if (x.total && Math.abs(sub + tax - minor(x.total)) > slack) warnings.push(`The lines and GST come to ${((sub + tax) / 100).toFixed(2)}, but the bill's total is ${x.total.toFixed(2)}. Check for missing lines, discounts or round-off.`);

  const date = day(x.date);
  if (!date) warnings.push("The bill date couldn't be read — today's date is used.");
  else if (date > ctx.today) warnings.push("The bill date is in the future.");
  const due = day(x.dueDate);
  const draft: BillDraft = {
    supplierId: sup?.id ?? null,
    supplierName: (sup?.name ?? x.supplierName.trim()).slice(0, 120),
    supplierGstin: gstin,
    billNo: x.billNo.trim().slice(0, 60),
    date: date || ctx.today,
    dueDate: due && due >= (date || ctx.today) ? due : null,
    currency,
    interState: currency === "INR" && !!theirState && !!ctx.homeState && theirState !== ctx.homeState,
    lines,
  };
  return { draft, warnings };
}
