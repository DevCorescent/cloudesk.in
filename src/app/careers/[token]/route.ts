// A workspace's public careers page: open roles and an application form.
// Applications land in HR → Hiring as candidates.
import { apply, careers } from "@/server/hr/hiring";
import { ApiError } from "@/server/http/errors";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const TYPE: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Internship" };

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f5f1;color:#18181b}
main{max-width:760px;margin:0 auto;padding:48px 20px 80px}h1{font-size:34px;letter-spacing:-.03em;margin:0 0 6px}p.lead{color:#5b5b63;margin:0 0 32px}
details{background:#fff;border-radius:20px;margin:0 0 12px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px -24px rgba(0,0,0,.25)}
summary{list-style:none;cursor:pointer;padding:20px 22px;display:flex;justify-content:space-between;gap:12px;align-items:center}summary::-webkit-details-marker{display:none}
summary b{font-size:18px;letter-spacing:-.01em}.meta{color:#6b6b73;font-size:14px}.chip{font-size:13px;background:#eef3ff;color:#2a5bd7;border-radius:999px;padding:4px 10px;white-space:nowrap}
.body{padding:0 22px 22px}.desc{white-space:pre-wrap;color:#3f3f46;margin:0 0 18px}
form{display:grid;gap:10px}label{font-size:13px;font-weight:600;color:#3f3f46}input,textarea{width:100%;font:inherit;padding:11px 13px;border:1px solid #e3e3e6;border-radius:12px;background:#fff}
button{font:inherit;font-weight:600;border:0;border-radius:999px;background:#18181b;color:#fff;padding:12px 22px;cursor:pointer;justify-self:start}
.empty{background:#fff;border-radius:20px;padding:40px;text-align:center;color:#6b6b73}.ok{background:#e9f8ef;color:#166534;border-radius:16px;padding:18px 20px;margin:0 0 24px}.err{background:#fdecec;color:#991b1b;border-radius:16px;padding:14px 18px;margin:0 0 24px}
.hp{position:absolute;left:-9999px}
</style><main>${body}</main></html>`;
}

async function render(token: string, notice = "") {
  const c = await careers(token);
  if (!c) return new Response(page("Careers", `<div class="empty">This careers page isn't available.</div>`), { status: 404, headers: HEADERS });
  const jobs = c.jobs
    .map(
      (j) => `<details><summary><span><b>${esc(j.title)}</b><br><span class="meta">${[j.department, j.location, TYPE[j.employmentType] ?? ""].filter(Boolean).map((x) => esc(String(x))).join(" · ")}</span></span>${j.salaryRange ? `<span class="chip">${esc(j.salaryRange)}</span>` : ""}</summary>
<div class="body">${j.description ? `<p class="desc">${esc(j.description)}</p>` : ""}
<form method="post"><input type="hidden" name="jobId" value="${j.id}"><input class="hp" name="website" tabindex="-1" autocomplete="off">
<label>Your name<input name="name" required maxlength="120"></label><label>Email<input name="email" type="email" required maxlength="200"></label><label>Phone<input name="phone" maxlength="30"></label>
<label>Link to your CV or LinkedIn<input name="resumeUrl" type="url" placeholder="https://" maxlength="500"></label><label>Anything you'd like us to know<textarea name="notes" rows="3" maxlength="3000"></textarea></label>
<button type="submit">Apply</button></form></div></details>`,
    )
    .join("");
  return new Response(page(`Careers at ${c.company}`, `<h1>Careers at ${esc(c.company)}</h1><p class="lead">${c.jobs.length ? `${c.jobs.length} open role${c.jobs.length === 1 ? "" : "s"}. Tap one to read more and apply.` : "No open roles right now — check back soon."}</p>${notice}${jobs || '<div class="empty">No open roles right now.</div>'}`), { headers: HEADERS });
}

export async function GET(_req: Request, { params }: Ctx) {
  return render((await params).token);
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const form = Object.fromEntries(new URLSearchParams(await req.text()));
  if (form.website) return render(token, `<div class="ok">Thanks — your application is in.</div>`);
  try {
    await rateLimit(`careers:${clientIp(req) ?? "?"}`, 10, 3600_000);
    const r = await apply(token, form);
    return render(token, `<div class="ok">${r.already ? "You've already applied for this role — we have your details." : "Thanks — your application is in. We'll be in touch."}</div>`);
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : "Something went wrong — please try again.";
    return render(token, `<div class="err">${esc(msg)}</div>`);
  }
}
