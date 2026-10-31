import { and, eq } from "drizzle-orm";
import { FRAME_HOSTS } from "@/lib/site/sections-extra";
import { db, schema } from "@/db";
import { readCookie, resolveSession, SESSION_COOKIE } from "../auth/session";
import { getMembership } from "../http/handler";
import { clientIp } from "../http/handler";
import { renderMemberGate, renderStorePage, fillStaticPage, isCommercePath } from "../commerce/storefront";
import { activeMembership, memberCookieName, verifyMemberSession } from "../commerce/digital";
import { siteDocSchema } from "@/lib/site/model";
import { substituteBase } from "../services/deployments";
import { abBucket, isBot, recordStat } from "../services/stats";
import { renderChatPage, withChatLauncher } from "../knowledge/site-chat";
import { seoFile, SEO_PATHS } from "./seo";
import { createHash } from "node:crypto";
import { PROMO_SCRIPT } from "@/lib/promotions/model";
import { recordPromoStat, withPromotions } from "../promotions/service";
import { rateLimit } from "../security/rate-limit";
import { restoreCart } from "../commerce/recovery";
import { cartCookie, redirect } from "../commerce/http";
import { cartCookieName } from "../commerce/cart";
import { recordRequest } from "../platform/metrics";

// Published sites run exactly one script: the promotions runtime, allowed by
// its hash, so no other code (including anything in owner content) can run.
// Web fonts come only from the pinned Fontsource packages on jsDelivr.
const PROMO_HASH = createHash("sha256").update(PROMO_SCRIPT).digest("base64");
const SITE_CSP =
  `default-src 'none'; script-src 'sha256-${PROMO_HASH}'; img-src 'self' https: http: data:; media-src 'self' https:; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; frame-src ${FRAME_HOSTS.join(" ")}; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`;

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": SITE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-cache",
    },
  });
}

// Pages with live prices, stock or a cart must not be cached.
function htmlNoStore(body: string, status = 200) {
  const r = html(body, status);
  r.headers.set("Cache-Control", "private, no-store");
  return r;
}

const notFoundPage = () => html("<!doctype html><title>Not found</title><p style=\"font:16px system-ui;padding:40px\">This site is not available.</p>", 404);

/**
 * Serves a ready deployment's artifact. Preview deployments require a signed-in
 * member of the owning organization; production deployments are public.
 */
type ServeOpts = { requireProduction?: boolean; trackForm?: FormData; publicOrigin?: string; reviewAccess?: boolean };

/** Serves a published page, counted in the platform's request metrics (area "sites"). */
export async function serveDeployment(req: Request, deploymentId: string, pathParts: string[] | undefined, basePath: string, opts: ServeOpts = {}) {
  const started = performance.now();
  const res = await withFreeBadge(deploymentId, await serve(req, deploymentId, pathParts, basePath, opts));
  recordRequest("/sites", res.status, performance.now() - started);
  return res;
}

