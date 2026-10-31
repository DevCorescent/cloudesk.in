// HR+: shifts and rosters (and the shift a person works on a day), overtime
// (found at check-out, approved, paid through payroll), full and final
// settlements (worked out, approved, paid and posted), documents with
// expiry, training and its compliance, grievance and disciplinary cases, and
// the headcount plan against who's actually here.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { caseSchema, documentSchema, overtimeMinutes, overtimePay, overtimeSchema, positionSchema, rosterSchema, settlementLineSchema, settlementLines, shiftMinutes, shiftSchema, structure, trainingSchema, type HrSettings } from "@/lib/hr/model";
import { z } from "zod";
import { cancelFor, gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, oversees, requireEmployee, requireManage, requirePayroll, todayIst, within, type Employee, type Scope } from "./access";

// ── Shifts and rosters ──────────────────────────────────────────────────────

export async function shifts(orgId: string) {
  return db.select().from(schema.hrShifts).where(eq(schema.hrShifts.orgId, orgId)).orderBy(asc(schema.hrShifts.start));
}

export async function saveShift(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(shiftSchema, raw);
  if (shiftMinutes(v) <= 0) throw new ApiError("validation_failed", "The break is longer than the shift");
  if (id) {
    const [r] = await db.update(schema.hrShifts).set(v).where(and(eq(schema.hrShifts.id, id), eq(schema.hrShifts.orgId, s.orgId))).returning();
    if (!r) throw notFound("Shift");
    return r;
  }
  const [r] = await db.insert(schema.hrShifts).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

/** The roster for a week (or any range), for the people this member can see. */
export async function roster(s: Scope, from: string, to: string) {
  const rows = await db.select().from(schema.hrRoster).where(and(eq(schema.hrRoster.orgId, s.orgId), gte(schema.hrRoster.date, from), lte(schema.hrRoster.date, to)));
  return rows.filter((r) => s.manage ? within(s, r.employeeId) : oversees(s, r.employeeId) || s.me?.id === r.employeeId);
}

/** Set shifts for people on days (a null shift is a day off). Managers roster their own people. */
export async function setRoster(s: Scope, raw: unknown) {
  const v = check(rosterSchema, raw);
  for (const e of v.entries) if (!oversees(s, e.employeeId)) throw new ApiError("forbidden", "You can only roster people who report to you");
  const ids = new Set((await shifts(s.orgId)).map((x) => x.id));
  if (v.entries.some((e) => e.shiftId && !ids.has(e.shiftId))) throw new ApiError("validation_failed", "Use shifts from this workspace");
  for (const e of v.entries) await db.insert(schema.hrRoster).values({ ...e, orgId: s.orgId }).onConflictDoUpdate({ target: [schema.hrRoster.employeeId, schema.hrRoster.date], set: { shiftId: e.shiftId } });
  return { count: v.entries.length };
}

/** Copy one week's roster to the next week (or any offset), keeping what's already set there. */
export async function copyRoster(s: Scope, from: string, days: number, toOffset: number) {
  requireManage(s);
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await roster(s, from, to);
  let n = 0;
  for (const r of rows) {
    const date = new Date(Date.parse(`${r.date}T00:00:00Z`) + toOffset * 86_400_000).toISOString().slice(0, 10);
    const [ins] = await db.insert(schema.hrRoster).values({ orgId: s.orgId, employeeId: r.employeeId, date, shiftId: r.shiftId }).onConflictDoNothing().returning();
    if (ins) n++;
  }
  return { copied: n };
}

/** The shift someone works on a day: rostered (null if a day off), else the workspace's usual shift on working days. */
export async function shiftFor(orgId: string, employeeId: string, date: string, st: HrSettings) {
  const [r] = await db.select({ shiftId: schema.hrRoster.shiftId }).from(schema.hrRoster).where(and(eq(schema.hrRoster.orgId, orgId), eq(schema.hrRoster.employeeId, employeeId), eq(schema.hrRoster.date, date)));
  if (r) {
    if (!r.shiftId) return null;
    const [sh] = await db.select().from(schema.hrShifts).where(and(eq(schema.hrShifts.id, r.shiftId), eq(schema.hrShifts.orgId, orgId)));
    return sh ? { start: sh.start, end: sh.end, breakMinutes: sh.breakMinutes, graceMin: sh.graceMin } : null;
  }
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!st.workWeek.includes(dow)) return null;
  return { start: st.shift.start, end: st.shift.end, breakMinutes: 0, graceMin: st.shift.graceMin, fullDay: st.shift.fullDayHours * 60 };
}

