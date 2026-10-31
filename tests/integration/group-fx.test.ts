import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as orgApi from "@/app/api/v1/orgs/[orgId]/org/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Foreign currency (invoices, payments, bills, month-end revaluation),
// intercompany entries and consolidation, and e-invoice / e-way bill files.
let orgId = "";
let owner = "";
let book = "";
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const A = mk(accApi, "accounts");
const O = mk(orgApi, "org");
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const acc = async (key: string) => (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((a) => a.systemKey === key || a.name === key)!.id;
const bal = async (key: string, q = "") => (await A("GET", `reports/trial-balance${q}`)).json.lines.find((l: { id: string }) => l.id === ids[`acc:${key}`])?.balance ?? 0;
const usClient = { name: "Dana Reyes", company: "Acme Inc", email: "", phone: "", gstin: "", billing: { line1: "500 Howard St", line2: "", city: "San Francisco", state: "CA", postalCode: "94105", country: "US" }, shipping: null };
const inClient = { name: "Meera", company: "Lumen Labs Pvt Ltd", email: "", phone: "", gstin: "29AAJFS2290K1ZO", billing: { line1: "4 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560025", country: "IN" }, shipping: null };
const issue = async (client: typeof usClient, d: Record<string, unknown>) => (await B("POST", `${book}/documents`, { document: { type: "invoice", clientId: null, client, dueDate: null, adjustments: { discount: null, charges: [], roundOff: false }, inclusive: false, ...d }, issue: true })).json.document;

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Gita Group", email: "gita.group@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  book = (await B("POST", "", { orgId, name: "Global" })).json.book.id;
  await B("PUT", `${book}/settings`, { business: { name: "Sharma & Co", legalName: "Sharma & Co LLP", email: "", phone: "", website: "", gstin: "29AAJFS2290K1ZO", pan: "", address: { line1: "12 MG Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" }, logo: "" } });
  await A("GET", "meta");
  for (const k of ["ar", "ap", "bank", "fx_gain_loss", "sales", "ic_receivable", "ic_payable", "other_income", "Professional fees", "Software and subscriptions"]) ids[`acc:${k}`] = await acc(k);
  await O("POST", "currencies", { code: "USD", name: "US dollar", symbol: "$" });
  for (const [date, rate] of [["2026-07-01", 83], ["2026-07-31", 84], ["2026-08-20", 84.5], ["2026-08-31", 85]] as const) expect((await O("POST", "rates", { currency: "USD", date, rate })).status).toBe(200);
});
afterAll(closeDb);

describe("foreign-currency invoices", () => {
  it("post at the rate on the day, restate at month end, and book the gain when paid", async () => {
    const inv = await issue(usClient, { issueDate: "2026-07-10", currency: "USD", taxMode: "none", placeOfSupply: "", lines: [{ id: "a", name: "Design retainer", hsn: "998391", quantity: 1, rate: 1000_00, taxBps: 0 }] });
    ids.usd1 = inv.id;
    await A("POST", "sync");
    // $1,000 at ₹83.
    expect(await bal("ar", "?asOf=2026-07-30")).toBe(83000_00);
    expect(await bal("sales")).toBe(83000_00);
    // Restated at ₹84 on 31 July, reversed on 1 August.
    expect(await bal("ar", "?asOf=2026-07-31")).toBe(84000_00);
    expect(await bal("fx_gain_loss", "?asOf=2026-07-31")).toBe(1000_00);
    expect(await bal("ar", "?asOf=2026-08-01")).toBe(83000_00);
    // Paid in full; ₹84,400 reached the bank: ₹1,400 gain over the invoice's rate.
    expect((await B("POST", `${book}/documents/${inv.id}/payments`, { amount: 1000_00, method: "bank", paidOn: "2026-08-20", reference: "SWIFT 1", note: "", inrAmount: 84400_00 })).status).toBe(201);
    await A("POST", "sync");
    expect(await bal("ar")).toBe(0);
    expect(await bal("fx_gain_loss")).toBe(1400_00);
    expect(await bal("bank")).toBe(84400_00);
  });

  it("uses a rate set on the invoice, and the day's rate when the rupees aren't given", async () => {
    const inv = await issue(usClient, { issueDate: "2026-09-01", currency: "USD", taxMode: "none", placeOfSupply: "", lines: [{ id: "a", name: "Support", hsn: "998391", quantity: 1, rate: 500_00, taxBps: 0 }] });
    expect((await B("POST", `${book}/documents/${inv.id}/fx-rate`, { rate: 82 })).status).toBe(200);
    await B("POST", `${book}/documents/${inv.id}/payments`, { amount: 200_00, method: "bank", paidOn: "2026-09-10", reference: "", note: "" });
    await A("POST", "sync");
    // $500 at ₹82 = ₹41,000; $200 settles ₹16,400 but brings ₹17,000 at ₹85: ₹600 gain.
    expect(await bal("ar")).toBe(41000_00 - 16400_00);
    expect(await bal("fx_gain_loss")).toBe(1400_00 + 600_00);
    // $300 open at 30 September (₹85): restated up ₹900, reversed on 1 October.
    expect(await bal("ar", "?asOf=2026-09-30")).toBe(24600_00 + 900_00);
    const [rv] = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "fx_revaluation"), eq(schema.accJournals.date, "2026-09-30")));
    expect(rv.total).toBe(900_00);
  });
});

