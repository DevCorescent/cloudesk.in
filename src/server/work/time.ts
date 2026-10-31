// Time: entries by day, the weekly timesheet grid, a running timer, and the
// week's journey from draft to submitted to approved (or sent back). Everyone
// logs their own time; owners and admins see and approve everyone's. Time that
// has been invoiced can't change until the invoice is voided.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDays, capacity, timeSchema, weekDays, weekOf } from "@/lib/work/model";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { check, getProject, leaveByUser, requireManage, requirePart, todayIst, type Scope } from "./access";

type Entry = typeof schema.workTime.$inferSelect;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LOCKED = ["submitted", "approved"];

async function getEntry(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Time entry");
  const [e] = await db.select().from(schema.workTime).where(and(eq(schema.workTime.id, id), eq(schema.workTime.orgId, s.orgId)));
  if (!e || (e.userId !== s.userId && !s.manage)) throw notFound("Time entry");
  return e;
}

function assertEditable(s: Scope, e: Entry) {
  if (e.invoiceId) throw new ApiError("conflict", "This time has been invoiced. Void the invoice to change it.");
  if (LOCKED.includes(e.status) && !s.manage) throw new ApiError("conflict", e.status === "approved" ? "This week has been approved, so its time is locked" : "This week is waiting for approval. Ask for it back to change it.");
}

/** A project open for time, and a task on it. */
async function checkTarget(s: Scope, projectId: string, taskId: string | null) {
  const p = await getProject(s, projectId);
  if (p.status === "cancelled" || p.status === "done") throw new ApiError("conflict", `${p.name} is ${p.status === "done" ? "done" : "cancelled"}. Reopen it to log time.`);
  if (taskId) {
    const [t] = await db.select({ projectId: schema.workTasks.projectId, billable: schema.workTasks.billable }).from(schema.workTasks).where(eq(schema.workTasks.id, taskId));
    if (t?.projectId !== projectId) throw new ApiError("validation_failed", "That task is on another project", { taskId: ["Not on this project"] });
    return { project: p, taskBillable: t.billable };
  }
  return { project: p, taskBillable: true };
}

/** Whose time this is: your own, or someone else's if you run the module. */
async function whose(s: Scope, userId: string | undefined) {
  if (!userId || userId === s.userId) return s.userId;
  requireManage(s);
  const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new ApiError("validation_failed", "That person isn't in this workspace");
  return userId;
}

export async function saveEntry(s: Scope, id: string | null, raw: unknown) {
  requirePart(s, "timesheets");
  const before = id ? await getEntry(s, id) : null;
  if (before) assertEditable(s, before);
  const v = check(timeSchema, { ...(before ? { projectId: before.projectId, taskId: before.taskId, date: before.date, minutes: before.minutes, note: before.note, billable: before.billable } : {}), ...(raw as object) });
  const userId = before ? before.userId : await whose(s, v.userId);
  const { project, taskBillable } = await checkTarget(s, v.projectId, v.taskId);
  if (v.date > addDays(todayIst(), 7)) throw new ApiError("validation_failed", "Time can't be logged more than a week ahead", { date: ["Too far ahead"] });
  const billable = project.billing === "none" ? false : v.billable && taskBillable;
  const values = { projectId: v.projectId, taskId: v.taskId, date: v.date, minutes: v.minutes, note: v.note, billable, updatedAt: new Date() };
  if (before) {
    // Changing a sent-back entry puts it back in the draft.
    const [row] = await db.update(schema.workTime).set({ ...values, status: before.status === "rejected" ? "draft" : before.status }).where(eq(schema.workTime.id, before.id)).returning();
    return row;
  }
  if (!v.minutes) throw new ApiError("validation_failed", "Enter how long it took", { minutes: ["Enter a duration"] });
  await assertDayTotal(userId, v.date, v.minutes);
  const [row] = await db.insert(schema.workTime).values({ ...values, orgId: s.orgId, userId, status: s.settings.approval ? "draft" : "approved" }).returning();
  return row;
}

