import { requireTask } from "@/server/ai/access";
import { rejectTask } from "@/server/ai/tasks";
import { route } from "@/server/http/handler";

export const POST = route<{ taskId: string }>(async (ctx, { taskId }) => {
  await requireTask(ctx, taskId, "ai:use");
  await rejectTask(taskId, ctx.user.id);
  return { ok: true };
});
