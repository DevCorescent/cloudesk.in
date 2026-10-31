import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as mfgApi from "@/app/api/v1/orgs/[orgId]/manufacturing/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as salesApi from "@/app/api/v1/orgs/[orgId]/sales/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// A table made from a recipe with a routing: materials issued at cost (and one
// returned), time logged on two work centres, output received at its real
// unit cost, the conversion cost posted, variances; MRP from a sales order;
// capacity; and importing recipes.
let orgId = "";
let owner = "";
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const M = mk(mfgApi, "manufacturing");
const I = mk(invApi, "inventory");
const S = mk(salesApi, "sales");
const A = mk(accApi, "accounts");
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const onHand = async (itemId: string) => (await db.select().from(schema.invStock).where(eq(schema.invStock.itemId, itemId))).reduce((a, r) => a + Number(r.qty), 0);
const day = "2026-10-08";

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Mohan Maker", email: "mohan.mfg@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  for (const [k, name, sku] of [["table", "Oak table", "TBL"], ["top", "Table top", "TOP"], ["leg", "Table leg", "LEG"], ["screw", "Screw", "SCR"], ["stool", "Stool", "STL"]] as const) ids[k] = (await I("POST", "items", { name, sku, unit: "pcs", gstRate: 18 })).json.item.id;
  await I("POST", "receipts", { warehouseId: ids.wh, date: day, lines: [{ itemId: ids.top, qty: 10, rate: 50000, gstRate: 18 }, { itemId: ids.leg, qty: 50, rate: 10000, gstRate: 18 }, { itemId: ids.screw, qty: 500, rate: 100, gstRate: 18 }] });
  await M("GET", "meta");
});
afterAll(closeDb);

describe("recipes and work centres", () => {
  it("saves a recipe with a routing, refuses loops, and works out a standard cost", async () => {
    ids.saw = (await M("POST", "work-centres", { code: "SAW", name: "Panel saw", costPerHour: 60000 })).json.centre.id;
    ids.bench = (await M("POST", "work-centres", { code: "BENCH", name: "Assembly bench", costPerHour: 30000 })).json.centre.id;
    const bom = (await M("POST", "boms", { itemId: ids.table, lines: [{ itemId: ids.top, qty: 1 }, { itemId: ids.leg, qty: 4 }, { itemId: ids.screw, qty: 16, scrapPct: 12.5 }], operations: [{ id: "cut", workCentreId: ids.saw, name: "Cut", minutes: 10, setupMinutes: 30 }, { id: "fit", workCentreId: ids.bench, name: "Assemble", minutes: 20 }] })).json.bom;
    ids.bom = bom.id;
    expect((await M("POST", "boms", { itemId: ids.top, lines: [{ itemId: ids.table, qty: 1 }] })).status).toBe(422);
    const d = (await M("GET", `boms/${bom.id}`)).json;
    // ₹500 top + 4 × ₹100 legs + 18 screws × ₹1; 40 min saw (₹400) + 20 min bench (₹100).
    expect(d.standard).toMatchObject({ material: 50000 + 40000 + 1800, conversion: 40000 + 10000, perUnit: 141800 });
  });
});

