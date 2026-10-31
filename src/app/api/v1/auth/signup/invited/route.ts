// Sign-up for someone invited to a workspace: name and password, then the emailed code (POST signup/verify).
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { invitedStart, startInvitedSignup } from "@/server/services/signup";

export const POST = route(
  async (ctx) => {
    await rateLimit(`signup:${ctx.ip}`, 10, 3600_000);
    return startInvitedSignup(await readJson(ctx.req, invitedStart), { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
