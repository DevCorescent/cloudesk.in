import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { createBranch, deleteBranch, deployBranchPreview, getBranch, listBranches, mergeBranch, previewMerge, saveBranchDoc } from "@/server/services/branches";

type P = { projectId: string; slug?: string[] };

const into = z.enum(["main", "branch"]).default("main");

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [id, section] = slug;
  if (id && !z.uuid().safeParse(id).success) throw notFound("Branch");
  const key = `${ctx.req.method} ${id ? `:id${section ? ` ${section}` : ""}` : ""}`.trim();
  switch (key) {
    case "GET": {
      await requireProject(ctx, projectId, "project:read");
      return listBranches(projectId);
    }
    case "POST": {
      const { project } = await requireProject(ctx, projectId, "design:write");
      await rateLimit(`branch:${ctx.user.id}`, 60, 3600_000);
      const body = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default("") }));
      const b = await createBranch(project, ctx.user.id, body);
      return Response.json({ branch: { id: b.id, name: b.name, revision: b.revision } }, { status: 201 });
    }
    case "GET :id doc": {
      // Same shape as the file API, so the builder edits a branch exactly like main.
      await requireProject(ctx, projectId, "project:read");
      const b = await getBranch(projectId, id);
      if (new URL(ctx.req.url).searchParams.get("meta") === "1") {
        const [u] = b.updatedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, b.updatedBy)) : [];
        return { revision: b.revision, updatedAt: b.updatedAt, updatedByName: u?.name ?? null };
      }
      return { content: b.content, revision: b.revision, name: b.name, mergedAt: b.mergedAt };
    }
    case "PUT :id doc": {
      await requireProject(ctx, projectId, "design:write");
      const body = await readJson(ctx.req, z.object({ content: z.string(), baseRevision: z.number().int() }));
      const b = await saveBranchDoc(projectId, id, body.content, body.baseRevision, ctx.user.id);
      return { revision: b.revision };
    }
    case "GET :id merge": {
      await requireProject(ctx, projectId, "design:write");
      return previewMerge(projectId, id, into.parse(new URL(ctx.req.url).searchParams.get("into") ?? undefined));
    }
    case "POST :id merge": {
      const { project } = await requireProject(ctx, projectId, "design:write");
      const body = await readJson(
        ctx.req,
        z.object({ into, mainRevision: z.number().int(), branchRevision: z.number().int(), resolutions: z.record(z.string().max(200), z.enum(["main", "branch"])).default({}) }),
      );
      const r = await mergeBranch(project, id, ctx.user.id, body);
      return { revision: r.branch.revision, mainRevision: r.mainRevision };
    }
    case "POST :id deploy": {
      const { project } = await requireProject(ctx, projectId, "deploy:preview");
      await rateLimit(`deploy:${projectId}`, 30, 3600_000);
      const d = await deployBranchPreview(project, id, ctx.user.id);
      return Response.json({ deployment: { id: d.id, status: d.status, error: d.error, environment: d.environment } }, { status: 201 });
    }
    case "DELETE :id": {
      const { project } = await requireProject(ctx, projectId, "design:write");
      await deleteBranch(project, id, ctx.user.id);
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
