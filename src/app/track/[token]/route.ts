// A shipment's public tracking page: /track/<token>. Shows where it is and
// when it's due — never costs or internal notes.
import { clientIp } from "@/server/http/handler";
import { track } from "@/server/logistics/core";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#f6f5f2;color:#18181b;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{width:100%;max-width:460px;background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 60px -30px rgba(0,0,0,.25)}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}p{color:#52525b;margin:0 0 12px}.s{display:inline-block;border-radius:999px;background:#eef2ff;color:#3730a3;font-weight:600;font-size:14px;padding:4px 12px;margin:8px 0 16px}ol{list-style:none;padding:0;margin:0;border-left:2px solid #e4e4e7}li{position:relative;padding:0 0 14px 16px;font-size:14px}li:before{content:"";position:absolute;left:-6px;top:5px;width:10px;height:10px;border-radius:50%;background:#18181b}small{color:#71717a}a{color:#18181b}</style><main>${body}</main></html>`;
const fmt = (iso: string | Date) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export async function GET(req: Request, { params }: Ctx) {
  try {
    await rateLimit(`track:${clientIp(req) ?? "?"}`, 120, 3600_000);
  } catch {
    return new Response(page("Too many requests", "<h1>Too many tries</h1><p>Please try again in a while.</p>"), { status: 429, headers: HEADERS });
  }
  const t = await track((await params).token);
  if (!t) return new Response(page("Not found", "<h1>We can't find that shipment</h1><p>Check the link, or ask whoever sent it.</p>"), { status: 404, headers: HEADERS });
  const due = t.status === "delivered" ? `Delivered ${t.deliveredAt ? fmt(t.deliveredAt) : ""}${t.receivedBy ? ` · received by ${esc(t.receivedBy)}` : ""}` : t.promisedOn ? `Expected by ${new Date(`${t.promisedOn}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" })}` : "";
  const carrier = t.carrier ? `<p>With ${esc(t.carrier)}${t.trackingNo ? ` · ${esc(t.trackingNo)}` : ""}${t.carrierLink ? ` · <a href="${esc(t.carrierLink)}" rel="noreferrer">track with them</a>` : ""}</p>` : "";
  const steps = t.steps.length ? `<ol>${[...t.steps].reverse().map((x) => `<li><b>${esc(x.status)}</b><br><small>${fmt(x.at)}</small></li>`).join("")}</ol>` : "<p>It's being got ready.</p>";
  return new Response(page(`${t.number} · ${t.label}`, `<p>${esc(t.from)} · ${esc(t.number)} · ${t.packages} package${t.packages === 1 ? "" : "s"}</p><h1>${esc(t.label)}</h1><span class="s">${esc(due)}</span>${carrier}${steps}`), { headers: HEADERS });
}
