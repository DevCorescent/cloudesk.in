// People: the directory (for everyone), full profiles (for HR, their managers
// and themselves — pay and bank details for HR, payroll and themselves only),
// joining, changes with a history, notice and exit, the org chart, linking a
// workspace account and inviting someone to self-service.
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { createInvitation } from "../services/orgs";
import { employeeSchema, EMP_STATUS_LABEL, structure } from "@/lib/hr/model";
import { within, requireWithin, addEvent, check, isSelf, members, nextEmpNo, oversees, requireEmployee, requireManage, todayIst, type Employee, type Scope } from "./access";
import { contains } from "../security/like";
const E = schema.hrEmployees;

/** What anyone in the workspace may see about a colleague. */
function directoryView(e: Employee) {
  return { id: e.id, empNo: e.empNo, name: e.name, email: e.email, phone: e.phone, designation: e.designation, departmentId: e.departmentId, locationId: e.locationId, managerId: e.managerId, employmentType: e.employmentType, joinDate: e.joinDate, status: e.status, userId: e.userId, dob: e.dob ? String(e.dob).slice(5) : null };
}
/** The full record, with pay and bank details only for those allowed. */
function profileView(s: Scope, e: Employee) {
  const pay = s.payroll || isSelf(s, e.id);
  return { ...e, dob: e.dob, ctc: pay ? e.ctc : null, salary: pay ? e.salary : {}, bank: pay ? e.bank : {}, ids: pay || s.manage ? e.ids : {}, canSeePay: pay };
}

export async function directory(s: Scope, opts: { q?: string; status?: string; departmentId?: string; locationId?: string }) {
  const q = (opts.q ?? "").trim();
  const rows = await db
    .select()
    .from(E)
    .where(
      and(
        eq(E.orgId, s.orgId),
        opts.status === "all" ? undefined : opts.status === "exited" ? eq(E.status, "exited") : sql`${E.status} <> 'exited'`,
        opts.departmentId ? eq(E.departmentId, opts.departmentId) : undefined,
        opts.locationId ? eq(E.locationId, opts.locationId) : undefined,
        q ? or(ilike(E.name, contains(q)), ilike(E.email, contains(q)), ilike(E.designation, contains(q)), ilike(E.empNo, contains(q)), ilike(E.phone, contains(q))) : undefined,
      ),
    )
    .orderBy(asc(E.name))
    .limit(2000);
  return rows.filter((e) => within(s, e.id)).map((e) => ({ ...directoryView(e), ...(s.payroll && within(s, e.id) ? { ctc: e.ctc } : {}) }));
}

export async function getEmployee(s: Scope, id: string) {
  const e = await requireEmployee(s.orgId, id);
  if (!within(s, id)) throw notFound("Employee");
  const full = isSelf(s, id) || oversees(s, id) || s.payroll;
  if (!full) return { employee: directoryView(e), limited: true };
  const [events, checklists, assets, manager, reports] = await Promise.all([
    db.select().from(schema.hrEvents).where(and(eq(schema.hrEvents.orgId, s.orgId), eq(schema.hrEvents.employeeId, id))).orderBy(desc(schema.hrEvents.createdAt)).limit(100),
    db.select().from(schema.hrChecklists).where(and(eq(schema.hrChecklists.orgId, s.orgId), eq(schema.hrChecklists.employeeId, id))),
    db.select().from(schema.hrAssets).where(and(eq(schema.hrAssets.orgId, s.orgId), eq(schema.hrAssets.employeeId, id))),
    e.managerId ? db.select({ id: E.id, name: E.name, designation: E.designation }).from(E).where(eq(E.id, e.managerId)).then((r) => r[0] ?? null) : null,
    db.select({ id: E.id, name: E.name, designation: E.designation, status: E.status }).from(E).where(and(eq(E.managerId, id), sql`${E.status} <> 'exited'`)),
  ]);
  const view = profileView(s, e);
  return {
    employee: view,
    limited: false,
    structure: view.canSeePay && e.ctc ? structure(e.ctc, { ...s.settings.payroll, ...(e.salary as object) }) : null,
    events,
    checklists,
    assets,
    manager,
    reports,
  };
}

