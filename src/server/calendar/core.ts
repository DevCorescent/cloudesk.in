// Calendar: your calendars and events, repeating events (change one
// occurrence or all), meetings added from email, answering invites (RSVP)
// and sending invites, updates and cancellations from your mailbox — real
// iCalendar, so they land in other people's calendars too.
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CalMetaOut, EventOut, MeetingInvite, OccurrenceOut, Person } from "@/lib/calendar/api";
import { findMeetingLink } from "@/lib/calendar/detect";
import { fmtWhen } from "@/lib/calendar/format";
import { buildIcs } from "@/lib/calendar/ics";
import { CAL_COLORS, DEFAULT_REMINDERS, eventSchema } from "@/lib/calendar/model";
import { fromRrule, occurrences, repeatSchema, toRrule, type Repeat } from "@/lib/calendar/recur";
import { validTz } from "@/lib/calendar/tz";
import type { MailMeeting } from "../mail/sync";
import { ApiError, notFound } from "../http/errors";
import type { Scope as MailScope } from "../mail/access";
import { send } from "../mail/send";
import { calendarsOf, check, defaultCalendar, ownCalendar, ownEvent, type CalEvent, type CalScope } from "./access";

const E = schema.calEvents;
const C = schema.calCalendars;
const N = schema.calNotes;
const DAY = 86_400_000;

// ── Calendars ───────────────────────────────────────────────────────────────

