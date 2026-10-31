import { z } from "zod";
import { readJson, requireProject, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { importBrandFromUrl } from "@/server/services/brand-import";

export const POST = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "design:write");
  await rateLimit(`brand-import:${ctx.user.id}`, 20, 3600_000);
  const { url } = await readJson(ctx.req, z.object({ url: z.string().trim().min(3).max(500) }));
  return { brand: await importBrandFromUrl(url) };
});