// Sites of workspaces on the Free plan carry a small "Made with Cloudesk" link
// (no script: published sites allow none). Which workspace a deployment
// belongs to is remembered for a minute.
const orgOfDeployment = new Map<string, { org: string | null; at: number }>();
async function withFreeBadge(deploymentId: string, res: Response) {
  if (res.status !== 200 || !(res.headers.get("content-type") ?? "").startsWith("text/html")) return res;
  let hit = orgOfDeployment.get(deploymentId);
  if (!hit || Date.now() - hit.at > 60_000) {
    const [r] = await db.select({ org: schema.projects.orgId }).from(schema.deployments).innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId)).where(eq(schema.deployments.id, deploymentId));
    hit = { org: r?.org ?? null, at: Date.now() };
    if (orgOfDeployment.size > 5000) orgOfDeployment.clear();
    orgOfDeployment.set(deploymentId, hit);
  }
  if (!hit.org) return res;
  const { entitlementFor } = await import("../billing/subscriptions");
  if ((await entitlementFor(hit.org)).state !== "free") return res;
  const body = await res.text();
  const badge = `<a href="${(process.env.APP_URL ?? "").replace(/\/$/, "")}/?ref=site-badge" target="_blank" rel="noopener" style="position:fixed;right:14px;bottom:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:#111;color:#fff;font:500 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.25)">Made with Cloudesk</a>`;
  const out = body.includes("</body>") ? body.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${badge}</body>`) : body + badge;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(out, { status: res.status, headers });
}

async function serve(req: Request, deploymentId: string, pathParts: string[] | undefined, basePath: string, opts: ServeOpts) {
  if (!/^[0-9a-f-]{36}$/i.test(deploymentId)) return notFoundPage();
  const [row] = await db
    .select({ dep: schema.deployments, orgId: schema.projects.orgId, prodId: schema.projects.productionDeploymentId, archived: schema.projects.archivedAt, offline: schema.organizations.sitesOffline })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(and(eq(schema.deployments.id, deploymentId), eq(schema.deployments.status, "ready")));
  if (!row || row.archived) return notFoundPage();
  // Taken offline by the platform (with a suspension): nothing from this site is served.
  if (row.offline) return new Response("<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Unavailable</title><body style=\"font:16px system-ui;display:grid;place-items:center;min-height:90vh;color:#444\"><p>This site is currently unavailable.</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3600" } });
  const isProd = row.prodId === row.dep.id;
  if (opts.requireProduction && !isProd) return notFoundPage();
  // A valid client review link stands in for organization membership on previews.
  if (!isProd && row.dep.environment !== "production" && !opts.reviewAccess) {
    const session = await resolveSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
    if (!session || !(await getMembership(session.user.id, row.orgId))) return notFoundPage();
  }
  const artifact = (row.dep.artifact ?? {}) as Record<string, string>;
  const path = "/" + (pathParts ?? []).filter(Boolean).join("/");
  const ua = req.headers.get("user-agent");

  // Promotion view/click counts from the published site (an image ping, so no other connections are needed).
  if (path === "/__promo") {
    const q = new URL(req.url).searchParams;
    const id = q.get("id") ?? "";
    const e = q.get("e");
    if (isProd && !isBot(ua) && /^[0-9a-f-]{36}$/i.test(id) && (e === "view" || e === "click")) {
      try {
        await rateLimit(`promo:${clientIp(req)}`, 120, 60_000);
        await recordPromoStat(row.dep.projectId, id, e);
      } catch {
        /* over the limit: drop silently */
      }
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  // A reminder link: restore the shopper's cart in this browser, then show it.
  if (path === "/cart/recover") {
    const restored = isProd ? await restoreCart(row.dep.projectId, new URL(req.url).searchParams.get("t") ?? "") : null;
    const to = `${basePath}/cart${restored ? `?m=recovered${restored.code ? `&code=${restored.code}` : ""}` : "?err=" + encodeURIComponent("That link has expired — your cart may have moved on. Have a look around!")}`;
    return redirect(to, restored ? cartCookie(cartCookieName(row.dep.projectId), restored.cookieToken) : undefined);
  }

  if (SEO_PATHS.has(path)) {
    // On a custom domain the site lives at the root, so absolute links use that origin.
    const file = await seoFile(path, { projectId: row.dep.projectId, basePath: basePath || opts.publicOrigin || "", artifact, isProd, deployedAt: row.dep.finishedAt ?? row.dep.createdAt });
    if (file) return file;
  }

  // The chatbot page.
  if (path === "/chat" && !artifact[path] && artifact["/__doc"]) {
    const parsed = siteDocSchema.safeParse(JSON.parse(artifact["/__doc"]));
    const page = parsed.success ? await renderChatPage(req, row.dep.projectId, parsed.data, basePath, { kind: "publish", basePath, formAction: () => "#" }) : null;
    if (page) return htmlNoStore(substituteBase(page, basePath));
  }

  // Dynamic store pages (shop, product, cart, checkout, orders, policies).
  if (!artifact[path] && isCommercePath(path) && artifact["/__doc"]) {
    const parsed = siteDocSchema.safeParse(JSON.parse(artifact["/__doc"]));
    if (parsed.success) {
      const store = await renderStorePage(req, row.dep.projectId, parsed.data, path, basePath, { kind: "publish", basePath, formAction: () => "#" }, { trackForm: opts.trackForm });
      if (store) {
        if (isProd && store.status === 200 && !isBot(ua) && req.method === "GET") void recordStat(row.dep.projectId, path, "view");
        const html = await fillStaticPage(substituteBase(store.html, basePath), row.dep.projectId, basePath, req.headers.get("cookie"));
        return htmlNoStore(await withPromotions(await withChatLauncher(html, row.dep.projectId, basePath, path), row.dep.projectId, basePath, path, row.dep.id, { track: isProd }), store.status);
      }
    }
  }

  // Members-only pages: production visitors need a valid member session and an active membership — on the live
  // deployment and on earlier production ones too (their ids are in published pages, and they're served without sign-in).
  if (artifact[path] && artifact["/__doc"] && (isProd || row.dep.environment === "production")) {
    const doc = siteDocSchema.safeParse(JSON.parse(artifact["/__doc"]));
    if (doc.success && doc.data.pages.some((p) => p.path === path && p.membersOnly)) {
      const projectId = row.dep.projectId;
      const email = verifyMemberSession(projectId, readCookie(req.headers.get("cookie"), memberCookieName(projectId)));
      if (!email || !(await activeMembership(projectId, email))) {
        const gate = await renderMemberGate(req, projectId, doc.data, path, basePath, { kind: "publish", basePath, formAction: () => "#" });
        return htmlNoStore(await fillStaticPage(substituteBase(gate, basePath), projectId, basePath, req.headers.get("cookie")));
      }
      const out = substituteBase(artifact[path], basePath);
      return htmlNoStore(out.includes("<!--cc:") ? await fillStaticPage(out, projectId, basePath, req.headers.get("cookie")) : out);
    }
  }

  let page = artifact[path];
  // Only real visits to the live production site are counted.
  const countable = isProd && page && !isBot(ua) && req.method === "GET";
  if (page && artifact[`${path}#B`]) {
    const exp = artifact[`${path}#exp`] || path;
    const bucket = abBucket(clientIp(req), ua, exp);
    if (bucket === "B") page = artifact[`${path}#B`];
    if (countable) void recordStat(row.dep.projectId, path, "view", exp, bucket);
  } else if (countable) {
    void recordStat(row.dep.projectId, path, "view");
  }
  const status = page ? 200 : 404;
  page ??= artifact["/__404"];
  if (!page) return notFoundPage();
  let out = substituteBase(page, basePath);
  if (new URL(req.url).searchParams.get("submitted") === "1") {
    out = out.replace("<body>", `<body><div class="notice" role="status">Thank you — your message was sent.</div>`);
  }
  out = await withChatLauncher(out, row.dep.projectId, basePath, path);
  if (status === 200) out = await withPromotions(out, row.dep.projectId, basePath, path, row.dep.id, { track: !!countable });
  if (out.includes("<!--cc:")) return htmlNoStore(await fillStaticPage(out, row.dep.projectId, basePath, req.headers.get("cookie")), status);
  return html(out, status);
}
