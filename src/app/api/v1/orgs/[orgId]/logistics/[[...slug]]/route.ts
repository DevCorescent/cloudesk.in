// Logistics & fleet API for a workspace. Dispatches on
// "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { db, schema } from "@/db";
import { and, asc, eq } from "drizzle-orm";
import { saveSettings, scope } from "@/server/logistics/access";
import { addFuel, cancelShipment, cancelTrip, carriers, completeTrip, createShipment, createTrip, deleteFuel, deleteRate, deliver, drivers, estimate, fromDeliveries, fuelLog, home, payFreight, reports, saveCarrier, saveDriver, saveRate, saveVehicle, setStops, shipmentDetail, shipments, startTrip, step, tripDetail, trips, updateShipment, vehicleDetail, vehicles } from "@/server/logistics/core";
import { importFuel, importVehicles } from "@/server/logistics/import";

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
        warehouses: stock ? await db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name, state: schema.invWarehouses.state }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)).orderBy(asc(schema.invWarehouses.name)) : [],
        links: { sales: s.has("sales"), maintenance: s.has("maintenance"), hr: s.has("hr"), accounting: s.has("accounting") },
      };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "GET reports":
      return reports(s, qs);

    case "GET carriers":
      return { carriers: await carriers(s) };
    case "POST carriers":
      return { carrier: await saveCarrier(s, null, await body(ctx)) };
    case "PUT carriers :id":
      return { carrier: await saveCarrier(s, id!, await body(ctx)) };
    case "POST rates":
      return { rate: await saveRate(s, null, await body(ctx)) };
    case "PUT rates :id":
      return { rate: await saveRate(s, id!, await body(ctx)) };
    case "DELETE rates :id":
      await deleteRate(s, id!);
      return { ok: true };
    case "POST estimate":
      return estimate(s, await body(ctx));

    case "GET shipments":
      return { shipments: await shipments(s, qs) };
    case "GET shipments from":
      return fromDeliveries(s, String(qs.deliveries ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)));
    case "GET challans": {
      // Dispatched challans not yet on a live shipment, to ship.
      const rows = await db.select({ id: schema.salesDeliveries.id, number: schema.salesDeliveries.number, date: schema.salesDeliveries.date, orderNo: schema.salesOrders.number, customer: schema.salesOrders.clientName }).from(schema.salesDeliveries).innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesDeliveries.orderId)).where(and(eq(schema.salesDeliveries.orgId, orgId), eq(schema.salesDeliveries.status, "dispatched"))).orderBy(asc(schema.salesDeliveries.date));
      const onShipments = (await shipments(s, { status: "open" })).flatMap((x) => x.deliveryIds);
      return { challans: rows.filter((r) => !onShipments.includes(r.id)) };
    }
    case "POST shipments":
      return createShipment(s, await body(ctx));
    case "GET shipments :id":
      return shipmentDetail(s, id!);
    case "PUT shipments :id":
      return { shipment: await updateShipment(s, id!, await body(ctx)) };
    case "POST shipments :id step":
      return { shipment: await step(s, id!, await body(ctx)) };
    case "POST shipments :id deliver":
      return { shipment: await deliver(s, id!, await body(ctx)) };
    case "POST shipments :id cancel":
      await cancelShipment(s, id!);
      return { ok: true };
    case "POST shipments :id pay":
      await payFreight(s, id!, await body(ctx));
      return { ok: true };

    case "GET vehicles":
      return { vehicles: await vehicles(s) };
    case "POST vehicles":
      return { vehicle: await saveVehicle(s, null, await body(ctx)) };
    case "POST vehicles import":
      return importVehicles(s, await body(ctx));
    case "GET vehicles :id":
      return vehicleDetail(s, id!);
    case "PUT vehicles :id":
      return { vehicle: await saveVehicle(s, id!, await body(ctx)) };
    case "GET drivers":
      return { drivers: await drivers(s) };
    case "POST drivers":
      return { driver: await saveDriver(s, null, await body(ctx)) };
    case "PUT drivers :id":
      return { driver: await saveDriver(s, id!, await body(ctx)) };

    case "GET fuel":
      return { fuel: await fuelLog(s, qs) };
    case "POST fuel":
      return { fill: await addFuel(s, await body(ctx)) };
    case "POST fuel import":
      return importFuel(s, await body(ctx));
    case "DELETE fuel :id":
      await deleteFuel(s, id!);
      return { ok: true };

    case "GET trips":
      return { trips: await trips(s, qs) };
    case "POST trips":
      return { trip: await createTrip(s, await body(ctx)) };
    case "GET trips :id":
      return tripDetail(s, id!);
    case "PUT trips :id stops":
      return setStops(s, id!, await body(ctx));
    case "POST trips :id start":
      return { trip: await startTrip(s, id!, await body(ctx)) };
    case "POST trips :id complete":
      return completeTrip(s, id!, await body(ctx));
    case "POST trips :id cancel":
      await cancelTrip(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