// ── Overtime ────────────────────────────────────────────────────────────────

/** Called at check-out: record time past the shift (or a day off's work) as overtime. */
export async function noteOvertime(orgId: string, employeeId: string, date: string, worked: number, st: HrSettings) {
  if (!st.overtime.enabled) return null;
  const sh = await shiftFor(orgId, employeeId, date, st);
  const holiday = (await db.select({ id: schema.hrHolidays.id }).from(schema.hrHolidays).where(and(eq(schema.hrHolidays.orgId, orgId), eq(schema.hrHolidays.date, date), eq(schema.hrHolidays.optional, false)))).length > 0;
  const base = !sh || holiday ? null : "fullDay" in sh && sh.fullDay ? sh.fullDay : shiftMinutes(sh);
  const minutes = overtimeMinutes(worked, base, st.overtime.minMinutes);
  if (!minutes) return null;
  const [r] = await db
    .insert(schema.hrOvertime)
    .values({ orgId, employeeId, date, minutes, source: "auto", status: st.overtime.requireApproval ? "pending" : "approved" })
    .onConflictDoUpdate({ target: [schema.hrOvertime.employeeId, schema.hrOvertime.date], set: { minutes, source: "auto" }, setWhere: sql`${schema.hrOvertime.status} = 'pending' and ${schema.hrOvertime.source} = 'auto'` })
    .returning();
  return r ?? null;
}

export async function overtime(s: Scope, q: { status?: string; month?: string } = {}) {
  const rows = await db
    .select({ o: schema.hrOvertime, name: schema.hrEmployees.name })
    .from(schema.hrOvertime)
    .innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrOvertime.employeeId))
    .where(and(eq(schema.hrOvertime.orgId, s.orgId), q.status ? eq(schema.hrOvertime.status, q.status) : undefined, q.month ? sql`to_char(${schema.hrOvertime.date}, 'YYYY-MM') = ${q.month}` : undefined))
    .orderBy(desc(schema.hrOvertime.date))
    .limit(500);
  return rows.filter((r) => oversees(s, r.o.employeeId) || s.me?.id === r.o.employeeId).map((r) => ({ ...r.o, name: r.name }));
}

/** Overtime added by a manager for their people (approved, since they're the approver). */
export async function addOvertime(s: Scope, raw: unknown) {
  const v = check(overtimeSchema, raw);
  if (!oversees(s, v.employeeId)) throw new ApiError("forbidden", "You can only add overtime for people who report to you");
  if (v.date > todayIst()) throw new ApiError("validation_failed", "That day hasn't happened yet");
  const [r] = await db.insert(schema.hrOvertime).values({ ...v, orgId: s.orgId, source: "manual", status: "approved", decidedBy: s.userId }).onConflictDoUpdate({ target: [schema.hrOvertime.employeeId, schema.hrOvertime.date], set: { minutes: v.minutes, note: v.note, source: "manual", status: "approved", decidedBy: s.userId } }).returning();
  return r;
}

export async function decideOvertime(s: Scope, id: string, approve: boolean) {
  const [o] = await db.select().from(schema.hrOvertime).where(and(eq(schema.hrOvertime.id, id), eq(schema.hrOvertime.orgId, s.orgId)));
  if (!o) throw notFound("Overtime");
  if (!oversees(s, o.employeeId)) throw new ApiError("forbidden", "You can only decide overtime for people who report to you");
  if (o.payrollRunId) throw new ApiError("conflict", "This overtime is already in a payroll run");
  const [r] = await db.update(schema.hrOvertime).set({ status: approve ? "approved" : "rejected", decidedBy: s.userId }).where(eq(schema.hrOvertime.id, id)).returning();
  return r;
}

