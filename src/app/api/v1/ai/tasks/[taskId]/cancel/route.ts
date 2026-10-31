import { requireTask } from "@/server/ai/access";
import { cancelTask } from "@/server/ai/tasks";
import { route } from "@/server/http/handler";

export const POST = route<{ taskId: string }>(async (ctx, { taskId }) => {
  await requireTask(ctx, taskId, "ai:use");
  await cancelTask(taskId, ctx.user.id);
  return { ok: true };
});
