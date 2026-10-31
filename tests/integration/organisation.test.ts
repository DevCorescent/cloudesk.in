import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgApi from "@/app/api/v1/orgs/[orgId]/org/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as apApi from "@/app/api/v1/orgs/[orgId]/approvals/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { rateFor } from "@/server/org/org";
import { call, cookieFrom, resetDb } from "../helpers";

let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const O = mk(orgApi, "org");
const A = mk(accApi, "accounts");
const I = mk(invApi, "inventory");
const H = mk(hrApi, "hr");
const P = mk(apApi, "approvals");
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: C.owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const day = "2026-09-15";
const sales = async (q = "") => {
  const tb = (await A("GET", `reports/trial-balance${q}`)).json;
  const acc = (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((a) => a.systemKey === "sales")!;
  return tb.lines.find((l: { id: string }) => l.id === acc.id)?.balance ?? 0;
};

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Neha Owner", email: "neha.org@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [who, name, role] of [["admin", "Om Admin", "admin"], ["finance", "Fiza Finance", "billing"]] as const) {
    C[who] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${who}.org@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${who}.org@example.com`));
    U[who] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
});
afterAll(closeDb);

describe("organisation structure", () => {
  it("starts with a default company and adds more, with GSTIN checks", async () => {
    const meta = (await O("GET", "meta")).json;
    expect(meta.companies).toHaveLength(1);
    expect(meta.companies[0]).toMatchObject({ isDefault: true, name: "Neha's workspace" });
    ids.co1 = meta.companies[0].id;
    expect((await O("POST", "companies", { name: "Bad", gstin: "27AAACL1234F1Z9" })).status).toBe(422);
    expect((await O("POST", "companies", { name: "Nope" }, "finance")).status).toBe(403);
    const co2 = (await O("POST", "companies", { name: "Lumen Retail Pvt Ltd", gstin: "29AAJFS2290K1ZO" })).json.company;
    expect(co2).toMatchObject({ state: "KA", isDefault: false });
    ids.co2 = co2.id;
    expect((await O("PUT", `companies/${ids.co1}`, { name: "Neha's workspace", active: false })).status).toBe(409);
  });

  it("keeps branches under companies, with regions and no loops", async () => {
    const south = (await O("POST", "branches", { companyId: ids.co2, name: "South region", kind: "region" })).json.branch;
    const blr = (await O("POST", "branches", { companyId: ids.co2, parentId: south.id, name: "Bengaluru store", code: "BLR", kind: "store", gstin: "29AAJFS2290K1ZO" })).json.branch;
    expect(blr.state).toBe("KA");
    ids.blr = blr.id;
    expect((await O("PUT", `branches/${south.id}`, { companyId: ids.co2, parentId: blr.id, name: "South region", kind: "region" })).status).toBe(422);
    ids.mum = (await O("POST", "branches", { companyId: ids.co1, name: "Mumbai office", code: "MUM" })).json.branch.id;
    // Imported, with the parent found by code in a second pass.
    const imp = (await O("POST", "branches/import", { rows: [{ name: "Mysuru outlet", code: "MYS", company: "Lumen Retail Pvt Ltd", kind: "outlet", parent: "south region" }], mode: "update" })).json;
    expect(imp.created).toBe(1);
    const mys = (await O("GET", "meta")).json.branches.find((b: { code: string }) => b.code === "MYS");
    expect(mys).toMatchObject({ kind: "store", parentId: south.id, companyId: ids.co2 });
    expect((await O("DELETE", `branches/${south.id}`)).status).toBe(409);
  });

  it("posts each company's invoices to its own books, and reports by company", async () => {
    const book = (await B("POST", "", { orgId, name: "Lumen Retail books" })).json.book.id;
    await O("POST", "links", { kind: "book", id: book, branchId: ids.blr });
    const other = (await B("POST", "", { orgId, name: "Head office books" })).json.book.id;
    const doc = { type: "invoice", client: { name: "Ravi", billing: { line1: "", line2: "", city: "", state: "Karnataka", postalCode: "", country: "IN" } }, issueDate: day, currency: "INR", taxMode: "none", lines: [{ id: "a", name: "Work", quantity: 1, rate: 1000000, taxBps: 0 }] };
    await B("POST", `${book}/documents`, { document: doc, issue: true });
    await B("POST", `${other}/documents`, { document: { ...doc, lines: [{ ...doc.lines[0], rate: 300000 }] }, issue: true });
    await A("POST", "sync");
    expect(await sales()).toBe(1300000);
    expect(await sales(`?companyId=${ids.co2}`)).toBe(1000000);
    expect(await sales(`?companyId=${ids.co1}`)).toBe(300000);
    const j = (await A("GET", `journals?companyId=${ids.co2}`)).json.journals;
    expect(j.every((x: { companyId: string }) => x.companyId === ids.co2)).toBe(true);
    // The invoice's lines carry the branch.
    expect((await A("GET", `reports/trial-balance?branchId=${ids.blr}`)).json.lines.length).toBeGreaterThan(0);
  });

  it("charges bill lines to cost centres and reports by them", async () => {
    const cc = (await O("POST", "units", { kind: "cost_centre", code: "MKT", name: "Marketing" })).json.unit;
    ids.mkt = cc.id;
    expect((await O("POST", "units", { kind: "cost_centre", code: "mkt", name: "Dup" })).status).toBe(409);
    const imp = (await O("POST", "units/import", { rows: [{ code: "OPS", name: "Operations", kind: "cc" }, { code: "OPS-WH", name: "Warehouse ops", parent: "OPS" }], mode: "update" })).json;
    expect(imp.created).toBe(2);
    const meta = (await A("GET", "meta")).json;
    expect(meta.units.map((u: { code: string }) => u.code).sort()).toEqual(["MKT", "OPS", "OPS-WH"]);
    const rent = meta.accounts.find((a: { name: string }) => a.name === "Rent").id;
    await A("POST", "bills", { supplierName: "Ad agency", date: day, lines: [{ accountId: rent, amount: 500000, gstRate: 0, costCentreId: cc.id }, { accountId: rent, amount: 200000, gstRate: 0 }] });
    const pl = (await A("GET", `reports/profit-loss?from=2026-04-01&to=2026-09-30&costCentreId=${cc.id}`)).json;
    expect(pl.totalExpenses).toBe(500000);
    expect((await A("POST", "bills", { supplierName: "X", date: day, lines: [{ accountId: rent, amount: 1, costCentreId: "00000000-0000-4000-8000-000000000000" }] })).status).toBe(422);
  });

  it("closes months: no entries or changes inside, per company or for all", async () => {
    const meta = (await A("GET", "meta")).json;
    const rent = meta.accounts.find((a: { name: string }) => a.name === "Rent").id;
    const closed = await A("POST", "periods/close", { month: "2026-08", companyId: ids.co2 });
    expect(closed.status).toBe(200);
    // Lumen Retail's August is closed; the default company's isn't.
    expect((await A("POST", "bills", { supplierName: "Late", date: "2026-08-20", companyId: ids.co2, lines: [{ accountId: rent, amount: 1000 }] })).status).toBe(409);
    expect((await A("POST", "bills", { supplierName: "Fine", date: "2026-08-20", lines: [{ accountId: rent, amount: 1000 }] })).status).toBe(200);
    expect((await A("POST", "periods/close", { month: "2026-08", companyId: ids.co2 })).status).toBe(409);
    expect((await A("POST", "periods/close", { month: "2099-01" })).status).toBe(422);
    // Reopened: allowed again.
    await A("DELETE", `periods/${closed.json.period.id}`);
    expect((await A("POST", "bills", { supplierName: "Late", date: "2026-08-20", companyId: ids.co2, lines: [{ accountId: rent, amount: 1000 }] })).status).toBe(200);
    // Year-end close needs the year to have ended.
    expect((await A("POST", "periods/year", { year: "2026" })).status).toBe(422);
    expect((await A("POST", "periods/year", { year: "2025" })).json.closed).toBe(12);
    expect((await A("POST", "bills", { supplierName: "Old", date: "2025-06-01", lines: [{ accountId: rent, amount: 1000 }] })).status).toBe(409);
  });

  it("keeps currencies and rates, the latest on or before a date", async () => {
    expect((await O("POST", "currencies", { code: "INR", name: "Rupee" })).status).toBe(422);
    await O("POST", "currencies", { code: "USD", name: "US dollar", symbol: "$" });
    await O("POST", "rates", { currency: "USD", date: "2026-09-01", rate: 83.5 });
    await O("POST", "rates", { currency: "USD", date: "2026-09-10", rate: 83.9 });
    expect(await rateFor(orgId, "USD", "2026-09-05")).toBe(83.5);
    expect(await rateFor(orgId, "USD", "2026-09-30")).toBe(83.9);
    expect(await rateFor(orgId, "USD", "2026-08-01")).toBeNull();
    // Imported, adding a common currency on the way.
    const r = (await O("POST", "rates/import", { rows: [{ currency: "eur", date: "2026-09-01", rate: 90.12 }, { currency: "XYZ", date: "2026-09-01", rate: 1 }], mode: "update" })).json;
    expect(r).toMatchObject({ updated: 1 });
    expect(r.errors).toHaveLength(1);
    expect(await rateFor(orgId, "EUR", "2026-09-02")).toBe(90.12);
  });

  it("uses groups as approvers", async () => {
    const g = (await O("POST", "groups", { name: "Finance team", members: [U.finance] })).json.group;
    await P("POST", "policies", { kind: "acc.journal", name: "Journals", steps: [{ name: "Finance", approvers: [{ type: "group", groupId: g.id }] }] });
    const meta = (await A("GET", "meta")).json;
    const bank = meta.accounts.find((a: { subtype: string }) => a.subtype === "bank").id;
    const cap = meta.accounts.find((a: { name: string }) => a.name === "Owner's capital").id;
    await A("POST", "journals", { date: day, narration: "Capital", lines: [{ accountId: bank, debit: 100000, credit: 0 }, { accountId: cap, debit: 0, credit: 100000 }] }, "admin");
    const q = (await P("GET", "queue", undefined, "finance")).json.requests;
    expect(q[0].steps[0].who).toBe("anyone in Finance team");
    expect((await P("GET", "queue", undefined, "owner")).json.requests).toHaveLength(0);
  });

  it("limits members to companies and branches across accounts, inventory and HR", async () => {
    // Inventory locations in two branches.
    const wh = (await I("GET", "meta")).json.warehouses[0].id;
    await O("POST", "links", { kind: "warehouse", id: wh, branchId: ids.mum });
    const blrWh = (await I("POST", "warehouses", { name: "Bengaluru store room", state: "KA" })).json.warehouse.id;
    await O("POST", "links", { kind: "warehouse", id: blrWh, branchId: ids.blr });
    const item = (await I("POST", "items", { name: "Lamp", sku: "LMP" })).json.item.id;
    await I("POST", "adjust", { itemId: item, warehouseId: wh, qty: 5, reason: "opening" });
    await I("POST", "adjust", { itemId: item, warehouseId: blrWh, qty: 7, reason: "opening" });
    // HR people in each branch.
    const mumLoc = (await H("POST", "locations", { name: "Mumbai", state: "MH" })).json.location.id;
    const blrLoc = (await H("POST", "locations", { name: "Bengaluru", state: "KA" })).json.location.id;
    await O("POST", "links", { kind: "location", id: mumLoc, branchId: ids.mum });
    await O("POST", "links", { kind: "location", id: blrLoc, branchId: ids.blr });
    ids.mumP = (await H("POST", "people", { name: "Mira Mumbai", email: "mira.org@example.com", joinDate: "2025-01-01", locationId: mumLoc, ctc: 600000_00 })).json.employee.id;
    ids.blrP = (await H("POST", "people", { name: "Bala Bengaluru", email: "bala.org@example.com", joinDate: "2025-01-01", locationId: blrLoc, ctc: 480000_00 })).json.employee.id;

    // The admin is limited to Lumen Retail.
    expect((await O("PUT", `access/${U.owner}`, { access: { companies: [ids.co2] } })).status).toBe(409);
    await O("PUT", `access/${U.admin}`, { access: { companies: [ids.co2] } });
    // Accounts: only Lumen Retail's books, and no posting elsewhere.
    expect(await sales("")).toBe(1300000);
    const tb = (await A("GET", "reports/trial-balance", undefined, "admin")).json;
    const salesAcc = (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((a) => a.systemKey === "sales")!;
    expect(tb.lines.find((l: { id: string }) => l.id === salesAcc.id).balance).toBe(1000000);
    expect((await A("GET", `reports/trial-balance?companyId=${ids.co1}`, undefined, "admin")).status).toBe(403);
    const am = (await A("GET", "meta", undefined, "admin")).json;
    expect(am.companies.map((c: { id: string }) => c.id)).toEqual([ids.co2]);
    // Inventory: only the Bengaluru store room, and its stock.
    const im = (await I("GET", "meta", undefined, "admin")).json;
    expect(im.warehouses.map((w: { id: string }) => w.id)).toEqual([blrWh]);
    expect((await I("GET", "items", undefined, "admin")).json.items[0].onHand).toBe(7);
    expect((await I("POST", "adjust", { itemId: item, warehouseId: wh, qty: 1, reason: "found" }, "admin")).status).toBe(403);
    // HR: only Bengaluru people.
    const dir = (await H("GET", "people", undefined, "admin")).json.people;
    expect(dir.map((p: { name: string }) => p.name)).toEqual(["Bala Bengaluru"]);
    expect((await H("GET", `people/${ids.mumP}`, undefined, "admin")).status).toBe(404);
    // Lifting the limit restores everything.
    await O("PUT", `access/${U.admin}`, { access: null });
    expect((await I("GET", "meta", undefined, "admin")).json.warehouses).toHaveLength(2);
  });

  it("splits payroll by company, and salary costs by cost centre", async () => {
    await db.update(schema.hrEmployees).set({ costCentreId: ids.mkt }).where(eq(schema.hrEmployees.id, ids.blrP));
    const run = (await H("POST", "payroll", { month: "2026-09" })).json.run;
    await H("POST", `payroll/${run.id}/finalise`);
    await A("POST", "sync");
    const rows = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "payroll")));
    expect(rows.map((r) => r.companyId).sort()).toEqual([ids.co1, ids.co2].sort());
    expect(rows.every((r) => r.sourceId!.startsWith(run.id))).toBe(true);
    const blrJ = rows.find((r) => r.companyId === ids.co2)!;
    const lines = await db.select().from(schema.accLines).where(eq(schema.accLines.journalId, blrJ.id));
    expect(lines.filter((l) => l.debit > 0).every((l) => l.costCentreId === ids.mkt)).toBe(true);
    // Still balanced overall.
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.totalDr).toBe(tb.totalCr);
  });

  it("never lists another workspace's stores or books to link", async () => {
    const other = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Other Owner", email: "other.org@example.com", password: "correct-horse-42" } }));
    const otherOrg = (await call(me.GET, { cookie: other })).json.organizations[0].id;
    const [p] = await db.insert(schema.projects).values({ orgId: otherOrg, name: "Someone else's café", slug: "someone-elses-cafe" }).returning();
    await db.insert(schema.invoiceOwners).values({ id: p.id, projectId: p.id });
    const links = (await O("GET", "meta")).json.links;
    expect(links.projects.some((x: { name: string }) => x.name === "Someone else's café")).toBe(false);
  });

  it("reviews who has access to what", async () => {
    const a = (await O("GET", "access")).json;
    expect(a.members.map((x: { name: string }) => x.name)).toEqual(["Fiza Finance", "Neha Owner", "Om Admin"]);
    expect(a.members.find((x: { name: string }) => x.name === "Fiza Finance").groups).toEqual(["Finance team"]);
    expect((await O("GET", "access", undefined, "finance")).status).toBe(403);
    await O("POST", "reviews", { notes: "Quarterly review", changes: ["Removed Om's company limit"] });
    expect((await O("GET", "access")).json.reviews[0]).toMatchObject({ notes: "Quarterly review", reviewer: "Neha Owner" });
  });
});
