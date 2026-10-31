// Signing by link, for people without an account: what's to sign, the file
// itself, signing and declining. The token in the path is the signer's secret.
import { z } from "zod";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { decline, sign, signingFile, signingView } from "@/server/documents/sign";

type P = { token: string; rest?: string[] };

async function handle(ctx: RequestContext, { token, rest = [] }: P) {
  await rateLimit(`sign:${ctx.ip}`, 60, 60_000);
  const who = { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") };
  const key = `${ctx.req.method} ${rest.join("/")}`;
  switch (key) {
    case "GET ":
      return signingView(token);
    case "GET file":
      return signingFile(token, who);
    case "POST sign":
      return sign(token, await readJson(ctx.req, z.record(z.string(), z.unknown())), who);
    case "POST decline":
      return decline(token, await readJson(ctx.req, z.record(z.string(), z.unknown())), who);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle, { auth: false });
export const POST = route<P>(handle, { auth: false });
