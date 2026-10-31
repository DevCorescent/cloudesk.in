import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as salesApi from "@/app/api/v1/orgs/[orgId]/sales/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Bins and quarantine, serial numbers in and out, stock reserved for sales
// orders, a wave picked from bins and dispatched as challans, FIFO value and
// ageing, ABC counts due, scanning and safety stock.
let orgId = "";
let owner = "";
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = mk(invApi, "inventory");
const S = mk(salesApi, "sales");
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const avail = async (itemId: string) => (await I("GET", "availability")).json.items.find((x: { itemId: string }) => x.itemId === itemId);
const inBin = async (binId: string, itemId: string) => Number((await db.select().from(schema.invBinStock).where(and(eq(schema.invBinStock.binId, binId), eq(schema.invBinStock.itemId, itemId))))[0]?.qty ?? 0);
const day = "2026-10-07";

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Wahid Warehouse", email: "wahid.wh@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.phone = (await I("POST", "items", { name: "Handheld scanner", sku: "HS-1", unit: "pcs", gstRate: 18, trackSerials: true })).json.item.id;
  ids.shelf = (await I("POST", "items", { name: "Steel shelf", sku: "SH-1", barcode: "8901234567890", unit: "pcs", gstRate: 18, reorderLevel: 2, reorderQty: 10, safetyStock: 5 })).json.item.id;
  ids.a01 = (await I("POST", "bins", { warehouseId: ids.wh, code: "A-01", zone: "A" })).json.bin.id;
  ids.q01 = (await I("POST", "bins", { warehouseId: ids.wh, code: "Q-01", kind: "quarantine" })).json.bin.id;
});
afterAll(closeDb);

describe("bins, serials and receiving", () => {
  it("receives serial-numbered units into a bin, one serial each, never twice", async () => {
    expect((await I("POST", "bins", { warehouseId: ids.wh, code: "a-01" })).status).toBe(409);
    const recv = (serials: string[], qty = serials.length) => I("POST", "receipts", { warehouseId: ids.wh, date: day, lines: [{ itemId: ids.phone, qty, rate: 1500000, gstRate: 18, serials, binId: ids.a01 }] });
    expect((await recv(["SN1", "SN2"], 3)).status).toBe(422);
    expect((await recv(["SN1", "SN2", "SN3"])).status).toBe(200);
    expect((await recv(["SN3"])).status).toBe(409);
    expect(await inBin(ids.a01, ids.phone)).toBe(3);
    expect((await I("GET", `serials?itemId=${ids.phone}&status=in_stock`)).json.serials).toHaveLength(3);
  });

  it("puts stock away, moves it to quarantine, and counts only what's free as available", async () => {
    await I("POST", "receipts", { warehouseId: ids.wh, date: day, lines: [{ itemId: ids.shelf, qty: 10, rate: 10000, gstRate: 18 }] });
    expect((await I("GET", `bins?warehouseId=${ids.wh}`)).json.unplaced.find((u: { itemId: string }) => u.itemId === ids.shelf).qty).toBe(10);
    expect((await I("POST", "bin-moves", { warehouseId: ids.wh, itemId: ids.shelf, qty: 11, toBinId: ids.a01 })).status).toBe(409);
    await I("POST", "bin-moves", { warehouseId: ids.wh, itemId: ids.shelf, qty: 6, toBinId: ids.a01 });
    await I("POST", "bin-moves", { warehouseId: ids.wh, itemId: ids.shelf, qty: 2, fromBinId: ids.a01, toBinId: ids.q01 });
    expect(await inBin(ids.a01, ids.shelf)).toBe(4);
    expect(await avail(ids.shelf)).toMatchObject({ onHand: 10, quarantined: 2, available: 8 });
    // A stock adjustment without a bin comes out of what isn't put away first.
    await I("POST", "adjust", { itemId: ids.shelf, warehouseId: ids.wh, qty: -3, reason: "damaged" });
    expect(await inBin(ids.a01, ids.shelf)).toBe(4);
    await I("POST", "adjust", { itemId: ids.shelf, warehouseId: ids.wh, qty: 3, reason: "found" });
  });
});

