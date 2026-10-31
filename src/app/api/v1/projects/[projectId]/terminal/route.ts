import { z } from "zod";
import { can } from "@/server/authz/permissions";
import { ApiError } from "@/server/http/errors";
import { readJson, requireProject, route } from "@/server/http/handler";
import { dockerAvailable } from "@/server/exec/docker";
import { SANDBOX_LIMITS } from "@/server/exec/sandbox";
import { execute, MAX_COMMAND, recentRuns } from "@/server/exec/shell";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string };

// One command at a time per project: sandbox runs are CPU-bound.
const busy = new Set<string>();

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  return { runs: await recentRuns(projectId, ctx.user.id), docker: await dockerAvailable(), limits: SANDBOX_LIMITS };
});

export const POST = route<P>(async (ctx, { projectId }) => {
  const { project, role } = await requireProject(ctx, projectId, "project:read");
  const { command } = await readJson(ctx.req, z.object({ command: z.string().max(MAX_COMMAND) }));
  await rateLimit(`exec:${ctx.user.id}`, 60, 60_000);
  if (busy.has(projectId)) throw new ApiError("conflict", "Another command is still running in this project");
  busy.add(projectId);
  try {
    return await execute({ projectId, projectName: project.name, userId: ctx.user.id, can: (p) => can(role, p) }, command);
  } finally {
    busy.delete(projectId);
  }
});
