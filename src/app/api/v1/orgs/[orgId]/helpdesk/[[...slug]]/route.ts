// Helpdesk API for a workspace. Dispatches on "METHOD section :id sub", like
// the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { agents, rotateInbound, saveSettings, scope } from "@/server/helpdesk/access";
import { canned, cannedFor, counts, createTicket, deleteCanned, detail, inboundInfo, list, reply, report, saveCanned, update } from "@/server/helpdesk/core";
import { importTickets } from "@/server/helpdesk/import";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, subId] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return { me: { id: s.userId, write: s.write, manage: s.manage }, settings: s.settings, agents: await agents(orgId), counts: await counts(s), links: { crm: s.has("crm") } };
    case "GET tickets":
      return { tickets: await list(s, qs) };
    case "POST tickets":
      return { ticket: await createTicket(s, await body(ctx)) };
    case "POST tickets import":
      return importTickets(s, await readJson(ctx.req, z.unknown()));
    case "GET tickets :id":
      return detail(s, id!);
    case "PATCH tickets :id":
      return { ticket: await update(s, id!, await body(ctx)) };
    case "POST tickets :id replies":
      return { message: await reply(s, id!, await body(ctx)) };
    case "GET tickets :id canned":
      return cannedFor(s, id!, subId ?? "");
    case "GET canned":
      return { canned: await canned(s) };
    case "POST canned":
      return { canned: await saveCanned(s, null, await body(ctx)) };
    case "PUT canned :id":
      return { canned: await saveCanned(s, id!, await body(ctx)) };
    case "DELETE canned :id":
      await deleteCanned(s, id!);
      return { ok: true };
    case "GET reports":
      return report(s, qs);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET inbound":
      return inboundInfo(s);
    case "POST inbound rotate":
      await rotateInbound(s);
      return inboundInfo(s);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
