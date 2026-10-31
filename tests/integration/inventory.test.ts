import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as modules from "@/app/api/v1/orgs/[orgId]/modules/route";
import * as api from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as storeApi from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let viewer = "";
let orgId = "";
let projectId = "";
const ids: Record<string, string> = {};
const inv = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/inventory/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const store = (method: string, path: string, body?: unknown) => call(storeApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const stockOf = async (itemId: string) => (await inv("GET", `items/${itemId}`)).json as { onHand: number; stock: { warehouseId: string; batch: string; qty: number; expiry: string | null }[]; item: { avgCost: number } };
const at = (rows: { warehouseId: string; batch: string; qty: number }[], wh: string, batch = "") => rows.filter((r) => r.warehouseId === wh && r.batch === batch).reduce((a, r) => a + r.qty, 0);

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Isha Owner", email: "isha.inv@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik Viewer", email: "vik.inv@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "vik.inv@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v.id, role: "viewer" });
});
afterAll(closeDb);

describe("Inventory & purchasing", () => {
  it("starts with one location, ready to use", async () => {
    const r = await inv("GET", "meta");
    expect(r.status).toBe(200);
    expect(r.json.warehouses).toHaveLength(1);
    expect(r.json.warehouses[0]).toMatchObject({ name: "Main store room", isDefault: true });
    ids.main = r.json.warehouses[0].id;
    await inv("PUT", `warehouses/${ids.main}`, { name: "Main store room", code: "MAIN", state: "MH", isDefault: true });
    expect(r.json.me).toMatchObject({ write: true, manage: true });
  });

  it("keeps suppliers and items, with SKUs unique", async () => {
    ids.local = (await inv("POST", "suppliers", { name: "Sharma Traders", state: "MH", email: "orders@sharma.example", gstin: "27ABCDE1234F1Z5" })).json.supplier.id;
    ids.far = (await inv("POST", "suppliers", { name: "Bengaluru Paper Co", state: "KA" })).json.supplier.id;
    expect((await inv("POST", "suppliers", { name: "Bad", gstin: "NOTAGSTIN" })).status).toBe(422);
    ids.box = (await inv("POST", "items", { name: "Shipping box (M)", sku: "BOX-M", unit: "pcs", gstRate: 18, reorderLevel: 50, reorderQty: 200, supplierId: ids.local })).json.item.id;
    ids.flour = (await inv("POST", "items", { name: "Maida flour", sku: "FLR-1", unit: "kg", gstRate: 5, trackBatches: true, reorderLevel: 20, reorderQty: 50, supplierId: ids.far })).json.item.id;
    const dup = await inv("POST", "items", { name: "Another", sku: "box-m" });
    expect(dup.status).toBe(409);
  });

  it("raises a purchase order with the right GST and sends it honestly", async () => {
    const po = await inv("POST", "orders", { supplierId: ids.local, warehouseId: ids.main, orderDate: "2026-10-01", lines: [{ itemId: ids.box, qty: 100, rate: 1200, gstRate: 18 }] });
    expect(po.status).toBe(200);
    expect(po.json.order).toMatchObject({ number: "PO-0001", status: "draft", subtotal: 120000, tax: 21600, total: 141600, interState: false });
    ids.po = po.json.order.id;
    const d = (await inv("GET", `orders/${ids.po}`)).json;
    expect(d.split).toEqual({ igst: 0, cgst: 10800, sgst: 10800 });
    // Across states it's IGST.
    const far = await inv("POST", "orders", { supplierId: ids.far, warehouseId: ids.main, orderDate: "2026-10-01", lines: [{ itemId: ids.flour, qty: 10, rate: 4000, gstRate: 5 }] });
    expect(far.json.order.interState).toBe(true);
    ids.farPo = far.json.order.id;
    // No mail service in tests: marked sent, not claimed as emailed.
    const sent = await inv("POST", `orders/${ids.po}/send`, {});
    expect(sent.json).toMatchObject({ emailed: false, reason: "No mail service is set up for this workspace" });
    expect((await inv("GET", `orders/${ids.po}`)).json.po.status).toBe("sent");
  });

  it("receives goods against the order, part by part, and reworks the average cost", async () => {
    const part = await inv("POST", "receipts", { poId: ids.po, warehouseId: ids.main, date: "2026-10-05", supplierInvoice: "ST/889", lines: [{ itemId: ids.box, qty: 60, rate: 1200 }] });
    expect(part.status).toBe(200);
    expect(part.json.receipt.number).toBe("GRN-0001");
    let po = (await inv("GET", `orders/${ids.po}`)).json.po;
    expect(po.status).toBe("partial");
    expect(po.lines[0].received).toBe(60);
    expect((await stockOf(ids.box)).onHand).toBe(60);
    expect((await stockOf(ids.box)).item.avgCost).toBe(1200);
    // More than is still due isn't accepted.
    const over = await inv("POST", "receipts", { poId: ids.po, warehouseId: ids.main, date: "2026-10-06", lines: [{ itemId: ids.box, qty: 50, rate: 1200 }] });
    expect(over.status).toBe(422);
    expect(over.json.error.message).toMatch(/Only 40 more/);
    // The rest arrives dearer: 60 @ ₹12 + 40 @ ₹15 → ₹13.20 average.
    await inv("POST", "receipts", { poId: ids.po, warehouseId: ids.main, date: "2026-10-07", lines: [{ itemId: ids.box, qty: 40, rate: 1500 }] });
    po = (await inv("GET", `orders/${ids.po}`)).json.po;
    expect(po.status).toBe("received");
    const s = await stockOf(ids.box);
    expect(s.onHand).toBe(100);
    expect(s.item.avgCost).toBe(1320);
    expect((await inv("POST", `orders/${ids.po}/cancel`, {})).status).toBe(409);
  });

  it("tracks batches and expiry, and issues oldest-expiry first", async () => {
    expect((await inv("POST", "receipts", { poId: ids.farPo, warehouseId: ids.main, date: "2026-10-05", lines: [{ itemId: ids.flour, qty: 4, rate: 4000 }] })).json.error.message).toMatch(/tracked by batch/);
    await inv("POST", "receipts", { poId: ids.farPo, warehouseId: ids.main, date: "2026-10-05", lines: [{ itemId: ids.flour, qty: 6, rate: 4000, batch: "B-LATE", expiry: "2027-03-01" }, { itemId: ids.flour, qty: 4, rate: 4000, batch: "B-SOON", expiry: "2026-11-10" }] });
    const s = await stockOf(ids.flour);
    expect(at(s.stock, ids.main, "B-SOON")).toBe(4);
    expect(at(s.stock, ids.main, "B-LATE")).toBe(6);
    const exp = (await inv("GET", "expiring")).json.batches;
    expect(exp.map((b: { batch: string }) => b.batch)).toEqual(["B-SOON"]);
  });

  it("moves stock between locations: out when sent, in when received", async () => {
    ids.branch = (await inv("POST", "warehouses", { name: "Pune branch", state: "MH" })).json.warehouse.id;
    const t = await inv("POST", "transfers", { fromId: ids.main, toId: ids.branch, lines: [{ itemId: ids.flour, qty: 5.5 }, { itemId: ids.box, qty: 30 }] });
    expect(t.status).toBe(200);
    ids.transfer = t.json.transfer.id;
    expect((await inv("POST", `transfers/${ids.transfer}/receive`, {})).status).toBe(409);
    // Sent twice at once: only one goes through, so stock leaves once.
    const sends = await Promise.all([inv("POST", `transfers/${ids.transfer}/send`, {}), inv("POST", `transfers/${ids.transfer}/send`, {})]);
    expect(sends.map((x) => x.status).sort()).toEqual([200, 409]);
    let flour = await stockOf(ids.flour);
    // 4 from the batch expiring first, then 1.5 from the later one.
    expect(at(flour.stock, ids.main, "B-SOON")).toBe(0);
    expect(at(flour.stock, ids.main, "B-LATE")).toBe(4.5);
    expect(flour.onHand).toBe(4.5); // 5.5 is in transit
    const receives = await Promise.all([inv("POST", `transfers/${ids.transfer}/receive`, {}), inv("POST", `transfers/${ids.transfer}/receive`, {})]);
    expect(receives.map((x) => x.status).sort()).toEqual([200, 409]);
    flour = await stockOf(ids.flour);
    expect(at(flour.stock, ids.branch, "B-SOON")).toBe(4);
    expect(at(flour.stock, ids.branch, "B-LATE")).toBe(1.5);
    expect(flour.onHand).toBe(10);
    // Can't send what isn't there.
    const big = (await inv("POST", "transfers", { fromId: ids.branch, toId: ids.main, lines: [{ itemId: ids.box, qty: 999 }] })).json.transfer.id;
    const r = await inv("POST", `transfers/${big}/send`, {});
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/Only 30/);
    // Cancelling in transit puts it back.
    const back = (await inv("POST", "transfers", { fromId: ids.branch, toId: ids.main, lines: [{ itemId: ids.box, qty: 10 }] })).json.transfer.id;
    await inv("POST", `transfers/${back}/send`, {});
    expect(at((await stockOf(ids.box)).stock, ids.branch)).toBe(20);
    await inv("POST", `transfers/${back}/cancel`, {});
    expect(at((await stockOf(ids.box)).stock, ids.branch)).toBe(30);
  });

  it("adjusts and counts, with the difference valued", async () => {
    expect((await inv("POST", "adjust", { itemId: ids.box, warehouseId: ids.main, qty: -3, reason: "damaged" })).status).toBe(200);
    expect(at((await stockOf(ids.box)).stock, ids.main)).toBe(67);
    const c = await inv("POST", "counts", { warehouseId: ids.main, lines: [{ itemId: ids.box, counted: 65 }], note: "Month-end count" });
    expect(c.status).toBe(200);
    expect(c.json.count.lines[0]).toMatchObject({ expected: 67, counted: 65 });
    expect(c.json.count.varianceValue).toBe(-2640);
    expect(at((await stockOf(ids.box)).stock, ids.main)).toBe(65);
  });

  it("suggests what to reorder and drafts one order per supplier", async () => {
    const noSup = (await inv("POST", "items", { name: "Packing tape", unit: "pcs", reorderLevel: 10, reorderQty: 24 })).json.item.id;
    const r = (await inv("GET", "reorder")).json;
    const names = r.rows.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(["Maida flour", "Packing tape"]);
    const flour = r.rows.find((x: { name: string }) => x.name === "Maida flour");
    expect(flour.suggest).toBe(50);
    const d = await inv("POST", "reorder", { warehouseId: ids.main, lines: r.rows.map((x: { id: string; suggest: number; supplierId: string | null }) => ({ itemId: x.id, qty: x.suggest, supplierId: x.supplierId })) });
    expect(d.json.orders).toHaveLength(1);
    expect(d.json.skipped).toEqual(["Packing tape"]);
    // Now on order, it isn't suggested again.
    expect((await inv("GET", "reorder")).json.rows.find((x: { id: string }) => x.id === ids.flour).suggest).toBe(0);
    void noSup;
  });

  it("links a store's products: the shop shelf is the variant's own stock", async () => {
    projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Corner Shop" } })).json.project.id;
    await store("POST", "setup", { name: "Corner Shop", template: "home", country: "IN", region: "Maharashtra", replaceDesign: true });
    await store("POST", "import/smart", { products: [{ title: "Clay mug", description: "", category: "", tags: [], vendor: "Kitchen", images: [], hsn: "", active: true, options: [], variants: [{ options: {}, price: 45000, compareAt: null, cost: 18000, sku: "", stock: 5, weightGrams: null }] }] });
    const l = await inv("POST", "link-store", { projectId });
    expect(l.status).toBe(200);
    expect(l.json.added).toBeGreaterThanOrEqual(1);
    ids.shop = l.json.warehouseId;
    expect((await inv("POST", "link-store", { projectId })).json.added).toBe(0);
    const mug = (await inv("GET", "items?q=Clay")).json.items[0];
    expect(mug).toMatchObject({ onHand: 5, avgCost: 18000, unit: "pcs" });
    ids.mug = mug.id;
    // Receiving onto the shop shelf raises the store's own stock and its log.
    await inv("POST", "receipts", { supplierId: ids.local, warehouseId: ids.shop, date: "2026-10-10", lines: [{ itemId: ids.mug, qty: 10, rate: 15000 }] });
    const [v] = await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.id, mug.variantId));
    expect(v.stock).toBe(15);
    const logs = await db.select().from(schema.storeInventoryLog).where(and(eq(schema.storeInventoryLog.variantId, mug.variantId), eq(schema.storeInventoryLog.reason, "inventory:receive")));
    expect(logs).toHaveLength(1);
    // Store stock is whole units.
    expect((await inv("POST", "adjust", { itemId: ids.mug, warehouseId: ids.shop, qty: -0.5, reason: "damaged" })).status).toBe(422);
    // A back-room location for the same item holds its own number.
    await inv("POST", "receipts", { supplierId: ids.local, warehouseId: ids.main, date: "2026-10-10", lines: [{ itemId: ids.mug, qty: 20, rate: 15000 }] });
    const t = (await inv("POST", "transfers", { fromId: ids.main, toId: ids.shop, lines: [{ itemId: ids.mug, qty: 8 }] })).json.transfer.id;
    await inv("POST", `transfers/${t}/send`, {});
    await inv("POST", `transfers/${t}/receive`, {});
    const [v2] = await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.id, mug.variantId));
    expect(v2.stock).toBe(23);
    expect((await stockOf(ids.mug)).onHand).toBe(35);
  });

  it("values stock and shows it by location", async () => {
    const h = (await inv("GET", "home")).json;
    expect(h.stats.items).toBeGreaterThanOrEqual(4);
    expect(h.stats.value).toBeGreaterThan(0);
    expect(h.byWarehouse.find((w: { id: string }) => w.id === ids.shop)).toMatchObject({ store: true });
    const r = (await inv("GET", "reports")).json;
    expect(r.valuation[0].value).toBeGreaterThan(0);
    expect(r.suppliers[0].supplier).toBe("Sharma Traders");
  });

  it("follows the role: viewers see stock but can't change it", async () => {
    expect((await inv("GET", "items", undefined, viewer)).status).toBe(200);
    const r = await inv("POST", "adjust", { itemId: ids.box, warehouseId: ids.main, qty: 1, reason: "found" }, viewer);
    expect(r.status).toBe(403);
  });

  it("switched-off parts can't be used", async () => {
    await call(modules.PUT, { method: "PUT", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules`, body: { modules: null, partsOff: { inventory: ["locations", "batches", "purchasing"] } } });
    expect((await inv("GET", "transfers")).status).toBe(403);
    expect((await inv("POST", "warehouses", { name: "Third" })).status).toBe(403);
    expect((await inv("POST", "items", { name: "Yeast", trackBatches: true })).status).toBe(403);
    expect((await inv("GET", "orders")).status).toBe(403);
    expect((await inv("GET", "items")).status).toBe(200);
    await call(modules.PUT, { method: "PUT", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules`, body: { modules: null, partsOff: {} } });
  });
});

