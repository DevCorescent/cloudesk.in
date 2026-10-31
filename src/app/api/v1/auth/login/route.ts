import { z } from "zod";
import { sessionCookie } from "@/server/auth/session";
import { readJson, route } from "@/server/http/handler";
import { email } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { logIn } from "@/server/services/auth";

const body = z.object({ email, password: z.string().min(1).max(200) });

export const POST = route(
  async (ctx) => {
    const input = await readJson(ctx.req, body);
    await rateLimit(`login:ip:${ctx.ip}`, 30, 15 * 60_000);
    await rateLimit(`login:email:${input.email}`, 10, 15 * 60_000);
    const r = await logIn(input, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
    if ("mfaChallenge" in r) return { mfaRequired: true, challenge: r.mfaChallenge };
    ctx.headers.append("Set-Cookie", sessionCookie(r.session.token, r.session.expiresAt));
    return { user: { id: r.user.id, name: r.user.name, email: r.user.email } };
  },
  { auth: false },
);
