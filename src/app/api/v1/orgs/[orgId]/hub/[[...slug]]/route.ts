// The workspace integration hub for members: webhooks, API keys, background
// work and reconciliation.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { createEndpoint, createKey, deleteEndpoint, deliveries, endpoints, eventCatalogue, jobs, keys, reconciliation, redeliver, retryJob, revokeKey, rollSecret, scope, sendTest, updateEndpoint, usage } from "@/server/hub/core";
import { ERP_SCOPES, API_VERSIONS } from "@/lib/hub/model";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);
  switch (key) {
    case "GET meta":
      return { me: { manage: s.manage }, events: eventCatalogue(), scopes: Object.entries(ERP_SCOPES).map(([id, description]) => ({ id, description })), versions: API_VERSIONS };
    case "GET webhooks":
      return { webhooks: await endpoints(s) };
    case "POST webhooks":
      return createEndpoint(s, await body(ctx));
    case "PATCH webhooks :id":
      return { webhook: await updateEndpoint(s, id!, await body(ctx)) };
    case "DELETE webhooks :id":
      await deleteEndpoint(s, id!);
      return { ok: true };
    case "POST webhooks :id roll":
      return rollSecret(s, id!);
    case "POST webhooks :id test":
      return sendTest(s, id!);
    case "GET webhooks :id deliveries":
      return { deliveries: await deliveries(s, id!, qs) };
    case "POST deliveries :id retry":
      return redeliver(s, id!);
    case "GET keys":
      return { keys: await keys(s) };
    case "POST keys":
      return createKey(s, await body(ctx));
    case "DELETE keys :id":
      await revokeKey(s, id!);
      return { ok: true };
    case "GET usage":
      return { usage: await usage(s) };
    case "GET jobs":
      return jobs(s);
    case "POST jobs :id retry":
      return retryJob(s, id!);
    case "GET reconciliation":
      return { days: await reconciliation(s) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
