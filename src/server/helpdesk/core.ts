// Helpdesk: tickets come in (email, the customer portal, the phone, the team),
// are numbered, given response targets in business hours and — when the desk
// works in turns — an agent. Replies go to the customer by email with a signed
// link to the ticket; internal notes stay inside. Status changes stop and
// restart the resolve clock; a sweep every few minutes marks missed targets
// and closes resolved tickets nobody came back to.
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addBusinessMinutes, businessMinutesBetween, cannedSchema, DONE, durationText, fillCanned, PAUSED, replySchema, stats, STATUS_LABEL, STOPPED, stripQuoted, ticketRef, ticketSchema, transition, updateSchema, type HdSettings, type Priority, type Status } from "@/lib/helpdesk/model";
import { isOn } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { notify } from "../notify/notify";
import { rateLimit } from "../security/rate-limit";
import { safeEqual } from "../security/tokens";
import { appUrl, sendMail } from "../services/mail";
import { agents, check, getSettings, getTicket, isAgent, nextCounter, requireManage, requireWrite, settingsRow, type Scope } from "./access";
import { emit } from "../hub/core";

type Ticket = typeof schema.hdTickets.$inferSelect;
const T = schema.hdTickets;
const M = schema.hdMessages;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

// ── The customer's link ─────────────────────────────────────────────────────

function linkKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("helpdesk-ticket-link-v1").digest();
}
const sign = (orgId: string, id: string) => createHmac("sha256", linkKey()).update(`${orgId}:${id}`).digest("base64url").slice(0, 32);

/** A link that opens one ticket for its customer — nothing else. It works as long as the ticket exists. */
export const ticketToken = (t: Pick<Ticket, "id" | "orgId">) => `${t.id}.${sign(t.orgId, t.id)}`;
export const ticketLink = (t: Pick<Ticket, "id" | "orgId">) => appUrl(`/support/${ticketToken(t)}`);

async function fromToken(token: string) {
  const [id, sig] = token.split(".");
  if (!id || !sig || !isId(id)) throw notFound("Ticket");
  const [t] = await db.select().from(T).where(eq(T.id, id));
  if (!t || !safeEqual(sig, sign(t.orgId, t.id))) throw notFound("Ticket");
  return t;
}

// ── Coming in ───────────────────────────────────────────────────────────────

type Intake = { subject: string; body: string; name: string; email: string; phone?: string; channel: string; emailId?: string | null; createdBy?: string | null; assigneeId?: string | null; priority?: Priority; tags?: string[]; contactId?: string | null };

async function orgName(orgId: string) {
  const [o] = await db.select({ name: schema.organizations.name, modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return o;
}

/** The CRM contact with this email, when the workspace has the CRM. */
async function contactFor(orgId: string, email: string) {
  if (!email) return null;
  const o = await orgName(orgId);
  if (!isOn(o?.modules, "crm")) return null;
  const [c] = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), sql`lower(${schema.crmContacts.email}) = ${email.toLowerCase()}`));
  return c?.id ?? null;
}

/** The next agent in turn, when the desk assigns round robin. */
async function nextInTurn(orgId: string, s: HdSettings) {
  if (s.assignment !== "round_robin") return null;
  const team = await agents(orgId);
  const pool = s.agents.length ? team.filter((a) => s.agents.includes(a.id)) : team;
  if (!pool.length) return null;
  const n = await nextCounter(orgId, "rr");
  return pool[n % pool.length].id;
}

async function event(t: Pick<Ticket, "id" | "orgId">, body: string, authorId: string | null = null) {
  await db.insert(M).values({ orgId: t.orgId, ticketId: t.id, kind: "event", body, authorId });
}

