import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireProject, route } from "@/server/http/handler";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "submissions:read");
  const rows = await db
    .select({ id: schema.formSubmissions.id, formId: schema.formSubmissions.formId, data: schema.formSubmissions.data, createdAt: schema.formSubmissions.createdAt })
    .from(schema.formSubmissions)
    .where(eq(schema.formSubmissions.projectId, projectId))
    .orderBy(desc(schema.formSubmissions.createdAt))
    .limit(200);
  return { submissions: rows };
});
