import { requireProject, route } from "@/server/http/handler";
import { deleteAsset } from "@/server/media/assets";

export const DELETE = route<{ projectId: string; assetId: string }>(async (ctx, { projectId, assetId }) => {
  const { project } = await requireProject(ctx, projectId, "design:write");
  await deleteAsset(project, ctx.user.id, assetId);
  return { ok: true };
});