/** Open a ticket (from any channel): numbered, targets set, assigned, the customer told. */
export async function intake(orgId: string, x: Intake, opts: { acknowledge: boolean }) {
  const s = await getSettings(orgId);
  const number = `${s.prefix}${String(await nextCounter(orgId, "ticket")).padStart(4, "0")}`;
  const now = new Date();
  const priority = x.priority ?? "normal";
  const target = s.sla[priority];
  const assigneeId = x.assigneeId ?? (await nextInTurn(orgId, s));
  const email = x.email.trim().toLowerCase();
  const [t] = await db
    .insert(T)
    .values({ orgId, number, subject: x.subject.slice(0, 200), status: assigneeId ? "open" : "new", priority, channel: x.channel, customerName: x.name.slice(0, 120), customerEmail: email, customerPhone: x.phone ?? "", contactId: x.contactId ?? (await contactFor(orgId, email)), assigneeId, tags: x.tags ?? [], firstResponseDue: addBusinessMinutes(now, target.first, s.hours, s.holidays), resolveDue: addBusinessMinutes(now, target.resolve, s.hours, s.holidays), lastCustomerAt: now, createdBy: x.createdBy ?? null })
    .returning();
  if (x.body.trim()) await db.insert(M).values({ orgId, ticketId: t.id, kind: "customer", body: x.body.slice(0, 20_000), fromName: x.name, fromEmail: email, emailId: x.emailId ?? null });
  if (opts.acknowledge && email) {
    const o = await orgName(orgId);
    await sendMail({ to: email, subject: `[${number}] ${t.subject}`, fromName: o?.name, replyTo: s.replyTo || undefined, body: `Hi ${x.name || "there"},\n\nThanks for getting in touch — we've received your request and will reply soon. Your reference is ${number}.\n\nSee it or add to it here: ${ticketLink(t)}\n\nYou can also reply to this email.${s.signature ? `\n\n${s.signature}` : ""}` }).catch((e) => log.warn("helpdesk.ack_failed", { err: String(e) }));
  }
  if (assigneeId && assigneeId !== x.createdBy) await notifyAssigned(t, assigneeId, x.createdBy ?? null);
  await emit(orgId, "helpdesk.ticket.created", { id: t.id, number: t.number, subject: t.subject, channel: t.channel, priority: t.priority, customerEmail: t.customerEmail });
  return t;
}

async function notifyAssigned(t: Ticket, to: string, by: string | null) {
  const [u] = by ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, by)) : [];
  await notify(t.orgId, [to], { kind: "helpdesk.assigned", title: `${t.number} is yours: ${t.subject}`, link: `/helpdesk/tickets/${t.id}`, values: { ticket: t.number, subject: t.subject, by: u?.name ?? "Round robin" } }).catch(() => {});
}

/** A ticket the team logs (a call, a walk-in, something seen elsewhere). */
export async function createTicket(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(ticketSchema.extend({ acknowledge: z.boolean().default(true) }), raw);
  if (v.assigneeId && !(await isAgent(s.orgId, v.assigneeId))) throw new ApiError("validation_failed", "That person can't work tickets", { assigneeId: ["Not an agent"] });
  if (v.contactId) {
    const [c] = await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, phone: schema.crmContacts.phone }).from(schema.crmContacts).where(and(eq(schema.crmContacts.id, v.contactId), eq(schema.crmContacts.orgId, s.orgId)));
    if (!c) throw new ApiError("validation_failed", "That contact isn't in this workspace", { contactId: ["Unknown contact"] });
    v.customerName ||= c.name;
    v.customerEmail ||= c.email;
    v.customerPhone ||= c.phone;
  }
  if (!v.customerEmail && !v.customerPhone && !v.customerName) throw new ApiError("validation_failed", "Who is it from? Add a name, email or phone", { customerName: ["Required"] });
  const t = await intake(s.orgId, { subject: v.subject, body: v.body, name: v.customerName, email: v.customerEmail, phone: v.customerPhone, channel: v.channel, createdBy: s.userId, assigneeId: v.assigneeId, priority: v.priority, tags: v.tags, contactId: v.contactId }, { acknowledge: v.acknowledge && v.channel !== "email" });
  await event(t, `Logged by the team (${v.channel})`, s.userId);
  return t;
}

