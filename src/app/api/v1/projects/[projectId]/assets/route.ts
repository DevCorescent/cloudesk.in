import { ApiError } from "@/server/http/errors";
import { requireProject, route } from "@/server/http/handler";
import { listAssets, MAX_ASSET_BYTES, uploadAsset } from "@/server/media/assets";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  return { assets: await listAssets(projectId) };
});

// multipart/form-data with a single "file" field.
export const POST = route<P>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "design:write");
  await rateLimit(`upload:${ctx.user.id}`, 60, 3600_000);
  if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_ASSET_BYTES + 64 * 1024) throw new ApiError("payload_too_large", "Images are limited to 5 MB");
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new ApiError("bad_request", "Send the image as multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError("validation_failed", "Choose an image to upload", { file: ["Required"] });
  const bytes = Buffer.from(await file.arrayBuffer());
  const asset = await uploadAsset(project, ctx.user.id, { name: file.name, bytes });
  return Response.json({ asset }, { status: asset.duplicate ? 200 : 201 });
});