const calendarSchema = z.object({ name: z.string().trim().min(1, "Name it").max(60), color: z.string().regex(/^#[0-9a-f]{6}$/i).default(CAL_COLORS[0]!) });

export async function saveCalendar(s: CalScope, id: string | null, raw: unknown) {
  const v = check(calendarSchema, raw);
  if (id) {
    await ownCalendar(s, id);
    await db.update(C).set(v).where(eq(C.id, id));
  } else {
    const n = (await calendarsOf(s.orgId, s.userId)).length;
    if (n >= 30) throw new ApiError("conflict", "You can have up to 30 calendars");
    await db.insert(C).values({ orgId: s.orgId, ownerId: s.userId, ...v });
  }
  return { ok: true };
}

export async function deleteCalendar(s: CalScope, id: string) {
  const c = await ownCalendar(s, id);
  if (c.isDefault) throw new ApiError("conflict", "Your main calendar can't be removed — rename it instead");
  await db.delete(C).where(eq(C.id, c.id));
}

// ── What a mailbox user can see ─────────────────────────────────────────────

/** Mailboxes this person can use: their own and team inboxes they're in. */
async function mailAccountsOf(orgId: string, userId: string) {
  const A = schema.mailAccounts;
  return db
    .select({ id: A.id, name: A.name, address: A.address, color: A.color, ownerId: A.ownerId, displayName: A.displayName, status: A.status })
    .from(A)
    .where(and(eq(A.orgId, orgId), or(eq(A.ownerId, userId), sql`exists (select 1 from mail_account_members m where m.account_id = ${A.id} and m.user_id = ${userId})`)))
    .orderBy(A.createdAt);
}

const inviteOf = (m: { id: string; threadId: string; accountId: string; subject: string; fromName: string; fromAddress: string; date: Date; meeting: unknown }): MeetingInvite | null => {
  const g = m.meeting as MailMeeting | null;
  if (!g || g.cancelled) return null;
  return {
    messageId: m.id, threadId: m.threadId, accountId: m.accountId, subject: m.subject, from: { name: m.fromName, address: m.fromAddress }, receivedAt: m.date.toISOString(),
    title: g.title, start: g.start ? new Date(g.start).toISOString() : null, end: g.end ? new Date(g.end).toISOString() : null, allDay: g.allDay, url: g.url, provider: g.provider, location: g.location,
    source: g.source, confidence: g.confidence, organizer: g.organizer, attendees: g.attendees,
  };
};

/** Meetings found in your mail that aren't in your calendar yet (upcoming, or with no time found). */
async function pendingInvites(s: CalScope, accountIds: string[]): Promise<MeetingInvite[]> {
  if (!accountIds.length) return [];
  const M = schema.mailMessages;
  const T = schema.mailThreads;
  const rows = await db
    .select({ id: M.id, threadId: M.threadId, accountId: M.accountId, subject: M.subject, fromName: M.fromName, fromAddress: M.fromAddress, date: M.date, meeting: M.meeting })
    .from(M)
    .innerJoin(T, eq(T.id, M.threadId))
    .where(and(inArray(M.accountId, accountIds), isNotNull(M.meeting), isNull(T.meetingEventId), sql`${T.status} not in ('trash','spam')`, gte(M.date, new Date(Date.now() - 30 * DAY)), or(isNull(T.meetingAt), gte(T.meetingAt, new Date(Date.now() - DAY)))))
    .orderBy(desc(M.date))
    .limit(60);
  // Not already added by you (the same invite can arrive more than once).
  const uids = rows.map((r) => (r.meeting as MailMeeting).uid).filter(Boolean);
  const mine = uids.length ? new Set((await db.select({ uid: E.uid }).from(E).where(and(eq(E.ownerId, s.userId), inArray(E.uid, uids)))).map((x) => x.uid)) : new Set<string>();
  const seen = new Set<string>();
  return rows
    .map(inviteOf)
    .filter((x): x is MeetingInvite => !!x)
    .filter((x, i) => {
      const uid = (rows[i]!.meeting as MailMeeting).uid;
      const key = uid || x.threadId;
      if (mine.has(uid) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

export async function meta(s: CalScope): Promise<CalMetaOut> {
  const cals = await calendarsOf(s.orgId, s.userId);
  const accts = s.has("mail") ? await mailAccountsOf(s.orgId, s.userId) : [];
  // Meetings that have ended without minutes (last two weeks), for "Add the minutes".
  const recent = (await db.select().from(E).where(and(eq(E.orgId, s.orgId), eq(E.ownerId, s.userId), sql`${E.status} <> 'cancelled'`, or(isNotNull(E.repeat), and(lt(E.startsAt, new Date()), gte(E.endsAt, new Date(Date.now() - 14 * DAY))))))).filter(wantsMinutes);
  const due: CalMetaOut["notesDue"] = [];
  const now = Date.now();
  for (const e of recent) {
    for (const occ of occurrencesOf(e, now - 14 * DAY, now)) {
      const end = occ + (e.endsAt.getTime() - e.startsAt.getTime());
      if (end <= now) due.push({ eventId: e.id, occurrence: new Date(occ).toISOString(), title: e.title, end: new Date(end).toISOString() });
    }
  }
  const ids = [...new Set(due.map((d) => d.eventId))];
  const have = ids.length ? await db.select({ eventId: N.eventId, occ: N.occurrence, shared: N.sharedAt }).from(N).where(inArray(N.eventId, ids)) : [];
  const skipped = ids.length ? await db.select({ eventId: schema.calRemindersSent.eventId, occ: schema.calRemindersSent.occurrence }).from(schema.calRemindersSent).where(and(inArray(schema.calRemindersSent.eventId, ids), eq(schema.calRemindersSent.offset, -2))) : [];
  const done = new Set([...have.filter((h) => h.shared), ...skipped].map((h) => `${h.eventId}:${h.occ.toISOString()}`));
  return {
    me: { name: s.userName, email: s.userEmail },
    calendars: cals.map((c) => ({ id: c.id, name: c.name, color: c.color, isDefault: c.isDefault })),
    accounts: accts.filter((a) => a.status !== "paused").map((a) => ({ id: a.id, name: a.name, address: a.address, color: a.color })),
    invites: await pendingInvites(s, accts.map((a) => a.id)),
    notesDue: due.filter((d) => !done.has(`${d.eventId}:${d.occurrence}`)).sort((a, b) => b.end.localeCompare(a.end)).slice(0, 20),
    mail: s.has("mail"),
  };
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Meetings that get minutes: with other people (or from an invite), and longer than a quick stand-up. */
export const wantsMinutes = (e: CalEvent) => !e.allDay && (e.attendees.length > 0 || e.source === "mail") && e.endsAt.getTime() - e.startsAt.getTime() >= 20 * 60_000;

const repeatOf = (e: CalEvent): Repeat | null => (e.repeat ? (repeatSchema.safeParse(e.repeat).data ?? null) : null);
export const occurrencesOf = (e: CalEvent, from: number, to: number) => occurrences(e.startsAt.getTime(), e.endsAt.getTime() - e.startsAt.getTime(), e.tz, repeatOf(e), from, to, e.skip);

export async function range(s: CalScope, q: Record<string, string>) {
  const from = Date.parse(q.from ?? "");
  const to = Date.parse(q.to ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new ApiError("validation_failed", "Pick a date range");
  if (to - from > 100 * DAY) throw new ApiError("validation_failed", "Ask for at most about three months at a time");
  const cals = await calendarsOf(s.orgId, s.userId);
  const color = new Map(cals.map((c) => [c.id, c.color]));
  const rows = await db.select().from(E).where(and(eq(E.orgId, s.orgId), eq(E.ownerId, s.userId), lt(E.startsAt, new Date(to)), or(isNotNull(E.repeat), gte(E.endsAt, new Date(from)))));
  const notes = rows.length ? await db.select({ eventId: N.eventId, occ: N.occurrence, shared: N.sharedAt }).from(N).where(inArray(N.eventId, rows.map((r) => r.id))) : [];
  const noteOf = new Map(notes.map((n) => [`${n.eventId}:${n.occ.getTime()}`, n.shared ? "shared" : "draft"] as const));
  const out: OccurrenceOut[] = [];
  for (const e of rows) {
    const len = e.endsAt.getTime() - e.startsAt.getTime();
    for (const occ of occurrencesOf(e, from, to)) {
      out.push({
        key: `${e.id}:${occ}`, id: e.id, occurrence: new Date(occ).toISOString(), start: new Date(occ).toISOString(), end: new Date(occ + len).toISOString(), title: e.title, calendarId: e.calendarId,
        color: e.color ?? color.get(e.calendarId) ?? CAL_COLORS[0]!, allDay: e.allDay, meetingUrl: e.meetingUrl, provider: e.meetingProvider, location: e.location, recurring: !!e.repeat,
        status: e.status as OccurrenceOut["status"], response: e.response as OccurrenceOut["response"], organizer: e.organizer, attendees: e.attendees.length, source: e.source as OccurrenceOut["source"], mailThreadId: e.mailThreadId,
        notes: noteOf.get(`${e.id}:${occ}`) ?? "none",
      });
    }
  }
  return { events: out.sort((a, b) => a.start.localeCompare(b.start)) };
}

function organising(e: CalEvent, myAddresses: Set<string>) {
  return !e.organizer || myAddresses.has(e.organizer.email.toLowerCase());
}

export async function detail(s: CalScope, id: string): Promise<EventOut> {
  const e = await ownEvent(s, id);
  const mine = new Set([s.userEmail.toLowerCase(), ...(await mailAccountsOf(s.orgId, s.userId)).map((a) => a.address.toLowerCase())]);
  const notes = await db.select({ occ: N.occurrence, shared: N.sharedAt }).from(N).where(eq(N.eventId, e.id)).orderBy(desc(N.occurrence));
  return {
    id: e.id, calendarId: e.calendarId, uid: e.uid, title: e.title, description: e.description, location: e.location, meetingUrl: e.meetingUrl, provider: e.meetingProvider,
    start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: e.allDay, tz: e.tz, repeat: repeatOf(e), attendees: e.attendees, organizer: e.organizer, reminders: e.reminders, color: e.color,
    status: e.status as EventOut["status"], response: e.response as EventOut["response"], source: e.source as EventOut["source"], mailAccountId: e.mailAccountId, mailThreadId: e.mailThreadId,
    organising: organising(e, mine), notes: notes.map((n) => ({ occurrence: n.occ.toISOString(), sharedAt: n.shared?.toISOString() ?? null })),
  };
}

const sendOpts = z.object({ sendInvite: z.boolean().default(false), accountId: z.uuid().optional() });

/** Values for the events table from validated input. */
function columns(v: z.infer<typeof eventSchema>) {
  const link = v.meetingUrl ? findMeetingLink(v.meetingUrl) : null;
  return {
    calendarId: v.calendarId, title: v.title, description: v.description, location: v.location, meetingUrl: v.meetingUrl, meetingProvider: v.meetingUrl ? (link?.provider ?? "other") : null,
    startsAt: new Date(v.start), endsAt: new Date(v.end), allDay: v.allDay, tz: validTz(v.tz), repeat: v.repeat, attendees: v.attendees.map((a) => ({ name: a.name, email: a.email })),
    reminders: [...new Set(v.reminders)].sort((a, b) => b - a), color: v.color, status: v.status,
  };
}

export async function createEvent(s: CalScope, raw: unknown, mail: MailScope | null) {
  const v = check(eventSchema, raw);
  const o = check(sendOpts, raw);
  await ownCalendar(s, v.calendarId);
  const id = crypto.randomUUID();
  const [e] = await db.insert(E).values({ id, orgId: s.orgId, ownerId: s.userId, uid: `${id}@cloudesk`, ...columns(v), source: "manual", mailAccountId: o.accountId ?? null }).returning();
  if (o.sendInvite && v.attendees.length) await sendInvite(s, mail, e!, "REQUEST", o.accountId);
  return { event: await detail(s, e!.id) };
}

const patchSchema = z.object({
  scope: z.enum(["all", "this"]).default("all"),
  /** The occurrence being changed (for "this" on a repeating event). */
  occurrence: z.iso.datetime({ offset: true }).optional(),
  notify: z.boolean().default(false),
  accountId: z.uuid().optional(),
});

export async function updateEvent(s: CalScope, id: string, raw: unknown, mail: MailScope | null) {
  const e = await ownEvent(s, id);
  const o = check(patchSchema, raw);
  const merged = { ...eventInput(e), ...(raw as Record<string, unknown>) };
  const v = check(eventSchema, merged);
  await ownCalendar(s, v.calendarId);
  if (o.scope === "this" && e.repeat && o.occurrence) {
    // Just this one: take it out of the series and make it its own event.
    const occ = Date.parse(o.occurrence);
    await db.update(E).set({ skip: [...e.skip, occ], updatedAt: new Date() }).where(eq(E.id, e.id));
    const nid = crypto.randomUUID();
    await db.insert(E).values({ id: nid, orgId: s.orgId, ownerId: s.userId, uid: `${nid}@cloudesk`, ...columns({ ...v, repeat: null }), source: e.source, organizer: e.organizer, response: e.response, mailAccountId: e.mailAccountId, mailThreadId: e.mailThreadId, mailMessageId: e.mailMessageId });
    return { event: await detail(s, nid) };
  }
  const moved = v.start !== e.startsAt.toISOString() || v.end !== e.endsAt.toISOString();
  const [u] = await db.update(E).set({ ...columns(v), sequence: e.sequence + (moved ? 1 : 0), updatedAt: new Date() }).where(eq(E.id, e.id)).returning();
  // Moving it means the reminders apply afresh.
  if (moved) await db.delete(schema.calRemindersSent).where(eq(schema.calRemindersSent.eventId, e.id));
  if (o.notify && u!.attendees.length) await sendInvite(s, mail, u!, "REQUEST", o.accountId);
  return { event: await detail(s, e.id) };
}

/** Our stored event as API input (for merging a partial change). */
function eventInput(e: CalEvent) {
  return { calendarId: e.calendarId, title: e.title, description: e.description, location: e.location, meetingUrl: e.meetingUrl, start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: e.allDay, tz: e.tz, repeat: e.repeat, attendees: e.attendees.map((a) => ({ name: a.name, email: a.email })), reminders: e.reminders, color: e.color, status: e.status };
}

export async function deleteEvent(s: CalScope, id: string, q: Record<string, string>, mail: MailScope | null) {
  const e = await ownEvent(s, id);
  if (q.scope === "this" && e.repeat && q.occurrence) {
    await db.update(E).set({ skip: [...e.skip, Date.parse(q.occurrence)] }).where(eq(E.id, e.id));
    return { ok: true };
  }
  if (q.notify === "1" && e.attendees.length) await sendInvite(s, mail, { ...e, sequence: e.sequence + 1 }, "CANCEL", q.account || undefined);
  await db.delete(E).where(eq(E.id, e.id));
  await db.update(schema.mailThreads).set({ meetingEventId: null }).where(eq(schema.mailThreads.meetingEventId, e.id));
  return { ok: true };
}

/** The mailbox to send from: the one asked for, the event's, or your first. */
async function fromAccount(s: CalScope, e: { mailAccountId: string | null }, asked?: string) {
  const accts = (await mailAccountsOf(s.orgId, s.userId)).filter((a) => a.status !== "paused");
  const a = accts.find((x) => x.id === asked) ?? accts.find((x) => x.id === e.mailAccountId) ?? accts[0];
  if (!a) throw new ApiError("conflict", "Connect a mailbox in Mail to send invites and minutes");
  return a;
}

async function sendInvite(s: CalScope, mail: MailScope | null, e: CalEvent, method: "REQUEST" | "CANCEL", accountId?: string) {
  if (!mail) throw new ApiError("forbidden", "Sending invites needs Mail switched on");
  const acc = await fromAccount(s, e, accountId);
  const organizer = { name: acc.displayName || s.userName, email: acc.address };
  const ics = buildIcs({ method, uid: e.uid, sequence: e.sequence, summary: e.title, description: [e.description, e.meetingUrl && `Join: ${e.meetingUrl}`].filter(Boolean).join("\n\n"), location: e.location || (e.meetingUrl ? "Online" : ""), url: e.meetingUrl || undefined, start: e.startsAt.getTime(), end: e.endsAt.getTime(), allDay: e.allDay, organizer, attendees: e.attendees.map((a) => ({ name: a.name, email: a.email })), rrule: toRrule(repeatOf(e)) });
  const when = fmtWhen(e.startsAt.getTime(), e.endsAt.getTime(), e.tz, e.allDay);
  const body = method === "CANCEL" ? `This meeting has been cancelled.\n\n${e.title}\n${when}` : [`You're invited: ${e.title}`, `When: ${when}`, e.meetingUrl && `Join: ${e.meetingUrl}`, e.location && `Where: ${e.location}`, e.description].filter(Boolean).join("\n\n");
  await send(mail, { accountId: acc.id, to: e.attendees.map((a) => a.email), subject: `${method === "CANCEL" ? "Cancelled: " : e.sequence > 0 ? "Updated invitation: " : "Invitation: "}${e.title} @ ${when}`, body }, { ical: { method, content: ics } });
  if (method === "REQUEST" && !e.organizer) await db.update(E).set({ organizer, mailAccountId: acc.id }).where(eq(E.id, e.id));
}

// ── Answering an invite ─────────────────────────────────────────────────────

const rsvpSchema = z.object({ response: z.enum(["accepted", "tentative", "declined"]), accountId: z.uuid().optional(), note: z.string().max(1000).default("") });

export async function rsvp(s: CalScope, id: string, raw: unknown, mail: MailScope | null) {
  const e = await ownEvent(s, id);
  const v = check(rsvpSchema, raw);
  if (!e.organizer?.email) throw new ApiError("conflict", "This event has no organiser to answer");
  if (mail) {
    const acc = await fromAccount(s, e, v.accountId);
    const partstat = v.response.toUpperCase() as "ACCEPTED" | "TENTATIVE" | "DECLINED";
    const ics = buildIcs({ method: "REPLY", uid: e.uid, sequence: e.sequence, summary: e.title, start: e.startsAt.getTime(), end: e.endsAt.getTime(), allDay: e.allDay, organizer: { name: e.organizer.name, email: e.organizer.email }, attendees: [], reply: { email: acc.address, name: acc.displayName || s.userName, partstat } });
    const word = { accepted: "Accepted", tentative: "Tentative", declined: "Declined" }[v.response];
    await send(mail, { accountId: acc.id, to: [e.organizer.email], subject: `${word}: ${e.title} @ ${fmtWhen(e.startsAt.getTime(), e.endsAt.getTime(), e.tz, e.allDay)}`, body: `${acc.displayName || s.userName} has ${v.response === "tentative" ? "tentatively accepted" : v.response} this invitation.${v.note ? `\n\n${v.note}` : ""}`, signatureId: null }, { ical: { method: "REPLY", content: ics } });
  }
  await db.update(E).set({ response: v.response, status: v.response === "tentative" ? "tentative" : "confirmed", updatedAt: new Date() }).where(eq(E.id, e.id));
  return { event: await detail(s, e.id) };
}

export async function icsFile(s: CalScope, id: string) {
  const e = await ownEvent(s, id);
  const text = buildIcs({ method: "PUBLISH", uid: e.uid, sequence: e.sequence, summary: e.title, description: e.description, location: e.location, url: e.meetingUrl || undefined, start: e.startsAt.getTime(), end: e.endsAt.getTime(), allDay: e.allDay, organizer: e.organizer ?? { name: s.userName, email: s.userEmail }, attendees: e.attendees, rrule: toRrule(repeatOf(e)) });
  return new Response(text, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${e.title.replace(/[^\w .-]+/g, "").slice(0, 60) || "event"}.ics"`, "cache-control": "no-store" } });
}

// ── From email ──────────────────────────────────────────────────────────────

type Refs = { accountId: string; threadId: string; messageId: string };

/** Makes an event from a meeting found in an email. */
export async function eventFromMeeting(orgId: string, ownerId: string, calendarId: string, g: MailMeeting, refs: Refs, over: { title?: string; start?: number; end?: number; reminders?: number[] } = {}) {
  const start = over.start ?? g.start;
  if (!start) throw new ApiError("validation_failed", "Pick when the meeting is", { start: ["When is it?"] });
  const end = over.end ?? g.end ?? start + 30 * 60_000;
  if (end <= start) throw new ApiError("validation_failed", "It has to end after it starts", { end: ["After the start"] });
  const id = crypto.randomUUID();
  const repeat = g.rrule ? fromRrule(g.rrule) : null;
  const [e] = await db
    .insert(E)
    .values({
      id, orgId, ownerId, calendarId, uid: g.uid || `${id}@cloudesk`, sequence: g.sequence, title: (over.title ?? g.title).slice(0, 200) || "Meeting", description: g.description, location: g.location, meetingUrl: g.url, meetingProvider: g.url ? (g.provider ?? "other") : null,
      startsAt: new Date(start), endsAt: new Date(end), allDay: g.allDay, tz: validTz(g.tz ?? "Asia/Kolkata"), repeat, organizer: g.organizer ? { name: g.organizer.name, email: g.organizer.address } : null,
      attendees: g.attendees.map((a) => ({ name: a.name, email: a.address })), reminders: over.reminders ?? DEFAULT_REMINDERS, source: "mail", mailAccountId: refs.accountId, mailThreadId: refs.threadId, mailMessageId: refs.messageId,
    })
    .returning();
  await db.update(schema.mailThreads).set({ meetingEventId: e!.id }).where(eq(schema.mailThreads.id, refs.threadId));
  return e!;
}

const fromMailSchema = z.object({
  messageId: z.uuid(),
  calendarId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  reminders: z.array(z.number().int().min(0).max(10080)).max(8).optional(),
  /** Also answer the organiser "Accepted". */
  accept: z.boolean().default(false),
});

export async function addFromMail(s: CalScope, raw: unknown, mail: MailScope | null) {
  const v = check(fromMailSchema, raw);
  const M = schema.mailMessages;
  const [m] = await db.select({ id: M.id, threadId: M.threadId, accountId: M.accountId, meeting: M.meeting }).from(M).where(and(eq(M.id, v.messageId), eq(M.orgId, s.orgId)));
  const allowed = new Set((await mailAccountsOf(s.orgId, s.userId)).map((a) => a.id));
  if (!m || !allowed.has(m.accountId) || !m.meeting) throw notFound("Meeting");
  const g = m.meeting as MailMeeting;
  if (g.uid) {
    const [dup] = await db.select({ id: E.id }).from(E).where(and(eq(E.ownerId, s.userId), eq(E.uid, g.uid)));
    if (dup) {
      await db.update(schema.mailThreads).set({ meetingEventId: dup.id }).where(eq(schema.mailThreads.id, m.threadId));
      return { event: await detail(s, dup.id), already: true };
    }
  }
  const cal = v.calendarId ? await ownCalendar(s, v.calendarId) : await defaultCalendar(s.orgId, s.userId);
  const e = await eventFromMeeting(s.orgId, s.userId, cal.id, g, { accountId: m.accountId, threadId: m.threadId, messageId: m.id }, { title: v.title, start: v.start ? Date.parse(v.start) : undefined, end: v.end ? Date.parse(v.end) : undefined, reminders: v.reminders });
  if (v.accept && e.organizer && g.source === "ics") await rsvp(s, e.id, { response: "accepted", accountId: m.accountId }, mail);
  return { event: await detail(s, e.id), already: false };
}

export const personOf = (p: { name: string; email: string }): Person => ({ name: p.name, email: p.email });
