import { z } from "zod";
import { codeEditInput, createTask, listProjectTasks, siteEditInput, translateInput } from "@/server/ai/tasks";
import { readJson, requireProject, route } from "@/server/http/handler";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  return { tasks: await listProjectTasks(projectId) };
});

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site_edit"), input: siteEditInput }),
  z.object({ kind: z.literal("code_edit"), input: codeEditInput }),
  z.object({ kind: z.literal("translate"), input: translateInput }),
]);

export const POST = route<P>(async (ctx, { projectId }) => {
  const { kind, input } = await readJson(ctx.req, body);
  const { project } = await requireProject(ctx, projectId, kind === "code_edit" ? "code:write" : "ai:use");
  const task = await createTask({ orgId: project.orgId, projectId, userId: ctx.user.id, kind, payload: input });
  return Response.json({ task: { id: task.id, status: task.status } }, { status: 202 });
});
