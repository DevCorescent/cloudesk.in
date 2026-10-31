import { requireProject, route } from "@/server/http/handler";
import { promoteDeployment } from "@/server/services/deployments";

export const POST = route<{ projectId: string; deploymentId: string }>(async (ctx, { projectId, deploymentId }) => {
  const { project } = await requireProject(ctx, projectId, "deploy:production");
  await promoteDeployment(project, deploymentId, ctx.user.id);
  return { ok: true };
});
