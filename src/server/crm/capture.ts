// Leads that arrive by themselves. Website forms, store and counter orders,
// bookings, restaurant guests and invoicing clients become (or update) CRM
// contacts as they happen; a sync brings in everyone from before; and a public
// web-to-lead URL takes forms from anywhere. Capture never breaks the flow that
// triggered it.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";
import { contactSchema, emailDomain, emailKey, LIFECYCLE, personFromForm, phoneKey, SOURCE_LABEL, type Lifecycle } from "@/lib/crm/model";
import { isOn } from "@/lib/workspace/modules";
import type { EventType } from "@/lib/platform/events";
import { getSettings, nextOwner, owners } from "./access";
import { findOrCreateCompany } from "./companies";
import { findContact } from "./contacts";
import { addEvent, rescore } from "./timeline";
import { formTouch } from "../marketing/core";

type Person = { name?: string; email?: string; phone?: string; company?: string; title?: string };
type Kind = "forms" | "orders" | "bookings" | "horeca" | "invoicing" | "web";

async function crmOrg(projectId: string) {
  const [row] = await db
    .select({ orgId: schema.projects.orgId, modules: schema.organizations.modules, project: schema.projects.name })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(eq(schema.projects.id, projectId));
  return row && isOn(row.modules, "crm") ? row : null;
}

const rank = (l: string) => (LIFECYCLE as readonly string[]).indexOf(l);

/**
 * Finds the person by email or phone and updates them, or adds them. Blank
 * details are filled in, never overwritten; the lifecycle only moves forward.
 */
export async function capture(orgId: string, kind: Kind, p: Person, opts: { source: string; lifecycle?: Lifecycle; event?: { subject: string; body?: string }; at?: Date; notify?: boolean; marketing?: boolean }) {
  const st = await getSettings(orgId);
  if (kind !== "web" && !st.settings.capture[kind]) return null;
  const email = emailKey(p.email ?? "");
  const phone = (p.phone ?? "").trim().slice(0, 30);
  if (!email && !phoneKey(phone)) return null;
  const name = (p.name ?? "").trim().slice(0, 120);
  const existing = await findContact(orgId, { email, phone });
  let id: string;
  let created = false;
  if (existing) {
    const patch: Partial<typeof schema.crmContacts.$inferInsert> = {};
    if (!existing.name && name) patch.name = name;
    if (!existing.email && email) patch.email = email;
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.title && p.title) patch.title = p.title.slice(0, 120);
    if (!existing.companyId && (p.company || emailDomain(email))) patch.companyId = await findOrCreateCompany(orgId, { name: p.company, domain: emailDomain(email), create: !!p.company });
    if (opts.lifecycle && rank(opts.lifecycle) > rank(existing.lifecycle)) patch.lifecycle = opts.lifecycle;
    // Signing up to news is consent to marketing email; nothing here ever withdraws it.
    if (opts.marketing) patch.marketing = true;
    const at = opts.at ?? new Date();
    await db.update(schema.crmContacts).set({ ...patch, lastActivityAt: sql`greatest(coalesce(${schema.crmContacts.lastActivityAt}, ${at}), ${at})`, updatedAt: new Date() }).where(eq(schema.crmContacts.id, existing.id));
    id = existing.id;
  } else {
    const ownerId = await nextOwner(orgId);
    const companyId = await findOrCreateCompany(orgId, { name: p.company, domain: emailDomain(email), ownerId, create: !!p.company });
    const v = contactSchema.safeParse({ name, email, phone, title: p.title ?? "", lifecycle: opts.lifecycle ?? "lead", source: opts.source });
    if (!v.success) return null;
    const { companyName: _, ...values } = v.data;
    void _;
    const [c] = await db
      .insert(schema.crmContacts)
      .values({ orgId, ...values, companyId, ownerId, ...(opts.marketing ? { marketing: true } : {}), lastActivityAt: opts.at ?? new Date(), createdAt: opts.at ?? new Date() })
      .onConflictDoNothing()
      .returning({ id: schema.crmContacts.id });
    if (!c) return null;
    id = c.id;
    created = true;
    await addEvent(orgId, { subject: `New contact from ${SOURCE_LABEL[opts.source] ?? opts.source}`, contactId: id });
    if (opts.notify && st.settings.notify) await notifyOwner(orgId, id, ownerId, name || email || phone, opts.event?.body ?? "").catch((e) => log.warn("crm_notify_failed", { error: (e as Error).message }));
  }
  if (opts.event) await addEvent(orgId, { subject: opts.event.subject, body: opts.event.body, contactId: id, meta: { source: opts.source } });
  await rescore(orgId, [id]);
  return { id, created };
}

