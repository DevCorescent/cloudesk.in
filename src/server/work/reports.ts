// The home screen, reports (hours by project and person, utilisation against
// capacity less HR leave, budgets) and project profit (what was billed or is
// still to bill, against what the hours cost).
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, capacity, hourlyCost, weekDays, weekOf } from "@/lib/work/model";
import { ctcByUser, leaveByUser, partOn, people, requireManage, requirePart, todayIst, type Scope } from "./access";
import { approvals } from "./time";
import { listProjects } from "./projects";
import { listTasks } from "./tasks";

export async function home(s: Scope) {
  const today = todayIst();
  const days = weekDays(weekOf(today));
  const timesheets = partOn(s, "timesheets");
  const [tasks, projects, mine, leave] = await Promise.all([
    listTasks(s, { assignee: "me", status: "open" }),
    listProjects(s, { status: "open" }),
    timesheets ? db.select({ date: schema.workTime.date, m: sql<number>`sum(${schema.workTime.minutes})::int` }).from(schema.workTime).where(and(eq(schema.workTime.userId, s.userId), eq(schema.workTime.orgId, s.orgId), sql`${schema.workTime.date} between ${days[0]} and ${days[6]}`, sql`${schema.workTime.status} <> 'rejected'`)).groupBy(schema.workTime.date) : [],
    leaveByUser(s.orgId, days[0], days[6]),
  ]);
  const myLeave = [...(leave.get(s.userId)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const waiting = s.manage && timesheets ? await approvals(s) : [];
  const sorted = tasks.sort((a, b) => (a.dueDate ?? "9999") .localeCompare(b.dueDate ?? "9999") || a.position - b.position);
  return {
    tasks: sorted.slice(0, 12),
    counts: { open: tasks.length, overdue: tasks.filter((t) => t.overdue).length, dueToday: tasks.filter((t) => t.dueDate === today).length },
    week: { days, logged: Object.fromEntries(mine.map((m) => [m.date, m.m])), total: mine.reduce((n, m) => n + m.m, 0), capacity: capacity(days, s.settings, myLeave) },
    projects: projects.filter((p) => s.manage || p.leadId === s.userId || p.members.includes(s.userId)).slice(0, 8),
    atRisk: projects.filter((p) => (p.burn ?? 0) >= 0.9 || (p.dueDate && p.dueDate < today) || p.stats.overdue > 0).slice(0, 6).map((p) => ({ id: p.id, name: p.name, code: p.code, burn: p.burn, overdue: p.stats.overdue, late: !!p.dueDate && p.dueDate < today })),
    approvals: waiting.length,
    activeProjects: projects.filter((p) => p.status === "active").length,
  };
}

const range = (q: { from?: string; to?: string }) => {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = ok(q.to) ? q.to! : todayIst();
  const from = ok(q.from) ? q.from! : addDays(to, -29);
  return from <= to ? { from, to } : { from: to, to: from };
};

export async function reports(s: Scope, q: { from?: string; to?: string }) {
  requirePart(s, "timesheets");
  const r = range(q);
  const own = s.manage ? sql`` : sql`and t.user_id = ${s.userId}`;
  const byProject = (await db.execute(sql`
    select p.id, p.code, p.name, p.client_name, sum(t.minutes)::int as minutes, coalesce(sum(t.minutes) filter (where t.billable), 0)::int as billable
    from work_time t join work_projects p on p.id = t.project_id
    where t.org_id = ${s.orgId} and t.status <> 'rejected' and t.date between ${r.from} and ${r.to} ${own}
    group by p.id order by 5 desc`)) as unknown as { rows: { id: string; code: string; name: string; client_name: string; minutes: number; billable: number }[] };
  const byPerson = (await db.execute(sql`
    select t.user_id, u.name, sum(t.minutes)::int as minutes, coalesce(sum(t.minutes) filter (where t.billable), 0)::int as billable
    from work_time t join users u on u.id = t.user_id
    where t.org_id = ${s.orgId} and t.status <> 'rejected' and t.date between ${r.from} and ${r.to} ${own}
    group by t.user_id, u.name order by 3 desc`)) as unknown as { rows: { user_id: string; name: string; minutes: number; billable: number }[] };
  const days: string[] = [];
  for (let d = r.from; d <= r.to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const leave = await leaveByUser(s.orgId, r.from, r.to);
  const team = s.manage ? await people(s.orgId) : [];
  const everyone = new Map(byPerson.rows.map((p) => [p.user_id, p]));
  // Everyone on the team appears, so someone with no time logged shows as 0%.
  for (const t of team) if (!everyone.has(t.id)) everyone.set(t.id, { user_id: t.id, name: t.name, minutes: 0, billable: 0 });
  const persons = [...everyone.values()].map((p) => {
    const off = [...(leave.get(p.user_id)?.values() ?? [])].reduce((a, b) => a + b, 0);
    const cap = capacity(days, s.settings, off);
    return { userId: p.user_id, name: p.name, minutes: p.minutes, billable: p.billable, capacity: cap, leaveDays: off, utilisation: cap ? p.minutes / cap : null, billableShare: p.minutes ? p.billable / p.minutes : null };
  });
  const open = (await listProjects(s, { status: "open" })).map((p) => ({ id: p.id, code: p.code, name: p.name, budgetHours: p.budgetHours, budgetAmount: p.budgetAmount, minutes: p.stats.minutes, used: p.stats.used, burn: p.burn, tasks: p.stats.tasks, done: p.stats.done, dueDate: p.dueDate }));
  const daily = (await db.execute(sql`
    select t.date::text as date, sum(t.minutes)::int as minutes, coalesce(sum(t.minutes) filter (where t.billable), 0)::int as billable
    from work_time t where t.org_id = ${s.orgId} and t.status <> 'rejected' and t.date between ${r.from} and ${r.to} ${own}
    group by 1 order by 1`)) as unknown as { rows: { date: string; minutes: number; billable: number }[] };
  return {
    ...r,
    totals: { minutes: byProject.rows.reduce((n, x) => n + x.minutes, 0), billable: byProject.rows.reduce((n, x) => n + x.billable, 0) },
    byProject: byProject.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, client: x.client_name, minutes: x.minutes, billable: x.billable })),
    byPerson: persons.sort((a, b) => b.minutes - a.minutes),
    budgets: open.filter((p) => p.burn !== null).sort((a, b) => (b.burn ?? 0) - (a.burn ?? 0)),
    daily: daily.rows,
    everyone: s.manage,
  };
}

