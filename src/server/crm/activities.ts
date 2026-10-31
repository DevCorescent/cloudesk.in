// The timeline and tasks: notes, calls, meetings, logged and sent email, and
// to-dos with due dates — plus "my day" (overdue, today, upcoming).
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { safeEqual } from "../security/tokens";
import { appUrl, mailProvider, sendMail } from "../services/mail";
import { rateLimit } from "../security/rate-limit";
import { activitySchema, renderTemplate } from "@/lib/crm/model";
import { check, owners, requireMember, requireWrite, visible, type Scope } from "./access";
import { addEvent, rescore, touch } from "./timeline";

const A = schema.crmActivities;

async function checkTargets(s: Scope, t: { contactId: string | null; companyId: string | null; dealId: string | null }) {
  if (!t.contactId && !t.companyId && !t.dealId) throw new ApiError("validation_failed", "Attach it to a contact, company or deal");
  if (t.contactId) {
    const [c] = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts).where(and(eq(schema.crmContacts.id, t.contactId), eq(schema.crmContacts.orgId, s.orgId), visible(s, schema.crmContacts.ownerId)));
    if (!c) throw notFound("Contact");
  }
  if (t.companyId) {
    const [c] = await db.select({ id: schema.crmCompanies.id }).from(schema.crmCompanies).where(and(eq(schema.crmCompanies.id, t.companyId), eq(schema.crmCompanies.orgId, s.orgId)));
    if (!c) throw notFound("Company");
  }
  if (t.dealId) {
    const [d] = await db.select({ id: schema.crmDeals.id, contactId: schema.crmDeals.contactId }).from(schema.crmDeals).where(and(eq(schema.crmDeals.id, t.dealId), eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId)));
    if (!d) throw notFound("Deal");
    // Something logged on a deal shows on its person's timeline too.
    if (!t.contactId && d.contactId) t.contactId = d.contactId;
  }
}

export async function createActivity(s: Scope, raw: unknown) {
  requireWrite(s);
  const input = check(activitySchema, raw);
  await checkTargets(s, input);
  if (input.ownerId && input.ownerId !== s.userId) await requireMember(s.orgId, input.ownerId);
  if (input.kind === "task" && !input.subject) throw new ApiError("validation_failed", "What needs doing?", { subject: ["Required"] });
  // A call can be just its outcome ("No answer").
  if (input.kind === "call" && !input.subject && !input.body && input.outcome) input.subject = `Call — ${input.outcome.replace(/_/g, " ")}`;
  if (input.kind !== "task" && !input.subject && !input.body) throw new ApiError("validation_failed", "Write something first", { body: ["Required"] });
  const isTask = input.kind === "task";
  const scheduled = input.kind === "meeting" && input.dueAt && new Date(input.dueAt) > new Date() && !input.done;
  const [a] = await db
    .insert(A)
    .values({
      orgId: s.orgId,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      contactId: input.contactId,
      companyId: input.companyId,
      dealId: input.dealId,
      ownerId: input.ownerId ?? (s.userId || null),
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      doneAt: (isTask || scheduled) && !input.done ? null : new Date(),
      outcome: input.outcome,
      durationMin: input.durationMin,
      priority: input.priority,
      createdBy: s.userId || null,
    })
    .returning();
  if (!isTask) await touch([a.contactId]);
  if (a.contactId) {
    // Talking to a new lead moves them on.
    if (["call", "email", "meeting"].includes(a.kind)) await db.update(schema.crmContacts).set({ leadStatus: "contacted" }).where(and(eq(schema.crmContacts.id, a.contactId), eq(schema.crmContacts.leadStatus, "new")));
    await rescore(s.orgId, [a.contactId]);
  }
  return a;
}

async function requireActivity(s: Scope, id: string) {
  const [a] = await db.select().from(A).where(and(eq(A.id, id), eq(A.orgId, s.orgId)));
  if (!a || a.kind === "event") throw notFound("Activity");
  if (s.own && a.ownerId && a.ownerId !== s.userId && a.createdBy !== s.userId) throw notFound("Activity");
  return a;
}