async function notifyOwner(orgId: string, contactId: string, ownerId: string | null, who: string, message: string) {
  const people = await owners(orgId);
  const to = people.find((p) => p.id === ownerId) ?? people.find((p) => p.role === "owner");
  if (!to) return;
  await sendMail({ to: to.email, subject: `New lead: ${who}`, body: `${who} just got in touch.${message ? `\n\n“${message.slice(0, 600)}”` : ""}\n\nOpen in the CRM: ${appUrl(`/crm/contacts/${contactId}`)}` });
}

/** Called for every project event (see events/bus). */
export async function captureFromEvent(projectId: string, type: EventType, data: Record<string, unknown>) {
  if (!["form.submitted", "order.placed", "order.paid", "booking.confirmed"].includes(type)) return;
  const org = await crmOrg(projectId);
  if (!org) return;
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  if (type === "form.submitted") {
    const f = personFromForm((data.data ?? {}) as Record<string, unknown>);
    // Newsletter sign-ups become subscribers who agreed to marketing email, so Marketing can reach them.
    if (data.formId === "newsletter") {
      await capture(org.orgId, "forms", f, { source: "newsletter", lifecycle: "subscriber", marketing: true, event: { subject: `Signed up for news on ${org.project}` } });
      return;
    }
    const formName = str(data.formName) || "a form";
    await capture(org.orgId, "forms", f, { source: "web_form", event: { subject: `Filled in ${formName} on ${org.project}`, body: f.message }, notify: true });
    return;
  }
  if (type === "order.placed" || type === "order.paid") {
    let phone = "";
    if (typeof data.id === "string") {
      const [o] = await db.select({ phone: schema.storeOrders.phone }).from(schema.storeOrders).where(eq(schema.storeOrders.id, data.id));
      phone = o?.phone ?? "";
    }
    const pos = data.channel === "pos";
    const paid = type === "order.paid";
    // A placed order that's then paid shouldn't log twice.
    if (paid && !pos) {
      await capture(org.orgId, "orders", { name: str(data.customerName), email: str(data.email), phone }, { source: "store", lifecycle: "customer", event: { subject: `Paid order ${str(data.label)}`, body: `${str(data.total)} ${str(data.currency)}` } });
      return;
    }
    await capture(org.orgId, "orders", { name: str(data.customerName), email: str(data.email), phone }, { source: pos ? "pos" : "store", lifecycle: paid ? "customer" : "opportunity", event: { subject: `${pos ? "Bought at the counter" : "Placed order"} ${str(data.label)}`, body: `${str(data.total)} ${str(data.currency)} · ${org.project}` } });
    return;
  }
  if (type === "booking.confirmed") {
    await capture(org.orgId, "bookings", { name: str(data.name), email: str(data.email), phone: str(data.phone) }, { source: "booking", lifecycle: "customer", event: { subject: `Booked ${str(data.service)}`, body: `${new Date(str(data.startsAt)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} · ${org.project}` } });
  }
}

/** A restaurant or hotel guest whose phone was taken at the till. */
export async function captureGuest(projectId: string, g: { name: string; phone: string; email?: string }) {
  const org = await crmOrg(projectId);
  if (!org) return;
  await capture(org.orgId, "horeca", g, { source: "horeca", lifecycle: "customer", event: { subject: `Visited ${org.project}` } });
}

/** A client added in invoicing (a project's or a finance book's). */
export async function captureInvoiceClient(ownerId: string, c: { name: string; company: string; email: string; phone: string }) {
  const [owner] = await db.select().from(schema.invoiceOwners).where(eq(schema.invoiceOwners.id, ownerId));
  let orgId: string | null = null;
  if (owner?.projectId) orgId = (await crmOrg(owner.projectId))?.orgId ?? null;
  else if (owner?.bookId) {
    const [b] = await db.select({ orgId: schema.financeBooks.orgId, modules: schema.organizations.modules }).from(schema.financeBooks).innerJoin(schema.organizations, eq(schema.organizations.id, schema.financeBooks.orgId)).where(eq(schema.financeBooks.id, owner.bookId));
    orgId = b && isOn(b.modules, "crm") ? b.orgId : null;
  }
  if (!orgId) return;
  await capture(orgId, "invoicing", { name: c.name, email: c.email, phone: c.phone, company: c.company }, { source: "invoicing", lifecycle: "customer", event: { subject: "Added as an invoicing client" } });
}

/** Runs capture without ever throwing into the caller. */
export function safely(p: Promise<unknown>) {
  return p.catch((e) => log.warn("crm_capture_failed", { error: (e as Error).message }));
}

