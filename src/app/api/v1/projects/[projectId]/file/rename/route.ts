import { z } from "zod";
import { readJson, requireProject, route } from "@/server/http/handler";
import { renameFile } from "@/server/services/files";

export const POST = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "code:write");
  const input = await readJson(ctx.req, z.object({ from: z.string().max(200), to: z.string().max(200), baseRevision: z.number().int().min(1) }));
  const f = await renameFile(projectId, input.from, input.to, input.baseRevision, { userId: ctx.user.id, source: "user" });
  return { path: f.path, revision: f.revision };
});
