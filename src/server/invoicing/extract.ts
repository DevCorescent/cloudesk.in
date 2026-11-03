// Reading the owner's existing invoice (an image or PDF) to set up a matching
// template: layout, colours, type, columns, wording, and their own business
// and bank details. Needs an AI provider; the result is always shown for the
// owner to check before anything is applied.
import { z } from "zod";
import { defaultTemplateConfig, FONTS, LAYOUTS, type TemplateConfig } from "@/lib/invoicing/model";
import { completeJson } from "../ai/json";
import { db, schema } from "@/db";
import { hasLlm } from "../ai/gateway";
import { assertAiAllowed } from "../ai/tasks";
import { ApiError } from "../http/errors";

export const REFERENCE_TYPES: Record<string, "image" | "pdf"> = { "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image", "application/pdf": "pdf" };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().catch(undefined);
const str = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);

const extractedSchema = z.object({
  layout: z.enum(LAYOUTS).catch("classic"),
  colors: z.object({ accent: hex, ink: hex, tableHeader: hex }).catch({}),
  font: z.enum(FONTS).catch("sans"),
  paper: z.enum(["A4", "Letter", "A5"]).optional().catch(undefined),
  logoPosition: z.enum(["left", "right", "center", "none"]).catch("left"),
  tableStyle: z.enum(["lines", "striped", "boxed", "minimal"]).catch("lines"),
  columns: z.object({ sn: flag, hsn: flag, quantity: flag, unit: flag, rate: flag, discount: flag, tax: flag, amount: flag }).catch({}),
  labels: z.object({ title: str(40), billTo: str(40), shipTo: str(40), number: str(40), date: str(40), dueDate: str(40), item: str(40), hsn: str(40), quantity: str(40), rate: str(40), discount: str(40), tax: str(40), amount: str(40), subtotal: str(40), total: str(40), balance: str(40), notes: str(40), terms: str(40), signatory: str(40) }).catch({}),
  show: z.object({ amountInWords: flag, taxSummary: flag, bankDetails: flag, upiQr: flag, signature: flag, placeOfSupply: flag, businessGstin: flag, clientGstin: flag, shipTo: flag }).catch({}),
  business: z.object({ name: str(160), legalName: str(160), addressLine1: str(200), addressLine2: str(200), city: str(80), state: str(80), postalCode: str(16), phone: str(30), email: str(200), website: str(200), gstin: str(15), pan: str(10) }).catch({}),
  bank: z.object({ bankName: str(80), accountName: str(120), accountNumber: str(40), ifsc: str(20), branch: str(80), swift: str(20), upiId: str(80) }).catch({}),
  terms: str(4000),
  notes: str(4000),
  footer: str(500),
  numberExample: str(40),
  currency: z.string().trim().length(3).optional().catch(undefined),
  /** What couldn't be read or had to be guessed. */
  uncertain: z.array(z.string().max(200)).max(10).catch([]),
});
export type Extracted = z.infer<typeof extractedSchema>;

const SYSTEM = `You look at one invoice, quotation or bill and describe its design so a template can reproduce it.

Return only a JSON object with these keys:
- layout: the closest of ${LAYOUTS.join(", ")} (classic = logo left, title right, ruled; modern = big coloured title, coloured table header; minimal = hairlines, no fills; band = full-width coloured header band; elegant = serif, centred letterhead; compact = dense boxed grid typical of GST/Tally invoices; corporate = thin coloured top rule with a grey details panel; creative = decorative shapes, highlighted total)
- colors: { accent, ink, tableHeader } as #rrggbb (accent = the main brand colour used for titles/bands; tableHeader = fill behind the item table's header row, #ffffff if none)
- font: one of ${FONTS.join(", ")} (closest family)
- paper: A4, Letter or A5 if you can tell
- logoPosition: left, right, center or none
- tableStyle: lines, striped, boxed or minimal
- columns: which item-table columns appear: { sn, hsn, quantity, unit, rate, discount, tax, amount } as true/false
- labels: the exact wording printed for: title (e.g. "Tax Invoice"), billTo, shipTo, number, date, dueDate, item (the description column heading), hsn, quantity, rate, discount, tax, amount, subtotal, total, balance, notes, terms, signatory. Omit any that aren't printed.
- show: true/false for amountInWords, taxSummary (an HSN/rate-wise tax table), bankDetails, upiQr, signature, placeOfSupply, businessGstin, clientGstin, shipTo
- business: the ISSUER's own details only (the seller at the top): name, legalName, addressLine1, addressLine2, city, state, postalCode, phone, email, website, gstin, pan
- bank: the issuer's payment details if printed: bankName, accountName, accountNumber, ifsc, branch, swift, upiId
- terms, notes, footer: the issuer's standard wording, copied exactly
- numberExample: the document number exactly as printed (e.g. "INV/2025-26/0042")
- currency: ISO code if clear
- uncertain: short notes on anything you had to guess

Never copy the customer's (bill-to / ship-to) name, address, contact or GSTIN, line items, quantities or amounts. Leave out any field you cannot read rather than inventing it.`;

