// Business IDs in a workspace: your own (made the first time you open it),
// the company's template, and — for the people who run the workspace —
// everyone's cards.
import { z } from "zod";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { generateAll, listCards, myCard, refreshMyCard, setTemplate, template, updateMyCard } from "@/server/cards/cards";

type P = { orgId: string; slug?: string[] };
const body = (req: Request) => readJson(req, z.unknown());

async function handle(method: string, ctx: AuthedContext, { orgId, slug = [] }: P) {
  const key = `${method} ${slug.join(" ")}`.trim();
  switch (key) {
    case "GET me":
      await requireOrg(ctx, orgId, "org:read");
      return myCard(orgId, ctx.user.id);
    case "PATCH me":
      await requireOrg(ctx, orgId, "org:read");
      return updateMyCard(orgId, ctx.user.id, await body(ctx.req));
    case "POST me refresh":
      await requireOrg(ctx, orgId, "org:read");
      return refreshMyCard(orgId, ctx.user.id);
    case "GET template":
      await requireOrg(ctx, orgId, "org:read");
      return { template: await template(orgId) };
    case "PUT template":
      await requireOrg(ctx, orgId, "members:manage");
      return setTemplate(orgId, ctx.user.id, await body(ctx.req));
    case "GET all":
      await requireOrg(ctx, orgId, "members:manage");
      return listCards(orgId);
    case "POST generate":
      await requireOrg(ctx, orgId, "members:manage");
      return generateAll(orgId);
    default:
      throw notFound("Endpoint");
  }
}

export const GET = route<P>((ctx, p) => handle("GET", ctx, p));
export const POST = route<P>((ctx, p) => handle("POST", ctx, p));
export const PATCH = route<P>((ctx, p) => handle("PATCH", ctx, p));
export const PUT = route<P>((ctx, p) => handle("PUT", ctx, p));
