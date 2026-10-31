import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as apApi from "@/app/api/v1/orgs/[orgId]/approvals/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Requisitions (approved, ordered), RFQs compared and awarded, agreed rates
// and budgets warning or refusing, supplier onboarding, inspection on receipt,
// returns to suppliers with a debit note, the 3-way match and performance.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = mk(invApi, "inventory");
const A = mk(accApi, "accounts");
const P = mk(apApi, "approvals");
const onHand = async () => (await db.select().from(schema.invStock).where(eq(schema.invStock.itemId, ids.box))).reduce((a, r) => a + Number(r.qty), 0);
const day = "2026-10-06";

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pia Procure", email: "pia.procure@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.ed = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Esha Editor", email: "esha.procure@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "esha.procure@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.a = (await I("POST", "suppliers", { name: "Apex Packaging", state: "KA", gstin: "29AAJFS2290K1ZO" })).json.supplier.id;
  ids.b = (await I("POST", "suppliers", { name: "Bharat Boxes", state: "KA" })).json.supplier.id;
  ids.box = (await I("POST", "items", { name: "Carton 12x12", sku: "CTN-12", unit: "pcs", category: "Packaging", gstRate: 18, supplierId: ids.a, avgCost: 2000 })).json.item.id;
});
afterAll(closeDb);

describe("requisitions", () => {
  it("go through approval and become purchase orders with the usual supplier", async () => {
    const r = (await I("POST", "requisitions", { warehouseId: ids.wh, neededBy: "2026-10-20", reason: "Diwali packing", lines: [{ itemId: ids.box, qty: 500 }] }, "ed")).json.requisition;
    expect(r).toMatchObject({ number: "REQ-0001", total: 500 * 2000 });
    expect((await I("POST", `requisitions/${r.id}/order`, {}, "ed")).status).toBe(409);
    expect((await I("POST", `requisitions/${r.id}/submit`, {}, "ed")).json.status).toBe("approved");
    const o = (await I("POST", `requisitions/${r.id}/order`, {}, "ed")).json;
    const [po] = await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, o.poIds[0]));
    expect(po).toMatchObject({ supplierId: ids.a, status: "draft", notes: "From REQ-0001" });
    expect(po.lines[0]).toMatchObject({ qty: 500, rate: 2000 });
    // With an approval rule, a requisition waits for the owner.
    await P("POST", "policies", { kind: "inv.requisition", name: "Requisitions", steps: [{ name: "Owner", approvers: [{ type: "role", role: "owner" }] }] });
    const r2 = (await I("POST", "requisitions", { warehouseId: ids.wh, lines: [{ itemId: ids.box, qty: 10 }] }, "ed")).json.requisition;
    expect((await I("POST", `requisitions/${r2.id}/submit`, {}, "ed")).json.status).toBe("pending_approval");
    const q = (await P("GET", "queue")).json.requests.find((x: { kind: string }) => x.kind === "inv.requisition");
    await P("POST", `requests/${q.id}/decide`, { approve: true });
    expect((await db.select().from(schema.invRequisitions).where(eq(schema.invRequisitions.id, r2.id)))[0].status).toBe("approved");
  });
});

describe("RFQs", () => {
  it("compare quotes and award each item, making purchase orders at the quoted rates", async () => {
    const rfq = (await I("POST", "rfqs", { title: "Cartons for Q3", warehouseId: ids.wh, lines: [{ itemId: ids.box, qty: 1000 }], supplierIds: [ids.a, ids.b] })).json.rfq;
    expect(rfq.number).toBe("RFQ-0001");
    await I("POST", `rfqs/${rfq.id}/quotes`, { supplierId: ids.a, lines: [{ itemId: ids.box, rate: 2400, gstRate: 18, leadDays: 5 }] });
    await I("POST", `rfqs/${rfq.id}/quotes`, { supplierId: ids.b, lines: [{ itemId: ids.box, rate: 2300, gstRate: 18, leadDays: 10 }] });
    const c = (await I("GET", `rfqs/${rfq.id}`)).json.comparison[0];
    expect(c).toMatchObject({ best: ids.b, saving: 1000 * 100 });
    const stranger = (await I("POST", "suppliers", { name: "Not asked" })).json.supplier.id;
    expect((await I("POST", `rfqs/${rfq.id}/quotes`, { supplierId: stranger, lines: [{ itemId: ids.box, rate: 1 }] })).status).toBe(422);
    const a = (await I("POST", `rfqs/${rfq.id}/award`, { award: [{ itemId: ids.box, supplierId: ids.b }], orderDate: day })).json;
    const [po] = await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, a.poIds[0]));
    expect(po).toMatchObject({ supplierId: ids.b, total: Math.round(1000 * 2300 * 1.18) });
    ids.poB = po.id;
    expect((await I("POST", `rfqs/${rfq.id}/award`, { award: [{ itemId: ids.box, supplierId: ids.a }], orderDate: day })).status).toBe(409);
  });
});

