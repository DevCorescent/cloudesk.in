import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { businessKit } from "@/lib/site/business-kit";
import { projectSpecSchema } from "@/lib/site/spec";
import { can } from "@/server/authz/permissions";
import { listServices, saveService } from "@/server/bookings/bookings";
import { setupStore } from "@/server/commerce/settings";
import { ApiError } from "@/server/http/errors";
import { readJson, requireProject, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";
import { createFile, listFiles } from "@/server/services/files";

type P = { projectId: string };

async function kitFor(projectId: string) {
  const [p] = await db.select({ spec: schema.projects.spec, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const spec = projectSpecSchema.safeParse(p?.spec);
  if (!spec.success) throw new ApiError("conflict", "This project has no plan to build a business kit from");
  return businessKit(spec.data);
}

export const GET = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "project:read");
  const kit = await kitFor(projectId);
  const [store] = await db.select({ id: schema.stores.projectId }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const files = new Set((await listFiles(projectId)).map((f) => f.path));
  return { kit, has: { store: !!store, services: (await listServices(projectId)).length, files: kit.files.filter((f) => files.has(f.path)).map((f) => f.path) } };
});

/** Creates the chosen parts. Nothing is published and nothing existing is overwritten. */
export const POST = route<P>(async (ctx, { projectId }) => {
  const { project, role } = await requireProject(ctx, projectId, "project:update");
  const body = await readJson(ctx.req, z.object({ store: z.boolean(), bookings: z.boolean(), marketing: z.boolean() }));
  if ((body.store || body.bookings) && !can(role, "store:manage")) throw new ApiError("forbidden", "You need store access to set up a store or bookings");
  const kit = await kitFor(projectId);
  const done: string[] = [];
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if ((body.store || body.bookings) && !store) {
    await setupStore(projectId, { name: project.name });
    done.push("store");
  }
  if (body.bookings && !(await listServices(projectId)).length) {
    // Prices are the owner's call: services start hidden until they set them.
    for (const [i, s] of kit.bookings.services.entries()) await saveService(projectId, { ...s, price: 0, payment: "none", bufferMin: 0, active: false, sort: i });
    done.push("bookings");
  }
  if (body.marketing) {
    const existing = new Set((await listFiles(projectId)).map((f) => f.path));
    const missing = kit.files.filter((x) => !existing.has(x.path));
    for (const f of missing) await createFile(projectId, f.path, f.content, { userId: ctx.user.id, source: "system", message: "Business kit" });
    if (missing.length) done.push("marketing");
  }
  await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "project.business_kit", targetType: "project", targetId: projectId, metadata: { done } });
  return { done };
});
