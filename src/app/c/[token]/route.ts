// A shared catalogue: /c/<token>. Shoppers browse, set quantities and order
// (checkout or WhatsApp); printing it gives the PDF version. Private
// catalogues ask for an access code first.
import { createHash } from "node:crypto";
import { CATALOGUE_SCRIPT } from "@/lib/store/catalogue";
import { canPreview, placeCatalogueOrder, renderCatalogue, unlockCatalogue } from "@/server/commerce/catalogues";
import { clientIp, errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

// Only the page's own script runs; orders may continue to WhatsApp.
const csp = (embed: boolean) =>
  [
    "default-src 'none'",
    "img-src 'self' https: http: data:",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${createHash("sha256").update(CATALOGUE_SCRIPT).digest("base64")}'`,
    "form-action 'self' https://wa.me https://api.whatsapp.com",
    // Owners can allow other websites to show the catalogue in a frame.
    `frame-ancestors ${embed ? "*" : "'self'"}`,
    "base-uri 'none'",
  ].join("; ");
const headers = (embed = false) => ({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": csp(embed), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Robots-Tag": "noindex" });

const page = (title: string, body: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#3a3a3c;text-align:center;padding:24px"><div><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#6e6e73">${body}</p></div>`, { status, headers: headers() });

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    await rateLimit(`catalogue:${clientIp(req) ?? "?"}`, 300, 600_000);
    const url = new URL(req.url);
    const err = url.searchParams.get("err");
    // ?preview=1: the owner's live preview in the editor — shown even when hidden, never counted.
    const preview = url.searchParams.has("preview") && (await canPreview(token, req.headers.get("cookie")));
    const out = await renderCatalogue(token, { preview, ua: req.headers.get("user-agent"), via: url.searchParams.get("via"), cookie: req.headers.get("cookie"), message: err ? { tone: "bad", text: err.slice(0, 300) } : undefined });
    if (!out) return page("This catalogue isn't available", "The link may be mistyped, or the catalogue was removed. Ask the store for a new link.", 404);
    if (out.closed) return page(out.closed.title, out.closed.text, out.closed.status);
    return new Response(out.html, { headers: headers(out.allowEmbed) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
    const form = await req.formData();
    if (form.get("intent") === "unlock") {
      // Guessing access codes is slow on purpose.
      await rateLimit(`catalogue-code:${clientIp(req) ?? "?"}`, 10, 600_000);
      return await unlockCatalogue(token, form);
    }
    await rateLimit(`catalogue-order:${clientIp(req) ?? "?"}`, 30, 600_000);
    return await placeCatalogueOrder(req, token, form);
  } catch (e) {
    return errorResponse(e);
  }
}
