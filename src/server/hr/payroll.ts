// Payroll and expense claims. A run is one month: every active person's
// payslip is computed from their CTC, loss-of-pay days, one-off adjustments and
// approved claims; it can be checked and adjusted while a draft, then
// finalised (claims become paid) and marked paid. Exports a bank transfer
// file, a register and the statutory totals.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isPartOn } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import { cancelFor, gate } from "../approvals/engine";
import { audit } from "../services/audit";
import { csvEscape } from "@/lib/data/model";
import { computePayslip, daysInMonth } from "@/lib/hr/model";
import { overtimeLine } from "./plus";
import { claimApproved, claimRejected } from "./travel";
import { addEvent, check, isSelf, oversees, requireEmployee, requireMe, requirePayroll, type Employee, type Scope } from "./access";
import { lopFor } from "./time";

const R = schema.hrPayrollRuns;
const P = schema.hrPayslips;
type Adj = { label: string; amount: number; kind: "earning" | "deduction" | "reimbursement"; claimId?: string };

async function computeFor(s: Scope, e: Employee, month: string, adjustments: Adj[]) {
  const { employedDays, lop } = await lopFor(s.orgId, e, month, s.settings, isPartOn(s.partsOff, "hr", "attendance"));
  const loc = e.locationId ? (await db.select({ state: schema.hrLocations.state }).from(schema.hrLocations).where(eq(schema.hrLocations.id, e.locationId)))[0] : undefined;
  const rules = { ...s.settings.payroll, ptState: loc?.state || s.settings.payroll.ptState };
  // Approved overtime in the month is paid as an earning (worked out afresh each time).
  const ot = await overtimeLine(s.orgId, e, month, s.settings);
  return computePayslip({ ctc: e.ctc, rules, overrides: (e.salary ?? {}) as Record<string, never>, month, employedDays, lopDays: lop, gender: e.gender, adjustments: ot ? [...adjustments, ot] : adjustments });
}

export function totalsOf(slips: { data: unknown; gross: number; deductions: number; net: number; hold: boolean }[]) {
  const sum = (code: string, key: "deductions" | "employer") => slips.reduce((a, p) => a + ((p.data as { [k: string]: { code: string; amount: number }[] })[key]?.find((l) => l.code === code)?.amount ?? 0), 0);
  return {
    employees: slips.length,
    held: slips.filter((p) => p.hold).length,
    gross: slips.reduce((a, p) => a + p.gross, 0),
    deductions: slips.reduce((a, p) => a + p.deductions, 0),
    net: slips.reduce((a, p) => a + p.net, 0),
    reimbursements: slips.reduce((a, p) => a + ((p.data as { reimbursements: { amount: number }[] }).reimbursements ?? []).reduce((x, l) => x + l.amount, 0), 0),
    cost: slips.reduce((a, p) => a + (p.data as { cost: number }).cost, 0),
    pf: sum("PF", "deductions"),
    epf: sum("EPF", "employer"),
    esi: sum("ESI", "deductions"),
    eesi: sum("EESI", "employer"),
    pt: sum("PT", "deductions"),
    tds: sum("TDS", "deductions"),
  };
}

async function saveTotals(runId: string) {
  const slips = await db.select().from(P).where(eq(P.runId, runId));
  await db.update(R).set({ totals: totalsOf(slips) }).where(eq(R.id, runId));
}

export async function runs(s: Scope) {
  requirePayroll(s);
  return db.select().from(R).where(eq(R.orgId, s.orgId)).orderBy(desc(R.month));
}

async function requireRun(s: Scope, id: string) {
  const [r] = await db.select().from(R).where(and(eq(R.id, id), eq(R.orgId, s.orgId)));
  if (!r) throw notFound("Payroll run");
  return r;
}

/** Who's paid in a month: joined by its end, not left before it started, with a salary. */
async function payable(orgId: string, month: string) {
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  return db
    .select()
    .from(schema.hrEmployees)
    .where(and(eq(schema.hrEmployees.orgId, orgId), sql`${schema.hrEmployees.ctc} > 0`, sql`${schema.hrEmployees.joinDate} <= ${last}`, sql`(${schema.hrEmployees.exitDate} is null or ${schema.hrEmployees.exitDate} >= ${first})`))
    .orderBy(asc(schema.hrEmployees.empNo));
}

