import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireProject, route } from "@/server/http/handler";
import { projectSetup } from "@/server/services/setup";

export const GET = route<{ projectId: string }>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "project:read");
  // The checklist follows what this person said they need during onboarding.
  const [u] = await db.select({ onboarding: schema.users.onboarding }).from(schema.users).where(eq(schema.users.id, ctx.user.id));
  const o = (u?.onboarding ?? {}) as { goals?: string[]; sells?: string };
  const goals = [...(o.goals ?? []), ...(o.sells === "shop" || o.sells === "both" ? ["pos"] : [])];
  const kind = (project.spec as { kind?: string } | null)?.kind;
  return projectSetup({ ...project, kind }, goals);
});
