// What a client sees when they open a shared invoice or quotation: the
// document exactly as it prints, with Download/Print, pay-by-UPI on phones,
// and Accept/Decline for quotations. Works without JavaScript (plain forms).
import { DOC_LABEL, STATUS_LABEL, type DocType } from "@/lib/invoicing/model";
import { upiPayUrl } from "@/lib/store/barcode";
import { formatMoney } from "@/lib/store/money";
import { ApiError } from "@/server/http/errors";
import { decideQuote, markViewed, publicDoc, renderDoc } from "@/server/invoicing/service";
import { rateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/http/handler";

type Ctx = { params: Promise<{ token: string }> };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

const notFoundPage = () =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;color:#444;text-align:center"><div><h1 style="font-size:20px">This link isn't available</h1><p>It may have been mistyped, or the document was withdrawn. Ask the sender for a new link.</p></div>`, { status: 404, headers: HEADERS });

const TOOLBAR_CSS = `
.tb{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;max-width:calc(210mm + 32px);margin:-24px auto 16px;padding:12px 16px;background:rgb(255 255 255/.86);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid #e5e5ea;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px}
.tb b{font-weight:600}.tb .muted{color:#6b7280}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;background:#f2f2f5;font-size:12px;font-weight:600;margin-left:6px}
.pill.ok{background:#dcfce7;color:#166534}.pill.warn{background:#fef3c7;color:#92400e}.pill.bad{background:#fee2e2;color:#991b1b}
.btn{appearance:none;border:1px solid #d4d4d8;background:#fff;color:#111;border-radius:999px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.btn.primary{background:#111;color:#fff;border-color:#111}
.decide{max-width:calc(210mm + 32px);margin:0 auto 16px;padding:0 16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.decide form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#fff;border:1px solid #e5e5ea;border-radius:16px;padding:14px}
.decide input{flex:1;min-width:160px;border:1px solid #d4d4d8;border-radius:10px;padding:9px 12px;font:inherit}
.msg{max-width:calc(210mm + 32px);margin:0 auto 16px;padding:12px 16px;border-radius:12px;font-family:system-ui;font-size:14px}
.msg.ok{background:#dcfce7;color:#14532d}.msg.bad{background:#fee2e2;color:#7f1d1d}
`;
// Paper is A4-wide; on phones, shrink just the paper to fit the screen. Phones widen the
// page to fit the paper before this runs, so measure the device itself, not the page.
const FIT = `<script>addEventListener("DOMContentLoaded",function(){var p=document.querySelector(".paper");if(!p)return;function f(){p.style.zoom="";var w=Math.min(innerWidth,document.documentElement.clientWidth||innerWidth,(window.screen&&screen.width)||innerWidth);var z=Math.min(1,(w-16)/p.offsetWidth);p.style.zoom=z<1?String(z):""}f();addEventListener("resize",f)})</script>`;

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  await rateLimit(`doc:${clientIp(req) ?? "?"}`, 300, 3600_000);
  const found = await publicDoc(token);
  if (!found) return notFoundPage();
  const { doc: d, view, settings, template } = found;
  await markViewed(d);
  const url = new URL(req.url);
  const flash = url.searchParams.get("m");
  const label = DOC_LABEL[d.type as DocType];
  const st = view.displayStatus;
  const tone = st === "paid" || st === "accepted" ? "ok" : st === "overdue" || st === "void" || st === "declined" || st === "expired" ? "bad" : "warn";
  const openQuote = d.type === "quote" && (st === "sent" || st === "viewed");
  const upi = settings.payment.upiId && d.currency === "INR" && view.balance > 0 && (d.type === "invoice" || d.type === "proforma") && d.status !== "void" ? upiPayUrl({ vpa: settings.payment.upiId, name: settings.business.name || "Payment", amountMinor: view.balance, note: d.number, ref: d.number.replace(/[^\w]/g, "").slice(0, 35) }) : null;
  const toolbar = `${FIT}<div class="tb no-print">
      <div><b>${esc(settings.business.name || "")}</b> <span class="muted">· ${esc(label)} ${esc(d.number)}</span><span class="pill ${tone}">${esc(STATUS_LABEL[st])}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${upi ? `<a class="btn primary" href="${esc(upi)}">Pay ${esc(formatMoney(view.balance, d.currency))} by UPI</a>` : ""}
        <button class="btn${upi ? "" : " primary"}" onclick="window.print()">Download PDF / Print</button>
      </div>
    </div>
    ${flash === "accepted" ? `<div class="msg ok no-print">Thank you — you've accepted this quotation. ${esc(settings.business.name || "The business")} has been notified in their dashboard.</div>` : flash === "declined" ? `<div class="msg ok no-print">Thanks for letting us know — you've declined this quotation.</div>` : flash === "error" ? `<div class="msg bad no-print">${esc(url.searchParams.get("e") ?? "Something went wrong")}</div>` : ""}
    ${openQuote ? `<div class="decide no-print"><form method="post"><input name="name" required maxlength="120" placeholder="Your name" autocomplete="name"><input name="note" maxlength="500" placeholder="Note (optional)"><button class="btn primary" name="decision" value="accept">Accept quotation</button><button class="btn" name="decision" value="decline">Decline</button></form></div>` : ""}`;
  const html = renderDoc(d, settings, template, { before: toolbar, extraCss: TOOLBAR_CSS });
  return new Response(html, { headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  await rateLimit(`doc-decide:${clientIp(req) ?? "?"}`, 30, 3600_000);
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/doc/${encodeURIComponent(token)}?${q}` } });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const form = await req.formData().catch(() => null);
  const decision = form?.get("decision");
  const name = String(form?.get("name") ?? "").trim();
  const note = String(form?.get("note") ?? "").trim();
  if ((decision !== "accept" && decision !== "decline") || !name) return back(`m=error&e=${encodeURIComponent("Please enter your name to respond")}`);
  try {
    await decideQuote(token, decision, name, note);
    return back(`m=${decision === "accept" ? "accepted" : "declined"}`);
  } catch (e) {
    return back(`m=error&e=${encodeURIComponent(e instanceof ApiError ? e.message : "Couldn't record your answer")}`);
  }
}