/** Something the customer said on an existing ticket: reopens it if it was waiting or resolved, and tells the agent. */
async function fromCustomer(t: Ticket, x: { body: string; name: string; email: string; emailId?: string | null }) {
  const now = new Date();
  await db.insert(M).values({ orgId: t.orgId, ticketId: t.id, kind: "customer", body: x.body.slice(0, 20_000), fromName: x.name, fromEmail: x.email, emailId: x.emailId ?? null });
  const s = await getSettings(t.orgId);
  const patch = t.status === "pending" || t.status === "on_hold" || t.status === "resolved" ? transition(t as never, "open", now, s) : {};
  await db.update(T).set({ ...patch, lastCustomerAt: now, updatedAt: now }).where(eq(T.id, t.id));
  if (patch.status) await event(t, `Reopened by the customer's reply (was ${STATUS_LABEL[t.status as Status]})`);
  if (t.assigneeId) await notify(t.orgId, [t.assigneeId], { kind: "helpdesk.replied", title: `${x.name || x.email || "The customer"} replied on ${t.number}`, body: x.body.slice(0, 200), link: `/helpdesk/tickets/${t.id}`, values: { ticket: t.number, subject: t.subject, customer: x.name || x.email } }).catch(() => {});
}

// ── Inbound email ───────────────────────────────────────────────────────────

const generic = z.object({ from: z.string().max(320), fromName: z.string().max(200).default(""), subject: z.string().max(1000).default(""), text: z.string().max(200_000).default(""), messageId: z.string().max(500).nullable().default(null) });
const postmark = z.object({ From: z.string().max(320), FromName: z.string().max(200).default(""), Subject: z.string().max(1000).default(""), TextBody: z.string().max(200_000).default(""), StrippedTextReply: z.string().max(200_000).default(""), MessageID: z.string().max(500).nullable().default(null) });
const addr = (v: string) => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase();

/** An email sent to the workspace's inbound address (Postmark's inbound JSON, or {from, fromName, subject, text, messageId}). */
export async function inbound(token: string, raw: unknown) {
  if (!token || token.length < 16) throw notFound("Inbox");
  const [row] = await db.select().from(schema.hdSettings).where(eq(schema.hdSettings.inboundToken, token));
  if (!row || !safeEqual(row.inboundToken, token)) throw notFound("Inbox");
  await rateLimit(`hd-inbound:${row.orgId}`, 600, 3_600_000);
  const o = await orgName(row.orgId);
  if (!isOn(o?.modules, "helpdesk")) throw new ApiError("forbidden", "The Helpdesk is switched off");
  const pm = postmark.safeParse(raw);
  const g = pm.success ? { from: pm.data.From, fromName: pm.data.FromName, subject: pm.data.Subject, text: pm.data.StrippedTextReply || pm.data.TextBody, messageId: pm.data.MessageID } : check(generic, raw);
  const email = addr(g.from);
  if (!z.email().safeParse(email).success) throw new ApiError("validation_failed", "The sender's address isn't valid");
  // Don't answer automatic mail (out-of-office, bounces) with more automatic mail.
  if (/^(mailer-daemon|postmaster|no-?reply)@/i.test(email)) return { ok: true, ignored: "automatic sender" };
  if (g.messageId) {
    const [dup] = await db.select({ ticketId: M.ticketId }).from(M).where(and(eq(M.orgId, row.orgId), eq(M.emailId, g.messageId)));
    if (dup) return { ok: true, ticketId: dup.ticketId, duplicate: true };
  }
  const s = settingsOf(row.settings);
  const ref = ticketRef(g.subject, s.prefix);
  const body = stripQuoted(g.text) || g.text.trim() || "(no text)";
  const name = g.fromName.replace(/^"|"$/g, "").trim();
  if (ref) {
    const [t] = await db.select().from(T).where(and(eq(T.orgId, row.orgId), eq(T.number, ref)));
    // Only the ticket's customer can add to it by email; anyone else starts their own.
    if (t && t.customerEmail.toLowerCase() === email && t.status !== "closed") {
      await fromCustomer(t, { body, name: name || t.customerName, email, emailId: g.messageId });
      return { ok: true, ticketId: t.id, created: false };
    }
  }
  const subject = g.subject.replace(/\[[^\]]*\]\s*/g, "").replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, "").trim() || "(no subject)";
  const t = await intake(row.orgId, { subject, body, name, email, channel: "email", emailId: g.messageId }, { acknowledge: true });
  return { ok: true, ticketId: t.id, created: true };
}

