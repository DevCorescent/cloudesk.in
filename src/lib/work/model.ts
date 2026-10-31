// Projects & timesheets: shapes and the arithmetic shared by the server and the
// screens. Money is in paise; time is kept in whole minutes and shown in hours.
import { z } from "zod";

export const PROJECT_STATUSES = ["planned", "active", "on_hold", "done", "cancelled"] as const;
export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const BILLING = ["hourly", "fixed", "none"] as const;
export const TINTS = ["sky", "mint", "peach", "lavender", "butter", "rose"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { planned: "Planned", active: "Active", on_hold: "On hold", done: "Done", cancelled: "Cancelled" };
export const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const BILLING_LABEL: Record<(typeof BILLING)[number], string> = { hourly: "By the hour", fixed: "Fixed fee", none: "Not billed" };

const money = z.number().int("Use whole paise").min(0).max(1e12);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (n: number) => z.string().trim().max(n).default("");

export const settingsSchema = z.object({
  /** Labels for the four board columns. */
  columns: z.object({ todo: z.string().trim().min(1).max(24).default("To do"), doing: z.string().trim().min(1).max(24).default("In progress"), review: z.string().trim().min(1).max(24).default("Review"), done: z.string().trim().min(1).max(24).default("Done") }).default({ todo: "To do", doing: "In progress", review: "Review", done: "Done" }),
  /** Hours a person is expected to work on a working day, for utilisation and HR cost rates. */
  dailyHours: z.number().min(1).max(16).default(8),
  /** Monday (1) to Sunday (7) that are working days. */
  workDays: z.array(z.number().int().min(1).max(7)).max(7).default([1, 2, 3, 4, 5, 6]),
  /** Weekly timesheets need a manager's approval before they can be billed. */
  approval: z.boolean().default(true),
  /** Round billed time up to this many minutes per entry (0 = exact). */
  roundTo: z.union([z.literal(0), z.literal(6), z.literal(15), z.literal(30)]).default(0),
  /** Default rate per hour for new projects, in paise. */
  defaultRate: money.default(0),
  projectPrefix: z.string().trim().max(8).default("PRJ-"),
});
export type WorkSettings = z.infer<typeof settingsSchema>;

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Name the project").max(120),
  description: text(4000),
  ownerId: z.uuid().nullable().default(null),
  clientId: z.uuid().nullable().default(null),
  clientName: text(160),
  dealId: z.uuid().nullable().default(null),
  status: z.enum(PROJECT_STATUSES).default("active"),
  billing: z.enum(BILLING).default("hourly"),
  rate: money.default(0),
  fee: money.default(0),
  budgetHours: z.number().min(0).max(1e6).default(0),
  budgetAmount: money.default(0),
  startDate: day.nullable().default(null),
  dueDate: day.nullable().default(null),
  leadId: z.uuid().nullable().default(null),
  tint: z.enum(TINTS).default("sky"),
  members: z.array(z.object({ userId: z.uuid(), rate: money.nullable().default(null), costRate: money.nullable().default(null) })).max(200).optional(),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const taskSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: text(20000),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("normal"),
  assigneeId: z.uuid().nullable().default(null),
  milestoneId: z.uuid().nullable().default(null),
  parentId: z.uuid().nullable().default(null),
  startDate: day.nullable().default(null),
  dueDate: day.nullable().default(null),
  estimateHours: z.number().min(0).max(10_000).default(0),
  billable: z.boolean().default(true),
  checklist: z.array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const milestoneSchema = z.object({ projectId: z.uuid(), name: z.string().trim().min(1, "Name the milestone").max(160), dueDate: day.nullable().default(null), amount: money.default(0) });

export const timeSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().nullable().default(null),
  date: day,
  minutes: z.number().int().min(0).max(24 * 60, "A day has 24 hours"),
  note: text(1000),
  billable: z.boolean().default(true),
  /** Logging for someone else needs work:manage. */
  userId: z.uuid().optional(),
});

/** Read "1:30", "1h 30m", "90m" or "1.5" as minutes. */
export { toMinutes as parseDuration } from "@/lib/import/engine";

/** 90 → "1:30". */
export const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
/** 90 → "1.5h", 0 → "0h". */
export const hrs = (minutes: number) => `${Number((minutes / 60).toFixed(minutes % 6 === 0 ? 1 : 2))}h`;

/** Billed minutes for an entry, rounded up to the setting. */
export const roundUp = (minutes: number, to: number) => (to > 0 ? Math.ceil(minutes / to) * to : minutes);

