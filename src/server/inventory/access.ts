// Who is asking and what they may do. Every inventory call starts here: the
// workspace (with Inventory switched on), whether the member may change stock
// (inventory:write) and run the module (inventory:manage), and its settings.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type InvSettings } from "@/lib/inventory/model";
import { isOn, isPartOn, moduleById, type PartsOff } from "@/lib/workspace/modules";
import { allows } from "@/lib/org/model";
import { can, type Role } from "../authz/permissions";
import { memberAccess } from "../org/org";
import { resolver } from "../org/resolve";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: InvSettings; partsOff: PartsOff; /** Locations this member may see and move stock in (null: all). */ warehouses?: Set<string> | null };

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
  const { role } = await requireOrg(ctx, orgId, "inventory:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "inventory")) throw new ApiError("forbidden", "Switch on Inventory & purchasing in Settings → Features first");
  return { orgId, userId: ctx.user.id, role, write: can(role, "inventory:write"), manage: can(role, "inventory:manage"), settings: await getSettings(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, warehouses: await allowedWarehouses(orgId, ctx.user.id) };
}

/** With company or branch limits, the locations in those branches (unlinked locations belong to the default company). */
export async function allowedWarehouses(orgId: string, userId: string) {
  const access = await memberAccess(orgId, userId);
  if (!access) return null;
  const r = await resolver(orgId);
  const whs = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId));
  return new Set(
    whs
      .filter((w) => {
        const ref = r.ofWarehouse(w.id);
        if (access.branches?.length && !ref.branchId) return false;
        return allows(access, ref);
      })
      .map((w) => w.id),
  );
}

export function requireWarehouseAccess(s: Scope, id: string) {
  if (s.warehouses && !s.warehouses.has(id)) throw new ApiError("forbidden", "You can't work with stock in that location");
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can see stock but not change it");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can change this");
}
/** For work that crosses parts (a transfer, a batch) that the API path alone doesn't show. */
export function requirePart(s: Scope, part: string) {
  if (!isPartOn(s.partsOff, "inventory", part)) {
    const name = moduleById("inventory")?.parts?.find((p) => p.id === part)?.name ?? part;
    throw new ApiError("forbidden", `${name} is switched off for this workspace`);
  }
}

export async function getSettings(orgId: string): Promise<InvSettings> {
  const [row] = await db.select().from(schema.invSettings).where(eq(schema.invSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const merged = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await db
    .insert(schema.invSettings)
    .values({ orgId: s.orgId, settings: merged })
    .onConflictDoUpdate({ target: schema.invSettings.orgId, set: { settings: merged, updatedAt: new Date() } });
  return merged;
}

/** The next document number of a kind, taken atomically: PO-0001, GRN-0001, TR-0001. */
export async function nextNumber(orgId: string, kind: "po" | "grn" | "transfer", prefix: string) {
  const col = kind === "po" ? "next_po" : kind === "grn" ? "next_grn" : "next_transfer";
  await db.insert(schema.invSettings).values({ orgId }).onConflictDoNothing();
  const rows = await db.execute<{ n: number }>(sql`update inv_settings set ${sql.raw(col)} = ${sql.raw(col)} + 1 where org_id = ${orgId} returning ${sql.raw(col)} - 1 as n`);
  const n = Number((rows as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? (rows as unknown as { n: number }[])[0]?.n);
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/** Today in India, as YYYY-MM-DD. */
export const todayIst = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
