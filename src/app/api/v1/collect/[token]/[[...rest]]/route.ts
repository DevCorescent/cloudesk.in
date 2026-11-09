// A client's requisition, by its signed link: see what's needed, upload
// files item by item, leave a note. No sign-in; rate limited per address.
import { z } from "zod";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { MAX_FILE, publicNote, publicUpload, publicView } from "@/server/requisitions/core";
import { rateLimit } from "@/server/security/rate-limit";

type P = { token: string; rest?: string[] };

async function handle(ctx: RequestContext, { token, rest = [] }: P) {
  await rateLimit(`collect:${ctx.ip}`, 120, 60_000);
  switch (`${ctx.req.method} ${rest.join("/")}`) {
    case "GET ":
      return publicView(token);
    case "POST upload": {
      await rateLimit(`collect-up:${ctx.ip}`, 60, 3_600_000);
      if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_FILE + 64 * 1024) throw new ApiError("payload_too_large", "Files can be up to 25 MB each");
      const form = await ctx.req.formData().catch(() => {
        throw new ApiError("bad_request", "Couldn't read the upload");
      });
      const f = form.get("file");
      if (!f || typeof f === "string") throw new ApiError("validation_failed", "Choose a file");
      const itemId = String(form.get("itemId") ?? "") || null;
      return publicUpload(token, { itemId, name: f.name || "file", bytes: Buffer.from(await f.arrayBuffer()) });
    }
    case "POST note":
      await rateLimit(`collect-note:${ctx.ip}`, 20, 3_600_000);
      return publicNote(token, await readJson(ctx.req, z.record(z.string(), z.unknown())));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle, { auth: false });
export const POST = route<P>(handle, { auth: false });
