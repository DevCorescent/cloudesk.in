import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { esc } from "@/lib/site/html";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { addComment, decideReview, listComments, reviewLinkByToken } from "@/server/services/collab";

// Client review: the preview in a frame, page comments and an approve /
// request-changes decision. No account and no JavaScript needed.
type Ctx = { params: Promise<{ token: string }> };

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#18181a;background:#f4f4f2}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #e4e4e0;flex-wrap:wrap}h1{font-size:15px;margin:0}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;height:calc(100vh - 54px)}.stage{display:flex;flex-direction:column;min-width:0}.bar{display:flex;gap:6px;padding:8px 12px;flex-wrap:wrap;align-items:center}
.bar a{padding:4px 10px;border-radius:99px;border:1px solid #d2d2cc;color:inherit;text-decoration:none;font-size:12px;background:#fff}.bar a.on{background:#18181a;color:#fff;border-color:#18181a}
.frame{flex:1;display:flex;justify-content:center;padding:0 12px 12px}iframe{width:100%;height:100%;border:1px solid #e4e4e0;border-radius:10px;background:#fff}
aside{background:#fff;border-left:1px solid #e4e4e0;overflow-y:auto;padding:16px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5f5f66;margin:18px 0 8px}
.c{padding:10px;border:1px solid #e4e4e0;border-radius:8px;margin-bottom:8px}.c small{color:#8b8b92}.c.res{opacity:.55}label{display:block;font-size:12px;color:#5f5f66;margin:8px 0 4px}
input,textarea,select{width:100%;font:inherit;padding:8px 10px;border:1px solid #d2d2cc;border-radius:8px}button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #d2d2cc;background:#fff;cursor:pointer}
.primary{background:#18181a;color:#fff;border-color:#18181a}.row{display:flex;gap:8px;margin-top:10px}.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;background:#eaf1fe;color:#2f6fed}.ok{background:#e6f4ec;color:#1d7a46}.warn{background:#fdf3dc;color:#9a6200}
.note{padding:10px;border-radius:8px;background:#e6f4ec;margin-bottom:10px}@media(max-width:900px){.layout{grid-template-columns:1fr;height:auto}.frame{height:70vh}aside{border-left:0;border-top:1px solid #e4e4e0}}
</style></head><body>${body}</body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  const r = await reviewLinkByToken(token);
  if (!r) return page("Review link unavailable", `<header><h1>This review link has expired or been turned off.</h1></header><p style="padding:16px">Ask the team for a new link.</p>`, 404);
  const url = new URL(req.url);
  const [dep] = await db.select({ artifact: schema.deployments.artifact }).from(schema.deployments).where(eq(schema.deployments.id, r.link.deploymentId));
  const doc = JSON.parse(((dep?.artifact ?? {}) as Record<string, string>)["/__doc"] ?? "{}") as { pages?: { id: string; path: string; title: string; kind?: string; lang?: string }[] };
  const pages = (doc.pages ?? []).filter((p) => (p.kind ?? "page") === "page").slice(0, 30);
  const current = pages.find((p) => p.path === url.searchParams.get("page")) ?? pages[0];
  const width = url.searchParams.get("w") === "mobile" ? "390px" : url.searchParams.get("w") === "tablet" ? "820px" : "100%";
  const comments = (await listComments(r.project.id)).filter((c) => !current || c.pageId === current.id);
  const status = r.link.status === "approved" ? `<span class="badge ok">Approved by ${esc(r.link.decidedBy ?? "")}</span>` : r.link.status === "changes_requested" ? `<span class="badge warn">Changes requested by ${esc(r.link.decidedBy ?? "")}</span>` : `<span class="badge">Waiting for your review</span>`;
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ ...(current ? { page: current.path } : {}), ...(url.searchParams.get("w") ? { w: url.searchParams.get("w")! } : {}), ...o })}`;
  const body = `<header><h1>${esc(r.project.name)}${r.link.label ? ` · ${esc(r.link.label)}` : ""}</h1>${status}</header>
<div class="layout"><div class="stage"><nav class="bar">${pages.map((p) => `<a class="${p.id === current?.id ? "on" : ""}" href="${esc(q({ page: p.path }))}">${esc(p.title)}</a>`).join("")}<span style="flex:1"></span>${[["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile", "Phone"]].map(([w, l]) => `<a class="${(url.searchParams.get("w") ?? "desktop") === w ? "on" : ""}" href="${esc(q({ w }))}">${l}</a>`).join("")}</nav>
<div class="frame"><iframe title="Preview" src="/rv/${esc(token)}${current && current.path !== "/" ? esc(current.path) : "/"}" style="max-width:${width}"></iframe></div></div>
<aside>${url.searchParams.get("sent") === "1" ? `<p class="note">Thanks — your comment was sent to the team.</p>` : url.searchParams.get("decided") === "1" ? `<p class="note">Thanks — the team has been notified.</p>` : ""}
<h2>Your decision</h2><form method="post"><input type="hidden" name="page" value="${esc(current?.path ?? "/")}"><label for="dn">Your name</label><input id="dn" name="name" required maxlength="80"><label for="nt">Note (optional)</label><textarea id="nt" name="note" rows="2" maxlength="1000"></textarea>
<div class="row"><button class="primary" name="action" value="approve">Approve</button><button name="action" value="changes">Request changes</button></div></form>
<h2>Comments on ${esc(current?.title ?? "this page")}</h2>${comments.length ? comments.map((c) => `<div class="c${c.resolvedAt ? " res" : ""}"><strong>${esc(c.authorName ?? c.guestName ?? "Team")}</strong>${c.guestName ? " <small>(client)</small>" : ""} <small>${esc(new Date(c.createdAt).toISOString().slice(0, 10))}${c.resolvedAt ? " · resolved" : ""}</small><div>${esc(c.body).replace(/\n/g, "<br>")}</div></div>`).join("") : `<p style="color:#8b8b92">No comments on this page yet.</p>`}
<form method="post"><input type="hidden" name="action" value="comment"><input type="hidden" name="page" value="${esc(current?.path ?? "/")}"><label for="cn">Your name</label><input id="cn" name="name" required maxlength="80"><label for="cb">Comment</label><textarea id="cb" name="body" rows="4" required maxlength="4000" placeholder="What would you like changed on this page?"></textarea><div class="row"><button class="primary" type="submit">Send comment</button></div></form></aside></div>`;
  return page(`Review · ${r.project.name}`, body);
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const r = await reviewLinkByToken(token);
  if (!r) return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  await rateLimit(`review:${clientIp(req)}`, 30, 600_000);
  const form = await req.formData();
  const f = (k: string) => String(form.get(k) ?? "").trim();
  const name = f("name").slice(0, 80) || "Client";
  const pagePath = f("page");
  const [dep] = await db.select({ artifact: schema.deployments.artifact }).from(schema.deployments).where(eq(schema.deployments.id, r.link.deploymentId));
  const doc = JSON.parse(((dep?.artifact ?? {}) as Record<string, string>)["/__doc"] ?? "{}") as { pages?: { id: string; path: string }[] };
  const pageId = doc.pages?.find((p) => p.path === pagePath)?.id ?? "";
  const back = `/review/${token}?${new URLSearchParams({ page: pagePath || "/" })}`;
  if (f("action") === "comment") {
    if (f("body")) await addComment(r.project, { pageId, sectionId: "", body: f("body"), guestName: name, reviewLinkId: r.link.id });
    return Response.redirect(new URL(`${back}&sent=1`, req.url), 303);
  }
  if (f("action") === "approve" || f("action") === "changes") {
    await decideReview(token, { name, decision: f("action") === "approve" ? "approved" : "changes_requested", note: f("note").slice(0, 1000) });
    if (f("note")) await addComment(r.project, { pageId, sectionId: "", body: `${f("action") === "approve" ? "Approved" : "Requested changes"}: ${f("note")}`, guestName: name, reviewLinkId: r.link.id });
    return Response.redirect(new URL(`${back}&decided=1`, req.url), 303);
  }
  return Response.redirect(new URL(back, req.url), 303);
}
