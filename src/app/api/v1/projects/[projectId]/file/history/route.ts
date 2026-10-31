import { ApiError } from "@/server/http/errors";
import { requireProject, route } from "@/server/http/handler";
import { fileHistory } from "@/server/services/files";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const path = new URL(ctx.req.url).searchParams.get("path");
  if (!path) throw new ApiError("bad_request", "path is required");
  return { revisions: await fileHistory(projectId, path) };
});
