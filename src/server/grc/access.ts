// Who is asking and what they may do. Every GRC call starts here: everyone in
// the workspace reads and acknowledges policies and reports incidents; the
// team sees the registers (grc:registers); most roles keep them (grc:write);
// owners and admins set factors and limits (grc:manage).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type GrcSettings } from "@/lib/grc/model";
import { isOn, isPartOn, moduleById, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; registers: boolean; write: boolean; manage: boolean; settings: GrcSettings; partsOff: PartsOff; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "grc:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "grc")) throw new ApiError("forbidden", "Switch on Governance, risk & compliance in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, registers: can(role, "grc:registers"), write: can(role, "grc:write"), manage: can(role, "grc:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, has: (id) => visibleTo(visible, id) };
}

export function requireRegisters(s: Scope) {
  if (!s.registers) throw new ApiError("forbidden", "Your role can read policies and report incidents, but not see the registers");
}
export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see the registers, but not change them");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requirePart(s: Scope, part: string) {
  if (!isPartOn(s.partsOff, "grc", part)) throw new ApiError("forbidden", `${moduleById("grc")?.parts?.find((p) => p.id === part)?.name ?? part} is switched off for this workspace`);
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.grcSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}
export async function getSettings(orgId: string): Promise<GrcSettings> {
  const [row] = await db.select().from(schema.grcSettings).where(eq(schema.grcSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}
export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await ensureSettings(s.orgId);
  await db.update(schema.grcSettings).set({ settings: v }).where(eq(schema.grcSettings.orgId, s.orgId));
  return v;
}

/** The next number of a kind, taken atomically: RSK-0001, INC-0001, AUD-0001. */
export async function nextNumber(orgId: string, kind: "risk" | "incident" | "audit") {
  await ensureSettings(orgId);
  const rows = (await db.execute(sql`update grc_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${{ risk: "RSK-", incident: "INC-", audit: "AUD-" }[kind]}${String(rows.rows[0].n).padStart(4, "0")}`;
}

export async function members(orgId: string) {
  return db.select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)).orderBy(schema.users.name);
}

export async function requireMember(orgId: string, userId: string | null | undefined, field = "ownerId") {
  if (!userId) return;
  const [m] = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new ApiError("validation_failed", "That person isn't in this workspace", { [field]: ["Not a member"] });
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