/**
 * Brings in everyone already in the workspace: store customers and order
 * emails, bookings, restaurant guests, invoicing clients and form entries.
 */
export async function syncAll(orgId: string) {
  const counts = { created: 0, updated: 0, sources: {} as Record<string, number> };
  const projects = await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.orgId, orgId));
  const pIds = projects.map((p) => p.id);
  const run = async (kind: Kind, source: string, people: (Person & { at?: Date; lifecycle?: Lifecycle })[]) => {
    for (const p of people) {
      const r = await capture(orgId, kind, p, { source, lifecycle: p.lifecycle, at: p.at });
      if (!r) continue;
      if (r.created) counts.created++;
      else counts.updated++;
      counts.sources[source] = (counts.sources[source] ?? 0) + 1;
    }
  };
  if (pIds.length) {
    const orders = await db
      .select({ email: schema.storeOrders.email, phone: schema.storeOrders.phone, addr: schema.storeOrders.shippingAddress, paidAt: schema.storeOrders.paidAt, createdAt: schema.storeOrders.createdAt })
      .from(schema.storeOrders)
      .where(inArray(schema.storeOrders.projectId, pIds))
      .orderBy(desc(schema.storeOrders.createdAt))
      .limit(5000);
    await run("orders", "store", orders.map((o) => ({ name: (o.addr as { name?: string })?.name ?? "", email: o.email, phone: o.phone, at: o.createdAt, lifecycle: o.paidAt ? "customer" : "opportunity" })));
    const customers = await db.select().from(schema.storeCustomers).where(inArray(schema.storeCustomers.projectId, pIds)).limit(5000);
    await run("orders", "store", customers.map((c) => ({ name: c.name, email: c.email, phone: c.phone, at: c.createdAt })));
    const bookings = await db.select().from(schema.bookings).where(and(inArray(schema.bookings.projectId, pIds), sql`${schema.bookings.status} in ('confirmed', 'completed')`)).orderBy(desc(schema.bookings.createdAt)).limit(5000);
    await run("bookings", "booking", bookings.map((b) => ({ name: b.name, email: b.email, phone: b.phone, at: b.createdAt, lifecycle: "customer" as const })));
    const guests = await db.select().from(schema.horecaGuests).where(inArray(schema.horecaGuests.projectId, pIds)).limit(5000);
    await run("horeca", "horeca", guests.map((g) => ({ name: g.name, email: g.email, phone: g.phone, at: g.createdAt, lifecycle: g.visits > 0 ? ("customer" as const) : undefined })));
    const forms = await db.select().from(schema.formSubmissions).where(inArray(schema.formSubmissions.projectId, pIds)).orderBy(desc(schema.formSubmissions.createdAt)).limit(5000);
    await run("forms", "web_form", forms.map((f) => ({ ...personFromForm((f.data ?? {}) as Record<string, unknown>), at: f.createdAt })));
  }
  const books = await db.select({ id: schema.financeBooks.id }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId));
  const ownerIds = [...pIds, ...books.map((b) => b.id)];
  if (ownerIds.length) {
    const clients = await db.select().from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, ownerIds), sql`${schema.invoiceClients.archivedAt} is null`)).limit(5000);
    await run("invoicing", "invoicing", clients.map((c) => ({ name: c.name, email: c.email, phone: c.phone, company: c.company, at: c.createdAt, lifecycle: "customer" as const })));
  }
  return counts;
}

/** The public web-to-lead endpoint: a form anywhere posts here. */
export async function webLead(token: string, raw: Record<string, unknown>) {
  const [row] = await db.select({ orgId: schema.crmSettings.orgId, modules: schema.organizations.modules }).from(schema.crmSettings).innerJoin(schema.organizations, eq(schema.organizations.id, schema.crmSettings.orgId)).where(eq(schema.crmSettings.captureToken, token));
  if (!row || !isOn(row.modules, "crm")) throw new ApiError("not_found", "This form link isn't active");
  if (typeof raw.website === "string" && raw.website) return { ok: true }; // honeypot
  const p = personFromForm(raw);
  if (!p.email && !phoneKey(p.phone)) throw new ApiError("validation_failed", "Add an email or phone number", { email: ["Required"] });
  const source = typeof raw.source === "string" && /^[a-z_]{2,40}$/.test(raw.source) ? raw.source : "web_to_lead";
  const r = await capture(row.orgId, "web", p, { source, event: { subject: "Sent the lead form", body: p.message }, notify: true });
  // A form that came from a tagged link credits that marketing campaign.
  if (r && typeof raw.utm_campaign === "string") await formTouch(row.orgId, r.id, raw.utm_campaign.slice(0, 60)).catch(() => {});
  return { ok: !!r };
}
