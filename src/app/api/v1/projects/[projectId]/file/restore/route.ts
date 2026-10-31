import { z } from "zod";
import { readJson, requireProject, route } from "@/server/http/handler";
import { normalizePath, permissionForPath, restoreRevision } from "@/server/services/files";

export const POST = route<{ projectId: string }>(async (ctx, { projectId }) => {
  const input = await readJson(ctx.req, z.object({ path: z.string().max(200), revision: z.number().int().min(1), baseRevision: z.number().int().min(1) }));
  await requireProject(ctx, projectId, permissionForPath(normalizePath(input.path)));
  const f = await restoreRevision(projectId, input.path, input.revision, input.baseRevision, ctx.user.id);
  return { path: f.path, revision: f.revision };
});