/**
 * Profit by project: revenue is what's been invoiced from it (not voided) plus
 * billable time still to bill at its rate, and for fixed-fee projects the fee;
 * cost is each person's hours at their cost rate — set on the project, or from
 * their HR salary for those allowed to see salaries.
 */
export async function profit(s: Scope, q: { status?: string } = {}) {
  requireManage(s);
  requirePart(s, "profit");
  const projects = await db.select().from(schema.workProjects).where(and(eq(schema.workProjects.orgId, s.orgId), q.status === "all" ? sql`true` : sql`${schema.workProjects.status} <> 'cancelled'`)).orderBy(asc(schema.workProjects.name));
  if (!projects.length) return { projects: [], usesHr: s.payroll, missingCost: [] };
  const time = (await db.execute(sql`
    select t.project_id, t.user_id, u.name, sum(t.minutes)::int as minutes,
      coalesce(sum(t.minutes) filter (where t.billable and t.invoice_id is null), 0)::int as unbilled,
      coalesce(sum(round(t.minutes * coalesce(m.rate, p.rate) / 60.0)) filter (where t.billable and t.invoice_id is null), 0)::bigint as unbilled_value,
      m.cost_rate
    from work_time t join work_projects p on p.id = t.project_id join users u on u.id = t.user_id
      left join work_members m on m.project_id = t.project_id and m.user_id = t.user_id
    where t.org_id = ${s.orgId} and t.status <> 'rejected' and t.timer_started_at is null
    group by t.project_id, t.user_id, u.name, m.cost_rate`)) as unknown as { rows: { project_id: string; user_id: string; name: string; minutes: number; unbilled: number; unbilled_value: number; cost_rate: number | null }[] };
  const invoiced = (await db.execute(sql`
    select x.project_id, sum(d.subtotal - d.discount_total)::bigint as amount from (
      select distinct project_id, invoice_id from work_time where org_id = ${s.orgId} and invoice_id is not null
      union select project_id, invoice_id from work_milestones where org_id = ${s.orgId} and invoice_id is not null
      union select project_id, invoice_id from work_expenses where org_id = ${s.orgId} and invoice_id is not null
    ) x join invoice_documents d on d.id = x.invoice_id and d.status <> 'void'
    group by x.project_id`)) as unknown as { rows: { project_id: string; amount: number }[] };
  // Spend on each project, what's re-charged (amount plus markup), and the part of that already invoiced.
  const spend = (await db.execute(sql`
    select project_id, coalesce(sum(amount), 0)::bigint as spent,
      coalesce(sum(round(amount * (1 + markup_pct / 100.0))) filter (where billable), 0)::bigint as charged,
      coalesce(sum(round(amount * (1 + markup_pct / 100.0))) filter (where billable and invoice_id is not null), 0)::bigint as billed
    from work_expenses where org_id = ${s.orgId} group by project_id`)) as unknown as { rows: { project_id: string; spent: number; charged: number; billed: number }[] };
  // An invoice can carry several projects only if made by hand; each project counts it once.
  const ctc = s.payroll ? await ctcByUser(s.orgId, [...new Set(time.rows.map((t) => t.user_id))]) : new Map<string, number>();
  const missing = new Map<string, string>();
  const out = projects.map((p) => {
    const rows = time.rows.filter((t) => t.project_id === p.id);
    let cost = 0;
    for (const r of rows) {
      const rate = r.cost_rate ?? (ctc.has(r.user_id) ? hourlyCost(ctc.get(r.user_id)!, s.settings) : null);
      if (rate === null) missing.set(r.user_id, r.name);
      else cost += Math.round((r.minutes * Number(rate)) / 60);
    }
    const billed = Number(invoiced.rows.find((i) => i.project_id === p.id)?.amount ?? 0);
    const ex = spend.rows.find((x) => x.project_id === p.id);
    const exp = { spent: Number(ex?.spent ?? 0), charged: p.billing === "none" ? 0 : Number(ex?.charged ?? 0), billed: Number(ex?.billed ?? 0) };
    // Invoiced for the work itself, leaving out re-charged expenses.
    const work = billed - exp.billed;
    // Hourly: billable time not yet invoiced. Fixed fee: the part of the fee not yet invoiced. Plus expenses to re-charge.
    const toBill = (p.billing === "hourly" ? rows.reduce((n, r) => n + Number(r.unbilled_value), 0) : p.billing === "fixed" ? Math.max(0, Number(p.fee) - work) : 0) + Math.max(0, exp.charged - exp.billed);
    const revenue = p.billing === "fixed" ? Math.max(Number(p.fee), work) + exp.charged : p.billing === "none" ? 0 : billed + toBill;
    cost += exp.spent;
    const minutes = rows.reduce((n, r) => n + r.minutes, 0);
    return { id: p.id, code: p.code, name: p.name, client: p.clientName, status: p.status, billing: p.billing, minutes, billed, toBill, revenue, cost, expenses: exp.spent, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : null, effectiveRate: minutes ? Math.round((revenue * 60) / minutes) : null };
  });
  return { projects: out.filter((p) => p.minutes || p.revenue || p.expenses), usesHr: s.payroll, missingCost: [...missing.entries()].map(([id, name]) => ({ id, name })) };
}