/** For payroll: approved overtime in the month as one earning line. */
export async function overtimeLine(orgId: string, e: Employee, month: string, st: HrSettings) {
  if (!st.overtime.enabled) return null;
  const [{ minutes }] = await db.select({ minutes: sql<number>`coalesce(sum(${schema.hrOvertime.minutes}),0)::int` }).from(schema.hrOvertime).where(and(eq(schema.hrOvertime.orgId, orgId), eq(schema.hrOvertime.employeeId, e.id), eq(schema.hrOvertime.status, "approved"), sql`to_char(${schema.hrOvertime.date}, 'YYYY-MM') = ${month}`));
  if (!minutes) return null;
  const o = (e.salary ?? {}) as { basicPct?: number; hraPct?: number };
  const basic = structure(e.ctc, { basicPct: o.basicPct ?? st.payroll.basicPct, hraPct: o.hraPct ?? st.payroll.hraPct, pf: st.payroll.pf, pfOnFullBasic: st.payroll.pfOnFullBasic, esi: st.payroll.esi }).basic;
  return { label: `Overtime (${Math.floor(minutes / 60)}h ${minutes % 60}m at ${st.overtime.multiplier}×)`, amount: overtimePay(minutes, basic, st.shift.fullDayHours, st.overtime.multiplier), kind: "earning" as const };
}

// ── Full and final settlement ───────────────────────────────────────────────

async function getSettlement(orgId: string, id: string) {
  const [r] = await db.select().from(schema.hrSettlements).where(and(eq(schema.hrSettlements.id, id), eq(schema.hrSettlements.orgId, orgId)));
  if (!r) throw notFound("Settlement");
  return r;
}

const totalsOf = (lines: { kind: string; amount: number }[]) => {
  const earnings = lines.filter((l) => l.kind === "earning").reduce((a, l) => a + l.amount, 0);
  const recoveries = lines.filter((l) => l.kind === "recovery").reduce((a, l) => a + l.amount, 0);
  return { earnings, recoveries, net: earnings - recoveries };
};

export async function settlements(s: Scope) {
  requirePayroll(s);
  return db.select({ x: schema.hrSettlements, name: schema.hrEmployees.name, empNo: schema.hrEmployees.empNo }).from(schema.hrSettlements).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrSettlements.employeeId)).where(eq(schema.hrSettlements.orgId, s.orgId)).orderBy(desc(schema.hrSettlements.createdAt)).then((r) => r.map((y) => ({ ...y.x, name: y.name, empNo: y.empNo })).filter((y) => within(s, y.employeeId)));
}

