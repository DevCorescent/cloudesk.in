import { route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { issueEmailVerification } from "@/server/services/auth";

export const POST = route(async (ctx) => {
  await rateLimit(`resend:${ctx.user.id}`, 3, 3600_000);
  if (!ctx.user.emailVerified) await issueEmailVerification(ctx.user.id, ctx.user.email);
  return { ok: true };
});
