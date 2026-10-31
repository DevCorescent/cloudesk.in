// When an email with a meeting arrives (or is found in mail already here):
// - the same meeting (invite UID) already in a calendar: an update moves it,
//   a cancellation crosses it out — and the owner is told;
// - a new invite with its calendar file: added to the mailbox owner's calendar
//   straight away, with its link and reminders (unless they've turned that off
//   for the mailbox — then it waits, and they're told it's there);
// - a meeting link with a time read from the wording: never added on a guess —
//   the owner is told, to check the time and add it in one click.
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtWhen } from "@/lib/calendar/format";
import type { Account } from "../mail/access";
import type { MailMeeting } from "../mail/sync";
import { notify } from "../notify/notify";
import { defaultCalendar } from "./access";
import { eventFromMeeting } from "./core";

const E = schema.calEvents;

/** Added to the calendar, updated an existing event, only found (waiting to be added), or nothing to do. */
export type MeetingOutcome = "added" | "updated" | "found" | null;

/** Invites go straight into the calendar unless the mailbox owner turned it off. */
export const autoAdds = (acc: Pick<Account, "settings">) => (acc.settings as { autoAddMeetings?: boolean }).autoAddMeetings !== false;

export async function onMailMeeting(acc: Account, threadId: string, messageId: string, g: MailMeeting, opts: { quiet?: boolean } = {}): Promise<MeetingOutcome> {
  if (g.uid) {
    const existing = await db.select().from(E).where(and(eq(E.orgId, acc.orgId), eq(E.uid, g.uid)));
    let changed = false;
    for (const e of existing) {
      if (g.sequence < e.sequence) continue;
      if (g.cancelled) {
        if (e.status === "cancelled") continue;
        await db.update(E).set({ status: "cancelled", sequence: g.sequence, updatedAt: new Date() }).where(eq(E.id, e.id));
        changed = true;
        if (!opts.quiet) await notify(e.orgId, [e.ownerId], { kind: "calendar.changed", title: `Cancelled: ${e.title}`, body: `${g.organizer?.name || g.organizer?.address || "The organiser"} cancelled it. It's crossed out in your calendar.`, link: `/calendar?event=${e.id}`, values: { title: e.title, change: "cancelled", link: `/calendar?event=${e.id}` } });
        continue;
      }
      const moved = g.start !== null && (g.start !== e.startsAt.getTime() || (g.end ?? g.start) !== e.endsAt.getTime());
      const linkNew = !!g.url && g.url !== e.meetingUrl;
      if (!moved && g.title === e.title && !linkNew) continue;
      await db
        .update(E)
        .set({ ...(g.start !== null ? { startsAt: new Date(g.start), endsAt: new Date(g.end ?? g.start + 30 * 60_000) } : {}), title: g.title || e.title, sequence: g.sequence, status: "confirmed", ...(g.url ? { meetingUrl: g.url, meetingProvider: g.provider ?? "other" } : {}), updatedAt: new Date() })
        .where(eq(E.id, e.id));
      changed = true;
      if (moved) {
        await db.delete(schema.calRemindersSent).where(eq(schema.calRemindersSent.eventId, e.id));
        if (!opts.quiet) await notify(e.orgId, [e.ownerId], { kind: "calendar.changed", title: `Moved: ${g.title || e.title}`, body: `Now ${fmtWhen(g.start!, g.end ?? g.start! + 30 * 60_000, e.tz, g.allDay)}.`, link: `/calendar?event=${e.id}`, values: { title: g.title || e.title, change: "moved", link: `/calendar?event=${e.id}` } });
      }
    }
    if (existing.length) {
      await db.update(schema.mailThreads).set({ meetingEventId: existing[0]!.id }).where(eq(schema.mailThreads.id, threadId));
      return changed ? "updated" : null;
    }
  }
  if (g.cancelled) return null;
  // The same call mentioned again (a reply quoting the link): it's the meeting already in the calendar.
  if (g.url) {
    const near = g.start ?? Date.now();
    const [same] = await db.select({ id: E.id }).from(E).where(and(eq(E.orgId, acc.orgId), eq(E.ownerId, acc.ownerId), eq(E.meetingUrl, g.url), gte(E.endsAt, new Date(near - 12 * 3_600_000)), lte(E.startsAt, new Date(near + 12 * 3_600_000)))).limit(1);
    if (same) {
      await db.update(schema.mailThreads).set({ meetingEventId: same.id }).where(eq(schema.mailThreads.id, threadId));
      return null;
    }
  }
  const upcoming = g.start !== null && g.start > Date.now() - 60 * 60_000;
  // A real invite: straight in.
  if (g.source === "ics" && upcoming && autoAdds(acc)) {
    const cal = await defaultCalendar(acc.orgId, acc.ownerId);
    const e = await eventFromMeeting(acc.orgId, acc.ownerId, cal.id, g, { accountId: acc.id, threadId, messageId });
    if (!opts.quiet) await notify(acc.orgId, [acc.ownerId], { kind: "calendar.added", title: `Added to your calendar: ${e.title}`, body: `${fmtWhen(e.startsAt.getTime(), e.endsAt.getTime(), e.tz, e.allDay)}${e.meetingUrl ? " · with the join link" : ""}. Reminders are set.`, link: `/calendar?event=${e.id}`, values: { title: e.title, link: `/calendar?event=${e.id}` } });
    return "added";
  }
  // Otherwise it waits for a click — say so when it's coming up.
  if (!opts.quiet && (upcoming || g.start === null)) {
    const text = g.source === "text";
    await notify(acc.orgId, [acc.ownerId], {
      kind: "calendar.found",
      title: text ? `Meeting in your email: ${g.title}` : `Meeting invite: ${g.title}`,
      body: g.start !== null ? `${fmtWhen(g.start, g.end ?? g.start + 30 * 60_000, "Asia/Kolkata")}${text ? " — read from the email, check the time" : ""}. Add it to your calendar in one click.` : "We couldn't tell when it is — open it to pick the time and add it.",
      link: `/mail/t/${threadId}`,
      values: { title: g.title, link: `/mail/t/${threadId}` },
    });
  }
  return "found";
}
