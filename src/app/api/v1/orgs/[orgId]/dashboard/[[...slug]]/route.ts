// The Home dashboard for the signed-in member: GET for the whole dashboard,
// GET desk for the quick look at mail, calendar, chat, notes and the rest,
// PUT layout to save their section order, POST used to count a quick action.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { dashboard, saveLayout, used } from "@/server/dashboard/core";
import { desk } from "@/server/dashboard/desk";

type P = { orgId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const key = `${ctx.req.method} ${slug.join(" ")}`.trim();
  switch (key) {
    case "GET":
      return dashboard(ctx, orgId);
    case "GET desk":
      return desk(ctx, orgId);
    case "PUT layout":
      return { layout: await saveLayout(ctx, orgId, await readJson(ctx.req, z.unknown())) };
    case "POST used":
      return used(ctx, orgId, (await readJson(ctx.req, z.object({ id: z.string().max(40) }))).id);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const PUT = route<P>(handle);
export const POST = route<P>(handle);
