// "My work" for the signed-in member: approvals and tasks waiting on them, across modules.
import { requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { myWork } from "@/server/approvals/inbox";

type P = { orgId: string };

export const GET = route<P>(async (ctx: AuthedContext, { orgId }: P) => {
  await requireOrg(ctx, orgId, "org:read");
  return myWork(ctx, orgId);
});
