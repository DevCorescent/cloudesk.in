// Documents & e-sign API for a workspace. Dispatches on
// "METHOD section :id sub", like the other module APIs. Uploads are
// multipart/form-data with a "file" and (optionally) "meta" as JSON.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { MAX_FILE_BYTES } from "@/lib/documents/model";
import { saveSettings, scope, team } from "@/server/documents/access";
import { contractDetail, contracts, linkOptions, decideContract, deleteFile, deleteFolder, fileDetail, fileResponse, files, folders, home, markSigned, newVersion, saveContract, saveFolder, submitContract, terminateContract, tickObligation, updateFile, upload, versionBytes } from "@/server/documents/core";
import { importContracts } from "@/server/documents/import";
import { certificate, createRequest, remind, requestDetail, requests, voidRequest } from "@/server/documents/sign";
import { docAi } from "@/server/documents/ai";
import { addComment, comments, deleteComment, editComment, resolveComment } from "@/server/documents/comments";
import { activity, copyFile, createDoc, createFolder, emptyTrash, list, move, openDoc, patchFile, patchFolder, purge, recentDocs, restore, setLink, setShares, shares, star, storage, trash, tree } from "@/server/documents/drive";
import { addAsset, assetResponse, exportDoc, getAsset, importDoc, pdfCopy } from "@/server/documents/exporting";
import { convert, pdfTool, preview } from "@/server/documents/tools";
import { docVersions, liveSince, openLive, pushLive, restoreVersion, saveLive, versionContent } from "@/server/documents/live";
import { waitForUpdate } from "@/server/services/codoc-bus";
import { rateLimit } from "@/server/security/rate-limit";
import { dropFor, logAccess, rotateDrop, saveDrop, setStay } from "@/server/documents/drop";
import { getFileAs } from "@/server/documents/access";

const STREAM_MS = 25_000;

/** Everyone else's edits and cursors on a document, as server-sent events (the browser reconnects with ?since). */
function liveStream(ctx: AuthedContext, s: Awaited<ReturnType<typeof scope>>, fileId: string, since: number) {
  let seq = Math.max(0, since || 0);
  const signal = ctx.req.signal;
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const end = Date.now() + STREAM_MS;
        let pinged = Date.now();
        try {
          ctrl.enqueue(enc.encode(`retry: 1000\n\n`));
          while (!signal.aborted && Date.now() < end) {
            const rows = await liveSince(fileId, seq);
            for (const r of rows) {
              seq = r.seq;
              if (r.kind === "reset") send("reset", { seq, why: Buffer.from(r.update).toString() });
              else if (r.kind === "doc" || Date.now() - r.createdAt.getTime() < 30_000) send("u", { seq, kind: r.kind, clientId: r.clientId, update: Buffer.from(r.update).toString("base64") });
            }
            if (rows.length === 200) continue;
            if (Date.now() - pinged > 10_000) {
              pinged = Date.now();
              ctrl.enqueue(enc.encode(`: ping\n\n`));
            }
            await waitForUpdate(fileId, 2000, signal);
          }
        } catch {
          // The browser went away or a query failed; it reconnects with ?since.
        } finally {
          try {
            ctrl.close();
          } catch {
            /* already closed */
          }
        }
      },
    }),
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } },
  );
}