describe("reservations and waves", () => {
  it("reserves for confirmed orders, then picks a wave from bins and dispatches it as challans", async () => {
    ids.book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
    ids.client = (await B("POST", `${ids.book}/clients`, { name: "Meera", company: "Lumen Labs", billing: { line1: "", line2: "", city: "", state: "Karnataka", postalCode: "", country: "IN" }, notes: "" })).json.client.id;
    await S("GET", "meta");
    const o = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: day, lines: [{ id: "p", itemId: ids.phone, name: "Handheld scanner", qty: 2, rate: 2000000, taxBps: 1800 }, { id: "s", itemId: ids.shelf, name: "Steel shelf", qty: 5, rate: 15000, taxBps: 1800 }] })).json.order;
    ids.order = o.id;
    await S("POST", `orders/${o.id}/confirm`, {});
    expect(await avail(ids.shelf)).toMatchObject({ reserved: 5, available: 3 });
    expect((await I("GET", `wave-candidates?warehouseId=${ids.wh}`)).json.orders.map((x: { id: string }) => x.id)).toEqual([o.id]);
    const w = (await I("POST", "waves", { warehouseId: ids.wh, orderIds: [o.id] })).json.wave;
    expect(w.number).toBe("WV-0001");
    const d = (await I("GET", `waves/${w.id}`)).json;
    expect(d.bins.find((b: { itemId: string }) => b.itemId === ids.shelf)).toMatchObject({ code: "A-01", qty: 4 });
    expect((await I("POST", "waves", { warehouseId: ids.wh, orderIds: [o.id] })).status).toBe(422);
    await I("POST", `waves/${w.id}/pick`, { lines: [{ orderId: o.id, lineId: "p", picked: 2, binId: ids.a01, serials: ["SN1", "SN2"] }, { orderId: o.id, lineId: "s", picked: 4, binId: ids.a01 }] });
    await I("POST", `waves/${w.id}/pack`, { packages: [{ orderId: o.id, boxes: 2, weightKg: 18.5 }] });
    const r = (await I("POST", `waves/${w.id}/dispatch`, {})).json;
    expect(r.challans).toEqual(["DC-0001"]);
    expect(await inBin(ids.a01, ids.shelf)).toBe(0);
    expect(await inBin(ids.a01, ids.phone)).toBe(1);
    const [sn1] = await db.select().from(schema.invSerials).where(eq(schema.invSerials.serial, "SN1"));
    expect(sn1).toMatchObject({ status: "delivered", warehouseId: null });
    // One shelf still to go: still reserved.
    expect(await avail(ids.shelf)).toMatchObject({ onHand: 6, reserved: 1 });
    // Serial units can't go out without their serials, or with ones not in stock.
    expect((await S("POST", "deliveries", { orderId: o.id, date: day, lines: [{ lineId: "s", qty: 1, serials: [] }] })).status).toBe(200);
    const o2 = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: day, lines: [{ id: "p", itemId: ids.phone, name: "Handheld scanner", qty: 1, rate: 2000000, taxBps: 1800 }] })).json.order;
    await S("POST", `orders/${o2.id}/confirm`, {});
    expect((await S("POST", "deliveries", { orderId: o2.id, date: day, lines: [{ lineId: "p", qty: 1 }] })).status).toBe(422);
    expect((await S("POST", "deliveries", { orderId: o2.id, date: day, lines: [{ lineId: "p", qty: 1, serials: ["SN1"] }] })).status).toBe(409);
    // A return brings the serial back into stock; cancelling releases the reservation.
    await S("POST", "returns", { orderId: o.id, date: day, creditNote: false, lines: [{ lineId: "p", qty: 1, reason: "quality", restock: true, serials: ["SN2"] }] });
    expect((await db.select().from(schema.invSerials).where(eq(schema.invSerials.serial, "SN2")))[0].status).toBe("in_stock");
    await S("POST", `orders/${o2.id}/cancel`, {});
    expect((await avail(ids.phone)).reserved).toBe(0);
  });
});

describe("valuation, counts and scanning", () => {
  it("values stock by FIFO and average, ages it, and lists counts due by ABC class", async () => {
    // 5 shelves on hand at ₹100; ten more at ₹200 → average moves to ₹166.67, FIFO keeps the newest.
    await I("POST", "receipts", { warehouseId: ids.wh, date: day, lines: [{ itemId: ids.shelf, qty: 10, rate: 20000, gstRate: 18 }] });
    const v = (await I("GET", "stock-value")).json;
    const row = v.rows.find((r: { id: string }) => r.id === ids.shelf);
    expect(row.onHand).toBe(15);
    expect(row.fifo).toBe(10 * 20000 + 5 * 10000);
    expect(row.ages[0]).toMatchObject({ bucket: "0-30", qty: 15 });
    const due = (await I("GET", "counts-due")).json;
    expect(due.due.some((x: { itemId: string }) => x.itemId === ids.shelf)).toBe(true);
    await I("POST", "counts", { warehouseId: ids.wh, lines: [{ itemId: ids.shelf, counted: 15 }] });
    expect((await I("GET", "counts-due")).json.due.some((x: { itemId: string }) => x.itemId === ids.shelf)).toBe(false);
  });

  it("finds items, serials and bins by scan, and reorders above safety stock", async () => {
    expect((await I("GET", "scan?code=8901234567890")).json).toMatchObject({ kind: "item", item: { id: ids.shelf } });
    expect((await I("GET", "scan?code=sn3")).json).toMatchObject({ kind: "serial", serial: { serial: "SN3", status: "in_stock" } });
    expect((await I("GET", "scan?code=Q-01")).json).toMatchObject({ kind: "bin" });
    expect((await I("GET", "scan?code=nothing")).status).toBe(404);
    // 15 on hand, 0 reserved: above reorder 2 + safety 5 — not listed. Take 9 out: 6 left, under 7.
    expect((await I("GET", "reorder")).json.rows.some((r: { id: string }) => r.id === ids.shelf)).toBe(false);
    await I("POST", "adjust", { itemId: ids.shelf, warehouseId: ids.wh, qty: -9, reason: "used" });
    const r = (await I("GET", "reorder")).json.rows.find((x: { id: string }) => x.id === ids.shelf);
    expect(r).toMatchObject({ free: 6, suggest: 10 });
  });
});
