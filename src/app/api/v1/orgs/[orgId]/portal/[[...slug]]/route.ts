// The team's side of the customer & supplier portals. Dispatches on
// "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { draftFor, invite, markBilled, overview, reject, revoke, saveSettings, scope, sessions, submissionFile, submissions } from "@/server/portal/admin";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);
  switch (key) {
    case "GET meta":
      return overview(s);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET sessions":
      return { sessions: await sessions(s) };
    case "DELETE sessions :id":
      await revoke(s, id!);
      return { ok: true };
    case "POST invite":
      return invite(s, await body(ctx));
    case "GET submissions":
      return { invoices: await submissions(s, qs) };
    case "GET submissions :id file":
      return submissionFile(s, id!);
    case "GET submissions :id draft":
      return draftFor(ctx, s, id!, qs.ai === "1");
    case "POST submissions :id billed":
      await markBilled(s, id!, await body(ctx));
      return { ok: true };
    case "POST submissions :id reject":
      await reject(s, id!, await body(ctx));
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
