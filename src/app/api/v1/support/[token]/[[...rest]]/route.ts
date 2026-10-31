// A customer's own ticket, by its signed link: read it, reply, rate it.
import { z } from "zod";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { publicReply, publicTicket, rate } from "@/server/helpdesk/core";

type P = { token: string; rest?: string[] };

async function handle(ctx: RequestContext, { token, rest = [] }: P) {
  await rateLimit(`support:${ctx.ip}`, 120, 60_000);
  switch (`${ctx.req.method} ${rest.join("/")}`) {
    case "GET ":
      return publicTicket(token);
    case "POST reply":
      return publicReply(token, ctx.ip, await readJson(ctx.req, z.record(z.string(), z.unknown())));
    case "POST rate":
      return rate(token, ctx.ip, await readJson(ctx.req, z.record(z.string(), z.unknown())));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle, { auth: false });
export const POST = route<P>(handle, { auth: false });
