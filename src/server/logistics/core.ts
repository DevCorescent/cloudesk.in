// Logistics & fleet: carriers and rate cards, shipments made from Sales
// delivery challans (by a carrier, or on a trip in your own vehicle) with a
// status trail, proof of delivery (which marks the challans delivered) and a
// public tracking page; trips with stops, odometer readings (fed to the
// vehicle's servicing in Assets & maintenance) and costs; vehicles with their
// papers, drivers, the fuel log; reports; and the journals for fuel, trip
// costs and freight paid.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { PostLine } from "@/lib/accounting/model";
import { OPEN_SHIP, SHIP_STATUSES, SHIP_STATUS_LABEL, carrierSchema, driverSchema, expiring, freightEstimate, fuelSchema, load, mileage, onTime, rateSchema, shipmentSchema, stateCodeOf, trackingLink, tripSchema, vehicleSchema } from "@/lib/logistics/model";
import { ApiError, notFound } from "../http/errors";
import { meterFromElsewhere } from "../maintenance/core";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requirePart, requireWrite, todayIst, type Scope } from "./access";
import { emit } from "../hub/core";
import { contains } from "../security/like";

type Shipment = typeof schema.lgxShipments.$inferSelect;
type Vehicle = typeof schema.lgxVehicles.$inferSelect;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const istDay = (d: Date | string) => new Date(new Date(d).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

async function cashAccount(orgId: string, id: string | null) {
  if (!id) return null;
  const [a] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.id, id)));
  if (!a || !["bank", "cash"].includes(a.subtype)) throw new ApiError("validation_failed", "Pay from a bank or cash account", { paidFromId: ["Bank or cash"] });
  return a;
}

// ── Carriers & rates ────────────────────────────────────────────────────────

export async function carriers(s: Scope) {
  const [rows, rates] = await Promise.all([
    db.select().from(schema.lgxCarriers).where(eq(schema.lgxCarriers.orgId, s.orgId)).orderBy(asc(schema.lgxCarriers.name)),
    db.select().from(schema.lgxRates).where(eq(schema.lgxRates.orgId, s.orgId)),
  ]);
  return rows.map((c) => ({ ...c, rates: rates.filter((r) => r.carrierId === c.id) }));
}

export async function saveCarrier(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(carrierSchema, raw);
  if (v.supplierId) {
    const [sup] = await db.select({ id: schema.invSuppliers.id }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.id, v.supplierId), eq(schema.invSuppliers.orgId, s.orgId)));
    if (!sup) throw new ApiError("validation_failed", "That supplier isn't in this workspace", { supplierId: ["Unknown supplier"] });
  }
  if (id) {
    if (!isId(id)) throw notFound("Carrier");
    const [row] = await db.update(schema.lgxCarriers).set(v).where(and(eq(schema.lgxCarriers.id, id), eq(schema.lgxCarriers.orgId, s.orgId))).returning();
    if (!row) throw notFound("Carrier");
    return row;
  }
  const [row] = await db.insert(schema.lgxCarriers).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

export async function saveRate(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const raw0 = check(rateSchema, raw);
  if (raw0.fromState && !stateCodeOf(raw0.fromState)) throw new ApiError("validation_failed", "Use a state's name or two-letter code, like MH", { fromState: ["Unknown state"] });
  if (raw0.toState && !stateCodeOf(raw0.toState)) throw new ApiError("validation_failed", "Use a state's name or two-letter code, like KA", { toState: ["Unknown state"] });
  const v = { ...raw0, fromState: stateCodeOf(raw0.fromState), toState: stateCodeOf(raw0.toState) };
  const [c] = await db.select({ id: schema.lgxCarriers.id }).from(schema.lgxCarriers).where(and(eq(schema.lgxCarriers.id, v.carrierId), eq(schema.lgxCarriers.orgId, s.orgId)));
  if (!c) throw notFound("Carrier");
  if (id) {
    if (!isId(id)) throw notFound("Rate");
    const [row] = await db.update(schema.lgxRates).set(v).where(and(eq(schema.lgxRates.id, id), eq(schema.lgxRates.orgId, s.orgId))).returning();
    if (!row) throw notFound("Rate");
    return row;
  }
  const [row] = await db.insert(schema.lgxRates).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

export async function deleteRate(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Rate");
  await db.delete(schema.lgxRates).where(and(eq(schema.lgxRates.id, id), eq(schema.lgxRates.orgId, s.orgId)));
}

async function warehouseState(orgId: string, warehouseId: string | null) {
  if (!warehouseId) return "";
  const [w] = await db.select({ state: schema.invWarehouses.state }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.id, warehouseId), eq(schema.invWarehouses.orgId, orgId)));
  return stateCodeOf(w?.state ?? "");
}

/** Freight for a consignment from the carrier's rate card. */
export async function estimate(s: Scope, raw: unknown) {
  const v = check(z.object({ carrierId: z.uuid(), warehouseId: z.uuid().nullable().default(null), state: z.string().max(80).default(""), weightKg: z.number().min(0).max(100000), packages: z.number().int().min(1).max(10000).default(1), dims: z.object({ l: z.number(), w: z.number(), h: z.number() }).nullable().default(null) }), raw);
  const rates = await db.select().from(schema.lgxRates).where(and(eq(schema.lgxRates.orgId, s.orgId), eq(schema.lgxRates.carrierId, v.carrierId)));
  return { estimate: freightEstimate(rates, { carrierId: v.carrierId, fromState: await warehouseState(s.orgId, v.warehouseId), toState: stateCodeOf(v.state), weightKg: v.weightKg, dims: v.dims, packages: v.packages }) };
}

// ── Shipments ───────────────────────────────────────────────────────────────

async function getShipment(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Shipment");
  const [x] = await db.select().from(schema.lgxShipments).where(and(eq(schema.lgxShipments.id, id), eq(schema.lgxShipments.orgId, orgId)));
  if (!x) throw notFound("Shipment");
  return x;
}

