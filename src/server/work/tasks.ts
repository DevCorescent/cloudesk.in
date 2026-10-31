// Tasks: the board (four columns, ordered by position), subtasks, checklists,
// comments and the time logged against each. Assigning a task to someone else
// emails them a link.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { TASK_STATUSES, taskSchema } from "@/lib/work/model";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { check, getProject, requireWrite, todayIst, type Scope } from "./access";
import { contains } from "../security/like";

type TaskRow = typeof schema.workTasks.$inferSelect;

export async function getTask(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Task");
  const [t] = await db.select().from(schema.workTasks).where(and(eq(schema.workTasks.id, id), eq(schema.workTasks.orgId, s.orgId)));
  if (!t) throw notFound("Task");
  return t;
}

/** Minutes logged per task. */
async function loggedFor(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ taskId: schema.workTime.taskId, m: sql<number>`sum(${schema.workTime.minutes})::int` }).from(schema.workTime).where(and(inArray(schema.workTime.taskId, ids), sql`${schema.workTime.status} <> 'rejected'`)).groupBy(schema.workTime.taskId);
  return new Map(rows.map((r) => [r.taskId!, r.m]));
}

function shape(t: TaskRow, extra: { logged?: number; subtasks?: number; subtasksDone?: number; comments?: number; project?: { code: string; name: string; tint: string } }) {
  const checklistDone = t.checklist.filter((c) => c.done).length;
  return { ...t, logged: extra.logged ?? 0, subtasks: extra.subtasks ?? 0, subtasksDone: extra.subtasksDone ?? 0, comments: extra.comments ?? 0, checklistDone, project: extra.project, overdue: t.status !== "done" && !!t.dueDate && t.dueDate < todayIst() };
}