/** Money for some minutes at a rate per hour, in paise. */
export const amountFor = (minutes: number, ratePerHour: number) => Math.round((minutes * ratePerHour) / 60);

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => ymd(new Date(at(iso).getTime() + n * 86_400_000));
/** ISO weekday, Monday 1 to Sunday 7. */
export const weekday = (iso: string) => ((at(iso).getUTCDay() + 6) % 7) + 1;
/** The Monday of the week a date falls in. */
export const weekOf = (iso: string) => addDays(iso, 1 - weekday(iso));
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/**
 * What an hour of someone's time costs, from their yearly cost to company:
 * CTC ÷ 12 months ÷ (working days in a month × hours a day).
 */
export function hourlyCost(ctcPerYear: number, s: Pick<WorkSettings, "dailyHours" | "workDays">) {
  const daysPerMonth = (s.workDays.length || 5) * (52 / 12);
  return Math.round(ctcPerYear / 12 / (daysPerMonth * s.dailyHours));
}

/** Working minutes in a set of days, less leave (in days, halves allowed). */
export function capacity(days: string[], s: Pick<WorkSettings, "dailyHours" | "workDays">, leaveDays = 0) {
  const working = days.filter((d) => s.workDays.includes(weekday(d))).length;
  return Math.max(0, Math.round((working - leaveDays) * s.dailyHours * 60));
}

export type BillEntry = { id: string; minutes: number; rate: number; taskId: string | null; taskTitle: string; userName: string; date: string; note: string };
/**
 * Invoice lines for unbilled time: one line per task (or per person, or one
 * line for everything), each at its own rate. Entries at different rates never
 * share a line.
 */
export function billLines(entries: BillEntry[], groupBy: "task" | "person" | "single", roundTo = 0, label = "Professional services") {
  const groups = new Map<string, { name: string; minutes: number; rate: number; ids: string[]; dates: string[] }>();
  for (const e of entries) {
    const name = groupBy === "task" ? e.taskTitle || "General work" : groupBy === "person" ? e.userName : label;
    const k = `${name}|${e.rate}`;
    const g = groups.get(k) ?? { name, minutes: 0, rate: e.rate, ids: [], dates: [] };
    g.minutes += roundUp(e.minutes, roundTo);
    g.ids.push(e.id);
    g.dates.push(e.date);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => {
    const dates = g.dates.sort();
    // Invoices hold hours to three decimals, so the amount is worked out the same way.
    const hours = Math.round((g.minutes / 60) * 1000) / 1000;
    return { name: g.name, hours, minutes: g.minutes, rate: g.rate, amount: Math.round(hours * g.rate), ids: g.ids, from: dates[0], to: dates[dates.length - 1] };
  });
}

/** How far through its budget a project is, 0–1+ (null when it has none). */
export function burn(p: { budgetHours: number; budgetAmount: number }, used: { minutes: number; amount: number }) {
  if (p.budgetAmount > 0) return used.amount / p.budgetAmount;
  if (p.budgetHours > 0) return used.minutes / 60 / p.budgetHours;
  return null;
}

// ── Projects+: dependencies, schedule, resources, expenses, risks, changes ──

export const linkSchema = z.object({ fromId: z.uuid(), toId: z.uuid(), type: z.enum(["FS", "SS"]).default("FS"), lagDays: z.number().int().min(-60).max(365).default(0) });
export const allocationSchema = z.object({ projectId: z.uuid(), userId: z.uuid(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hoursPerDay: z.number().min(0.25).max(24) });
export const EXPENSE_CATEGORIES = ["Travel", "Materials", "Software", "Subcontractor", "Printing", "Food", "Other"] as const;
export const expenseSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.string().trim().min(1).max(40).default("Other"), description: z.string().trim().max(300).default(""), vendor: z.string().trim().max(120).default(""), amount: z.number().int().min(1).max(1e11), billable: z.boolean().default(true), markupPct: z.number().min(0).max(500).default(0), receiptLink: z.union([z.literal(""), z.url("Use a web link")]).default("") });
export const riskSchema = z.object({ kind: z.enum(["risk", "issue"]).default("risk"), title: z.string().trim().min(1, "Describe it").max(160), probability: z.number().int().min(1).max(5).default(3), impact: z.number().int().min(1).max(5).default(3), ownerId: z.uuid().nullable().default(null), mitigation: z.string().trim().max(2000).default(""), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), status: z.enum(["open", "watching", "closed"]).default("open") });
export const changeSchema = z.object({ title: z.string().trim().min(1, "Name the change").max(160), description: z.string().trim().max(4000).default(""), hours: z.number().min(-100000).max(100000).default(0), fee: z.number().int().min(-1e11).max(1e11).default(0), days: z.number().int().min(-365).max(365).default(0) });

