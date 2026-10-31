import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/masterdata/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as apApi from "@/app/api/v1/orgs/[orgId]/approvals/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Download rules and their log, the import history, saved column mappings,
// duplicates, merging two suppliers (everything moves, or nothing does), and
// supplier bank changes waiting for approval.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const D = mk(api, "masterdata");
const I = mk(invApi, "inventory");
const P = mk(apApi, "approvals");
const audits = async (action: string) => db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, action)));

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Mohan Master", email: "mohan.md@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  C.editor = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Esha Editor", email: "esha.md@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "esha.md@example.com"));
  U.editor = u.id;
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.item = (await I("POST", "items", { name: "Carton", sku: "CTN-1", unit: "pcs", gstRate: 18 })).json.item.id;
});
afterAll(closeDb);

describe("downloads", () => {
  it("checks who may download and logs every download", async () => {
    expect((await D("POST", "exports", { name: "suppliers", rows: 12, format: "xlsx" }, "editor")).status).toBe(200);
    expect((await D("PUT", "settings", { exports: "managers" }, "editor")).status).toBe(403);
    await D("PUT", "settings", { exports: "managers" });
    expect((await D("POST", "exports", { name: "suppliers", rows: 12, format: "csv" }, "editor")).status).toBe(403);
    expect((await D("POST", "exports", { name: "suppliers", rows: 12, format: "csv" })).status).toBe(200);
    expect(await audits("data.exported")).toHaveLength(2);
    expect((await audits("data.export_blocked"))[0].metadata).toMatchObject({ name: "suppliers", rows: 12 });
  });
});

describe("imports", () => {
  it("keeps each import with its failures and totals, visible to its owner and auditors", async () => {
    const run = (await D("POST", "imports", { target: "accounts.bills", fileName: "bills-oct.xlsx", mode: "add", rows: 3, totals: { total: { label: "Total", file: 30000, saved: 0, money: true } } }, "editor")).json;
    expect((await D("POST", `imports/${run.id}/finish`, { created: 2, updated: 0, skipped: 0, errors: [] })).status).toBe(404);
    const done = (await D("POST", `imports/${run.id}/finish`, { created: 2, updated: 0, skipped: 0, errors: [{ row: 4, message: "Unknown supplier", data: { supplier: "X" } }], totals: { total: { label: "Total", file: 30000, saved: 20000, money: true } } }, "editor")).json.import;
    expect(done).toMatchObject({ status: "done", failed: 1, created: 2 });
    expect((await D("POST", `imports/${run.id}/finish`, { created: 2, updated: 0, skipped: 0 }, "editor")).status).toBe(404);
    expect((await D("GET", "imports")).json.imports[0]).toMatchObject({ fileName: "bills-oct.xlsx", by: "Esha Editor", hasErrors: true });
    expect((await D("GET", `imports/${run.id}`)).json.import.totals.total).toEqual({ label: "Total", file: 30000, saved: 20000, money: true });
    await D("POST", "imports", { target: "inventory.items", rows: 1 });
    expect((await D("GET", "imports", undefined, "editor")).json.imports).toHaveLength(1);
    expect(await audits("data.imported")).toHaveLength(1);
  });

  it("saves column mappings by name, replacing one saved again", async () => {
    const m = { target: "inventory.suppliers", name: "Tally export", headers: ["Party Name", "GSTIN/UIN"], mapping: { "Party Name": "name", "GSTIN/UIN": "gstin" } };
    await D("POST", "mappings", m);
    await D("POST", "mappings", { ...m, mapping: { "Party Name": "name", "GSTIN/UIN": null } });
    const list = (await D("GET", "mappings?target=inventory.suppliers")).json.mappings;
    expect(list).toHaveLength(1);
    expect(list[0].mapping).toEqual({ "Party Name": "name", "GSTIN/UIN": null });
  });
});

