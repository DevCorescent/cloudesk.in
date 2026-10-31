import { mfaCookie } from "@/server/auth/mfa";
import { finish, SSO_COOKIE, ssoCookie } from "@/server/auth/sso";
import { readCookie, sessionCookie } from "@/server/auth/session";
import { route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { appUrl } from "@/server/services/mail";

export const GET = route(
  async (ctx) => {
    await rateLimit(`sso-cb:${ctx.ip}`, 30, 15 * 60_000);
    const url = new URL(ctx.req.url);
    const r = await finish({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), cookie: readCookie(ctx.req.headers.get("cookie"), SSO_COOKIE), meta: { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") } });
    ctx.headers.append("Set-Cookie", ssoCookie("", 0));
    if (r.kind === "session") {
      ctx.headers.append("Set-Cookie", sessionCookie(r.token, r.expiresAt));
      return new Response(null, { status: 302, headers: { Location: appUrl(r.next) } });
    }
    if (r.kind === "mfa") {
      // The account has two-step sign-in on: the challenge waits in an HttpOnly cookie for the code.
      ctx.headers.append("Set-Cookie", mfaCookie(r.challenge, 300));
      return new Response(null, { status: 302, headers: { Location: appUrl(`/login?mfa=1&next=${encodeURIComponent(r.next)}`) } });
    }
    return new Response(null, { status: 302, headers: { Location: appUrl(`/login?sso=1&error=${encodeURIComponent(r.message)}`) } });
  },
  { auth: false },
);
