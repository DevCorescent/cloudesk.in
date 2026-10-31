// A workspace's lifecycle for its owners and admins: support access, export,
// scheduled deletion (owners only) and log retention.
import { z } from "zod";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { cancelDeletion, downloadExport, exports, grant, grants, requestExport, retention, revokeGrant, saveRetention, scheduleDeletion } from "@/server/platform/lifecycle";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { cfg } from "@/server/platform/config";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const { role } = await requireOrg(ctx, orgId, "org:update");
  const me = ctx.user.id;
  const [section, id, sub] = slug;
  const key = `${ctx.req.method} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  switch (key) {
    case "GET ": {
      const [o] = await db.select({ deletionScheduledAt: schema.organizations.deletionScheduledAt, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
      return { owner: role === "owner", name: o.name, deletionScheduledAt: o.deletionScheduledAt, grants: await grants(orgId), exports: await exports(orgId), retention: await retention(orgId), residency: residency() };
    }
    case "POST support":
      return { grant: await grant(orgId, me, await body(ctx)) };
    case "DELETE support :id":
      await revokeGrant(orgId, me, id!);
      return { ok: true };
    case "POST exports":
      return { export: await requestExport(orgId, me) };
    case "GET exports :id download":
      return downloadExport(orgId, me, id!);
    case "POST deletion":
      if (role !== "owner") throw new ApiError("forbidden", "Only an owner can delete the workspace");
      return scheduleDeletion(orgId, me, await body(ctx));
    case "DELETE deletion":
      if (role !== "owner") throw new ApiError("forbidden", "Only an owner can cancel the deletion");
      await cancelDeletion(orgId, me);
      return { ok: true };
    case "PUT retention":
      return { retention: await saveRetention(orgId, me, await body(ctx)) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);

/**
 * Where this deployment keeps data, as its operator declared it (DATA_REGION),
 * and which outside services it's set up to send data to. Only whether each
 * is configured is shown — never a key.
 */
function residency() {
  const on = (k: string) => !!cfg(k)?.trim();
  return {
    region: process.env.DATA_REGION?.trim() || null,
    processors: [
      on("RESEND_API_KEY") && { name: "Resend", purpose: "Sending email (the message and the address)" },
      on("ANTHROPIC_API_KEY") && { name: "Anthropic", purpose: "AI features you use (what you ask and the records it reads)" },
      on("VOYAGE_API_KEY") && { name: "Voyage AI", purpose: "Search over your knowledge base (the text being indexed)" },
      on("OPENAI_API_KEY") && { name: "OpenAI", purpose: "Search over your knowledge base, when Voyage isn't set up" },
    ].filter(Boolean),
  };
}