export async function shipments(s: Scope, q: { status?: string; carrierId?: string; q?: string; tripless?: string } = {}) {
  const where = [eq(schema.lgxShipments.orgId, s.orgId)];
  if (q.status === "open") where.push(inArray(schema.lgxShipments.status, OPEN_SHIP));
  else if (q.status && q.status !== "all") where.push(eq(schema.lgxShipments.status, q.status));
  if (q.carrierId && isId(q.carrierId)) where.push(eq(schema.lgxShipments.carrierId, q.carrierId));
  if (q.tripless === "1") where.push(and(eq(schema.lgxShipments.mode, "own"), sql`${schema.lgxShipments.tripId} is null`)!);
  if (q.q) where.push(sql`(${schema.lgxShipments.number} ilike ${contains(q.q)} or ${schema.lgxShipments.consignee} ilike ${contains(q.q)} or ${schema.lgxShipments.trackingNo} ilike ${contains(q.q)} or ${schema.lgxShipments.lrNo} ilike ${contains(q.q)})`);
  const rows = await db.select({ x: schema.lgxShipments, carrier: schema.lgxCarriers.name, trackingUrl: schema.lgxCarriers.trackingUrl }).from(schema.lgxShipments).leftJoin(schema.lgxCarriers, eq(schema.lgxCarriers.id, schema.lgxShipments.carrierId)).where(and(...where)).orderBy(desc(schema.lgxShipments.createdAt)).limit(1000);
  const today = todayIst();
  return rows.map(({ x, carrier, trackingUrl }) => ({ ...shape(s, x), carrier, carrierLink: trackingLink(trackingUrl ?? "", x.trackingNo), late: OPEN_SHIP.includes(x.status) && !!x.promisedOn && String(x.promisedOn) < today }));
}

const shape = (s: Scope, x: Shipment) => ({ ...x, freightCost: s.write ? x.freightCost : 0, freightBilled: s.write ? x.freightBilled : 0 });

/** What a shipment from some delivery challans starts with: the customer, where it's going, and the location it leaves from. */
export async function fromDeliveries(s: Scope, ids: string[]) {
  if (!ids.length) throw new ApiError("validation_failed", "Pick the challans to ship");
  const ds = await db.select({ d: schema.salesDeliveries, o: schema.salesOrders }).from(schema.salesDeliveries).innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesDeliveries.orderId)).where(and(eq(schema.salesDeliveries.orgId, s.orgId), inArray(schema.salesDeliveries.id, ids)));
  if (ds.length !== new Set(ids).size) throw notFound("Delivery");
  const first = ds[0];
  const [client] = await db.select().from(schema.invoiceClients).where(eq(schema.invoiceClients.id, first.o.clientId));
  type Addr = { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  const addr = ((client?.shipping as Addr | null) ?? (client?.billing as Addr | null) ?? {}) as Addr;
  return {
    consignee: first.o.clientName || client?.company || client?.name || "",
    phone: client?.phone ?? "",
    address: [addr.line1, addr.line2, addr.city, addr.postalCode].filter(Boolean).join(", "),
    state: stateCodeOf(addr.state ?? ""),
    warehouseId: first.d.warehouseId,
    challans: ds.map(({ d, o }) => ({ id: d.id, number: d.number, order: o.number, status: d.status, customer: o.clientName })),
    mixed: new Set(ds.map(({ o }) => o.clientId)).size > 1,
  };
}

async function checkDeliveries(s: Scope, ids: string[], selfId?: string) {
  if (!ids.length) return;
  const ds = await db.select({ id: schema.salesDeliveries.id, status: schema.salesDeliveries.status, number: schema.salesDeliveries.number }).from(schema.salesDeliveries).where(and(eq(schema.salesDeliveries.orgId, s.orgId), inArray(schema.salesDeliveries.id, ids)));
  if (ds.length !== new Set(ids).size) throw new ApiError("validation_failed", "Some of those challans aren't in this workspace", { deliveryIds: ["Unknown challan"] });
  const bad = ds.find((d) => d.status !== "dispatched");
  if (bad) throw new ApiError("conflict", `Challan ${bad.number} is ${bad.status}`);
  const [taken] = await db.select({ number: schema.lgxShipments.number }).from(schema.lgxShipments).where(and(eq(schema.lgxShipments.orgId, s.orgId), inArray(schema.lgxShipments.status, OPEN_SHIP), sql`${schema.lgxShipments.deliveryIds} && ${`{${ids.join(",")}}`}::uuid[]`, selfId ? sql`${schema.lgxShipments.id} <> ${selfId}` : undefined));
  if (taken) throw new ApiError("conflict", `Some of those challans are already on shipment ${taken.number}`);
}

export async function createShipment(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(shipmentSchema, raw);
  if (v.mode === "carrier" && !v.carrierId) throw new ApiError("validation_failed", "Pick the transporter or courier", { carrierId: ["Pick a carrier"] });
  if (v.mode === "own") requirePart(s, "fleet");
  const rates = await checkShipmentRefs(s, v);
  await checkDeliveries(s, v.deliveryIds);
  const state = stateCodeOf(v.state);
  const est = v.carrierId && v.freightCost === null ? freightEstimate(rates, { carrierId: v.carrierId, fromState: await warehouseState(s.orgId, v.warehouseId), toState: state, weightKg: v.weightKg, dims: v.dims, packages: v.packages }) : null;
  const number = await nextNumber(s.orgId, "shipment", s.settings.shipmentPrefix);
  const [row] = await db
    .insert(schema.lgxShipments)
    .values({ ...v, state, orgId: s.orgId, number, freightCost: v.freightCost ?? est?.amount ?? 0, deliveryIds: [...new Set(v.deliveryIds)], promisedOn: v.promisedOn ?? addDays(todayIst(), s.settings.promiseDays), trackToken: randomBytes(15).toString("base64url"), events: [{ at: new Date().toISOString(), status: "planned", note: "Shipment made", by: s.userId }], createdBy: s.userId })
    .returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "logistics.shipment_created", targetType: "lgx_shipment", targetId: row.id, metadata: { number, challans: row.deliveryIds.length } });
  return { shipment: shape(s, row), estimate: est };
}

