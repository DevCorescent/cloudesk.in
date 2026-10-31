// Sign-up step 1: the onboarding answers and account details; emails a six-digit code.
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { signupStart, startSignup } from "@/server/services/signup";

export const POST = route(
  async (ctx) => {
    await rateLimit(`signup:${ctx.ip}`, 10, 3600_000);
    return startSignup(await readJson(ctx.req, signupStart), { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
