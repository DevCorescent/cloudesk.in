// A contact's history in the rest of Cloudesk, found by email or phone across
// every project and set of books in the workspace: store and counter orders,
// invoices and quotes, bookings, restaurant visits and website form entries.
import { displayStatus, type DocStatus, type DocType } from "@/lib/invoicing/model";
import { today } from "../invoicing/service";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailKey, phoneKey } from "@/lib/crm/model";

export type Linked = {
  orders: { id: string; projectId: string; project: string; number: number; total: number; currency: string; status: string; paid: boolean; createdAt: string }[];
  invoices: { id: string; ownerId: string; book: boolean; type: string; number: string; total: number; amountPaid: number; currency: string; status: string; issueDate: string }[];
  bookings: { id: string; projectId: string; project: string; service: string; startsAt: string; status: string; amount: number; currency: string; paid: boolean }[];
  visits: { projectId: string; project: string; visits: number; spend: number; points: number; lastVisitAt: string | null }[];
  forms: { id: string; projectId: string; project: string; formId: string; createdAt: string; data: Record<string, unknown> }[];
  /** Money received, in each currency. */
  totals: { currency: string; paid: number }[];
};

const phoneSql = (col: unknown) => sql`right(regexp_replace(${col}, '\\D', '', 'g'), 10)`;

export async function linkedFor(orgId: string, person: { email: string; phone: string }): Promise<Linked> {
  const email = emailKey(person.email);
  const phone = phoneKey(person.phone);
  const empty: Linked = { orders: [], invoices: [], bookings: [], visits: [], forms: [], totals: [] };
  if (!email && !phone) return empty;
  const projects = await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.orgId, orgId));
  const books = await db.select({ id: schema.financeBooks.id }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId));
  const pIds = projects.map((p) => p.id);
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const ownerIds = [...pIds, ...books.map((b) => b.id)];
  const match = (emailCol: unknown, phoneCol: unknown) => or(email ? sql`lower(${emailCol}) = ${email}` : sql`false`, phone ? sql`${phoneSql(phoneCol)} = ${phone}` : sql`false`);

  const [orders, invoices, bookings, guests, forms] = await Promise.all([
    pIds.length
      ? db
          .select({ id: schema.storeOrders.id, projectId: schema.storeOrders.projectId, number: schema.storeOrders.number, total: schema.storeOrders.total, currency: schema.storeOrders.currency, status: schema.storeOrders.financialStatus, paidAt: schema.storeOrders.paidAt, createdAt: schema.storeOrders.createdAt })
          .from(schema.storeOrders)
          .where(and(inArray(schema.storeOrders.projectId, pIds), match(schema.storeOrders.email, schema.storeOrders.phone)))
          .orderBy(desc(schema.storeOrders.createdAt))
          .limit(50)
      : [],
    ownerIds.length
      ? db
          .select({ id: schema.invoiceDocuments.id, ownerId: schema.invoiceDocuments.projectId, type: schema.invoiceDocuments.type, number: schema.invoiceDocuments.number, total: schema.invoiceDocuments.total, amountPaid: schema.invoiceDocuments.amountPaid, currency: schema.invoiceDocuments.currency, status: schema.invoiceDocuments.status, issueDate: schema.invoiceDocuments.issueDate, dueDate: schema.invoiceDocuments.dueDate })
          .from(schema.invoiceDocuments)
          .where(and(inArray(schema.invoiceDocuments.projectId, ownerIds), sql`${schema.invoiceDocuments.status} <> 'draft'`, match(sql`${schema.invoiceDocuments.client}->>'email'`, sql`coalesce(${schema.invoiceDocuments.client}->>'phone', '')`)))
          .orderBy(desc(schema.invoiceDocuments.issueDate))
          .limit(50)
      : [],
    pIds.length
      ? db
          .select({ id: schema.bookings.id, projectId: schema.bookings.projectId, service: schema.bookings.serviceName, startsAt: schema.bookings.startsAt, status: schema.bookings.status, amount: schema.bookings.amount, currency: schema.bookings.currency, paid: schema.bookings.paid })
          .from(schema.bookings)
          .where(and(inArray(schema.bookings.projectId, pIds), match(schema.bookings.email, schema.bookings.phone)))
          .orderBy(desc(schema.bookings.startsAt))
          .limit(50)
      : [],
    pIds.length
      ? db
          .select({ projectId: schema.horecaGuests.projectId, visits: schema.horecaGuests.visits, spend: schema.horecaGuests.spend, points: schema.horecaGuests.points, lastVisitAt: schema.horecaGuests.lastVisitAt })
          .from(schema.horecaGuests)
          .where(and(inArray(schema.horecaGuests.projectId, pIds), match(schema.horecaGuests.email, schema.horecaGuests.phone)))
      : [],
    pIds.length && email
      ? db
          .select({ id: schema.formSubmissions.id, projectId: schema.formSubmissions.projectId, formId: schema.formSubmissions.formId, createdAt: schema.formSubmissions.createdAt, data: schema.formSubmissions.data })
          .from(schema.formSubmissions)
          .where(and(inArray(schema.formSubmissions.projectId, pIds), sql`lower(${schema.formSubmissions.data}::text) like ${"%" + email.replace(/[%_\\]/g, "\\$&") + "%"}`))
          .orderBy(desc(schema.formSubmissions.createdAt))
          .limit(20)
      : [],
  ]);

  const venueCurrency = pIds.length && guests.length ? await db.select({ projectId: schema.horecaVenues.projectId, currency: schema.horecaVenues.currency }).from(schema.horecaVenues).where(inArray(schema.horecaVenues.projectId, guests.map((g) => g.projectId))) : [];
  const totals = new Map<string, number>();
  const add = (cur: string, n: number) => n > 0 && totals.set(cur, (totals.get(cur) ?? 0) + n);
  for (const o of orders) if (o.paidAt) add(o.currency, o.total);
  for (const i of invoices) if (i.type === "invoice") add(i.currency, i.amountPaid);
  for (const b of bookings) if (b.paid) add(b.currency, b.amount);
  for (const g of guests) add(venueCurrency.find((v) => v.projectId === g.projectId)?.currency ?? "INR", g.spend);

  return {
    orders: orders.map((o) => ({ id: o.id, projectId: o.projectId, project: name(o.projectId), number: o.number, total: o.total, currency: o.currency, status: String(o.status), paid: !!o.paidAt, createdAt: o.createdAt.toISOString() })),
    // The status as the invoice list shows it (an unpaid invoice past its due date is overdue).
    invoices: invoices.map(({ dueDate, ...i }) => ({ ...i, status: displayStatus({ type: i.type as DocType, status: i.status as DocStatus, total: i.total, amountPaid: i.amountPaid, dueDate: dueDate ? String(dueDate).slice(0, 10) : null }, today()), book: !pIds.includes(i.ownerId), issueDate: String(i.issueDate) })),
    bookings: bookings.map((b) => ({ ...b, project: name(b.projectId), startsAt: b.startsAt.toISOString() })),
    visits: guests.map((g) => ({ ...g, project: name(g.projectId), lastVisitAt: g.lastVisitAt?.toISOString() ?? null })),
    forms: forms.map((f) => ({ ...f, project: name(f.projectId), createdAt: f.createdAt.toISOString(), data: (f.data ?? {}) as Record<string, unknown> })),
    totals: [...totals.entries()].map(([currency, paid]) => ({ currency, paid })),
  };
}

/** Projects in the workspace (for the capture settings and sync). */
export async function orgProjects(orgId: string) {
  return db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), isNotNull(schema.projects.id)));
}
