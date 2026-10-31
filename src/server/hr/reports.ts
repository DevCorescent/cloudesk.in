// The HR home (yours and the team's day) and the reports: headcount, joiners
// and leavers, attrition, payroll cost and leave taken.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { oversees, todayIst, type Scope } from "./access";
import { settleExits } from "./employees";
import { claims } from "./payroll";
import { balances, leaveRequests, regularisations, today as todayBoard } from "./time";
import { announcements, birthdaysAndAnniversaries } from "./talent";

const E = schema.hrEmployees;

export async function home(s: Scope) {
  await settleExits(s.orgId);
  const date = todayIst();
  const month = date.slice(0, 7);
  const team = s.manage || s.payroll || s.reports.size > 0;
  const [mine, board, leaves, regs, cls, news, celebrations, holidays, people] = await Promise.all([
    s.me ? Promise.all([db.select().from(schema.hrAttendance).where(and(eq(schema.hrAttendance.employeeId, s.me.id), eq(schema.hrAttendance.date, date))).then((r) => r[0] ?? null), balances(s, s.me.id)]) : null,
    team ? todayBoard(s) : null,
    leaveRequests(s, { status: "pending" }),
    regularisations(s),
    claims(s, { status: "pending" }),
    announcements(s.orgId),
    birthdaysAndAnniversaries(s.orgId),
    db.select().from(schema.hrHolidays).where(and(eq(schema.hrHolidays.orgId, s.orgId), gte(schema.hrHolidays.date, date))).orderBy(asc(schema.hrHolidays.date)).limit(4),
    s.manage || s.payroll ? db.select().from(E).where(eq(E.orgId, s.orgId)) : [],
  ]);
  const active = people.filter((p) => p.status !== "exited");
  const in30 = new Date(Date.parse(`${date}T00:00:00Z`) + 30 * 86400_000).toISOString().slice(0, 10);
  const run = s.payroll ? (await db.select().from(schema.hrPayrollRuns).where(eq(schema.hrPayrollRuns.orgId, s.orgId)).orderBy(desc(schema.hrPayrollRuns.month)).limit(1))[0] ?? null : null;
  return {
    date,
    me: s.me ? { employee: { id: s.me.id, name: s.me.name, designation: s.me.designation }, attendance: mine![0], balances: mine![1].filter((b) => !b.unlimited) } : null,
    team: board
      ? {
          off: board.off,
          total: board.people.length,
          in: board.people.filter((p) => p.status === "in" || p.status === "out").length,
          late: board.people.filter((p) => p.late).length,
          leave: board.people.filter((p) => p.status === "leave").length,
          notIn: board.people.filter((p) => p.status === "not_in").length,
          away: board.people.filter((p) => p.status === "leave").map((p) => ({ id: p.id, name: p.name, leave: p.leave })),
        }
      : null,
    approvals: { leave: leaves.filter((l) => l.canDecide), corrections: regs.filter((r) => r.canDecide), claims: cls.filter((c) => c.canDecide) },
    stats:
      s.manage || s.payroll
        ? {
            headcount: active.length,
            joinedThisMonth: people.filter((p) => String(p.joinDate).startsWith(month)).length,
            leftThisMonth: people.filter((p) => p.exitDate && String(p.exitDate).startsWith(month) && String(p.exitDate) <= date).length,
            onNotice: people.filter((p) => p.status === "notice").map((p) => ({ id: p.id, name: p.name, exitDate: p.exitDate })),
            probation: active.filter((p) => p.probationEnd && String(p.probationEnd) >= date && String(p.probationEnd) <= in30).map((p) => ({ id: p.id, name: p.name, probationEnd: p.probationEnd })),
            noSalary: active.filter((p) => !p.ctc).length,
            notLinked: active.filter((p) => !p.userId).length,
          }
        : null,
    payroll: run,
    announcements: news,
    celebrations,
    holidays,
  };
}

