// Sales API for a workspace. Dispatches on "METHOD section :id sub", like the
// Inventory and Projects APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { ensureSettings, partOn, people, saveSettings, scope } from "@/server/sales/access";
import { cancelDelivery, deliver, deliveries, invoiceOrder, markDelivered, recordReturn, salesReturns } from "@/server/sales/fulfil";
import { importCustomers, importPrices } from "@/server/sales/import";
import { approveOrder, cancelOrder, closeOrder, confirmOrder, deleteOrder, fromDeal, listOrders, orderDetail, saveOrder } from "@/server/sales/orders";
import { customers, deletePriceList, priceListDetail, priceLists, quote, saveCustomer, savePriceList, setPrice } from "@/server/sales/pricing";
import { commissions, deletePlan, home, plans, savePlan, setTarget, targets } from "@/server/sales/reports";
import { invoiceBooks } from "@/server/org/org";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  // Ids become ":id"; words stay as they are ("customers import").
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta": {
      // Workspaces that had Sales before onboarding set it up get their default price list here.
      await ensureSettings(orgId);
      const items = s.has("inventory") ? await db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit, hsn: schema.invItems.hsn, gstRate: schema.invItems.gstRate, trackSerials: schema.invItems.trackSerials }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), eq(schema.invItems.active, true))) : [];
      const warehouses = s.has("inventory") ? await db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name, isDefault: schema.invWarehouses.isDefault }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.active, true))) : [];
      return {
        me: { id: s.userId, write: s.write, manage: s.manage },
        settings: s.settings,
        people: await people(orgId),
        books: await invoiceBooks(orgId),
        items,
        warehouses,
        lists: (await priceLists(orgId)).map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault, kind: l.kind })),
        parts: { pricing: partOn(s, "pricing"), delivery: partOn(s, "delivery") && s.has("inventory"), commissions: partOn(s, "commissions") },
        links: { inventory: s.has("inventory"), crm: s.has("crm") },
      };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "POST quote":
      return quote(s, await body(ctx));
    case "GET deals :id":
      return fromDeal(s, id!);

    case "GET orders":
      return { orders: await listOrders(s, qs) };
    case "POST orders":
      return { order: await saveOrder(s, null, await body(ctx)) };
    case "GET orders :id":
      return orderDetail(s, id!);
    case "PUT orders :id":
      return { order: await saveOrder(s, id!, await body(ctx)) };
    case "DELETE orders :id":
      await deleteOrder(s, id!);
      return { ok: true };
    case "POST orders :id confirm":
      return confirmOrder(s, id!);
    case "POST orders :id approve":
      return { order: await approveOrder(s, id!, (await body(ctx)).approve !== false) };
    case "POST orders :id cancel":
      await cancelOrder(s, id!);
      return { ok: true };
    case "POST orders :id close":
      await closeOrder(s, id!);
      return { ok: true };
    case "POST orders :id invoice":
      return invoiceOrder(s, id!);

    case "GET deliveries":
      return { deliveries: await deliveries(s) };
    case "POST deliveries":
      return { delivery: await deliver(s, await body(ctx)) };
    case "POST deliveries :id delivered":
      return { delivery: await markDelivered(s, id!, String((await body(ctx)).receivedBy ?? "")) };
    case "POST deliveries :id cancel":
      await cancelDelivery(s, id!);
      return { ok: true };
    case "GET returns":
      return { returns: await salesReturns(s) };
    case "POST returns":
      return recordReturn(s, await body(ctx));

    case "GET price-lists":
      return { lists: await priceLists(orgId) };
    case "POST price-lists":
      return { list: await savePriceList(s, null, await body(ctx)) };
    case "GET price-lists :id":
      return priceListDetail(s, id!);
    case "PUT price-lists :id":
      return { list: await savePriceList(s, id!, await body(ctx)) };
    case "DELETE price-lists :id":
      await deletePriceList(s, id!);
      return { ok: true };
    case "POST price-lists :id prices":
      return { price: await setPrice(s, id!, await body(ctx)) };
    case "POST price-lists :id import":
      await rateLimit(`sales-import:${ctx.user.id}`, 60, 3600_000);
      return importPrices(s, id!, await readJson(ctx.req, z.unknown()));
    case "GET customers":
      return { customers: await customers(s) };
    case "POST customers":
      return { terms: await saveCustomer(s, await body(ctx)) };
    case "POST customers import":
      await rateLimit(`sales-import:${ctx.user.id}`, 60, 3600_000);
      return importCustomers(s, await readJson(ctx.req, z.unknown()));

    case "GET commissions":
      return commissions(s, qs);
    case "GET plans":
      return { plans: await plans(s) };
    case "POST plans":
      return { plan: await savePlan(s, null, await body(ctx)) };
    case "PUT plans :id":
      return { plan: await savePlan(s, id!, await body(ctx)) };
    case "DELETE plans :id":
      await deletePlan(s, id!);
      return { ok: true };
    case "GET targets":
      return { targets: await targets(s, qs.year) };
    case "POST targets":
      return { target: await setTarget(s, await body(ctx)) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