describe("rates, budgets and onboarding", () => {
  it("warns above the agreed rate, and refuses over budget when the workspace blocks", async () => {
    await I("POST", "supplier-rates", { supplierId: ids.a, itemId: ids.box, rate: 2350, validFrom: "2026-10-01", validTo: "2026-12-31" });
    const po = (await I("POST", "orders", { supplierId: ids.a, warehouseId: ids.wh, orderDate: day, lines: [{ itemId: ids.box, qty: 10, rate: 2400, gstRate: 18 }] })).json.order;
    expect((await I("GET", `orders/${po.id}`)).json.warnings[0]).toMatch(/above the agreed ₹23\.50/);
    // Packaging this month: ₹10,000 (REQ-0001's PO) + ₹23,000 (RFQ) + ₹240 so far.
    await I("POST", "purchase-budgets", { category: "Packaging", month: "2026-10", amount: 30000_00 });
    expect((await I("GET", "purchase-budgets?month=2026-10")).json.budgets[0]).toMatchObject({ used: 10000_00 + 23000_00 + 240_00 });
    expect((await I("GET", `orders/${po.id}`)).json.warnings.some((w: string) => /over the ₹30,000 budget/.test(w))).toBe(true);
    const meta = (await I("GET", "meta")).json;
    await I("PUT", "settings", { ...meta.settings, budgetCheck: "block" });
    expect((await I("POST", "orders", { supplierId: ids.a, warehouseId: ids.wh, orderDate: day, lines: [{ itemId: ids.box, qty: 1, rate: 100, gstRate: 18 }] })).status).toBe(409);
    // A month with room is fine.
    expect((await I("POST", "orders", { supplierId: ids.a, warehouseId: ids.wh, orderDate: "2026-11-02", lines: [{ itemId: ids.box, qty: 1, rate: 100, gstRate: 18 }] })).status).toBe(200);
    await I("PUT", "settings", { ...meta.settings, budgetCheck: "warn", requireApprovedSupplier: true });
  });

  it("only orders from approved suppliers when asked to, and never from blocked ones", async () => {
    const c = (await I("POST", "suppliers", { name: "Chennai Crates" })).json.supplier;
    expect(c.approval).toBe("pending");
    const order = () => I("POST", "orders", { supplierId: c.id, warehouseId: ids.wh, orderDate: "2026-11-03", lines: [{ itemId: ids.box, qty: 1, rate: 100, gstRate: 18 }] });
    expect((await order()).status).toBe(409);
    expect((await I("POST", `suppliers/${c.id}/onboarding`, { approval: "approved", checklist: { pan: true } }, "ed")).status).toBe(403);
    await I("POST", `suppliers/${c.id}/onboarding`, { approval: "approved", checklist: { pan: true, bank: true } });
    expect((await order()).status).toBe(200);
    await I("POST", `suppliers/${c.id}/onboarding`, { approval: "blocked" });
    expect((await order()).status).toBe(409);
  });
});

describe("receiving, returns and the match", () => {
  it("keeps rejected goods out of stock and the bill, returns some with a debit note, and matches", async () => {
    await I("POST", `orders/${ids.poB}/send`, { email: false });
    const grn = (await I("POST", "receipts", { poId: ids.poB, warehouseId: ids.wh, date: day, supplierInvoice: "BB/771", lines: [{ itemId: ids.box, qty: 1000, rate: 2300, gstRate: 18, rejected: 50, rejectReason: "Crushed" }] })).json.receipt;
    expect(await onHand()).toBe(950);
    expect(grn.lines[0]).toMatchObject({ qty: 950, rejected: 50 });
    expect(grn.subtotal).toBe(950 * 2300);
    const [po] = await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, ids.poB));
    expect(po).toMatchObject({ status: "partial" });
    expect(po.lines[0].received).toBe(950);
    // The bill (made from the receipt by Accounts) is for what was accepted.
    await A("POST", "sync");
    const [bill] = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, orgId), eq(schema.accBills.receiptId, grn.id)));
    expect(bill.subtotal).toBe(950 * 2300);
    let m = (await I("GET", "match")).json.orders.find((o: { id: string }) => o.id === ids.poB);
    expect(m.status).toBe("to_receive");
    // Twenty go back: stock out, and a debit note against the bill.
    const ret = (await I("POST", "supplier-returns", { supplierId: ids.b, receiptId: grn.id, warehouseId: ids.wh, date: day, debitNote: true, lines: [{ itemId: ids.box, qty: 20, rate: 2300, gstRate: 18, reason: "Wrong print" }] })).json;
    expect(ret.return.number).toBe("RTV-0001");
    expect(ret.debitNote?.number).toMatch(/^DN-/);
    expect(await onHand()).toBe(930);
    expect((await db.select().from(schema.accBills).where(eq(schema.accBills.id, bill.id)))[0].credited).toBe(Math.round(20 * 2300 * 1.18));
    expect((await I("POST", "supplier-returns", { supplierId: ids.b, receiptId: grn.id, warehouseId: ids.wh, date: day, lines: [{ itemId: ids.box, qty: 931, rate: 2300 }] })).status).toBe(422);
    // Closing the order short: the rest isn't coming, and what came is billed.
    await I("POST", `orders/${ids.poB}/close`, {});
    m = (await I("GET", "match")).json.orders.find((o: { id: string }) => o.id === ids.poB);
    expect(m).toMatchObject({ status: "matched", receivedValue: 950 * 2300, billedValue: 950 * 2300 });
    const perf = (await I("GET", "performance")).json.suppliers.find((x: { supplierId: string }) => x.supplierId === ids.b);
    expect(perf).toMatchObject({ rejectedPct: 5, returned: 20 * 2300 });
  });
});
