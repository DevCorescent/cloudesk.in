// Finding meetings in mail that's already here: mail synced before Calendar
// was on (or before the meeting finder last improved) is read again — the
// stored invite files, links and text — so its meetings show up too. Runs
// once per mailbox automatically (and again when the finder's version goes
// up), and on demand from Calendar or Mail. Upcoming invites are added to the
// owner's calendar like new ones; one summary notification, not one per meeting.
import { and, asc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { defineJob } from "../jobs/queue";
import { notify } from "../notify/notify";
import { MEETING_SCAN_VERSION, meetingIn, type MailMeeting } from "../mail/sync";
import { onMailMeeting } from "./from-mail";

const M = schema.mailMessages;
const T = schema.mailThreads;
const F = schema.mailAttachments;
const A = schema.mailAccounts;

export async function scanAccountMeetings(accountId: string, days = 120): Promise<{ scanned: number; found: number; added: number }> {
  const [acc] = await db.select().from(A).where(eq(A.id, accountId));
  if (!acc) return { scanned: 0, found: 0, added: 0 };
  const rows = await db
    .select({ id: M.id, threadId: M.threadId, subject: M.subject, text: M.text, html: M.html, date: M.date, fromAddress: M.fromAddress, fromName: M.fromName, list: M.listUnsubscribe })
    .from(M)
    .where(and(eq(M.accountId, acc.id), eq(M.direction, "in"), isNull(M.meeting), gte(M.date, new Date(Date.now() - days * 86_400_000))))
    .orderBy(asc(M.date))
    .limit(3000);
  let found = 0;
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const files = await db
      .select({ messageId: F.messageId, mime: F.mime, filename: F.filename, data: F.data })
      .from(F)
      .where(and(inArray(F.messageId, chunk.map((r) => r.id)), or(ilike(F.mime, "text/calendar%"), ilike(F.mime, "application/ics%"), ilike(F.mime, "text/x-vcalendar%"), ilike(F.filename, "%.ics"))));
    for (const r of chunk) {
      const g = meetingIn({
        files: files.filter((f) => f.messageId === r.id).map((f) => ({ contentType: f.mime, filename: f.filename, content: f.data })),
        subject: r.subject, text: r.text, html: r.html, date: r.date, from: { name: r.fromName, address: r.fromAddress }, list: !!r.list,
      });
      if (!g) continue;
      found++;
      await db.update(M).set({ meeting: g }).where(eq(M.id, r.id));
      if (typeof g.start === "number") await db.update(T).set({ meetingAt: new Date(g.start) }).where(eq(T.id, r.threadId));
      if ((await onMailMeeting(acc, r.threadId, r.id, g, { quiet: true })) === "added") added++;
    }
  }
  // Meetings already found but not in the calendar yet: link repeats of one already there, add invites that were missed.
  const loose = await db
    .select({ id: M.id, threadId: M.threadId, meeting: M.meeting })
    .from(M)
    .innerJoin(T, eq(T.id, M.threadId))
    .where(and(eq(M.accountId, acc.id), isNotNull(M.meeting), isNull(T.meetingEventId), gte(M.date, new Date(Date.now() - days * 86_400_000))))
    .orderBy(asc(M.date))
    .limit(500);
  for (const r of loose) if ((await onMailMeeting(acc, r.threadId, r.id, r.meeting as MailMeeting, { quiet: true })) === "added") added++;

  // Merged into the settings in the database, so a change made meanwhile isn't lost.
  await db.update(A).set({ settings: sql`${A.settings} || ${JSON.stringify({ meetingScan: MEETING_SCAN_VERSION })}::jsonb` }).where(eq(A.id, acc.id));
  if (added > 0) {
    await notify(acc.orgId, [acc.ownerId], { kind: "calendar.added", title: `${added} ${added === 1 ? "meeting" : "meetings"} from your email added to your calendar`, body: `Found in ${acc.address}, with their links and reminders.`, link: "/calendar", values: { title: `${added} meetings`, link: "/calendar" } });
  }
  return { scanned: rows.length, found, added };
}

/** On demand: every mailbox this person can use (Calendar → "Find meetings in my email"). */
export async function scanMine(orgId: string, userId: string) {
  const accts = await db.select({ id: A.id }).from(A).where(and(eq(A.orgId, orgId), or(eq(A.ownerId, userId), sql`exists (select 1 from mail_account_members m where m.account_id = ${A.id} and m.user_id = ${userId})`)));
  const total = { mailboxes: accts.length, scanned: 0, found: 0, added: 0 };
  for (const a of accts) {
    const r = await scanAccountMeetings(a.id);
    total.scanned += r.scanned;
    total.found += r.found;
    total.added += r.added;
  }
  return total;
}

defineJob<{ accountId: string }>("mail.meetings.scan", async ({ accountId }) => scanAccountMeetings(accountId), { timeoutMs: 5 * 60_000 });
