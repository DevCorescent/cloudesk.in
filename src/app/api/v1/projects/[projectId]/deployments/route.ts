import { z } from "zod";
import { readJson, requireProject, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { createDeployment, DEPLOY_ADAPTERS, listDeployments } from "@/server/services/deployments";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "project:read");
  return { deployments: await listDeployments(projectId), productionDeploymentId: project.productionDeploymentId, adapters: DEPLOY_ADAPTERS };
});

export const POST = route<P>(async (ctx, { projectId }) => {
  const { environment } = await readJson(ctx.req, z.object({ environment: z.enum(["preview", "production"]) }));
  const { project } = await requireProject(ctx, projectId, environment === "production" ? "deploy:production" : "deploy:preview");
  await rateLimit(`deploy:${projectId}`, 30, 3600_000);
  const d = await createDeployment(project, environment, ctx.user.id);
  return Response.json({ deployment: { id: d.id, status: d.status, error: d.error, environment: d.environment } }, { status: 201 });
});