export async function updateActivity(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const cur = await requireActivity(s, id);
  const patch = (raw ?? {}) as Record<string, unknown>;
  const input = check(activitySchema, { ...cur, dueAt: cur.dueAt?.toISOString() ?? null, done: !!cur.doneAt, ...patch });
  if (input.ownerId && input.ownerId !== cur.ownerId) await requireMember(s.orgId, input.ownerId);
  const [a] = await db
    .update(A)
    .set({ subject: input.subject, body: input.body, ownerId: input.ownerId, dueAt: input.dueAt ? new Date(input.dueAt) : null, doneAt: input.done ? (cur.doneAt ?? new Date()) : null, outcome: input.outcome, durationMin: input.durationMin, priority: input.priority })
    .where(eq(A.id, id))
    .returning();
  if (input.done && !cur.doneAt) {
    await touch([a.contactId]);
    if (a.contactId) await rescore(s.orgId, [a.contactId]);
  }
  return a;
}

export async function deleteActivity(s: Scope, id: string) {
  requireWrite(s);
  const a = await requireActivity(s, id);
  if (!s.manage && a.createdBy !== s.userId) throw new ApiError("forbidden", "Only the person who wrote it or an admin can delete this");
  await db.delete(A).where(eq(A.id, id));
}

/** Open tasks for one person (or everyone, for managers): overdue, today, upcoming; and recently done. */
export async function tasks(s: Scope, opts: { who?: string; range?: string }) {
  const who = opts.who === "all" && s.manage ? null : opts.who && /^[0-9a-f-]{36}$/.test(opts.who) && (s.manage || opts.who === s.userId) ? opts.who : s.userId;
  const base = and(eq(A.orgId, s.orgId), eq(A.kind, "task"), who ? eq(A.ownerId, who) : undefined);
  const select = {
    a: A,
    contact: schema.crmContacts.name,
    contactEmail: schema.crmContacts.email,
    deal: schema.crmDeals.title,
    company: schema.crmCompanies.name,
  };
  const q = (where: ReturnType<typeof and>, order: ReturnType<typeof asc>, limit: number) =>
    db
      .select(select)
      .from(A)
      .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, A.contactId))
      .leftJoin(schema.crmDeals, eq(schema.crmDeals.id, A.dealId))
      .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, A.companyId))
      .where(where)
      .orderBy(order)
      .limit(limit);
  const [open, done] = await Promise.all([q(and(base, isNull(A.doneAt)), asc(sql`coalesce(${A.dueAt}, 'infinity')`), 500), q(and(base, isNotNull(A.doneAt)), desc(A.doneAt), 30)]);
  const shape = (r: (typeof open)[number]) => ({ ...r.a, contact: r.contact || r.contactEmail || "", deal: r.deal ?? "", company: r.company ?? "" });
  return { open: open.map(shape), done: done.map(shape) };
}

/** Meetings coming up (scheduled, not yet held). */
export async function upcomingMeetings(s: Scope) {
  return db
    .select({ a: A, contact: schema.crmContacts.name })
    .from(A)
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, A.contactId))
    .where(and(eq(A.orgId, s.orgId), eq(A.kind, "meeting"), isNull(A.doneAt), sql`${A.dueAt} > now() - interval '1 hour'`, s.own ? eq(A.ownerId, s.userId) : undefined))
    .orderBy(asc(A.dueAt))
    .limit(20)
    .then((r) => r.map((x) => ({ ...x.a, contact: x.contact ?? "" })));
}

// ─── Email ───

function unsubKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("crm-unsubscribe-v1").digest();
}
export function unsubscribeToken(contactId: string) {
  return `${contactId}.${createHmac("sha256", unsubKey()).update(contactId).digest("base64url").slice(0, 24)}`;
}
export function readUnsubscribeToken(token: string) {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return safeEqual(sig, createHmac("sha256", unsubKey()).update(id).digest("base64url").slice(0, 24)) ? id : null;
}

