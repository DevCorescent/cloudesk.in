import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { projectSpecSchema } from "@/lib/site/spec";
import { serializeSiteDoc } from "@/lib/site/model";
import { TEMPLATES, templateDoc, templateSpec } from "@/lib/site/templates";
import { createProjectFromSpec, listProjects } from "@/server/services/projects";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "project:read");
  const url = new URL(ctx.req.url);
  const q = url.searchParams.get("q")?.slice(0, 100) || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  return listProjects(orgId, { q, limit, offset });
});

const body = z.union([
  z.object({ templateId: z.string().max(40), name: z.string().trim().min(1).max(120).optional(), personality: z.string().max(40).optional() }),
  z.object({ spec: projectSpecSchema, planTaskId: z.uuid().optional() }),
]);

export const POST = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "project:create");
  const input = await readJson(ctx.req, body);
  if ("templateId" in input) {
    const t = TEMPLATES.find((x) => x.id === input.templateId);
    if (!t) throw new ApiError("validation_failed", "Unknown template", { templateId: ["Unknown template"] });
    // Crafted sites come finished; the rest are composed from their brief, with the template's own hero and photos.
    const doc = templateDoc(t, input.name, input.personality);
    const project = await createProjectFromSpec(orgId, ctx.user.id, templateSpec(t, input.name, input.personality), "template", serializeSiteDoc(doc));
    return Response.json({ project }, { status: 201 });
  }
  const project = await createProjectFromSpec(orgId, ctx.user.id, input.spec, input.planTaskId ? "ai" : "user");
  return Response.json({ project }, { status: 201 });
});