/** The carrier and location must be this workspace's; returns the carrier's rates. */
async function checkShipmentRefs(s: Scope, v: { carrierId?: string | null; warehouseId?: string | null }) {
  let rates: (typeof schema.lgxRates.$inferSelect)[] = [];
  if (v.carrierId) {
    const [c] = await db.select().from(schema.lgxCarriers).where(and(eq(schema.lgxCarriers.id, v.carrierId), eq(schema.lgxCarriers.orgId, s.orgId)));
    if (!c) throw new ApiError("validation_failed", "That carrier isn't in this workspace", { carrierId: ["Unknown carrier"] });
    rates = await db.select().from(schema.lgxRates).where(eq(schema.lgxRates.carrierId, c.id));
  }
  if (v.warehouseId) {
    const [w] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.id, v.warehouseId), eq(schema.invWarehouses.orgId, s.orgId)));
    if (!w) throw new ApiError("validation_failed", "That location isn't in this workspace", { warehouseId: ["Unknown location"] });
  }
  return rates;
}

export async function updateShipment(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const x = await getShipment(s.orgId, id);
  if (!OPEN_SHIP.includes(x.status)) throw new ApiError("conflict", `This shipment is ${x.status}`);
  const v = check(shipmentSchema, { ...x, freightCost: x.freightCost, ...(raw as object) });
  if (v.mode === "carrier" && !v.carrierId) throw new ApiError("validation_failed", "Pick the transporter or courier", { carrierId: ["Pick a carrier"] });
  await checkShipmentRefs(s, v);
  await checkDeliveries(s, v.deliveryIds, x.id);
  const [row] = await db.update(schema.lgxShipments).set({ ...v, state: stateCodeOf(v.state), freightCost: x.freightPaidFromId ? x.freightCost : (v.freightCost ?? 0), deliveryIds: [...new Set(v.deliveryIds)] }).where(eq(schema.lgxShipments.id, x.id)).returning();
  return shape(s, row);
}

const stepSchema = z.object({ status: z.enum(["picked", "in_transit", "out_for_delivery", "exception", "returned"]), note: z.string().trim().max(300).default("") });

/** Move a shipment along: picked up, in transit, out for delivery, held up, or returned. */
export async function step(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const x = await getShipment(s.orgId, id);
  if (!OPEN_SHIP.includes(x.status)) throw new ApiError("conflict", `This shipment is ${SHIP_STATUS_LABEL[x.status as (typeof SHIP_STATUSES)[number]]?.toLowerCase() ?? x.status}`);
  const v = check(stepSchema, raw);
  if (v.status === "exception" && !v.note) throw new ApiError("validation_failed", "Say what's holding it up", { note: ["Required"] });
  const events = [...x.events, { at: new Date().toISOString(), status: v.status, note: v.note, by: s.userId }];
  const [row] = await db.update(schema.lgxShipments).set({ status: v.status, events }).where(eq(schema.lgxShipments.id, x.id)).returning();
  return shape(s, row);
}

/** Delivered, with who received it: the challans it carried are marked delivered in Sales. */
export async function deliver(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const x = await getShipment(s.orgId, id);
  if (!OPEN_SHIP.includes(x.status)) throw new ApiError("conflict", x.status === "delivered" ? "Already delivered" : `This shipment is ${x.status}`);
  const v = check(z.object({ podName: z.string().trim().min(1, "Who received it").max(120), podNote: z.string().trim().max(500).default("") }), raw);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(schema.lgxShipments).set({ status: "delivered", deliveredAt: now, podName: v.podName, podNote: v.podNote, events: [...x.events, { at: now.toISOString(), status: "delivered", note: `Received by ${v.podName}${v.podNote ? ` — ${v.podNote}` : ""}`, by: s.userId }] }).where(eq(schema.lgxShipments.id, x.id));
    if (x.deliveryIds.length) await tx.update(schema.salesDeliveries).set({ status: "delivered", deliveredAt: now, receivedBy: v.podName }).where(and(inArray(schema.salesDeliveries.id, x.deliveryIds), eq(schema.salesDeliveries.status, "dispatched")));
  });
  await emit(s.orgId, "logistics.shipment.delivered", { id: x.id, number: x.number, receivedBy: v.podName, deliveredAt: now.toISOString(), salesDeliveryIds: x.deliveryIds });
  return shape(s, await getShipment(s.orgId, x.id));
}

export async function cancelShipment(s: Scope, id: string) {
  requireWrite(s);
  const x = await getShipment(s.orgId, id);
  if (!OPEN_SHIP.includes(x.status)) throw new ApiError("conflict", `This shipment is ${x.status}`);
  if (x.freightPaidFromId) throw new ApiError("conflict", "Freight on this shipment has been paid; mark it returned instead");
  await db.update(schema.lgxShipments).set({ status: "cancelled", tripId: null, events: [...x.events, { at: new Date().toISOString(), status: "cancelled", note: "", by: s.userId }] }).where(eq(schema.lgxShipments.id, x.id));
}

