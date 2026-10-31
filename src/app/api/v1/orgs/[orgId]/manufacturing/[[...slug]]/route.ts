// Manufacturing API for a workspace. Dispatches on "METHOD section :id sub".
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { ensureSettings, partOn, saveSettings, scope } from "@/server/manufacturing/access";
import { importBoms } from "@/server/manufacturing/import";
import { buyFromMrp, capacity, home, makeFromMrp, runMrp } from "@/server/manufacturing/planning";
import { bomDetail, boms, cancelWorkOrder, completeWorkOrder, deleteBom, issueMaterials, logTime, releaseWorkOrder, saveBom, saveWorkCentre, saveWorkOrder, workCentres, workOrderDetail, workOrders } from "@/server/manufacturing/production";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta": {
      await ensureSettings(orgId);
      const [items, warehouses] = await Promise.all([
        db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit, avgCost: schema.invItems.avgCost, trackBatches: schema.invItems.trackBatches }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), eq(schema.invItems.active, true))),
        db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name, isDefault: schema.invWarehouses.isDefault }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.active, true))),
      ]);
      return { me: { write: s.write, manage: s.manage }, settings: s.settings, items, warehouses, centres: await workCentres(orgId), parts: { routing: partOn(s, "routing"), mrp: partOn(s, "mrp") } };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);

    case "GET work-centres":
      return { centres: await workCentres(orgId) };
    case "POST work-centres":
      return { centre: await saveWorkCentre(s, null, await body(ctx)) };
    case "PUT work-centres :id":
      return { centre: await saveWorkCentre(s, id!, await body(ctx)) };
    case "GET capacity":
      return capacity(s, Math.min(90, Math.max(1, Number(qs.days) || 14)));

    case "GET boms":
      return { boms: await boms(s) };
    case "POST boms":
      return { bom: await saveBom(s, null, await body(ctx)) };
    case "POST boms import":
      await rateLimit(`mfg-import:${ctx.user.id}`, 60, 3600_000);
      return importBoms(s, await readJson(ctx.req, z.unknown()));
    case "GET boms :id":
      return bomDetail(s, id!);
    case "PUT boms :id":
      return { bom: await saveBom(s, id!, await body(ctx)) };
    case "DELETE boms :id":
      await deleteBom(s, id!);
      return { ok: true };

    case "GET work-orders":
      return { orders: await workOrders(s, qs) };
    case "POST work-orders":
      return { order: await saveWorkOrder(s, null, await body(ctx)) };
    case "GET work-orders :id":
      return workOrderDetail(s, id!);
    case "PUT work-orders :id":
      return { order: await saveWorkOrder(s, id!, await body(ctx)) };
    case "POST work-orders :id release":
      return { order: await releaseWorkOrder(s, id!) };
    case "POST work-orders :id issue":
      return { order: await issueMaterials(s, id!, await body(ctx)) };
    case "POST work-orders :id time":
      return { order: await logTime(s, id!, await body(ctx)) };
    case "POST work-orders :id complete":
      return { order: await completeWorkOrder(s, id!, await body(ctx)) };
    case "POST work-orders :id cancel":
      return { order: await cancelWorkOrder(s, id!) };

    case "GET mrp":
      return runMrp(s);
    case "POST mrp make":
      return makeFromMrp(s, await body(ctx));
    case "POST mrp buy":
      return buyFromMrp(s, await body(ctx));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
