import { z } from "zod";
import { permissionsFor } from "@/server/authz/permissions";
import { readJson, requireProject, route } from "@/server/http/handler";
import { archiveProject, updateProject } from "@/server/services/projects";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  const { project, role } = await requireProject(ctx, projectId, "project:read");
  return { project, role, permissions: permissionsFor(role) };
});

export const PATCH = route<P>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "project:update");
  const patch = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(500).optional() }));
  return { project: await updateProject(projectId, project.orgId, ctx.user.id, patch) };
});

export const DELETE = route<P>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "project:delete");
  await archiveProject(projectId, project.orgId, ctx.user.id);
  return { ok: true };
});
