// Invoicing: invoices, quotations, proforma invoices and credit notes, with
// clients, saved items, payments and print templates. Shared by the server
// and the editor so both validate the same things.
import { z } from "zod";

export const DOC_TYPES = ["invoice", "quote", "proforma", "credit_note"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_LABEL: Record<DocType, string> = { invoice: "Invoice", quote: "Quotation", proforma: "Proforma invoice", credit_note: "Credit note" };
export const DOC_PLURAL: Record<DocType, string> = { invoice: "Invoices", quote: "Quotations", proforma: "Proforma invoices", credit_note: "Credit notes" };

export const TAX_MODES = ["gst", "simple", "none"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const PAY_METHODS = ["bank", "upi", "cash", "card", "cheque", "online", "other", "advance"] as const;
export const PAY_METHOD_LABEL: Record<(typeof PAY_METHODS)[number], string> = { bank: "Bank transfer", upi: "UPI", cash: "Cash", card: "Card", cheque: "Cheque", online: "Online gateway", other: "Other", advance: "From an advance" };
/** Methods people pick by hand; an advance is applied from Accounts → Receipts. */
export const PICKABLE_PAY_METHODS = PAY_METHODS.filter((m) => m !== "advance");

const money = z.number().int().min(0).max(100_000_000_000);
const text = (max: number) => z.string().trim().max(max).default("");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-21");

export const addressSchema = z.object({ line1: text(200), line2: text(200), city: text(80), state: text(80), postalCode: text(16), country: text(2) });
export type Address = z.infer<typeof addressSchema>;
export const emptyAddress = (): Address => ({ line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" });

/** Who the document is for, as printed (a snapshot, so old invoices never change). */
export const partySchema = z.object({
  name: z.string().trim().min(1, "Add the client's name").max(160),
  company: text(160),
  email: z.union([z.email().max(200), z.literal("")]).default(""),
  phone: text(30),
  gstin: text(15),
  billing: addressSchema.default(emptyAddress),
  shipping: addressSchema.nullable().default(null),
});
export type Party = z.infer<typeof partySchema>;

export const lineSchema = z.object({
  id: z.string().min(1).max(40),
  itemId: z.uuid().nullable().default(null),
  name: z.string().trim().min(1, "Every line needs a description").max(300),
  description: text(1000),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN/SAC codes have 4, 6 or 8 digits").default(""),
  /** Up to three decimals (e.g. 2.5 kg). */
  quantity: z.number().min(0).max(1_000_000).refine((q) => Math.round(q * 1000) === q * 1000, "Use up to 3 decimals"),
  unit: text(20),
  /** Price per unit, in minor units. */
  rate: money,
  discount: z.object({ kind: z.enum(["percent", "amount"]), value: z.number().min(0).max(100_000_000_000) }).nullable().default(null),
  taxBps: z.number().int().min(0).max(10_000).default(0),
});
export type Line = z.infer<typeof lineSchema>;

export const chargeSchema = z.object({ label: z.string().trim().min(1).max(60), amount: money, taxBps: z.number().int().min(0).max(10_000).default(0) });
export const adjustmentsSchema = z.object({
  discount: z.object({ kind: z.enum(["percent", "amount"]), value: z.number().min(0).max(100_000_000_000) }).nullable().default(null),
  charges: z.array(chargeSchema).max(6).default([]),
  roundOff: z.boolean().default(true),
});
export type Adjustments = z.infer<typeof adjustmentsSchema>;

export const recurringSchema = z.object({ every: z.enum(["week", "month", "quarter", "year"]), nextRun: isoDate, endsOn: isoDate.nullable().default(null), autoSend: z.boolean().default(false) });
export type Recurring = z.infer<typeof recurringSchema>;

export const docInputSchema = z.object({
  type: z.enum(DOC_TYPES),
  clientId: z.uuid().nullable().default(null),
  client: partySchema,
  issueDate: isoDate,
  dueDate: isoDate.nullable().default(null),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code").transform((c) => c.toUpperCase()),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(300),
  adjustments: adjustmentsSchema.default({ discount: null, charges: [], roundOff: true }),
  taxMode: z.enum(TAX_MODES),
  inclusive: z.boolean().default(false),
  /** State of supply (India GST): decides CGST+SGST vs IGST. */
  placeOfSupply: text(80),
  title: text(80),
  /** The client's PO / reference number. */
  reference: text(80),
  notes: text(4000),
  terms: text(4000),
  footer: text(500),
  customFields: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().max(200) })).max(12).default([]),
  templateId: z.uuid().nullable().default(null),
  recurring: recurringSchema.nullable().default(null),
  /** Optional manual number; otherwise the next number in the series is used when issued. */
  number: z.string().trim().max(40).regex(/^[\w\-/.#]*$/, "Numbers can use letters, digits and - / . #").default(""),
});
export type DocInput = z.infer<typeof docInputSchema>;

export const clientSchema = partySchema.extend({ notes: text(2000) });
export const itemSchema = z.object({ name: z.string().trim().min(1).max(300), description: text(1000), hsn: lineSchema.shape.hsn, unit: text(20), rate: money, taxBps: z.number().int().min(0).max(10_000).default(0), invItemId: z.uuid().nullable().default(null) });

/** `inrAmount`: for a payment in another currency, the rupees that actually reached the bank (for the books). */
export const paymentSchema = z.object({ amount: z.number().int().min(1).max(100_000_000_000), method: z.enum(PAY_METHODS), paidOn: isoDate, reference: text(120), note: text(500), inrAmount: z.number().int().min(1).max(1e13).nullable().default(null) });

// ── Templates ──────────────────────────────────────────────────────────────

export const LAYOUTS = ["classic", "modern", "minimal", "band", "elegant", "compact", "corporate", "creative"] as const;
export const FONTS = ["sans", "serif", "humanist", "geometric", "mono"] as const;
export const FONT_STACK: Record<(typeof FONTS)[number], string> = {
  sans: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,
  serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`,
  humanist: `Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif`,
  geometric: `Avenir, Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif`,
  mono: `ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace`,
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const bool = (d: boolean) => z.boolean().default(d);
const label = (d: string) => z.string().trim().max(40).default(d);

export const templateConfigSchema = z.object({
  layout: z.enum(LAYOUTS).default("classic"),
  colors: z.object({ accent: hex.default("#111111"), ink: hex.default("#111111"), muted: hex.default("#5f6368"), tableHeader: hex.default("#f3f3f3") }).default({ accent: "#111111", ink: "#111111", muted: "#5f6368", tableHeader: "#f3f3f3" }),
  font: z.enum(FONTS).default("sans"),
  /** Base text size in points. */
  fontSize: z.number().min(8).max(13).default(9.5),
  paper: z.enum(["A4", "Letter", "A5"]).default("A4"),
  margin: z.number().min(6).max(30).default(14),
  logo: z.object({ position: z.enum(["left", "right", "center", "none"]).default("left"), height: z.number().min(8).max(40).default(16) }).default({ position: "left", height: 16 }),
  table: z
    .object({
      style: z.enum(["lines", "striped", "boxed", "minimal"]).default("lines"),
      columns: z.object({ sn: bool(true), hsn: bool(true), quantity: bool(true), unit: bool(false), rate: bool(true), discount: bool(false), tax: bool(true), amount: bool(true) }).default({ sn: true, hsn: true, quantity: true, unit: false, rate: true, discount: false, tax: true, amount: true }),
    })
    .default({ style: "lines", columns: { sn: true, hsn: true, quantity: true, unit: false, rate: true, discount: false, tax: true, amount: true } }),
  show: z
    .object({
      businessGstin: bool(true),
      clientGstin: bool(true),
      clientContact: bool(true),
      shipTo: bool(true),
      placeOfSupply: bool(true),
      amountInWords: bool(true),
      taxSummary: bool(true),
      bankDetails: bool(true),
      upiQr: bool(true),
      signature: bool(true),
      notes: bool(true),
      terms: bool(true),
      paidStamp: bool(true),
    })
    .default({ businessGstin: true, clientGstin: true, clientContact: true, shipTo: true, placeOfSupply: true, amountInWords: true, taxSummary: true, bankDetails: true, upiQr: true, signature: true, notes: true, terms: true, paidStamp: true }),
  labels: z
    .object({
      invoice: label("Tax Invoice"),
      quote: label("Quotation"),
      proforma: label("Proforma Invoice"),
      credit_note: label("Credit Note"),
      billTo: label("Bill to"),
      shipTo: label("Ship to"),
      number: label("No."),
      date: label("Date"),
      dueDate: label("Due date"),
      validUntil: label("Valid until"),
      item: label("Item & description"),
      hsn: label("HSN/SAC"),
      quantity: label("Qty"),
      rate: label("Rate"),
      discount: label("Discount"),
      tax: label("Tax"),
      amount: label("Amount"),
      subtotal: label("Subtotal"),
      total: label("Total"),
      balance: label("Balance due"),
      notes: label("Notes"),
      terms: label("Terms & conditions"),
      signatory: label("Authorised signatory"),
    })
    .prefault({}),
  signature: z.object({ image: z.string().max(400).default(""), name: z.string().trim().max(80).default("") }).default({ image: "", name: "" }),
  footerText: z.string().trim().max(500).default(""),
});
export type TemplateConfig = z.infer<typeof templateConfigSchema>;
export const defaultTemplateConfig = (): TemplateConfig => templateConfigSchema.parse({ labels: {} });

// ── Settings ───────────────────────────────────────────────────────────────

const series = z.object({ prefix: z.string().trim().max(20).regex(/^[\w\-/.#]*$/).default(""), next: z.number().int().min(1).max(999_999_999).default(1), pad: z.number().int().min(1).max(8).default(4), yearly: bool(true) });
export type Series = z.infer<typeof series>;

export const settingsSchema = z.object({
  business: z
    .object({ name: text(160), legalName: text(160), email: z.union([z.email().max(200), z.literal("")]).default(""), phone: text(30), website: text(200), gstin: text(15), pan: text(10), address: addressSchema.default(emptyAddress), logo: z.string().max(400).default("") })
    .default({ name: "", legalName: "", email: "", phone: "", website: "", gstin: "", pan: "", address: emptyAddress(), logo: "" }),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code").default("INR"),
  taxMode: z.enum(TAX_MODES).default("gst"),
  /** Name used for tax outside GST, e.g. VAT or Sales tax. */
  taxLabel: z.string().trim().max(20).default("Tax"),
  defaultTaxBps: z.number().int().min(0).max(10_000).default(1800),
  inclusive: bool(false),
  numbering: z
    .object({ invoice: series.default({ prefix: "INV", next: 1, pad: 4, yearly: true }), quote: series.default({ prefix: "QT", next: 1, pad: 4, yearly: true }), proforma: series.default({ prefix: "PI", next: 1, pad: 4, yearly: true }), credit_note: series.default({ prefix: "CN", next: 1, pad: 4, yearly: true }) })
    .default({ invoice: { prefix: "INV", next: 1, pad: 4, yearly: true }, quote: { prefix: "QT", next: 1, pad: 4, yearly: true }, proforma: { prefix: "PI", next: 1, pad: 4, yearly: true }, credit_note: { prefix: "CN", next: 1, pad: 4, yearly: true } }),
  dueDays: z.number().int().min(0).max(365).default(15),
  quoteValidDays: z.number().int().min(0).max(365).default(30),
  notes: text(4000),
  terms: text(4000),
  payment: z
    .object({ upiId: z.string().trim().max(80).default(""), bankName: text(80), accountName: text(120), accountNumber: text(40), ifsc: text(20), branch: text(80), swift: text(20), instructions: text(1000) })
    .default({ upiId: "", bankName: "", accountName: "", accountNumber: "", ifsc: "", branch: "", swift: "", instructions: "" }),
  reminders: z.object({ enabled: bool(false), beforeDays: z.number().int().min(0).max(30).default(3), afterDays: z.array(z.number().int().min(1).max(120)).max(5).default([3, 10]) }).default({ enabled: false, beforeDays: 3, afterDays: [3, 10] }),
  defaultTemplateId: z.uuid().nullable().default(null),
});
export type InvoiceSettings = z.infer<typeof settingsSchema>;

// ── Status ─────────────────────────────────────────────────────────────────

export type DocStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "converted" | "partial" | "paid" | "void";
export type DisplayStatus = DocStatus | "overdue" | "expired";

/** What to show: paid/partial come from payments, overdue/expired from dates. */
export function displayStatus(d: { type: DocType; status: DocStatus; total: number; amountPaid: number; dueDate: string | null }, today: string): DisplayStatus {
  if (d.status === "void" || d.status === "draft" || d.status === "converted" || d.status === "declined" || d.status === "accepted") return d.status;
  if (d.type === "quote") return d.dueDate && d.dueDate < today ? "expired" : d.status;
  if (d.type === "credit_note") return d.status;
  if (d.amountPaid >= d.total && d.total > 0) return "paid";
  if (d.dueDate && d.dueDate < today) return "overdue";
  return d.amountPaid > 0 ? "partial" : d.status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", accepted: "Accepted", declined: "Declined", converted: "Converted", partial: "Part paid", paid: "Paid", void: "Void", overdue: "Overdue", expired: "Expired" };

/** Adds whole calendar units to an ISO date (month-end safe). */
export function addPeriod(iso: string, every: Recurring["every"], n = 1): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (every === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else {
    const months = every === "month" ? n : every === "quarter" ? 3 * n : 12 * n;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
