import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { previewInvitation } from "@/server/services/orgs";

export const POST = route(
  async (ctx) => {
    await rateLimit(`invprev:${ctx.ip}`, 30, 3600_000);
    const { token } = await readJson(ctx.req, z.object({ token: z.string().min(10).max(200) }));
    const inv = await previewInvitation(token);
    return { orgName: inv.orgName, email: inv.email, role: inv.role };
  },
  { auth: false },
);
