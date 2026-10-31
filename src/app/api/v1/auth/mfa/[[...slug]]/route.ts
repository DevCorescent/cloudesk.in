import QRCode from "qrcode";
import { z } from "zod";
import { beginTotpSetup, disableTotp, enableTotp, mfaStatus, regenerateRecoveryCodes } from "@/server/auth/mfa";
import { notFound } from "@/server/http/errors";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { slug?: string[] };

async function handle(ctx: AuthedContext, { slug = [] }: P) {
  const key = `${ctx.req.method} ${slug.join("/")}`;
  switch (key) {
    case "GET ":
      return mfaStatus(ctx.user.id);
    case "POST setup": {
      await rateLimit(`mfa-setup:${ctx.user.id}`, 10, 3600_000);
      const s = await beginTotpSetup(ctx.user.id, ctx.user.email);
      // The QR code is drawn on the server so the secret never goes to a third-party service.
      return { secret: s.secret, url: s.url, qr: await QRCode.toString(s.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }
    case "POST enable": {
      await rateLimit(`mfa-enable:${ctx.user.id}`, 20, 3600_000);
      const { code } = await readJson(ctx.req, z.object({ code: z.string().trim().min(6).max(10) }));
      return enableTotp(ctx.user.id, code, { ip: ctx.ip, sessionId: ctx.sessionId });
    }
    case "POST disable": {
      await rateLimit(`mfa-disable:${ctx.user.id}`, 10, 3600_000);
      const body = await readJson(ctx.req, z.object({ password: z.string().max(200).optional(), code: z.string().max(20).optional() }));
      await disableTotp(ctx.user.id, body, { ip: ctx.ip, sessionId: ctx.sessionId });
      return { ok: true };
    }
    case "POST recovery-codes": {
      await rateLimit(`mfa-recovery:${ctx.user.id}`, 10, 3600_000);
      const { code } = await readJson(ctx.req, z.object({ code: z.string().trim().min(6).max(10) }));
      return regenerateRecoveryCodes(ctx.user.id, code);
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
