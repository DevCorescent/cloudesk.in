// Recurring emails: the same email sent on a schedule — every day, on
// weekdays, on chosen days every N weeks, monthly or yearly — at one or more
// times of day in a time zone, with skipped dates, an end, and (when it's
// about a meeting) the meeting kept in your calendar. Shared by server and
// browser, so the editor previews exactly the dates the server will send on.
import { z } from "zod";
import { describeRepeat, occurrences, repeatSchema, type Repeat } from "@/lib/calendar/recur";
import { partsIn, zonedToUtc } from "@/lib/calendar/tz";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-02");
const email = z.string().trim().toLowerCase().pipe(z.email("Check the email addresses"));
const DAY = 86_400_000;

export const meetingSchema = z.object({
  title: z.string().trim().max(200).default(""),
  /** When the meeting starts on each day the email goes: "HH:MM", or null for the moment it's sent. */
  at: hhmm.nullable().default(null),
  durationMin: z.number().int().min(5).max(720).default(30),
  /** The join link (https). Empty with makeLink: a video room is made for it. */
  link: z.string().trim().max(500).regex(/^(https:\/\/\S+)?$/, "Use an https:// link").default(""),
  makeLink: z.boolean().default(false),
  /** Keep the meetings in your calendar (one repeating event, kept in step with the schedule). */
  addToCalendar: z.boolean().default(true),
  calendarId: z.uuid().nullable().default(null),
  /** Attach a calendar invite to each email, so recipients can Accept and it lands in their calendar. */
  invite: z.boolean().default(true),
  /** Add the time and join link under the message. */
  details: z.boolean().default(true),
  reminders: z.array(z.number().int().min(0).max(10080)).max(8).default([10, 0]),
});
export type MeetingIn = z.infer<typeof meetingSchema>;

export const scheduleSchema = z
  .object({
    name: z.string().trim().max(120).default(""),
    accountId: z.uuid(),
    to: z.array(email).max(100).default([]),
    cc: z.array(email).max(100).default([]),
    bcc: z.array(email).max(100).default([]),
    groupIds: z.array(z.uuid()).max(20).default([]),
    /** One email per To recipient, each personalised, nobody seeing the others. */
    separately: z.boolean().default(false),
    subject: z.string().trim().min(1, "Add a subject").max(500),
    body: z.string().max(200_000).default(""),
    /** A signature id, null for none; left out: the mailbox's default. */
    signatureId: z.uuid().nullable().optional(),
    startDate: ymd,
    /** Times of day it goes out (up to 6), in `tz`. */
    times: z.array(hhmm).min(1, "Pick a time").max(6, "Up to 6 times a day"),
    tz: z.string().trim().min(1).max(64).default("Asia/Kolkata"),
    repeat: repeatSchema,
    /** Days it doesn't go (holidays). */
    skipDates: z.array(ymd).max(366).default([]),
    /** Stop after this many emails (null: no limit). */
    limit: z.number().int().min(1).max(1000).nullable().default(null),
    /** "new": a fresh email each time; "same": each one replies in the first one's conversation. */
    thread: z.enum(["new", "same"]).default("new"),
    /** Stop as soon as anyone replies. */
    stopOnReply: z.boolean().default(false),
    /** A send missed while the system was down: send it late (up to 12 hours), or skip it. */
    missed: z.enum(["send", "skip"]).default("send"),
    /** Tell me each time one goes out (failures always tell you). */
    notifyEach: z.boolean().default(false),
    meeting: meetingSchema.nullable().default(null),
    /** New attachments (base64); keepFiles: ids of ones already saved that stay. */
    attachments: z.array(z.object({ filename: z.string().trim().min(1).max(200), mime: z.string().trim().max(200).default("application/octet-stream"), data: z.string() })).max(10).default([]),
    keepFiles: z.array(z.uuid()).max(10).default([]),
  })
  .refine((v) => v.to.length + v.cc.length + v.bcc.length + v.groupIds.length > 0, { message: "Add at least one recipient", path: ["to"] })
  .refine((v) => !v.repeat.until || v.repeat.until >= v.startDate, { message: "It ends before it starts", path: ["repeat"] })
  .refine((v) => new Set(v.times).size === v.times.length, { message: "Each time only once", path: ["times"] });
export type ScheduleIn = z.input<typeof scheduleSchema>;
export type ScheduleData = z.infer<typeof scheduleSchema>;

export type Timing = { startDate: string; times: string[]; tz: string; repeat: Repeat; skipDates: string[] };

const at = (date: string, time: string, tz: string) => zonedToUtc({ y: +date.slice(0, 4), m: +date.slice(5, 7), d: +date.slice(8, 10), h: +time.slice(0, 2), mi: +time.slice(3, 5), s: 0 }, tz);