export async function createRun(s: Scope, month: string) {
  requirePayroll(s);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("validation_failed", "Choose a month");
  const [exists] = await db.select({ id: R.id }).from(R).where(and(eq(R.orgId, s.orgId), eq(R.month, month)));
  if (exists) throw new ApiError("conflict", "There's already a payroll run for that month", { existingId: exists.id });
  const people = await payable(s.orgId, month);
  if (!people.length) throw new ApiError("validation_failed", "No one has a salary set for that month — add CTC on their profiles first");
  const [run] = await db.insert(R).values({ orgId: s.orgId, month, createdBy: s.userId }).returning();
  // Approved claims for spending up to the end of this month, not yet paid, go into this run.
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const claims = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.orgId, s.orgId), eq(schema.hrClaims.status, "approved"), isNull(schema.hrClaims.payrollRunId), isNull(schema.hrClaims.tripId), eq(schema.hrClaims.paidBy, "employee"), sql`${schema.hrClaims.date} <= ${last}`));
  for (const e of people) {
    const mine = claims.filter((c) => c.employeeId === e.id);
    const adjustments: Adj[] = mine.map((c) => ({ label: `${c.category} claim`, amount: c.amount, kind: "reimbursement", claimId: c.id }));
    const data = await computeFor(s, e, month, adjustments);
    await db.insert(P).values({ orgId: s.orgId, runId: run.id, employeeId: e.id, data, adjustments, gross: data.gross, deductions: data.deductionsTotal, net: data.net });
    if (mine.length) await db.update(schema.hrClaims).set({ payrollRunId: run.id }).where(inArray(schema.hrClaims.id, mine.map((c) => c.id)));
  }
  await saveTotals(run.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.payroll.created", targetType: "hr_payroll_run", targetId: run.id, metadata: { month } });
  return getRun(s, run.id);
}

export async function getRun(s: Scope, id: string) {
  requirePayroll(s);
  const run = await requireRun(s, id);
  const slips = await db
    .select({ p: P, name: schema.hrEmployees.name, empNo: schema.hrEmployees.empNo, designation: schema.hrEmployees.designation, departmentId: schema.hrEmployees.departmentId, bank: schema.hrEmployees.bank })
    .from(P)
    .innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, P.employeeId))
    .where(eq(P.runId, id))
    .orderBy(asc(schema.hrEmployees.empNo));
  return { run, slips: slips.map((x) => ({ ...x.p, name: x.name, empNo: x.empNo, designation: x.designation, departmentId: x.departmentId, bankReady: !!((x.bank as { account?: string; ifsc?: string })?.account && (x.bank as { ifsc?: string })?.ifsc) })) };
}

function requireDraft(run: { status: string }) {
  if (run.status !== "draft") throw new ApiError("conflict", "This run is finalised — create next month's run for changes");
}

/** Recomputes every payslip (after attendance, leave or salary changes), keeping adjustments. */
export async function recalcRun(s: Scope, id: string) {
  requirePayroll(s);
  const run = await requireRun(s, id);
  requireDraft(run);
  const slips = await db.select().from(P).where(eq(P.runId, id));
  // Claims approved since the run was made join it too.
  const runEnd = `${run.month}-${String(daysInMonth(run.month)).padStart(2, "0")}`;
  const fresh = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.orgId, s.orgId), eq(schema.hrClaims.status, "approved"), isNull(schema.hrClaims.payrollRunId), isNull(schema.hrClaims.tripId), eq(schema.hrClaims.paidBy, "employee"), sql`${schema.hrClaims.date} <= ${runEnd}`));
  for (const p of slips) {
    const e = await requireEmployee(s.orgId, p.employeeId);
    const mine = fresh.filter((c) => c.employeeId === p.employeeId);
    const adjustments = [...(p.adjustments as Adj[]), ...mine.map((c) => ({ label: `${c.category} claim`, amount: c.amount, kind: "reimbursement" as const, claimId: c.id }))];
    const data = await computeFor(s, e, run.month, adjustments);
    await db.update(P).set({ adjustments, data, gross: data.gross, deductions: data.deductionsTotal, net: data.net }).where(eq(P.id, p.id));
    if (mine.length) await db.update(schema.hrClaims).set({ payrollRunId: id }).where(inArray(schema.hrClaims.id, mine.map((c) => c.id)));
  }
  // People who became payable since (joined, or got a salary).
  const have = new Set(slips.map((p) => p.employeeId));
  for (const e of (await payable(s.orgId, run.month)).filter((x) => !have.has(x.id))) {
    const data = await computeFor(s, e, run.month, []);
    await db.insert(P).values({ orgId: s.orgId, runId: id, employeeId: e.id, data, gross: data.gross, deductions: data.deductionsTotal, net: data.net });
  }
  await saveTotals(id);
  return getRun(s, id);
}

