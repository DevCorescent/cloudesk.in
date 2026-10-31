// Time zones without a library: wall-clock time in a zone ↔ UTC, using Intl.
// Calendars store UTC; recurring events and invites think in a zone's wall clock.

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validTz(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    fmt(tz);
    return tz;
  } catch {
    return "UTC";
  }
}

export type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

/** The wall-clock parts of a moment in a zone. */
export function partsIn(ms: number, tz: string): Parts {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second! };
}

/** Minutes the zone is ahead of UTC at that moment. */
export function offsetMin(ms: number, tz: string) {
  const p = partsIn(ms, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** A wall-clock time in a zone, as a UTC timestamp (handles DST by re-checking the offset). */
export function zonedToUtc(p: Parts, tz: string): number {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const first = guess - offsetMin(guess, tz) * 60_000;
  const second = guess - offsetMin(first, tz) * 60_000;
  return second;
}

/** YYYY-MM-DD of a moment in a zone. */
export const dayIn = (ms: number, tz: string) => {
  const p = partsIn(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/** Start of that zone's day containing `ms`, plus `addDays`. */
export function startOfDay(ms: number, tz: string, addDays = 0) {
  const p = partsIn(ms, tz);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
  return zonedToUtc({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: 0, mi: 0, s: 0 }, tz);
}

/** Outlook writes Windows zone names; the common ones, mapped to IANA. */
export const WINDOWS_ZONES: Record<string, string> = {
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Arabian Standard Time": "Asia/Dubai",
  "Arab Standard Time": "Asia/Riyadh",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Russian Standard Time": "Europe/Moscow",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Atlantic Standard Time": "America/Halifax",
  "E. South America Standard Time": "America/Sao_Paulo",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
};

/** A zone name from an invite (IANA, Windows, or "(UTC+05:30) …"), as IANA if we know it. */
export function normaliseTz(name: string | undefined | null): string | null {
  if (!name) return null;
  const n = name.replace(/^"|"$/g, "").trim();
  if (WINDOWS_ZONES[n]) return WINDOWS_ZONES[n]!;
  if (validTz(n) === n) return n;
  if (/kolkata|calcutta|india|\+0?5:30/i.test(n)) return "Asia/Kolkata";
  return null;
}