/** Work out a settlement for someone on notice or gone: leave encashment, gratuity and notice recovery. */
export async function draftSettlement(s: Scope, employeeId: string) {
  requirePayroll(s);
  const e = await requireEmployee(s.orgId, employeeId);
  if (!within(s, e.id)) throw new ApiError("forbidden", "That person is outside the companies or branches you work with");
  if (e.status === "active") throw new ApiError("conflict", "Start their exit first (People → the person → Exit)");
  const lastDay = e.exitDate ? String(e.exitDate) : todayIst();
  const st = s.settings;
  const o = (e.salary ?? {}) as { basicPct?: number; hraPct?: number };
  const struct = structure(e.ctc, { basicPct: o.basicPct ?? st.payroll.basicPct, hraPct: o.hraPct ?? st.payroll.hraPct, pf: st.payroll.pf, pfOnFullBasic: st.payroll.pfOnFullBasic, esi: st.payroll.esi });
  // Balance of the encashable leave types, as of the last day.
  const types = await db.select().from(schema.hrLeaveTypes).where(and(eq(schema.hrLeaveTypes.orgId, s.orgId), inArray(schema.hrLeaveTypes.code, st.settlement.encashCodes.length ? st.settlement.encashCodes : ["__none__"])));
  let encash = 0;
  if (types.length) {
    const { balances } = await import("./time");
    const b = await balances(s, e.id, Number(lastDay.slice(0, 4)));
    encash = b.filter((x) => types.some((t) => t.id === x.typeId)).reduce((a, x) => a + Math.max(0, x.available ?? 0), 0);
  }
  const lines = settlementLines({ monthlyBasic: struct.basic, monthlyGross: struct.gross, joinDate: String(e.joinDate), lastDay, noticeFrom: e.noticeFrom ? String(e.noticeFrom) : null, noticeDays: st.settlement.noticeDays, encashDays: Math.floor(encash * 2) / 2, gratuityYears: st.settlement.gratuityYears });
  // Assets still with them, flagged for recovery at their value if not returned.
  const assets = await db.select().from(schema.hrAssets).where(and(eq(schema.hrAssets.orgId, s.orgId), eq(schema.hrAssets.employeeId, e.id)));
  // Still held: assets are released (holder cleared) when returned.
  const out = assets;
  const t = totalsOf(lines);
  const [cur] = await db.select().from(schema.hrSettlements).where(eq(schema.hrSettlements.employeeId, e.id));
  if (cur && cur.status !== "draft") throw new ApiError("conflict", "This settlement has gone for approval — it can't be worked out again");
  const values = { orgId: s.orgId, employeeId: e.id, lastDay, lines, ...t, createdBy: s.userId };
  const [r] = cur ? await db.update(schema.hrSettlements).set(values).where(eq(schema.hrSettlements.id, cur.id)).returning() : await db.insert(schema.hrSettlements).values(values).returning();
  return { settlement: r, assetsNotReturned: out.map((a) => ({ id: a.id, name: a.name })) };
}

const linesSchema = z.object({ lines: z.array(settlementLineSchema).max(40) });

/** Change the lines (add a bonus, an advance to recover, an asset not returned). */
export async function editSettlement(s: Scope, id: string, raw: unknown) {
  requirePayroll(s);
  const cur = await getSettlement(s.orgId, id);
  if (cur.status !== "draft") throw new ApiError("conflict", "Only a draft settlement can change");
  const v = check(linesSchema, raw);
  const [r] = await db.update(schema.hrSettlements).set({ lines: v.lines, ...totalsOf(v.lines) }).where(eq(schema.hrSettlements.id, id)).returning();
  return r;
}

export async function submitSettlement(s: Scope, id: string) {
  requirePayroll(s);
  const r = await getSettlement(s.orgId, id);
  if (r.status !== "draft") throw new ApiError("conflict", "Already sent");
  const e = await requireEmployee(s.orgId, r.employeeId);
  const g = await gate(s.orgId, { kind: "hr.settlement", refId: r.id, label: `Full and final · ${e.name}`, amount: Math.abs(r.net), requesterId: s.userId, link: `/hr/settlements` });
  const status = g.status === "pending" ? "pending_approval" : "approved";
  await db.update(schema.hrSettlements).set({ status }).where(eq(schema.hrSettlements.id, id));
  return { status };
}

export async function settlementDecided(orgId: string, id: string, approved: boolean) {
  await db.update(schema.hrSettlements).set({ status: approved ? "approved" : "draft" }).where(and(eq(schema.hrSettlements.id, id), eq(schema.hrSettlements.orgId, orgId), eq(schema.hrSettlements.status, "pending_approval")));
}

export async function paySettlement(s: Scope, id: string, raw: unknown) {
  requirePayroll(s);
  const r = await getSettlement(s.orgId, id);
  if (r.status !== "approved") throw new ApiError("conflict", r.status === "pending_approval" ? "Waiting for approval" : "Approve it first");
  const v = check(z.object({ accountId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), raw);
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, v.accountId)));
  if (!acc || !["bank", "cash"].includes(acc.subtype)) throw new ApiError("validation_failed", "Pay from a bank or cash account");
  const [out] = await db.update(schema.hrSettlements).set({ status: "paid", accountId: v.accountId, paidOn: v.date }).where(eq(schema.hrSettlements.id, id)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.settlement_paid", targetType: "hr_settlement", targetId: id, metadata: { net: r.net } });
  return out;
}