async function assertDayTotal(userId: string, date: string, adding: number, exceptId?: string) {
  const [{ m }] = await db.select({ m: sql<number>`coalesce(sum(${schema.workTime.minutes}), 0)::int` }).from(schema.workTime).where(and(eq(schema.workTime.userId, userId), eq(schema.workTime.date, date), sql`${schema.workTime.status} <> 'rejected'`, ...(exceptId ? [sql`${schema.workTime.id} <> ${exceptId}`] : [])));
  if (m + adding > 24 * 60) throw new ApiError("validation_failed", "That would be more than 24 hours in one day", { minutes: ["Too many hours"] });
}

export async function deleteEntry(s: Scope, id: string) {
  const e = await getEntry(s, id);
  assertEditable(s, e);
  await db.delete(schema.workTime).where(eq(schema.workTime.id, e.id));
}

const cellSchema = z.object({ projectId: z.uuid(), taskId: z.uuid().nullable().default(null), date: day, minutes: z.number().int().min(0).max(24 * 60), userId: z.uuid().optional() });
/**
 * Set one cell of the weekly grid (a project or task on a day) to a total.
 * The difference goes onto that day's latest editable entry, or a new one.
 */
export async function setCell(s: Scope, raw: unknown) {
  requirePart(s, "timesheets");
  const v = check(cellSchema, raw);
  const userId = await whose(s, v.userId);
  const rows = await db.select().from(schema.workTime).where(and(eq(schema.workTime.userId, userId), eq(schema.workTime.projectId, v.projectId), v.taskId ? eq(schema.workTime.taskId, v.taskId) : isNull(schema.workTime.taskId), eq(schema.workTime.date, v.date), sql`${schema.workTime.status} <> 'rejected'`, isNull(schema.workTime.timerStartedAt))).orderBy(desc(schema.workTime.createdAt));
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const diff = v.minutes - total;
  if (!diff) return { minutes: total };
  const editable = rows.filter((r) => !r.invoiceId && (!LOCKED.includes(r.status) || s.manage));
  if (diff > 0 || editable.length) await checkTarget(s, v.projectId, v.taskId);
  if (diff > 0) await assertDayTotal(userId, v.date, diff);
  let left = diff;
  for (const r of editable) {
    if (!left) break;
    const next = Math.max(0, r.minutes + left);
    left -= next - r.minutes;
    if (next === 0 && !r.note) await db.delete(schema.workTime).where(eq(schema.workTime.id, r.id));
    else await db.update(schema.workTime).set({ minutes: next, status: r.status === "rejected" ? "draft" : r.status, updatedAt: new Date() }).where(eq(schema.workTime.id, r.id));
    if (left > 0) break;
  }
  if (left > 0) {
    const { project, taskBillable } = await checkTarget(s, v.projectId, v.taskId);
    await db.insert(schema.workTime).values({ orgId: s.orgId, userId, projectId: v.projectId, taskId: v.taskId, date: v.date, minutes: left, billable: project.billing !== "none" && taskBillable, status: s.settings.approval ? "draft" : "approved" });
    left = 0;
  }
  if (left < 0) throw new ApiError("conflict", "Some of this day's time is locked (approved, waiting for approval or invoiced), so it can't go lower");
  return { minutes: v.minutes };
}

