// Who is asking and what they may do. Every Manufacturing call starts here:
// the workspace (module on), whether the member runs the floor (mfg:write) or
// sets it up (mfg:manage: recipes, work centres, costs, settings).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type MfgSettings } from "@/lib/manufacturing/model";
import { isOn, isPartOn, moduleById, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { allowedWarehouses, getSettings as invSettings } from "../inventory/access";
import type { Scope as InvScope } from "../inventory/access";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: MfgSettings; partsOff: PartsOff; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "mfg:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "manufacturing")) throw new ApiError("forbidden", "Switch on Manufacturing in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "mfg:write"), manage: can(role, "mfg:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see production, but not run it");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requirePart(s: Pick<Scope, "partsOff">, part: string) {
  if (!isPartOn(s.partsOff, "manufacturing", part)) throw new ApiError("forbidden", `${moduleById("manufacturing")?.parts?.find((p) => p.id === part)?.name ?? part} is switched off for this workspace`);
}
export const partOn = (s: Pick<Scope, "partsOff">, part: string) => isPartOn(s.partsOff, "manufacturing", part);

export async function getSettings(orgId: string): Promise<MfgSettings> {
  const [row] = await db.select().from(schema.mfgSettings).where(eq(schema.mfgSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, raw);
  await db.insert(schema.mfgSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.mfgSettings.orgId, set: { settings: v } });
  return v;
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.mfgSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}

export async function nextNumber(orgId: string, prefix: string) {
  await db.insert(schema.mfgSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update mfg_settings set counters = jsonb_set(counters, '{wo}', to_jsonb(coalesce((counters->>'wo')::int, 1) + 1)) where org_id = ${orgId} returning (counters->>'wo')::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

/** The stock engine's view of this member, for moving materials and output. */
export async function stockScope(s: Scope): Promise<InvScope> {
  return { orgId: s.orgId, userId: s.userId, role: s.role, write: true, manage: s.manage, settings: await invSettings(s.orgId), partsOff: s.partsOff, warehouses: await allowedWarehouses(s.orgId, s.userId) };
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