export async function cancelSettlement(s: Scope, id: string) {
  requirePayroll(s);
  const r = await getSettlement(s.orgId, id);
  if (r.status === "paid") throw new ApiError("conflict", "A paid settlement can't be cancelled");
  if (r.status === "pending_approval") await cancelFor(s.orgId, "hr.settlement", id, s.userId, "The settlement was withdrawn");
  await db.delete(schema.hrSettlements).where(eq(schema.hrSettlements.id, id));
}

/** For the books: a paid settlement is a cost (earnings), income (recoveries) and money out (or in). */
export async function settlementWants(orgId: string, ofEmployee: (id: string) => { companyId: string; branchId: string | null; costCentreId?: string | null }) {
  const rows = await db.select({ x: schema.hrSettlements, name: schema.hrEmployees.name }).from(schema.hrSettlements).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrSettlements.employeeId)).where(and(eq(schema.hrSettlements.orgId, orgId), eq(schema.hrSettlements.status, "paid")));
  return rows
    .filter(({ x }) => x.accountId && x.paidOn && (x.earnings || x.recoveries))
    .map(({ x, name }) => {
      const ref = ofEmployee(x.employeeId);
      const lines = [{ key: "salaries", debit: x.earnings, credit: 0, costCentreId: ref.costCentreId ?? null }, { key: "other_income", debit: 0, credit: x.recoveries }, x.net >= 0 ? { accountId: x.accountId!, debit: 0, credit: x.net } : { accountId: x.accountId!, debit: -x.net, credit: 0 }];
      return { sourceType: "settlement", sourceId: x.id, date: String(x.paidOn), narration: `Full and final settlement · ${name}`, sourceRef: "F&F", party: name, lines, companyId: ref.companyId, branchId: ref.branchId };
    });
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function documents(s: Scope, q: { employeeId?: string; expiring?: string } = {}) {
  const soon = new Date(Date.now() + 5.5 * 3600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ d: schema.hrDocuments, name: schema.hrEmployees.name }).from(schema.hrDocuments).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrDocuments.employeeId)).where(and(eq(schema.hrDocuments.orgId, s.orgId), q.employeeId ? eq(schema.hrDocuments.employeeId, q.employeeId) : undefined, q.expiring ? sql`${schema.hrDocuments.validTo} <= ${soon}` : undefined)).orderBy(asc(schema.hrDocuments.validTo));
  return rows.filter((r) => s.me?.id === r.d.employeeId || oversees(s, r.d.employeeId)).map((r) => ({ ...r.d, name: r.name, expired: !!r.d.validTo && String(r.d.validTo) < todayIst() }));
}

export async function saveDocument(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(documentSchema, raw);
  const e = await requireEmployee(s.orgId, v.employeeId);
  if (!within(s, e.id)) throw new ApiError("forbidden", "That person is outside the companies or branches you work with");
  if (v.issuedOn && v.validTo && v.validTo < v.issuedOn) throw new ApiError("validation_failed", "It can't expire before it's issued");
  if (id) {
    const [r] = await db.update(schema.hrDocuments).set(v).where(and(eq(schema.hrDocuments.id, id), eq(schema.hrDocuments.orgId, s.orgId))).returning();
    if (!r) throw notFound("Document");
    return r;
  }
  const [r] = await db.insert(schema.hrDocuments).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return r;
}

export async function deleteDocument(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrDocuments).where(and(eq(schema.hrDocuments.id, id), eq(schema.hrDocuments.orgId, s.orgId)));
}

// ── Training ────────────────────────────────────────────────────────────────

