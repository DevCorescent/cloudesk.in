// Drive QR, for anyone who scans it (no sign-in): what the folder accepts, and
// uploading into it. The token in the path is the QR's signed link.
import { MAX_FILE_BYTES } from "@/lib/documents/model";
import { dropUpload, dropView } from "@/server/documents/drop";
import { ApiError } from "@/server/http/errors";
import { route, type RequestContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type P = { token: string };

export const GET = route<P>(
  async (ctx: RequestContext, { token }: P) => {
    await rateLimit(`drop-view:${ctx.ip}`, 120, 60 * 60_000);
    return dropView(token);
  },
  { auth: false },
);

export const POST = route<P>(
  async (ctx: RequestContext, { token }: P) => {
    // A phone uploading a few photos is fine; a flood isn't.
    await rateLimit(`drop:${ctx.ip}`, 40, 60 * 60_000);
    await rateLimit(`drop-link:${token.slice(0, 32)}`, 400, 60 * 60_000);
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
      throw new ApiError("validation_failed", "The details aren't valid JSON");
    }
    return dropUpload(token, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, meta, { ip: ctx.ip ?? null, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
