// What a signed-in customer sees: what they owe (their invoices across the
// workspace's books, each opening the invoice's own share page with its
// payment details), their payments, their sales orders with deliveries and
// tracking, and their support tickets — and raising a new ticket.
import { and, arrayOverlaps, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { balances, ticketSchema } from "@/lib/portal/model";
import { isOn } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";
import { check } from "../helpdesk/access";
import { intake, ticketLink } from "../helpdesk/core";
import { appUrl } from "../services/mail";
import { clientIds, type Visitor } from "./auth";

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const D = schema.invoiceDocuments;

function requireSection(v: Visitor, on: boolean) {
  if (!on) throw new ApiError("forbidden", "That part of the portal is switched off");
}

export async function invoices(v: Visitor) {
  requireSection(v, v.settings.customers.invoices);
  const ids = await clientIds(v.orgId, v.email);
  if (!ids.length) return [];
  const rows = await db.select().from(D).where(and(inArray(D.clientId, ids), inArray(D.type, ["invoice", "credit_note"]), notInArray(D.status, ["draft"]))).orderBy(desc(D.issueDate), desc(D.number)).limit(500);
  const t = today();
  return rows.map((d) => {
    const balance = d.type === "invoice" && d.status !== "void" ? Math.max(0, d.total - d.amountPaid) : 0;
    const due = d.dueDate ? String(d.dueDate) : null;
    return { id: d.id, type: d.type, number: d.number, date: String(d.issueDate), dueDate: due, currency: d.currency, total: d.total, amountPaid: d.amountPaid, balance, status: d.status === "void" ? "void" : balance === 0 ? (d.type === "invoice" ? "paid" : "issued") : due && due < t ? "overdue" : d.amountPaid ? "part paid" : "due", url: appUrl(`/doc/${d.shareToken}`) };
  });
}

export async function payments(v: Visitor) {
  requireSection(v, v.settings.customers.invoices);
  const ids = await clientIds(v.orgId, v.email);
  if (!ids.length) return [];
  const P = schema.invoicePayments;
  return db.select({ id: P.id, amount: P.amount, method: P.method, paidOn: P.paidOn, invoice: D.number, currency: D.currency }).from(P).innerJoin(D, eq(D.id, P.documentId)).where(inArray(D.clientId, ids)).orderBy(desc(P.paidOn)).limit(500);
}

export async function orders(v: Visitor) {
  requireSection(v, v.settings.customers.orders && isOn(v.modules, "sales"));
  const ids = await clientIds(v.orgId, v.email);
  if (!ids.length) return [];
  const O = schema.salesOrders;
  const rows = await db.select().from(O).where(and(eq(O.orgId, v.orgId), inArray(O.clientId, ids), notInArray(O.status, ["draft", "pending_approval"]))).orderBy(desc(O.date)).limit(200);
  if (!rows.length) return [];
  const dels = await db.select().from(schema.salesDeliveries).where(inArray(schema.salesDeliveries.orderId, rows.map((r) => r.id)));
  const ships = isOn(v.modules, "logistics") && dels.length ? await db.select({ deliveryIds: schema.lgxShipments.deliveryIds, trackToken: schema.lgxShipments.trackToken, status: schema.lgxShipments.status }).from(schema.lgxShipments).where(and(eq(schema.lgxShipments.orgId, v.orgId), arrayOverlaps(schema.lgxShipments.deliveryIds, dels.map((d) => d.id)))) : [];
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    date: String(o.date),
    expectedDate: o.expectedDate ? String(o.expectedDate) : null,
    status: o.status,
    total: o.total,
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, delivered: l.delivered })),
    deliveries: dels.filter((d) => d.orderId === o.id && d.status !== "cancelled").map((d) => {
      const s = ships.find((x) => x.deliveryIds.includes(d.id));
      return { number: d.number, date: String(d.date), status: d.status, tracking: s ? appUrl(`/track/${s.trackToken}`) : null };
    }),
  }));
}

export async function tickets(v: Visitor) {
  requireSection(v, v.settings.customers.tickets && isOn(v.modules, "helpdesk"));
  const T = schema.hdTickets;
  const rows = await db.select().from(T).where(and(eq(T.orgId, v.orgId), sql`lower(${T.customerEmail}) = ${v.email}`)).orderBy(desc(T.createdAt)).limit(200);
  return rows.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, url: ticketLink(t) }));
}

/** A new support request from the portal. */
export async function raiseTicket(v: Visitor, raw: unknown) {
  requireSection(v, v.settings.customers.tickets && isOn(v.modules, "helpdesk"));
  const x = check(ticketSchema, raw);
  // Their name as the workspace has it: on an invoice, or in the CRM.
  const [clientId] = await clientIds(v.orgId, v.email);
  const [c] = clientId ? await db.select({ name: schema.invoiceClients.name }).from(schema.invoiceClients).where(eq(schema.invoiceClients.id, clientId)) : await db.select({ name: schema.crmContacts.name }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, v.orgId), sql`lower(${schema.crmContacts.email}) = ${v.email}`));
  const t = await intake(v.orgId, { subject: x.subject, body: x.body, name: c?.name ?? "", email: v.email, channel: "portal" }, { acknowledge: true });
  return { id: t.id, number: t.number, url: ticketLink(t) };
}

export async function home(v: Visitor) {
  const s = v.settings.customers;
  const inv = s.invoices ? await invoices(v) : [];
  const ord = s.orders && isOn(v.modules, "sales") ? await orders(v) : [];
  const tix = s.tickets && isOn(v.modules, "helpdesk") ? await tickets(v) : [];
  const due = balances(inv.filter((i) => i.type === "invoice" && i.currency === "INR").map((i) => ({ ...i, status: i.status === "void" ? "void" : "sent" })), today());
  return {
    welcome: s.welcome,
    sections: { invoices: s.invoices, orders: s.orders && isOn(v.modules, "sales"), tickets: s.tickets && isOn(v.modules, "helpdesk") },
    ...due,
    openInvoices: inv.filter((i) => i.balance > 0).slice(0, 5),
    openOrders: ord.filter((o) => !["delivered", "closed", "cancelled"].includes(o.status)).slice(0, 5),
    openTickets: tix.filter((t) => !["resolved", "closed"].includes(t.status)).slice(0, 5),
  };
}