export async function checkRefs(s: Scope, input: { departmentId: string | null; locationId: string | null; managerId: string | null; costCentreId?: string | null }, selfId?: string) {
  if (input.costCentreId) {
    const [u] = await db.select({ id: schema.orgUnits.id }).from(schema.orgUnits).where(and(eq(schema.orgUnits.id, input.costCentreId), eq(schema.orgUnits.orgId, s.orgId)));
    if (!u) throw new ApiError("validation_failed", "Choose a cost centre from the list", { costCentreId: ["Not found"] });
  }
  if (input.departmentId) {
    const [d] = await db.select({ id: schema.hrDepartments.id }).from(schema.hrDepartments).where(and(eq(schema.hrDepartments.id, input.departmentId), eq(schema.hrDepartments.orgId, s.orgId)));
    if (!d) throw new ApiError("validation_failed", "Choose a department from the list", { departmentId: ["Not found"] });
  }
  if (input.locationId) {
    const [l] = await db.select({ id: schema.hrLocations.id }).from(schema.hrLocations).where(and(eq(schema.hrLocations.id, input.locationId), eq(schema.hrLocations.orgId, s.orgId)));
    if (!l) throw new ApiError("validation_failed", "Choose a location from the list", { locationId: ["Not found"] });
  }
  if (input.managerId) {
    if (input.managerId === selfId) throw new ApiError("validation_failed", "Someone can't report to themselves", { managerId: ["Invalid"] });
    await requireEmployee(s.orgId, input.managerId);
    // No loops: the new manager can't be someone who reports to this person.
    if (selfId) {
      const loop = await db.execute<{ id: string }>(sql`with recursive up as (select id, manager_id from hr_employees where id = ${input.managerId} union select e.id, e.manager_id from hr_employees e join up on e.id = up.manager_id) select id from up where id = ${selfId}`);
      const rows = (loop as unknown as { rows?: unknown[] }).rows ?? (loop as unknown as unknown[]);
      if (rows.length) throw new ApiError("validation_failed", "That would make a loop in the reporting line", { managerId: ["Loop"] });
    }
  }
}

export async function createEmployee(s: Scope, raw: unknown) {
  requireManage(s);
  const input = check(employeeSchema, raw);
  await checkRefs(s, input);
  if (input.email) {
    const [dup] = await db.select({ id: E.id, name: E.name }).from(E).where(and(eq(E.orgId, s.orgId), sql`lower(${E.email}) = ${input.email}`, sql`${E.status} <> 'exited'`));
    if (dup) throw new ApiError("conflict", `${dup.name} already uses that email`, { existingId: dup.id });
  }
  const empNo = await nextEmpNo(s.orgId);
  // Link straight away if they're already in the workspace.
  const member = input.email ? (await members(s.orgId)).find((m) => m.email.toLowerCase() === input.email) : undefined;
  const taken = member ? (await db.select({ id: E.id }).from(E).where(and(eq(E.orgId, s.orgId), eq(E.userId, member.id))))[0] : undefined;
  const [e] = await db
    .insert(E)
    .values({ orgId: s.orgId, empNo, ...input, userId: member && !taken ? member.id : null, status: "active" })
    .returning();
  await addEvent(s.orgId, e.id, "joined", `Joined as ${e.designation || "a team member"}`, s.userId, { joinDate: e.joinDate });
  await db.insert(schema.hrChecklists).values({ orgId: s.orgId, employeeId: e.id, kind: "onboarding", items: s.settings.onboarding.map((it, i) => ({ id: `o${i}`, ...it, done: false, doneAt: null })) }).onConflictDoNothing();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.employee.created", targetType: "hr_employee", targetId: e.id, metadata: { empNo } });
  return e;
}

