import { requireProject, route } from "@/server/http/handler";
import { getDeploymentLog } from "@/server/services/deployments";

export const GET = route<{ projectId: string; deploymentId: string }>(async (ctx, { projectId, deploymentId }) => {
  await requireProject(ctx, projectId, "project:read");
  return getDeploymentLog(projectId, deploymentId);
});
