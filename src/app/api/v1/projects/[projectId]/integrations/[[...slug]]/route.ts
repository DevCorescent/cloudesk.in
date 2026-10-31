import { z } from "zod";
import { API_SCOPES, EVENT_INFO, EVENT_TYPES, SCOPE_INFO } from "@/lib/platform/events";
import { connectIntegration, disconnectIntegration, INTEGRATION_KINDS, listIntegrations, updateIntegration, type IntegrationKind } from "@/server/events/integrations";
import { createEndpoint, deleteEndpoint, listDeliveries, listEndpoints, redeliver, rollSecret, sendTestEvent, updateEndpoint } from "@/server/events/webhooks";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { createApiKey, listApiKeys, revokeApiKey } from "@/server/platform/api-keys";
import { installApp, listApps, uninstallApp } from "@/server/platform/apps";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";

type P = { projectId: string; slug?: string[] };
const uuid = (v: string | undefined) => !!v && z.uuid().safeParse(v).success;

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const { project } = await requireProject(ctx, projectId, "integrations:manage");
  const [section, id, action] = slug;
  const key = `${ctx.req.method} ${[section, id && ":id", action].filter(Boolean).join(" ")}`.trim();
  await rateLimit(`integrations:${ctx.user.id}`, 300, 3600_000);
  switch (key) {
    case "GET":
      return {
        integrations: await listIntegrations(projectId),
        webhooks: await listEndpoints(projectId),
        apiKeys: await listApiKeys(projectId),
        apps: await listApps(project.orgId, projectId),
        events: EVENT_TYPES.filter((e) => e !== "webhook.test").map((e) => ({ id: e, description: EVENT_INFO[e] })),
        scopes: API_SCOPES.map((s) => ({ id: s, description: SCOPE_INFO[s] })),
      };

    // Built-in integrations
    case "POST connect :id": {
      if (!INTEGRATION_KINDS.includes(id as IntegrationKind)) throw notFound("Integration");
      const body = await readJson(ctx.req, z.object({ creds: z.record(z.string(), z.string().max(500)), settings: z.record(z.string(), z.unknown()).default({}) }));
      await connectIntegration(project, ctx.user.id, id as IntegrationKind, body.creds, body.settings);
      return { ok: true };
    }
    case "PATCH connect :id": {
      const body = await readJson(ctx.req, z.object({ enabled: z.boolean().optional(), events: z.array(z.enum(EVENT_TYPES)).optional() }));
      await updateIntegration(projectId, id, body);
      return { ok: true };
    }
    case "DELETE connect :id":
      await disconnectIntegration(project, ctx.user.id, id);
      return { ok: true };

    // Outgoing webhooks
    case "POST webhooks": {
      const body = await readJson(ctx.req, z.object({ url: z.string().max(500), description: z.string().max(200).default(""), events: z.array(z.string().max(40)).max(20) }));
      const r = await createEndpoint(projectId, body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "webhook.created", targetType: "webhook", targetId: r.endpoint.id });
      return Response.json({ id: r.endpoint.id, secret: r.secret }, { status: 201 });
    }
    case "PATCH webhooks :id":
      if (!uuid(id)) throw notFound("Webhook endpoint");
      await updateEndpoint(projectId, id, await readJson(ctx.req, z.object({ events: z.array(z.string().max(40)).max(20).optional(), enabled: z.boolean().optional(), description: z.string().max(200).optional() })));
      return { ok: true };
    case "DELETE webhooks :id":
      if (!uuid(id)) throw notFound("Webhook endpoint");
      await deleteEndpoint(projectId, id);
      return { ok: true };
    case "POST webhooks :id roll":
      if (!uuid(id)) throw notFound("Webhook endpoint");
      return rollSecret(projectId, id);
    case "POST webhooks :id test":
      if (!uuid(id)) throw notFound("Webhook endpoint");
      return { delivery: { id: (await sendTestEvent(projectId, id)).id } };
    case "GET webhooks :id deliveries":
      if (!uuid(id)) throw notFound("Webhook endpoint");
      return { deliveries: await listDeliveries(projectId, id) };
    case "POST deliveries :id redeliver":
      if (!uuid(id)) throw notFound("Delivery");
      await redeliver(projectId, id);
      return { ok: true };

    // API keys
    case "POST keys": {
      const body = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.string().max(40)).max(20) }));
      const r = await createApiKey(projectId, body, ctx.user.id);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "api_key.created", targetType: "api_key", targetId: r.row.id, metadata: { scopes: r.row.scopes } });
      return Response.json({ id: r.row.id, key: r.key }, { status: 201 });
    }
    case "DELETE keys :id":
      if (!uuid(id)) throw notFound("API key");
      await revokeApiKey(projectId, id);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "api_key.revoked", targetType: "api_key", targetId: id });
      return { ok: true };

    // Apps
    case "POST apps :id install": {
      if (!uuid(id)) throw notFound("App");
      const { config } = await readJson(ctx.req, z.object({ config: z.record(z.string(), z.unknown()).default({}) }));
      return installApp(project, ctx.user.id, id, config);
    }
    case "DELETE apps :id install":
      if (!uuid(id)) throw notFound("App");
      await uninstallApp(project, ctx.user.id, id);
      return { ok: true };
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