export async function updateEmployee(s: Scope, id: string, raw: unknown) {
  const cur = await requireEmployee(s.orgId, id);
  requireWithin(s, id);
  const patch = (raw ?? {}) as Record<string, unknown>;
  // People can keep their own contact details up to date.
  if (!s.manage) {
    if (!isSelf(s, id)) throw notFound("Employee");
    const allowed = ["phone", "personalEmail", "address", "emergency", "bank"];
    if (Object.keys(patch).some((k) => !allowed.includes(k))) throw new ApiError("forbidden", "Ask HR to change these details");
  }
  if ("ctc" in patch || "salary" in patch) {
    if (!s.payroll) throw new ApiError("forbidden", "Only payroll can change salaries");
  }
  const input = check(employeeSchema, { ...cur, dob: cur.dob ? String(cur.dob) : null, joinDate: String(cur.joinDate), probationEnd: cur.probationEnd ? String(cur.probationEnd) : null, ...patch });
  await checkRefs(s, input, id);
  const [e] = await db.update(E).set({ ...input, updatedAt: new Date() }).where(eq(E.id, id)).returning();
  // Keep a history of what matters.
  if (cur.designation !== e.designation) await addEvent(s.orgId, id, "promoted", `${cur.designation || "—"} → ${e.designation}`, s.userId);
  if (cur.departmentId !== e.departmentId || cur.locationId !== e.locationId) await addEvent(s.orgId, id, "transferred", "Moved to a new team or location", s.userId, { from: { d: cur.departmentId, l: cur.locationId }, to: { d: e.departmentId, l: e.locationId } });
  if (cur.managerId !== e.managerId) {
    const [m] = e.managerId ? await db.select({ name: E.name }).from(E).where(eq(E.id, e.managerId)) : [];
    await addEvent(s.orgId, id, "manager", `Now reports to ${m?.name ?? "nobody"}`, s.userId);
  }
  if (cur.ctc !== e.ctc) {
    await addEvent(s.orgId, id, "salary", "Salary revised", s.userId, { from: cur.ctc, to: e.ctc, pct: cur.ctc ? Math.round(((e.ctc - cur.ctc) / cur.ctc) * 1000) / 10 : null });
    await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.salary.revised", targetType: "hr_employee", targetId: id });
  }
  return e;
}

