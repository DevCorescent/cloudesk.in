// Feature requests from a workspace to the Cloudesk team: ask, discuss, vote,
// follow progress, and see what's been released to you. Also the release
// flags that are on for this workspace.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { comment, create, detail, flagsFor, list, update, vote, whatsNew, withdraw, wscope } from "@/server/requests/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.unknown());

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const s = await wscope(ctx, orgId);
  const isId = !!id && /^[0-9a-f-]{36}$/i.test(id);
  if (!id && m === "GET") return list(s, qs);
  if (!id && m === "POST") {
    await rateLimit(`feature-request:${s.userId}`, 20, 24 * 3_600_000);
    return create(s, await body(ctx));
  }
  if (id === "whats-new" && m === "GET") return whatsNew(s);
  if (id === "flags" && m === "GET") return flagsFor(orgId);
  if (!isId) throw notFound("Route");
  if (!sub && m === "GET") return detail(s, id);
  if (!sub && m === "PATCH") return update(s, id, await body(ctx));
  if (!sub && m === "DELETE") return withdraw(s, id);
  if (sub === "comments" && m === "POST") {
    await rateLimit(`feature-comment:${s.userId}`, 120, 3_600_000);
    return comment(s, id, await body(ctx));
  }
  if (sub === "vote" && (m === "POST" || m === "DELETE")) return vote(s, id, m === "POST");
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
