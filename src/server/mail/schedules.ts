// Recurring emails: saving a schedule, keeping its meeting in the calendar,
// and sending each run. A run is claimed atomically (next_run_at moves only if
// it's still the one we read) and recorded once per planned moment (a unique
// index), so several workers never send the same email twice. Each send goes
// through the normal send path — signatures, groups, "one each", contact
// placeholders and retries all apply — and is recorded with its message.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ScheduleOut, ScheduleRunOut } from "@/lib/mail/api";
import { findMeetingLink } from "@/lib/calendar/detect";
import { fmtWhen } from "@/lib/calendar/format";
import { buildIcs } from "@/lib/calendar/ics";
import { validTz } from "@/lib/calendar/tz";
import { dayOf, describeSchedule, fillRun, meetingStart, nextSend, plainTitle, scheduleSchema, upcoming, type ScheduleData, type Timing } from "@/lib/mail/schedule";
import { defaultCalendar } from "../calendar/access";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { notify } from "../notify/notify";
import { account, accountsFor, check, scopeFor, type Scope } from "./access";
import { send } from "./send";

const S = schema.mailSchedules;
const F = schema.mailScheduleFiles;
const R = schema.mailScheduleRuns;
const E = schema.calEvents;
type Row = typeof S.$inferSelect;

const MIN = 60_000;
const HOUR = 60 * MIN;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
/** A run this late is skipped whatever the setting (an email meant for 9 am shouldn't arrive at night). */
const TOO_LATE = 12 * HOUR;
/** "Skip missed sends": later than this counts as missed. */
const GRACE = 15 * MIN;
const MAX_ACTIVE = 100;
const isUuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

const timing = (r: Pick<Row, "startDate" | "times" | "tz" | "repeat" | "skipDates">): Timing => ({ startDate: r.startDate, times: r.times, tz: r.tz, repeat: r.repeat, skipDates: r.skipDates });
const link = (id: string) => `/mail/recurring?open=${id}`;
const label = (r: Pick<Row, "name" | "subject">) => r.name || r.subject;

// ── Reading ─────────────────────────────────────────────────────────────────

async function out(r: Row, s: Scope, files?: { id: string; filename: string; size: number }[]): Promise<ScheduleOut> {
  const f = files ?? (await db.select({ id: F.id, filename: F.filename, size: F.size }).from(F).where(eq(F.scheduleId, r.id)).orderBy(asc(F.createdAt)));
  const left = r.limit === null ? 10 : Math.max(0, r.limit - r.sentCount);
  const next = r.status === "active" ? upcoming(timing(r), Date.now() - 1, Math.min(10, left)) : [];
  return {
    id: r.id, name: r.name, status: r.status as ScheduleOut["status"], statusNote: r.statusNote, accountId: r.accountId,
    to: r.to, cc: r.cc, bcc: r.bcc, groupIds: r.groupIds, separately: r.separately, subject: r.subject, body: r.body,
    signatureId: r.signature === "" ? undefined : r.signature === "none" ? null : r.signature,
    startDate: r.startDate, times: r.times, tz: r.tz, repeat: r.repeat, skipDates: r.skipDates, limit: r.limit,
    thread: r.options.thread, stopOnReply: r.options.stopOnReply, missed: r.options.missed, notifyEach: r.options.notifyEach,
    meeting: r.meeting, eventId: r.eventId, files: f,
    nextRunAt: r.status === "active" ? (r.nextRunAt?.toISOString() ?? null) : null, lastRunAt: r.lastRunAt?.toISOString() ?? null,
    sentCount: r.sentCount, describe: describeSchedule(r), upcoming: next.map((x) => new Date(x).toISOString()),
    mine: r.createdBy === s.userId, createdAt: r.createdAt.toISOString(),
  };
}