export async function trainings(s: Scope) {
  const [ts, recs, people] = await Promise.all([
    db.select().from(schema.hrTrainings).where(eq(schema.hrTrainings.orgId, s.orgId)).orderBy(asc(schema.hrTrainings.title)),
    db.select().from(schema.hrTrainingRecords).where(eq(schema.hrTrainingRecords.orgId, s.orgId)),
    db.select({ id: schema.hrEmployees.id, departmentId: schema.hrEmployees.departmentId }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, s.orgId), eq(schema.hrEmployees.status, "active"))),
  ]);
  const today = todayIst();
  return ts.map((t) => {
    const mine = recs.filter((r) => r.trainingId === t.id);
    const valid = (r: (typeof recs)[number]) => r.status === "completed" && (!t.validMonths || (r.completedOn && new Date(Date.parse(`${r.completedOn}T00:00:00Z`) + t.validMonths * 30.44 * 86_400_000).toISOString().slice(0, 10) >= today));
    const needs = t.mandatory ? people.filter((p) => !t.departmentIds.length || (p.departmentId && t.departmentIds.includes(p.departmentId))) : [];
    return { ...t, assigned: mine.filter((r) => r.status === "assigned").length, completed: mine.filter((r) => r.status === "completed").length, missing: needs.filter((p) => !mine.some((r) => r.employeeId === p.id && valid(r))).length, required: needs.length };
  });
}

export async function saveTraining(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(trainingSchema, raw);
  if (id) {
    const [r] = await db.update(schema.hrTrainings).set(v).where(and(eq(schema.hrTrainings.id, id), eq(schema.hrTrainings.orgId, s.orgId))).returning();
    if (!r) throw notFound("Training");
    return r;
  }
  const [r] = await db.insert(schema.hrTrainings).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

const recordSchema = z.object({ employeeIds: z.array(z.uuid()).min(1).max(1000), status: z.enum(["assigned", "completed"]), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), score: z.number().min(0).max(100).nullable().default(null) });

/** Assign people a training, or record that they've done it. */
export async function recordTraining(s: Scope, trainingId: string, raw: unknown) {
  const v = check(recordSchema, raw);
  const [t] = await db.select().from(schema.hrTrainings).where(and(eq(schema.hrTrainings.id, trainingId), eq(schema.hrTrainings.orgId, s.orgId)));
  if (!t) throw notFound("Training");
  for (const id of v.employeeIds) if (!oversees(s, id)) throw new ApiError("forbidden", "You can only record training for people who report to you");
  if (v.status === "completed" && !v.completedOn) throw new ApiError("validation_failed", "When was it completed?");
  for (const employeeId of v.employeeIds) {
    const [open] = await db.select().from(schema.hrTrainingRecords).where(and(eq(schema.hrTrainingRecords.trainingId, trainingId), eq(schema.hrTrainingRecords.employeeId, employeeId), eq(schema.hrTrainingRecords.status, "assigned")));
    if (open) await db.update(schema.hrTrainingRecords).set({ status: v.status, due: v.due ?? open.due, completedOn: v.completedOn, score: v.score }).where(eq(schema.hrTrainingRecords.id, open.id));
    else await db.insert(schema.hrTrainingRecords).values({ orgId: s.orgId, trainingId, employeeId, status: v.status, due: v.due, completedOn: v.completedOn, score: v.score });
  }
  return { count: v.employeeIds.length };
}

export async function trainingRecords(s: Scope, q: { employeeId?: string; trainingId?: string }) {
  const rows = await db.select({ r: schema.hrTrainingRecords, name: schema.hrEmployees.name, title: schema.hrTrainings.title }).from(schema.hrTrainingRecords).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrTrainingRecords.employeeId)).innerJoin(schema.hrTrainings, eq(schema.hrTrainings.id, schema.hrTrainingRecords.trainingId)).where(and(eq(schema.hrTrainingRecords.orgId, s.orgId), q.employeeId ? eq(schema.hrTrainingRecords.employeeId, q.employeeId) : undefined, q.trainingId ? eq(schema.hrTrainingRecords.trainingId, q.trainingId) : undefined)).orderBy(desc(schema.hrTrainingRecords.createdAt));
  return rows.filter((x) => s.me?.id === x.r.employeeId || oversees(s, x.r.employeeId)).map((x) => ({ ...x.r, name: x.name, title: x.title }));
}

