// Who is asking and what they may do. Every Assets & maintenance call starts
// here: the workspace (module on), whether the member works orders
// (mnt:write) or sets things up (mnt:manage: plans, contracts, settings).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type MntSettings } from "@/lib/maintenance/model";
import { isOn, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { allowedWarehouses, getSettings as invSettings } from "../inventory/access";
import type { Scope as InvScope } from "../inventory/access";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: MntSettings; partsOff: PartsOff; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "mnt:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "maintenance")) throw new ApiError("forbidden", "Switch on Assets & maintenance in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "mnt:write"), manage: can(role, "mnt:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see assets and raise requests, but not work orders");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}

export async function getSettings(orgId: string): Promise<MntSettings> {
  const [row] = await db.select().from(schema.mntSettings).where(eq(schema.mntSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  if (v.partsWarehouseId) {
    const [w] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.id, v.partsWarehouseId), eq(schema.invWarehouses.orgId, s.orgId)));
    if (!w) throw new ApiError("validation_failed", "That location isn't in this workspace", { partsWarehouseId: ["Unknown location"] });
  }
  await db.insert(schema.mntSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.mntSettings.orgId, set: { settings: v } });
  return v;
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.mntSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}

/** The next number of a kind, taken atomically: AST-0001, MWO-0001. */
export async function nextNumber(orgId: string, kind: "asset" | "order", prefix: string) {
  await db.insert(schema.mntSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update mnt_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

/** The stock engine's view of this member, for issuing spare parts. */
export async function stockScope(s: Scope): Promise<InvScope> {
  return { orgId: s.orgId, userId: s.userId, role: s.role, write: true, manage: s.manage, settings: await invSettings(s.orgId), partsOff: s.partsOff, warehouses: await allowedWarehouses(s.orgId, s.userId) };
}

export async function getAsset(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Asset");
  const [a] = await db.select().from(schema.mntAssets).where(and(eq(schema.mntAssets.id, id), eq(schema.mntAssets.orgId, orgId)));
  if (!a) throw notFound("Asset");
  return a;
}

/** People on the team, for assigning work. */
export async function team(orgId: string) {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.role} <> 'employee'`)).orderBy(schema.users.name);
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
