// Five-field cron (minute hour day-of-month month day-of-week) evaluated in a
// time zone. Supports *, lists, ranges, steps and MON–SUN / JAN–DEC names.
// Like classic cron, when both day fields are restricted either may match.

const NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

export type Cron = { sets: Set<number>[]; domStar: boolean; dowStar: boolean };

function field(src: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`);
    let a = lo;
    let b = hi;
    if (rangePart !== "*") {
      const [x, y] = rangePart.split("-").map((v) => (NAMES[v.toLowerCase()] ?? Number(v)));
      if (!Number.isInteger(x) || (y !== undefined && !Number.isInteger(y))) throw new Error(`Bad value "${part}"`);
      a = x;
      b = y ?? (stepPart !== undefined ? hi : x);
    }
    if (a < lo || b > hi || a > b) throw new Error(`"${part}" is out of range ${lo}–${hi}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Use five fields: minute hour day month weekday");
  const sets = parts.map((p, i) => field(p, RANGES[i]));
  if (sets[4].has(7)) sets[4].add(0); // 7 is also Sunday
  return { sets, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(d: Date, timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, dow: NAMES[String(p.weekday).toLowerCase().slice(0, 3)] };
}

export function cronMatches(c: Cron, d: Date, timeZone: string): boolean {
  const z = zonedParts(d, timeZone);
  const [min, hour, dom, month, dow] = c.sets;
  if (!min.has(z.minute) || !hour.has(z.hour) || !month.has(z.month)) return false;
  const domOk = dom.has(z.day);
  const dowOk = dow.has(z.dow);
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowOk;
  if (c.dowStar) return domOk;
  return domOk || dowOk;
}

/** The next matching minutes after `from` (searching up to `horizonDays`). */
export function nextRuns(expr: string, timeZone: string, from = new Date(), count = 3, horizonDays = 14): Date[] {
  const c = parseCron(expr);
  const out: Date[] = [];
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const end = from.getTime() + horizonDays * 86400_000;
  for (; t <= end && out.length < count; t += 60_000) if (cronMatches(c, new Date(t), timeZone)) out.push(new Date(t));
  return out;
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const CRON_PRESETS = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every day at 9:00", cron: "0 9 * * *" },
  { label: "Weekdays at 9:00", cron: "0 9 * * mon-fri" },
  { label: "Every Monday at 8:00", cron: "0 8 * * mon" },
  { label: "1st of the month at 10:00", cron: "0 10 1 * *" },
];