/** Freight paid to the carrier from a bank or cash account (posted as freight outward). */
export async function payFreight(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  const x = await getShipment(s.orgId, id);
  if (x.mode !== "carrier") throw new ApiError("conflict", "Freight is paid to a carrier");
  if (x.freightPaidFromId) throw new ApiError("conflict", "Already paid");
  if (!x.freightCost) throw new ApiError("conflict", "There's no freight on this shipment");
  const v = check(z.object({ accountId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), raw);
  await cashAccount(s.orgId, v.accountId);
  await db.update(schema.lgxShipments).set({ freightPaidFromId: v.accountId, freightPaidOn: v.date }).where(eq(schema.lgxShipments.id, x.id));
}

export async function shipmentDetail(s: Scope, id: string) {
  const x = await getShipment(s.orgId, id);
  const [carrier, challans, trip, people] = await Promise.all([
    x.carrierId ? db.select().from(schema.lgxCarriers).where(and(eq(schema.lgxCarriers.id, x.carrierId), eq(schema.lgxCarriers.orgId, s.orgId))).then((r) => r[0] ?? null) : null,
    x.deliveryIds.length ? db.select({ id: schema.salesDeliveries.id, number: schema.salesDeliveries.number, status: schema.salesDeliveries.status, orderId: schema.salesDeliveries.orderId, lines: schema.salesDeliveries.lines }).from(schema.salesDeliveries).where(inArray(schema.salesDeliveries.id, x.deliveryIds)) : [],
    x.tripId ? db.select({ id: schema.lgxTrips.id, number: schema.lgxTrips.number, status: schema.lgxTrips.status }).from(schema.lgxTrips).where(eq(schema.lgxTrips.id, x.tripId)).then((r) => r[0] ?? null) : null,
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [...new Set(x.events.map((e) => e.by).filter(Boolean) as string[])].concat(["00000000-0000-0000-0000-000000000000"]))),
  ]);
  return { shipment: shape(s, x), carrier, carrierLink: trackingLink(carrier?.trackingUrl ?? "", x.trackingNo), challans, trip, trackUrl: `/track/${x.trackToken}`, people };
}

/** The public tracking page: where it is, never the internal notes or costs. */
export async function track(token: string) {
  if (!/^[A-Za-z0-9_-]{15,30}$/.test(token)) return null;
  const [row] = await db.select({ x: schema.lgxShipments, carrier: schema.lgxCarriers.name, trackingUrl: schema.lgxCarriers.trackingUrl, org: schema.organizations.name }).from(schema.lgxShipments).innerJoin(schema.organizations, eq(schema.organizations.id, schema.lgxShipments.orgId)).leftJoin(schema.lgxCarriers, eq(schema.lgxCarriers.id, schema.lgxShipments.carrierId)).where(eq(schema.lgxShipments.trackToken, token));
  if (!row || row.x.status === "cancelled") return null;
  const x = row.x;
  return { from: row.org, number: x.number, status: x.status, label: SHIP_STATUS_LABEL[x.status as (typeof SHIP_STATUSES)[number]] ?? x.status, promisedOn: x.promisedOn ? String(x.promisedOn) : null, deliveredAt: x.deliveredAt, receivedBy: x.status === "delivered" ? x.podName : "", carrier: row.carrier, trackingNo: x.trackingNo, carrierLink: trackingLink(row.trackingUrl ?? "", x.trackingNo), packages: x.packages, steps: x.events.filter((e) => e.status !== "planned").map((e) => ({ at: e.at, status: SHIP_STATUS_LABEL[e.status as (typeof SHIP_STATUSES)[number]] ?? e.status })) };
}

// ── Fleet: vehicles & drivers ───────────────────────────────────────────────

export async function drivers(s: Scope) {
  const today = todayIst();
  const rows = await db.select().from(schema.lgxDrivers).where(eq(schema.lgxDrivers.orgId, s.orgId)).orderBy(asc(schema.lgxDrivers.name));
  return rows.map((d) => ({ ...d, licenceAlert: d.licenceExpires ? (String(d.licenceExpires) < today ? "expired" : String(d.licenceExpires) <= addDays(today, s.settings.alertDays) ? "soon" : null) : null }));
}

export async function saveDriver(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  requirePart(s, "fleet");
  const v = check(driverSchema, raw);
  if (v.employeeId) {
    const [e] = await db.select({ id: schema.hrEmployees.id }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.id, v.employeeId), eq(schema.hrEmployees.orgId, s.orgId)));
    if (!e) throw new ApiError("validation_failed", "That person isn't in HR", { employeeId: ["Unknown employee"] });
  }
  if (id) {
    if (!isId(id)) throw notFound("Driver");
    const [row] = await db.update(schema.lgxDrivers).set(v).where(and(eq(schema.lgxDrivers.id, id), eq(schema.lgxDrivers.orgId, s.orgId))).returning();
    if (!row) throw notFound("Driver");
    return row;
  }
  const [row] = await db.insert(schema.lgxDrivers).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

async function getVehicle(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Vehicle");
  const [v] = await db.select().from(schema.lgxVehicles).where(and(eq(schema.lgxVehicles.id, id), eq(schema.lgxVehicles.orgId, orgId)));
  if (!v) throw notFound("Vehicle");
  return v;
}

export async function vehicles(s: Scope) {
  const [rows, fuel, ds] = await Promise.all([
    db.select().from(schema.lgxVehicles).where(eq(schema.lgxVehicles.orgId, s.orgId)).orderBy(asc(schema.lgxVehicles.regNo)),
    db.select({ vehicleId: schema.lgxFuel.vehicleId, odometer: schema.lgxFuel.odometer, litres: schema.lgxFuel.litres, full: schema.lgxFuel.full, amount: schema.lgxFuel.amount }).from(schema.lgxFuel).where(eq(schema.lgxFuel.orgId, s.orgId)),
    db.select({ id: schema.lgxDrivers.id, name: schema.lgxDrivers.name }).from(schema.lgxDrivers).where(eq(schema.lgxDrivers.orgId, s.orgId)),
  ]);
  const today = todayIst();
  return rows.map((v) => ({ ...v, driver: ds.find((d) => d.id === v.driverId)?.name ?? null, alerts: expiring(v.docs, today, s.settings.alertDays), mileage: mileage(fuel.filter((f) => f.vehicleId === v.id).map((f) => ({ ...f, amount: Number(f.amount) }))) }));
}

