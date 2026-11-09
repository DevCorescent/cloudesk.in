// Who is asking and what they may do. Every Requisitions call starts here:
// the workspace (module on), whether the member chases clients (rq:write) or
// sets the mailbox and defaults (rq:manage).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type RqSettings } from "@/lib/requisitions/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: RqSettings; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "rq:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "requisitions")) throw new ApiError("forbidden", "Switch on Requisitions in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "rq:write"), manage: can(role, "rq:manage"), settings: await getSettings(orgId), has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see requisitions, but not send or change them");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.rqSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}

export async function getSettings(orgId: string): Promise<RqSettings> {
  const [row] = await db.select().from(schema.rqSettings).where(eq(schema.rqSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  if (v.mailAccountId) {
    const [a] = await db.select({ id: schema.mailAccounts.id }).from(schema.mailAccounts).where(and(eq(schema.mailAccounts.id, v.mailAccountId), eq(schema.mailAccounts.orgId, s.orgId)));
    if (!a) throw new ApiError("validation_failed", "Choose one of this workspace's mailboxes", { mailAccountId: ["Not found"] });
  }
  await ensureSettings(s.orgId);
  await db.update(schema.rqSettings).set({ settings: v }).where(eq(schema.rqSettings.orgId, s.orgId));
  return v;
}

/** The next requisition number (REQ-0001…), taken atomically. */
export async function nextNumber(orgId: string) {
  await ensureSettings(orgId);
  const r = (await db.execute(sql`update rq_settings set counters = jsonb_set(counters, '{list}', to_jsonb(coalesce((counters->>'list')::int, 0) + 1)) where org_id = ${orgId} returning (counters->>'list')::int as n`)) as unknown as { rows: { n: number }[] };
  return `REQ-${String(r.rows[0]!.n).padStart(4, "0")}`;
}

export async function getList(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Requisition");
  const [l] = await db.select().from(schema.rqLists).where(and(eq(schema.rqLists.id, id), eq(schema.rqLists.orgId, orgId)));
  if (!l) throw notFound("Requisition");
  return l;
}
