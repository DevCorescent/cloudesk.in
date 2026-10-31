// Minutes of meeting (MOM): written after a meeting, per occurrence, and
// shared by email — to the person who sent the invite and anyone else — from
// your mailbox, as a reply in the original invite's conversation when there
// is one. The email carries the minutes as a clean table and as plain text.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { NotesOut } from "@/lib/calendar/api";
import { fmtWhen } from "@/lib/calendar/format";
import { minutesHtml, minutesText, notesSchema, type Notes } from "@/lib/calendar/model";
import { providerName } from "@/lib/calendar/detect";
import { ApiError, notFound } from "../http/errors";
import type { Scope as MailScope } from "../mail/access";
import { send } from "../mail/send";
import { check, ownEvent, type CalScope } from "./access";
import { occurrencesOf } from "./core";

const N = schema.calNotes;

async function occurrenceOf(s: CalScope, eventId: string, occurrence: string) {
  const e = await ownEvent(s, eventId);
  const occ = Date.parse(occurrence);
  if (!Number.isFinite(occ)) throw new ApiError("validation_failed", "Which meeting?");
  const len = e.endsAt.getTime() - e.startsAt.getTime();
  if (!occurrencesOf(e, occ, occ + 1).includes(occ) && occ !== e.startsAt.getTime()) throw notFound("Meeting");
  return { e, occ, end: occ + len };
}

export async function getNotes(s: CalScope, q: Record<string, string>): Promise<NotesOut> {
  const { e, occ, end } = await occurrenceOf(s, q.event ?? "", q.occurrence ?? "");
  const [n] = await db.select().from(N).where(and(eq(N.eventId, e.id), eq(N.occurrence, new Date(occ))));
  // A fresh set of minutes starts with everyone invited marked present.
  const fields = n ? notesSchema.parse(n.fields) : notesSchema.parse({ present: [...new Set([s.userName, ...(e.organizer ? [e.organizer.name || e.organizer.email] : []), ...e.attendees.map((a) => a.name || a.email)])].filter(Boolean) });
  return {
    id: n?.id ?? null, eventId: e.id, occurrence: new Date(occ).toISOString(), fields, sharedAt: n?.sharedAt?.toISOString() ?? null, sharedTo: n?.sharedTo ?? [],
    event: { title: e.title, start: new Date(occ).toISOString(), end: new Date(end).toISOString(), tz: e.tz, allDay: e.allDay, organizer: e.organizer, attendees: e.attendees, meetingUrl: e.meetingUrl, location: e.location, mailAccountId: e.mailAccountId, mailThreadId: e.mailThreadId },
  };
}

const saveSchema = z.object({ event: z.uuid(), occurrence: z.iso.datetime({ offset: true }), fields: notesSchema });

export async function saveNotes(s: CalScope, raw: unknown) {
  const v = check(saveSchema, raw);
  const { e, occ } = await occurrenceOf(s, v.event, v.occurrence);
  await db
    .insert(N)
    .values({ orgId: s.orgId, eventId: e.id, occurrence: new Date(occ), ownerId: s.userId, fields: v.fields })
    .onConflictDoUpdate({ target: [N.eventId, N.occurrence], set: { fields: v.fields, updatedAt: new Date() } });
  return getNotes(s, { event: e.id, occurrence: new Date(occ).toISOString() });
}

/** "No minutes needed" for one meeting: it leaves the to-write list. */
export async function skipNotes(s: CalScope, raw: unknown) {
  const v = check(z.object({ event: z.uuid(), occurrence: z.iso.datetime({ offset: true }) }), raw);
  const { e, occ } = await occurrenceOf(s, v.event, v.occurrence);
  await db.insert(schema.calRemindersSent).values({ eventId: e.id, occurrence: new Date(occ), offset: -2 }).onConflictDoNothing();
  return { ok: true };
}

const email = z.string().trim().toLowerCase().pipe(z.email("Check the email addresses"));
const shareSchema = z.object({
  event: z.uuid(),
  occurrence: z.iso.datetime({ offset: true }),
  accountId: z.uuid(),
  to: z.array(email).min(1, "Who should get the minutes?").max(100),
  cc: z.array(email).max(100).default([]),
  message: z.string().max(5000).default(""),
  signatureId: z.uuid().nullable().optional(),
});

export async function shareNotes(s: CalScope, raw: unknown, mail: MailScope | null) {
  if (!mail) throw new ApiError("forbidden", "Sharing minutes needs Mail switched on");
  const v = check(shareSchema, raw);
  const { e, occ, end } = await occurrenceOf(s, v.event, v.occurrence);
  const [n] = await db.select().from(N).where(and(eq(N.eventId, e.id), eq(N.occurrence, new Date(occ))));
  if (!n) throw new ApiError("conflict", "Save the minutes first");
  const fields: Notes = notesSchema.parse(n.fields);
  const when = fmtWhen(occ, end, e.tz, e.allDay);
  const meta = { title: e.title, when, organizer: e.organizer ? e.organizer.name || e.organizer.email : s.userName, where: e.location || (e.meetingUrl ? providerName(e.meetingProvider) || "Online" : "") };
  const intro = v.message.trim() || `Hi all,\n\nHere are the minutes from "${e.title}".`;
  // In the invite's conversation when we have it, so it stays together.
  const [m] = e.mailMessageId ? await db.select({ id: schema.mailMessages.id, accountId: schema.mailMessages.accountId }).from(schema.mailMessages).where(eq(schema.mailMessages.id, e.mailMessageId)) : [];
  const reply = m && m.accountId === v.accountId ? { replyTo: m.id, mode: "reply" as const } : {};
  const datePart = new Date(occ).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: e.tz });
  await send(
    mail,
    { accountId: v.accountId, ...reply, to: v.to, cc: v.cc, subject: `Minutes: ${e.title} — ${datePart}`, body: minutesText(meta, fields, intro), signatureId: v.signatureId },
    { html: minutesHtml(meta, fields, "#2563eb", intro) },
  );
  const sharedTo = [...new Set([...n.sharedTo, ...v.to, ...v.cc])];
  await db.update(N).set({ sharedAt: new Date(), sharedTo }).where(eq(N.id, n.id));
  return { ok: true, sharedTo };
}
