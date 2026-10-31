// Who is asking and what they may do. Every Projects & timesheets call starts
// here: the workspace (with the module switched on), whether the member may plan
// work (work:write) and run it (work:manage: approvals, billing, costs,
// settings), and the workspace's settings.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type WorkSettings } from "@/lib/work/model";
import { isOn, isPartOn, moduleById, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = {
  orgId: string;
  userId: string;
  role: Role;
  write: boolean;
  manage: boolean;
  /** May see salaries (hr:payroll), so HR-based cost rates can be used. */
  payroll: boolean;
  settings: WorkSettings;
  partsOff: PartsOff;
  /** Other modules this workspace has, for the links between them. */
  has: (m: ModuleId) => boolean;
};

/** Parse input with a schema, turning problems into a friendly 422. */
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
  const { role } = await requireOrg(ctx, orgId, "work:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "work")) throw new ApiError("forbidden", "Switch on Projects & timesheets in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return {
    orgId,
    userId: ctx.user.id,
    role,
    write: can(role, "work:write"),
    manage: can(role, "work:manage"),
    payroll: can(role, "hr:payroll") && isOn(org?.modules, "hr"),
    settings: await getSettings(orgId),
    partsOff: (org?.partsOff ?? {}) as PartsOff,
    has: (id) => visibleTo(visible, id),
  };
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see projects and log time, but not plan work");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requirePart(s: Scope, part: string) {
  if (!isPartOn(s.partsOff, "work", part)) {
    const name = moduleById("work")?.parts?.find((p) => p.id === part)?.name ?? part;
    throw new ApiError("forbidden", `${name} is switched off for this workspace`);
  }
}
export const partOn = (s: Scope, part: string) => isPartOn(s.partsOff, "work", part);

export async function getSettings(orgId: string): Promise<WorkSettings> {
  const [row] = await db.select().from(schema.workSettings).where(eq(schema.workSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.workSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const merged = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await db
    .insert(schema.workSettings)
    .values({ orgId: s.orgId, settings: merged })
    .onConflictDoUpdate({ target: schema.workSettings.orgId, set: { settings: merged, updatedAt: new Date() } });
  return merged;
}

/** The next project code, taken atomically: PRJ-0001. */
export async function nextCode(orgId: string, prefix: string) {
  await ensureSettings(orgId);
  const rows = (await db.execute(sql`update work_settings set next_project = next_project + 1 where org_id = ${orgId} returning next_project - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

/** Everyone in the workspace who can work on projects, with their HR record if they have one. */
export async function people(orgId: string) {
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.role} <> 'employee'`))
    .orderBy(asc(schema.users.name));
  return rows;
}

/** Yearly CTC by user id, from HR (only for callers allowed to see salaries). */
export async function ctcByUser(orgId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();
  const rows = await db.select({ userId: schema.hrEmployees.userId, ctc: schema.hrEmployees.ctc }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, orgId), inArray(schema.hrEmployees.userId, userIds), sql`${schema.hrEmployees.status} <> 'exited'`));
  return new Map(rows.filter((r) => r.userId && r.ctc > 0).map((r) => [r.userId!, Number(r.ctc)]));
}

/** Approved leave (in days) per user inside a date range, from HR. */
export async function leaveByUser(orgId: string, from: string, to: string) {
  const rows = (await db.execute(sql`
    select e.user_id, r.from_date::text as from_date, r.to_date::text as to_date, r.half, r.days
    from hr_leave_requests r join hr_employees e on e.id = r.employee_id
    where r.org_id = ${orgId} and r.status = 'approved' and e.user_id is not null and r.from_date <= ${to} and r.to_date >= ${from}`)) as unknown as { rows: { user_id: string; from_date: string; to_date: string; half: string; days: number }[] };
  // Days of leave on each date, by user.
  const out = new Map<string, Map<string, number>>();
  for (const r of rows.rows) {
    const m = out.get(r.user_id) ?? new Map<string, number>();
    for (let d = r.from_date; d <= r.to_date; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      if (d < from || d > to) continue;
      m.set(d, r.half !== "none" ? 0.5 : 1);
    }
    out.set(r.user_id, m);
  }
  return out;
}

export { invoiceBooks } from "../org/org";
import { invoiceBooks } from "../org/org";

export async function assertBook(orgId: string, ownerId: string) {
  if (!(await invoiceBooks(orgId)).some((b) => b.id === ownerId)) throw new ApiError("validation_failed", "Those books aren't in this workspace", { ownerId: ["Unknown books"] });
}

export async function clientsOf(orgId: string, ownerId: string) {
  await assertBook(orgId, ownerId);
  return db.select({ id: schema.invoiceClients.id, name: schema.invoiceClients.name, company: schema.invoiceClients.company }).from(schema.invoiceClients).where(and(eq(schema.invoiceClients.projectId, ownerId), isNull(schema.invoiceClients.archivedAt))).orderBy(asc(schema.invoiceClients.name));
}

export async function getProject(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Project");
  const [p] = await db.select().from(schema.workProjects).where(and(eq(schema.workProjects.id, id), eq(schema.workProjects.orgId, s.orgId)));
  if (!p) throw notFound("Project");
  return p;
}

/** Today in India, as YYYY-MM-DD. */
export const todayIst = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