/** One person's week: the grid rows, daily totals, leave, and where the week stands. */
export async function week(s: Scope, q: { week?: string; userId?: string }) {
  requirePart(s, "timesheets");
  const userId = q.userId && q.userId !== s.userId ? (requireManage(s), q.userId) : s.userId;
  const monday = weekOf(q.week && /^\d{4}-\d{2}-\d{2}$/.test(q.week) ? q.week : todayIst());
  const days = weekDays(monday);
  const entries = await db
    .select({ e: schema.workTime, project: { name: schema.workProjects.name, code: schema.workProjects.code, tint: schema.workProjects.tint, status: schema.workProjects.status }, task: { title: schema.workTasks.title, number: schema.workTasks.number } })
    .from(schema.workTime)
    .innerJoin(schema.workProjects, eq(schema.workProjects.id, schema.workTime.projectId))
    .leftJoin(schema.workTasks, eq(schema.workTasks.id, schema.workTime.taskId))
    .where(and(eq(schema.workTime.orgId, s.orgId), eq(schema.workTime.userId, userId), gte(schema.workTime.date, days[0]), lte(schema.workTime.date, days[6])))
    .orderBy(asc(schema.workTime.createdAt));
  const rows = new Map<string, { projectId: string; taskId: string | null; project: string; code: string; tint: string; task: string | null; taskNumber: number | null; closed: boolean; days: Record<string, number>; locked: Record<string, boolean>; total: number }>();
  for (const { e, project, task } of entries) {
    if (e.status === "rejected" && !e.minutes) continue;
    const k = `${e.projectId}|${e.taskId ?? ""}`;
    const r = rows.get(k) ?? { projectId: e.projectId, taskId: e.taskId, project: project.name, code: project.code, tint: project.tint, task: task?.title ?? null, taskNumber: task?.number ?? null, closed: project.status === "done" || project.status === "cancelled", days: {}, locked: {}, total: 0 };
    if (e.status !== "rejected") {
      r.days[e.date] = (r.days[e.date] ?? 0) + e.minutes;
      r.total += e.minutes;
    }
    if (e.invoiceId || (LOCKED.includes(e.status) && !s.manage)) r.locked[e.date] = true;
    rows.set(k, r);
  }
  const leave = (await leaveByUser(s.orgId, days[0], days[6])).get(userId) ?? new Map<string, number>();
  const leaveDays = [...leave.values()].reduce((a, b) => a + b, 0);
  const statuses = new Set(entries.map((x) => x.e.status));
  const status = !entries.length ? "empty" : statuses.has("rejected") ? "rejected" : statuses.has("draft") ? "draft" : statuses.has("submitted") ? "submitted" : "approved";
  const rejected = entries.find((x) => x.e.status === "rejected" && x.e.decisionNote)?.e.decisionNote ?? "";
  const timer = await runningTimer(s, userId);
  return {
    week: monday,
    days,
    userId,
    rows: [...rows.values()],
    totals: Object.fromEntries(days.map((d) => [d, [...rows.values()].reduce((n, r) => n + (r.days[d] ?? 0), 0)])),
    total: [...rows.values()].reduce((n, r) => n + r.total, 0),
    capacity: capacity(days, s.settings, leaveDays),
    leave: Object.fromEntries(leave),
    status,
    rejected,
    approval: s.settings.approval,
    entries: entries.map(({ e, project, task }) => ({ ...e, project: project.name, code: project.code, task: task?.title ?? null })),
    timer,
  };
}

/** Send a week in for approval (or approve it straight away when approval is off). */
export async function submitWeek(s: Scope, raw: unknown) {
  requirePart(s, "timesheets");
  const { week: w } = check(z.object({ week: day }), raw);
  const days = weekDays(weekOf(w));
  const next = s.settings.approval ? "submitted" : "approved";
  const running = await runningTimer(s, s.userId);
  if (running && running.date >= days[0] && running.date <= days[6]) throw new ApiError("conflict", "Stop the timer first");
  const rows = await db.update(schema.workTime).set({ status: next, decisionNote: "", updatedAt: new Date() }).where(and(eq(schema.workTime.orgId, s.orgId), eq(schema.workTime.userId, s.userId), gte(schema.workTime.date, days[0]), lte(schema.workTime.date, days[6]), inArray(schema.workTime.status, ["draft", "rejected"]), sql`${schema.workTime.minutes} > 0`)).returning({ id: schema.workTime.id });
  if (!rows.length) throw new ApiError("conflict", "There's no new time in this week to send");
  return { entries: rows.length, status: next };
}