type P = { orgId: string; slug?: string[] };
const who = (ctx: AuthedContext) => ({ ip: ctx.ip ?? null, userAgent: ctx.req.headers.get("user-agent") });
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function readUpload(ctx: AuthedContext) {
  if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 256 * 1024) throw new ApiError("payload_too_large", "Files are limited to 25 MB");
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new ApiError("bad_request", "Send the file as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError("validation_failed", "Choose a file to upload", { file: ["Required"] });
  if (file.size > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "Files are limited to 25 MB");
  let meta: unknown = {};
  try {
    meta = JSON.parse(String(form.get("meta") ?? "{}"));
  } catch {
    throw new ApiError("validation_failed", "The file's details aren't valid JSON");
  }
  return { file: { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, meta, note: String(form.get("note") ?? "") };
}

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  // A comment in a thread: docs/:id/comments/:commentId[/resolve]
  if (section === "docs" && sub === "comments" && slug[3]) {
    const cid = slug[3];
    if (m === "PATCH" && !slug[4]) return { comment: await editComment(s, id!, cid, await body(ctx)) };
    if (m === "DELETE" && !slug[4]) return deleteComment(s, id!, cid);
    if (m === "POST" && slug[4] === "resolve") return resolveComment(s, id!, cid, await body(ctx));
    throw notFound("Route");
  }

  switch (key) {
    // ── The drive ──
    case "GET drive":
      return list(s, qs);
    case "GET tree":
      return { folders: await tree(s) };
    case "GET storage":
      return storage(s);
    case "GET recent":
      return { files: await recentDocs(s, Math.min(20, Number(qs.limit) || 8)) };
    case "POST folder":
      return { folder: await createFolder(s, await body(ctx)) };
    case "PATCH folder :id":
      return { folder: await patchFolder(s, id!, await body(ctx)) };
    case "POST move":
      return move(s, await body(ctx));
    case "POST star":
      return star(s, await body(ctx));
    case "POST trash":
      return trash(s, await body(ctx));
    case "POST trash empty":
      return emptyTrash(s);
    case "POST restore":
      return restore(s, await body(ctx));
    case "POST purge":
      return purge(s, await body(ctx));
    case "GET shares":
      return shares(s, qs);
    case "PUT shares":
      return setShares(s, await body(ctx));
    case "PUT files :id link":
      return setLink(s, id!, await body(ctx));
    case "PATCH files :id":
      return { file: await patchFile(s, id!, await body(ctx)) };
    case "POST files :id copy":
      return { file: await copyFile(s, id!, await body(ctx).catch(() => ({}))) };
    case "GET files :id preview":
      return preview(s, id!);
    case "POST files :id convert":
      return convert(s, id!, await body(ctx));
    case "POST pdf":
      return pdfTool(s, await body(ctx));
    case "GET files :id activity":
      return { activity: await activity(s, id!) };

    // ── Written documents ──
    case "POST docs":
      return { file: await createDoc(s, await body(ctx)) };
    case "POST docs import": {
      const u = await readUpload(ctx);
      return { file: await importDoc(s, u.file, u.meta) };
    }
    case "GET docs :id":
      return openDoc(s, id!);
    case "GET docs :id live":
      return openLive(s, id!);
    case "GET docs :id stream":
      await openLive(s, id!).catch(() => {
        throw notFound("Document");
      });
      return liveStream(ctx, s, id!, Number(qs.since));
    case "POST docs :id live": {
      await rateLimit(`doclive:${ctx.user.id}`, 1500, 60_000);
      const b = await readJson(ctx.req, z.object({ kind: z.enum(["doc", "awareness"]), clientId: z.string().max(40), update: z.string().max(1_100_000) }));
      return { seq: await pushLive(s, id!, b.kind, b.clientId, new Uint8Array(Buffer.from(b.update, "base64"))) };
    }
    case "POST docs :id save": {
      const b = await readJson(ctx.req, z.object({ name: z.string().trim().max(120).optional() })).catch(() => ({}) as { name?: string });
      return saveLive(s, id!, { name: b.name });
    }
    case "GET docs :id versions":
      return { versions: await docVersions(s, id!) };
    case "GET docs :id version":
      return { content: await versionContent(s, id!, Number(qs.v)) };
    case "POST docs :id restore": {
      const b = await readJson(ctx.req, z.object({ version: z.number().int().min(1) }));
      return restoreVersion(s, id!, b.version);
    }
    case "GET docs :id comments":
      return { threads: await comments(s, id!) };
    case "POST docs :id comments":
      return { comment: await addComment(s, id!, await body(ctx)) };
    case "POST docs :id assets": {
      const u = await readUpload(ctx);
      return addAsset(s, id!, u.file);
    }
    case "GET docs :id export":
      return exportDoc(s, id!, qs.format, qs.inline === "1");
    case "POST docs :id pdf":
      return pdfCopy(s, id!);
    case "POST docs :id ai":
      return docAi(s, id!, await body(ctx));
    case "GET assets :id":
      return assetResponse(await getAsset(s, id!));

    case "GET meta":
      return { me: { id: s.userId, write: s.write, manage: s.manage }, settings: s.settings, people: await team(orgId), links: { crm: s.has("crm"), hr: s.has("hr"), work: s.has("work"), inventory: s.has("inventory"), sales: s.has("sales"), maintenance: s.has("maintenance") } };
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "GET links":
      return { options: await linkOptions(s, String(qs.type ?? ""), qs.q ?? "") };

    case "GET folders":
      return { folders: await folders(s) };
    case "POST folders":
      return { folder: await saveFolder(s, null, await body(ctx)) };
    case "PUT folders :id":
      return { folder: await saveFolder(s, id!, await body(ctx)) };
    case "DELETE folders :id":
      await deleteFolder(s, id!);
      return { ok: true };

    case "GET files":
      return { files: await files(s, qs) };
    case "POST files": {
      const u = await readUpload(ctx);
      return { file: await upload(s, u.file, u.meta) };
    }
    case "GET files :id":
      return fileDetail(s, id!);
    case "PUT files :id":
      return { file: await updateFile(s, id!, await body(ctx)) };
    case "DELETE files :id":
      await deleteFile(s, id!);
      return { ok: true };
    case "POST files :id versions": {
      const u = await readUpload(ctx);
      return newVersion(s, id!, u.file, u.note);
    }
    case "GET files :id download": {
      const v = await versionBytes(s, id!, qs.version ? Number(qs.version) : undefined);
      // Shown inline (previews, thumbnails) isn't a download; the viewer logs an opening itself.
      if (qs.inline !== "1") await logAccess(s, id!, "downloaded", who(ctx));
      return fileResponse(v, qs.inline === "1");
    }
    // Opening or printing a file, logged (and told to whoever uploaded it by Drive QR).
    case "POST files :id event": {
      const kind = (await body(ctx)).kind;
      if (kind !== "viewed" && kind !== "printed") throw new ApiError("validation_failed", "Viewed or printed");
      await getFileAs(s, id!);
      await logAccess(s, id!, kind, who(ctx));
      return { ok: true };
    }
    // When it's deleted completely (null keeps it).
    case "PUT files :id stay":
      return setStay(s, id!, await body(ctx));

    // ── Drive QR: uploads from a phone into this folder ──
    case "GET drop":
      return dropFor(s, qs);
    case "PUT drop":
      return saveDrop(s, await body(ctx));
    case "POST drop :id rotate":
      return rotateDrop(s, id!);

    case "GET contracts":
      return { contracts: await contracts(s, qs) };
    case "POST contracts":
      return { contract: await saveContract(s, null, await body(ctx)) };
    case "POST contracts import":
      return importContracts(s, await body(ctx));
    case "GET contracts :id":
      return contractDetail(s, id!);
    case "PUT contracts :id":
      return { contract: await saveContract(s, id!, await body(ctx)) };
    case "POST contracts :id submit":
      return submitContract(s, id!);
    case "POST contracts :id decide":
      return decideContract(s, id!, await body(ctx));
    case "POST contracts :id signed":
      await markSigned(s, id!);
      return { ok: true };
    case "POST contracts :id terminate":
      await terminateContract(s, id!, await body(ctx));
      return { ok: true };
    case "POST contracts :id obligation":
      return tickObligation(s, id!, await body(ctx));

    case "GET signatures":
      return { requests: await requests(s, qs) };
    case "POST signatures":
      return createRequest(s, await body(ctx));
    case "GET signatures :id":
      return requestDetail(s, id!);
    case "POST signatures :id remind":
      return remind(s, id!, await body(ctx));
    case "POST signatures :id void":
      await voidRequest(s, id!, await body(ctx));
      return { ok: true };
    case "GET signatures :id certificate":
      return certificate(s, id!);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
export const PATCH = route<P>(handle);
