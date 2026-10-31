import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PRESETS, presetInput } from "@/lib/promotions/model";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { deletePromotion, freeDeliveryThreshold, listPromotions, savePromotion } from "@/server/promotions/service";
import { audit } from "@/server/services/audit";

type P = { projectId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [id, action] = slug;
  if (id && !z.uuid().safeParse(id).success) throw notFound("Promotion");
  const key = `${ctx.req.method} ${[id && ":id", action].filter(Boolean).join(" ")}`.trim();
  switch (key) {
    case "GET": {
      await requireProject(ctx, projectId, "project:read");
      const [store] = await db.select({ currency: schema.stores.currency }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
      const discounts = store ? await db.select({ code: schema.storeDiscounts.code, active: schema.storeDiscounts.active }).from(schema.storeDiscounts).where(eq(schema.storeDiscounts.projectId, projectId)) : [];
      const [live] = await db.select({ id: schema.projects.productionDeploymentId }).from(schema.projects).where(eq(schema.projects.id, projectId));
      return { promotions: await listPromotions(projectId), store: store ? { currency: store.currency, freeOver: await freeDeliveryThreshold(projectId), discounts } : null, published: !!live?.id };
    }
    case "POST": {
      const { project } = await requireProject(ctx, projectId, "project:update");
      const body = await readJson(ctx.req, z.union([z.object({ preset: z.string().max(40) }), z.record(z.string(), z.unknown())]));
      const preset = "preset" in body && typeof body.preset === "string" ? PRESETS.find((p) => p.id === body.preset) : null;
      if ("preset" in body && !preset) throw notFound("Preset");
      const promotion = await savePromotion(projectId, preset ? presetInput(preset) : body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "promotion.created", targetType: "promotion", targetId: promotion.id, metadata: { kind: promotion.kind } });
      return Response.json({ promotion }, { status: 201 });
    }
    case "PUT :id": {
      const { project } = await requireProject(ctx, projectId, "project:update");
      const promotion = await savePromotion(projectId, await readJson(ctx.req, z.record(z.string(), z.unknown())), id);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "promotion.updated", targetType: "promotion", targetId: id, metadata: { enabled: promotion.enabled } });
      return { promotion };
    }
    case "POST :id duplicate": {
      await requireProject(ctx, projectId, "project:update");
      const [row] = await db.select().from(schema.promotions).where(and(eq(schema.promotions.id, id), eq(schema.promotions.projectId, projectId)));
      if (!row) throw notFound("Promotion");
      const promotion = await savePromotion(projectId, { kind: row.kind, name: `${row.name} (copy)`.slice(0, 80), enabled: false, config: row.config, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null });
      return Response.json({ promotion }, { status: 201 });
    }
    case "DELETE :id": {
      const { project } = await requireProject(ctx, projectId, "project:update");
      await deletePromotion(projectId, id);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "promotion.deleted", targetType: "promotion", targetId: id });
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
