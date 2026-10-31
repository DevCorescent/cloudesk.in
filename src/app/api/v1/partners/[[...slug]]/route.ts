// The partner program, publicly: its terms, checking a code, and applying
// without an account (an emailed code makes the account; see auth/signup/verify).
import { describeCode, partnerSignupSchema, publicProgram, startPartnerSignup } from "@/server/partners/core";
import { notFound } from "@/server/http/errors";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { slug?: string[] };

async function handle(ctx: RequestContext, { slug = [] }: P) {
  const [a, b] = slug;
  const m = ctx.req.method;
  if (a === "program" && m === "GET") return publicProgram();
  if (a === "coupon" && m === "GET") {
    await rateLimit(`coupon-check:${ctx.ip}`, 60, 60 * 60_000);
    return describeCode(new URL(ctx.req.url).searchParams.get("code") ?? "");
  }
  if (a === "apply" && b === "start" && m === "POST") {
    await rateLimit(`signup:${ctx.ip}`, 10, 3600_000);
    return startPartnerSignup(await readJson(ctx.req, partnerSignupSchema), { ip: ctx.ip });
  }
  throw notFound("Route");
}

const handler = route<P>(handle, { auth: false });
export const GET = handler;
export const POST = handler;
