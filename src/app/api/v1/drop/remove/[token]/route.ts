// The delete link a Drive QR uploader gets by email (no sign-in): what it
// deletes, and deleting it completely.
import { removeByToken, removeView } from "@/server/documents/drop";
import { route, type RequestContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { token: string };

export const GET = route<P>(
  async (ctx: RequestContext, { token }: P) => {
    await rateLimit(`drop-remove:${ctx.ip}`, 60, 60 * 60_000);
    return removeView(token);
  },
  { auth: false },
);

export const POST = route<P>(
  async (ctx: RequestContext, { token }: P) => {
    await rateLimit(`drop-remove:${ctx.ip}`, 60, 60 * 60_000);
    return removeByToken(token, { ip: ctx.ip ?? null, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