/** Schedules on mailboxes you can use: yours, and (team inboxes) your colleagues'. */
export async function listSchedules(s: Scope) {
  const ids = (await accountsFor(s)).map((a) => a.id);
  if (!ids.length) return { schedules: [] };
  const rows = await db.select().from(S).where(and(eq(S.orgId, s.orgId), inArray(S.accountId, ids))).orderBy(sql`case ${S.status} when 'active' then 0 when 'paused' then 1 else 2 end`, asc(S.nextRunAt), desc(S.createdAt));
  const files = rows.length ? await db.select({ id: F.id, scheduleId: F.scheduleId, filename: F.filename, size: F.size }).from(F).where(inArray(F.scheduleId, rows.map((r) => r.id))) : [];
  return { schedules: await Promise.all(rows.map((r) => out(r, s, files.filter((f) => f.scheduleId === r.id)))) };
}

/** A schedule this person may see; `edit` also needs it to be theirs (or a team inbox they manage). */
async function scheduleFor(s: Scope, id: string, edit = false) {
  if (!isUuid(id)) throw notFound("Recurring email");
  const [r] = await db.select().from(S).where(and(eq(S.id, id), eq(S.orgId, s.orgId)));
  if (!r) throw notFound("Recurring email");
  const acc = await account(s, r.accountId).catch(() => null);
  if (!acc) throw notFound("Recurring email");
  if (edit && r.createdBy !== s.userId && !(acc.shared && s.manage)) throw new ApiError("forbidden", "Only whoever set it up (or an admin, for a team inbox) can change it");
  return r;
}

export async function getSchedule(s: Scope, id: string) {
  const r = await scheduleFor(s, id);
  const runs = await db.select().from(R).where(eq(R.scheduleId, r.id)).orderBy(desc(R.plannedFor)).limit(100);
  return { schedule: await out(r, s), runs: runs.map(runOut) };
}

const runOut = (x: typeof R.$inferSelect): ScheduleRunOut => ({ id: x.id, plannedFor: x.plannedFor.toISOString(), status: x.status as ScheduleRunOut["status"], note: x.note, n: x.n, manual: x.manual, messageId: x.messageId, threadId: x.threadId, recipients: x.recipients, at: x.createdAt.toISOString() });

// ── Saving ──────────────────────────────────────────────────────────────────

/** Fills in the meeting: a video room when asked, and with several send times a set start. */
function settleMeeting(v: ScheduleData): ScheduleData["meeting"] {
  let m = v.meeting;
  // A meeting link in the email itself is a meeting, even if nobody filled in the meeting part.
  if (!m) {
    const found = findMeetingLink(`${v.subject}\n${v.body}`);
    if (!found) return null;
    m = { title: "", at: null, durationMin: 30, link: found.url, makeLink: false, addToCalendar: true, calendarId: null, invite: false, details: false, reminders: [10, 0] };
  }
  const link = m.link || findMeetingLink(v.body)?.url || (m.makeLink ? `https://meet.jit.si/Cloudesk-${randomBytes(12).toString("hex")}` : "");
  return { ...m, link, at: m.at ?? (v.times.length > 1 ? [...v.times].sort()[0]! : null) };
}

async function filesFrom(v: ScheduleData) {
  const files = v.attachments.map((a) => ({ filename: a.filename.replace(/[\\/\0]/g, "_"), mime: a.mime, data: Buffer.from(a.data, "base64") }));
  if (files.some((f) => f.data.length > MAX_FILE)) throw new ApiError("payload_too_large", "Each attachment can be up to 15 MB");
  return files;
}

async function columns(s: Scope, v: ScheduleData) {
  const acc = await account(s, v.accountId);
  if (acc.status === "paused") throw new ApiError("conflict", "This mailbox is paused — resume it in Mail → Settings first");
  validTz(v.tz);
  return {
    accountId: acc.id, name: v.name, to: v.to, cc: v.cc, bcc: v.bcc, groupIds: v.groupIds, separately: v.separately, subject: v.subject, body: v.body,
    signature: v.signatureId === undefined ? "" : v.signatureId === null ? "none" : v.signatureId,
    startDate: v.startDate, times: [...v.times].sort(), tz: validTz(v.tz), repeat: { ...v.repeat, count: null }, skipDates: [...new Set(v.skipDates)].sort(), limit: v.limit,
    options: { thread: v.thread, stopOnReply: v.stopOnReply, missed: v.missed, notifyEach: v.notifyEach },
    meeting: settleMeeting(v),
  };
}

