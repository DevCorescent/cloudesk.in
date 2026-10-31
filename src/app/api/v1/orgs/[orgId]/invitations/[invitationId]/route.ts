import { requireOrg, route } from "@/server/http/handler";
import { revokeInvitation } from "@/server/services/orgs";

export const DELETE = route<{ orgId: string; invitationId: string }>(async (ctx, { orgId, invitationId }) => {
  await requireOrg(ctx, orgId, "members:manage");
  await revokeInvitation(orgId, ctx.user.id, invitationId);
  return { ok: true };
});