const settingsOf = (raw: unknown) => {
  const r = (raw ?? {}) as object;
  return { prefix: "HD-", ...r } as HdSettings;
};

// ── Working tickets ─────────────────────────────────────────────────────────

const VIEWS = ["mine", "unassigned", "open", "waiting", "breached", "done", "all"] as const;

export async function list(s: Scope, q: { view?: string; q?: string; priority?: string; contactId?: string; email?: string } = {}) {
  const view = (VIEWS as readonly string[]).includes(q.view ?? "") ? q.view! : "open";
  const where: SQL[] = [eq(T.orgId, s.orgId)];
  const active = notInArray(T.status, [...DONE]);
  if (view === "mine") where.push(eq(T.assigneeId, s.userId), active);
  if (view === "unassigned") where.push(isNull(T.assigneeId), active);
  if (view === "open") where.push(active);
  if (view === "waiting") where.push(inArray(T.status, [...PAUSED]));
  if (view === "breached") where.push(active, or(eq(T.firstBreached, true), eq(T.resolveBreached, true))!);
  if (view === "done") where.push(inArray(T.status, [...DONE]));
  if (q.priority) where.push(eq(T.priority, q.priority));
  // A customer's tickets: by their CRM contact or by their email.
  const who = [q.contactId && isId(q.contactId) ? eq(T.contactId, q.contactId) : null, q.email ? sql`lower(${T.customerEmail}) = ${q.email.toLowerCase()}` : null].filter((x): x is SQL => !!x);
  if (who.length) where.push(or(...who)!);
  if (q.q?.trim()) {
    const t = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(T.number, t), ilike(T.subject, t), ilike(T.customerName, t), ilike(T.customerEmail, t))!);
  }
  const due = sql`coalesce(case when ${T.firstRespondedAt} is null then ${T.firstResponseDue} end, case when ${T.pausedAt} is null then ${T.resolveDue} end)`;
  const rows = await db
    .select({ t: T, assignee: schema.users.name })
    .from(T)
    .leftJoin(schema.users, eq(schema.users.id, T.assigneeId))
    .where(and(...where))
    .orderBy(view === "done" || view === "all" ? desc(T.updatedAt) : sql`${due} asc nulls last`)
    .limit(300);
  return rows.map(({ t, assignee }) => ({ ...summary(t), assignee }));
}

function summary(t: Ticket) {
  const now = Date.now();
  const nextDue = !t.firstRespondedAt ? t.firstResponseDue : STOPPED.includes(t.status as Status) ? null : t.resolveDue;
  return { id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, channel: t.channel, customerName: t.customerName, customerEmail: t.customerEmail, assigneeId: t.assigneeId, tags: t.tags, createdAt: t.createdAt, updatedAt: t.updatedAt, nextDue, dueKind: !t.firstRespondedAt ? "first" : "resolve", overdue: !!nextDue && nextDue.getTime() < now, breached: t.firstBreached || t.resolveBreached, csat: t.csat };
}

