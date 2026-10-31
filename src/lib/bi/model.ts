// Reports & dashboards: a report is a question asked of one dataset —
// dimensions (with dates bucketed by day to year), measures (sum, count,
// average, min, max, distinct), filters, a date range (a preset like "this
// financial year", or dates), a sort and a limit — shown as a table or chart.
// Dashboards arrange reports and KPIs; schedules email a report.
import { z } from "zod";

export const BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export const AGGS = ["sum", "count", "avg", "min", "max", "distinct"] as const;
export const AGG_LABEL: Record<(typeof AGGS)[number], string> = { sum: "Total", count: "Count", avg: "Average", min: "Lowest", max: "Highest", distinct: "Distinct count" };
export const OPS = ["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains", "empty", "notempty", "true", "false"] as const;
export const OP_LABEL: Record<(typeof OPS)[number], string> = { eq: "is", ne: "is not", in: "is one of", gt: "more than", gte: "at least", lt: "less than", lte: "at most", contains: "contains", empty: "is empty", notempty: "isn't empty", true: "is yes", false: "is no" };
export const CHARTS = ["table", "bar", "line", "area", "pie", "number"] as const;
export const PRESETS = ["today", "yesterday", "last_7", "last_30", "last_90", "this_week", "this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "this_fy", "last_fy", "all", "custom"] as const;
export const PRESET_LABEL: Record<(typeof PRESETS)[number], string> = { today: "Today", yesterday: "Yesterday", last_7: "Last 7 days", last_30: "Last 30 days", last_90: "Last 90 days", this_week: "This week", this_month: "This month", last_month: "Last month", this_quarter: "This quarter", last_quarter: "Last quarter", this_year: "This calendar year", last_year: "Last calendar year", this_fy: "This financial year", last_fy: "Last financial year", all: "All time", custom: "Dates" };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const key = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/);

export const specSchema = z.object({
  dims: z.array(z.object({ field: key, bucket: z.enum(BUCKETS).nullable().default(null) })).max(3).default([]),
  measures: z.array(z.object({ field: key.nullable().default(null), agg: z.enum(AGGS).default("count") })).min(1, "Add something to measure").max(6),
  filters: z.array(z.object({ field: key, op: z.enum(OPS), value: z.union([z.string().max(200), z.number(), z.array(z.string().max(200)).max(50)]).nullable().default(null) })).max(12).default([]),
  range: z.object({ field: key.nullable().default(null), preset: z.enum(PRESETS).default("last_30"), from: day.nullable().default(null), to: day.nullable().default(null) }).prefault({}),
  sort: z.object({ by: z.string().regex(/^(d|m)\d$/).nullable().default(null), dir: z.enum(["asc", "desc"]).default("desc") }).prefault({}),
  limit: z.number().int().min(1).max(1000).default(200),
  chart: z.enum(CHARTS).default("table"),
  /** For a number: compare with the period before. */
  compare: z.boolean().default(false),
});
export type Spec = z.infer<typeof specSchema>;

export const reportSchema = z.object({ name: z.string().trim().min(1, "Name the report").max(120), description: z.string().trim().max(500).default(""), dataset: key, spec: specSchema, shared: z.boolean().default(true) });

export const widgetSchema = z.object({ id: z.string().min(1).max(40), reportId: z.uuid(), size: z.enum(["s", "m", "l"]).default("m"), target: z.number().nullable().default(null) });
export const dashboardSchema = z.object({ name: z.string().trim().min(1, "Name the dashboard").max(120), widgets: z.array(widgetSchema).max(30).default([]), shared: z.boolean().default(true) });

export const scheduleSchema = z.object({
  reportId: z.uuid(),
  frequency: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  /** Hour of the day in India, 0–23. */
  hour: z.number().int().min(0).max(23).default(9),
  /** Monday (1) to Sunday (7), for weekly. */
  weekday: z.number().int().min(1).max(7).default(1),
  /** 1–28, for monthly. */
  monthday: z.number().int().min(1).max(28).default(1),
  recipients: z.array(z.uuid()).min(1, "Pick who gets it").max(50),
  active: z.boolean().default(true),
});

const D = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const S = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => S(D(s) + n);
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const addMonths = (s: string, n: number) => {
  const [y, m] = s.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return ym(Math.floor(t / 12), (t % 12) + 1);
};

/**
 * The dates a preset covers, from `today` (in India): weeks start on Monday,
 * quarters are calendar quarters, the financial year starts in fyStartMonth
 * (April in India). "all" has no bounds.
 */
export function rangeFor(r: { preset: (typeof PRESETS)[number]; from: string | null; to: string | null }, today: string, fyStartMonth = 4): { from: string | null; to: string | null } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const qStart = ym(y, Math.floor((m - 1) / 3) * 3 + 1);
  const fyYear = m >= fyStartMonth ? y : y - 1;
  const fyStart = ym(fyYear, fyStartMonth);
  switch (r.preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last_7": return { from: addDays(today, -6), to: today };
    case "last_30": return { from: addDays(today, -29), to: today };
    case "last_90": return { from: addDays(today, -89), to: today };
    case "this_week": return { from: addDays(today, -dow), to: addDays(today, 6 - dow) };
    case "this_month": return { from: monthStart(today), to: addDays(addMonths(monthStart(today), 1), -1) };
    case "last_month": return { from: addMonths(monthStart(today), -1), to: addDays(monthStart(today), -1) };
    case "this_quarter": return { from: qStart, to: addDays(addMonths(qStart, 3), -1) };
    case "last_quarter": return { from: addMonths(qStart, -3), to: addDays(qStart, -1) };
    case "this_year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "this_fy": return { from: fyStart, to: addDays(addMonths(fyStart, 12), -1) };
    case "last_fy": return { from: addMonths(fyStart, -12), to: addDays(fyStart, -1) };
    case "all": return { from: null, to: null };
    case "custom": return { from: r.from, to: r.to };
  }
}

/** The same length of time just before a range, for comparison. */
export function previous(r: { from: string | null; to: string | null }) {
  if (!r.from || !r.to) return null;
  const len = D(r.to) - D(r.from) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

/** The change from one number to another, as a share (null when there's nothing to compare with). */
export const change = (now: number, before: number | null) => (before === null || before === 0 ? null : (now - before) / Math.abs(before));

/** When a schedule next sends, after a moment: at its hour in India on the right day. */
export function nextRun(s: { frequency: "daily" | "weekly" | "monthly"; hour: number; weekday: number; monthday: number }, after: Date) {
  const istNow = new Date(after.getTime() + 5.5 * 3_600_000);
  let d = istNow.toISOString().slice(0, 10);
  const at = (day: string) => new Date(Date.parse(`${day}T${String(s.hour).padStart(2, "0")}:00:00+05:30`));
  for (let i = 0; i < 400; i++) {
    const dow = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const ok = s.frequency === "daily" || (s.frequency === "weekly" && dow === s.weekday) || (s.frequency === "monthly" && Number(d.slice(8)) === s.monthday);
    if (ok && at(d).getTime() > after.getTime()) return at(d);
    d = addDays(d, 1);
  }
  return at(d);
}

/** A bucket's start, formatted for people: 7 Oct, Oct 2026, Q3 2026, 2026. */
export function bucketLabel(v: string, bucket: (typeof BUCKETS)[number] | null) {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  if (bucket === "year") return String(d.getUTCFullYear());
  if (bucket === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (bucket === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  if (bucket === "week") return `Week of ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