/** Top-level tasks with their counts, for a board, a list or "my tasks". */
export async function listTasks(s: Scope, f: { projectId?: string; assignee?: string; status?: string; due?: string; q?: string; milestoneId?: string } = {}) {
  const where = [eq(schema.workTasks.orgId, s.orgId), isNull(schema.workTasks.parentId)];
  if (f.projectId) where.push(eq(schema.workTasks.projectId, (await getProject(s, f.projectId)).id));
  if (f.assignee === "me") where.push(eq(schema.workTasks.assigneeId, s.userId));
  else if (f.assignee === "none") where.push(isNull(schema.workTasks.assigneeId));
  else if (f.assignee && /^[0-9a-f-]{36}$/.test(f.assignee)) where.push(eq(schema.workTasks.assigneeId, f.assignee));
  if (f.status === "open") where.push(sql`${schema.workTasks.status} <> 'done'`);
  else if (f.status && (TASK_STATUSES as readonly string[]).includes(f.status)) where.push(eq(schema.workTasks.status, f.status));
  if (f.milestoneId) where.push(eq(schema.workTasks.milestoneId, f.milestoneId));
  const today = todayIst();
  if (f.due === "overdue") where.push(sql`${schema.workTasks.dueDate} < ${today}`);
  if (f.due === "week") where.push(sql`${schema.workTasks.dueDate} <= ${today}::date + 7`);
  if (f.q) where.push(sql`(${schema.workTasks.title} ilike ${contains(f.q)} or ${schema.workTasks.description} ilike ${contains(f.q)})`);
  // Only tasks on projects still in play, unless one project is asked for.
  if (!f.projectId) where.push(sql`exists (select 1 from work_projects p where p.id = ${schema.workTasks.projectId} and p.status in ('planned','active','on_hold'))`);
  const rows = await db.select().from(schema.workTasks).where(and(...where)).orderBy(asc(schema.workTasks.position), asc(schema.workTasks.number)).limit(2000);
  const ids = rows.map((r) => r.id);
  const [logged, subs, comments, projects] = await Promise.all([
    loggedFor(ids),
    ids.length ? db.select({ parentId: schema.workTasks.parentId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${schema.workTasks.status} = 'done')::int` }).from(schema.workTasks).where(inArray(schema.workTasks.parentId, ids)).groupBy(schema.workTasks.parentId) : [],
    ids.length ? db.select({ taskId: schema.workComments.taskId, n: sql<number>`count(*)::int` }).from(schema.workComments).where(inArray(schema.workComments.taskId, ids)).groupBy(schema.workComments.taskId) : [],
    db.select({ id: schema.workProjects.id, code: schema.workProjects.code, name: schema.workProjects.name, tint: schema.workProjects.tint }).from(schema.workProjects).where(eq(schema.workProjects.orgId, s.orgId)),
  ]);
  const proj = new Map(projects.map((p) => [p.id, p]));
  return rows.map((t) => {
    const sub = subs.find((x) => x.parentId === t.id);
    return shape(t, { logged: logged.get(t.id), subtasks: sub?.n, subtasksDone: sub?.done, comments: comments.find((c) => c.taskId === t.id)?.n, project: proj.get(t.projectId) });
  });
}

export async function taskDetail(s: Scope, id: string) {
  const t = await getTask(s, id);
  const [subtasks, comments, time, logged, project] = await Promise.all([
    db.select().from(schema.workTasks).where(eq(schema.workTasks.parentId, t.id)).orderBy(asc(schema.workTasks.position), asc(schema.workTasks.number)),
    db.select({ id: schema.workComments.id, body: schema.workComments.body, createdAt: schema.workComments.createdAt, userId: schema.workComments.userId, name: schema.users.name }).from(schema.workComments).leftJoin(schema.users, eq(schema.users.id, schema.workComments.userId)).where(eq(schema.workComments.taskId, t.id)).orderBy(asc(schema.workComments.createdAt)),
    db.select({ id: schema.workTime.id, date: schema.workTime.date, minutes: schema.workTime.minutes, note: schema.workTime.note, userId: schema.workTime.userId, name: schema.users.name }).from(schema.workTime).innerJoin(schema.users, eq(schema.users.id, schema.workTime.userId)).where(and(eq(schema.workTime.taskId, t.id), sql`${schema.workTime.status} <> 'rejected'`)).orderBy(desc(schema.workTime.date)).limit(50),
    loggedFor([t.id]),
    getProject(s, t.projectId),
  ]);
  const parent = t.parentId ? (await db.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title }).from(schema.workTasks).where(eq(schema.workTasks.id, t.parentId)))[0] ?? null : null;
  return { task: shape(t, { logged: logged.get(t.id), project: { code: project.code, name: project.name, tint: project.tint } }), parent, subtasks: subtasks.map((x) => shape(x, {})), comments, time: s.manage ? time : time.filter((x) => x.userId === s.userId) };
}

async function checkRefs(s: Scope, v: z.infer<typeof taskSchema>, selfId?: string) {
  await getProject(s, v.projectId);
  if (v.assigneeId) {
    const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.assigneeId)));
    if (!m || m.role === "employee") throw new ApiError("validation_failed", "Tasks can only go to people in this workspace's team", { assigneeId: ["Not on the team"] });
  }
  if (v.milestoneId) {
    const [m] = await db.select({ projectId: schema.workMilestones.projectId }).from(schema.workMilestones).where(eq(schema.workMilestones.id, v.milestoneId));
    if (m?.projectId !== v.projectId) throw new ApiError("validation_failed", "That milestone is on another project", { milestoneId: ["Not on this project"] });
  }
  if (v.parentId) {
    if (v.parentId === selfId) throw new ApiError("validation_failed", "A task can't be its own subtask");
    const [p] = await db.select({ projectId: schema.workTasks.projectId, parentId: schema.workTasks.parentId }).from(schema.workTasks).where(eq(schema.workTasks.id, v.parentId));
    if (p?.projectId !== v.projectId) throw new ApiError("validation_failed", "The parent task is on another project", { parentId: ["Not on this project"] });
    // One level of subtasks keeps the board readable.
    if (p.parentId) throw new ApiError("validation_failed", "Subtasks can't have subtasks of their own", { parentId: ["Already a subtask"] });
  }
  if (v.startDate && v.dueDate && v.dueDate < v.startDate) throw new ApiError("validation_failed", "The due date is before the start", { dueDate: ["Before the start date"] });
}

export async function saveTask(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const before = id ? await getTask(s, id) : null;
  const v = check(taskSchema, { ...(before ? { projectId: before.projectId } : {}), ...(raw as object) });
  if (before && v.projectId !== before.projectId) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workTime).where(eq(schema.workTime.taskId, before.id));
    if (n) throw new ApiError("conflict", "Time has been logged on this task, so it stays on its project");
  }
  await checkRefs(s, v, before?.id);
  const completedAt = v.status === "done" ? (before?.completedAt ?? new Date()) : null;
  let row: TaskRow;
  if (before) {
    [row] = await db.update(schema.workTasks).set({ ...v, completedAt, updatedAt: new Date() }).where(eq(schema.workTasks.id, before.id)).returning();
  } else {
    row = await db.transaction(async (tx) => {
      const [p] = await tx.update(schema.workProjects).set({ nextTask: sql`${schema.workProjects.nextTask} + 1` }).where(eq(schema.workProjects.id, v.projectId)).returning({ n: schema.workProjects.nextTask });
      const [{ top }] = await tx.select({ top: sql<number>`coalesce(max(${schema.workTasks.position}), 0)` }).from(schema.workTasks).where(and(eq(schema.workTasks.projectId, v.projectId), eq(schema.workTasks.status, v.status)));
      const [r] = await tx.insert(schema.workTasks).values({ ...v, orgId: s.orgId, number: p.n - 1, position: Number(top) + 1, completedAt, createdBy: s.userId }).returning();
      return r;
    });
  }
  if (row.assigneeId && row.assigneeId !== s.userId && row.assigneeId !== before?.assigneeId) await tellAssignee(s, row).catch(() => {});
  return row;
}

async function tellAssignee(s: Scope, t: TaskRow) {
  const [[by], p] = await Promise.all([db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId)), getProject(s, t.projectId)]);
  const due = t.dueDate ? `Due ${new Date(`${t.dueDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}.` : "";
  await notify(s.orgId, [t.assigneeId], { kind: "work.task_assigned", title: `${by?.name ?? "Someone"} gave you a task: ${t.title}`, body: `${p.name} (${p.code}) · task #${t.number}${due ? `\n${due}` : ""}`, link: `/work/tasks/${t.id}`, values: { task: t.title, project: p.name, by: by?.name ?? "" } });
}

const moveSchema = z.object({ status: z.enum(TASK_STATUSES), before: z.uuid().nullable().default(null), after: z.uuid().nullable().default(null) });
/** Drop a task into a column, between two others (by id). */
export async function moveTask(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const t = await getTask(s, id);
  const v = check(moveSchema, raw);
  const pos = async (x: string | null) => (x ? (await db.select({ p: schema.workTasks.position }).from(schema.workTasks).where(and(eq(schema.workTasks.id, x), eq(schema.workTasks.projectId, t.projectId))))[0]?.p : undefined);
  const [a, b] = [await pos(v.after), await pos(v.before)];
  let position: number;
  if (a !== undefined && b !== undefined) position = (a + b) / 2;
  else if (a !== undefined) position = a + 1;
  else if (b !== undefined) position = b - 1;
  else position = Number((await db.select({ top: sql<number>`coalesce(max(${schema.workTasks.position}), 0)` }).from(schema.workTasks).where(and(eq(schema.workTasks.projectId, t.projectId), eq(schema.workTasks.status, v.status))))[0].top) + 1;
  const [row] = await db.update(schema.workTasks).set({ status: v.status, position, completedAt: v.status === "done" ? (t.completedAt ?? new Date()) : null, updatedAt: new Date() }).where(eq(schema.workTasks.id, t.id)).returning();
  return row;
}

export async function deleteTask(s: Scope, id: string) {
  requireWrite(s);
  const t = await getTask(s, id);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workTime).where(and(eq(schema.workTime.taskId, t.id), sql`${schema.workTime.invoiceId} is not null`));
  if (n) throw new ApiError("conflict", "Time on this task has been invoiced, so it stays. Mark it done instead.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.workTasks).where(eq(schema.workTasks.parentId, t.id));
    await tx.delete(schema.workTasks).where(eq(schema.workTasks.id, t.id));
  });
}

export async function addComment(s: Scope, taskId: string, raw: unknown) {
  const t = await getTask(s, taskId);
  const { body } = check(z.object({ body: z.string().trim().min(1, "Write something").max(5000) }), raw);
  const [c] = await db.insert(schema.workComments).values({ orgId: s.orgId, taskId: t.id, userId: s.userId, body }).returning();
  return c;
}

export async function deleteComment(s: Scope, id: string) {
  const [c] = await db.select().from(schema.workComments).where(and(eq(schema.workComments.id, id), eq(schema.workComments.orgId, s.orgId)));
  if (!c) throw notFound("Comment");
  if (c.userId !== s.userId && !s.manage) throw new ApiError("forbidden", "You can only delete your own comments");
  await db.delete(schema.workComments).where(eq(schema.workComments.id, c.id));
}

/** Tick a checklist item (anyone who can see the task, so assignees can work through it). */
export async function tick(s: Scope, taskId: string, raw: unknown) {
  const t = await getTask(s, taskId);
  const { item, done } = check(z.object({ item: z.string().min(1).max(40), done: z.boolean() }), raw);
  if (!s.write && t.assigneeId !== s.userId) throw new ApiError("forbidden", "Only the assignee or a planner can tick this off");
  const checklist = t.checklist.map((c) => (c.id === item ? { ...c, done } : c));
  await db.update(schema.workTasks).set({ checklist, updatedAt: new Date() }).where(eq(schema.workTasks.id, t.id));
  return { checklist };
}
