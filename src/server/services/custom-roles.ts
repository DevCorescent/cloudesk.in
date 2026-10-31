// Workspace roles: "Store manager", "Kitchen lead" — a built-in role's
// permissions, limited to the modules the workspace picks. Members with one see
// and reach only those modules (plus what those modules' screens rely on).
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";
import { canAssignRole, type Role } from "../authz/permissions";
import { ApiError, forbidden, notFound } from "../http/errors";
import { audit } from "./audit";
import { changeMemberRole } from "./orgs";

export const customRoleInput = z.object({
  name: z.string().trim().min(1, "Give the role a name").max(60),
  description: z.string().trim().max(300).default(""),
  baseRole: z.enum(["admin", "billing", "developer", "designer", "editor", "viewer", "employee"]),
  modules: z.array(z.enum(MODULE_IDS as [ModuleId, ...ModuleId[]])).min(1, "Pick at least one module").max(MODULE_IDS.length),
});
type Input = z.infer<typeof customRoleInput>;
type Actor = { id: string; role: Role };

/**
 * Members on a workspace role are limited to its modules. Managing members and roles would let them lift that
 * limit (give themselves a plain role, widen their own role, or invite a second account unlimited), so it's for
 * members without one.
 */
export async function assertUnlimited(orgId: string, userId: string) {
  const [m] = await db.select({ customRoleId: schema.memberships.customRoleId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (m?.customRoleId) throw forbidden("Your role is limited to some modules — an owner, or an admin without a workspace role, manages members and roles");
}

export async function listCustomRoles(orgId: string) {
  return db
    .select({ id: schema.customRoles.id, name: schema.customRoles.name, description: schema.customRoles.description, baseRole: schema.customRoles.baseRole, modules: schema.customRoles.modules, members: sql<number>`(select count(*)::int from memberships m where m.custom_role_id = custom_roles.id)` })
    .from(schema.customRoles)
    .where(eq(schema.customRoles.orgId, orgId))
    .orderBy(asc(schema.customRoles.name));
}

async function own(orgId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Role");
  const [r] = await db.select().from(schema.customRoles).where(and(eq(schema.customRoles.orgId, orgId), eq(schema.customRoles.id, id)));
  if (!r) throw notFound("Role");
  return r;
}

const taken = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";

export async function createCustomRole(orgId: string, actor: Actor, b: Input) {
  if (!canAssignRole(actor.role, b.baseRole)) throw forbidden("You can't make a role with more access than your own");
  try {
    const [r] = await db.insert(schema.customRoles).values({ orgId, ...b, modules: [...new Set(b.modules)] }).returning();
    await audit({ orgId, actorId: actor.id, action: "role.created", targetType: "custom_role", targetId: r.id, metadata: { name: r.name, baseRole: r.baseRole, modules: r.modules } });
    return r;
  } catch (e) {
    if (taken(e)) throw new ApiError("conflict", "There's already a role with that name");
    throw e;
  }
}

/** Changing the base role moves everyone who has it onto the new one. */
export async function updateCustomRole(orgId: string, actor: Actor, id: string, b: Input) {
  const cur = await own(orgId, id);
  if (!canAssignRole(actor.role, b.baseRole) || !canAssignRole(actor.role, cur.baseRole)) throw forbidden("You can't make a role with more access than your own");
  try {
    const [r] = await db.update(schema.customRoles).set({ ...b, modules: [...new Set(b.modules)], updatedAt: new Date() }).where(eq(schema.customRoles.id, id)).returning();
    if (cur.baseRole !== b.baseRole) await db.update(schema.memberships).set({ role: b.baseRole }).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.customRoleId, id)));
    await audit({ orgId, actorId: actor.id, action: "role.updated", targetType: "custom_role", targetId: id, metadata: { name: r.name, baseRole: r.baseRole, modules: r.modules } });
    return r;
  } catch (e) {
    if (taken(e)) throw new ApiError("conflict", "There's already a role with that name");
    throw e;
  }
}

/** Members keep the base role's permissions, without the module limit. */
export async function deleteCustomRole(orgId: string, actor: Actor, id: string) {
  const cur = await own(orgId, id);
  if (!canAssignRole(actor.role, cur.baseRole)) throw forbidden();
  await db.delete(schema.customRoles).where(eq(schema.customRoles.id, id));
  await audit({ orgId, actorId: actor.id, action: "role.deleted", targetType: "custom_role", targetId: id, metadata: { name: cur.name } });
}

export async function assignCustomRole(orgId: string, actor: Actor, userId: string, id: string) {
  const r = await own(orgId, id);
  await changeMemberRole(orgId, actor, userId, r.baseRole, r.id);
}
