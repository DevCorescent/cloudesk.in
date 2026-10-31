import { clearSessionCookie, revokeSession } from "@/server/auth/session";
import { route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";

export const POST = route(
  async (ctx) => {
    if (ctx.sessionId) {
      await revokeSession(ctx.sessionId);
      await audit({ actorId: ctx.user?.id, action: "user.logout", ip: ctx.ip });
    }
    ctx.headers.append("Set-Cookie", clearSessionCookie());
    return { ok: true };
  },
  { auth: false },
);
