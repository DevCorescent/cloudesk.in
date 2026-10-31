// Assets & maintenance API for a workspace. Dispatches on
// "METHOD section :id sub", like the Manufacturing and Quality APIs.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { saveSettings, scope, team } from "@/server/maintenance/access";
import { addReading, assetDetail, cancelOrder, completeOrder, contracts, createOrder, deleteContract, deletePlan, fromFixedAssets, home, issueParts, listAssets, listOrders, logLabour, orderDetail, plans, raiseDue, reports, saveAsset, saveContract, savePlan, setExternal, stepOrder, tickItem, updateOrder } from "@/server/maintenance/core";
import { importAssets } from "@/server/maintenance/import";

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
      const stock = s.has("inventory");
      return {
        me: { id: s.userId, write: s.write, manage: s.manage },
        settings: s.settings,
        people: await team(orgId),
        items: stock ? await db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), eq(schema.invItems.active, true))).orderBy(asc(schema.invItems.name)) : [],
        warehouses: stock ? await db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)).orderBy(asc(schema.invWarehouses.name)) : [],
        links: { inventory: stock, accounting: s.has("accounting") },
      };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "GET reports":
      return reports(s, qs);

    case "GET assets":
      return { assets: await listAssets(s, qs) };
    case "POST assets":
      return { asset: await saveAsset(s, null, await body(ctx)) };
    case "POST assets import":
      return importAssets(s, await body(ctx));
    case "POST assets from-fixed":
      return fromFixedAssets(s);
    case "GET assets :id":
      return assetDetail(s, id!);
    case "PUT assets :id":
      return { asset: await saveAsset(s, id!, await body(ctx)) };
    case "POST assets :id readings":
      return addReading(s, id!, await body(ctx));

    case "GET plans":
      return { plans: await plans(s) };
    case "POST plans":
      return { plan: await savePlan(s, null, await body(ctx)) };
    case "POST plans raise":
      return { raised: await raiseDue(s) };
    case "PUT plans :id":
      return { plan: await savePlan(s, id!, await body(ctx)) };
    case "DELETE plans :id":
      await deletePlan(s, id!);
      return { ok: true };

    case "GET orders":
      return { orders: await listOrders(s, qs) };
    case "POST orders":
      return { order: await createOrder(s, await body(ctx)) };
    case "GET orders :id":
      return orderDetail(s, id!);
    case "PUT orders :id":
      return { order: await updateOrder(s, id!, await body(ctx)) };
    case "POST orders :id step":
      return { order: await stepOrder(s, id!, await body(ctx)) };
    case "POST orders :id tick":
      return tickItem(s, id!, await body(ctx));
    case "POST orders :id labour":
      return logLabour(s, id!, await body(ctx));
    case "POST orders :id parts":
      return issueParts(s, id!, await body(ctx));
    case "POST orders :id external":
      return setExternal(s, id!, await body(ctx));
    case "POST orders :id complete":
      return { order: await completeOrder(s, id!, await body(ctx)) };
    case "POST orders :id cancel":
      await cancelOrder(s, id!);
      return { ok: true };

    case "GET contracts":
      return { contracts: await contracts(s) };
    case "POST contracts":
      return { contract: await saveContract(s, null, await body(ctx)) };
    case "PUT contracts :id":
      return { contract: await saveContract(s, id!, await body(ctx)) };
    case "DELETE contracts :id":
      await deleteContract(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