describe("work orders", () => {
  it("issues materials at cost, times operations, and makes the output at its real cost", async () => {
    const wo = (await M("POST", "work-orders", { itemId: ids.table, qty: 5, plannedStart: day, plannedEnd: day })).json.order;
    expect(wo).toMatchObject({ number: "MO-0001", status: "draft" });
    expect(wo.materials).toEqual([{ itemId: ids.top, required: 5, issued: 0 }, { itemId: ids.leg, required: 20, issued: 0 }, { itemId: ids.screw, required: 90, issued: 0 }]);
    expect((await M("POST", `work-orders/${wo.id}/issue`, { lines: [{ itemId: ids.leg, qty: 1 }] })).status).toBe(409);
    await M("POST", `work-orders/${wo.id}/release`, {});
    const res = await db.select().from(schema.invReservations).where(and(eq(schema.invReservations.refType, "work_order"), eq(schema.invReservations.refId, wo.id)));
    expect(res).toHaveLength(3);
    await M("POST", `work-orders/${wo.id}/issue`, { lines: [{ itemId: ids.top, qty: 5 }, { itemId: ids.leg, qty: 20 }, { itemId: ids.screw, qty: 90 }] });
    // One leg wasn't needed.
    const back = (await M("POST", `work-orders/${wo.id}/issue`, { lines: [{ itemId: ids.leg, qty: -1 }] })).json.order;
    expect(back.materialCost).toBe(5 * 50000 + 19 * 10000 + 90 * 100);
    expect(await onHand(ids.leg)).toBe(31);
    await M("POST", `work-orders/${wo.id}/time`, { operationId: "cut", minutes: 90, done: true });
    await M("POST", `work-orders/${wo.id}/time`, { operationId: "fit", minutes: 100, done: true });
    const done = (await M("POST", `work-orders/${wo.id}/complete`, { produced: 5 })).json.order;
    // Conversion: 90 min × ₹600/h + 100 min × ₹300/h = ₹900 + ₹500.
    expect(done).toMatchObject({ status: "done", conversionCost: 140000, unitCost: Math.round((449000 + 140000) / 5) });
    expect(await onHand(ids.table)).toBe(5);
    const [table] = await db.select().from(schema.invItems).where(eq(schema.invItems.id, ids.table));
    expect(table.avgCost).toBe(117800);
    const d = (await M("GET", `work-orders/${wo.id}`)).json;
    expect(d.variances.materials.find((x: { itemId: string }) => x.itemId === ids.leg)).toMatchObject({ standard: 20, actual: 19, qty: -1 });
    expect(d.variances.yieldPct).toBe(100);
    expect((await db.select().from(schema.invReservations).where(eq(schema.invReservations.refId, wo.id)))).toHaveLength(0);
    // The books take the conversion cost into stock.
    await A("POST", "sync");
    const [j] = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "production")));
    expect(j.total).toBe(140000);
  });
});

describe("planning", () => {
  it("plans what to make and buy for a sales order, and loads the work centres", async () => {
    ids.book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
    const client = (await B("POST", `${ids.book}/clients`, { name: "Meera", company: "Lumen Labs", billing: { line1: "", line2: "", city: "", state: "Karnataka", postalCode: "", country: "IN" }, notes: "" })).json.client.id;
    await S("GET", "meta");
    const o = (await S("POST", "orders", { ownerId: ids.book, clientId: client, date: day, lines: [{ id: "a", itemId: ids.table, name: "Oak table", qty: 12, rate: 250000, taxBps: 1800 }] })).json.order;
    await S("POST", `orders/${o.id}/confirm`, {});
    const r = (await M("GET", "mrp")).json;
    // 12 tables against 5 made: 7 to make; tops 7 against 5 left: 2 to buy; legs and screws are enough.
    expect(r.make).toEqual([expect.objectContaining({ itemId: ids.table, net: 7 })]);
    expect(r.buy).toEqual([expect.objectContaining({ itemId: ids.top, net: 2 })]);
    const made = (await M("POST", "mrp make", { lines: [{ itemId: ids.table, qty: 7 }] })).json;
    expect(made.workOrderIds).toHaveLength(1);
    const req = (await M("POST", "mrp buy", { lines: [{ itemId: ids.top, qty: 2 }] })).json;
    expect(req.number).toBe("REQ-0001");
    // Planned now: MRP has nothing left to suggest.
    const again = (await M("GET", "mrp")).json;
    expect(again.make).toEqual([]);
    await M("POST", `work-orders/${made.workOrderIds[0]}/release`, {});
    const cap = (await M("GET", "capacity?days=5")).json.centres.find((c: { code: string }) => c.code === "SAW");
    expect(cap).toMatchObject({ minutes: 30 + 70, capacity: 8 * 60 * 5 });
  });

  it("imports recipes, one row per component", async () => {
    const r = (await M("POST", "boms import", { rows: [{ product: "STL", component: "Table leg", qty: "3" }, { product: "Stool", component: "SCR", qty: "6", scrapPct: "10" }, { product: "Stool", component: "Nope", qty: "1" }] })).json;
    expect(r).toMatchObject({ created: 2, errors: [expect.objectContaining({ row: 2 })] });
    const [b] = await db.select().from(schema.mfgBoms).where(eq(schema.mfgBoms.itemId, ids.stool));
    expect(b.lines).toEqual([{ itemId: ids.leg, qty: 3, scrapPct: 0 }, { itemId: ids.screw, qty: 6, scrapPct: 10 }]);
  });
});
