import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { addMonths, depreciation, lastDay } from "@/lib/accounting/finance";
import { call, cookieFrom, resetDb } from "../helpers";

let orgId = "";
let owner = "";
const ids: Record<string, string> = {};
const A = (method: string, path: string, body?: unknown) => call(accApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/accounts/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const acc = async (key: string) => (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((a) => a.systemKey === key)!;
const balance = async (key: string) => {
  const a = await acc(key);
  return (await A("GET", "reports/trial-balance")).json.lines.find((l: { id: string }) => l.id === a.id)?.balance ?? 0;
};

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Farah Owner", email: "farah.fin@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  const meta = (await A("GET", "meta")).json;
  for (const k of ["fixed_assets", "acc_dep", "depreciation", "prepaid", "accrued", "asset_gain", "bank"]) ids[k] = meta.accounts.find((a: { systemKey: string }) => a.systemKey === k)?.id;
  ids.rent = meta.accounts.find((a: { name: string }) => a.name === "Rent").id;
  ids.power = meta.accounts.find((a: { name: string }) => a.name === "Electricity and utilities").id;
  ids.software = meta.accounts.find((a: { name: string }) => a.name === "Software and subscriptions").id;
});
afterAll(closeDb);

describe("fixed assets", () => {
  it("has the accounts it needs", () => {
    for (const k of ["fixed_assets", "acc_dep", "depreciation", "prepaid", "accrued", "asset_gain"]) expect(ids[k], k).toBeTruthy();
  });

  it("registers an asset and posts each completed month's depreciation", async () => {
    // Bought on a bill: that's where its cost enters the books.
    await A("POST", "bills", { supplierName: "Laptop shop", date: "2026-04-01", lines: [{ accountId: ids.fixed_assets, amount: 120000_00, gstRate: 0 }] });
    const r = await A("POST", "assets", { name: "MacBook Pro", category: "Computers", assetAccountId: ids.fixed_assets, purchaseDate: "2026-04-01", inUseDate: "2026-04-01", cost: 120000_00, method: "slm", lifeMonths: 36 });
    expect(r.status).toBe(200);
    expect(r.json.asset.code).toBe("FA-0001");
    ids.asset = r.json.asset.id;
    const expected = depreciation({ cost: 120000_00, residual: 0, method: "slm", lifeMonths: 36, rate: 0, inUseDate: "2026-04-01" }, thisMonth).filter((x) => x.month < thisMonth);
    const posted = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "depreciation")));
    expect(posted).toHaveLength(expected.length);
    expect(await balance("depreciation")).toBe(expected.at(-1)!.accumulated);
    const list = (await A("GET", "assets")).json.assets;
    expect(list[0]).toMatchObject({ accumulated: expected.at(-1)!.accumulated, bookValue: 120000_00 - expected.at(-1)!.accumulated });
    const detail = (await A("GET", `assets/${ids.asset}`)).json;
    expect(detail.schedule.filter((x: { posted: boolean }) => x.posted)).toHaveLength(expected.length);
    expect(detail.schedule.at(-1).bookValue).toBe(0);
    // Bad input is refused.
    expect((await A("POST", "assets", { name: "X", assetAccountId: ids.rent, purchaseDate: "2026-04-01", inUseDate: "2026-04-01", cost: 100 })).status).toBe(422);
    expect((await A("POST", "assets", { name: "X", assetAccountId: ids.fixed_assets, purchaseDate: "2026-04-02", inUseDate: "2026-04-01", cost: 100 })).status).toBe(422);
  });

  it("disposes of an asset with a gain or loss, and can undo it", async () => {
    const r = await A("POST", `assets/${ids.asset}/dispose`, { date: `${thisMonth}-05`, amount: 90000_00, accountId: ids.bank });
    expect(r.status).toBe(200);
    expect(r.json.gain).toBe(90000_00 - r.json.bookValue);
    // Cost and depreciation are out of the books; the gain is in.
    expect(await balance("fixed_assets")).toBe(0);
    expect(await balance("acc_dep")).toBe(0);
    expect(await balance("asset_gain")).toBe(r.json.gain);
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.totalDr).toBe(tb.totalCr);
    await A("POST", `assets/${ids.asset}/undispose`, {});
    expect(await balance("fixed_assets")).toBe(120000_00);
    expect(await balance("asset_gain")).toBe(0);
  });

  it("imports an asset register", async () => {
    const res = await A("POST", "assets/import", { rows: [{ name: "Delivery van", code: "VAN-1", category: "Vehicles", purchaseDate: "2025-04-01", cost: 800000_00, method: "wdv", rate: 15, lifeYears: 8 }, { name: "Plot", code: "LAND-1", account: "1500", purchaseDate: "2020-01-01", cost: 5000000_00, method: "none" }], mode: "update" });
    const r = res.json;
    expect(res.status, JSON.stringify(r)).toBe(200);
    expect(r.created).toBe(2);
    const van = (await A("GET", "assets")).json.assets.find((a: { code: string }) => a.code === "VAN-1");
    expect(van).toMatchObject({ method: "wdv", rate: 15, lifeMonths: 96 });
    expect(van.accumulated).toBeGreaterThan(0);
  });
});