const adjSchema = z.array(z.object({ label: z.string().trim().min(1).max(60), amount: z.number().int().min(1).max(1e11), kind: z.enum(["earning", "deduction", "reimbursement"]), claimId: z.string().optional() })).max(20);

export async function setAdjustments(s: Scope, runId: string, employeeId: string, raw: unknown) {
  requirePayroll(s);
  const run = await requireRun(s, runId);
  requireDraft(run);
  const [p] = await db.select().from(P).where(and(eq(P.runId, runId), eq(P.employeeId, employeeId)));
  if (!p) throw notFound("Payslip");
  const keepClaims = (p.adjustments as Adj[]).filter((a) => a.claimId);
  const input = check(adjSchema, raw).filter((a) => !a.claimId);
  const adjustments = [...keepClaims, ...input];
  const data = await computeFor(s, await requireEmployee(s.orgId, employeeId), run.month, adjustments);
  await db.update(P).set({ adjustments, data, gross: data.gross, deductions: data.deductionsTotal, net: data.net }).where(eq(P.id, p.id));
  await saveTotals(runId);
}

export async function holdPayslip(s: Scope, runId: string, employeeId: string, hold: boolean) {
  requirePayroll(s);
  requireDraft(await requireRun(s, runId));
  await db.update(P).set({ hold }).where(and(eq(P.runId, runId), eq(P.employeeId, employeeId)));
  await saveTotals(runId);
}

export async function finaliseRun(s: Scope, id: string) {
  requirePayroll(s);
  const run = await requireRun(s, id);
  requireDraft(run);
  // Payroll that needs approval is finalised when the last approver signs off.
  const net = (run.totals as { net?: number }).net ?? 0;
  const g = await gate(s.orgId, { kind: "hr.payroll", refId: id, label: `Payroll ${run.month}`, amount: net, requesterId: s.userId, link: `/hr/payroll/${id}` });
  if (g.status === "pending") return { ...(await getRun(s, id)), approval: g.request!.id };
  await finalise(s.orgId, id, s.userId);
  return getRun(s, id);
}

async function finalise(orgId: string, id: string, userId: string | null) {
  const [run] = await db.select().from(R).where(and(eq(R.id, id), eq(R.orgId, orgId)));
  await db.update(R).set({ status: "finalised", finalisedAt: new Date() }).where(eq(R.id, id));
  await db.update(schema.hrClaims).set({ status: "paid" }).where(and(eq(schema.hrClaims.payrollRunId, id), eq(schema.hrClaims.status, "approved")));
  // The month's approved overtime is now paid: it can't be changed any more.
  await db.update(schema.hrOvertime).set({ payrollRunId: id }).where(and(eq(schema.hrOvertime.orgId, orgId), eq(schema.hrOvertime.status, "approved"), isNull(schema.hrOvertime.payrollRunId), sql`to_char(${schema.hrOvertime.date}, 'YYYY-MM') = ${run.month}`, sql`${schema.hrOvertime.employeeId} in (select employee_id from hr_payslips where run_id = ${id} and not hold)`));
  await audit({ orgId, actorId: userId, action: "hr.payroll.finalised", targetType: "hr_payroll_run", targetId: id, metadata: { month: run.month, totals: run.totals } });
}

/** After approval: finalise — unless the run changed and now pays more than was approved. */
export async function payrollApproved(orgId: string, id: string, approvedAmount: number, userId: string) {
  const [run] = await db.select().from(R).where(and(eq(R.id, id), eq(R.orgId, orgId)));
  if (!run || run.status !== "draft") return;
  const net = (run.totals as { net?: number }).net ?? 0;
  if (net > approvedAmount) throw new ApiError("conflict", "The run was recalculated and now pays more than was approved — finalise it again to send it for approval");
  await finalise(orgId, id, userId);
}

export async function markRunPaid(s: Scope, id: string) {
  requirePayroll(s);
  const run = await requireRun(s, id);
  if (run.status !== "finalised") throw new ApiError("conflict", "Finalise the run first");
  await db.update(R).set({ status: "paid", paidAt: new Date() }).where(eq(R.id, id));
  return getRun(s, id);
}

export async function deleteRun(s: Scope, id: string) {
  requirePayroll(s);
  const run = await requireRun(s, id);
  requireDraft(run);
  await db.update(schema.hrClaims).set({ payrollRunId: null }).where(eq(schema.hrClaims.payrollRunId, id));
  await db.delete(R).where(eq(R.id, id));
  await cancelFor(s.orgId, "hr.payroll", id, s.userId, "The run was deleted");
}