async function checkVehicleRefs(s: Scope, v: z.infer<typeof vehicleSchema>) {
  if (v.driverId) {
    const [d] = await db.select({ id: schema.lgxDrivers.id }).from(schema.lgxDrivers).where(and(eq(schema.lgxDrivers.id, v.driverId), eq(schema.lgxDrivers.orgId, s.orgId)));
    if (!d) throw new ApiError("validation_failed", "That driver isn't in this workspace", { driverId: ["Unknown driver"] });
  }
  if (v.assetId) {
    const [a] = await db.select({ id: schema.mntAssets.id }).from(schema.mntAssets).where(and(eq(schema.mntAssets.id, v.assetId), eq(schema.mntAssets.orgId, s.orgId)));
    if (!a) throw new ApiError("validation_failed", "That asset isn't in this workspace", { assetId: ["Unknown asset"] });
  }
}

export async function saveVehicle(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  requirePart(s, "fleet");
  const v = check(vehicleSchema, raw);
  await checkVehicleRefs(s, v);
  const [clash] = await db.select({ id: schema.lgxVehicles.id }).from(schema.lgxVehicles).where(and(eq(schema.lgxVehicles.orgId, s.orgId), eq(schema.lgxVehicles.regNo, v.regNo)));
  if (clash && clash.id !== id) throw new ApiError("conflict", `${v.regNo} is already in your fleet`);
  // A vehicle linked to an asset starts from the asset's meter if it has no reading of its own.
  const [asset] = v.assetId ? await db.select({ meter: schema.mntAssets.meter, meterAt: schema.mntAssets.meterAt }).from(schema.mntAssets).where(eq(schema.mntAssets.id, v.assetId)) : [];
  if (id) {
    const before = await getVehicle(s.orgId, id);
    const [row] = await db.update(schema.lgxVehicles).set({ ...v, ...(before.odometer === null && asset?.meter != null ? { odometer: asset.meter, odometerAt: asset.meterAt } : {}) }).where(eq(schema.lgxVehicles.id, before.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.lgxVehicles).values({ ...v, orgId: s.orgId, ...(asset?.meter != null ? { odometer: asset.meter, odometerAt: asset.meterAt } : {}) }).returning();
  return row;
}

/** A new odometer reading for a vehicle; its servicing in Assets & maintenance hears of it too. */
async function odometer(s: Scope, v: Vehicle, value: number, on: string) {
  if (v.odometer === null || value >= v.odometer) await db.update(schema.lgxVehicles).set({ odometer: value, odometerAt: on }).where(eq(schema.lgxVehicles.id, v.id));
  if (v.assetId) return meterFromElsewhere(s.orgId, v.assetId, value, on, s.userId);
  return { recorded: false, raised: 0 };
}

export async function vehicleDetail(s: Scope, id: string) {
  const v = await getVehicle(s.orgId, id);
  const [fuel, trips] = await Promise.all([
    db.select().from(schema.lgxFuel).where(eq(schema.lgxFuel.vehicleId, v.id)).orderBy(desc(schema.lgxFuel.odometer)).limit(200),
    db.select().from(schema.lgxTrips).where(eq(schema.lgxTrips.vehicleId, v.id)).orderBy(desc(schema.lgxTrips.date)).limit(100),
  ]);
  const distance = trips.filter((t) => t.status === "completed" && t.startOdo !== null && t.endOdo !== null).reduce((n, t) => n + (t.endOdo! - t.startOdo!), 0);
  return { vehicle: v, alerts: expiring(v.docs, todayIst(), s.settings.alertDays), fuel, trips, mileage: mileage(fuel.map((f) => ({ ...f, amount: Number(f.amount) }))), distance: Math.round(distance * 10) / 10, tripCosts: trips.reduce((n, t) => n + t.expenses.reduce((m, e) => m + e.amount, 0), 0) };
}

// ── Fuel ────────────────────────────────────────────────────────────────────

export async function addFuel(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "fleet");
  const v = check(fuelSchema, raw);
  const veh = await getVehicle(s.orgId, v.vehicleId);
  if (v.date > todayIst()) throw new ApiError("validation_failed", "That date is in the future");
  const [last] = await db.select({ odometer: schema.lgxFuel.odometer }).from(schema.lgxFuel).where(and(eq(schema.lgxFuel.vehicleId, veh.id), sql`${schema.lgxFuel.date} <= ${v.date}`)).orderBy(desc(schema.lgxFuel.odometer)).limit(1);
  if (last && v.odometer < last.odometer) throw new ApiError("validation_failed", `The odometer was already at ${last.odometer} km on an earlier fill`, { odometer: ["Less than before"] });
  if (veh.odometer !== null && veh.odometerAt && v.date >= String(veh.odometerAt) && v.odometer < veh.odometer) throw new ApiError("validation_failed", `${veh.regNo}'s odometer was at ${veh.odometer} km on ${veh.odometerAt}`, { odometer: ["Less than before"] });
  await cashAccount(s.orgId, v.paidFromId);
  const [row] = await db.insert(schema.lgxFuel).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  await odometer(s, veh, v.odometer, v.date);
  return row;
}

export async function deleteFuel(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Fuel entry");
  const [row] = await db.delete(schema.lgxFuel).where(and(eq(schema.lgxFuel.id, id), eq(schema.lgxFuel.orgId, s.orgId))).returning();
  if (!row) throw notFound("Fuel entry");
}

export async function fuelLog(s: Scope, q: { vehicleId?: string } = {}) {
  return db.select({ f: schema.lgxFuel, regNo: schema.lgxVehicles.regNo }).from(schema.lgxFuel).innerJoin(schema.lgxVehicles, eq(schema.lgxVehicles.id, schema.lgxFuel.vehicleId)).where(and(eq(schema.lgxFuel.orgId, s.orgId), q.vehicleId && isId(q.vehicleId) ? eq(schema.lgxFuel.vehicleId, q.vehicleId) : undefined)).orderBy(desc(schema.lgxFuel.date), desc(schema.lgxFuel.odometer)).limit(1000).then((r) => r.map(({ f, regNo }) => ({ ...f, regNo })));
}

// ── Trips ───────────────────────────────────────────────────────────────────

async function getTrip(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Trip");
  const [t] = await db.select().from(schema.lgxTrips).where(and(eq(schema.lgxTrips.id, id), eq(schema.lgxTrips.orgId, orgId)));
  if (!t) throw notFound("Trip");
  return t;
}

export async function trips(s: Scope, q: { status?: string } = {}) {
  const rows = await db.select({ t: schema.lgxTrips, regNo: schema.lgxVehicles.regNo, driver: schema.lgxDrivers.name }).from(schema.lgxTrips).innerJoin(schema.lgxVehicles, eq(schema.lgxVehicles.id, schema.lgxTrips.vehicleId)).leftJoin(schema.lgxDrivers, eq(schema.lgxDrivers.id, schema.lgxTrips.driverId)).where(and(eq(schema.lgxTrips.orgId, s.orgId), q.status && q.status !== "all" ? eq(schema.lgxTrips.status, q.status) : undefined)).orderBy(desc(schema.lgxTrips.date), desc(schema.lgxTrips.createdAt)).limit(500);
  const stops = rows.length ? await db.select({ tripId: schema.lgxShipments.tripId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${schema.lgxShipments.status} = 'delivered')::int`, kg: sql<number>`coalesce(sum(${schema.lgxShipments.weightKg}), 0)::float` }).from(schema.lgxShipments).where(inArray(schema.lgxShipments.tripId, rows.map((r) => r.t.id))).groupBy(schema.lgxShipments.tripId) : [];
  return rows.map(({ t, regNo, driver }) => ({ ...t, regNo, driver, stops: stops.find((x) => x.tripId === t.id)?.n ?? 0, delivered: stops.find((x) => x.tripId === t.id)?.done ?? 0, kg: stops.find((x) => x.tripId === t.id)?.kg ?? 0 }));
}

async function stopsCheck(s: Scope, ids: string[], tripId: string | null) {
  if (!ids.length) return [];
  const rows = await db.select().from(schema.lgxShipments).where(and(eq(schema.lgxShipments.orgId, s.orgId), inArray(schema.lgxShipments.id, ids)));
  if (rows.length !== new Set(ids).size) throw notFound("Shipment");
  for (const x of rows) {
    if (x.mode !== "own") throw new ApiError("conflict", `${x.number} goes by a carrier, not on your own vehicle`);
    if (!OPEN_SHIP.includes(x.status)) throw new ApiError("conflict", `${x.number} is ${x.status}`);
    if (x.tripId && x.tripId !== tripId) throw new ApiError("conflict", `${x.number} is already on another trip`);
  }
  return rows;
}

export async function createTrip(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "fleet");
  const v = check(tripSchema.extend({ force: z.boolean().default(false) }), raw);
  const veh = await getVehicle(s.orgId, v.vehicleId);
  if (!veh.active) throw new ApiError("conflict", `${veh.regNo} isn't in use`);
  if (v.driverId) {
    const [d] = await db.select().from(schema.lgxDrivers).where(and(eq(schema.lgxDrivers.id, v.driverId), eq(schema.lgxDrivers.orgId, s.orgId)));
    if (!d) throw new ApiError("validation_failed", "That driver isn't in this workspace", { driverId: ["Unknown driver"] });
    if (d.licenceExpires && String(d.licenceExpires) < v.date) throw new ApiError("conflict", `${d.name}'s driving licence has expired`);
  }
  const lapsed = expiring(veh.docs, v.date, 0).filter((d) => d.expired && ["insurance", "puc", "permit", "fitness"].includes(d.kind));
  if (lapsed.length && !v.force) throw new ApiError("conflict", `${veh.regNo}'s ${lapsed.map((d) => d.kind).join(", ")} ${lapsed.length === 1 ? "has" : "have"} expired`);
  const stops = await stopsCheck(s, v.shipmentIds, null);
  const l = load(stops.map((x) => x.weightKg), veh.capacityKg);
  if (l.over && !v.force) throw new ApiError("conflict", `That's ${l.kg} kg on a ${veh.capacityKg} kg vehicle`);
  const number = await nextNumber(s.orgId, "trip", s.settings.tripPrefix);
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(schema.lgxTrips).values({ orgId: s.orgId, number, date: v.date, vehicleId: veh.id, driverId: v.driverId ?? veh.driverId, notes: v.notes, createdBy: s.userId }).returning();
    for (const [i, id] of v.shipmentIds.entries()) await tx.update(schema.lgxShipments).set({ tripId: t.id, stopOrder: i + 1 }).where(eq(schema.lgxShipments.id, id));
    return t;
  });
}

