import { z } from "zod";
import { billingOverview, cancelSubscription, changePlan, confirmStripeCheckout, portalUrl, resumeSubscription, startCheckout } from "@/server/billing/billing";
import { notFound } from "@/server/http/errors";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };
const paid = z.enum(["pro", "business"]);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const key = `${ctx.req.method} ${slug.join("/")}`.trim();
  if (key === "GET") {
    await requireOrg(ctx, orgId, "org:read");
    return billingOverview(orgId);
  }
  await requireOrg(ctx, orgId, "billing:manage");
  await rateLimit(`billing:${orgId}`, 60, 3600_000);
  switch (key) {
    case "POST checkout": {
      const body = await readJson(ctx.req, z.object({ plan: paid, provider: z.enum(["stripe", "razorpay"]) }));
      return startCheckout(orgId, ctx.user.id, ctx.user.email, body);
    }
    case "POST confirm": {
      const { sessionId } = await readJson(ctx.req, z.object({ sessionId: z.string().max(200) }));
      return confirmStripeCheckout(orgId, sessionId);
    }
    case "POST change": {
      const { plan } = await readJson(ctx.req, z.object({ plan: paid }));
      await changePlan(orgId, ctx.user.id, plan);
      return { ok: true };
    }
    case "POST cancel":
      await cancelSubscription(orgId, ctx.user.id);
      return { ok: true };
    case "POST resume":
      await resumeSubscription(orgId, ctx.user.id);
      return { ok: true };
    case "POST portal":
      return portalUrl(orgId);
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
