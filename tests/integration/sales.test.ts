import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as salesApi from "@/app/api/v1/orgs/[orgId]/sales/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Price lists and customer terms, an order held for credit and approved,
// delivered in two challans (stock out), invoiced as delivered (no second
// stock move), a voided invoice freeing quantities, a return with a credit
// note, commissions and targets, and imports.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const S = (method: string, path: string, body?: unknown, who = "owner") => call(salesApi[method as "GET"], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/sales/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = (method: string, path: string, body?: unknown) => call(invApi[method as "GET"], { method, cookie: C.owner, body, path: `/api/v1/orgs/${orgId}/inventory/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: C.owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const onHand = async () => (await db.select().from(schema.invStock).where(eq(schema.invStock.itemId, ids.shelf))).reduce((a, r) => a + Number(r.qty), 0);
const order = async () => (await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, ids.order)))[0];
const day = "2026-10-05";

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sana Sales", email: "sana.sales@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  C.rep = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Ravi Rep", email: "ravi.rep@example.com", password: "correct-horse-42" } }));
  const [rep] = await db.select().from(schema.users).where(eq(schema.users.email, "ravi.rep@example.com"));
  U.rep = rep.id;
  await db.insert(schema.memberships).values({ orgId, userId: rep.id, role: "editor" });
  ids.book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
  ids.client = (await B("POST", `${ids.book}/clients`, { name: "Meera", company: "Lumen Labs", email: "meera@lumenlabs.in", billing: { line1: "4 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560025", country: "IN" }, notes: "" })).json.client.id;
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.shelf = (await I("POST", "items", { name: "Steel shelf", sku: "SH-1", unit: "pcs", gstRate: 18, hsn: "94032090" })).json.item.id;
  await I("POST", "adjust", { itemId: ids.shelf, warehouseId: ids.wh, qty: 20, reason: "opening" });
  const meta = (await S("GET", "meta")).json;
  ids.std = meta.lists.find((l: { isDefault: boolean }) => l.isDefault).id;
});
afterAll(closeDb);

describe("prices and customers", () => {
  it("price by the customer's list, quantity tier and dates, with the default list as base", async () => {
    await S("POST", `price-lists/${ids.std}/prices`, { itemId: ids.shelf, price: 12500_00 });
    ids.dealer = (await S("POST", "price-lists", { name: "Dealer", kind: "fixed" })).json.list.id;
    await S("POST", `price-lists/${ids.dealer}/prices`, { itemId: ids.shelf, price: 11000_00, minQty: 10 });
    ids.festive = (await S("POST", "price-lists", { name: "Festive", kind: "discount", discountPct: 10, validFrom: "2026-10-01", validTo: "2026-10-31" })).json.list.id;
    expect((await S("POST", "price-lists", { name: "Bad", validFrom: "2026-10-10", validTo: "2026-10-01" })).status).toBe(422);
    expect((await S("POST", `price-lists/${ids.festive}/prices`, { itemId: ids.shelf, price: 1 })).status).toBe(409);
    const q = async (list: string | null, qty: number, date = day) => {
      await S("POST", "customers", { ownerId: ids.book, clientId: ids.client, priceListId: list });
      return (await S("POST", "quote", { clientId: ids.client, date, items: [{ itemId: ids.shelf, qty }] })).json.prices[0];
    };
    expect(await q(ids.dealer, 10)).toMatchObject({ price: 11000_00, listPrice: 12500_00, from: "customer" });
    expect(await q(ids.dealer, 5)).toMatchObject({ price: 12500_00, from: "default" });
    expect(await q(ids.festive, 1)).toMatchObject({ price: 11250_00 });
    expect(await q(ids.festive, 1, "2026-11-02")).toMatchObject({ price: 12500_00, from: "default" });
    // Terms: ₹1 lakh limit, 15 days, Ravi sells to them. Only managers set them.
    expect((await S("POST", "customers", { ownerId: ids.book, clientId: ids.client, creditLimit: 100000_00 }, "rep")).status).toBe(403);
    await S("POST", "customers", { ownerId: ids.book, clientId: ids.client, creditLimit: 100000_00, paymentTermsDays: 15, salespersonId: U.rep });
    const c = (await S("GET", "customers")).json.customers[0];
    expect(c).toMatchObject({ name: "Lumen Labs", limit: 100000_00, owed: 0, onOrder: 0 });
  });
});