/** Sends an email to a contact through the workspace's mail setup, and logs it. */
export async function emailContact(s: Scope, contactId: string, input: { subject: string; body: string; dealId?: string | null; sequence?: string }) {
  if (s.userId) requireWrite(s);
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 10000);
  if (!subject || !body) throw new ApiError("validation_failed", "Add a subject and a message");
  const [c] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.orgId, s.orgId), visible(s, schema.crmContacts.ownerId)));
  if (!c) throw notFound("Contact");
  if (!c.email) throw new ApiError("validation_failed", "This contact has no email address");
  if (input.dealId) {
    // Only a deal in this workspace that the sender can see.
    if (!z.uuid().safeParse(input.dealId).success) throw notFound("Deal");
    const [d] = await db.select({ id: schema.crmDeals.id }).from(schema.crmDeals).where(and(eq(schema.crmDeals.id, input.dealId), eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId)));
    if (!d) throw notFound("Deal");
  }
  if (c.doNotContact) throw new ApiError("conflict", `${c.name || c.email} asked not to be contacted`);
  if (s.userId) await rateLimit(`crm-mail:${s.userId}`, 200, 3600_000);
  const people = await owners(s.orgId);
  const sender = people.find((p) => p.id === (s.userId || c.ownerId));
  const [company] = c.companyId ? await db.select({ name: schema.crmCompanies.name }).from(schema.crmCompanies).where(eq(schema.crmCompanies.id, c.companyId)) : [];
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const vars = { name: c.name, email: c.email, company: company?.name ?? "", title: c.title, ownerName: sender?.name ?? org?.name ?? "" };
  const subj = renderTemplate(subject, vars);
  const text = renderTemplate(body, vars);
  const footer = `\n\n—\n${org?.name ?? ""}\nDon't want emails from us? ${appUrl(`/u/${unsubscribeToken(c.id)}`)}`;
  await sendMail({ to: c.email, subject: subj, body: text + footer, fromName: sender?.name ? `${sender.name} · ${org?.name ?? ""}` : org?.name, replyTo: sender?.email });
  const [a] = await db
    .insert(A)
    .values({ orgId: s.orgId, kind: "email", subject: subj, body: text, contactId: c.id, dealId: input.dealId ?? null, ownerId: s.userId || c.ownerId, doneAt: new Date(), createdBy: s.userId || null, meta: { sent: true, transport: mailProvider(), to: c.email, ...(input.sequence ? { sequence: input.sequence } : {}) } })
    .returning();
  await db.update(schema.crmContacts).set({ lastActivityAt: new Date(), leadStatus: c.leadStatus === "new" ? "contacted" : c.leadStatus }).where(eq(schema.crmContacts.id, c.id));
  await rescore(s.orgId, [c.id]);
  return { activity: a, delivered: mailProvider() !== "outbox" };
}

/** A contact clicked the link in an email: no more email from the CRM. */
export async function unsubscribe(token: string) {
  const id = readUnsubscribeToken(token);
  if (!id) return null;
  const [c] = await db.update(schema.crmContacts).set({ doNotContact: true, marketing: false, updatedAt: new Date() }).where(eq(schema.crmContacts.id, id)).returning();
  if (!c) return null;
  await db.update(schema.crmEnrollments).set({ status: "stopped", stopReason: "Unsubscribed", nextAt: null }).where(and(eq(schema.crmEnrollments.contactId, id), eq(schema.crmEnrollments.status, "active")));
  await addEvent(c.orgId, { subject: "Unsubscribed from email", contactId: id });
  return c;
}

export async function activityCounts(orgId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select({ contactId: A.contactId, n: sql<number>`count(*)::int` }).from(A).where(and(inArray(A.contactId, ids), sql`${A.kind} <> 'event'`)).groupBy(A.contactId);
}