export async function reports(s: Scope, year: number) {
  const people = await db.select().from(E).where(eq(E.orgId, s.orgId));
  const visible = s.manage || s.payroll ? people : people.filter((p) => oversees(s, p.id));
  const depts = await db.select().from(schema.hrDepartments).where(eq(schema.hrDepartments.orgId, s.orgId));
  const locs = await db.select().from(schema.hrLocations).where(eq(schema.hrLocations.orgId, s.orgId));
  const date = todayIst();
  const active = visible.filter((p) => p.status !== "exited");
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const headAt = (d: string) => visible.filter((p) => String(p.joinDate) <= d && (!p.exitDate || String(p.exitDate) >= d)).length;
  const flow = months.map((m) => {
    const end = `${m}-31`;
    return { month: m, joined: visible.filter((p) => String(p.joinDate).startsWith(m)).length, left: visible.filter((p) => p.exitDate && String(p.exitDate).startsWith(m) && String(p.exitDate) <= date).length, headcount: m <= date.slice(0, 7) ? headAt(end > date ? date : end) : null };
  });
  const leftYear = flow.reduce((a, f) => a + f.left, 0);
  const counted = flow.filter((f) => f.headcount !== null);
  const avgHead = counted.length ? counted.reduce((a, f) => a + (f.headcount ?? 0), 0) / counted.length : 0;
  const by = <K extends string>(key: (p: (typeof active)[number]) => K, label: (k: K) => string) => {
    const m = new Map<string, number>();
    for (const p of active) m.set(label(key(p)), (m.get(label(key(p))) ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const payroll = s.payroll ? await db.select({ month: schema.hrPayrollRuns.month, totals: schema.hrPayrollRuns.totals, status: schema.hrPayrollRuns.status }).from(schema.hrPayrollRuns).where(and(eq(schema.hrPayrollRuns.orgId, s.orgId), gte(schema.hrPayrollRuns.month, `${year}-01`), lte(schema.hrPayrollRuns.month, `${year}-12`))).orderBy(asc(schema.hrPayrollRuns.month)) : [];
  const ids = visible.map((p) => p.id);
  const leaveRows = ids.length
    ? await db
        .select({ type: schema.hrLeaveTypes.name, color: schema.hrLeaveTypes.color, days: sql<number>`sum(${schema.hrLeaveRequests.days})::float` })
        .from(schema.hrLeaveRequests)
        .innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, schema.hrLeaveRequests.leaveTypeId))
        .where(and(inArray(schema.hrLeaveRequests.employeeId, ids), eq(schema.hrLeaveRequests.status, "approved"), gte(schema.hrLeaveRequests.fromDate, `${year}-01-01`), lte(schema.hrLeaveRequests.fromDate, `${year}-12-31`)))
        .groupBy(schema.hrLeaveTypes.name, schema.hrLeaveTypes.color)
    : [];
  const tenure = active.map((p) => (Date.parse(date) - Date.parse(String(p.joinDate))) / (365.25 * 86400_000));
  return {
    year,
    headcount: active.length,
    attrition: avgHead ? Math.round((leftYear / avgHead) * 1000) / 10 : null,
    avgTenureYears: tenure.length ? Math.round((tenure.reduce((a, t) => a + t, 0) / tenure.length) * 10) / 10 : 0,
    flow,
    byDepartment: by((p) => p.departmentId ?? "", (k) => depts.find((d) => d.id === k)?.name ?? "No department"),
    byLocation: by((p) => p.locationId ?? "", (k) => locs.find((l) => l.id === k)?.name ?? "No location"),
    byType: by((p) => p.employmentType, (k) => ({ full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Intern" })[k] ?? k),
    payroll: payroll.map((r) => ({ month: r.month, status: r.status, ...(r.totals as Record<string, number>) })),
    leave: leaveRows.map((r) => ({ type: r.type, color: r.color, days: Number(r.days) })),
    exits: visible.filter((p) => p.exitDate && String(p.exitDate).startsWith(String(year))).map((p) => ({ id: p.id, name: p.name, exitDate: p.exitDate, reason: p.exitReason })),
  };
}

