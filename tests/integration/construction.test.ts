import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/construction/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// A contract with a BOQ (imported), measurements, RA-1 with retention,
// advance recovery, GST and TDS, a lower certified figure, money received,
// the next bill taking only new work, the site diary — and the books.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const K = mk(api, "construction");
const A = mk(accApi, "accounts");
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Chetan Contractor", email: "chetan.con@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.site = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sita Site", email: "sita.con@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "sita.con@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  await K("GET", "meta");
});
afterAll(closeDb);

describe("a contract", () => {
  it("sets up a contract and imports its BOQ", async () => {
    const c = (await K("POST", "contracts", { name: "School block B", client: "Pune Municipal Corp", workOrderNo: "WO/2026/114", retentionPct: 5, advancePct: 10, gstRate: 18, tdsPct: 2 })).json.contract;
    ids.c = c.id;
    const r = (await K("POST", `contracts/${c.id}/boq/import`, { rows: [{ code: "2.1", description: "PCC 1:4:8", unit: "cum", qty: 100, rate: 5000_00 }, { code: "5.3", description: "Brickwork in CM 1:6", unit: "cum", qty: 200, rate: 6500_00 }], mode: "update" })).json;
    expect(r).toMatchObject({ created: 2 });
    const items = (await K("GET", `contracts/${c.id}/boq`)).json.items;
    ids.pcc = items[0].id;
    ids.brick = items[1].id;
    expect((await K("GET", "contracts")).json.contracts[0]).toMatchObject({ boqValue: 1800000_00, certified: 0, progress: 0 });
    expect((await K("POST", `contracts/${c.id}/boq`, { code: "2.1", description: "x", unit: "cum", qty: 1, rate: 1 })).status).toBe(409);
  });

  it("records measurements as numbers × dimensions, never in the future", async () => {
    expect((await K("POST", `contracts/${ids.c}/measurements`, { itemId: ids.pcc, date: "2099-01-01", nos: 1, length: 1 }, "site")).status).toBe(422);
    await K("POST", `contracts/${ids.c}/measurements`, { itemId: ids.pcc, date: today, location: "Grid A1–A4", nos: 2, length: 10, breadth: 1.5, depth: 1 }, "site");
    await K("POST", `contracts/${ids.c}/measurements`, { itemId: ids.pcc, date: today, nos: 1, length: 10, breadth: 1, depth: 1 }, "site");
    await K("POST", `contracts/${ids.c}/measurements`, { itemId: ids.brick, date: today, nos: 1, qty: 40 }, "site");
    const boq = (await K("GET", `contracts/${ids.c}/boq`)).json.items;
    expect(boq.map((i: { measured: number }) => i.measured)).toEqual([40, 40]);
  });

  it("prepares RA-1 with retention, advance recovery, GST and TDS, and certifies a lower figure", async () => {
    await K("POST", `contracts/${ids.c}/payments`, { kind: "advance", amount: 100000_00, date: today, reference: "MOB-ADV" });
    expect((await K("POST", `contracts/${ids.c}/payments`, { kind: "advance", amount: 1, date: today }, "site")).status).toBe(403);
    const b = (await K("POST", `contracts/${ids.c}/bills`, { upTo: today }, "site")).json.bill;
    expect(b).toMatchObject({ seq: 1, gross: 460000_00, retention: 23000_00, advance: 46000_00, gst: 82800_00, tds: 9200_00, net: 464600_00, status: "draft" });
    expect((await K("POST", `contracts/${ids.c}/bills`, { upTo: today }, "site")).status).toBe(409);
    // Measurements in a bill can't be removed.
    const m = (await K("GET", `contracts/${ids.c}/measurements`)).json.measurements[0];
    expect((await K("DELETE", `measurements/${m.id}`, undefined, "site")).status).toBe(409);
    await K("POST", `bills/${b.id}/status`, { to: "submitted" }, "site");
    expect((await K("POST", `bills/${b.id}/status`, { to: "certified" }, "site")).status).toBe(403);
    const cert = (await K("POST", `bills/${b.id}/status`, { to: "certified", certifiedGross: 450000_00, clientRef: "PMC/CERT/88" })).json.bill;
    expect(cert).toMatchObject({ status: "certified", gross: 450000_00, retention: 22500_00, advance: 45000_00, gst: 81000_00, tds: 9000_00, net: 454500_00 });
    ids.b1 = b.id;
  });

  it("takes money against the bill, and the next bill takes only new work", async () => {
    expect((await K("POST", `contracts/${ids.c}/payments`, { kind: "bill", billId: ids.b1, amount: 500000_00, date: today })).status).toBe(422);
    await K("POST", `contracts/${ids.c}/payments`, { kind: "bill", billId: ids.b1, amount: 454500_00, date: today, reference: "RTGS-1" });
    expect((await db.select().from(schema.conBills).where(eq(schema.conBills.id, ids.b1)))[0].status).toBe("paid");
    expect((await K("POST", `contracts/${ids.c}/bills`, { upTo: today })).status).toBe(409);
    await K("POST", `contracts/${ids.c}/measurements`, { itemId: ids.brick, date: today, qty: 10 }, "site");
    const b2 = (await K("POST", `contracts/${ids.c}/bills`, { upTo: today }, "site")).json.bill;
    expect(b2.lines.map((l: { code: string; prev: number; qty: number }) => [l.code, l.prev, l.qty])).toEqual([["5.3", 40, 10]]);
    // Only what's left of the advance is recovered: 1,00,000 − 45,000 = 55,000, and 10% of 65,000 is 6,500.
    expect(b2.advance).toBe(6500_00);
    expect((await K("POST", `contracts/${ids.c}/payments`, { kind: "retention", amount: 30000_00, date: today })).status).toBe(422);
  });

  it("keeps a site diary, one entry a day", async () => {
    await K("POST", `contracts/${ids.c}/diary`, { date: today, weather: "Clear", labour: [{ trade: "Mason", count: 8 }, { trade: "Helper", count: 12 }], work: "Brickwork 1st floor, grid B" }, "site");
    await K("POST", `contracts/${ids.c}/diary`, { date: today, work: "Brickwork 1st floor, grid B and C" }, "site");
    const d = (await K("GET", `contracts/${ids.c}/diary`)).json.diary;
    expect(d).toHaveLength(1);
    expect(d[0].work).toBe("Brickwork 1st floor, grid B and C");
  });

  it("posts certified bills and receipts to the books", async () => {
    await A("GET", "meta");
    await A("POST", "sync");
    const js = await db.select().from(schema.accJournals).where(eq(schema.accJournals.orgId, orgId));
    expect(js.filter((j) => j.sourceType === "ra_bill").map((j) => Number(j.total))).toEqual([531000_00]);
    expect(js.filter((j) => j.sourceType === "contract_receipt").map((j) => Number(j.total)).sort((a, b) => a - b)).toEqual([100000_00, 454500_00]);
    // The advance is fully accounted: received 1,00,000, recovered 45,000 → 55,000 still owed back as work.
    const lines = await db.select({ key: schema.accAccounts.systemKey, debit: schema.accLines.debit, credit: schema.accLines.credit }).from(schema.accLines).innerJoin(schema.accAccounts, eq(schema.accAccounts.id, schema.accLines.accountId)).where(eq(schema.accLines.orgId, orgId));
    const bal = (k: string) => lines.filter((l) => l.key === k).reduce((n, l) => n + Number(l.credit) - Number(l.debit), 0);
    expect(bal("customer_advances")).toBe(55000_00);
    expect(bal("contract_revenue")).toBe(450000_00);
    expect(-bal("tds_receivable")).toBe(9000_00);
    expect(-bal("retention_receivable")).toBe(22500_00);
    expect(bal("ar")).toBe(0);
  });
});
