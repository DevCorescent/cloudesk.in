// Who is asking and what they may do. Every Clinic call starts here: the front
// desk (clinic:read/write) works with patients' details, appointments and
// bills; clinicians — chosen in settings, or owners and admins when none are —
// also see and write clinical notes. Every look at a clinical record is logged.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type ClinicSettings } from "@/lib/clinic/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; clinician: boolean; settings: ClinicSettings; has: (m: ModuleId) => boolean };

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

/** Is this member a clinician here? */
export const isClinician = (s: ClinicSettings, userId: string, role: Role) => (s.clinicians.length ? s.clinicians.includes(userId) : role === "owner" || role === "admin");

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "clinic:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "clinic")) throw new ApiError("forbidden", "Switch on Clinic in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  const settings = await getSettings(orgId);
  return { orgId, userId: ctx.user.id, role, write: can(role, "clinic:write"), manage: can(role, "clinic:manage"), clinician: isClinician(settings, ctx.user.id, role), settings, has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see the clinic, but not change anything");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requireClinician(s: Scope) {
  if (!s.clinician) throw new ApiError("forbidden", "Only clinicians can see or write clinical notes");
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.clinicSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}
export async function getSettings(orgId: string): Promise<ClinicSettings> {
  const [r] = await db.select().from(schema.clinicSettings).where(eq(schema.clinicSettings.orgId, orgId));
  return settingsSchema.parse(r?.settings ?? {});
}
export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  for (const id of v.clinicians) {
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, id)));
    if (!m) throw new ApiError("validation_failed", "A clinician isn't in this workspace");
  }
  await ensureSettings(s.orgId);
  await db.update(schema.clinicSettings).set({ settings: v }).where(eq(schema.clinicSettings.orgId, s.orgId));
  return v;
}

export async function nextNumber(orgId: string, kind: "mrn" | "bill", prefix: string, pad = 5) {
  await ensureSettings(orgId);
  const rows = (await db.execute(sql`update clinic_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(pad, "0")}`;
}

export async function getPatient(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Patient");
  const [p] = await db.select().from(schema.clinicPatients).where(and(eq(schema.clinicPatients.id, id), eq(schema.clinicPatients.orgId, orgId)));
  if (!p) throw notFound("Patient");
  return p;
}

/** The clinic's doctors: the clinicians. */
export async function doctors(s: Pick<Scope, "orgId" | "settings">) {
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, s.orgId)).orderBy(schema.users.name);
  return rows.filter((r) => isClinician(s.settings, r.id, r.role as Role)).map(({ id, name }) => ({ id, name, fee: s.settings.doctorFees[id] ?? null }));
}
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
