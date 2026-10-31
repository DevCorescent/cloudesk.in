// Repeating events: daily, weekly (on chosen weekdays), monthly or yearly,
// every N, until a date or for a number of times. Repeats follow the event's
// own wall clock in its zone, so a 9:00 meeting stays at 9:00 across DST.
import { z } from "zod";
import { partsIn, zonedToUtc } from "./tz";

export const repeatSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(99).default(1),
  /** Weekdays for weekly repeats: 0 = Sunday … 6 = Saturday. */
  byDay: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Last day (YYYY-MM-DD, inclusive), or a count. */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  count: z.number().int().min(1).max(999).nullable().default(null),
});
export type Repeat = z.infer<typeof repeatSchema>;

const MAX = 1000;

/**
 * Start times (UTC ms) of the event's occurrences that overlap [from, to).
 * `duration` is the event's length; `skip` holds removed occurrences (their start ms).
 */
export function occurrences(start: number, duration: number, tz: string, r: Repeat | null, from: number, to: number, skip: number[] = []): number[] {
  if (!r) return start < to && start + duration > from ? [start] : [];
  const p = partsIn(start, tz);
  const untilMs = r.until ? zonedToUtc({ y: +r.until.slice(0, 4), m: +r.until.slice(5, 7), d: +r.until.slice(8, 10), h: 23, mi: 59, s: 59 }, tz) : Infinity;
  const out: number[] = [];
  const skipped = new Set(skip);
  let n = 0;
  const take = (y: number, m: number, d: number) => {
    // Months without that day (31 Feb) are skipped, as calendars do.
    const real = new Date(Date.UTC(y, m - 1, d));
    if (real.getUTCMonth() !== ((m - 1) % 12 + 12) % 12) return true;
    const ms = zonedToUtc({ y: real.getUTCFullYear(), m: real.getUTCMonth() + 1, d: real.getUTCDate(), h: p.h, mi: p.mi, s: p.s }, tz);
    if (ms < start) return true;
    if (ms > untilMs || (r.count && n >= r.count) || ms >= to) return false;
    n++;
    if (ms + duration > from && !skipped.has(ms)) out.push(ms);
    return out.length < MAX;
  };
  if (r.freq === "weekly") {
    const days = r.byDay.length ? [...r.byDay].sort() : [new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    // Weeks start on Sunday here; walk week by week from the event's week.
    const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    for (let w = 0; w < 5000; w += r.interval) {
      for (const day of days) {
        const d = new Date(Date.UTC(p.y, p.m - 1, p.d - dow + w * 7 + day));
        if (!take(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) return out;
      }
    }
    return out;
  }
  for (let i = 0; i < 20000; i += r.interval) {
    const ok =
      r.freq === "daily" ? take(p.y, p.m, p.d + i)
        : r.freq === "monthly" ? take(p.y + Math.floor((p.m - 1 + i) / 12), ((p.m - 1 + i) % 12) + 1, p.d)
          : take(p.y + i, p.m, p.d);
    if (!ok) break;
  }
  return out;
}

/** An RRULE from an invite, in our shape (what we can't express is dropped → null). */
export function fromRrule(rule: string): Repeat | null {
  const kv = Object.fromEntries(rule.split(";").map((x) => x.split("=") as [string, string]));
  const freq = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }[kv.FREQ ?? ""] as Repeat["freq"] | undefined;
  if (!freq) return null;
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const until = kv.UNTIL ? `${kv.UNTIL.slice(0, 4)}-${kv.UNTIL.slice(4, 6)}-${kv.UNTIL.slice(6, 8)}` : null;
  return repeatSchema.parse({ freq, interval: Number(kv.INTERVAL ?? 1) || 1, byDay: (kv.BYDAY ?? "").split(",").map((d) => codes.indexOf(d.replace(/^[+-]?\d+/, ""))).filter((x) => x >= 0), until, count: kv.COUNT ? Number(kv.COUNT) : null });
}

/** Our repeat as an RRULE (for invites we send). */
export function toRrule(r: Repeat | null): string {
  if (!r) return "";
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return [`FREQ=${r.freq.toUpperCase()}`, r.interval > 1 && `INTERVAL=${r.interval}`, r.freq === "weekly" && r.byDay.length && `BYDAY=${r.byDay.map((d) => codes[d]).join(",")}`, r.until && `UNTIL=${r.until.replace(/-/g, "")}T235959Z`, r.count && `COUNT=${r.count}`].filter(Boolean).join(";");
}

/** "Every weekday", "Every 2 weeks on Mon, Thu", "Monthly until 31 Dec 2026"… */
export function describeRepeat(r: Repeat | null): string {
  if (!r) return "Doesn't repeat";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
  let s = r.interval === 1 ? { daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" }[r.freq] : `Every ${r.interval} ${unit}s`;
  if (r.freq === "weekly" && r.byDay.length) {
    const days = [...r.byDay].sort();
    s = days.join() === "1,2,3,4,5" && r.interval === 1 ? "Every weekday" : `${s} on ${days.map((d) => names[d]).join(", ")}`;
  }
  if (r.until) s += ` until ${new Date(`${r.until}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  else if (r.count) s += `, ${r.count} times`;
  return s;
}
