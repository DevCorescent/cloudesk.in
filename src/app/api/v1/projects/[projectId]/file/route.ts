import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError } from "@/server/http/errors";
import { readJson, requireProject, route } from "@/server/http/handler";
import { deleteFile, normalizePath, permissionForPath, readFile, writeFile } from "@/server/services/files";

type P = { projectId: string };

function pathParam(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) throw new ApiError("bad_request", "path is required");
  return normalizePath(p);
}

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const f = await readFile(projectId, pathParam(ctx.req));
  // ?meta=1: a cheap check for newer revisions (live sync), without the content.
  if (new URL(ctx.req.url).searchParams.get("meta") === "1") {
    const [u] = f.updatedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, f.updatedBy)) : [];
    return { path: f.path, revision: f.revision, updatedAt: f.updatedAt, updatedBy: f.updatedBy, updatedByName: u?.name ?? null };
  }
  return { path: f.path, content: f.content, revision: f.revision, updatedAt: f.updatedAt };
});

export const PUT = route<P>(async (ctx, { projectId }) => {
  const path = pathParam(ctx.req);
  await requireProject(ctx, projectId, permissionForPath(path));
  const input = await readJson(ctx.req, z.object({ content: z.string(), baseRevision: z.number().int().min(1), message: z.string().max(200).optional() }));
  const f = await writeFile(projectId, path, input.content, input.baseRevision, { userId: ctx.user.id, source: "user", message: input.message });
  return { path: f.path, revision: f.revision, updatedAt: f.updatedAt };
});

export const DELETE = route<P>(async (ctx, { projectId }) => {
  const path = pathParam(ctx.req);
  await requireProject(ctx, projectId, permissionForPath(path));
  const input = await readJson(ctx.req, z.object({ baseRevision: z.number().int().min(1) }));
  await deleteFile(projectId, path, input.baseRevision, { userId: ctx.user.id, source: "user" });
  return { ok: true };
});
