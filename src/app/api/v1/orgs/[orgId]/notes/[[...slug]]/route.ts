// Notes: each member's own, and the ones shared with them. Any member of the
// workspace can keep notes; what they can read or change is checked per note.
import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import * as notes from "@/server/notes/core";
import { runAi } from "@/server/notes/ai";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  await requireOrg(ctx, orgId, "org:read");
  const w = { orgId, userId: ctx.user.id };
  const [a, id, b, c] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  if (m !== "GET") await rateLimit(`notes:${ctx.user.id}`, 2000, 3_600_000);

  if (!a && m === "GET") return { notes: await notes.list(w, qs) };
  if (!a && m === "POST") return { note: await notes.create(w, await body(ctx)) };
  if (a === "overview" && m === "GET") return notes.overview(w);
  if (a === "members" && m === "GET") return { members: await notes.members(w) };
  if (a === "csv" && m === "GET") return new Response(await notes.exportCsv(w), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="notes.csv"' } });
  if (a === "import" && m === "POST") return notes.importNotes(w, await body(ctx));
  if (a === "move" && m === "POST") {
    const v = await readJson(ctx.req, z.object({ ids: z.array(z.uuid()).min(1).max(500), folderId: z.uuid().nullable() }));
    return notes.moveNotes(w, v.ids, v.folderId);
  }
  if (a === "daily" && m === "GET") return id === "days" ? { days: await notes.dailyDays(w, qs.month ?? "") } : { note: await notes.daily(w, id) };
  if (a === "trash" && m === "DELETE") return notes.purge(w, "all");
  if (a === "ai" && m === "POST") {
    await rateLimit(`notes-ai:${ctx.user.id}`, 120, 3_600_000);
    return runAi(w, await body(ctx));
  }

  if (a === "folders") {
    if (!id && m === "POST") return { folder: await notes.createFolder(w, await body(ctx)) };
    if (isId(id) && m === "PATCH") return { folder: await notes.updateFolder(w, id!, await body(ctx)) };
    if (isId(id) && m === "DELETE") {
      await notes.deleteFolder(w, id!);
      return { ok: true };
    }
  }

  if (isId(a)) {
    const nid = a!;
    if (!id && m === "GET") return { note: await notes.get(w, nid) };
    if (!id && m === "PATCH") return { note: await notes.update(w, nid, await body(ctx)) };
    if (!id && m === "DELETE") {
      if (qs.forever === "1") return notes.purge(w, nid);
      await notes.remove(w, nid);
      return { ok: true };
    }
    if (id === "restore" && m === "POST") return { note: await notes.restore(w, nid) };
    if (id === "duplicate" && m === "POST") return { note: await notes.create(w, { from: nid }) };
    if (id === "shares" && m === "PUT") return { note: await notes.setShares(w, nid, await body(ctx)) };
    if (id === "publish" && m === "POST") return { note: await notes.publish(w, nid, true) };
    if (id === "publish" && m === "DELETE") return { note: await notes.publish(w, nid, false) };
    if (id === "versions" && !b && m === "GET") return { versions: await notes.versions(w, nid) };
    if (id === "versions" && isId(b) && !c && m === "GET") return { version: await notes.version(w, nid, b!) };
    if (id === "versions" && isId(b) && c === "restore" && m === "POST") return { note: await notes.restoreVersion(w, nid, b!) };
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
