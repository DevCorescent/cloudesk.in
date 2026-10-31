// Who is asking and what they may do. Every Marketing call starts here: the
// workspace (module on, with CRM), whether the member builds and sends
// campaigns (mkt:write) or manages budgets and settings (mkt:manage).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type MktSettings } from "@/lib/marketing/model";
import { isOn, isPartOn, moduleById, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: MktSettings; partsOff: PartsOff; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "mkt:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "marketing")) throw new ApiError("forbidden", "Switch on Marketing in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "mkt:write"), manage: can(role, "mkt:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see campaigns, but not build or send them");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requirePart(s: Pick<Scope, "partsOff">, part: string) {
  if (!isPartOn(s.partsOff, "marketing", part)) throw new ApiError("forbidden", `${moduleById("marketing")?.parts?.find((p) => p.id === part)?.name ?? part} is switched off for this workspace`);
}

export async function getSettings(orgId: string): Promise<MktSettings> {
  const [row] = await db.select().from(schema.mktSettings).where(eq(schema.mktSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await db.insert(schema.mktSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.mktSettings.orgId, set: { settings: v } });
  return v;
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.mktSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}
