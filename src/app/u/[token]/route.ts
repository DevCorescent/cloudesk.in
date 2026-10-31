// Unsubscribe from a workspace's CRM email: /u/<signed contact token>. Showing
// the page changes nothing (mail scanners open links); the button does.
import { unsubscribe, readUnsubscribeToken } from "@/server/crm/activities";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const page = (body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title><style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f6f5f2;color:#18181b;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:420px;background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 60px -30px rgba(0,0,0,.25);text-align:center}h1{font-size:22px;margin:0 0 8px;letter-spacing:-.02em}p{color:#52525b;margin:0 0 20px}button{font:inherit;font-weight:600;border:0;border-radius:999px;background:#18181b;color:#fff;padding:12px 24px;cursor:pointer}</style><main>${body}</main></html>`;

export async function GET(_req: Request, { params }: Ctx) {
  const ok = !!readUnsubscribeToken((await params).token);
  return new Response(page(ok ? `<h1>Stop these emails?</h1><p>You won't get any more follow-up emails from this business.</p><form method="post"><button type="submit">Unsubscribe</button></form>` : `<h1>This link has expired</h1><p>Reply to the email and ask to be removed instead.</p>`), { status: ok ? 200 : 404, headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  try {
    await rateLimit(`crm-unsub:${clientIp(req) ?? "?"}`, 30, 3600_000);
  } catch {
    return new Response(page("<h1>Too many tries</h1><p>Please try again in a while.</p>"), { status: 429, headers: HEADERS });
  }
  const c = await unsubscribe((await params).token);
  return new Response(page(c ? "<h1>You're unsubscribed</h1><p>You won't get follow-up emails from us again.</p>" : "<h1>This link has expired</h1><p>Reply to the email and ask to be removed instead.</p>"), { status: c ? 200 : 404, headers: HEADERS });
}
