import { requireOrg, route } from "@/server/http/handler";
import { listMembers } from "@/server/services/orgs";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  return { members: await listMembers(orgId), yourRole: role };
});
