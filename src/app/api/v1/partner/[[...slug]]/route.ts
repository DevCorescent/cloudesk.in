// The signed-in person's own partner account: applying, the dashboard, codes,
// leads, payout details and withdrawals. Everything but applying and reading
// your status needs an approved partner profile.
import { z } from "zod";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { apply, applicationSchema, cancelPayout, couponSchema, createCoupon, dashboard, leadSchema, listCommissions, listLeads, listPayouts, partnerOf, payoutDetailsSchema, profileSchema, program, registerLead, requestPayout, setCouponActive, setPayoutDetails, shapePartner, termsFor, updateLead, updateProfile, withdrawSchema } from "@/server/partners/core";
import { rateLimit } from "@/server/security/rate-limit";

type P = { slug?: string[] };
const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

async function handle(ctx: AuthedContext, { slug = [] }: P) {
  const [a, id, b] = slug;
  const m = ctx.req.method;
  if (m !== "GET") await rateLimit(`partner:${ctx.user.id}`, 300, 3_600_000);
  if (a === "apply" && m === "POST") return { partner: shapePartner(await apply(ctx.user, await readJson(ctx.req, applicationSchema))) };
  const p = await partnerOf(ctx.user.id);
  if (!a && m === "GET") {
    if (!p) return { partner: null };
    if (p.status !== "approved") return { partner: shapePartner(p), terms: termsFor(p, await program()) };
    return dashboard(p);
  }
  if (!p) throw new ApiError("not_found", "You haven't applied to the partner program yet.");
  if (a === "profile" && m === "PUT") return { partner: await updateProfile(p, await readJson(ctx.req, profileSchema)) };
  if (a === "payout-details" && m === "PUT") return { partner: await setPayoutDetails(p, await readJson(ctx.req, payoutDetailsSchema)) };
  if (p.status !== "approved") throw new ApiError("forbidden", "This is available once your partner profile is approved.");
  if (a === "commissions" && m === "GET") return { commissions: await listCommissions(p.id) };
  if (a === "payouts" && !id && m === "GET") return { payouts: await listPayouts(p.id) };
  if (a === "payouts" && !id && m === "POST") return { payout: await requestPayout(p, await readJson(ctx.req, withdrawSchema)) };
  if (a === "payouts" && isId(id) && b === "cancel" && m === "POST") return { payout: await cancelPayout(p, id!) };
  if (a === "coupons" && !id && m === "POST") return { coupon: await createCoupon(p, await readJson(ctx.req, couponSchema)) };
  if (a === "coupons" && isId(id) && m === "PATCH") return { coupon: await setCouponActive(p, id!, (await readJson(ctx.req, z.object({ active: z.boolean() }))).active) };
  if (a === "leads" && !id && m === "GET") return { leads: await listLeads(p.id) };
  if (a === "leads" && !id && m === "POST") return { lead: await registerLead(p, await readJson(ctx.req, leadSchema)) };
  if (a === "leads" && isId(id) && m === "PATCH") return { lead: await updateLead(p, id!, await readJson(ctx.req, z.object({ status: z.string().max(20).optional(), notes: z.string().max(1000).optional(), value: z.number().int().min(0).max(1_000_000_000).optional() }))) };
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
