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
    case "GET search":
      return { results: await search(s, new URL(ctx.req.url).searchParams.get("q")?.slice(0, 100) ?? "") };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const DELETE = route<P>(handle);
