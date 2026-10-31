// Sets up one module for a workspace — what onboarding runs for each pick.
//   POST /orgs/:orgId/modules/setup  { module }
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MODULE_IDS, SETUP_LABEL, type ModuleId } from "@/lib/workspace/modules";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { setupModule } from "@/server/workspace/setup";

type P = { orgId: string };

export const POST = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:update");
  const { module } = await readJson(ctx.req, z.object({ module: z.enum(MODULE_IDS as [ModuleId, ...ModuleId[]]) }));
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const done = await setupModule(module, { orgId, userId: ctx.user.id, businessName: org?.name ?? "My business" });
  return { module, label: SETUP_LABEL[module], done };
});