describe("duplicates and merging", () => {
  it("finds suppliers and items that look the same", async () => {
    ids.keep = (await I("POST", "suppliers", { name: "Apex Packaging Pvt Ltd", gstin: "27AAACS1234K1ZH", state: "MH" })).json.supplier.id;
    ids.drop = (await I("POST", "suppliers", { name: "APEX PACKAGING", email: "sales@apex.example", phone: "9820012345", state: "MH" })).json.supplier.id;
    await I("POST", "items", { name: "carton ", sku: "CTN-9", unit: "pcs", gstRate: 18 });
    const g = (await D("GET", "duplicates")).json.groups;
    expect(g.find((x: { kind: string; reason: string }) => x.kind === "suppliers" && x.reason === "Same name").records.map((r: { id: string }) => r.id).sort()).toEqual([ids.keep, ids.drop].sort());
    expect(g.find((x: { kind: string; reason: string }) => x.kind === "items" && x.reason === "Same name")).toBeTruthy();
  });

  it("merges one supplier into another — orders, RFQs and details move — or nothing moves", async () => {
    const po = (await I("POST", "orders", { supplierId: ids.drop, warehouseId: ids.wh, orderDate: "2026-10-20", lines: [{ itemId: ids.item, qty: 1, rate: 100, gstRate: 18 }] })).json.order;
    const rfq = (await I("POST", "rfqs", { title: "Cartons", warehouseId: ids.wh, lines: [{ itemId: ids.item, qty: 10 }], supplierIds: [ids.keep, ids.drop] })).json.rfq;
    // Both quoted on the same RFQ: that can only exist once per supplier, so the merge is refused and nothing moves.
    await I("POST", `rfqs/${rfq.id}/quotes`, { supplierId: ids.keep, lines: [{ itemId: ids.item, rate: 90 }] });
    await I("POST", `rfqs/${rfq.id}/quotes`, { supplierId: ids.drop, lines: [{ itemId: ids.item, rate: 95 }] });
    expect((await D("POST", "merge/suppliers", { keepId: ids.keep, dropId: ids.drop, confirm: true }, "editor")).status).toBe(403);
    expect((await D("POST", "merge/suppliers", { keepId: ids.keep, dropId: ids.drop })).status).toBe(422);
    const refused = await D("POST", "merge/suppliers", { keepId: ids.keep, dropId: ids.drop, confirm: true });
    expect(refused.status).toBe(409);
    expect((await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, po.id)))[0].supplierId).toBe(ids.drop);
    await db.delete(schema.invRfqQuotes).where(and(eq(schema.invRfqQuotes.rfqId, rfq.id), eq(schema.invRfqQuotes.supplierId, ids.drop)));
    // A quote on another RFQ moves with them (that table keeps supplier ids without a foreign key).
    const rfq2 = (await I("POST", "rfqs", { title: "More", warehouseId: ids.wh, lines: [{ itemId: ids.item, qty: 5 }], supplierIds: [ids.drop] })).json.rfq;
    await I("POST", `rfqs/${rfq2.id}/quotes`, { supplierId: ids.drop, lines: [{ itemId: ids.item, rate: 80 }] });
    const r = (await D("POST", "merge/suppliers", { keepId: ids.keep, dropId: ids.drop, confirm: true })).json;
    expect(r.moved).toMatchObject({ inv_purchase_orders: 1, inv_rfqs: 2, inv_rfq_quotes: 1 });
    expect((await db.select().from(schema.invRfqQuotes).where(eq(schema.invRfqQuotes.rfqId, rfq2.id)))[0].supplierId).toBe(ids.keep);
    expect((await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, po.id)))[0].supplierId).toBe(ids.keep);
    expect((await db.select().from(schema.invRfqs).where(eq(schema.invRfqs.id, rfq.id)))[0].supplierIds).toEqual([ids.keep]);
    const [kept] = await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.id, ids.keep));
    expect(kept).toMatchObject({ name: "Apex Packaging Pvt Ltd", gstin: "27AAACS1234K1ZH", email: "sales@apex.example", phone: "9820012345" });
    expect(await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.id, ids.drop))).toHaveLength(0);
    expect((await audits("data.suppliers_merged"))[0].metadata).toMatchObject({ removed: "APEX PACKAGING" });
  });
});

describe("supplier bank changes", () => {
  it("wait for approval when the workspace asks for it, and are always logged", async () => {
    const sup = (await I("POST", "suppliers", { name: "Bharat Boxes", state: "MH", bank: { name: "Bharat", account: "111122223333", ifsc: "HDFC0000001" } })).json.supplier;
    const body = (account: string) => ({ name: "Bharat Boxes", state: "MH", bank: { name: "Bharat", account, ifsc: "HDFC0000001" } });
    // No policy: changed straight away, and logged.
    expect((await I("PUT", `suppliers/${sup.id}`, body("444455556666"), "editor")).json.supplier.bank.account).toBe("444455556666");
    expect(await audits("inventory.supplier_bank_changed")).toHaveLength(1);
    await P("POST", "policies", { kind: "inv.supplier_bank", name: "Bank changes", steps: [{ name: "Owner", approvers: [{ type: "role", role: "owner" }] }] });
    const r = (await I("PUT", `suppliers/${sup.id}`, body("999988887777"), "editor")).json.supplier;
    expect(r).toMatchObject({ bankPendingApproval: true, bank: { account: "444455556666" } });
    expect(r.pendingBank.account).toBe("999988887777");
    // Other changes still save straight away.
    expect((await I("PUT", `suppliers/${sup.id}`, { ...body("444455556666"), phone: "022-1234" }, "editor")).json.supplier.phone).toBe("022-1234");
    const q = (await P("GET", "queue")).json.requests.find((x: { kind: string }) => x.kind === "inv.supplier_bank");
    expect(q.label).toBe("New bank details for Bharat Boxes");
    await P("POST", `requests/${q.id}/decide`, { approve: true });
    const [after] = await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.id, sup.id));
    expect(after.bank).toMatchObject({ account: "999988887777" });
    expect(after.pendingBank).toBeNull();
  });
});