export async function tripDetail(s: Scope, id: string) {
  const t = await getTrip(s.orgId, id);
  const [veh, driver, stops] = await Promise.all([getVehicle(s.orgId, t.vehicleId), t.driverId ? db.select().from(schema.lgxDrivers).where(eq(schema.lgxDrivers.id, t.driverId)).then((r) => r[0] ?? null) : null, db.select().from(schema.lgxShipments).where(eq(schema.lgxShipments.tripId, t.id)).orderBy(asc(schema.lgxShipments.stopOrder))]);
  return { trip: t, vehicle: veh, driver, stops: stops.map((x) => shape(s, x)), load: load(stops.map((x) => x.weightKg), veh.capacityKg), distance: t.startOdo !== null && t.endOdo !== null ? t.endOdo - t.startOdo : null, costs: t.expenses.reduce((n, e) => n + e.amount, 0) };
}

/** Change the stops (add, remove, reorder) before the trip starts. */
export async function setStops(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "planned") throw new ApiError("conflict", "Stops can change only before the trip starts");
  const { shipmentIds } = check(z.object({ shipmentIds: z.array(z.uuid()).max(100) }), raw);
  await stopsCheck(s, shipmentIds, t.id);
  await db.transaction(async (tx) => {
    await tx.update(schema.lgxShipments).set({ tripId: null, stopOrder: 0 }).where(eq(schema.lgxShipments.tripId, t.id));
    for (const [i, sid] of shipmentIds.entries()) await tx.update(schema.lgxShipments).set({ tripId: t.id, stopOrder: i + 1 }).where(eq(schema.lgxShipments.id, sid));
  });
  return tripDetail(s, t.id);
}