describe("foreign-currency bills", () => {
  it("are converted at their rate, and paying more rupees than that is an exchange loss", async () => {
    const b = (await A("POST", "bills", { supplierName: "Amazon Web Services", date: "2026-09-05", currency: "USD", fxRate: 84, itc: false, lines: [{ accountId: ids["acc:Software and subscriptions"], amount: 100_00, gstRate: 0 }] })).json.bill;
    expect(b).toMatchObject({ currency: "USD", fxTotal: 100_00, total: 8400_00 });
    expect((await A("POST", "bills", { supplierName: "AWS", date: "2026-09-05", currency: "USD", fxRate: 84, tdsSection: "194J-tech", lines: [{ accountId: ids["acc:Software and subscriptions"], amount: 100_00 }] })).status).toBe(422);
    // A payment run is for rupee bills.
    expect((await A("POST", "payments", { date: "2026-09-12", accountId: ids["acc:bank"], items: [{ billId: b.id, amount: 8400_00 }] })).status).toBe(422);
    expect((await A("POST", `bills/${b.id}/payments`, { accountId: ids["acc:bank"], amount: 8520_00, date: "2026-09-12" })).status).toBe(422);
    expect((await A("POST", `bills/${b.id}/payments`, { accountId: ids["acc:bank"], amount: 8520_00, fxAmount: 100_00, date: "2026-09-12" })).status).toBe(200);
    const [after] = await db.select().from(schema.accBills).where(eq(schema.accBills.id, b.id));
    expect(after.status).toBe("paid");
    expect(await bal("ap")).toBe(0);
    expect(await bal("fx_gain_loss")).toBe(2000_00 - 120_00);
  });
});

