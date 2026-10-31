// Sign in with a code: emails a six-digit code (the same answer whether or not the account exists).
import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { email } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { sendLoginCode } from "@/server/services/auth";

export const POST = route(
  async (ctx) => {
    const input = await readJson(ctx.req, z.object({ email }));
    await rateLimit(`login:ip:${ctx.ip}`, 30, 15 * 60_000);
    return sendLoginCode(input.email, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
