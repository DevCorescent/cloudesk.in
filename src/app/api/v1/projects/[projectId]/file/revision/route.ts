import { ApiError } from "@/server/http/errors";
import { requireProject, route } from "@/server/http/handler";
import { readRevision } from "@/server/services/files";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const sp = new URL(ctx.req.url).searchParams;
  const path = sp.get("path");
  const revision = Number(sp.get("revision"));
  if (!path || !Number.isInteger(revision)) throw new ApiError("bad_request", "path and revision are required");
  const r = await readRevision(projectId, path, revision);
  return { path: r.path, revision: r.revision, content: r.content, createdAt: r.createdAt };
});
