// Workspace roles:
//   GET    /orgs/:orgId/roles        → { roles }
//   POST   /orgs/:orgId/roles        → creates one
//   PUT    /orgs/:orgId/roles/:id    → updates it
//   DELETE /orgs/:orgId/roles/:id    → deletes it (members keep its base role)
import { readJson, requireOrg, route } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { assertUnlimited, createCustomRole, customRoleInput, deleteCustomRole, listCustomRoles, updateCustomRole } from "@/server/services/custom-roles";

type P = { orgId: string; id?: string[] };

export const GET = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  return { roles: await listCustomRoles(orgId) };
});

export const POST = route<P>(async (ctx, { orgId, id }) => {
  if (id?.length) throw notFound("Route");
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  return { role: await createCustomRole(orgId, { id: ctx.user.id, role: m.role }, await readJson(ctx.req, customRoleInput)) };
});

export const PUT = route<P>(async (ctx, { orgId, id }) => {
  if (id?.length !== 1) throw notFound("Route");
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  return { role: await updateCustomRole(orgId, { id: ctx.user.id, role: m.role }, id[0], await readJson(ctx.req, customRoleInput)) };
});

export const DELETE = route<P>(async (ctx, { orgId, id }) => {
  if (id?.length !== 1) throw notFound("Route");
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  await deleteCustomRole(orgId, { id: ctx.user.id, role: m.role }, id[0]);
  return { ok: true };
});