/** Leaving: the odometer at the start, and every stop goes in transit. */
export async function startTrip(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "planned") throw new ApiError("conflict", `This trip is ${t.status}`);
  const { odometer: odo } = check(z.object({ odometer: z.number().min(0).max(1e8) }), raw);
  const veh = await getVehicle(s.orgId, t.vehicleId);
  if (veh.odometer !== null && odo < veh.odometer) throw new ApiError("validation_failed", `${veh.regNo}'s odometer was last at ${veh.odometer} km`, { odometer: ["Less than before"] });
  const now = new Date();
  const stops = await db.select().from(schema.lgxShipments).where(and(eq(schema.lgxShipments.tripId, t.id), inArray(schema.lgxShipments.status, ["planned", "picked"])));
  await db.transaction(async (tx) => {
    await tx.update(schema.lgxTrips).set({ status: "started", startOdo: odo, startedAt: now }).where(eq(schema.lgxTrips.id, t.id));
    for (const x of stops) await tx.update(schema.lgxShipments).set({ status: "in_transit", events: [...x.events, { at: now.toISOString(), status: "in_transit", note: `On trip ${t.number}`, by: s.userId }] }).where(eq(schema.lgxShipments.id, x.id));
  });
  await odometer(s, veh, odo, todayIst());
  return getTrip(s.orgId, t.id);
}

const expenseSchema = z.object({ kind: z.string().max(30), amount: z.number().int().min(0).max(1e9), note: z.string().trim().max(200).default("") });

/** Back: the odometer at the end, the trip's costs (paid from an account, for the books), and the vehicle's reading. */
export async function completeTrip(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "started") throw new ApiError("conflict", t.status === "planned" ? "Start the trip first" : `This trip is ${t.status}`);
  const v = check(z.object({ odometer: z.number().min(0).max(1e8), expenses: z.array(expenseSchema).max(30).default([]), paidFromId: z.uuid().nullable().default(null) }), raw);
  if (t.startOdo !== null && v.odometer < t.startOdo) throw new ApiError("validation_failed", `It started at ${t.startOdo} km`, { odometer: ["Less than the start"] });
  const costs = v.expenses.filter((e) => e.amount > 0);
  if (costs.length) await cashAccount(s.orgId, v.paidFromId);
  await db.update(schema.lgxTrips).set({ status: "completed", endOdo: v.odometer, completedAt: new Date(), expenses: costs, paidFromId: costs.length ? v.paidFromId : null }).where(eq(schema.lgxTrips.id, t.id));
  const veh = await getVehicle(s.orgId, t.vehicleId);
  const m = await odometer(s, veh, v.odometer, todayIst());
  const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(schema.lgxShipments).where(and(eq(schema.lgxShipments.tripId, t.id), inArray(schema.lgxShipments.status, OPEN_SHIP)));
  return { trip: await getTrip(s.orgId, t.id), notDelivered: open, servicing: m };
}

export async function cancelTrip(s: Scope, id: string) {
  requireWrite(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "planned") throw new ApiError("conflict", "Only a trip that hasn't started can be cancelled");
  await db.transaction(async (tx) => {
    await tx.update(schema.lgxShipments).set({ tripId: null, stopOrder: 0 }).where(eq(schema.lgxShipments.tripId, t.id));
    await tx.update(schema.lgxTrips).set({ status: "cancelled" }).where(eq(schema.lgxTrips.id, t.id));
  });
}

// ── Home & reports ──────────────────────────────────────────────────────────

export async function home(s: Scope) {
  const [ships, vs, ds, ts] = await Promise.all([shipments(s, { status: "open" }), vehicles(s), drivers(s), trips(s, {})]);
  const today = todayIst();
  const byStatus = Object.fromEntries(OPEN_SHIP.map((st) => [st, ships.filter((x) => x.status === st).length]));
  return {
    counts: { open: ships.length, late: ships.filter((x) => x.late).length, byStatus, tripsToday: ts.filter((t) => String(t.date) === today && t.status !== "cancelled").length, onTheRoad: ts.filter((t) => t.status === "started").length },
    late: ships.filter((x) => x.late).slice(0, 10),
    papers: vs.filter((v) => v.active).flatMap((v) => v.alerts.map((a) => ({ vehicleId: v.id, regNo: v.regNo, ...a }))),
    licences: ds.filter((d) => d.active && d.licenceAlert),
    waiting: ships.filter((x) => x.mode === "own" && !x.tripId).length,
  };
}

