import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/server/http/errors";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { launch, launchSchema, type LaunchEvent } from "@/server/launch/launch";
import { log } from "@/server/log";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string };

/** Streams launch progress as newline-delimited JSON so the UI shows each real step. */
export const POST = route<P>(async (ctx, { orgId }) => {
  const { role } = await requireOrg(ctx, orgId, "project:create");
  const input = await readJson(ctx.req, launchSchema);
  if (input.kind === "store" && !["owner", "admin", "developer", "designer", "editor"].includes(role)) throw new ApiError("forbidden", "Your role can't create a store");
  await rateLimit(`launch:${ctx.user.id}`, 10, 3600_000);
  const [org] = await db.select({ id: schema.organizations.id, slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: LaunchEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await launch(org, { id: ctx.user.id, email: ctx.user.email }, input, emit);
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "Something went wrong while launching. Nothing was published.";
        if (!(e instanceof ApiError)) log.error("launch_failed", { orgId, error: (e as Error).message });
        emit({ step: "error", message });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
