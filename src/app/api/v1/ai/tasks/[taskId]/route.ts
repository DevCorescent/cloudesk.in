import { requireTask } from "@/server/ai/access";
import { route } from "@/server/http/handler";

export const GET = route<{ taskId: string }>(async (ctx, { taskId }) => {
  const { task } = await requireTask(ctx, taskId, "project:read");
  const rest: Partial<typeof task> = { ...task };
  delete rest.cancelRequested;
  return { task: rest };
});
