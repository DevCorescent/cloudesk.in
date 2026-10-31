// Customer and supplier portals: what each side may see and do, and the
// checks on what they send. Customers sign in with their email (a one-time
// link) and see their own invoices, orders and support tickets; suppliers see
// the RFQs they were asked to quote, their purchase orders and their bills.
import { z } from "zod";

export const KINDS = ["customer", "supplier"] as const;
export type PortalKind = (typeof KINDS)[number];

export const settingsSchema = z.object({
  customers: z.object({ enabled: z.boolean().default(true), invoices: z.boolean().default(true), orders: z.boolean().default(true), tickets: z.boolean().default(true), welcome: z.string().trim().max(1000).default("") }).prefault({}),
  suppliers: z.object({ enabled: z.boolean().default(true), rfqs: z.boolean().default(true), orders: z.boolean().default(true), invoices: z.boolean().default(true), welcome: z.string().trim().max(1000).default("") }).prefault({}),
});
export type PortalSettings = z.infer<typeof settingsSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
export const loginSchema = z.object({ email: z.email("Enter your email").max(320), kind: z.enum(KINDS) });
export const ticketSchema = z.object({ subject: z.string().trim().min(1, "What's it about?").max(200), body: z.string().trim().min(1, "Tell us more").max(10_000) });
/** Rates in rupees as typed; stored in paise. */
export const quoteSchema = z.object({
  lines: z.array(z.object({ itemId: z.uuid(), rate: z.number().min(0).max(1e9), gstRate: z.number().min(0).max(28).default(18), leadDays: z.number().int().min(0).max(365).default(7) })).min(1, "Quote at least one item").max(200),
  validTill: day.nullable().default(null),
  terms: z.string().trim().max(1000).default(""),
});
export const ackSchema = z.object({ promisedDate: day.nullable().default(null), note: z.string().trim().max(1000).default("") });
export const dispatchSchema = z.object({ date: day, reference: z.string().trim().min(1, "Add the LR, AWB or challan number").max(80), carrier: z.string().trim().max(80).default(""), note: z.string().trim().max(1000).default("") });
export const invoiceSchema = z.object({ invoiceNo: z.string().trim().min(1, "Your invoice number").max(60), date: day, amount: z.number().positive("Enter the invoice total").max(1e11), poId: z.uuid().nullable().default(null), note: z.string().trim().max(1000).default("") });
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** How long links and sessions last. */
export const LINK_MINUTES = 30;
export const SESSION_DAYS = 30;

/** The cookie a portal session lives in (one per side, so a customer and supplier can both sign in). */
export const cookieName = (kind: PortalKind) => `cd_portal_${kind}`;

/** Where a purchase order stands from the supplier's side. */
export function poStage(po: { status: string; supplierAck: unknown; dispatches: unknown[] }) {
  if (po.status === "cancelled") return "Cancelled";
  if (po.status === "received" || po.status === "closed") return "Received";
  if (po.status === "partial") return "Partly received";
  if (po.dispatches.length) return "Dispatched";
  if (po.supplierAck) return "Acknowledged";
  return "Awaiting your acknowledgement";
}

/** What's due on a set of invoices: outstanding and overdue totals (paise). */
export function balances(invoices: { total: number; amountPaid: number; dueDate: string | null; status: string }[], today: string) {
  let outstanding = 0;
  let overdue = 0;
  for (const i of invoices) {
    if (i.status === "void" || i.status === "draft") continue;
    const due = Math.max(0, i.total - i.amountPaid);
    outstanding += due;
    if (due && i.dueDate && i.dueDate < today) overdue += due;
  }
  return { outstanding, overdue };
}
