// Export and publish elsewhere: GET zip downloads the live version's files;
// targets (GitHub, Netlify, Vercel, Cloudflare Pages) are checked, listed, saved,
// removed and published to.
import { z } from "zod";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { buildBundle } from "@/server/export/bundle";
import { checkConnection, deleteTarget, publishTo, saveTarget, targets } from "@/server/export/targets";
import { zip } from "@/server/export/zip";
import { audit } from "@/server/services/audit";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const key = `${ctx.req.method} ${section ?? ""}${id ? " :id" : ""}${sub ? ` ${sub}` : ""}`;
  if (key === "GET zip") {
    const { project } = await requireProject(ctx, projectId, "project:read");
    await rateLimit(`export-zip:${ctx.user.id}`, 20, 10 * 60_000);
    const b = await buildBundle(projectId);
    await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "export.downloaded", targetType: "project", targetId: projectId, metadata: { deploymentId: b.deploymentId, files: b.files.length } });
    const name = `${project.slug || "site"}-${b.deploymentId.slice(0, 8)}.zip`;
    return new Response(new Uint8Array(zip(b.files.map((f) => ({ path: f.path, data: f.data })))), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  }
  const { project } = await requireProject(ctx, projectId, key === "GET targets" ? "project:read" : "deploy:production");
  switch (key) {
    case "GET targets":
      return { targets: await targets(projectId) };
    case "POST check": {
      await rateLimit(`export-check:${ctx.user.id}`, 30, 10 * 60_000);
      const body = await readJson(ctx.req, z.object({ id: z.string().optional() }).passthrough());
      return { check: await checkConnection(project, body.id ?? null, body) };
    }
    case "POST targets":
      return { target: await saveTarget(project, ctx.user.id, null, await readJson(ctx.req, z.unknown())) };
    case "PUT targets :id":
      return { target: await saveTarget(project, ctx.user.id, id!, await readJson(ctx.req, z.unknown())) };
    case "DELETE targets :id":
      await deleteTarget(project, ctx.user.id, id!);
      return { ok: true };
    case "POST targets :id publish":
      await rateLimit(`export-publish:${projectId}`, 30, 60 * 60_000);
      return publishTo(project, ctx.user.id, id!);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
