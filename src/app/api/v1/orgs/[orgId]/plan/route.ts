import { createTask, planInput } from "@/server/ai/tasks";
import { readJson, requireOrg, route } from "@/server/http/handler";

// Starts a planning task. The result is a spec the user reviews before any
// project is created.
export const POST = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "project:create");
  const input = await readJson(ctx.req, planInput);
  const task = await createTask({ orgId, projectId: null, userId: ctx.user.id, kind: "plan", payload: input });
  return Response.json({ task: { id: task.id, status: task.status } }, { status: 202 });
});