import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
describe("invoices take stock out", () => {
  it("issuing takes linked stock, a credit note puts it back, a void undoes the rest", async () => {
    const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
    const book = (await B("POST", "", { orgId, name: "Wholesale" })).json.book.id;
    const item = (await inv("POST", "items", { name: "Gift hamper", sku: "HAMPER", unit: "pcs" })).json.item.id;
    const main = (await inv("GET", "meta")).json.warehouses.find((w: { isDefault: boolean }) => w.isDefault).id;
    await inv("POST", "adjust", { itemId: item, warehouseId: main, qty: 50, reason: "opening" });
    const billed = (await B("POST", `${book}/items`, { name: "Gift hamper", rate: 150000, taxBps: 1200, invItemId: item })).json.item.id;
    const doc = { type: "invoice", client: { name: "Ravi Shah", email: "", billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" } }, issueDate: "2026-10-20", currency: "INR", taxMode: "gst", lines: [{ id: "a", name: "Gift hamper", itemId: billed, quantity: 12, rate: 150000, taxBps: 1200 }] };
    const stockOf = async () => (await inv("GET", `items/${item}`)).json.onHand;
    const d = (await B("POST", `${book}/documents`, { document: doc, issue: true })).json.document;
    expect(await stockOf()).toBe(38);
    const cn = (await B("POST", `${book}/documents/${d.id}/credit-note`, {})).json.document;
    await B("POST", `${book}/documents/${cn.id}/issue`, {});
    expect(await stockOf()).toBe(50);
    // The history says why.
    const h = (await inv("GET", `items/${item}`)).json.history;
    expect(h.some((x: { refNo: string; qty: number }) => x.refNo === d.number && x.qty === -12)).toBe(true);
    // A second invoice, voided: its stock comes back.
    const d2 = (await B("POST", `${book}/documents`, { document: { ...doc, lines: [{ ...doc.lines[0], quantity: 5 }] }, issue: true })).json.document;
    expect(await stockOf()).toBe(45);
    await B("POST", `${book}/documents/${d2.id}/void`, { reason: "Wrong client" });
    expect(await stockOf()).toBe(50);
  });
});