/** A payslip, for the person or payroll. Draft runs aren't visible to the person yet. */
export async function payslip(s: Scope, id: string) {
  const [row] = await db.select({ p: P, run: R }).from(P).innerJoin(R, eq(R.id, P.runId)).where(and(eq(P.id, id), eq(P.orgId, s.orgId)));
  if (!row) throw notFound("Payslip");
  const mine = isSelf(s, row.p.employeeId);
  if (!s.payroll && !(mine && row.run.status !== "draft")) throw notFound("Payslip");
  const e = await requireEmployee(s.orgId, row.p.employeeId);
  const [dept] = e.departmentId ? await db.select({ name: schema.hrDepartments.name }).from(schema.hrDepartments).where(eq(schema.hrDepartments.id, e.departmentId)) : [];
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const bank = (e.bank ?? {}) as { name?: string; account?: string };
  const ids = (e.ids ?? {}) as { pan?: string; uan?: string };
  return {
    payslip: row.p,
    month: row.run.month,
    status: row.run.status,
    company: { name: s.settings.company.legalName || org?.name || "", address: s.settings.company.address },
    employee: { name: e.name, empNo: e.empNo, designation: e.designation, department: dept?.name ?? "", joinDate: e.joinDate, pan: ids.pan ?? "", uan: ids.uan ?? "", bank: bank.name ?? "", account: bank.account ? `•••• ${bank.account.slice(-4)}` : "" },
  };
}

export async function myPayslips(s: Scope, employeeId?: string) {
  const id = employeeId ?? requireMe(s).id;
  if (!isSelf(s, id) && !s.payroll) throw notFound("Employee");
  await requireEmployee(s.orgId, id);
  const rows = await db.select({ id: P.id, month: R.month, status: R.status, gross: P.gross, net: P.net, deductions: P.deductions }).from(P).innerJoin(R, eq(R.id, P.runId)).where(and(eq(P.employeeId, id), eq(R.orgId, s.orgId), s.payroll ? undefined : sql`${R.status} <> 'draft'`)).orderBy(desc(R.month));
  return rows;
}

export async function bankFile(s: Scope, id: string) {
  const { run, slips } = await getRun(s, id);
  if (run.status === "draft") throw new ApiError("conflict", "Finalise the run before paying it");
  const people = await db.select({ id: schema.hrEmployees.id, bank: schema.hrEmployees.bank }).from(schema.hrEmployees).where(inArray(schema.hrEmployees.id, slips.map((x) => x.employeeId)));
  const lines = [["Employee no", "Name", "Bank account", "IFSC", "Account holder", "Amount", "Narration"].join(",")];
  for (const p of slips.filter((x) => !x.hold && x.net > 0)) {
    const b = (people.find((x) => x.id === p.employeeId)?.bank ?? {}) as { account?: string; ifsc?: string; name?: string };
    lines.push([p.empNo, p.name, b.account ?? "", b.ifsc ?? "", b.name || p.name, (p.net / 100).toFixed(2), `Salary ${run.month}`].map(csvEscape).join(","));
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.payroll.bank_file", targetType: "hr_payroll_run", targetId: id });
  return lines.join("\n");
}

export async function registerCsv(s: Scope, id: string) {
  const { run, slips } = await getRun(s, id);
  const head = ["Employee no", "Name", "Designation", "Days paid", "LOP", "Basic", "HRA", "Special", "Other earnings", "Gross", "PF", "ESI", "PT", "TDS", "Other deductions", "Reimbursements", "Net pay", "Employer PF", "Employer ESI", "Cost to company", "On hold"];
  const lines = [head.join(",")];
  type D = { days: { paid: number; lop: number }; earnings: { code: string; amount: number }[]; deductions: { code: string; amount: number }[]; reimbursements: { amount: number }[]; employer: { code: string; amount: number }[]; cost: number };
  const r = (n: number) => (n / 100).toFixed(2);
  for (const p of slips) {
    const d = p.data as D;
    const e = (c: string) => d.earnings.find((l) => l.code === c)?.amount ?? 0;
    const x = (c: string) => d.deductions.find((l) => l.code === c)?.amount ?? 0;
    const em = (c: string) => d.employer.find((l) => l.code === c)?.amount ?? 0;
    lines.push(
      [p.empNo, p.name, p.designation, d.days.paid, d.days.lop, r(e("BASIC")), r(e("HRA")), r(e("SPECIAL")), r(d.earnings.filter((l) => l.code.startsWith("ADJ")).reduce((a, l) => a + l.amount, 0)), r(p.gross), r(x("PF")), r(x("ESI")), r(x("PT")), r(x("TDS")), r(d.deductions.filter((l) => l.code.startsWith("DED")).reduce((a, l) => a + l.amount, 0)), r(d.reimbursements.reduce((a, l) => a + l.amount, 0)), r(p.net), r(em("EPF")), r(em("EESI")), r(d.cost), p.hold ? "yes" : ""]
        .map(csvEscape)
        .join(","),
    );
  }
  void run;
  return lines.join("\n");
}

// ─── Claims ───

export { submitClaim } from "./travel";

export async function claims(s: Scope, opts: { status?: string; mine?: boolean }) {
  const rows = await db.select({ c: schema.hrClaims, name: schema.hrEmployees.name }).from(schema.hrClaims).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrClaims.employeeId)).where(and(eq(schema.hrClaims.orgId, s.orgId), opts.status ? eq(schema.hrClaims.status, opts.status) : undefined)).orderBy(desc(schema.hrClaims.createdAt)).limit(500);
  return rows.filter((x) => (opts.mine ? isSelf(s, x.c.employeeId) : s.payroll || oversees(s, x.c.employeeId) || isSelf(s, x.c.employeeId))).map((x) => ({ ...x.c, name: x.name, canDecide: x.c.status === "pending" && oversees(s, x.c.employeeId) && (!isSelf(s, x.c.employeeId) || s.manage) }));
}

