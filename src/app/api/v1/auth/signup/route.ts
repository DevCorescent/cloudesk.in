import { z } from "zod";
import { readCookie, sessionCookie } from "@/server/auth/session";
import { claimOutreach } from "@/server/outreach/claim";
import { readJson, route } from "@/server/http/handler";
import { email, password } from "@/server/http/schemas";
import { ApiError } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { signUp } from "@/server/services/auth";

const body = z.object({ name: z.string().trim().min(1, "Enter your name").max(100), email, password, orgName: z.string().trim().max(100).optional() });

// Direct sign-up (no emailed code) is for development, tests and scripts. In
// production people sign up through onboarding with a code (/api/v1/auth/signup/start).
const direct = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_DIRECT_SIGNUP === "1";

export const POST = route(
  async (ctx) => {
    if (!direct()) throw new ApiError("forbidden", "Sign up at /start — we'll email you a code to confirm your address.");
    await rateLimit(`signup:${ctx.ip}`, 10, 3600_000);
    const input = await readJson(ctx.req, body);
    const { user, session } = await signUp(input, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
    await claimOutreach(user.email, readCookie(ctx.req.headers.get("cookie"), "cc_po"));
    ctx.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return Response.json({ user: { id: user.id, name: user.name, email: user.email } }, { status: 201 });
  },
  { auth: false },
);
