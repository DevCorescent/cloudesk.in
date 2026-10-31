import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/logistics/[[...slug]]/route";
import * as salesApi from "@/app/api/v1/orgs/[orgId]/sales/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as mntApi from "@/app/api/v1/orgs/[orgId]/maintenance/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as trackPage from "@/app/track/[token]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Carriers and a rate card, a shipment of two challans with freight from the
// rate card, its trail and proof of delivery (challans marked delivered), the
// public tracking page, a trip in our own van over capacity and its odometer
// feeding servicing, fuel and mileage, and the journals.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const L = mk(api, "logistics");
const S = mk(salesApi, "sales");
const I = mk(invApi, "inventory");
const A = mk(accApi, "accounts");
const M = mk(mntApi, "maintenance");
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: C.owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dev Dispatch", email: "dev.lgx@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  ids.book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
  ids.client = (await B("POST", `${ids.book}/clients`, { name: "Meera", company: "Lumen Labs", phone: "98450 11111", billing: { line1: "4 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560025", country: "IN" }, notes: "" })).json.client.id;
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  await db.update(schema.invWarehouses).set({ state: "MH" }).where(eq(schema.invWarehouses.id, ids.wh));
  ids.shelf = (await I("POST", "items", { name: "Steel shelf", sku: "SH-1", unit: "pcs", gstRate: 18 })).json.item.id;
  await I("POST", "adjust", { itemId: ids.shelf, warehouseId: ids.wh, qty: 20, reason: "opening" });
  await S("GET", "meta");
  const o = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: today, lines: [{ id: "a", itemId: ids.shelf, name: "Steel shelf", unit: "pcs", qty: 10, rate: 1000_00, taxBps: 1800 }] })).json.order;
  await S("POST", `orders/${o.id}/confirm`, {});
  for (const [key, qty] of [["d4", 4], ["d3b", 3], ["d3c", 3]] as const) ids[key] = (await S("POST", "deliveries", { orderId: o.id, warehouseId: ids.wh, date: today, lines: [{ lineId: "a", qty }] })).json.delivery.id;
  ids.bank = (await A("GET", "meta")).json.accounts.find((a: { systemKey: string }) => a.systemKey === "bank").id;
});
afterAll(closeDb);

describe("shipments by carrier", () => {
  it("prices freight from the lane's rate card, keeps a trail, and closes the challans on delivery", async () => {
    ids.carrier = (await L("POST", "carriers", { name: "VRL Logistics", kind: "transporter", trackingUrl: "https://track.example/?lr={tracking}" })).json.carrier.id;
    await L("POST", "rates", { carrierId: ids.carrier, perKg: 1500, minCharge: 50000 });
    await L("POST", "rates", { carrierId: ids.carrier, fromState: "MH", toState: "KA", perKg: 900, minCharge: 30000, fixed: 10000 });
    expect((await L("POST", "rates", { carrierId: ids.carrier, fromState: "XX", perKg: 1 })).status).toBe(422);
    const pre = (await L("GET", `shipments/from?deliveries=${ids.d4},${ids.d3b}`)).json;
    expect(pre).toMatchObject({ consignee: "Lumen Labs", state: "KA", warehouseId: ids.wh, mixed: false });
    expect(pre.address).toContain("Bengaluru");
    const res = await L("POST", "shipments", { mode: "carrier", carrierId: ids.carrier, deliveryIds: [ids.d4, ids.d3b], consignee: pre.consignee, address: pre.address, state: "Karnataka", warehouseId: ids.wh, weightKg: 120, packages: 3, lrNo: "LR-5521", trackingNo: "LR-5521" });
    const made = res.json;
    // 120 kg × ₹9 = ₹1,080, plus ₹100 fixed.
    expect(made.shipment).toMatchObject({ number: "SHP-0001", state: "KA", freightCost: 1080_00 + 100_00, status: "planned" });
    ids.ship = made.shipment.id;
    expect((await L("POST", "shipments", { mode: "carrier", carrierId: ids.carrier, deliveryIds: [ids.d4], consignee: "x" })).status).toBe(409);
    expect((await L("POST", `shipments/${ids.ship}/step`, { status: "exception" })).status).toBe(422);
    await L("POST", `shipments/${ids.ship}/step`, { status: "picked" });
    await L("POST", `shipments/${ids.ship}/step`, { status: "in_transit", note: "Left Pune hub" });

    const token = (await L("GET", `shipments/${ids.ship}`)).json.trackUrl.split("/track/")[1];
    const page = await call(trackPage.GET as never, { path: `/track/${token}`, params: { token } });
    expect(page.text).toContain("In transit");
    expect(page.text).toContain("track.example/?lr=LR-5521");
    expect(page.text).not.toContain("Left Pune hub");
    expect(page.text).not.toContain("1,180");

    expect((await L("POST", `shipments/${ids.ship}/deliver`, { podName: "" })).status).toBe(422);
    await L("POST", `shipments/${ids.ship}/deliver`, { podName: "Meera (store)" });
    const ds = await db.select().from(schema.salesDeliveries).where(eq(schema.salesDeliveries.orgId, orgId));
    expect(ds.filter((d) => d.status === "delivered").map((d) => d.id).sort()).toEqual([ids.d4, ids.d3b].sort());
    expect(ds.find((d) => d.id === ids.d4)!.receivedBy).toBe("Meera (store)");
    await L("POST", `shipments/${ids.ship}/pay`, { accountId: ids.bank, date: today });
  });
});

