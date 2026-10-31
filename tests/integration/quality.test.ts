import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as qcApi from "@/app/api/v1/orgs/[orgId]/quality/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// A receipt inspected against a category plan; a failed lot held in
// quarantine and reported; the report worked through to a return to the
// supplier with a debit note; a passing lot; a release; and the dashboard.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const Q = mk(qcApi, "quality");
const I = mk(invApi, "inventory");
const A = mk(accApi, "accounts");
const inBin = async (binId: string, itemId: string) => Number((await db.select().from(schema.invBinStock).where(and(eq(schema.invBinStock.binId, binId), eq(schema.invBinStock.itemId, itemId))))[0]?.qty ?? 0);
const onHand = async (itemId: string) => (await db.select().from(schema.invStock).where(eq(schema.invStock.itemId, itemId))).reduce((a, r) => a + Number(r.qty), 0);
const day = "2026-10-09";
const good = { len: 50, finish: true };

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kavya Quality", email: "kavya.qc@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.ed = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Esha Inspector", email: "esha.qc@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "esha.qc@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.sup = (await I("POST", "suppliers", { name: "Fastener Co" })).json.supplier.id;
  ids.bolt = (await I("POST", "items", { name: "Hex bolt M8", sku: "M8", unit: "pcs", category: "Fasteners", gstRate: 18 })).json.item.id;
  ids.q = (await I("POST", "bins", { warehouseId: ids.wh, code: "Q-01", kind: "quarantine" })).json.bin.id;
  await Q("GET", "meta");
});
afterAll(closeDb);

describe("inspections", () => {
  it("queue themselves on receipt and hold a failed lot in quarantine with a report", async () => {
    expect((await Q("POST", "plans", { name: "Fasteners in", category: "Fasteners", stage: "receipt", sampleSize: 3, parameters: [{ id: "len", name: "Length", kind: "measure", min: 49.5, max: 50.5, unit: "mm" }, { id: "finish", name: "Finish", kind: "check" }] }, "ed")).status).toBe(403);
    await Q("POST", "plans", { name: "Fasteners in", category: "Fasteners", stage: "receipt", sampleSize: 3, parameters: [{ id: "len", name: "Length", kind: "measure", min: 49.5, max: 50.5, unit: "mm" }, { id: "finish", name: "Finish", kind: "check" }] });
    ids.grn = (await I("POST", "receipts", { supplierId: ids.sup, warehouseId: ids.wh, date: day, lines: [{ itemId: ids.bolt, qty: 100, rate: 500, gstRate: 18 }] })).json.receipt.id;
    const [insp] = (await Q("GET", "inspections?status=pending")).json.inspections;
    expect(insp).toMatchObject({ number: "QC-0001", sampleCount: 3, lotQty: 100, supplierId: ids.sup, source: { type: "receipt", id: ids.grn } });
    expect((await Q("POST", `inspections/${insp.id}/results`, { samples: [good, good] }, "ed")).status).toBe(422);
    const r = (await Q("POST", `inspections/${insp.id}/results`, { samples: [good, { len: 51, finish: true }, good] }, "ed")).json;
    expect(r.inspection).toMatchObject({ status: "failed", defective: 1, quarantined: 100 });
    ids.ncr = r.ncrId;
    expect(await inBin(ids.q, ids.bolt)).toBe(100);
    const av = (await I("GET", "availability")).json.items.find((x: { itemId: string }) => x.itemId === ids.bolt);
    expect(av).toMatchObject({ onHand: 100, quarantined: 100, available: 0 });
    const n = (await Q("GET", `ncrs/${ids.ncr}`)).json.ncr;
    expect(n).toMatchObject({ number: "NCR-0001", source: "inspection", held: 100, status: "open" });
    expect((await Q("POST", `inspections/${insp.id}/results`, { samples: [good, good, good] })).status).toBe(409);
  });

  it("works the report through to a return to the supplier with a debit note", async () => {
    await A("POST", "sync");
    // An inspector can work the report but not decide what happens to the goods.
    expect((await Q("PUT", `ncrs/${ids.ncr}`, { rootCause: "Die worn", disposition: "return" }, "ed")).status).toBe(403);
    await Q("PUT", `ncrs/${ids.ncr}`, { rootCause: "", disposition: "return", actions: [{ id: "a1", action: "Supplier to replace the die", kind: "corrective", done: false }] });
    expect((await Q("POST", `ncrs/${ids.ncr}/close`, {})).status).toBe(422);
    await Q("PUT", `ncrs/${ids.ncr}`, { rootCause: "Supplier's die is worn", disposition: "return", actions: [{ id: "a1", action: "Supplier to replace the die", kind: "corrective", done: false }] });
    expect((await Q("POST", `ncrs/${ids.ncr}/close`, {})).status).toBe(422);
    await Q("PUT", `ncrs/${ids.ncr}`, { rootCause: "Supplier's die is worn", disposition: "return", actions: [{ id: "a1", action: "Supplier to replace the die", kind: "corrective", done: true }] });
    const c = (await Q("POST", `ncrs/${ids.ncr}/close`, {})).json;
    expect(c.note).toMatch(/^Returned on RTV-0001 with debit note DN-/);
    expect(await onHand(ids.bolt)).toBe(0);
    expect(await inBin(ids.q, ids.bolt)).toBe(0);
    const [bill] = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, orgId), eq(schema.accBills.receiptId, ids.grn)));
    expect(bill.credited).toBe(Math.round(100 * 500 * 1.18));
  });

  it("passes a good lot, and releases a held one used as is", async () => {
    await I("POST", "receipts", { supplierId: ids.sup, warehouseId: ids.wh, date: day, lines: [{ itemId: ids.bolt, qty: 50, rate: 500, gstRate: 18 }] });
    let [insp] = (await Q("GET", "inspections?status=pending")).json.inspections;
    expect((await Q("POST", `inspections/${insp.id}/results`, { samples: [good, good, good] })).json.inspection.status).toBe("passed");
    await I("POST", "receipts", { supplierId: ids.sup, warehouseId: ids.wh, date: day, lines: [{ itemId: ids.bolt, qty: 20, rate: 500, gstRate: 18 }] });
    [insp] = (await Q("GET", "inspections?status=pending")).json.inspections;
    const r = (await Q("POST", `inspections/${insp.id}/results`, { samples: [good, { len: 50, finish: false }, good] })).json;
    expect(await inBin(ids.q, ids.bolt)).toBe(20);
    await Q("PUT", `ncrs/${r.ncrId}`, { rootCause: "Cosmetic only", disposition: "use" });
    expect((await Q("POST", `ncrs/${r.ncrId}/close`, {})).json.note).toBe("Released to stock");
    expect(await inBin(ids.q, ids.bolt)).toBe(0);
    expect(await onHand(ids.bolt)).toBe(70);
  });

  it("scraps a lot raised by hand, and reports the pass rate", async () => {
    const n = (await Q("POST", "ncrs", { source: "customer", itemId: ids.bolt, qty: 5, severity: "major", title: "Customer found cracked heads" }, "ed")).json.ncr;
    expect(n.number).toBe("NCR-0003");
    await Q("PUT", `ncrs/${n.id}`, { rootCause: "Over-tightened in packing", disposition: "scrap" });
    await Q("POST", `ncrs/${n.id}/close`, {});
    const h = (await Q("GET", "home")).json;
    expect(h).toMatchObject({ inspected: 3, openNcrs: 0, pending: 0 });
    expect(h.passRate).toBeCloseTo(33.3, 1);
    expect(h.suppliers[0]).toMatchObject({ name: "Fastener Co", inspected: 3 });
  });
});
