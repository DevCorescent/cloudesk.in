import type { Permission } from "../authz/permissions";
import { notFound } from "../http/errors";
import { requireOrg, requireProject, type AuthedContext } from "../http/handler";
import { getTask } from "./tasks";

/** Loads a task and checks the caller's access through its project or org. */
export async function requireTask(ctx: AuthedContext, taskId: string, permission: Permission) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound("Task");
  const task = await getTask(taskId);
  const access = task.projectId ? await requireProject(ctx, task.projectId, permission) : await requireOrg(ctx, task.orgId, permission);
  // Planning tasks hold the private brief of the user who wrote it.
  if (!task.projectId && task.createdBy !== ctx.user.id) throw notFound("Task");
  return { task, role: access.role };
}
