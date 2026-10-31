// Who is asking and what they may do. Every Helpdesk call starts here: the
// workspace (module on), whether the member works tickets (hd:write) or runs
// the desk (hd:manage: hours, targets, assignment, the inbound address).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type HdSettings } from "@/lib/helpdesk/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { randomToken } from "../security/tokens";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: HdSettings; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "hd:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "helpdesk")) throw new ApiError("forbidden", "Switch on the Helpdesk in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "hd:write"), manage: can(role, "hd:manage"), settings: await getSettings(orgId), has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see tickets, but not work them");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.hdSettings).values({ orgId, settings: settingsSchema.parse({}), inboundToken: randomToken(18) }).onConflictDoNothing();
}

export async function getSettings(orgId: string): Promise<HdSettings> {
  const [row] = await db.select().from(schema.hdSettings).where(eq(schema.hdSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function settingsRow(orgId: string) {
  await ensureSettings(orgId);
  const [row] = await db.select().from(schema.hdSettings).where(eq(schema.hdSettings.orgId, orgId));
  return row;
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  for (const id of v.agents) if (!(await isAgent(s.orgId, id))) throw new ApiError("validation_failed", "Someone in the rota can't work tickets", { agents: ["Not an agent"] });
  await ensureSettings(s.orgId);
  await db.update(schema.hdSettings).set({ settings: v }).where(eq(schema.hdSettings.orgId, s.orgId));
  return v;
}

/** A new inbound address; the old one stops working at once. */
export async function rotateInbound(s: Scope) {
  requireManage(s);
  await ensureSettings(s.orgId);
  const token = randomToken(18);
  await db.update(schema.hdSettings).set({ inboundToken: token }).where(eq(schema.hdSettings.orgId, s.orgId));
  return token;
}

/** The next value of a counter, taken atomically. */
export async function nextCounter(orgId: string, key: "ticket" | "rr") {
  await ensureSettings(orgId);
  const rows = (await db.execute(sql`update hd_settings set counters = jsonb_set(counters, ${`{${key}}`}::text[], to_jsonb(coalesce((counters->>${key})::int, ${key === "ticket" ? 1 : 0}) + 1)) where org_id = ${orgId} returning (counters->>${key})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return rows.rows[0].n;
}

/** Members who may work tickets. */
export async function agents(orgId: string) {
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)).orderBy(schema.users.name);
  return rows.filter((r) => can(r.role as Role, "hd:write")).map(({ id, name, email }) => ({ id, name, email }));
}

export async function isAgent(orgId: string, userId: string) {
  return (await agents(orgId)).some((a) => a.id === userId);
}

export async function getTicket(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Ticket");
  const [t] = await db.select().from(schema.hdTickets).where(and(eq(schema.hdTickets.id, id), eq(schema.hdTickets.orgId, orgId)));
  if (!t) throw notFound("Ticket");
  return t;
}
