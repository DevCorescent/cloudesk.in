import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { deleteApp, listApps, registerApp, rotateAppSecret, updateApp } from "@/server/platform/apps";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };

/** Registering apps for an organization (the plugin SDK). Installing happens per project. */
async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  await requireOrg(ctx, orgId, "integrations:manage");
  const [id, action] = slug;
  if (id && !z.uuid().safeParse(id).success) throw notFound("App");
  await rateLimit(`apps:${ctx.user.id}`, 120, 3600_000);
  const key = `${ctx.req.method} ${[id && ":id", action].filter(Boolean).join(" ")}`.trim();
  switch (key) {
    case "GET":
      return { apps: await listApps(orgId) };
    case "POST": {
      const r = await registerApp(orgId, ctx.user.id, await ctx.req.json());
      return Response.json({ id: r.app.id, secret: r.secret }, { status: 201 });
    }
    case "PUT :id":
      await updateApp(orgId, id, await ctx.req.json());
      return { ok: true };
    case "DELETE :id":
      await deleteApp(orgId, ctx.user.id, id);
      return { ok: true };
    case "POST :id secret":
      return rotateAppSecret(orgId, id);
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
