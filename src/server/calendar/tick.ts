// The calendar's clock (every minute, in the worker): reminders before each
// meeting — by default the day before, 3 hours, 1 hour, 10 minutes and as it
// starts, so it's never missed — as dashboard notifications with the join
// link; then, once a meeting with other people is over (not a quick
// stand-up), one nudge to write the minutes. Each
// reminder is recorded, so none is sent twice, and late ones are skipped
// rather than sent hours after they mattered.
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtUntil, fmtWhen } from "@/lib/calendar/format";
import { providerName } from "@/lib/calendar/detect";
import { log } from "../log";
import { notify } from "../notify/notify";
import { occurrencesOf, wantsMinutes } from "./core";

const E = schema.calEvents;
const R = schema.calRemindersSent;
const MIN = 60_000;
/** A reminder later than this isn't worth sending (the next one will do). */
const GRACE = 20 * MIN;

/** Records a reminder; false if it was already sent. */
async function claim(eventId: string, occ: number, offset: number) {
  const r = await db.insert(R).values({ eventId, occurrence: new Date(occ), offset }).onConflictDoNothing().returning({ eventId: R.eventId });
  return r.length > 0;
}

export async function calendarTick(now = Date.now()) {
  const horizon = now + 7 * 1440 * MIN + MIN;
  const events = await db
    .select()
    .from(E)
    .where(and(sql`${E.status} <> 'cancelled'`, sql`coalesce(${E.response}, '') <> 'declined'`, lte(E.startsAt, new Date(horizon)), or(isNotNull(E.repeat), gte(E.endsAt, new Date(now - 2 * 1440 * MIN)))));
  let sent = 0;
  for (const e of events) {
    try {
      const len = e.endsAt.getTime() - e.startsAt.getTime();
      const link = (occ: number) => `/calendar?event=${e.id}&at=${new Date(occ).toISOString()}`;
      for (const occ of occurrencesOf(e, now - 2 * 1440 * MIN, horizon)) {
        // Before it starts (and as it starts).
        if (!e.allDay) {
          for (const offset of e.reminders) {
            const due = occ - offset * MIN;
            if (due > now || now - due > GRACE || now > occ + (offset === 0 ? 15 * MIN : 0)) continue;
            if (!(await claim(e.id, occ, offset))) continue;
            const join = e.meetingUrl ? ` Join on ${providerName(e.meetingProvider) || "the call"}: ${e.meetingUrl}` : e.location ? ` At ${e.location}.` : "";
            await notify(e.orgId, [e.ownerId], {
              kind: "calendar.reminder",
              title: offset === 0 ? `Starting now: ${e.title}` : `${e.title} — ${fmtUntil(occ, now, e.tz)}`,
              body: `${fmtWhen(occ, occ + len, e.tz)}.${join}`,
              link: link(occ),
              values: { title: e.title, when: fmtWhen(occ, occ + len, e.tz), join: e.meetingUrl, link: link(occ) },
            });
            sent++;
          }
        }
        // After it ends: ask for the minutes, once (meetings with other people, not quick stand-ups).
        const end = occ + len;
        if (wantsMinutes(e) && end <= now && now - end < 2 * 1440 * MIN) {
          const [has] = await db.select({ id: schema.calNotes.id }).from(schema.calNotes).where(and(eq(schema.calNotes.eventId, e.id), eq(schema.calNotes.occurrence, new Date(occ))));
          if (has || !(await claim(e.id, occ, -1))) continue;
          await notify(e.orgId, [e.ownerId], {
            kind: "calendar.notes",
            title: `How did "${e.title}" go? Add the minutes`,
            body: e.organizer ? `Note what was decided and the action items, then share them with ${e.organizer.name || e.organizer.email} and the others.` : "Note what was decided and the action items, then share them with everyone by email.",
            link: `${link(occ)}&notes=1`,
            values: { title: e.title, link: `${link(occ)}&notes=1` },
          });
          sent++;
        }
      }
    } catch (err) {
      log.warn("calendar_tick_event_failed", { eventId: e.id, error: String(err) });
    }
  }
  return { sent };
}