const dnum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const dstr = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** A link that would close a loop (a task waiting, directly or not, on itself). */
export function wouldLoop(links: { fromId: string; toId: string }[], add: { fromId: string; toId: string }) {
  if (add.fromId === add.toId) return true;
  const next = new Map<string, string[]>();
  for (const l of [...links, add]) next.set(l.fromId, [...(next.get(l.fromId) ?? []), l.toId]);
  const seen = new Set<string>();
  const stack = [add.toId];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === add.fromId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

/**
 * Push tasks later so they respect what they wait on (finish-to-start: start
 * the day after the predecessor finishes, plus lag; start-to-start: start with
 * it, plus lag), keeping each task's length. Tasks are never pulled earlier.
 */
export function reschedule(tasks: { id: string; startDate: string | null; dueDate: string | null; done?: boolean }[], links: { fromId: string; toId: string; type: "FS" | "SS"; lagDays: number }[]) {
  const t = new Map(tasks.filter((x) => x.startDate || x.dueDate).map((x) => [x.id, { start: dnum(x.startDate ?? x.dueDate!), end: dnum(x.dueDate ?? x.startDate!), done: !!x.done }]));
  const moved = new Map<string, { startDate: string; dueDate: string }>();
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let changed = false;
    for (const l of links) {
      const a = t.get(l.fromId);
      const b = t.get(l.toId);
      if (!a || !b || b.done) continue;
      const earliest = l.type === "FS" ? a.end + 1 + l.lagDays : a.start + l.lagDays;
      if (b.start < earliest) {
        const len = b.end - b.start;
        b.start = earliest;
        b.end = earliest + len;
        moved.set(l.toId, { startDate: dstr(b.start), dueDate: dstr(b.end) });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return moved;
}

/** The critical path: the chain of tasks with no slack before the project's last finish. */
export function criticalPath(tasks: { id: string; startDate: string | null; dueDate: string | null }[], links: { fromId: string; toId: string; type: "FS" | "SS"; lagDays: number }[]) {
  const dated = tasks.filter((x) => x.startDate && x.dueDate).map((x) => ({ id: x.id, start: dnum(x.startDate!), end: dnum(x.dueDate!) }));
  if (!dated.length) return { ids: [] as string[], finish: null as string | null };
  const finish = Math.max(...dated.map((x) => x.end));
  // Latest each task may finish without delaying the end, walking back from the last tasks.
  const late = new Map(dated.map((x) => [x.id, finish]));
  for (let pass = 0; pass < dated.length + 1; pass++) {
    let changed = false;
    for (const l of links) {
      const a = dated.find((x) => x.id === l.fromId);
      const b = dated.find((x) => x.id === l.toId);
      if (!a || !b) continue;
      const bLateStart = late.get(b.id)! - (b.end - b.start);
      const limit = l.type === "FS" ? bLateStart - 1 - l.lagDays : bLateStart - l.lagDays + (a.end - a.start);
      if (limit < late.get(a.id)!) {
        late.set(a.id, limit);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { ids: dated.filter((x) => late.get(x.id)! - x.end <= 0).map((x) => x.id), finish: dstr(finish) };
}

/** Hours a person can work in a date range: working days × daily hours, less days on leave. */
export function capacityHours(from: string, to: string, workDays: number[], dailyHours: number, leaveDays: Map<string, number>) {
  let h = 0;
  for (let n = dnum(from); n <= dnum(to); n++) {
    const dow = new Date(n * 86_400_000).getUTCDay() || 7;
    if (workDays.includes(dow)) h += dailyHours * (1 - (leaveDays.get(dstr(n)) ?? 0));
  }
  return Math.round(h * 100) / 100;
}

/** Planned hours from allocations falling in a range (working days only). */
export function allocatedHours(allocs: { from: string; to: string; hoursPerDay: number }[], from: string, to: string, workDays: number[]) {
  let h = 0;
  for (const a of allocs) for (let n = Math.max(dnum(a.from), dnum(from)); n <= Math.min(dnum(a.to), dnum(to)); n++) if (workDays.includes(new Date(n * 86_400_000).getUTCDay() || 7)) h += a.hoursPerDay;
  return Math.round(h * 100) / 100;
}

export const riskScore = (r: { probability: number; impact: number }) => r.probability * r.impact;
export const riskLevel = (score: number) => (score >= 15 ? "high" : score >= 8 ? "medium" : "low");