describe("orders", () => {
  it("hold an order over the credit limit for a manager, then confirm", async () => {
    const o = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: day, salespersonId: U.rep, lines: [{ id: "a", itemId: ids.shelf, name: "Steel shelf", hsn: "94032090", unit: "pcs", qty: 8, rate: 12500_00, taxBps: 1800 }, { id: "b", name: "Installation", hsn: "995461", qty: 1, rate: 5000_00, taxBps: 1800 }] }, "rep")).json.order;
    expect(o).toMatchObject({ number: "SO-0001", status: "draft", subtotal: 105000_00, total: 123900_00 });
    ids.order = o.id;
    const r = (await S("POST", `orders/${o.id}/confirm`, {}, "rep")).json;
    expect(r.order.status).toBe("pending_approval");
    expect(r.holds[0]).toMatch(/Over the credit limit/);
    expect((await S("POST", `deliveries`, { orderId: o.id, date: day, lines: [{ lineId: "a", qty: 1 }] })).status).toBe(409);
    expect((await S("POST", `orders/${o.id}/approve`, { approve: true }, "rep")).status).toBe(403);
    expect((await S("POST", `orders/${o.id}/approve`, { approve: true })).json.order.status).toBe("confirmed");
  });

  it("refuses over the limit when the workspace blocks, and big discounts need approval", async () => {
    const meta = (await S("GET", "meta")).json;
    await S("PUT", "settings", { ...meta.settings, creditCheck: "block" });
    const big = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: day, lines: [{ id: "a", itemId: ids.shelf, name: "Steel shelf", qty: 1, rate: 12500_00, taxBps: 1800 }] }, "rep")).json.order;
    expect((await S("POST", `orders/${big.id}/confirm`, {}, "rep")).status).toBe(409);
    await S("PUT", "settings", { ...meta.settings, creditCheck: "approve" });
    await S("DELETE", `orders/${big.id}`);
    // A 20% discount on a small order by a rep: held for the discount; a manager's own goes through.
    await S("POST", "customers", { ownerId: ids.book, clientId: ids.client, creditLimit: 0, paymentTermsDays: 15, salespersonId: U.rep });
    const disc = (await S("POST", "orders", { ownerId: ids.book, clientId: ids.client, date: day, lines: [{ id: "a", itemId: ids.shelf, name: "Steel shelf", qty: 1, rate: 12500_00, discountPct: 20, taxBps: 1800 }] }, "rep")).json.order;
    const held = (await S("POST", `orders/${disc.id}/confirm`, {}, "rep")).json;
    expect(held.holds[0]).toMatch(/Discount over 10%/);
    expect(held.order.status).toBe("pending_approval");
    await S("POST", `orders/${disc.id}/approve`, { approve: false });
    const back = (await S("GET", `orders/${disc.id}`)).json;
    expect(back.order.status).toBe("draft");
    // Who to email about it: the customer from the books.
    expect(back.contact).toEqual({ name: "Meera", email: "meera@lumenlabs.in" });
    await S("POST", `orders/${disc.id}/cancel`, {});
  });
});