describe("own fleet", () => {
  it("refuses a trip over capacity or with lapsed papers, feeds the odometer to servicing, and works out mileage", async () => {
    ids.asset = (await M("POST", "assets", { name: "Tata Ace", meterUnit: "km" })).json.asset.id;
    await M("POST", `assets/${ids.asset}/readings`, { value: 15000, on: today });
    await M("POST", "plans", { assetId: ids.asset, title: "Service every 5,000 km", everyMeter: 5000, startOn: today, startMeter: 15000 });
    ids.driver = (await L("POST", "drivers", { name: "Raju", phone: "98200 22222", licenceNo: "MH12 2019 0001234", licenceExpires: "2030-01-01" })).json.driver.id;
    const van = (await L("POST", "vehicles", { regNo: "mh12  ab 1234", name: "Tata Ace", type: "tempo", capacityKg: 100, driverId: ids.driver, assetId: ids.asset, docs: [{ kind: "insurance", number: "POL-1", expiresOn: "2020-01-01" }] })).json.vehicle;
    expect(van.regNo).toBe("MH12 AB 1234");
    ids.van = van.id;
    expect((await L("POST", "vehicles", { regNo: "MH12 AB 1234" })).status).toBe(409);

    const ownRes = await L("POST", "shipments", { mode: "own", deliveryIds: [ids.d3c], consignee: "Lumen Labs", state: "KA", weightKg: 150 });
    const own = ownRes.json.shipment;
    expect((await L("POST", "trips", { date: today, vehicleId: ids.van, shipmentIds: [own.id] })).json.error.message).toMatch(/insurance/);
    await L("PUT", `vehicles/${ids.van}`, { regNo: "MH12 AB 1234", name: "Tata Ace", type: "tempo", capacityKg: 100, driverId: ids.driver, assetId: ids.asset, docs: [{ kind: "insurance", number: "POL-2", expiresOn: "2030-01-01" }] });
    expect((await L("POST", "trips", { date: today, vehicleId: ids.van, shipmentIds: [own.id] })).json.error.message).toBe("That's 150 kg on a 100 kg vehicle");
    const trip = (await L("POST", "trips", { date: today, vehicleId: ids.van, shipmentIds: [own.id], force: true })).json.trip;
    expect(trip).toMatchObject({ number: "TRP-0001", driverId: ids.driver });
    expect((await L("POST", `trips/${trip.id}/start`, { odometer: 14000 })).status).toBe(422);
    await L("POST", `trips/${trip.id}/start`, { odometer: 15010 });
    expect((await L("GET", `shipments/${own.id}`)).json.shipment.status).toBe("in_transit");
    const done = (await L("POST", `trips/${trip.id}/complete`, { odometer: 19995, expenses: [{ kind: "toll", amount: 450_00 }, { kind: "parking", amount: 50_00 }], paidFromId: ids.bank })).json;
    expect(done.notDelivered).toBe(1);
    // 19,995 km is within no lead of 20,000: nothing raised yet; 20,010 raises the service.
    expect(done.servicing).toEqual({ recorded: true, raised: 0 });
    expect((await L("POST", "fuel", { vehicleId: ids.van, date: today, litres: 30, amount: 3000_00, odometer: 19000 })).status).toBe(422);
    await L("POST", "fuel", { vehicleId: ids.van, date: today, litres: 40, amount: 4000_00, odometer: 20010, full: true, paidFromId: ids.bank });
    const raised = await db.select().from(schema.mntOrders).where(and(eq(schema.mntOrders.orgId, orgId), eq(schema.mntOrders.kind, "preventive")));
    expect(raised).toHaveLength(1);
    await L("POST", "fuel", { vehicleId: ids.van, date: today, litres: 25, amount: 2500_00, odometer: 20310, full: true });
    const v = (await L("GET", `vehicles/${ids.van}`)).json;
    expect(v.mileage).toMatchObject({ km: 300, litres: 25, kmPerLitre: 12 });
    expect(v.distance).toBe(4985);
  });

  it("imports a fuel-card statement and posts fuel, trip costs and freight", async () => {
    const imp = (await L("POST", "fuel/import", { rows: [{ date: today, vehicle: "MH 12 AB 1234", litres: 20, amount: 2000_00, odometer: 20550, full: true, station: "HP Baner" }, { date: today, vehicle: "KA01ZZ9999", litres: 10, amount: 1, odometer: 1 }], mode: "add" })).json;
    expect(imp).toMatchObject({ created: 1, errors: [expect.objectContaining({ message: expect.stringMatching(/isn't in your fleet/) })] });
    await A("POST", "sync");
    const js = await db.select().from(schema.accJournals).where(eq(schema.accJournals.orgId, orgId));
    const by = (t: string) => js.filter((j) => j.sourceType === t).map((j) => Number(j.total));
    expect(by("fuel")).toEqual([4000_00]);
    expect(by("trip_costs")).toEqual([500_00]);
    expect(by("freight")).toEqual([1180_00]);
    const r = (await L("GET", "reports")).json;
    expect(r.carriers.find((c: { name: string }) => c.name === "VRL Logistics")).toMatchObject({ shipments: 1, delivered: 1 });
    expect(r.vehicles[0]).toMatchObject({ trips: 1, km: 4985, tripCost: 500_00 });
  });
});
