// An event's public registration page: /e/<token>. The form posts back here;
// the person becomes a CRM contact and gets a confirmation email.
import { clientIp } from "@/server/http/handler";
import { ApiError } from "@/server/http/errors";
import { eventByToken, register } from "@/server/marketing/core";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f6f5f2;color:#18181b;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{width:100%;max-width:460px;background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 60px -30px rgba(0,0,0,.25)}h1{font-size:24px;margin:0 0 6px;letter-spacing:-.02em}p{color:#52525b;margin:0 0 12px}.meta{font-size:14px}label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}input[type=text],input[type=email],input[type=tel]{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #d4d4d8;border-radius:12px}.check{display:flex;gap:8px;font-weight:400;color:#52525b}button{margin-top:18px;font:inherit;font-weight:600;border:0;border-radius:999px;background:#18181b;color:#fff;padding:12px 24px;cursor:pointer;width:100%}.err{color:#b91c1c}</style><main>${body}</main></html>`;

function form(ev: NonNullable<Awaited<ReturnType<typeof eventByToken>>>, error = "") {
  const c = ev.campaign;
  const when = c.eventAt ? c.eventAt.toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
  const meta = [when && `When: ${esc(when)}`, c.venue && `Where: ${esc(c.venue)}`, c.onlineUrl && "Online", c.capacity ? `${Math.max(0, c.capacity - ev.taken)} places left` : ""].filter(Boolean).join("<br>");
  const head = `<p class="meta">${esc(ev.org)}</p><h1>${esc(c.name)}</h1>${c.notes ? `<p>${esc(c.notes).replace(/\n/g, "<br>")}</p>` : ""}${meta ? `<p class="meta">${meta}</p>` : ""}`;
  if (!ev.open) return page(c.name, `${head}<p><b>Registration is closed.</b></p>`);
  return page(c.name, `${head}${error ? `<p class="err">${esc(error)}</p>` : ""}<form method="post"><label for="name">Your name</label><input type="text" id="name" name="name" required maxlength="120"><label for="email">Email</label><input type="email" id="email" name="email" required maxlength="200"><label for="phone">Phone (optional)</label><input type="tel" id="phone" name="phone" maxlength="30"><label class="check"><input type="checkbox" name="consent" value="yes"> Send me news and offers too</label><button type="submit">Register</button></form>`);
}

export async function GET(_req: Request, { params }: Ctx) {
  const ev = await eventByToken((await params).token);
  return ev ? new Response(form(ev), { headers: HEADERS }) : new Response(page("Not found", "<h1>This event isn't here</h1><p>The link may be wrong, or the event has been taken down.</p>"), { status: 404, headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const ev = await eventByToken(token);
  if (!ev) return new Response(page("Not found", "<h1>This event isn't here</h1>"), { status: 404, headers: HEADERS });
  try {
    await rateLimit(`mkt-reg:${clientIp(req) ?? "?"}`, 20, 3600_000);
    const f = new URLSearchParams(await req.text());
    const out = await register(token, { name: f.get("name") ?? "", email: f.get("email") ?? "", phone: f.get("phone") ?? "", consent: f.get("consent") === "yes" });
    return new Response(page(ev.campaign.name, `<h1>${out.already ? "You're already registered" : "You're registered"}</h1><p>${out.already ? "We have you down already." : "We've sent a confirmation to your email."} See you at ${esc(ev.campaign.name)}.</p>`), { headers: HEADERS });
  } catch (e) {
    return new Response(form(ev, e instanceof ApiError ? e.message : "Something went wrong — please try again"), { status: e instanceof ApiError && e.code === "rate_limited" ? 429 : 422, headers: HEADERS });
  }
}
