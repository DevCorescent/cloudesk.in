// Who is asking. HR admins (hr:manage) see and change everything; payroll
// (hr:payroll) sees pay; a manager sees and approves for the people who report
// to them (directly or further down); everyone sees themselves and the
// directory. A member is "themselves" through the employee record linked to
// their account.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { randomToken } from "../security/tokens";
import { DEFAULT_LEAVE_TYPES, DEFAULT_LETTERS, settingsSchema, type HrSettings } from "@/lib/hr/model";
import { isOn, type PartsOff } from "@/lib/workspace/modules";
import { allows } from "@/lib/org/model";
import { memberAccess } from "../org/org";
import { resolver } from "../org/resolve";

export type Employee = typeof schema.hrEmployees.$inferSelect;
export type Scope = { orgId: string; userId: string; role: Role; manage: boolean; payroll: boolean; me: Employee | null; reports: Set<string>; settings: HrSettings; careersToken: string; partsOff: PartsOff; /** With company or branch limits, the people this member may act for (null: everyone). */ within?: Set<string> | null; /** Every employee id in this workspace: ids from a request are only acted on when they're in here. */ staff?: Set<string> };

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "hr:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "hr")) throw new ApiError("forbidden", "Switch on HR & payroll in Settings → Features first");
  const partsOff = (org?.partsOff ?? {}) as PartsOff;
  const st = await getSettings(orgId);
  const [me] = await db.select().from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, orgId), eq(schema.hrEmployees.userId, ctx.user.id)));
  const staff = new Set((await db.select({ id: schema.hrEmployees.id }).from(schema.hrEmployees).where(eq(schema.hrEmployees.orgId, orgId))).map((r) => r.id));
  return { orgId, userId: ctx.user.id, role, manage: can(role, "hr:manage"), payroll: can(role, "hr:payroll"), me: me ?? null, reports: me ? await reportsOf(orgId, me.id) : new Set(), settings: st.settings, careersToken: st.careersToken, partsOff, within: await peopleWithin(orgId, ctx.user.id), staff };
}

/** People whose work location is in the branches (and companies) this member is limited to. */
async function peopleWithin(orgId: string, userId: string) {
  const access = await memberAccess(orgId, userId);
  if (!access) return null;
  const r = await resolver(orgId);
  const people = await db.select({ id: schema.hrEmployees.id }).from(schema.hrEmployees).where(eq(schema.hrEmployees.orgId, orgId));
  return new Set(
    people
      .filter((p) => {
        const ref = r.ofEmployee(p.id);
        if (access.branches?.length && !ref.branchId) return false;
        return allows(access, ref);
      })
      .map((p) => p.id),
  );
}

/** Everyone below someone in the reporting line. */
export async function reportsOf(orgId: string, employeeId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive r as (
      select id from hr_employees where org_id = ${orgId} and manager_id = ${employeeId}
      union
      select e.id from hr_employees e join r on e.manager_id = r.id where e.org_id = ${orgId}
    ) select id from r`);
  const list = (rows as unknown as { rows?: { id: string }[] }).rows ?? (rows as unknown as { id: string }[]);
  return new Set(list.map((r) => r.id));
}

export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only HR admins (workspace owners and admins) can do this");
}
export function requirePayroll(s: Scope) {
  if (!s.payroll) throw new ApiError("forbidden", "Only owners, admins and billing can see payroll");
}
/** May this person act on (approve for, see the records of) this employee? HR admins limited to some branches act only within them. */
// Only people in this workspace: an HR admin here must not reach employee ids from another workspace.
export const oversees = (s: Scope, employeeId: string) => (s.manage && !!s.staff?.has(employeeId) && (!s.within || s.within.has(employeeId))) || s.reports.has(employeeId);
/** Within this member's data limits (always true without limits). */
export const within = (s: Scope, employeeId: string) => !s.within || s.within.has(employeeId) || s.me?.id === employeeId;
/** HR admins limited to some companies or branches act only on people within them. */
export function requireWithin(s: Scope, employeeId: string) {
  if (!within(s, employeeId)) throw notFound("Employee");
}
export const isSelf = (s: Scope, employeeId: string) => s.me?.id === employeeId;
export function requireSelfOrOversee(s: Scope, employeeId: string) {
  if (!isSelf(s, employeeId) && !oversees(s, employeeId)) throw notFound("Employee");
}
export function requireMe(s: Scope) {
  if (!s.me) throw new ApiError("forbidden", "Your account isn't linked to an employee record yet — ask HR to link it");
  return s.me;
}

export async function getSettings(orgId: string) {
  let [row] = await db.select().from(schema.hrSettings).where(eq(schema.hrSettings.orgId, orgId));
  if (!row) {
    [row] = await db.insert(schema.hrSettings).values({ orgId, careersToken: randomToken(12), settings: { letters: DEFAULT_LETTERS } }).onConflictDoNothing().returning();
    if (row) await db.insert(schema.hrLeaveTypes).values(DEFAULT_LEAVE_TYPES.map((t, i) => ({ orgId, ...t, sort: i })));
    else [row] = await db.select().from(schema.hrSettings).where(eq(schema.hrSettings.orgId, orgId));
  }
  return { settings: settingsSchema.parse(row.settings ?? {}), careersToken: row.careersToken };
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const merged = { ...s.settings, ...((raw ?? {}) as object) };
  const settings = check(settingsSchema, merged);
  await db.update(schema.hrSettings).set({ settings, updatedAt: new Date() }).where(eq(schema.hrSettings.orgId, s.orgId));
  return settings;
}

export async function nextEmpNo(orgId: string) {
  const [r] = await db.update(schema.hrSettings).set({ nextEmpNo: sql`${schema.hrSettings.nextEmpNo} + 1` }).where(eq(schema.hrSettings.orgId, orgId)).returning({ n: schema.hrSettings.nextEmpNo });
  return `EMP${String(r.n - 1).padStart(3, "0")}`;
}

export async function addEvent(orgId: string, employeeId: string, kind: string, subject: string, by: string | null, meta: Record<string, unknown> = {}) {
  await db.insert(schema.hrEvents).values({ orgId, employeeId, kind, subject: subject.slice(0, 200), by: by || null, meta });
}

export async function requireEmployee(orgId: string, id: string) {
  const [e] = await db.select().from(schema.hrEmployees).where(and(eq(schema.hrEmployees.id, id), eq(schema.hrEmployees.orgId, orgId)));
  if (!e) throw notFound("Employee");
  return e;
}

/** Holidays (not optional) as a set of dates, for a range. */
export async function holidaySet(orgId: string, from: string, to: string, locationId?: string | null) {
  const rows = await db
    .select({ date: schema.hrHolidays.date, locationId: schema.hrHolidays.locationId })
    .from(schema.hrHolidays)
    .where(and(eq(schema.hrHolidays.orgId, orgId), eq(schema.hrHolidays.optional, false), sql`${schema.hrHolidays.date} between ${from} and ${to}`));
  return new Set(rows.filter((r) => !r.locationId || r.locationId === locationId).map((r) => String(r.date)));
}

export async function members(orgId: string) {
  return db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)).orderBy(asc(schema.users.name));
}

export async function employeesByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: schema.hrEmployees.id, name: schema.hrEmployees.name, email: schema.hrEmployees.email, userId: schema.hrEmployees.userId, managerId: schema.hrEmployees.managerId }).from(schema.hrEmployees).where(inArray(schema.hrEmployees.id, ids));
}

/** Today's date in India. */
export const todayIst = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
