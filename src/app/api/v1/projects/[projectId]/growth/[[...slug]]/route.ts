import { z } from "zod";
import { can } from "@/server/authz/permissions";
import { hasLlm } from "@/server/ai/gateway";
import { writeHeadline } from "@/server/growth/ai";
import { applyAction, applyWinner, customTestSchema, dismiss, evaluateProject, getSettings, listExperiments, publishProduction, saveSettings, settingsSchema, startExperiment, startFromOpportunity, stopExperiment } from "@/server/growth/experiments";
import { findOpportunities } from "@/server/growth/opportunities";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string; slug?: string[] };

const startSchema = z.union([z.object({ opportunityKey: z.string().max(64), publish: z.boolean().optional() }), customTestSchema.extend({ publish: z.boolean().optional() })]);

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, action] = slug;
  const key = `${ctx.req.method} ${section ?? ""}`;

  switch (key) {
    case "GET ": {
      const { project, role } = await requireProject(ctx, projectId, "project:read");
      await evaluateProject(projectId);
      const aiAvailable = can(role, "ai:use") && (await hasLlm(project.orgId));
      const [settings, opportunities, experiments] = await Promise.all([getSettings(projectId), findOpportunities(projectId, { aiAvailable }), listExperiments(projectId)]);
      return { settings: { autoApplyWinners: settings.autoApplyWinners, autoPublish: settings.autoPublish, autoStart: settings.autoStart }, opportunities, experiments, aiAvailable, live: !!project.productionDeploymentId };
    }
    case "PUT settings": {
      const { role } = await requireProject(ctx, projectId, "design:write");
      const body = await readJson(ctx.req, settingsSchema);
      // Publishing on its own changes the live site, so it needs production deploy rights.
      if ((body.autoPublish || body.autoStart) && !can(role, "deploy:production")) throw new ApiError("forbidden", "Only people who can publish to production can turn on automatic publishing or starting");
      const s = await saveSettings(projectId, body);
      return { settings: { autoApplyWinners: s.autoApplyWinners, autoPublish: s.autoPublish, autoStart: s.autoStart } };
    }
    case "POST tests": {
      const { project, role } = await requireProject(ctx, projectId, "design:write");
      if (id) {
        const exp = id;
        if (action === "stop") await stopExperiment(project, ctx.user.id, exp);
        else if (action === "apply") await applyWinner(project, ctx.user.id, exp);
        else throw notFound("Route");
        return { ok: true };
      }
      await rateLimit(`growth-start:${ctx.user.id}`, 30, 3600_000);
      const body = await readJson(ctx.req, startSchema);
      if (body.publish && !can(role, "deploy:production")) throw new ApiError("forbidden", "You can start the test, but publishing needs production deploy rights");
      const aiAvailable = can(role, "ai:use") && (await hasLlm(project.orgId));
      const exp =
        "opportunityKey" in body
          ? await startFromOpportunity(project, ctx.user.id, body.opportunityKey, { aiAvailable, writeHeadline: aiAvailable ? (o) => writeHeadline(project, ctx.user.id, o) : undefined })
          : await startExperiment(project, ctx.user.id, { ...body, source: "user" });
      const published = body.publish ? await publishProduction(project, ctx.user.id, `started ${exp.id}`) : null;
      return Response.json({ experiment: exp, published }, { status: 201 });
    }
    case "POST opportunities": {
      if (!id) throw notFound("Route");
      if (action === "dismiss") {
        await requireProject(ctx, projectId, "design:write");
        await dismiss(projectId, id);
        return { ok: true };
      }
      if (action === "apply") {
        const { project, role } = await requireProject(ctx, projectId, "project:read");
        return applyAction(project, ctx.user.id, id, (p) => can(role, p as Parameters<typeof can>[1]));
      }
      throw notFound("Route");
    }
    case "POST publish": {
      const { project } = await requireProject(ctx, projectId, "deploy:production");
      await rateLimit(`growth-publish:${ctx.user.id}`, 20, 3600_000);
      const r = await publishProduction(project, ctx.user.id, "requested from Growth");
      if (!r.ok) throw new ApiError("conflict", `Could not publish: ${r.error}`);
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
