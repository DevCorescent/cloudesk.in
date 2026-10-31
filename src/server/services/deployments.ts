import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { brandIssues } from "@/lib/site/brand-rules";
import { diagnose, isStoreRoute, usesStore } from "@/lib/site/diagnostics";
import { getBrandRules } from "./brand";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { hasExperiment, renderPage, experimentKey } from "@/lib/site/render";
import { ApiError, notFound } from "../http/errors";
import { audit } from "./audit";
import { readAllFiles } from "./files";

export const BASE_TOKEN = "__CC_BASE__";

export type DeployEnvironment = "preview" | "production";
type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string };

// Hosting adapters: the platform static host, plus the external hosts a
// web app's live version can be published to (see server/export).
export const DEPLOY_ADAPTERS = [
  {
    id: "platform-static",
    name: "Platform static hosting",
    implemented: true,
    supports: ["static"],
    description: "Pre-renders every page to HTML and serves it from this platform. Forms post to the platform.",
  },
  { id: "github", name: "GitHub", implemented: true, supports: ["static"], description: "Commits the live version's files to a repository (GitHub Pages or any host that builds from GitHub)." },
  { id: "netlify", name: "Netlify", implemented: true, supports: ["static"], description: "Uploads the live version to a Netlify site and waits until it's live." },
  { id: "vercel", name: "Vercel", implemented: true, supports: ["static"], description: "Deploys the live version to a Vercel project as production." },
  { id: "cloudflare", name: "Cloudflare Pages", implemented: true, supports: ["static"], description: "Direct Upload to a Cloudflare Pages project, then waits for the deployment." },
] as const;

/** A version branch to deploy instead of the main document (previews only). */
export type BranchSource = { name: string; content: string; revision: number };

export async function createDeployment(project: { id: string; orgId: string }, environment: DeployEnvironment, userId: string, branch?: BranchSource) {
  if (branch && environment !== "preview") throw new ApiError("conflict", "Branches deploy as previews. Merge the branch to publish it.");
  const [dep] = await db
    .insert(schema.deployments)
    .values({ projectId: project.id, environment, adapter: "platform-static", status: "queued", createdBy: userId, branchName: branch?.name ?? null })
    .returning();
  const lines: LogLine[] = [];
  const logLine = (level: LogLine["level"], msg: string) => lines.push({ ts: new Date().toISOString(), level, msg });
  const setStatus = (status: "building" | "verifying") => db.update(schema.deployments).set({ status, log: lines }).where(eq(schema.deployments.id, dep.id));

  try {
    await setStatus("building");
    logLine("info", `Deploying to ${environment} with the platform static host`);
    const siteFile = branch ? { content: branch.content, revision: branch.revision } : (await readAllFiles(project.id)).find((f) => f.path === SITE_DOC_PATH);
    if (!siteFile) throw new Error(`${SITE_DOC_PATH} is missing`);
    logLine("info", branch ? `Source: branch "${branch.name}" revision ${branch.revision}` : `Source: ${SITE_DOC_PATH} revision ${siteFile.revision}`);

    const parsed = parseSiteDoc(siteFile.content);
    if (!parsed.ok) {
      parsed.errors.slice(0, 20).forEach((e) => logLine("error", e));
      throw new Error("The site document failed validation");
    }
    const doc = parsed.doc;

    const findings = diagnose(doc);
    for (const f of findings) logLine(f.severity === "error" ? "error" : f.severity === "warning" ? "warn" : "info", `[${f.category}] ${f.message}`);
    for (const b of brandIssues(doc, await getBrandRules(project.id)).slice(0, 25)) logLine("warn", `[brand] ${b.message}${b.field ? ` (${b.pageTitle} · ${b.field})` : ""}`);
    const errors = findings.filter((f) => f.severity === "error");
    if (errors.length && environment === "production") {
      throw new Error(`${errors.length} blocking problem(s) must be fixed before a production deploy`);
    }

    const artifact: Record<string, string> = {};
    for (const page of doc.pages) {
      const formAction = (formId: string) => `/api/v1/sites/${dep.id}/forms/${formId}?page=${encodeURIComponent(page.path)}`;
      if (hasExperiment(page)) {
        artifact[page.path] = renderPage(doc, page, { kind: "publish", basePath: BASE_TOKEN, formAction, ab: "A" });
        artifact[`${page.path}#B`] = renderPage(doc, page, { kind: "publish", basePath: BASE_TOKEN, formAction, ab: "B" });
        artifact[`${page.path}#exp`] = experimentKey(page);
        logLine("info", `Rendered ${page.path} as A/B test variants`);
      } else {
        artifact[page.path] = renderPage(doc, page, { kind: "publish", basePath: BASE_TOKEN, formAction });
        logLine("info", `Rendered ${page.path} (${Math.round(artifact[page.path].length / 1024)} KB)`);
      }
    }
    // The design document travels with the deployment so dynamic store pages
    // render in exactly the published design.
    artifact["/__doc"] = JSON.stringify(doc);
    artifact["/__404"] = renderPage(
      doc,
      { id: "404", path: "/", title: "Page not found", description: "", kind: "page", sections: [
        { id: "nf", type: "cta", props: { heading: "Page not found", body: "The page you are looking for does not exist.", buttonLabel: "Go to the home page", buttonHref: "/" }, style: { background: "default", align: "center", paddingY: "lg", hideOn: [], decor: "none", textScale: "md" } },
      ] },
      { kind: "publish", basePath: BASE_TOKEN, formAction: () => "#" },
    );

    await setStatus("verifying");
    // Verify: every page rendered, has a title, and every internal link resolves.
    // Store routes are rendered per request, so they count when the site shows a store.
    const store = usesStore(doc);
    for (const [path, html] of Object.entries(artifact)) {
      if (path === "/__doc" || path.endsWith("#exp")) continue;
      if (!html.includes("<title>") || html.length < 200) throw new Error(`Rendered output for ${path} is incomplete`);
      for (const m of html.matchAll(new RegExp(`href="${BASE_TOKEN}(/[^"#?]*)`, "g"))) {
        const target = m[1].replace(/\/$/, "") || "/";
        if (artifact[target] || (store && isStoreRoute(target))) continue;
        if (environment === "production") throw new Error(`Broken internal link to ${target} on ${path}`);
        logLine("warn", `Broken internal link to ${target} on ${path} (allowed in preview)`);
      }
    }
    logLine("info", `Verified ${doc.pages.length} page(s)`);

    const [ready] = await db
      .update(schema.deployments)
      .set({ status: "ready", artifact, sourceRevisions: { [branch ? `branch:${branch.name}` : SITE_DOC_PATH]: siteFile.revision }, log: lines, finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id))
      .returning();
    if (environment === "production") {
      await db.update(schema.projects).set({ productionDeploymentId: dep.id }).where(eq(schema.projects.id, project.id));
      // Keep the chatbot's knowledge in step with what is live.
      void import("../knowledge/kb").then((k) => k.scheduleReindex(project.id)).catch(() => {});
      logLine("info", "Promoted to production");
      await db.update(schema.deployments).set({ log: lines }).where(eq(schema.deployments.id, dep.id));
    }
    await audit({ orgId: project.orgId, actorId: userId, action: "deployment.ready", targetType: "deployment", targetId: dep.id, metadata: { environment } });
    return ready;
  } catch (err) {
    logLine("error", (err as Error).message);
    const [failed] = await db
      .update(schema.deployments)
      .set({ status: "failed", error: (err as Error).message, log: lines, finishedAt: new Date() })
      .where(eq(schema.deployments.id, dep.id))
      .returning();
    await audit({ orgId: project.orgId, actorId: userId, action: "deployment.failed", targetType: "deployment", targetId: dep.id, metadata: { environment } });
    return failed;
  }
}