export async function decideClaim(s: Scope, id: string, action: "approve" | "reject" | "paid", note = "") {
  const [c] = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.id, id), eq(schema.hrClaims.orgId, s.orgId)));
  if (!c) throw notFound("Claim");
  if (action === "paid") {
    requirePayroll(s);
    if (c.status !== "approved" || c.payrollRunId) throw new ApiError("conflict", "Only approved claims not already in a payroll run can be paid outside payroll");
    if (c.tripId) throw new ApiError("conflict", "This claim is paid when its trip is settled, against the advance");
    await db.update(schema.hrClaims).set({ status: "paid" }).where(eq(schema.hrClaims.id, id));
    return;
  }
  if (!oversees(s, c.employeeId) || (isSelf(s, c.employeeId) && !s.manage)) throw new ApiError("forbidden", "Only their manager or HR can decide this");
  if (c.status !== "pending") throw new ApiError("conflict", "Already decided");
  if (action === "approve") {
    // The manager's yes; a workspace policy can add further steps (e.g. finance above an amount).
    const [emp] = await db.select({ userId: schema.hrEmployees.userId, name: schema.hrEmployees.name }).from(schema.hrEmployees).where(eq(schema.hrEmployees.id, c.employeeId));
    const g = await gate(s.orgId, { kind: "hr.claim", refId: c.id, label: `Claim · ${c.category} · ${emp?.name ?? ""}`, amount: c.amount, requesterId: emp?.userId ?? null, link: "/hr/claims" });
    await db.update(schema.hrClaims).set({ status: g.status === "pending" ? "approving" : "approved", decidedBy: s.userId, decidedAt: new Date(), decisionNote: note.slice(0, 300) }).where(eq(schema.hrClaims.id, id));
    if (g.status !== "pending") {
      await addEvent(s.orgId, c.employeeId, "claim", `Claim approved: ${c.category}`, s.userId, { amount: c.amount });
      await claimApproved(s.orgId, c.id);
    }
    return;
  }
  await db.update(schema.hrClaims).set({ status: "rejected", decidedBy: s.userId, decidedAt: new Date(), decisionNote: note.slice(0, 300) }).where(eq(schema.hrClaims.id, id));
  await claimRejected(s.orgId, c.id);
}

/** After the policy's steps: the claim is approved (and paid with the next payroll), or sent back. */
export async function claimDecided(orgId: string, id: string, approved: boolean, userId: string, note = "") {
  const [c] = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.id, id), eq(schema.hrClaims.orgId, orgId), eq(schema.hrClaims.status, "approving")));
  if (!c) return;
  await db.update(schema.hrClaims).set({ status: approved ? "approved" : "rejected", decidedBy: userId, decidedAt: new Date(), ...(approved ? {} : { decisionNote: note.slice(0, 300) }) }).where(eq(schema.hrClaims.id, id));
  if (approved) {
    await addEvent(orgId, c.employeeId, "claim", `Claim approved: ${c.category}`, userId, { amount: c.amount });
    await claimApproved(orgId, c.id);
  } else await claimRejected(orgId, c.id);
}