describe("intercompany and consolidation", () => {
  it("posts both sides, mirrors the positions and eliminates them", async () => {
    const meta = (await A("GET", "meta")).json;
    const main = meta.companies.find((c: { isDefault: boolean }) => c.isDefault).id;
    const exp = (await O("POST", "companies", { name: "Sharma Exports Pvt Ltd" })).json.company.id;
    expect((await A("POST", "intercompany", { date: "2026-09-20", fromCompanyId: main, toCompanyId: main, amount: 100, fromAccountId: ids["acc:bank"], toAccountId: ids["acc:bank"] })).status).toBe(422);
    expect((await A("POST", "intercompany", { date: "2026-09-20", fromCompanyId: main, toCompanyId: exp, amount: 100, fromAccountId: ids["acc:ic_receivable"], toAccountId: ids["acc:bank"] })).status).toBe(422);
    // Funding: ₹50,000 from the main company's bank into the other's.
    const fund = (await A("POST", "intercompany", { date: "2026-09-20", fromCompanyId: main, toCompanyId: exp, amount: 50000_00, fromAccountId: ids["acc:bank"], toAccountId: ids["acc:bank"], narration: "Working capital" })).json.entry;
    expect(fund.number).toBe("IC-0001");
    // A ₹10,000 management fee charged by main to the other company.
    await A("POST", "intercompany", { date: "2026-09-25", fromCompanyId: main, toCompanyId: exp, amount: 10000_00, fromAccountId: ids["acc:other_income"], toAccountId: ids["acc:Professional fees"], narration: "Management fee" });
    expect(await bal("ic_receivable", `?asOf=2026-09-30&companyId=${main}`)).toBe(60000_00);
    expect(await bal("ic_payable", `?asOf=2026-09-30&companyId=${exp}`)).toBe(60000_00);
    const c = (await A("GET", `consolidation?from=2026-04-01&to=2026-09-30`)).json;
    expect(c.balanced).toBe(true);
    expect(c.pairs).toEqual([expect.objectContaining({ aSays: 60000_00, bSays: -60000_00, difference: 0 })]);
    const row = (id: string) => c.lines.find((l: { accountId: string }) => l.accountId === id);
    expect(row(ids["acc:ic_receivable"])).toMatchObject({ eliminated: -60000_00, consolidated: 0 });
    expect(row(ids["acc:ic_payable"])).toMatchObject({ eliminated: -60000_00, consolidated: 0 });
    expect(row(ids["acc:other_income"])).toMatchObject({ consolidated: 0 });
    expect(row(ids["acc:Professional fees"])).toMatchObject({ consolidated: 0 });
    // The bank isn't eliminated: money really moved between the two.
    expect(row(ids["acc:bank"]).eliminated).toBe(0);
    expect(c.profit.consolidated).toBe(c.profit[main] + c.profit[exp]);
    await A("DELETE", `intercompany/${fund.id}`);
    expect(await bal("ic_receivable", `?companyId=${main}`)).toBe(10000_00);
  });
});

describe("e-invoices and e-way bills", () => {
  it("lists business invoices with what's missing, exports NIC JSON, and records the IRN", async () => {
    const good = await issue(inClient, { issueDate: "2026-09-08", currency: "INR", taxMode: "gst", placeOfSupply: "Karnataka", lines: [{ id: "a", name: "Steel shelving unit", hsn: "94032090", quantity: 4, unit: "pcs", rate: 12500_00, taxBps: 1800 }] });
    const bad = await issue(inClient, { issueDate: "2026-09-09", currency: "INR", taxMode: "gst", placeOfSupply: "Karnataka", lines: [{ id: "a", name: "Consulting", hsn: "", quantity: 1, rate: 1000_00, taxBps: 1800 }] });
    const list = (await A("GET", "einvoice?month=2026-09")).json.documents;
    expect(list.find((d: { id: string }) => d.id === good.id)).toMatchObject({ problems: [], goods: true, totalInr: 59000 });
    expect(list.find((d: { id: string }) => d.id === bad.id).problems[0]).toMatch(/no HSN/);
    // The export invoices are listed too (abroad, in July).
    expect((await A("GET", "einvoice?month=2026-07")).json.documents[0]).toMatchObject({ currency: "USD", totalInr: 83000 });
    const file = await A("POST", "einvoice-export", { ids: [good.id] });
    const json = JSON.parse(file.text);
    expect(json[0]).toMatchObject({ Version: "1.1", DocDtls: { Typ: "INV", No: good.number }, ValDtls: { AssVal: 50000, CgstVal: 4500, SgstVal: 4500, TotInvVal: 59000 } });
    expect((await A("POST", "einvoice-export", { ids: [good.id, bad.id] })).status).toBe(422);
    // E-way bill: needs the transport first.
    expect((await A("GET", `einvoice/${good.id}/eway`)).status).toBe(422);
    const irn = "a".repeat(64);
    expect((await A("PUT", `einvoice/${good.id}`, { irn, ackNo: "112610000012345", ackDate: "2026-09-08", transport: { vehicleNo: "KA01AB1234", distanceKm: 12 } })).status).toBe(200);
    const ewb = JSON.parse((await A("GET", `einvoice/${good.id}/eway`)).text);
    expect(ewb.billLists[0]).toMatchObject({ docNo: good.number, vehicleNo: "KA01AB1234", transDistance: "12", totInvValue: 59000 });
    expect((await A("GET", "einvoice?month=2026-09")).json.documents.find((d: { id: string }) => d.id === good.id).record.irn).toBe(irn);
    expect((await A("PUT", `einvoice/${good.id}`, { irn: "short" })).status).toBe(422);
  });
});
