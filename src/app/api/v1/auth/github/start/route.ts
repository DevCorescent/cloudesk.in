import { startGithub } from "@/server/auth/github";
import { ApiError } from "@/server/http/errors";
import { route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

/** Redirects to GitHub. ?mode=link connects GitHub to the signed-in account. */
export const GET = route(
  async (ctx) => {
    await rateLimit(`github-start:${ctx.ip}`, 30, 15 * 60_000);
    const url = new URL(ctx.req.url);
    const mode = url.searchParams.get("mode") === "link" ? "link" : "login";
    if (mode === "link" && !ctx.user) throw new ApiError("unauthenticated", "Sign in first");
    const s = startGithub({ next: url.searchParams.get("next"), mode, userId: ctx.user?.id });
    ctx.headers.append("Set-Cookie", s.cookie);
    return new Response(null, { status: 302, headers: { Location: s.url } });
  },
  { auth: false },
);