/** Resignation or termination: on notice until the last day, with an offboarding checklist. */
export async function startExit(s: Scope, id: string, raw: { lastDay?: unknown; reason?: unknown; noticeFrom?: unknown }) {
  requireManage(s);
  const e = await requireEmployee(s.orgId, id);
  requireWithin(s, id);
  const lastDay = String(raw.lastDay ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new ApiError("validation_failed", "Choose the last working day", { lastDay: ["Required"] });
  if (lastDay < String(e.joinDate)) throw new ApiError("validation_failed", "The last day is before they joined");
  const reason = String(raw.reason ?? "").slice(0, 300);
  const today = todayIst();
  const status = lastDay < today ? "exited" : "notice";
  await db.update(E).set({ status, noticeFrom: typeof raw.noticeFrom === "string" && raw.noticeFrom ? raw.noticeFrom : today, exitDate: lastDay, exitReason: reason, updatedAt: new Date() }).where(eq(E.id, id));
  await db.insert(schema.hrChecklists).values({ orgId: s.orgId, employeeId: id, kind: "offboarding", items: s.settings.offboarding.map((it, i) => ({ id: `x${i}`, ...it, done: false, doneAt: null })) }).onConflictDoNothing();
  await addEvent(s.orgId, id, "exit", status === "exited" ? `Left on ${lastDay}` : `On notice — last day ${lastDay}`, s.userId, { reason });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.employee.exit", targetType: "hr_employee", targetId: id, metadata: { lastDay } });
  return requireEmployee(s.orgId, id);
}

export async function cancelExit(s: Scope, id: string) {
  requireManage(s);
  await requireEmployee(s.orgId, id);
  requireWithin(s, id);
  await db.update(E).set({ status: "active", noticeFrom: null, exitDate: null, exitReason: "", updatedAt: new Date() }).where(and(eq(E.id, id), eq(E.orgId, s.orgId)));
  await db.delete(schema.hrChecklists).where(and(eq(schema.hrChecklists.orgId, s.orgId), eq(schema.hrChecklists.employeeId, id), eq(schema.hrChecklists.kind, "offboarding")));
  await addEvent(s.orgId, id, "exit", "Stays on — exit withdrawn", s.userId);
}

/** People whose last day has passed move to "left". Run on reads; cheap. */
export async function settleExits(orgId: string) {
  await db.update(E).set({ status: "exited" }).where(and(eq(E.orgId, orgId), eq(E.status, "notice"), sql`${E.exitDate} < ${todayIst()}`));
}

export async function tickChecklist(s: Scope, employeeId: string, kind: string, itemId: string, done: boolean) {
  const [c] = await db.select().from(schema.hrChecklists).where(and(eq(schema.hrChecklists.employeeId, employeeId), eq(schema.hrChecklists.kind, kind), eq(schema.hrChecklists.orgId, s.orgId)));
  if (!c) throw notFound("Checklist");
  type Item = { id: string; title: string; owner: string; done: boolean; doneAt: string | null };
  const items = c.items as Item[];
  const it = items.find((x) => x.id === itemId);
  if (!it) throw notFound("Item");
  // HR ticks anything; the manager their items; the person their own.
  const ok = s.manage || (it.owner === "manager" && oversees(s, employeeId)) || (it.owner === "employee" && isSelf(s, employeeId));
  if (!ok) throw new ApiError("forbidden", "This one is for someone else to tick");
  await db.update(schema.hrChecklists).set({ items: items.map((x) => (x.id === itemId ? { ...x, done, doneAt: done ? new Date().toISOString() : null } : x)) }).where(eq(schema.hrChecklists.id, c.id));
}

export async function linkUser(s: Scope, id: string, userId: string | null) {
  requireManage(s);
  await requireEmployee(s.orgId, id);
  requireWithin(s, id);
  if (userId) {
    if (!(await members(s.orgId)).some((m) => m.id === userId)) throw new ApiError("validation_failed", "That person isn't in this workspace");
    const [other] = await db.select({ name: E.name }).from(E).where(and(eq(E.orgId, s.orgId), eq(E.userId, userId)));
    if (other) throw new ApiError("conflict", `That account is already linked to ${other.name}`);
  }
  await db.update(E).set({ userId }).where(eq(E.id, id));
}

/** Invites them to the workspace as an Employee (their own HR only); they're linked when they accept. */
export async function inviteEmployee(s: Scope, id: string, actorName: string) {
  requireManage(s);
  const e = await requireEmployee(s.orgId, id);
  if (!e.email) throw new ApiError("validation_failed", "Add their work email first");
  if (e.userId) throw new ApiError("conflict", "They already have an account here");
  return createInvitation(s.orgId, { id: s.userId, role: s.role, name: actorName }, e.email, "employee");
}

export async function orgChart(s: Scope) {
  const rows = await db.select({ id: E.id, name: E.name, designation: E.designation, managerId: E.managerId, departmentId: E.departmentId, status: E.status }).from(E).where(and(eq(E.orgId, s.orgId), sql`${E.status} <> 'exited'`));
  return rows;
}

/** Creates employees from Horeca till logins in this workspace's venues (linked, so till unlocks count as attendance). */
export async function importHorecaStaff(s: Scope) {
  requireManage(s);
  const staff = await db
    .select({ id: schema.horecaStaff.id, name: schema.horecaStaff.name, role: schema.horecaStaff.role, projectId: schema.horecaStaff.projectId })
    .from(schema.horecaStaff)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.horecaStaff.projectId))
    .where(and(eq(schema.projects.orgId, s.orgId), eq(schema.horecaStaff.active, true)));
  const linked = new Set((await db.select({ id: E.horecaStaffId }).from(E).where(and(eq(E.orgId, s.orgId), sql`${E.horecaStaffId} is not null`))).map((r) => r.id));
  let created = 0;
  for (const st of staff) {
    if (linked.has(st.id)) continue;
    const empNo = await nextEmpNo(s.orgId);
    const [e] = await db.insert(E).values({ orgId: s.orgId, empNo, name: st.name, designation: st.role[0].toUpperCase() + st.role.slice(1), joinDate: todayIst(), horecaStaffId: st.id }).returning();
    await addEvent(s.orgId, e.id, "joined", "Added from the Horeca till", s.userId);
    created++;
  }
  return { created, total: staff.length };
}

export const statusLabel = (st: string) => EMP_STATUS_LABEL[st] ?? st;
