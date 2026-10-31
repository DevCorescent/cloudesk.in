import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { acceptInvitation } from "@/server/services/orgs";

export const POST = route(async (ctx) => {
  const { token } = await readJson(ctx.req, z.object({ token: z.string().min(10).max(200) }));
  const inv = await acceptInvitation(token, ctx.user);
  return { orgId: inv.orgId, orgName: inv.orgName };
});
