import { requireProject, route } from "@/server/http/handler";
import { projectStats } from "@/server/services/stats";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const days = Math.min(Math.max(Number(new URL(ctx.req.url).searchParams.get("days")) || 30, 7), 90);
  return projectStats(projectId, days);
});