describe("repeating and spread journals", () => {
  it("accrues rent each month and reverses it the next", async () => {
    const r = await A("POST", "schedules", { kind: "recurring", name: "Rent accrual", every: "month", startDate: "2026-07-31", autoReverse: true, lines: [{ accountId: ids.rent, debit: 50000_00 }, { accountId: ids.accrued, credit: 50000_00 }] });
    expect(r.status).toBe(200);
    ids.rentSch = r.json.schedule.id;
    const rows = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "recurring")));
    const reversals = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "recurring_reversal")));
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"].filter((m) => `${m}-${m === "2026-09" ? "30" : "31"}` <= today);
    expect(rows).toHaveLength(months.length);
    // Each reversal falls on the 1st of the next month, once that's come.
    expect(reversals).toHaveLength(months.filter((m) => `${addMonths(m, 1)}-01` <= today).length);
    expect(reversals.every((x) => String(x.date).endsWith("-01"))).toBe(true);
    expect((await A("POST", "schedules", { kind: "recurring", name: "Bad", startDate: "2026-07-01", lines: [{ accountId: ids.rent, debit: 1 }, { accountId: ids.accrued, credit: 2 }] })).status).toBe(422);
  });

  it("spreads a prepaid year over its months and stops when asked", async () => {
    const r = await A("POST", "schedules", { kind: "spread", name: "Software licence", total: 120000_00, months: 12, startDate: "2026-04-01", fromAccountId: ids.prepaid, toAccountId: ids.software });
    ids.spread = r.json.schedule.id;
    const posted = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "spread")));
    // Each month posts on its last day, so on a month-end that month is already due.
    const due = Array.from({ length: 12 }, (_, i) => addMonths("2026-04", i)).filter((m) => lastDay(m) <= today).length;
    expect(posted).toHaveLength(due);
    const stopped = await A("POST", `schedules/${ids.spread}/stop`, {});
    expect(stopped.json.schedule).toMatchObject({ active: false, endDate: today });
    // What was posted stays.
    expect(await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "spread")))).toHaveLength(due);
  });
});

describe("budgets and reports", () => {
  it("compares the budget with what actually happened", async () => {
    const amounts = { [ids.rent]: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [addMonths("2026-04", i), 45000_00])), [ids.power]: { "2026-08": 5000_00 } };
    const b = (await A("POST", "budgets", { name: "FY 2026-27 plan", year: "2026", amounts })).json.budget;
    expect(b.year).toBe("2026-27");
    const r = (await A("GET", `budgets/${b.id}`)).json;
    expect(r.months).toHaveLength(12);
    const rent = r.rows.find((x: { id: string }) => x.id === ids.rent);
    const jul = rent.months.find((m: { month: string }) => m.month === "2026-07");
    expect(jul).toMatchObject({ budget: 45000_00 });
    // July's accrual is 50,000 against a 45,000 budget.
    expect(jul.actual).toBe(50000_00);
    expect(rent.variance).toBe(rent.ytdBudget - rent.ytdActual);
  });

  it("builds a cash flow statement that adds up", async () => {
    const book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
    const doc = { type: "invoice", client: { name: "Client", billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" } }, issueDate: "2026-06-10", currency: "INR", taxMode: "none", lines: [{ id: "a", name: "Work", quantity: 1, rate: 300000_00, taxBps: 0 }] };
    const d = (await B("POST", `${book}/documents`, { document: doc, issue: true })).json.document;
    await B("POST", `${book}/documents/${d.id}/payments`, { amount: 200000_00, method: "bank", paidOn: "2026-06-20", reference: "", note: "" });
    await A("POST", "sync");
    const cf = (await A("GET", "reports/cash-flow?from=2026-04-01")).json;
    expect(cf.difference).toBe(0);
    expect(cf.nonCash.find((l: { name: string }) => l.name === "Depreciation")?.amount).toBeGreaterThan(0);
    // Only the laptop was bought on a bill; imported assets' costs come in as opening balances, not purchases.
    expect(cf.investingTotal).toBe(-120000_00);
  });

  it("forecasts cash by week from what's owed and due", async () => {
    const r = (await A("GET", "reports/forecast?weeks=8")).json;
    expect(r.weeks).toHaveLength(8);
    // The unpaid ₹1 lakh on the invoice is overdue, so it's in the first week.
    expect(r.weeks[0].inflow).toBeGreaterThanOrEqual(100000_00);
    expect(r.weeks.at(-1).closing).toBe(r.opening + r.weeks.reduce((n: number, w: { inflow: number; outflow: number }) => n + w.inflow - w.outflow, 0));
  });
});
