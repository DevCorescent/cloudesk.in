// A workspace's subscription: the plan, trial, invoices and paying them.
// Owners and the billing role only; prices are always worked out here.
import { z } from "zod";
import { choiceSchema, topupSchema } from "@/lib/billing/schema";
import { buyTopup, cancelAtEnd, changePlan, confirmPayment, overview, previewChange, quoteFor, startPayment } from "@/server/billing/subscriptions";
import { notFound } from "@/server/http/errors";
import { applyCouponToOrg } from "@/server/partners/core";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { appUrl } from "@/server/services/mail";

type P = { orgId: string; slug?: string[] };
const provider = z.enum(["razorpay", "stripe"]);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  await requireOrg(ctx, orgId, "billing:manage");
  const [a, id, b] = slug;
  const m = ctx.req.method;
  if (!a && m === "GET") return overview(orgId);
  if (m !== "GET") await rateLimit(`subscription:${orgId}`, 120, 3_600_000);
  if (a === "quote" && m === "POST") return quoteFor(await readJson(ctx.req, choiceSchema));
  if (a === "preview" && m === "POST") return previewChange(orgId, await readJson(ctx.req, choiceSchema));
  if (a === "change" && m === "POST") {
    const r = await changePlan(orgId, ctx.user.id, await readJson(ctx.req, choiceSchema));
    return { mode: r.preview.mode, applied: r.applied, invoiceId: r.invoice?.id ?? null, overview: await overview(orgId) };
  }
  if (a === "topup" && m === "POST") {
    const { packs } = await readJson(ctx.req, z.object({ packs: topupSchema }));
    const r = await buyTopup(orgId, ctx.user.id, packs);
    return { applied: r.applied, invoiceId: r.invoice.id, overview: await overview(orgId) };
  }
  if (a === "coupon" && m === "POST") {
    await rateLimit(`coupon:${orgId}`, 10, 3_600_000);
    const { code } = await readJson(ctx.req, z.object({ code: z.string().trim().min(1, "Enter a code").max(30) }));
    await applyCouponToOrg(orgId, ctx.user, code);
    return overview(orgId);
  }
  if ((a === "cancel" || a === "resume") && m === "POST") {
    await cancelAtEnd(orgId, ctx.user.id, a === "cancel");
    return overview(orgId);
  }
  if (a === "invoices" && id && /^[0-9a-f-]{36}$/i.test(id) && m === "POST") {
    if (b === "pay") {
      const { provider: pv } = await readJson(ctx.req, z.object({ provider }));
      return startPayment(orgId, id, pv, { email: ctx.user.email, name: ctx.user.name }, appUrl("/settings/billing"));
    }
    if (b === "confirm") {
      const body = await readJson(ctx.req, z.object({ provider, orderId: z.string().max(100).optional(), paymentId: z.string().max(100).optional(), signature: z.string().max(200).optional(), sessionId: z.string().max(200).optional() }));
      const r = await confirmPayment(orgId, id, body);
      return { paid: r.paid, overview: await overview(orgId) };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
