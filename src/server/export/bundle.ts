// A web app's published version as plain files, for hosting anywhere: one
// index.html per page (folders for clean URLs), 404.html, sitemap.xml,
// robots.txt and a _headers file with the same security policy. Live sections
// (data lists, products, open jobs, events) are filled with what they show
// right now. What needs a server keeps working by pointing back here: forms
// post to this platform, and shop, cart, checkout, account and booking pages
// link to the site hosted here.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { fillStaticPage } from "../commerce/storefront";
import { ApiError, notFound } from "../http/errors";
import { appUrl } from "../services/mail";
import { substituteBase } from "../services/deployments";

export type BundleFile = { path: string; data: string };
export type Bundle = { files: BundleFile[]; deploymentId: string; liveBase: string; pages: number };

const DYNAMIC = /^\/(shop|product|cart|checkout|order|track|account|book|booking|policies|chat|collection)(\/|$|\?)/;

/** The bundle of a ready deployment (the production one unless another is named). */
export async function buildBundle(projectId: string, deploymentId?: string | null): Promise<Bundle> {
  const [p] = await db
    .select({ id: schema.projects.id, slug: schema.projects.slug, prod: schema.projects.productionDeploymentId, orgSlug: schema.organizations.slug })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(eq(schema.projects.id, projectId));
  if (!p) throw notFound("Web app");
  const depId = deploymentId ?? p.prod;
  if (!depId) throw new ApiError("conflict", "Publish this web app first — the export is made from its live version.");
  const [dep] = await db.select().from(schema.deployments).where(and(eq(schema.deployments.id, depId), eq(schema.deployments.projectId, projectId)));
  if (!dep || dep.status !== "ready") throw new ApiError("conflict", "That version isn't ready to export.");
  const artifact = (dep.artifact ?? {}) as Record<string, string>;
  const liveBase = appUrl(`/s/${p.orgSlug}/${p.slug}`).replace(/\/$/, "");
  const platform = appUrl("/").replace(/\/$/, "");
  const files: BundleFile[] = [];
  const paths = Object.keys(artifact).filter((k) => !k.includes("#") && (!k.startsWith("/__") || k === "/__404"));
  const docJson = artifact["/__doc"] ? (JSON.parse(artifact["/__doc"]) as { pages?: { path: string; membersOnly?: boolean; seo?: { noindex?: boolean } }[] }) : null;
  const membersOnly = new Set((docJson?.pages ?? []).filter((x) => x.membersOnly).map((x) => x.path));
  for (const path of paths) {
    const file = path === "/__404" ? "404.html" : path === "/" ? "index.html" : `${path.replace(/^\/+|\/+$/g, "")}/index.html`;
    // Members-only pages stay behind the member sign-in on the hosted site: a static host can't check it.
    if (membersOnly.has(path)) {
      const to = escapeAttr(`${liveBase}${path === "/" ? "" : path}`);
      files.push({ path: file, data: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${to}"><title>Members only</title></head><body><p>This page is for members. <a href="${to}">Sign in to see it</a>.</p></body></html>\n` });
      continue;
    }
    let html = substituteBase(artifact[path]!, "");
    html = await fillStaticPage(html, projectId, "", null);
    html = portable(html, platform, liveBase);
    files.push({ path: file, data: html });
  }
  const unlisted = new Set((docJson?.pages ?? []).filter((x) => x.membersOnly || x.seo?.noindex).map((x) => x.path));
  const pages = paths.filter((x) => x !== "/__404" && !unlisted.has(x));
  files.push({ path: "robots.txt", data: "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n" });
  files.push({ path: "sitemap.xml", data: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((x) => `<url><loc>${x}</loc></url>`).join("")}</urlset>\n` });
  // Hosts that read _headers (Netlify, Cloudflare Pages) get the same strict policy the platform sends; forms may post back here.
  files.push({ path: "_headers", data: `/*\n  Content-Security-Policy: default-src 'none'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net data:; frame-src https:; form-action 'self' ${platform}; base-uri 'none'; frame-ancestors 'self'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n` });
  files.push({ path: "README.md", data: `# Exported site\n\nMade from version ${dep.id} on ${new Date().toISOString().slice(0, 10)}.\n\n- Each page is a folder with an index.html (clean URLs on any static host).\n- Forms post to ${platform} and keep arriving in your workspace — from hosts you connected.\n- The shop, cart, checkout, account and booking pages stay on ${liveBase}; links point there.\n- Live sections (data lists, products, open jobs, events) show what they had when exported. Export again to refresh them, or host on the platform to keep them live.\n` });
  return { files, deploymentId: dep.id, liveBase, pages: pages.length };
}

/** Makes a page work off-platform: platform URLs absolute, server-only pages linked to the hosted site. */
export function portable(html: string, platform: string, liveBase: string): string {
  return html
    .replace(/(\s(?:href|src|action|srcset|poster)=")\/(api\/[^"]*)"/g, (_m, a, rest) => `${a}${platform}/${rest}"`)
    .replace(/(\shref=")(\/[^"]*)"/g, (m, a, path) => (DYNAMIC.test(path) ? `${a}${liveBase}${path}"` : m))
    .replace(/url\(\/api\//g, `url(${platform}/api/`);
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