/**
 * The send times after `after` (ms, exclusive), soonest first, at most `max`.
 * Ends (until) and skipped dates apply; a count limit is the caller's (it counts emails actually sent).
 */
export function upcoming(t: Timing, after: number, max = 10): number[] {
  const horizon = after + 6 * 366 * DAY;
  const repeat = { ...t.repeat, count: null };
  const all = t.times.flatMap((time) => occurrences(at(t.startDate, time, t.tz), 1, t.tz, repeat, after + 1, horizon, t.skipDates.map((d) => at(d, time, t.tz))).slice(0, max));
  return [...new Set(all)].sort((a, b) => a - b).slice(0, max);
}

/** The next send after `after`, or null when the schedule has run its course. */
export function nextSend(t: Timing, after: number, sent = 0, limit: number | null = null): number | null {
  if (limit !== null && sent >= limit) return null;
  return upcoming(t, after, 1)[0] ?? null;
}

/** The calendar day (YYYY-MM-DD) of a moment in a zone. */
export function dayOf(ms: number, tz: string) {
  const p = partsIn(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** When that day's meeting starts: at its own time that day, or as the email goes. */
export function meetingStart(sendMs: number, tz: string, m: Pick<MeetingIn, "at">) {
  return m.at ? at(dayOf(sendMs, tz), m.at, tz) : sendMs;
}

const fmt = (ms: number, tz: string, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString("en-IN", { ...o, timeZone: tz });
export const timeLabel = (hm: string) => {
  const h = +hm.slice(0, 2);
  return `${h % 12 || 12}:${hm.slice(3)} ${h < 12 ? "am" : "pm"}`;
};

/**
 * Fills the schedule's own placeholders for one send: {{date}}, {{day}}, {{time}},
 * {{month}}, {{year}}, {{n}} (which email this is), {{meeting_link}}, {{meeting_time}}.
 * Contact placeholders ({{first_name}}…) are filled per recipient when it's sent.
 */
export function fillRun(text: string, v: { at: number; tz: string; n: number; meetingLink?: string; meetingAt?: number | null }) {
  const values: Record<string, string> = {
    date: fmt(v.at, v.tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    day: fmt(v.at, v.tz, { weekday: "long" }),
    time: fmt(v.at, v.tz, { hour: "numeric", minute: "2-digit" }),
    month: fmt(v.at, v.tz, { month: "long" }),
    year: fmt(v.at, v.tz, { year: "numeric" }),
    n: String(v.n),
    meeting_link: v.meetingLink ?? "",
    meeting_time: v.meetingAt ? fmt(v.meetingAt, v.tz, { hour: "numeric", minute: "2-digit" }) : "",
  };
  return text.replace(/\{\{\s*(date|day|time|month|year|n|meeting_link|meeting_time)\s*\}\}/g, (_m, k: string) => values[k] ?? "");
}

/** A title without its placeholders, for things that don't change each time (the calendar series): "Stand-up — {{date}}" → "Stand-up". */
export const plainTitle = (s: string) => s.replace(/\{\{[^}]*\}\}/g, "").replace(/[\s—–\-:|,·#(]+$/u, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();

export const RUN_PLACEHOLDERS = ["{{date}}", "{{day}}", "{{time}}", "{{n}}", "{{month}}", "{{meeting_link}}", "{{meeting_time}}"] as const;

/** "Every weekday at 9:00 am and 5:30 pm, 20 emails" */
export function describeSchedule(v: { times: string[]; repeat: Repeat; limit: number | null; skipDates?: string[] }) {
  const base = describeRepeat({ ...v.repeat, count: null });
  const times = v.times.map(timeLabel);
  const when = times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0];
  return [`${base} at ${when}`, v.limit ? `${v.limit} email${v.limit === 1 ? "" : "s"} in all` : "", v.skipDates?.length ? `${v.skipDates.length} day${v.skipDates.length === 1 ? "" : "s"} skipped` : ""].filter(Boolean).join(" · ");
}

/** Quick picks for the repeat (the editor can still set any rule). */
export const REPEAT_PRESETS: { id: string; label: string; repeat: Repeat }[] = [
  { id: "daily", label: "Every day", repeat: { freq: "daily", interval: 1, byDay: [], until: null, count: null } },
  { id: "weekdays", label: "Every weekday (Mon–Fri)", repeat: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null } },
  { id: "weekly", label: "Every week", repeat: { freq: "weekly", interval: 1, byDay: [], until: null, count: null } },
  { id: "fortnightly", label: "Every 2 weeks", repeat: { freq: "weekly", interval: 2, byDay: [], until: null, count: null } },
  { id: "monthly", label: "Every month", repeat: { freq: "monthly", interval: 1, byDay: [], until: null, count: null } },
  { id: "yearly", label: "Every year", repeat: { freq: "yearly", interval: 1, byDay: [], until: null, count: null } },
];
