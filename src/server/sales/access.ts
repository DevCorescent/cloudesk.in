// Who is asking and what they may do. Every Sales call starts here: the
// workspace (with the module on), whether the member may take orders
// (sales:write) or run sales (sales:manage: price lists, credit limits,
// commissions, settings, approving holds), and the settings.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type SalesSettings } from "@/lib/sales/model";
import { isOn, isPartOn, moduleById, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { invoiceBooks } from "../org/org";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: SalesSettings; partsOff: PartsOff; has: (m: ModuleId) => boolean };

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
  const { role } = await requireOrg(ctx, orgId, "sales:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "sales")) throw new ApiError("forbidden", "Switch on Sales orders in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "sales:write"), manage: can(role, "sales:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see sales, but not take orders");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}
export function requirePart(s: Pick<Scope, "partsOff">, part: string) {
  if (!isPartOn(s.partsOff, "sales", part)) throw new ApiError("forbidden", `${moduleById("sales")?.parts?.find((p) => p.id === part)?.name ?? part} is switched off for this workspace`);
}
export const partOn = (s: Pick<Scope, "partsOff">, part: string) => isPartOn(s.partsOff, "sales", part);

export async function getSettings(orgId: string): Promise<SalesSettings> {
  const [row] = await db.select().from(schema.salesSettings).where(eq(schema.salesSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, raw);
  if (v.defaultWarehouseId) {
    const [w] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.id, v.defaultWarehouseId)));
    if (!w) throw new ApiError("validation_failed", "Pick a location from this workspace");
  }
  if (v.defaultOwnerId) await assertBook(s.orgId, v.defaultOwnerId);
  await db.insert(schema.salesSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.salesSettings.orgId, set: { settings: v } });
  return v;
}

/** Settings and a default price list, for onboarding. */
export async function ensureSettings(orgId: string) {
  await db.insert(schema.salesSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
  const [has] = await db.select({ id: schema.salesPriceLists.id }).from(schema.salesPriceLists).where(and(eq(schema.salesPriceLists.orgId, orgId), eq(schema.salesPriceLists.isDefault, true)));
  if (!has) await db.insert(schema.salesPriceLists).values({ orgId, name: "Standard prices", isDefault: true }).onConflictDoNothing();
}

/** The next number in a series ("SO-0001"), atomically. */
export async function nextNumber(orgId: string, kind: "order" | "challan" | "return", prefix: string) {
  await db.insert(schema.salesSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update sales_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

export async function assertBook(orgId: string, ownerId: string) {
  if (!(await invoiceBooks(orgId)).some((b) => b.id === ownerId)) throw new ApiError("validation_failed", "Those invoicing books aren't in this workspace", { ownerId: ["Pick books"] });
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Members who can sell, for salesperson pickers. */
export async function people(orgId: string) {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.role} <> 'employee'`)).orderBy(schema.users.name);
}
