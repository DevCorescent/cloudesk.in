import { z } from "zod";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { email, role } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { assertUnlimited } from "@/server/services/custom-roles";
import { createInvitation, listInvitations } from "@/server/services/orgs";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "members:manage");
  return { invitations: await listInvitations(orgId) };
});

export const POST = route<{ orgId: string }>(async (ctx, { orgId }) => {
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  await rateLimit(`invite:${orgId}`, 50, 24 * 3600_000);
  const input = await readJson(ctx.req, z.object({ email, role }));
  const { invitation } = await createInvitation(orgId, { id: ctx.user.id, role: m.role, name: ctx.user.name }, input.email, input.role);
  return Response.json({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } }, { status: 201 });
});