/** Take back a submitted week to change it. */
export async function recallWeek(s: Scope, raw: unknown) {
  const { week: w } = check(z.object({ week: day }), raw);
  const days = weekDays(weekOf(w));
  const rows = await db.update(schema.workTime).set({ status: "draft", updatedAt: new Date() }).where(and(eq(schema.workTime.orgId, s.orgId), eq(schema.workTime.userId, s.userId), gte(schema.workTime.date, days[0]), lte(schema.workTime.date, days[6]), eq(schema.workTime.status, "submitted"))).returning({ id: schema.workTime.id });
  return { entries: rows.length };
}

/** Weeks waiting for approval, by person. */
export async function approvals(s: Scope) {
  requireManage(s);
  requirePart(s, "timesheets");
  const rows = (await db.execute(sql`
    select t.user_id, u.name, date_trunc('week', t.date)::date::text as week, sum(t.minutes)::int as minutes,
      coalesce(sum(t.minutes) filter (where t.billable), 0)::int as billable, count(*)::int as entries,
      array_agg(distinct p.name) as projects
    from work_time t join users u on u.id = t.user_id join work_projects p on p.id = t.project_id
    where t.org_id = ${s.orgId} and t.status = 'submitted'
    group by t.user_id, u.name, 3 order by 3, u.name`)) as unknown as { rows: { user_id: string; name: string; week: string; minutes: number; billable: number; entries: number; projects: string[] }[] };
  return rows.rows.map((r) => ({ userId: r.user_id, name: r.name, week: r.week, minutes: r.minutes, billable: r.billable, entries: r.entries, projects: r.projects }));
}

const decideSchema = z.object({ userId: z.uuid(), week: day, approve: z.boolean(), note: z.string().trim().max(500).default("") });
export async function decideWeek(s: Scope, raw: unknown) {
  requireManage(s);
  requirePart(s, "timesheets");
  const v = check(decideSchema, raw);
  if (!v.approve && !v.note) throw new ApiError("validation_failed", "Say what needs changing", { note: ["Add a note"] });
  const days = weekDays(weekOf(v.week));
  const rows = await db.update(schema.workTime).set({ status: v.approve ? "approved" : "rejected", decidedBy: s.userId, decisionNote: v.note, updatedAt: new Date() }).where(and(eq(schema.workTime.orgId, s.orgId), eq(schema.workTime.userId, v.userId), gte(schema.workTime.date, days[0]), lte(schema.workTime.date, days[6]), eq(schema.workTime.status, "submitted"))).returning({ id: schema.workTime.id });
  if (!rows.length) throw new ApiError("conflict", "Nothing in that week is waiting for approval");
  if (!v.approve && v.userId !== s.userId) await notify(s.orgId, [v.userId], { kind: "work.timesheet_returned", title: `Your timesheet for the week of ${days[0]} needs changes`, body: v.note, link: `/work/timesheet?week=${days[0]}`, values: { week: days[0], note: v.note } });
  return { entries: rows.length };
}

// ── Timer ───────────────────────────────────────────────────────────────────

async function runningTimer(s: Scope, userId: string) {
  const [t] = await db
    .select({ id: schema.workTime.id, date: schema.workTime.date, minutes: schema.workTime.minutes, startedAt: schema.workTime.timerStartedAt, note: schema.workTime.note, projectId: schema.workTime.projectId, taskId: schema.workTime.taskId, project: schema.workProjects.name, task: schema.workTasks.title })
    .from(schema.workTime)
    .innerJoin(schema.workProjects, eq(schema.workProjects.id, schema.workTime.projectId))
    .leftJoin(schema.workTasks, eq(schema.workTasks.id, schema.workTime.taskId))
    .where(and(eq(schema.workTime.orgId, s.orgId), eq(schema.workTime.userId, userId), isNotNull(schema.workTime.timerStartedAt)));
  return t ? { ...t, startedAt: t.startedAt!.toISOString() } : null;
}

export async function timer(s: Scope) {
  return { timer: await runningTimer(s, s.userId) };
}

