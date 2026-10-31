import { finishGithub, OAUTH_COOKIE, stateCookie } from "@/server/auth/github";
import { mfaCookie } from "@/server/auth/mfa";
import { readCookie, sessionCookie } from "@/server/auth/session";
import { route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { appUrl } from "@/server/services/mail";

export const GET = route(
  async (ctx) => {
    await rateLimit(`github-cb:${ctx.ip}`, 30, 15 * 60_000);
    const url = new URL(ctx.req.url);
    const r = await finishGithub({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      cookie: readCookie(ctx.req.headers.get("cookie"), OAUTH_COOKIE),
      currentUserId: ctx.user?.id ?? null,
      meta: { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") },
    });
    ctx.headers.append("Set-Cookie", stateCookie("", 0));
    let to: string;
    if (r.kind === "session") {
      ctx.headers.append("Set-Cookie", sessionCookie(r.token, r.expiresAt));
      to = r.next;
    } else if (r.kind === "mfa") {
      // The challenge stays in an HttpOnly cookie, never in a URL.
      ctx.headers.append("Set-Cookie", mfaCookie(r.challenge, 300));
      to = `/login?mfa=1&next=${encodeURIComponent(r.next)}`;
    } else if (r.kind === "linked") {
      to = r.next;
    } else {
      to = `${r.next}${r.next.includes("?") ? "&" : "?"}error=${encodeURIComponent(r.message)}`;
    }
    return new Response(null, { status: 302, headers: { Location: appUrl(to) } });
  },
  { auth: false },
);
