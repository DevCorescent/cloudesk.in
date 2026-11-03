// AI copilot API for a workspace. Dispatches on "METHOD section :id sub", like
// the other module APIs. Conversations and suggestions are the asker's own.
import { z } from "zod";
import { MAX_ATTACH_BYTES, type Upload } from "@/server/copilot/attachments";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { activity, ask, checks, confirm, deleteThread, dismiss, scope, search, status, thread, threads } from "@/server/copilot/core";

type P = { orgId: string; slug?: string[] };
// A question can take several model calls and reports.
const questionJson = z.object({ text: z.string().max(10_000), advisor: z.string().max(30).nullable().optional() });

/** A question: JSON, or a form with files (photos, PDFs, Office files) added to it. */
async function question(req: Request): Promise<{ text: string; advisor: string | null; files: Upload[] }> {
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const v = await readJson(req, questionJson);
    return { text: v.text, advisor: v.advisor ?? null, files: [] };
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ATTACH_BYTES + 256 * 1024) throw new ApiError("payload_too_large", "Files added to one question are limited to 4 MB in all");
  const form = await req.formData().catch(() => {
    throw new ApiError("bad_request", "Couldn't read the upload");
  });
  const files: Upload[] = [];
  for (const f of form.getAll("files")) if (typeof f !== "string") files.push({ name: f.name || "file", bytes: Buffer.from(await f.arrayBuffer()) });
  return { text: String(form.get("text") ?? "").slice(0, 10_000), advisor: String(form.get("advisor") ?? "") || null, files };
}

/** A knowledge note as JSON, or a file whose text is read here (Office, CSV, text; the browser sends a PDF's text as a note). */
async function knowledgeBody(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) return readJson(req, z.record(z.string(), z.unknown()));
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ATTACH_BYTES + 256 * 1024) throw new ApiError("payload_too_large", "Files for the knowledge base are limited to 4 MB");
  const form = await req.formData().catch(() => {
    throw new ApiError("bad_request", "Couldn't read the upload");
  });
  const f = form.get("file");
  if (!f || typeof f === "string") throw new ApiError("validation_failed", "Choose a file", { file: ["Required"] });
  const name = f.name || "file";
  const { fileText } = await import("@/server/copilot/attachments");
  return { title: String(form.get("title") ?? "") || name.replace(/\.[^.]+$/, ""), body: fileText({ name, bytes: Buffer.from(await f.arrayBuffer()) }), source: name };
}

export const maxDuration = 300;

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return status(s);
    case "GET briefing":
      return (await import("@/server/copilot/briefing")).briefing(s);
    case "GET threads":
      return { threads: await threads(s) };
    case "POST threads": {
      await rateLimit(`copilot:${s.userId}`, 60, 3_600_000);
      const v = await question(ctx.req);
      return ask(s, null, v.text, v);
    }
    case "GET threads :id":
      return thread(s, id!);
    case "POST threads :id messages": {
      await rateLimit(`copilot:${s.userId}`, 60, 3_600_000);
      const v = await question(ctx.req);
      return ask(s, id!, v.text, v);
    }
    case "DELETE threads :id":
      await deleteThread(s, id!);
      return { ok: true };
    case "POST actions :id confirm": {
      // The person may have edited the suggestion (an email draft) before confirming.
      const v = await readJson(ctx.req, z.object({ input: z.record(z.string(), z.unknown()).optional() }).default({})).catch(() => ({ input: undefined }));
      return confirm(ctx, s, id!, v.input);
    }
    case "POST actions :id dismiss":
      await dismiss(s, id!);
      return { ok: true };
    case "GET checks":
      return checks(s);
    case "GET activity":
      return activity(s);
    // Email waiting for a reply, answered from AI mode.
    case "GET inbox":
      return (await import("@/server/copilot/inbox")).inbox(s);
    case "POST inbox :id draft":
      await rateLimit(`copilot:${s.userId}`, 60, 3_600_000);
      return (await import("@/server/copilot/inbox")).draft(s, id!, await readJson(ctx.req, z.record(z.string(), z.unknown())).catch(() => ({})));
    case "POST inbox :id reply":
      return (await import("@/server/copilot/inbox")).reply(s, id!, await readJson(ctx.req, z.record(z.string(), z.unknown())));
    case "POST inbox :id settle":
      return (await import("@/server/copilot/inbox")).settle(s, id!, await readJson(ctx.req, z.record(z.string(), z.unknown())));
    case "POST sent :id undo":
      return (await import("@/server/copilot/inbox")).undo(s, id!);
    // What the AI knows: the business's notes and files, and what it learned from this person.
    case "GET knowledge":
      return (await import("@/server/copilot/knowledge")).list(s);
    case "POST knowledge": {
      const k = await import("@/server/copilot/knowledge");
      return k.add(s, await knowledgeBody(ctx.req), (ctx.req.headers.get("content-type") ?? "").startsWith("multipart/form-data") ? "file" : "note");
    }
    case "PATCH knowledge :id":
      return (await import("@/server/copilot/knowledge")).edit(s, id!, await readJson(ctx.req, z.record(z.string(), z.unknown())));
    case "DELETE knowledge :id":
      return (await import("@/server/copilot/knowledge")).remove(s, id!);
    case "POST memories":
      return { id: await (await import("@/server/copilot/knowledge")).remember(s, await readJson(ctx.req, z.record(z.string(), z.unknown()))) };
    case "GET search":
      return { results: await search(s, new URL(ctx.req.url).searchParams.get("q")?.slice(0, 100) ?? "") };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
