// Cloudesk for Horeca across a workspace: every outlet with today's numbers.
// Outlet revenue is visible to the same roles that can see a venue's orders.
import { can } from "@/server/authz/permissions";
import { ApiError } from "@/server/http/errors";
import { requireOrg, route } from "@/server/http/handler";
import { outlets } from "@/server/horeca/reports";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  if (!can(role as Parameters<typeof can>[0], "store:orders")) throw new ApiError("forbidden", "Your role can't see outlet sales");
  return outlets(orgId);
});
