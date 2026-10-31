// Who is asking and what they may do. Every Education call starts here: the
// workspace (module on), whether the member works day to day (edu:write:
// attendance, marks, fees and payments) or runs it (edu:manage: fee plans,
// waivers, settings).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type EduSettings } from "@/lib/education/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: EduSettings; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "edu:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "education")) throw new ApiError("forbidden", "Switch on Education in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "edu:write"), manage: can(role, "edu:manage"), settings: await getSettings(orgId), has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see students, but not change anything");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.eduSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}
export async function getSettings(orgId: string): Promise<EduSettings> {
  const [r] = await db.select().from(schema.eduSettings).where(eq(schema.eduSettings.orgId, orgId));
  return settingsSchema.parse(r?.settings ?? {});
}
export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await ensureSettings(s.orgId);
  await db.update(schema.eduSettings).set({ settings: v }).where(eq(schema.eduSettings.orgId, s.orgId));
  return v;
}

/** The next number of a kind, taken atomically. */
export async function nextNumber(orgId: string, kind: "fee" | "receipt" | "admission", prefix: string, pad = 5) {
  await ensureSettings(orgId);
  const rows = (await db.execute(sql`update edu_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(pad, "0")}`;
}

export async function getStudent(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Student");
  const [r] = await db.select().from(schema.eduStudents).where(and(eq(schema.eduStudents.id, id), eq(schema.eduStudents.orgId, orgId)));
  if (!r) throw notFound("Student");
  return r;
}
export async function getClass(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Class");
  const [r] = await db.select().from(schema.eduClasses).where(and(eq(schema.eduClasses.id, id), eq(schema.eduClasses.orgId, orgId)));
  if (!r) throw notFound("Class");
  return r;
}
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
