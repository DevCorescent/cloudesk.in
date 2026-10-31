// Booking slots: pure, time-zone aware. Times are wall-clock in the
// business's time zone; everything stored is UTC.

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];
export type WeeklyHours = Partial<Record<Day, [string, string][]>>;

export const DEFAULT_HOURS: WeeklyHours = { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]], sat: [["10:00", "16:00"]] };

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMin(d: Date, tz: string) {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a wall-clock time in a zone (handles daylight saving changes). */
export function zonedTime(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMin(new Date(guess), tz) * 60000;
  t = guess - offsetMin(new Date(t), tz) * 60000;
  return new Date(t);
}

/** Calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(d: Date, tz: string) {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTime(d: Date, tz: string) {
  const p = parts(d, tz);
  return `${p.hour}:${p.minute}`;
}

export function weekday(date: string): Day {
  const [y, m, d] = date.split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type Busy = { start: Date; end: Date };

export type SlotQuery = {
  date: string;
  tz: string;
  hours: WeeklyHours;
  stepMin: number;
  durationMin: number;
  bufferMin: number;
  capacity: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  closedDates: string[];
  now: Date;
  /** Existing bookings that hold capacity (each counts once). */
  busy: Busy[];
};

export type Slot = { time: string; start: Date; end: Date; remaining: number };

/** Bookable start times on a date. A slot is taken when capacity is used up by overlapping bookings (with buffer). */
export function slotsForDay(q: SlotQuery): Slot[] {
  const today = localDate(q.now, q.tz);
  if (q.date < today || q.date > addDays(today, q.maxDaysAhead) || q.closedDates.includes(q.date)) return [];
  const windows = q.hours[weekday(q.date)] ?? [];
  const earliest = q.now.getTime() + q.minNoticeHours * 3600_000;
  const out: Slot[] = [];
  for (const [from, to] of windows) {
    const end = toMin(to);
    for (let m = toMin(from); m + q.durationMin <= end; m += q.stepMin) {
      const start = zonedTime(q.date, toHHMM(m), q.tz);
      if (start.getTime() < earliest) continue;
      const finish = new Date(start.getTime() + q.durationMin * 60000);
      const pad = q.bufferMin * 60000;
      const used = q.busy.filter((b) => b.start.getTime() < finish.getTime() + pad && b.end.getTime() + pad > start.getTime()).length;
      if (used < q.capacity) out.push({ time: toHHMM(m), start, end: finish, remaining: q.capacity - used });
    }
  }
  return out;
}

/** Google Calendar "add event" link. */
export function googleCalendarLink(title: string, start: Date, end: Date, details: string, location = "") {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent(details)}${location ? `&location=${encodeURIComponent(location)}` : ""}`;
}

/** Minimal RFC 5545 calendar file for one event. */
export function icsFile(o: { uid: string; title: string; start: Date; end: Date; description: string; location?: string }) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cloudesk//Bookings//EN", "BEGIN:VEVENT", `UID:${o.uid}`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(o.start)}`, `DTEND:${f(o.end)}`, `SUMMARY:${esc(o.title)}`, `DESCRIPTION:${esc(o.description)}`, ...(o.location ? [`LOCATION:${esc(o.location)}`] : []), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}
