// The calculator's history: each member's own.
import { z } from "zod";
import { add, clear, counts, entrySchema, exportCsv, list, remove, update } from "@/server/calculator/history";
import { notFound } from "@/server/http/errors";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  await requireOrg(ctx, orgId, "org:read");
  const w = { orgId, userId: ctx.user.id };
  const [a, id] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  if (a !== "history") throw notFound("Route");
  if (!id && m === "GET") return { entries: await list(w, { search: qs.q, pinned: qs.pinned === "1", before: qs.before, limit: Number(qs.limit) || undefined }), counts: await counts(w) };
  if (id === "csv" && m === "GET") return new Response(await exportCsv(w), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="calculator-history.csv"' } });
  if (!id && m === "POST") {
    await rateLimit(`calc:${ctx.user.id}`, 600, 60 * 60_000);
    return { entry: await add(w, await readJson(ctx.req, entrySchema)) };
  }
  if (!id && m === "DELETE") return clear(w, qs.all === "1");
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    if (m === "PATCH") return { entry: await update(w, id, await readJson(ctx.req, z.object({ note: z.string().max(200).optional(), pinned: z.boolean().optional() }))) };
    if (m === "DELETE") {
      await remove(w, id);
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
