import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/maintenance/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// The register (from the fixed-asset register too), meter readings raising a
// preventive work order, a breakdown reported by someone without work-order
// rights, downtime, labour, spare parts from stock (posted to repairs), the
// plan counting from when it was done, contracts, and reliability.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const M = mk(api, "maintenance");
const I = mk(invApi, "inventory");
const A = mk(accApi, "accounts");
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Maya Plant", email: "maya.mnt@example.com", password: "correct-horse-42" } }));
  const meRes = (await call(me.GET, { cookie: C.owner })).json;
  orgId = meRes.organizations[0].id;
  U.owner = meRes.user.id;
  for (const [k, role] of [["tech", "editor"], ["viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "tech" ? "Tariq Tech" : "Vee Viewer", email: `${k}.mnt@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.mnt@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.filter = (await I("POST", "items", { name: "Oil filter", sku: "OF-1", unit: "pcs", gstRate: 18 })).json.item.id;
  await I("POST", "receipts", { warehouseId: ids.wh, date: daysAgo(10), lines: [{ itemId: ids.filter, qty: 10, rate: 45000, gstRate: 18 }] });
  await M("PUT", "settings", { partsWarehouseId: ids.wh, labourRate: 400_00 });
});
afterAll(closeDb);

describe("register and preventive plans", () => {
  it("registers assets with components, and refuses loops and falling meters", async () => {
    const gen = (await M("POST", "assets", { name: "Diesel generator 250 kVA", category: "Power", location: "Plant 1", make: "Kirloskar", serial: "KG-998", criticality: "high", meterUnit: "hours" })).json.asset;
    expect(gen.code).toBe("AST-0001");
    ids.gen = gen.id;
    const alt = (await M("POST", "assets", { name: "Alternator", parentId: gen.id })).json.asset;
    expect((await M("PUT", `assets/${gen.id}`, { name: gen.name, parentId: alt.id, meterUnit: "hours" })).status).toBe(422);
    expect((await M("POST", `assets/${gen.id}/readings`, { value: 1000, on: daysAgo(20) })).json.meter).toBe(1000);
    expect((await M("POST", `assets/${gen.id}/readings`, { value: 900, on: daysAgo(10) })).status).toBe(422);
    expect((await M("POST", `assets/${gen.id}/readings`, { value: 1, on: daysAgo(10) }, "viewer")).status).toBe(403);
  });

  it("raises a work order when the meter reaches the plan, and only one", async () => {
    const plan = (await M("POST", "plans", { assetId: ids.gen, title: "Oil and filter change", everyDays: 180, everyMeter: 250, startOn: today, startMeter: 1000, leadMeter: 10, checklist: [{ id: "a", text: "Drain oil" }, { id: "b", text: "Replace filter" }], parts: [{ itemId: ids.filter, qty: 1 }], assigneeId: U.tech })).json.plan;
    ids.plan = plan.id;
    expect((await M("POST", "plans", { assetId: ids.gen, title: "No repeat", startOn: today })).status).toBe(422);
    expect((await M("POST", `assets/${ids.gen}/readings`, { value: 1200, on: daysAgo(5) })).json.raised).toBe(0);
    const r = (await M("POST", `assets/${ids.gen}/readings`, { value: 1245, on: today })).json;
    expect(r.raised).toBe(1);
    expect((await M("POST", "plans/raise", {})).json.raised).toHaveLength(0);
    const open = (await M("GET", "orders?status=open")).json.orders;
    expect(open).toEqual([expect.objectContaining({ kind: "preventive", title: "Oil and filter change", assigneeId: U.tech, planId: plan.id })]);
    ids.pm = open[0].id;
  });

  it("works the job: checklist, labour, parts from stock, then the plan counts from now", async () => {
    expect((await M("POST", `orders/${ids.pm}/complete`, {}, "tech")).status).toBe(409);
    await M("POST", `orders/${ids.pm}/step`, { step: "start" }, "tech");
    for (const item of ["a", "b"]) await M("POST", `orders/${ids.pm}/tick`, { item, done: true }, "tech");
    await M("POST", `orders/${ids.pm}/labour`, { userId: U.tech, minutes: 90, on: today }, "tech");
    const p = (await M("POST", `orders/${ids.pm}/parts`, { lines: [{ itemId: ids.filter, qty: 2 }] }, "tech")).json;
    expect(p.partsCost).toBe(2 * 45000);
    expect((await M("POST", `orders/${ids.pm}/parts`, { lines: [{ itemId: ids.filter, qty: -3 }] }, "tech")).status).toBe(422);
    await M("POST", `orders/${ids.pm}/parts`, { lines: [{ itemId: ids.filter, qty: -1 }] }, "tech");
    const d = (await M("GET", `orders/${ids.pm}`)).json;
    expect(d.cost).toEqual({ labour: 600_00, parts: 45000, external: 0, total: 600_00 + 45000 });
    expect((await M("POST", `orders/${ids.pm}/complete`, { meter: 1240 }, "tech")).status).toBe(422);
    const done = (await M("POST", `orders/${ids.pm}/complete`, { meter: 1250 }, "tech")).json.order;
    expect(done.status).toBe("done");
    const [plan] = await db.select().from(schema.mntPlans).where(eq(schema.mntPlans.id, ids.plan));
    expect(plan).toMatchObject({ lastDoneOn: today, lastDoneMeter: 1250 });
    const bal = await db.select().from(schema.invStock).where(and(eq(schema.invStock.itemId, ids.filter), eq(schema.invStock.warehouseId, ids.wh)));
    expect(bal.reduce((n, b) => n + b.qty, 0)).toBe(9);
    const detail = (await M("GET", `assets/${ids.gen}`)).json;
    expect(detail.plans[0]).toMatchObject({ meter: 1500, due: false });
  });
});

describe("breakdowns", () => {
  it("takes a request from anyone, records downtime, and needs a cause to close", async () => {
    const req = (await M("POST", "orders", { assetId: ids.gen, kind: "breakdown", title: "Won't start", stopped: true }, "viewer")).json.order;
    expect(req).toMatchObject({ status: "requested", kind: "request" });
    expect((await M("GET", `assets/${ids.gen}`)).json.asset.status).toBe("down");
    expect((await M("POST", `orders/${req.id}/complete`, {}, "tech")).status).toBe(409);
    await M("PUT", `orders/${req.id}`, { title: "Won't start", kind: "breakdown", priority: "urgent", assigneeId: U.tech }, "tech");
    // Down for two hours.
    await db.update(schema.mntOrders).set({ downFrom: new Date(Date.now() - 2 * 3600_000) }).where(eq(schema.mntOrders.id, req.id));
    expect((await M("POST", `orders/${req.id}/complete`, {}, "tech")).status).toBe(422);
    await M("POST", `orders/${req.id}/external`, { cost: 3500_00, note: "Electrician visit" }, "tech");
    await M("POST", `orders/${req.id}/complete`, { failure: "No start", cause: "Flat battery", remedy: "Battery replaced" }, "tech");
    const a = (await M("GET", `assets/${ids.gen}`)).json;
    expect(a.asset.status).toBe("running");
    expect(a.reliability.failures).toBe(1);
    expect(a.reliability.mttr).toBeGreaterThanOrEqual(1.99);
    const rep = (await M("GET", `reports?from=${daysAgo(29)}&to=${today}`)).json;
    const g = rep.assets.find((x: { id: string }) => x.id === ids.gen);
    expect(g).toMatchObject({ failures: 1, jobs: 2, preventive: 1 });
    expect(g.availability).toBeCloseTo(1 - 2 / (30 * 24), 3);
    expect(g.cost.external).toBe(3500_00);
  });
});

describe("contracts, the fixed-asset register and the books", () => {
  it("flags contracts ending, brings in fixed assets once, and posts spare parts", async () => {
    expect((await M("POST", "contracts", { kind: "amc", vendor: "Kirloskar Service", assetIds: [ids.gen], startOn: daysAgo(340), endOn: daysAgo(-20), cost: 60000_00 }, "tech")).status).toBe(403);
    await M("POST", "contracts", { kind: "amc", vendor: "Kirloskar Service", assetIds: [ids.gen], startOn: daysAgo(340), endOn: daysAgo(-20), cost: 60000_00, visits: 4 });
    expect((await M("GET", "contracts")).json.contracts[0].state).toBe("ending");
    expect((await M("GET", "home")).json.contracts).toHaveLength(1);

    const meta = (await A("GET", "meta")).json;
    const fixedAcc = meta.accounts.find((a: { systemKey: string }) => a.systemKey === "fixed_assets").id;
    const bank = meta.accounts.find((a: { systemKey: string }) => a.systemKey === "bank").id;
    await A("POST", "assets", { name: "Forklift", category: "Vehicles", assetAccountId: fixedAcc, paidFromId: bank, purchaseDate: daysAgo(100), inUseDate: daysAgo(100), cost: 800000_00, method: "slm", lifeMonths: 96 });
    expect((await M("POST", "assets/from-fixed", {})).json.added).toBe(1);
    expect((await M("POST", "assets/from-fixed", {})).json.added).toBe(0);

    await A("POST", "sync");
    const js = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "maintenance_parts")));
    expect(js.map((j) => Number(j.total)).sort()).toEqual([45000, 90000]);
  });
});