// ── Grievances and disciplinary cases ───────────────────────────────────────

async function nextCase(orgId: string, kind: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int + 1` }).from(schema.hrCases).where(and(eq(schema.hrCases.orgId, orgId), eq(schema.hrCases.kind, kind)));
  return `${kind === "grievance" ? "GR" : "DC"}-${String(n).padStart(4, "0")}`;
}

/** HR admins see every case; the person who raised a grievance, and whoever it's assigned to, see that one. */
const canSee = (s: Scope, c: typeof schema.hrCases.$inferSelect) => (s.manage && (!c.employeeId || within(s, c.employeeId))) || c.createdBy === s.userId || c.assignedTo === s.userId;

export async function cases(s: Scope, q: { kind?: string } = {}) {
  const rows = await db.select({ c: schema.hrCases, name: schema.hrEmployees.name }).from(schema.hrCases).leftJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrCases.employeeId)).where(and(eq(schema.hrCases.orgId, s.orgId), q.kind ? eq(schema.hrCases.kind, q.kind) : undefined)).orderBy(desc(schema.hrCases.createdAt));
  return rows.filter((r) => canSee(s, r.c)).map((r) => ({ ...r.c, name: r.c.anonymous && !s.manage ? null : r.name, employeeId: r.c.anonymous && !s.manage ? null : r.c.employeeId }));
}

export async function openCase(s: Scope, raw: unknown) {
  const v = check(caseSchema, raw);
  // Anyone raises their own grievance; disciplinary cases are opened by HR.
  if (v.kind === "disciplinary") {
    requireManage(s);
    if (!v.employeeId) throw new ApiError("validation_failed", "Who is it about?");
    await requireEmployee(s.orgId, v.employeeId);
  } else {
    if (!s.me && !s.manage) throw new ApiError("forbidden", "Only employees can raise a grievance");
    v.employeeId = s.manage && v.employeeId ? v.employeeId : s.me?.id ?? null;
  }
  const number = await nextCase(s.orgId, v.kind);
  const [r] = await db.insert(schema.hrCases).values({ ...v, number, orgId: s.orgId, createdBy: s.userId, timeline: [{ at: new Date().toISOString(), by: s.userId, note: "Opened" }] }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.case_opened", targetType: "hr_case", targetId: r.id, metadata: { number, kind: v.kind } });
  return r;
}

const caseUpdate = z.object({ status: z.enum(["open", "investigating", "resolved", "closed"]).optional(), assignedTo: z.uuid().nullable().optional(), action: z.enum(["none", "verbal_warning", "written_warning", "final_warning", "suspension", "termination"]).optional(), outcome: z.string().trim().max(4000).optional(), note: z.string().trim().max(2000).default("") });

export async function updateCase(s: Scope, id: string, raw: unknown) {
  const [c] = await db.select().from(schema.hrCases).where(and(eq(schema.hrCases.id, id), eq(schema.hrCases.orgId, s.orgId)));
  if (!c || !canSee(s, c)) throw notFound("Case");
  const v = check(caseUpdate, raw);
  // The person who raised it can only add notes; investigators and HR move it along.
  const runs = s.manage || c.assignedTo === s.userId;
  if (!runs && (v.status || v.assignedTo !== undefined || v.action || v.outcome !== undefined)) throw new ApiError("forbidden", "Only HR or the person investigating can change this");
  if (v.assignedTo !== undefined) requireManage(s);
  if (v.action && v.action !== "none" && c.kind !== "disciplinary") throw new ApiError("validation_failed", "Actions are for disciplinary cases");
  if (v.status === "closed" && !(v.outcome ?? c.outcome).trim()) throw new ApiError("validation_failed", "Record the outcome before closing");
  const note = [v.status && v.status !== c.status ? `Status: ${v.status}` : "", v.action && v.action !== c.action ? `Action: ${v.action.replace(/_/g, " ")}` : "", v.note].filter(Boolean).join(" · ");
  const [r] = await db.update(schema.hrCases).set({ ...(v.status ? { status: v.status } : {}), ...(v.assignedTo !== undefined ? { assignedTo: v.assignedTo } : {}), ...(v.action ? { action: v.action } : {}), ...(v.outcome !== undefined ? { outcome: v.outcome } : {}), ...(note ? { timeline: [...c.timeline, { at: new Date().toISOString(), by: s.userId, note }] } : {}), ...(v.status === "closed" ? { closedAt: new Date() } : {}) }).where(eq(schema.hrCases.id, id)).returning();
  return r;
}

// ── Headcount plan ──────────────────────────────────────────────────────────

/** The plan by department and role, against active people (by department and designation) and their cost. */
export async function workforce(s: Scope) {
  requireManage(s);
  const [positions, people, depts] = await Promise.all([
    db.select().from(schema.hrPositions).where(eq(schema.hrPositions.orgId, s.orgId)),
    db.select({ id: schema.hrEmployees.id, departmentId: schema.hrEmployees.departmentId, designation: schema.hrEmployees.designation, ctc: schema.hrEmployees.ctc, status: schema.hrEmployees.status }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, s.orgId), inArray(schema.hrEmployees.status, ["active", "notice"]))),
    db.select().from(schema.hrDepartments).where(eq(schema.hrDepartments.orgId, s.orgId)),
  ]);
  const rows = positions.map((p) => {
    const filled = people.filter((e) => e.departmentId === p.departmentId && e.designation.trim().toLowerCase() === p.title.trim().toLowerCase());
    return { ...p, department: depts.find((d) => d.id === p.departmentId)?.name ?? "No department", filled: filled.length, leaving: filled.filter((e) => e.status === "notice").length, open: Math.max(0, p.planned - filled.filter((e) => e.status === "active").length), actualCtc: filled.reduce((a, e) => a + e.ctc, 0), plannedCtc: p.planned * p.budgetCtc };
  });
  const byDept = depts.map((d) => ({ id: d.id, name: d.name, planned: rows.filter((r) => r.departmentId === d.id).reduce((a, r) => a + r.planned, 0), actual: people.filter((e) => e.departmentId === d.id).length }));
  return { positions: rows, departments: byDept, totals: { planned: rows.reduce((a, r) => a + r.planned, 0), actual: people.length, open: rows.reduce((a, r) => a + r.open, 0), plannedCtc: rows.reduce((a, r) => a + r.plannedCtc, 0), actualCtc: people.reduce((a, e) => a + e.ctc, 0) } };
}

export async function savePosition(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(positionSchema, raw);
  if (id) {
    const [r] = await db.update(schema.hrPositions).set(v).where(and(eq(schema.hrPositions.id, id), eq(schema.hrPositions.orgId, s.orgId))).returning();
    if (!r) throw notFound("Position");
    return r;
  }
  const [r] = await db.insert(schema.hrPositions).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

export async function deletePosition(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrPositions).where(and(eq(schema.hrPositions.id, id), eq(schema.hrPositions.orgId, s.orgId)));
}

/** Open a hiring role for an open position. */
export async function hireForPosition(s: Scope, id: string) {
  requireManage(s);
  const [p] = await db.select().from(schema.hrPositions).where(and(eq(schema.hrPositions.id, id), eq(schema.hrPositions.orgId, s.orgId)));
  if (!p) throw notFound("Position");
  if (p.jobId) throw new ApiError("conflict", "A hiring role is already open for this position");
  const { saveJob } = await import("./hiring");
  const job = await saveJob(s, { title: p.title, departmentId: p.departmentId, openings: Math.max(1, p.planned), description: p.notes });
  await db.update(schema.hrPositions).set({ jobId: (job as { id: string }).id }).where(eq(schema.hrPositions.id, id));
  return job;
}