/** Per vehicle (distance, fuel, mileage, cost per km) and per carrier (shipments, on time, freight) over a period. */
export async function reports(s: Scope, q: { from?: string; to?: string }) {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = ok(q.to) ? q.to! : todayIst();
  const from = ok(q.from) && q.from! <= to ? q.from! : addDays(to, -89);
  const [vs, fuel, tripRows, ships, cs] = await Promise.all([
    db.select().from(schema.lgxVehicles).where(eq(schema.lgxVehicles.orgId, s.orgId)),
    db.select().from(schema.lgxFuel).where(and(eq(schema.lgxFuel.orgId, s.orgId), sql`${schema.lgxFuel.date} between ${from} and ${to}`)),
    db.select().from(schema.lgxTrips).where(and(eq(schema.lgxTrips.orgId, s.orgId), eq(schema.lgxTrips.status, "completed"), sql`${schema.lgxTrips.date} between ${from} and ${to}`)),
    db.select().from(schema.lgxShipments).where(and(eq(schema.lgxShipments.orgId, s.orgId), sql`(${schema.lgxShipments.createdAt} at time zone 'Asia/Kolkata')::date between ${from} and ${to}`)),
    db.select().from(schema.lgxCarriers).where(eq(schema.lgxCarriers.orgId, s.orgId)),
  ]);
  const vehiclesOut = vs.map((v) => {
    const f = fuel.filter((x) => x.vehicleId === v.id);
    const t = tripRows.filter((x) => x.vehicleId === v.id);
    const km = t.reduce((n, x) => n + (x.endOdo !== null && x.startOdo !== null ? x.endOdo - x.startOdo : 0), 0);
    const fuelCost = f.reduce((n, x) => n + Number(x.amount), 0);
    const tripCost = t.reduce((n, x) => n + x.expenses.reduce((m, e) => m + e.amount, 0), 0);
    const m = mileage(f.map((x) => ({ ...x, amount: Number(x.amount) })));
    return { id: v.id, regNo: v.regNo, trips: t.length, km: Math.round(km * 10) / 10, litres: Math.round(f.reduce((n, x) => n + x.litres, 0) * 100) / 100, fuelCost, tripCost, kmPerLitre: m.kmPerLitre, fuelCostPerKm: m.costPerKm, costPerKm: km ? Math.round((fuelCost + tripCost) / km) : null };
  });
  const carriersOut = [...cs.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: "Own fleet" }].map((c) => {
    const mine = ships.filter((x) => (c.id ? x.carrierId === c.id : x.mode === "own"));
    const ot = onTime(mine.map((x) => ({ status: x.status, promisedOn: x.promisedOn ? String(x.promisedOn) : null, deliveredAt: x.deliveredAt })));
    const cost = mine.filter((x) => x.status !== "cancelled").reduce((n, x) => n + Number(x.freightCost), 0);
    const billed = mine.filter((x) => x.status !== "cancelled").reduce((n, x) => n + Number(x.freightBilled), 0);
    return { ...c, shipments: mine.filter((x) => x.status !== "cancelled").length, ...ot, exceptions: mine.filter((x) => x.events.some((e) => e.status === "exception")).length, freightCost: s.write ? cost : 0, freightBilled: s.write ? billed : 0 };
  }).filter((c) => c.shipments);
  return { from, to, vehicles: vehiclesOut, carriers: carriersOut };
}

// ── Books ───────────────────────────────────────────────────────────────────

type Want = { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: PostLine[]; companyId?: string; branchId?: string | null };

/** Fuel paid (Dr vehicle running costs), trip costs paid, and freight paid to carriers (Dr freight outward), each Cr the account it came from. */
export async function logisticsWants(orgId: string, ofWarehouse: (id: string) => { companyId?: string; branchId?: string | null }) {
  const [fuel, tripRows, ships] = await Promise.all([
    db.select({ f: schema.lgxFuel, regNo: schema.lgxVehicles.regNo }).from(schema.lgxFuel).innerJoin(schema.lgxVehicles, eq(schema.lgxVehicles.id, schema.lgxFuel.vehicleId)).where(and(eq(schema.lgxFuel.orgId, orgId), sql`${schema.lgxFuel.paidFromId} is not null`)),
    db.select({ t: schema.lgxTrips, regNo: schema.lgxVehicles.regNo }).from(schema.lgxTrips).innerJoin(schema.lgxVehicles, eq(schema.lgxVehicles.id, schema.lgxTrips.vehicleId)).where(and(eq(schema.lgxTrips.orgId, orgId), eq(schema.lgxTrips.status, "completed"), sql`${schema.lgxTrips.paidFromId} is not null`)),
    db.select({ x: schema.lgxShipments, carrier: schema.lgxCarriers.name }).from(schema.lgxShipments).leftJoin(schema.lgxCarriers, eq(schema.lgxCarriers.id, schema.lgxShipments.carrierId)).where(and(eq(schema.lgxShipments.orgId, orgId), sql`${schema.lgxShipments.freightPaidFromId} is not null`)),
  ]);
  const out: Want[] = [];
  for (const { f, regNo } of fuel) if (Number(f.amount)) out.push({ sourceType: "fuel", sourceId: f.id, date: String(f.date), narration: `Fuel · ${regNo} · ${f.litres} l${f.station ? ` at ${f.station}` : ""}`, sourceRef: regNo, party: f.station, lines: [{ key: "vehicle_costs", debit: Number(f.amount), credit: 0 }, { accountId: f.paidFromId!, debit: 0, credit: Number(f.amount) }] });
  for (const { t, regNo } of tripRows) {
    const total = t.expenses.reduce((n, e) => n + e.amount, 0);
    if (total) out.push({ sourceType: "trip_costs", sourceId: t.id, date: t.completedAt ? istDay(t.completedAt) : String(t.date), narration: `Trip costs · ${t.number} · ${regNo}`, sourceRef: t.number, party: "", lines: [{ key: "vehicle_costs", debit: total, credit: 0 }, { accountId: t.paidFromId!, debit: 0, credit: total }] });
  }
  for (const { x, carrier } of ships) if (Number(x.freightCost)) out.push({ sourceType: "freight", sourceId: x.id, date: String(x.freightPaidOn ?? istDay(x.createdAt)), narration: `Freight · ${x.number}${x.lrNo ? ` · LR ${x.lrNo}` : ""}${x.trackingNo ? ` · ${x.trackingNo}` : ""}`, sourceRef: x.number, party: carrier ?? "", lines: [{ key: "freight_out", debit: Number(x.freightCost), credit: 0 }, { accountId: x.freightPaidFromId!, debit: 0, credit: Number(x.freightCost) }], ...(x.warehouseId ? ofWarehouse(x.warehouseId) : {}) });
  return out;
}
