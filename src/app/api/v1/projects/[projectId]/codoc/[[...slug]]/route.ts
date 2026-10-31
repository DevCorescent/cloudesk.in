import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { can } from "@/server/authz/permissions";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { waitForUpdate } from "@/server/services/codoc-bus";
import { getCodoc, openCodoc, pushUpdate, saveCodoc, updatesSince } from "@/server/services/codoc";
import { permissionForPath } from "@/server/services/files";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string; slug?: string[] };
const STREAM_MS = 25_000;

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [docId, action] = slug;
  const method = ctx.req.method;
  const url = new URL(ctx.req.url);

  if (method === "GET" && !docId) {
    const { role } = await requireProject(ctx, projectId, "project:read");
    const path = url.searchParams.get("path") ?? "";
    const { doc, state, seq } = await openCodoc(projectId, path);
    return { docId: doc.id, path: doc.path, revision: doc.baseRevision, seq, state: Buffer.from(state).toString("base64"), canWrite: can(role, permissionForPath(doc.path)) };
  }
  if (!docId || !z.uuid().safeParse(docId).success) throw notFound("Shared document");

  if (method === "GET" && action === "stream") {
    await requireProject(ctx, projectId, "project:read");
    let seq = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const signal = ctx.req.signal;
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const end = Date.now() + STREAM_MS;
        let pinged = Date.now();
        try {
          ctrl.enqueue(enc.encode(`retry: 1000\n\n`));
          // Only documents of this project; anything else looks like a reset.
          if (!(await getCodoc(projectId, docId))) {
            send("reset", {});
            return;
          }
          while (!signal.aborted && Date.now() < end) {
            const rows = await updatesSince(docId, seq);
            for (const r of rows) {
              seq = r.seq;
              if (r.kind === "saved") send("saved", { seq, revision: Number(Buffer.from(r.update).toString()) });
              else if (r.kind === "doc" || Date.now() - r.createdAt.getTime() < 30_000) send("u", { seq, kind: r.kind, clientId: r.clientId, update: Buffer.from(r.update).toString("base64") });
            }
            if (rows.length === 200) continue;
            // The document disappears when the file is changed elsewhere.
            if (!rows.length && !(await getCodoc(projectId, docId))) {
              send("reset", {});
              break;
            }
            if (Date.now() - pinged > 10_000) {
              pinged = Date.now();
              ctrl.enqueue(enc.encode(`: ping\n\n`));
            }
            await waitForUpdate(docId, 2000, signal);
          }
        } catch {
          // Client went away or the query failed; the browser reconnects with ?since.
        } finally {
          try {
            ctrl.close();
          } catch {
            /* already closed */
          }
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  }

  if (method === "POST" && !action) {
    const { role } = await requireProject(ctx, projectId, "project:read");
    await rateLimit(`codoc:${ctx.user.id}`, 1200, 60_000);
    const body = await readJson(ctx.req, z.object({ kind: z.enum(["doc", "awareness"]), clientId: z.string().max(40), update: z.string().max(800_000) }));
    const doc = await getCodoc(projectId, docId);
    if (!doc) throw notFound("Shared document");
    if (body.kind === "doc" && !can(role, permissionForPath(doc.path))) return Response.json({ error: { code: "forbidden", message: "You can't edit this file" } }, { status: 403 });
    const seq = await pushUpdate(doc, body.kind, body.clientId, ctx.user.id, new Uint8Array(Buffer.from(body.update, "base64")));
    await db.execute(sql`select pg_notify('codoc', ${docId})`);
    return { seq };
  }

  if (method === "POST" && action === "save") {
    const { role } = await requireProject(ctx, projectId, "project:read");
    const doc = await getCodoc(projectId, docId);
    if (!doc) throw notFound("Shared document");
    if (!can(role, permissionForPath(doc.path))) return Response.json({ error: { code: "forbidden", message: "You can't edit this file" } }, { status: 403 });
    const r = await saveCodoc(projectId, docId, ctx.user.id);
    await db.execute(sql`select pg_notify('codoc', ${docId})`);
    return r;
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
