import { and, eq, ilike } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/server/http/errors";
import { requireProject, route } from "@/server/http/handler";

// Plain-text search across project files (case-insensitive), bounded results.
export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const q = new URL(ctx.req.url).searchParams.get("q") ?? "";
  if (q.length < 2 || q.length > 200) throw new ApiError("bad_request", "Search for 2–200 characters");
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const files = await db
    .select({ path: schema.projectFiles.path, content: schema.projectFiles.content })
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), ilike(schema.projectFiles.content, `%${escaped}%`)))
    .limit(100);
  const needle = q.toLowerCase();
  let total = 0;
  const results = files.map((f) => {
    const matches: { line: number; text: string }[] = [];
    f.content.split("\n").forEach((text, i) => {
      if (total < 500 && text.toLowerCase().includes(needle)) {
        matches.push({ line: i + 1, text: text.slice(0, 240) });
        total++;
      }
    });
    return { path: f.path, matches };
  });
  return { results: results.filter((r) => r.matches.length), truncated: total >= 500 };
});
