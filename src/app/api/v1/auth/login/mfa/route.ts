import { z } from "zod";
import { completeChallenge, MFA_COOKIE, mfaCookie } from "@/server/auth/mfa";
import { readCookie, sessionCookie } from "@/server/auth/session";
import { ApiError } from "@/server/http/errors";
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

/** Second step of sign-in: the challenge from step one plus an authenticator or recovery code. */
export const POST = route(
  async (ctx) => {
    const input = await readJson(ctx.req, z.object({ challenge: z.string().min(20).max(100).optional(), code: z.string().trim().min(6).max(20) }));
    await rateLimit(`mfa:ip:${ctx.ip}`, 30, 15 * 60_000);
    // Password sign-ins send the challenge; GitHub sign-ins carry it in a cookie.
    const challenge = input.challenge ?? readCookie(ctx.req.headers.get("cookie"), MFA_COOKIE);
    if (!challenge) throw new ApiError("unauthenticated", "This sign-in expired. Start again.");
    const r = await completeChallenge(challenge, input.code, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
    ctx.headers.append("Set-Cookie", sessionCookie(r.session.token, r.session.expiresAt));
    ctx.headers.append("Set-Cookie", mfaCookie("", 0));
    return { user: { id: r.user.id, name: r.user.name, email: r.user.email }, usedRecoveryCode: r.usedRecoveryCode };
  },
  { auth: false },
);
