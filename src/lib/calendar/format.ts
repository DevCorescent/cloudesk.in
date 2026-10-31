// How meeting times read — in reminders, emails and the calendar. Always in a
// named zone (the event's for emails, the viewer's on screen).

const zoneAbbr = (ms: number, tz: string) => {
  const name = new Intl.DateTimeFormat("en-IN", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "";
  return tz === "Asia/Kolkata" ? "IST" : name;
};

/** "Wed, 28 Oct 2026 · 3:00 – 4:00 pm IST", "Wed, 28 Oct 2026 (all day)". */
export function fmtWhen(start: number, end: number, tz: string, allDay = false) {
  if (allDay) {
    const d = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const last = end - 86_400_000;
    return last > start ? `${d(start)} – ${d(last)} (all day)` : `${d(start)} (all day)`;
  }
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz });
  const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return day(start) === day(end) ? `${day(start)} · ${time(start)} – ${time(end)} ${zoneAbbr(start, tz)}` : `${day(start)} ${time(start)} – ${day(end)} ${time(end)} ${zoneAbbr(start, tz)}`;
}

/** "in 3 hours", "in 10 minutes", "now", "tomorrow at 3:00 pm". */
export function fmtUntil(ms: number, now: number, tz: string) {
  const min = Math.round((ms - now) / 60_000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  if (min < 180) return `in ${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ""}`.trim();
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: tz });
  const that = new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
  const time = new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz });
  if (today === that) return `today at ${time}`;
  const tomorrow = new Date(now + 86_400_000).toLocaleDateString("en-CA", { timeZone: tz });
  if (tomorrow === that) return `tomorrow at ${time}`;
  return `${new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz })} at ${time}`;
}