describe("delivery, invoicing and returns", () => {
  it("delivers from stock and invoices what's delivered, without moving stock again", async () => {
    expect((await S("POST", "deliveries", { orderId: ids.order, date: day, lines: [{ lineId: "a", qty: 9 }] })).status).toBe(422);
    expect((await S("POST", "deliveries", { orderId: ids.order, date: day, lines: [{ lineId: "b", qty: 1 }] })).status).toBe(422);
    const dc = (await S("POST", "deliveries", { orderId: ids.order, date: day, lines: [{ lineId: "a", qty: 5 }], vehicleNo: "KA01AB1234" })).json.delivery;
    expect(dc.number).toBe("DC-0001");
    expect(await onHand()).toBe(15);
    expect((await order()).status).toBe("partial");
    const inv = (await S("POST", `orders/${ids.order}/invoice`, {})).json.invoice;
    const doc = (await B("GET", `${ids.book}/documents/${inv.id}`)).json.document;
    // 5 shelves and the installation (a service, invoiced on order).
    expect(doc.lines.map((l: { quantity: number }) => l.quantity)).toEqual([5, 1]);
    expect(doc.total).toBe(Math.round((5 * 12500_00 + 5000_00) * 1.18));
    await B("POST", `${ids.book}/documents/${inv.id}/issue`, {});
    expect(await onHand()).toBe(15);
    ids.inv1 = inv.id;
    expect((await S("POST", `orders/${ids.order}/invoice`, {})).status).toBe(409);
    await S("POST", "deliveries", { orderId: ids.order, date: day, lines: [{ lineId: "a", qty: 3 }] });
    expect((await order()).status).toBe("delivered");
    const inv2 = (await S("POST", `orders/${ids.order}/invoice`, {})).json.invoice;
    // Voided, its 3 shelves can be invoiced again.
    await B("POST", `${ids.book}/documents/${inv2.id}/issue`, {});
    await B("POST", `${ids.book}/documents/${inv2.id}/void`, { reason: "Wrong rate" });
    expect((await order()).lines[0].invoiced).toBe(5);
    ids.inv3 = (await S("POST", `orders/${ids.order}/invoice`, {})).json.invoice.id;
    await B("POST", `${ids.book}/documents/${ids.inv3}/issue`, {});
    expect((await order()).lines[0].invoiced).toBe(8);
  });

  it("takes a return back into stock and credits what was billed", async () => {
    expect((await S("POST", "returns", { orderId: ids.order, date: day, lines: [{ lineId: "a", qty: 9 }] })).status).toBe(422);
    const r = (await S("POST", "returns", { orderId: ids.order, date: day, lines: [{ lineId: "a", qty: 2, reason: "damaged", restock: true }] })).json;
    expect(r.return.number).toBe("SR-0001");
    expect(await onHand()).toBe(14);
    const cn = (await B("GET", `${ids.book}/documents/${r.creditNote.id}`)).json.document;
    expect(cn).toMatchObject({ type: "credit_note", total: Math.round(2 * 12500_00 * 1.18) });
    // Until the credit note is issued, the shelves still count as invoiced.
    expect((await order()).lines[0].invoiced).toBe(8);
    await B("POST", `${ids.book}/documents/${cn.id}/issue`, {});
    const o = await order();
    expect(o.lines[0]).toMatchObject({ delivered: 8, returned: 2, invoiced: 6 });
    expect((await S("POST", `orders/${ids.order}/invoice`, {})).status).toBe(409);
    // The customer now owes the two invoices less the credit note.
    const c = (await S("GET", "customers")).json.customers[0];
    expect(c.owed).toBe(Math.round((5 * 12500_00 + 5000_00) * 1.18) + Math.round(3 * 12500_00 * 1.18) - Math.round(2 * 12500_00 * 1.18));
  });
});

describe("commissions, targets and imports", () => {
  it("pays the rep on what was invoiced from their orders, less credit notes, against their target", async () => {
    await S("POST", "plans", { name: "Standard", ratePct: 5, basis: "invoiced" });
    await S("POST", "targets", { userId: U.rep, month: "2026-10", amount: 100000_00 });
    const c = (await S("GET", "commissions?from=2026-10-01&to=2026-10-31")).json;
    const rep = c.lines.find((l: { userId: string }) => l.userId === U.rep);
    expect(rep).toMatchObject({ invoiced: 80000_00, commission: 4000_00, target: 100000_00, achieved: 80 });
    // The rep sees only their own line.
    expect((await S("GET", "commissions?from=2026-10-01&to=2026-10-31", undefined, "rep")).json.lines.every((l: { userId: string }) => l.userId === U.rep)).toBe(true);
  });

  it("imports prices and customer terms", async () => {
    const p = (await S("POST", `price-lists/${ids.dealer}/import`, { rows: [{ item: "SH-1", price: "10500", minQty: "20" }, { item: "Nope", price: "1" }] })).json;
    expect(p).toMatchObject({ created: 1, errors: [expect.objectContaining({ row: 1 })] });
    const c = (await S("POST", "customers/import", { rows: [{ customer: "Lumen Labs", creditLimit: "200000", priceList: "Dealer", salesperson: "ravi.rep@example.com" }] })).json;
    expect(c).toMatchObject({ updated: 1, errors: [] });
    const t = (await S("GET", "customers")).json.customers[0].terms;
    expect(t).toMatchObject({ creditLimit: 200000_00, priceListId: ids.dealer, salespersonId: U.rep, paymentTermsDays: 15 });
  });
});
