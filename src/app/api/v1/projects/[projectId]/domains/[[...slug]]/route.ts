import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { addDomain, checkDomain, dnsTarget, listDomains, removeDomain, TXT_PREFIX } from "@/server/services/domains";

type P = { projectId: string; slug?: string[] };

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  return { domains: await listDomains(projectId), target: dnsTarget(), txtPrefix: TXT_PREFIX };
});

export const POST = route<P>(async (ctx, { projectId, slug = [] }) => {
  // Domains decide where the public site is served, so they need production rights.
  const { project } = await requireProject(ctx, projectId, "deploy:production");
  const [id, action] = slug;
  if (id && action === "check") {
    await rateLimit(`domain-check:${ctx.user.id}`, 60, 600_000);
    return { domain: await checkDomain(projectId, id) };
  }
  if (id) throw notFound("Route");
  await rateLimit(`domain-add:${ctx.user.id}`, 20, 3600_000);
  const body = await readJson(ctx.req, z.object({ hostname: z.string().max(260) }));
  return Response.json({ domain: await addDomain(project, ctx.user.id, body.hostname) }, { status: 201 });
});

export const DELETE = route<P>(async (ctx, { projectId, slug = [] }) => {
  const { project } = await requireProject(ctx, projectId, "deploy:production");
  if (!slug[0]) throw notFound("Domain");
  await removeDomain(project, ctx.user.id, slug[0]);
  return { ok: true };
});
