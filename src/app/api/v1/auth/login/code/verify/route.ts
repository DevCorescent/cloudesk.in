// Sign in with a code: the code starts a session (or the two-step challenge).
import { z } from "zod";
import { sessionCookie } from "@/server/auth/session";
import { readJson, route } from "@/server/http/handler";
import { email } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { logInWithCode } from "@/server/services/auth";

export const POST = route(
  async (ctx) => {
    const input = await readJson(ctx.req, z.object({ email, code: z.string().trim().min(6).max(12) }));
    await rateLimit(`login:ip:${ctx.ip}`, 30, 15 * 60_000);
    await rateLimit(`login:email:${input.email}`, 10, 15 * 60_000);
    const r = await logInWithCode(input, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
    if ("mfaChallenge" in r) return { mfaRequired: true, challenge: r.mfaChallenge };
    ctx.headers.append("Set-Cookie", sessionCookie(r.session.token, r.session.expiresAt));
    return { user: { id: r.user.id, name: r.user.name, email: r.user.email } };
  },
  { auth: false },
);
