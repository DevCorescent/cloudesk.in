// A table's QR menu: /t/<token>. Guests browse, order, follow their order,
// call a waiter and ask for the bill.
import { createHash } from "node:crypto";
import { z } from "zod";
import { QR_MENU_SCRIPT } from "@/lib/horeca/qr-page";
import { guestFeedback, guestRequest, guestStatus, placeGuestOrder } from "@/server/horeca/orders";
import { qrMenuHtml } from "@/server/horeca/public";
import { clientIp, errorResponse } from "@/server/http/handler";
import { ApiError } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const CSP = ["default-src 'none'", "img-src 'self' https: data:", "style-src 'unsafe-inline'", `script-src 'sha256-${createHash("sha256").update(QR_MENU_SCRIPT).digest("base64")}'`, "connect-src 'self'", "form-action 'self'", "frame-ancestors 'self'", "base-uri 'none'"].join("; ");
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex" };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    await rateLimit(`qr-menu:${clientIp(req) ?? "?"}`, 600, 600_000);
    if (new URL(req.url).searchParams.has("status")) {
      const s = await guestStatus(token);
      return Response.json(s ?? { order: null }, { headers: { "Cache-Control": "no-store" } });
    }
    const html = await qrMenuHtml(token);
    if (!html) return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center;color:#444"><div><h1 style="font-size:20px">This QR code isn't active</h1><p>Please ask your server for the menu.</p></div>`, { status: 404, headers: HEADERS });
    return new Response(html, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) throw new ApiError("forbidden", "Cross-origin request rejected");
    await rateLimit(`qr-order:${clientIp(req) ?? "?"}`, 40, 600_000);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = z.enum(["order", "request", "feedback"]).parse(body?.action);
    if (action === "feedback") {
      await guestFeedback(token, Number(body?.rating), String(body?.comment ?? ""));
      return Response.json({ ok: true });
    }
    if (action === "request") {
      await guestRequest(token, String(body?.kind ?? ""));
      return Response.json({ ok: true });
    }
    return Response.json(await placeGuestOrder(token, body));
  } catch (e) {
    return errorResponse(e);
  }
}
