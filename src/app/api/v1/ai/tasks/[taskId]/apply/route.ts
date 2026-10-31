import { requireTask } from "@/server/ai/access";
import { applyTask } from "@/server/ai/tasks";
import { can } from "@/server/authz/permissions";
import { route } from "@/server/http/handler";
import { permissionForPath } from "@/server/services/files";

export const POST = route<{ taskId: string }>(async (ctx, { taskId }) => {
  const { role } = await requireTask(ctx, taskId, "ai:use");
  await applyTask(taskId, ctx.user.id, (path) => can(role, permissionForPath(path)));
  return { ok: true };
});