export async function listDeployments(projectId: string, limit = 30) {
  return db
    .select({
      id: schema.deployments.id,
      environment: schema.deployments.environment,
      branchName: schema.deployments.branchName,
      adapter: schema.deployments.adapter,
      status: schema.deployments.status,
      error: schema.deployments.error,
      sourceRevisions: schema.deployments.sourceRevisions,
      createdAt: schema.deployments.createdAt,
      finishedAt: schema.deployments.finishedAt,
      createdByName: schema.users.name,
    })
    .from(schema.deployments)
    .leftJoin(schema.users, eq(schema.users.id, schema.deployments.createdBy))
    .where(eq(schema.deployments.projectId, projectId))
    .orderBy(desc(schema.deployments.createdAt))
    .limit(limit);
}

export async function getDeploymentLog(projectId: string, deploymentId: string) {
  const [d] = await db
    .select({ log: schema.deployments.log, status: schema.deployments.status, error: schema.deployments.error })
    .from(schema.deployments)
    .where(and(eq(schema.deployments.id, deploymentId), eq(schema.deployments.projectId, projectId)));
  if (!d) throw notFound("Deployment");
  return d;
}

/** Rollback / promote: point production at an earlier ready deployment. */
export async function promoteDeployment(project: { id: string; orgId: string }, deploymentId: string, userId: string) {
  const [d] = await db
    .select()
    .from(schema.deployments)
    .where(and(eq(schema.deployments.id, deploymentId), eq(schema.deployments.projectId, project.id)));
  if (!d) throw notFound("Deployment");
  if (d.status !== "ready") throw new ApiError("conflict", "Only successful deployments can be promoted");
  if (d.branchName) throw new ApiError("conflict", `This is a preview of the branch "${d.branchName}". Merge the branch, then publish.`);
  await db.update(schema.projects).set({ productionDeploymentId: d.id }).where(eq(schema.projects.id, project.id));
  await audit({ orgId: project.orgId, actorId: userId, action: "deployment.promoted", targetType: "deployment", targetId: d.id });
}

export function substituteBase(html: string, basePath: string) {
  return html.replaceAll(`${BASE_TOKEN}/`, `${basePath.replace(/\/$/, "")}/`).replaceAll(BASE_TOKEN, basePath);
}
