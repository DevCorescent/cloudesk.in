import { monthlySpend } from "@/server/ai/tasks";
import { requireOrg, route } from "@/server/http/handler";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  return { ai: await monthlySpend(orgId) };
});
