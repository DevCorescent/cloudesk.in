import { listProjectTasks } from "@/server/ai/tasks";
import { requireProject, route } from "@/server/http/handler";
import { projectActivity } from "@/server/services/projects";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const [revisions, tasks] = await Promise.all([projectActivity(projectId), listProjectTasks(projectId, 10)]);
  return { revisions, tasks };
});
