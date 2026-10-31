import { requireTask } from "@/server/ai/access";
import { retryTask } from "@/server/ai/tasks";
import { route } from "@/server/http/handler";

export const POST = route<{ taskId: string }>(async (ctx, { taskId }) => {
  await requireTask(ctx, taskId, "ai:use");
  const next = await retryTask(taskId, ctx.user.id);
  return Response.json({ task: { id: next.id, status: next.status } }, { status: 202 });
});
