// "My work": everything waiting on one person, across modules — approvals
// from policies, the approvals modules run themselves (leave, claims,
// attendance corrections, timesheets), and tasks due from Projects and the
// CRM. Each source is only read when its module is on and the person may see it.
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOn, isPartOn, type PartsOff } from "@/lib/workspace/modules";
import type { AuthedContext } from "../http/handler";
import { queue } from "./engine";

export type Todo = { id: string; source: string; title: string; detail: string; link: string; due: string | null; overdue: boolean };

const endOfTodayIst = () => {
  const d = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${d}T23:59:59+05:30`);
};

async function quietly<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

export async function myWork(ctx: AuthedContext, orgId: string) {
  const userId = ctx.user.id;
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const on = (m: Parameters<typeof isOn>[1]) => isOn(org?.modules, m);
  const partsOff = (org?.partsOff ?? {}) as PartsOff;
  const approvals = await queue(orgId, userId);
  const todo: Todo[] = [];

  if (on("hr")) {
    const hr = await quietly(async () => {
      const { scope } = await import("../hr/access");
      const { leaveRequests, regularisations } = await import("../hr/time");
      const { claims } = await import("../hr/payroll");
      const s = await scope(ctx, orgId);
      return {
        leave: isPartOn(partsOff, "hr", "leave") ? (await leaveRequests(s, { status: "pending" })).filter((x) => x.canDecide) : [],
        claims: isPartOn(partsOff, "hr", "claims") ? (await claims(s, { status: "pending" })).filter((x) => x.canDecide) : [],
        corrections: isPartOn(partsOff, "hr", "attendance") ? (await regularisations(s)).filter((x) => x.canDecide) : [],
      };
    }, { leave: [], claims: [], corrections: [] });
    for (const l of hr.leave) todo.push({ id: `leave-${l.id}`, source: "Leave", title: `${l.name} asked for ${l.type}`, detail: `${l.fromDate} to ${l.toDate} · ${l.days} day${l.days === 1 ? "" : "s"}`, link: "/hr/leave", due: String(l.fromDate), overdue: false });
    for (const c of hr.claims) todo.push({ id: `claim-${c.id}`, source: "Expense claim", title: `${c.name}: ${c.category}`, detail: `₹${(c.amount / 100).toLocaleString("en-IN")}`, link: "/hr/claims", due: null, overdue: false });
    for (const r of hr.corrections) todo.push({ id: `corr-${r.id}`, source: "Attendance", title: `${r.name} asked to correct attendance`, detail: String(r.date), link: "/hr/attendance", due: null, overdue: false });
  }

  if (on("work")) {
    const w = await quietly(async () => {
      const { scope } = await import("../work/access");
      const s = await scope(ctx, orgId);
      const { approvals: weeks } = await import("../work/time");
      return { weeks: s.manage && isPartOn(partsOff, "work", "timesheets") ? await weeks(s) : [] };
    }, { weeks: [] as { userId: string; name: string; week: string; minutes: number }[] });
    for (const x of w.weeks) todo.push({ id: `ts-${x.userId}-${x.week}`, source: "Timesheet", title: `${x.name}'s week of ${x.week}`, detail: `${Math.round((x.minutes / 60) * 10) / 10}h sent for approval`, link: "/work/approvals", due: null, overdue: false });
    const tasks = await db
      .select({ id: schema.workTasks.id, title: schema.workTasks.title, due: schema.workTasks.dueDate, project: schema.workProjects.name })
      .from(schema.workTasks)
      .innerJoin(schema.workProjects, eq(schema.workProjects.id, schema.workTasks.projectId))
      .where(and(eq(schema.workTasks.orgId, orgId), eq(schema.workTasks.assigneeId, userId), sql`${schema.workTasks.status} <> 'done'`, lte(schema.workTasks.dueDate, endOfTodayIst().toISOString().slice(0, 10)), sql`${schema.workProjects.status} in ('planned','active','on_hold')`))
      .orderBy(asc(schema.workTasks.dueDate))
      .limit(50);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    for (const t of tasks) todo.push({ id: `task-${t.id}`, source: "Task", title: t.title, detail: t.project, link: `/work/tasks/${t.id}`, due: t.due, overdue: !!t.due && t.due < today });
  }

  if (on("crm")) {
    const tasks = await db
      .select({ id: schema.crmActivities.id, subject: schema.crmActivities.subject, due: schema.crmActivities.dueAt, contactId: schema.crmActivities.contactId })
      .from(schema.crmActivities)
      .where(and(eq(schema.crmActivities.orgId, orgId), eq(schema.crmActivities.kind, "task"), eq(schema.crmActivities.ownerId, userId), isNull(schema.crmActivities.doneAt), lte(schema.crmActivities.dueAt, endOfTodayIst())))
      .orderBy(asc(schema.crmActivities.dueAt))
      .limit(50);
    for (const t of tasks) todo.push({ id: `crm-${t.id}`, source: "CRM task", title: t.subject || "Follow up", detail: "", link: t.contactId ? `/crm/contacts/${t.contactId}` : "/crm/tasks", due: t.due?.toISOString() ?? null, overdue: !!t.due && t.due.getTime() < Date.now() });
  }

  const reminders = await db.select().from(schema.reminders).where(and(eq(schema.reminders.orgId, orgId), eq(schema.reminders.userId, userId), isNull(schema.reminders.sentAt))).orderBy(asc(schema.reminders.at)).limit(20);
  return { approvals, todo, reminders, counts: { approvals: approvals.length, todo: todo.length, overdue: todo.filter((t) => t.overdue).length + approvals.filter((a) => a.overdue).length } };
}