const startSchema = z.object({ projectId: z.uuid(), taskId: z.uuid().nullable().default(null), note: z.string().trim().max(1000).default("") });
export async function startTimer(s: Scope, raw: unknown) {
  requirePart(s, "timesheets");
  const v = check(startSchema, raw);
  const { project, taskBillable } = await checkTarget(s, v.projectId, v.taskId);
  // Starting a new timer stops the one that's running.
  if (await runningTimer(s, s.userId)) await stopTimer(s);
  const [row] = await db.insert(schema.workTime).values({ orgId: s.orgId, userId: s.userId, projectId: v.projectId, taskId: v.taskId, date: todayIst(), minutes: 0, note: v.note, billable: project.billing !== "none" && taskBillable, timerStartedAt: new Date(), status: "draft" }).returning();
  return { timer: await runningTimer(s, s.userId), id: row.id };
}

export async function stopTimer(s: Scope, now = new Date()) {
  const t = await runningTimer(s, s.userId);
  if (!t) throw new ApiError("conflict", "No timer is running");
  // Whole minutes, at least one, and never past the end of a long day.
  const elapsed = Math.min(16 * 60, Math.max(1, Math.round((now.getTime() - Date.parse(t.startedAt)) / 60_000)));
  const [{ m }] = await db.select({ m: sql<number>`coalesce(sum(${schema.workTime.minutes}), 0)::int` }).from(schema.workTime).where(and(eq(schema.workTime.userId, s.userId), eq(schema.workTime.date, t.date), sql`${schema.workTime.status} <> 'rejected'`));
  const minutes = Math.max(0, Math.min(t.minutes + elapsed, 24 * 60 - (m - t.minutes)));
  const [row] = await db.update(schema.workTime).set({ minutes, timerStartedAt: null, status: s.settings.approval ? "draft" : "approved", updatedAt: new Date() }).where(eq(schema.workTime.id, t.id)).returning();
  if (!row.minutes) await db.delete(schema.workTime).where(eq(schema.workTime.id, row.id));
  return { entry: row, minutes };
}

/** Time entries for a list or an export: everyone's for owners and admins, otherwise your own. */
export async function listTime(s: Scope, f: { projectId?: string; userId?: string; from?: string; to?: string; status?: string; billed?: string } = {}) {
  requirePart(s, "timesheets");
  const where = [eq(schema.workTime.orgId, s.orgId), isNull(schema.workTime.timerStartedAt)];
  if (!s.manage) where.push(eq(schema.workTime.userId, s.userId));
  else if (f.userId && /^[0-9a-f-]{36}$/.test(f.userId)) where.push(eq(schema.workTime.userId, f.userId));
  if (f.projectId) where.push(eq(schema.workTime.projectId, (await getProject(s, f.projectId)).id));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) where.push(gte(schema.workTime.date, f.from));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) where.push(lte(schema.workTime.date, f.to));
  if (f.status && ["draft", "submitted", "approved", "rejected"].includes(f.status)) where.push(eq(schema.workTime.status, f.status));
  if (f.billed === "yes") where.push(isNotNull(schema.workTime.invoiceId));
  if (f.billed === "no") where.push(isNull(schema.workTime.invoiceId));
  return db
    .select({ id: schema.workTime.id, date: schema.workTime.date, minutes: schema.workTime.minutes, note: schema.workTime.note, billable: schema.workTime.billable, status: schema.workTime.status, invoiceId: schema.workTime.invoiceId, userId: schema.workTime.userId, person: schema.users.name, projectId: schema.workTime.projectId, project: schema.workProjects.name, code: schema.workProjects.code, client: schema.workProjects.clientName, taskId: schema.workTime.taskId, task: schema.workTasks.title })
    .from(schema.workTime)
    .innerJoin(schema.users, eq(schema.users.id, schema.workTime.userId))
    .innerJoin(schema.workProjects, eq(schema.workProjects.id, schema.workTime.projectId))
    .leftJoin(schema.workTasks, eq(schema.workTasks.id, schema.workTime.taskId))
    .where(and(...where))
    .orderBy(desc(schema.workTime.date), desc(schema.workTime.createdAt))
    .limit(5000);
}
