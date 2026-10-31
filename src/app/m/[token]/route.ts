// Links in marketing emails: /m/<send>.<n>.<sig> records the click and goes on
// to the link that was in the email; /m/<send>.u.<sig> is the unsubscribe
// page (showing it changes nothing — mail scanners open links; the button does).
import { clientIp } from "@/server/http/handler";
import { click, unsubscribeSend, validUnsubscribe } from "@/server/marketing/core";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const page = (body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f6f5f2;color:#18181b;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:420px;background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 60px -30px rgba(0,0,0,.25);text-align:center}h1{font-size:22px;margin:0 0 8px;letter-spacing:-.02em}p{color:#52525b;margin:0 0 20px}button{font:inherit;font-weight:600;border:0;border-radius:999px;background:#18181b;color:#fff;padding:12px 24px;cursor:pointer}</style><main>${body}</main></html>`;
const gone = () => new Response(page("<h1>This link has expired</h1><p>Reply to the email if you need anything.</p>"), { status: 404, headers: HEADERS });

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  try {
    await rateLimit(`mkt-link:${clientIp(req) ?? "?"}`, 300, 3600_000);
  } catch {
    return new Response(page("<h1>Too many tries</h1><p>Please try again in a while.</p>"), { status: 429, headers: HEADERS });
  }
  if (token.split(".")[1] === "u") return validUnsubscribe(token) ? new Response(page(`<h1>Stop these emails?</h1><p>You won't get any more marketing or follow-up emails from this business.</p><form method="post"><button type="submit">Unsubscribe</button></form>`), { headers: HEADERS }) : gone();
  const url = await click(token);
  return url ? new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }) : gone();
}

export async function POST(req: Request, { params }: Ctx) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  try {
    await rateLimit(`mkt-unsub:${clientIp(req) ?? "?"}`, 30, 3600_000);
  } catch {
    return new Response(page("<h1>Too many tries</h1><p>Please try again in a while.</p>"), { status: 429, headers: HEADERS });
  }
  const ok = await unsubscribeSend((await params).token);
  return ok ? new Response(page("<h1>You're unsubscribed</h1><p>You won't get these emails again.</p>"), { headers: HEADERS }) : gone();
}
