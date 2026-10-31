// AI copilot API for a workspace. Dispatches on "METHOD section :id sub", like
// the other module APIs. Conversations and suggestions are the asker's own.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { activity, ask, checks, confirm, deleteThread, dismiss, scope, search, status, thread, threads } from "@/server/copilot/core";

type P = { orgId: string; slug?: string[] };
// A question can take several model calls and reports.
export const maxDuration = 300;

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return status(s);
    case "GET threads":
      return { threads: await threads(s) };
    case "POST threads": {
      await rateLimit(`copilot:${s.userId}`, 60, 3_600_000);
      const v = await readJson(ctx.req, z.object({ text: z.string().max(10_000) }));
      return ask(s, null, v.text);
    }
    case "GET threads :id":
      return thread(s, id!);
    case "POST threads :id messages": {
      await rateLimit(`copilot:${s.userId}`, 60, 3_600_000);
      const v = await readJson(ctx.req, z.object({ text: z.string().max(10_000) }));
      return ask(s, id!, v.text);
    }
    case "DELETE threads :id":
      await deleteThread(s, id!);
      return { ok: true };
    case "POST actions :id confirm":
      return confirm(ctx, s, id!);
    case "POST actions :id dismiss":
      await dismiss(s, id!);
      return { ok: true };
    case "GET checks":
      return checks(s);
    case "GET activity":
      return activity(s);
    case "GET search":
      return { results: await search(s, new URL(ctx.req.url).searchParams.get("q")?.slice(0, 100) ?? "") };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const DELETE = route<P>(handle);