export async function readInvoiceFormat(orgId: string, file: { mime: string; data: Buffer }) {
  const kind = REFERENCE_TYPES[file.mime];
  if (!kind) throw new ApiError("validation_failed", "Upload a PNG, JPEG, WebP or PDF of your invoice");
  if (!(await hasLlm(orgId))) return { ai: false as const };
  await assertAiAllowed(orgId);
  const b64 = file.data.toString("base64");
  const media =
    kind === "pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
      : ({ type: "image", source: { type: "base64", media_type: file.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: b64 } } as const);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 150_000);
  try {
    const started = new Date();
    const { value, usage } = await completeJson(
      { orgId, task: "planning", system: SYSTEM, maxTokens: 16_000, signal: ac.signal, messages: [{ role: "user", content: [media, { type: "text", text: "Describe this document's design and the issuer's details as JSON." }] }] },
      extractedSchema,
      { maxRepairs: 1 },
    );
    // Counted against the month's AI allowance, like every other AI call.
    await db.insert(schema.aiTasks).values({ orgId, kind: "invoice_design", status: "succeeded", input: { mime: file.mime }, startedAt: started, finishedAt: new Date(), ...usage });
    return { ai: true as const, extracted: value, ...applyExtracted(value) };
  } finally {
    clearTimeout(timer);
  }
}

const set = <T>(v: T | undefined, apply: (v: T) => void) => {
  if (v !== undefined && v !== null && v !== "") apply(v);
};

/** Turns what was read into a template plus suggested settings. Pure, so it's unit-tested. */
export function applyExtracted(e: Extracted): { config: TemplateConfig; suggestions: { business: Record<string, string>; payment: Record<string, string>; terms?: string; notes?: string; numbering?: { prefix: string; yearly: boolean; pad: number }; currency?: string } } {
  const c = defaultTemplateConfig();
  c.layout = e.layout;
  c.font = e.font;
  set(e.paper, (v) => (c.paper = v));
  c.logo.position = e.logoPosition;
  c.table.style = e.tableStyle;
  set(e.colors.accent, (v) => (c.colors.accent = v));
  set(e.colors.ink, (v) => (c.colors.ink = v));
  set(e.colors.tableHeader, (v) => (c.colors.tableHeader = v));
  for (const k of Object.keys(c.table.columns) as (keyof typeof c.table.columns)[]) set(e.columns[k], (v) => (c.table.columns[k] = v));
  for (const k of Object.keys(e.show) as (keyof typeof e.show)[]) set(e.show[k], (v) => (c.show[k] = v));
  const { title, ...labels } = e.labels;
  set(title, (v) => {
    c.labels.invoice = v;
  });
  for (const [k, v] of Object.entries(labels)) set(v, (x) => ((c.labels as Record<string, string>)[k] = x));
  set(e.footer, (v) => (c.footerText = v));

  const b = e.business;
  const business: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (v) business[k] = v;
  const payment: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.bank)) if (v) payment[k] = v;

  // "INV/2025-26/0042" → prefix INV, yearly, 4 digits; "BILL-0042" → prefix BILL, 4 digits.
  let numbering: { prefix: string; yearly: boolean; pad: number } | undefined;
  if (e.numberExample) {
    const parts = e.numberExample.split(/[/\-]/).filter(Boolean);
    const last = parts.at(-1) ?? "";
    if (/^\d+$/.test(last)) {
      const yearly = parts.some((p) => /^\d{4}-?\d{2}$|^\d{2}-\d{2}$/.test(p)) || /\d{4}-\d{2}/.test(e.numberExample);
      const prefix = parts.find((p) => /[A-Za-z]/.test(p)) ?? "";
      numbering = { prefix: prefix.slice(0, 20), yearly, pad: Math.min(8, Math.max(1, last.length)) };
    }
  }
  return { config: c, suggestions: { business, payment, terms: e.terms, notes: e.notes, numbering, currency: e.currency } };
}