export async function createSchedule(s: Scope, raw: unknown) {
  const v = check(scheduleSchema, raw);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(S).where(and(eq(S.orgId, s.orgId), eq(S.createdBy, s.userId), eq(S.status, "active")))) as [{ n: number }];
  if (n >= MAX_ACTIVE) throw new ApiError("conflict", `You have ${MAX_ACTIVE} active recurring emails — pause or delete some first`);
  const c = await columns(s, v);
  const files = await filesFrom(v);
  if (files.reduce((a, f) => a + f.data.length, 0) > MAX_TOTAL) throw new ApiError("payload_too_large", "Attachments can add up to 25 MB");
  const next = nextSend(timing(c), Date.now(), 0, c.limit);
  if (!next) throw new ApiError("validation_failed", "Those settings never send — check the dates and the end", { startDate: ["No sends"] });
  const [r] = await db.insert(S).values({ orgId: s.orgId, createdBy: s.userId, ...c, nextRunAt: new Date(next) }).returning();
  if (files.length) await db.insert(F).values(files.map((f) => ({ scheduleId: r!.id, filename: f.filename, mime: f.mime, size: f.data.length, data: f.data })));
  const synced = await syncEvent(r!);
  return { schedule: await out(synced, s) };
}

export async function updateSchedule(s: Scope, id: string, raw: unknown) {
  const r = await scheduleFor(s, id, true);
  const v = check(scheduleSchema, raw);
  const c = await columns(s, { ...v, meeting: v.meeting && r.meeting?.makeLink && v.meeting.makeLink && !v.meeting.link ? { ...v.meeting, link: r.meeting.link } : v.meeting });
  const files = await filesFrom(v);
  const kept = await db.select({ id: F.id, size: F.size }).from(F).where(and(eq(F.scheduleId, r.id), inArray(F.id, v.keepFiles.length ? v.keepFiles : ["00000000-0000-0000-0000-000000000000"])));
  if (kept.length + files.length > 10) throw new ApiError("validation_failed", "Up to 10 attachments");
  if (kept.reduce((a, f) => a + f.size, 0) + files.reduce((a, f) => a + f.data.length, 0) > MAX_TOTAL) throw new ApiError("payload_too_large", "Attachments can add up to 25 MB");
  await db.delete(F).where(and(eq(F.scheduleId, r.id), kept.length ? sql`${F.id} not in (${sql.join(kept.map((k) => sql`${k.id}`), sql`, `)})` : sql`true`));
  if (files.length) await db.insert(F).values(files.map((f) => ({ scheduleId: r.id, filename: f.filename, mime: f.mime, size: f.data.length, data: f.data })));
  // The next send is worked out afresh (a changed time applies from now on); a schedule that had ended can start again.
  const next = nextSend(timing(c), Date.now(), r.sentCount, c.limit);
  const status = r.status === "paused" ? "paused" : next ? "active" : "ended";
  const [u] = await db.update(S).set({ ...c, nextRunAt: next ? new Date(next) : null, status, statusNote: status === "ended" ? "Nothing left to send with these settings" : r.status === "paused" ? r.statusNote : "", failStreak: 0, updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
  return { schedule: await out(await syncEvent(u!), s) };
}

/** Pause, resume, skip the next one, or send one now. */
export async function scheduleAction(s: Scope, id: string, action: string) {
  const r = await scheduleFor(s, id, true);
  if (action === "pause") {
    if (r.status !== "active") throw new ApiError("conflict", "It isn't running");
    const [u] = await db.update(S).set({ status: "paused", statusNote: `Paused by ${s.userName}`, updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
    return { schedule: await out(await syncEvent(u!), s) };
  }
  if (action === "resume") {
    if (r.status === "active") return { schedule: await out(r, s) };
    const next = nextSend(timing(r), Date.now(), r.sentCount, r.limit);
    if (!next) throw new ApiError("conflict", r.limit !== null && r.sentCount >= r.limit ? `All ${r.limit} have been sent — raise the limit to keep going` : "Its last date has passed — change the end date to keep going");
    const [u] = await db.update(S).set({ status: "active", statusNote: "", nextRunAt: new Date(next), failStreak: 0, updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
    return { schedule: await out(await syncEvent(u!), s) };
  }
  if (action === "skip") {
    if (r.status !== "active" || !r.nextRunAt) throw new ApiError("conflict", "Nothing is coming up to skip");
    const planned = r.nextRunAt;
    const after = nextSend(timing(r), planned.getTime(), r.sentCount, r.limit);
    const [u] = await db.update(S).set({ nextRunAt: after ? new Date(after) : null, ...(after ? {} : { status: "ended", statusNote: "Nothing left to send" }), updatedAt: new Date() }).where(and(eq(S.id, r.id), eq(S.nextRunAt, planned))).returning();
    if (!u) throw new ApiError("conflict", "It's being sent right now");
    await db.insert(R).values({ scheduleId: r.id, orgId: r.orgId, plannedFor: planned, status: "skipped", note: `Skipped by ${s.userName}`, manual: true }).onConflictDoNothing();
    if (r.meeting && r.eventId && dayHasMeeting(r, planned.getTime())) await skipMeeting(r, planned.getTime());
    return { schedule: await out(u, s) };
  }
  if (action === "send-now") {
    if (r.limit !== null && r.sentCount >= r.limit) throw new ApiError("conflict", `All ${r.limit} have been sent`);
    const planned = new Date();
    const [run] = await db.insert(R).values({ scheduleId: r.id, orgId: r.orgId, plannedFor: planned, status: "pending", manual: true }).onConflictDoNothing().returning();
    if (!run) throw new ApiError("conflict", "One is going out right now");
    await deliver(r, run.id, planned.getTime(), true);
    const [u] = await db.select().from(S).where(eq(S.id, r.id));
    return { schedule: await out(u!, s) };
  }
  throw notFound("Action");
}

export async function duplicateSchedule(s: Scope, id: string) {
  const r = await scheduleFor(s, id);
  const files = await db.select().from(F).where(eq(F.scheduleId, r.id));
  const today = dayOf(Date.now(), r.tz);
  return createSchedule(s, {
    name: `${label(r)} (copy)`.slice(0, 120), accountId: r.accountId, to: r.to, cc: r.cc, bcc: r.bcc, groupIds: r.groupIds, separately: r.separately, subject: r.subject, body: r.body,
    signatureId: r.signature === "" ? undefined : r.signature === "none" ? null : r.signature,
    startDate: r.startDate > today ? r.startDate : today, times: r.times, tz: r.tz, repeat: r.repeat, skipDates: r.skipDates.filter((d) => d >= today), limit: r.limit,
    thread: r.options.thread, stopOnReply: r.options.stopOnReply, missed: r.options.missed, notifyEach: r.options.notifyEach,
    meeting: r.meeting ? { ...r.meeting, link: r.meeting.makeLink ? "" : r.meeting.link } : null,
    attachments: files.map((f) => ({ filename: f.filename, mime: f.mime, data: f.data.toString("base64") })),
  });
}

export async function deleteSchedule(s: Scope, id: string) {
  const r = await scheduleFor(s, id, true);
  if (r.eventId) await db.delete(E).where(eq(E.id, r.eventId));
  await db.delete(S).where(eq(S.id, r.id));
  return { ok: true };
}

// ── The meeting, in the owner's calendar ────────────────────────────────────

/** Sends on this day: the meeting rides on the first one. */
const dayHasMeeting = (r: Row, ms: number) => upcoming(timing(r), ms - 1 - 24 * HOUR, 30).filter((x) => dayOf(x, r.tz) === dayOf(ms, r.tz))[0] === ms;

async function skipMeeting(r: Row, sendMs: number) {
  const [e] = await db.select({ skip: E.skip }).from(E).where(eq(E.id, r.eventId!));
  if (e) await db.update(E).set({ skip: [...new Set([...e.skip, meetingStart(sendMs, r.tz, r.meeting!)])], updatedAt: new Date() }).where(eq(E.id, r.eventId!));
}

/**
 * One repeating event mirrors the schedule's meetings: same days, the meeting's
 * time, skipped dates left out, ending when the emails end. Paused: it goes
 * (resuming puts it back); no meeting (or not wanted in the calendar): none.
 */
async function syncEvent(r: Row): Promise<Row> {
  const m = r.meeting;
  const want = !!m?.addToCalendar && r.status !== "paused";
  if (!want) {
    if (r.eventId) await db.delete(E).where(eq(E.id, r.eventId));
    if (!r.eventId) return r;
    const [u] = await db.update(S).set({ eventId: null }).where(eq(S.id, r.id)).returning();
    return u!;
  }
  const t = timing(r);
  // From the schedule's first day (so past meetings stay in the calendar).
  const first = upcoming(t, Date.parse(`${r.startDate}T00:00:00Z`) - 36 * HOUR, 1)[0];
  if (!first) return r;
  const firstTime = r.times[0]!;
  const start = meetingStart(first, r.tz, m.at ? m : { at: firstTime });
  // The end: the schedule's end date; or the day the last allowed email goes; or, once it's ended, the last one sent.
  let until = r.repeat.until;
  if (r.limit !== null) {
    const all = upcoming(t, first - 1, r.limit);
    if (all.length === r.limit) until = dayOf(all.at(-1)!, r.tz);
  }
  if (r.status === "ended") until = dayOf(r.lastRunAt?.getTime() ?? first, r.tz);
  const calendarId = m.calendarId ? ((await db.select({ id: schema.calCalendars.id }).from(schema.calCalendars).where(and(eq(schema.calCalendars.id, m.calendarId), eq(schema.calCalendars.ownerId, r.createdBy))))[0]?.id ?? null) : null;
  const values = {
    calendarId: calendarId ?? (await defaultCalendar(r.orgId, r.createdBy)).id,
    title: (plainTitle(m.title) || plainTitle(r.subject) || r.name || "Meeting").slice(0, 200),
    description: `Set up with a recurring email in Cloudesk Mail: “${r.subject}”.`,
    meetingUrl: m.link, meetingProvider: m.link ? (findMeetingLink(m.link)?.provider ?? "other") : null,
    startsAt: new Date(start), endsAt: new Date(start + m.durationMin * MIN), allDay: false, tz: r.tz,
    repeat: { ...r.repeat, count: null, until }, skip: r.skipDates.map((d) => meetingStart(Date.parse(`${d}T12:00:00Z`), r.tz, { at: m.at ?? firstTime })),
    attendees: [...r.to, ...r.cc].map((email) => ({ name: "", email })), reminders: m.reminders, status: "confirmed", source: "mail", mailAccountId: r.accountId, updatedAt: new Date(),
  };
  if (r.eventId) {
    const [old] = await db.select({ skip: E.skip }).from(E).where(eq(E.id, r.eventId));
    if (old) {
      // Keep meetings skipped one at a time ("skip next").
      await db.update(E).set({ ...values, skip: [...new Set([...values.skip, ...old.skip])] }).where(eq(E.id, r.eventId));
      return r;
    }
  }
  const eid = crypto.randomUUID();
  await db.insert(E).values({ id: eid, orgId: r.orgId, ownerId: r.createdBy, uid: `${r.id}@cloudesk`, ...values });
  const [u] = await db.update(S).set({ eventId: eid }).where(eq(S.id, r.id)).returning();
  return u!;
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function stop(r: Row, status: "paused" | "ended", note: string, tell = true) {
  const [u] = await db.update(S).set({ status, statusNote: note, ...(status === "ended" ? { nextRunAt: null } : {}), updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
  if (u) await syncEvent(u).catch(() => {});
  if (tell) await notify(r.orgId, [r.createdBy], { kind: "mail.recurring", title: `${status === "ended" ? "Finished" : "Paused"}: ${label(r)}`, body: note, link: link(r.id), values: { name: label(r), what: note, link: link(r.id) } });
}

/**
 * Someone wrote back in one of its conversations. Those conversations began with
 * its own emails, so anything incoming there is a reply (a few minutes' slack:
 * a Date header only has whole seconds, and clocks differ).
 */
async function replyFrom(r: Row) {
  const rows = (await db.execute(sql`
    select m.from_name, m.from_address from mail_messages m
    where m.thread_id in (select thread_id from mail_schedule_runs where schedule_id = ${r.id} and thread_id is not null)
      and m.direction = 'in' and m.date > ${new Date(r.createdAt.getTime() - 5 * MIN)} order by m.date limit 1`)).rows as { from_name: string; from_address: string }[];
  return rows[0] ? rows[0].from_name || rows[0].from_address : null;
}

/** One send: the email (and its meeting invite) as the schedule's owner, recorded on the run. */
async function deliver(r: Row, runId: string, planned: number, manual: boolean) {
  const fail = async (note: string) => {
    await db.update(R).set({ status: "failed", note }).where(eq(R.id, runId));
    const [u] = await db.update(S).set({ failStreak: sql`${S.failStreak} + 1`, updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
    if (u && u.failStreak >= 3) await stop(u, "paused", `Paused after 3 failed sends in a row — last: ${note}`);
    else await notify(r.orgId, [r.createdBy], { kind: "mail.recurring", title: `Couldn't send: ${label(r)}`, body: note, link: link(r.id), values: { name: label(r), what: note, link: link(r.id) } });
    return { sent: false as const, note };
  };
  const s = await scopeFor(r.orgId, r.createdBy);
  if (!s) {
    await db.update(R).set({ status: "skipped", note: "Its owner no longer has Mail here" }).where(eq(R.id, runId));
    await stop(r, "paused", "Paused: whoever set it up no longer has Mail in this workspace", false);
    return { sent: false as const, note: "No access" };
  }
  const acc = await account(s, r.accountId).catch(() => null);
  if (!acc) {
    await db.update(R).set({ status: "skipped", note: "The mailbox isn't available" }).where(eq(R.id, runId));
    await stop(r, "paused", "Paused: its mailbox isn't available any more");
    return { sent: false as const, note: "No mailbox" };
  }
  if (acc.status === "paused") return fail("The mailbox is paused");
  const n = r.sentCount + 1;
  const m = r.meeting;
  const meetingAt = m ? meetingStart(planned, r.tz, m.at ? m : { at: r.times[0]! }) : null;
  const meetingToday = !!m && (manual || dayHasMeeting(r, planned));
  const fillV = { at: planned, tz: r.tz, n, meetingLink: m?.link ?? "", meetingAt };
  const subject = fillRun(r.subject, fillV);
  let body = fillRun(r.body, fillV);
  if (m && meetingToday && m.details && meetingAt) {
    const when = fmtWhen(meetingAt, meetingAt + m.durationMin * MIN, r.tz);
    body = `${body.trimEnd()}\n\n${[m.title ? fillRun(m.title, fillV) : subject, `When: ${when}`, m.link && !body.includes(m.link) ? `Join: ${m.link}` : ""].filter(Boolean).join("\n")}`;
  }
  const files = await db.select().from(F).where(eq(F.scheduleId, r.id));
  const recipients = [...r.to, ...r.cc];
  const ical = m && meetingToday && m.invite && meetingAt && recipients.length
    ? { method: "REQUEST" as const, content: buildIcs({ method: "REQUEST", uid: `${r.id}.${dayOf(meetingAt, r.tz)}@cloudesk`, summary: m.title ? fillRun(m.title, fillV) : subject, description: [m.link && `Join: ${m.link}`].filter(Boolean).join("\n"), location: m.link ? "Online" : "", url: m.link || undefined, start: meetingAt, end: meetingAt + m.durationMin * MIN, organizer: { name: acc.displayName || s.userName, email: acc.address }, attendees: recipients.map((email) => ({ name: "", email })) }) }
    : undefined;
  // "Same conversation": a reply to the last one sent, if it's still there.
  let thread: { threadId: string; replyTo: string } | null = null;
  if (r.options.thread === "same" && r.threadId && r.lastMessageId) {
    const [t] = await db.select({ id: schema.mailMessages.id }).from(schema.mailMessages).where(and(eq(schema.mailMessages.id, r.lastMessageId), eq(schema.mailMessages.threadId, r.threadId)));
    if (t) thread = { threadId: r.threadId, replyTo: r.lastMessageId };
  }
  try {
    const sent = await send(s, {
      accountId: acc.id, ...(thread ? { threadId: thread.threadId, replyTo: thread.replyTo, mode: "reply" } : { mode: "new" }),
      to: r.to, cc: r.cc, bcc: r.bcc, groupIds: r.groupIds, separately: r.separately && !thread, subject, body,
      ...(r.signature === "" ? {} : { signatureId: r.signature === "none" ? null : r.signature }),
      attachments: files.map((f) => ({ filename: f.filename, mime: f.mime, data: f.data.toString("base64") })),
    }, ical ? { ical } : {});
    await db.update(R).set({ status: "sent", n, messageId: sent.message.id, threadId: sent.message.threadId, recipients: r.separately && !thread ? (sent.count ?? 1) : recipients.length + r.bcc.length, note: manual ? `Sent now by request` : "" }).where(eq(R.id, runId));
    const [u] = await db.update(S).set({ sentCount: sql`${S.sentCount} + 1`, failStreak: 0, lastRunAt: new Date(), lastMessageId: sent.message.id, ...(r.options.thread === "same" && !thread ? { threadId: sent.message.threadId } : {}), updatedAt: new Date() }).where(eq(S.id, r.id)).returning();
    if (r.options.notifyEach) await notify(r.orgId, [r.createdBy], { kind: "mail.recurring", title: `Sent: ${label(r)} (#${n})`, body: subject, link: `/mail/t/${sent.message.threadId}`, values: { name: label(r), what: `Email #${n} went out`, link: `/mail/t/${sent.message.threadId}` } });
    if (u && u.limit !== null && u.sentCount >= u.limit) await stop(u, "ended", `All ${u.limit} emails sent`);
    return { sent: true as const, note: "" };
  } catch (e) {
    return fail(e instanceof ApiError ? e.message : (e as Error).message || "Couldn't send");
  }
}

/** Every minute (worker): sends what's due. */
export async function mailScheduleTick(now = Date.now()) {
  const due = await db.select().from(S).where(and(eq(S.status, "active"), isNotNull(S.nextRunAt), lte(S.nextRunAt, new Date(now)))).orderBy(asc(S.nextRunAt)).limit(100);
  let sent = 0;
  for (const r of due) {
    const planned = r.nextRunAt!;
    try {
      // Claim it: move the next send on, only if nobody else already did.
      const after = nextSend(timing(r), planned.getTime(), 0, null);
      const [claimed] = await db.update(S).set({ nextRunAt: after ? new Date(after) : null }).where(and(eq(S.id, r.id), eq(S.status, "active"), eq(S.nextRunAt, planned))).returning();
      if (!claimed) continue;
      const [run] = await db.insert(R).values({ scheduleId: r.id, orgId: r.orgId, plannedFor: planned, status: "pending" }).onConflictDoNothing().returning();
      if (run) {
        const late = now - planned.getTime();
        const who = claimed.options.stopOnReply ? await replyFrom(claimed) : null;
        if (who) {
          await db.update(R).set({ status: "skipped", note: `${who} replied` }).where(eq(R.id, run.id));
          await stop(claimed, "ended", `Stopped: ${who} replied`);
          continue;
        }
        if (late > TOO_LATE || (claimed.options.missed === "skip" && late > GRACE)) {
          await db.update(R).set({ status: "skipped", note: "Missed while Cloudesk was offline" }).where(eq(R.id, run.id));
        } else if ((await deliver(claimed, run.id, planned.getTime(), false)).sent) sent++;
      }
      const [now2] = await db.select().from(S).where(eq(S.id, r.id));
      if (now2?.status === "active" && !now2.nextRunAt) await stop(now2, "ended", `Finished — ${now2.sentCount} sent`);
    } catch (e) {
      log.warn("mail_schedule_failed", { scheduleId: r.id, error: (e as Error).message });
    }
  }
  return sent;
}
