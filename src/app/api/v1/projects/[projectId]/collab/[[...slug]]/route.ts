import { z } from "zod";
import { can } from "@/server/authz/permissions";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { addComment, createReviewLink, deleteComment, heartbeat, leave, listComments, listReviewLinks, resolveComment, revokeReviewLink } from "@/server/services/collab";

type P = { projectId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, action] = slug;
  const key = `${ctx.req.method} ${section ?? ""}`;
  switch (key) {
    case "POST presence": {
      await requireProject(ctx, projectId, "project:read");
      const body = await readJson(ctx.req, z.object({ pageId: z.string().max(64).default(""), sectionId: z.string().max(64).default("") }));
      return { others: await heartbeat(projectId, ctx.user.id, body.pageId, body.sectionId) };
    }
    case "DELETE presence": {
      await requireProject(ctx, projectId, "project:read");
      await leave(projectId, ctx.user.id);
      return { ok: true };
    }
    case "GET comments": {
      await requireProject(ctx, projectId, "project:read");
      return { comments: await listComments(projectId) };
    }
    case "POST comments": {
      // Anyone on the project may comment, including viewers.
      const { project, role } = await requireProject(ctx, projectId, "project:read");
      if (id && action === "resolve") {
        if (!can(role, "design:write")) throw notFound("Route");
        const body = await readJson(ctx.req, z.object({ resolved: z.boolean() }));
        await resolveComment(projectId, id, ctx.user.id, body.resolved);
        return { ok: true };
      }
      await rateLimit(`comment:${ctx.user.id}`, 120, 3600_000);
      const body = await readJson(ctx.req, z.object({ pageId: z.string().max(64), sectionId: z.string().max(64).default(""), body: z.string().max(4000), parentId: z.uuid().nullable().optional() }));
      return Response.json({ comment: await addComment(project, { ...body, authorId: ctx.user.id }) }, { status: 201 });
    }
    case "DELETE comments": {
      const { role } = await requireProject(ctx, projectId, "project:read");
      if (!id) throw notFound("Comment");
      await deleteComment(projectId, id, ctx.user.id, can(role, "design:write"));
      return { ok: true };
    }
    case "GET review-links": {
      await requireProject(ctx, projectId, "project:read");
      return { links: await listReviewLinks(projectId) };
    }
    case "POST review-links": {
      // Sharing a preview outside the organization is a deploy-level decision.
      const { project } = await requireProject(ctx, projectId, "deploy:preview");
      if (id && action === "revoke") {
        await revokeReviewLink(projectId, id);
        return { ok: true };
      }
      await rateLimit(`review-link:${ctx.user.id}`, 30, 3600_000);
      const body = await readJson(ctx.req, z.object({ label: z.string().trim().max(80).default(""), days: z.number().int().min(1).max(60).default(14), deploymentId: z.uuid().optional() }));
      return Response.json(await createReviewLink(project, ctx.user.id, body), { status: 201 });
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