export async function counts(s: Scope) {
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${T.status} not in ('resolved','closed'))::int`,
      mine: sql<number>`count(*) filter (where ${T.status} not in ('resolved','closed') and ${T.assigneeId} = ${s.userId})::int`,
      unassigned: sql<number>`count(*) filter (where ${T.status} not in ('resolved','closed') and ${T.assigneeId} is null)::int`,
      waiting: sql<number>`count(*) filter (where ${T.status} in ('pending','on_hold'))::int`,
      breached: sql<number>`count(*) filter (where ${T.status} not in ('resolved','closed') and (${T.firstBreached} or ${T.resolveBreached}))::int`,
    })
    .from(T)
    .where(eq(T.orgId, s.orgId));
  return r;
}

export async function detail(s: Scope, id: string) {
  const t = await getTicket(s.orgId, id);
  const msgs = await db.select({ m: M, author: schema.users.name }).from(M).leftJoin(schema.users, eq(schema.users.id, M.authorId)).where(eq(M.ticketId, t.id)).orderBy(asc(M.createdAt));
  const others = t.customerEmail ? await db.select({ id: T.id, number: T.number, subject: T.subject, status: T.status, createdAt: T.createdAt }).from(T).where(and(eq(T.orgId, s.orgId), sql`lower(${T.customerEmail}) = ${t.customerEmail}`, ne(T.id, t.id))).orderBy(desc(T.createdAt)).limit(10) : [];
  const contact = t.contactId && s.has("crm") ? (await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, phone: schema.crmContacts.phone, lifecycle: schema.crmContacts.lifecycle }).from(schema.crmContacts).where(eq(schema.crmContacts.id, t.contactId)))[0] ?? null : null;
  const st = s.settings;
  const first = t.firstRespondedAt ? businessMinutesBetween(t.createdAt, t.firstRespondedAt, st.hours, st.holidays) : null;
  return {
    ticket: { ...t, ...summary(t) },
    messages: msgs.map(({ m, author }) => ({ ...m, author })),
    others,
    contact,
    link: ticketLink(t),
    timing: { firstResponse: first === null ? null : durationText(first, st.hours), remaining: t.remainingMins === null ? null : durationText(t.remainingMins, st.hours) },
  };
}

/** Change status, priority, owner, tags or subject — each change is noted on the ticket. */
export async function update(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const v = check(updateSchema, raw);
  const t = await getTicket(s.orgId, id);
  const now = new Date();
  const st = s.settings;
  const patch: Partial<Ticket> = { updatedAt: now };
  const notes: string[] = [];
  if (v.assigneeId !== undefined && v.assigneeId !== t.assigneeId) {
    if (v.assigneeId && !(await isAgent(s.orgId, v.assigneeId))) throw new ApiError("validation_failed", "That person can't work tickets", { assigneeId: ["Not an agent"] });
    patch.assigneeId = v.assigneeId;
    const [u] = v.assigneeId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, v.assigneeId)) : [];
    notes.push(v.assigneeId ? `Assigned to ${u?.name}` : "Unassigned");
    if (t.status === "new" && v.assigneeId && !v.status) Object.assign(patch, transition(t as never, "open", now, st));
  }
  if (v.priority && v.priority !== t.priority) {
    const was = st.sla[t.priority as Priority];
    const to = st.sla[v.priority];
    patch.priority = v.priority;
    if (!t.firstRespondedAt) patch.firstResponseDue = addBusinessMinutes(t.createdAt, to.first, st.hours, st.holidays);
    // The time left to resolve moves by the difference between the two targets.
    const diff = to.resolve - was.resolve;
    if (STOPPED.includes(t.status as Status)) patch.remainingMins = Math.max(0, (t.remainingMins ?? 0) + diff);
    else if (t.resolveDue) patch.resolveDue = addBusinessMinutes(now, Math.max(0, businessMinutesBetween(now, t.resolveDue, st.hours, st.holidays) + diff), st.hours, st.holidays);
    notes.push(`Priority ${t.priority} → ${v.priority}`);
  }
  if (v.status && v.status !== t.status) {
    Object.assign(patch, transition({ ...t, ...patch } as never, v.status, now, st));
    notes.push(`${STATUS_LABEL[t.status as Status]} → ${STATUS_LABEL[v.status]}`);
  }
  if (v.tags) patch.tags = [...new Set(v.tags)];
  if (v.subject && v.subject !== t.subject) {
    patch.subject = v.subject;
    notes.push(`Subject changed from “${t.subject}”`);
  }
  const [after] = await db.update(T).set(patch).where(eq(T.id, t.id)).returning();
  if (notes.length) await event(t, notes.join(" · "), s.userId);
  if (patch.assigneeId && patch.assigneeId !== s.userId) await notifyAssigned(after, patch.assigneeId, s.userId);
  if (patch.status === "resolved" && t.status !== "resolved") await resolved(after);
  return after;
}

async function resolved(t: Ticket) {
  await emit(t.orgId, "helpdesk.ticket.resolved", { id: t.id, number: t.number, subject: t.subject, customerEmail: t.customerEmail });
  await askRating(t);
}

async function askRating(t: Ticket) {
  const st = await getSettings(t.orgId);
  if (!t.customerEmail) return;
  const o = await orgName(t.orgId);
  const link = ticketLink(t);
  await sendMail({ to: t.customerEmail, subject: `[${t.number}] Resolved: ${t.subject}`, fromName: o?.name, replyTo: st.replyTo || undefined, body: `Hi ${t.customerName || "there"},\n\nWe've marked your request ${t.number} as resolved. If anything's still not right, just reply and it will reopen.${st.csat ? `\n\nHow did we do? Rate us here: ${link}` : `\n\n${link}`}${st.signature ? `\n\n${st.signature}` : ""}` }).catch((e) => log.warn("helpdesk.resolved_mail_failed", { err: String(e) }));
}

/** A reply to the customer (emailed) or an internal note. The first reply stops the first-response clock. */
export async function reply(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const v = check(replySchema, raw);
  const t = await getTicket(s.orgId, id);
  if (!v.internal && !t.customerEmail) throw new ApiError("validation_failed", "This ticket has no customer email. Add a note instead, or record the reply you gave on the phone as a note.", { body: ["No email to send to"] });
  if (!v.internal && t.status === "closed") throw new ApiError("conflict", "This ticket is closed. Reopen it to reply.");
  const now = new Date();
  const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
  const [m] = await db.insert(M).values({ orgId: s.orgId, ticketId: t.id, kind: v.internal ? "note" : "reply", body: v.body, authorId: s.userId, fromName: me?.name ?? "" }).returning();
  const patch: Partial<Ticket> = { updatedAt: now };
  if (!v.internal) {
    patch.lastAgentAt = now;
    if (!t.firstRespondedAt) {
      patch.firstRespondedAt = now;
      if (t.firstResponseDue && now > t.firstResponseDue) patch.firstBreached = true;
    }
    const st = s.settings;
    const o = await orgName(s.orgId);
    await sendMail({ to: t.customerEmail, subject: `Re: ${t.subject} [${t.number}]`, fromName: o?.name, replyTo: st.replyTo || undefined, body: `${v.body}${st.signature ? `\n\n${st.signature}` : `\n\n— ${me?.name ?? ""}, ${o?.name ?? ""}`}\n\nSee this request or reply: ${ticketLink(t)}` });
  }
  if (!t.assigneeId && !v.internal) patch.assigneeId = s.userId;
  // A reply usually waits on the customer; a note doesn't change much.
  const next: Status | undefined = v.status ?? (!v.internal ? "pending" : t.status === "new" ? "open" : undefined);
  if (next && next !== t.status) Object.assign(patch, transition({ ...t, ...patch } as never, next, now, s.settings));
  const [after] = await db.update(T).set(patch).where(eq(T.id, t.id)).returning();
  if (next && next !== t.status) await event(t, `${STATUS_LABEL[t.status as Status]} → ${STATUS_LABEL[next]}`, s.userId);
  if (next === "resolved" && t.status !== "resolved") await resolved(after);
  return m;
}

// ── Saved replies ───────────────────────────────────────────────────────────

export async function canned(s: Scope) {
  return db.select().from(schema.hdCanned).where(eq(schema.hdCanned.orgId, s.orgId)).orderBy(asc(schema.hdCanned.title));
}
export async function saveCanned(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(cannedSchema, raw);
  if (id) {
    const [r] = await db.update(schema.hdCanned).set(v).where(and(eq(schema.hdCanned.id, id), eq(schema.hdCanned.orgId, s.orgId))).returning();
    if (!r) throw notFound("Saved reply");
    return r;
  }
  return (await db.insert(schema.hdCanned).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning())[0];
}
export async function deleteCanned(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Saved reply");
  await db.delete(schema.hdCanned).where(and(eq(schema.hdCanned.id, id), eq(schema.hdCanned.orgId, s.orgId)));
}
/** A saved reply filled in for a ticket. */
export async function cannedFor(s: Scope, ticketId: string, cannedId: string) {
  const t = await getTicket(s.orgId, ticketId);
  if (!isId(cannedId)) throw notFound("Saved reply");
  const [c] = await db.select().from(schema.hdCanned).where(and(eq(schema.hdCanned.id, cannedId), eq(schema.hdCanned.orgId, s.orgId)));
  if (!c) throw notFound("Saved reply");
  const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
  return { body: fillCanned(c.body, { name: t.customerName.split(" ")[0] || "there", ticket: t.number, agent: me?.name ?? "" }) };
}

// ── The customer's page ─────────────────────────────────────────────────────

/** What a customer sees on their link: the conversation (never internal notes), and rating once it's resolved. */
export async function publicTicket(token: string) {
  const t = await fromToken(token);
  const o = await orgName(t.orgId);
  const msgs = await db.select({ kind: M.kind, body: M.body, fromName: M.fromName, createdAt: M.createdAt }).from(M).where(and(eq(M.ticketId, t.id), inArray(M.kind, ["customer", "reply"]))).orderBy(asc(M.createdAt));
  return { org: o?.name ?? "", number: t.number, subject: t.subject, status: t.status, statusLabel: STATUS_LABEL[t.status as Status], createdAt: t.createdAt, messages: msgs.map((m) => ({ ...m, fromName: m.kind === "reply" ? m.fromName.split(" ")[0] || o?.name : m.fromName || "You" })), canReply: t.status !== "closed", canRate: (t.status === "resolved" || t.status === "closed") && (await getSettings(t.orgId)).csat, csat: t.csat, csatComment: t.csatComment };
}

export async function publicReply(token: string, ip: string | null, raw: unknown) {
  await rateLimit(`hd-public:${ip ?? "?"}`, 30, 3_600_000);
  const t = await fromToken(token);
  const v = check(z.object({ body: z.string().trim().min(1, "Write something first").max(10_000) }), raw);
  if (t.status === "closed") throw new ApiError("conflict", "This request is closed. Start a new one if you need more help.");
  await fromCustomer(t, { body: v.body, name: t.customerName, email: t.customerEmail });
  return publicTicket(token);
}

export async function rate(token: string, ip: string | null, raw: unknown) {
  await rateLimit(`hd-public:${ip ?? "?"}`, 30, 3_600_000);
  const t = await fromToken(token);
  const v = check(z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).default("") }), raw);
  if (t.status !== "resolved" && t.status !== "closed") throw new ApiError("conflict", "You can rate this once it's resolved");
  await db.update(T).set({ csat: v.score, csatComment: v.comment }).where(eq(T.id, t.id));
  await event(t, `Rated ${v.score}/5 by the customer${v.comment ? `: “${v.comment.slice(0, 200)}”` : ""}`);
  return publicTicket(token);
}

// ── The sweep ───────────────────────────────────────────────────────────────

/** Mark missed targets (and tell the agent, or the desk's managers if nobody has it), and close resolved tickets left alone. */
export async function tick(now = new Date()) {
  const firstLate = await db.update(T).set({ firstBreached: true }).where(and(eq(T.firstBreached, false), isNull(T.firstRespondedAt), lt(T.firstResponseDue, now), notInArray(T.status, [...STOPPED]))).returning();
  const resolveLate = await db.update(T).set({ resolveBreached: true }).where(and(eq(T.resolveBreached, false), isNull(T.pausedAt), lt(T.resolveDue, now), notInArray(T.status, [...STOPPED]))).returning();
  for (const [t, which] of [...firstLate.map((t) => [t, "first reply"] as const), ...resolveLate.map((t) => [t, "resolution"] as const)]) {
    const to = t.assigneeId ? [t.assigneeId] : (await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, t.orgId), inArray(schema.memberships.role, ["owner", "admin"])))).map((m) => m.id);
    await notify(t.orgId, to, { kind: "helpdesk.breached", title: `${t.number} missed its ${which} target`, body: t.subject, link: `/helpdesk/tickets/${t.id}`, values: { ticket: t.number, subject: t.subject, target: which } }).catch(() => {});
    await event(t, `Missed the ${which} target`);
  }
  // Auto-close, per workspace setting.
  let closed = 0;
  const resolved = await db.select({ t: T, settings: schema.hdSettings.settings }).from(T).innerJoin(schema.hdSettings, eq(schema.hdSettings.orgId, T.orgId)).where(and(eq(T.status, "resolved"), lte(T.resolvedAt, new Date(now.getTime() - 86_400_000))));
  for (const { t, settings } of resolved) {
    const days = Number((settings as { autoCloseDays?: number }).autoCloseDays ?? 7);
    if (!days || !t.resolvedAt || t.resolvedAt.getTime() > now.getTime() - days * 86_400_000) continue;
    await db.update(T).set({ status: "closed", closedAt: now, updatedAt: now }).where(and(eq(T.id, t.id), eq(T.status, "resolved")));
    await event(t, `Closed after ${days} day(s) with no reply`);
    closed++;
  }
  return { breached: firstLate.length + resolveLate.length, closed };
}

// ── Reports ─────────────────────────────────────────────────────────────────

export async function report(s: Scope, q: { from?: string; to?: string } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const to = q.to && day.test(q.to) ? q.to : new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const from = q.from && day.test(q.from) ? q.from : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(T).where(and(eq(T.orgId, s.orgId), gte(T.createdAt, new Date(`${from}T00:00:00+05:30`)), lt(T.createdAt, new Date(Date.parse(`${to}T00:00:00+05:30`) + 86_400_000))));
  const st = s.settings;
  const facts = (ts: Ticket[]) => stats(ts.map((t) => ({ ...t, status: t.status as Status })), st.hours, st.holidays);
  const team = await agents(s.orgId);
  const by = <K extends string>(f: (t: Ticket) => K) => Object.entries(rows.reduce<Record<string, Ticket[]>>((m, t) => ((m[f(t)] ??= []).push(t), m), {}));
  return {
    from,
    to,
    overall: facts(rows),
    agents: by((t) => t.assigneeId ?? "").map(([id, ts]) => ({ id: id || null, name: id ? (team.find((a) => a.id === id)?.name ?? "Former member") : "Unassigned", ...facts(ts) })).sort((a, b) => b.tickets - a.tickets),
    channels: by((t) => t.channel).map(([channel, ts]) => ({ channel, tickets: ts.length })).sort((a, b) => b.tickets - a.tickets),
    priorities: by((t) => t.priority).map(([priority, ts]) => ({ priority, ...facts(ts) })),
    durations: { avgFirst: facts(rows).avgFirst === null ? null : durationText(facts(rows).avgFirst!, st.hours), avgResolve: facts(rows).avgResolve === null ? null : durationText(facts(rows).avgResolve!, st.hours) },
  };
}

export async function inboundInfo(s: Scope) {
  requireManage(s);
  const row = await settingsRow(s.orgId);
  return { url: appUrl(`/api/v1/helpdesk/inbound/${row.inboundToken}`) };
}
