import { z } from "zod";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { role } from "@/server/http/schemas";
import { assertUnlimited, assignCustomRole } from "@/server/services/custom-roles";
import { changeMemberRole, removeMember } from "@/server/services/orgs";

export const PATCH = route<{ orgId: string; userId: string }>(async (ctx, { orgId, userId }) => {
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  // A built-in role, or a workspace role by id.
  const input = await readJson(ctx.req, z.union([z.object({ role }), z.object({ customRoleId: z.uuid() })]));
  if ("customRoleId" in input) await assignCustomRole(orgId, { id: ctx.user.id, role: m.role }, userId, input.customRoleId);
  else await changeMemberRole(orgId, { id: ctx.user.id, role: m.role }, userId, input.role);
  return { ok: true };
});

export const DELETE = route<{ orgId: string; userId: string }>(async (ctx, { orgId, userId }) => {
  // Anyone may leave; removing others needs members:manage.
  const m = await requireOrg(ctx, orgId, userId === ctx.user.id ? "org:read" : "members:manage");
  await removeMember(orgId, { id: ctx.user.id, role: m.role }, userId);
  return { ok: true };
});
