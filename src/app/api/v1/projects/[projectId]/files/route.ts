import { z } from "zod";
import { readJson, requireProject, route } from "@/server/http/handler";
import { createFile, listFiles, normalizePath, permissionForPath } from "@/server/services/files";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  return { files: await listFiles(projectId) };
});

export const POST = route<P>(async (ctx, { projectId }) => {
  const input = await readJson(ctx.req, z.object({ path: z.string().max(200), content: z.string().default("") }));
  await requireProject(ctx, projectId, permissionForPath(normalizePath(input.path)));
  const f = await createFile(projectId, input.path, input.content, { userId: ctx.user.id, source: "user", message: "Created" });
  return Response.json({ file: { path: f.path, revision: f.revision } }, { status: 201 });
});
