import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as books from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as modules from "@/app/api/v1/orgs/[orgId]/modules/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as api from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { parseStatement, toIsoDate } from "@/lib/accounting/model";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let editor = "";
let orgId = "";
let bookId = "";
const ids: Record<string, string> = {};
const A = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/accounts/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = (method: string, path: string, body?: unknown) => call(invApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/inventory/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(books[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const day = "2026-10-10";
const doc = (patch: Record<string, unknown> = {}) => ({ type: "invoice", client: { name: "Ravi Shah", company: "Shah Traders", gstin: "24AAACS1234F1Z5", email: "", billing: { line1: "", line2: "", city: "Ahmedabad", state: "Gujarat", postalCode: "", country: "IN" } }, issueDate: day, currency: "INR", lines: [{ id: "a", name: "Consulting", hsn: "998311", quantity: 10, rate: 250000, taxBps: 1800 }], taxMode: "gst", ...patch });
const acct = async (key: string) => (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((a) => a.systemKey === key)!;
const balanceOf = async (key: string) => {
  const tb = (await A("GET", "reports/trial-balance")).json;
  const a = await acct(key);
  const l = tb.lines.find((x: { id: string }) => x.id === a.id);
  return l ? l.balance : 0;
};

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kavita Owner", email: "kavita.acc@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  editor = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Ed Itor", email: "ed.acc@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "ed.acc@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  bookId = (await B("POST", "", { orgId, name: "Shah Consulting" })).json.book.id;
});
afterAll(closeDb);

describe("statement parsing", () => {
  it("reads Indian bank CSVs: day-first dates, debit/credit columns, commas in amounts", () => {
    expect(toIsoDate("05/10/2026")).toBe("2026-10-05");
    expect(toIsoDate("5-Oct-26")).toBe("2026-10-05");
    expect(toIsoDate("31/02/2026")).toBeNull();
    const r = parseStatement('Bank of Example\nTxn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt,Balance\n05/10/2026,"UPI/Shah Traders, AHD",UTR77,,"29,500.00",100000\n06/10/2026,ATM CHARGES,,23.60,,99976\n');
    expect(r.problem).toBeNull();
    expect(r.lines).toEqual([
      { date: "2026-10-05", description: "UPI/Shah Traders, AHD", reference: "UTR77", amount: 2950000 },
      { date: "2026-10-06", description: "ATM CHARGES", reference: "", amount: -2360 },
    ]);
  });
});

describe("Accounting & GST", () => {
  it("starts with a chart of accounts and needs invoicing switched on", async () => {
    const m = await A("GET", "meta");
    expect(m.status).toBe(200);
    expect(m.json.accounts.length).toBeGreaterThan(30);
    expect(m.json.settings.defaultBankId).toBe((await acct("bank")).id);
    // Accounting needs Invoices & finance: picking it alone brings it along.
    const r = await call(modules.PUT, { method: "PUT", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules`, body: { modules: ["accounting"] } });
    expect(r.json.modules).toEqual(["invoicing", "accounting"]);
    await call(modules.PUT, { method: "PUT", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules`, body: { modules: null } });
    // The books are for owners, admins and billing.
    expect((await A("GET", "meta", undefined, editor)).status).toBe(403);
  });

  it("posts invoices and their payments, and removes a voided invoice", async () => {
    const inv = await B("POST", `${bookId}/documents`, { document: doc(), issue: true });
    expect(inv.status).toBe(201);
    ids.inv = inv.json.document.id;
    await B("POST", `${bookId}/documents/${ids.inv}/payments`, { amount: 1000000, method: "upi", paidOn: "2026-10-12" });
    const s = (await A("POST", "sync")).json;
    expect(s.added).toBe(2);
    expect(await balanceOf("ar")).toBe(2950000 - 1000000);
    expect(await balanceOf("sales")).toBe(2500000);
    const tax = (await balanceOf("cgst_out")) + (await balanceOf("sgst_out")) + (await balanceOf("igst_out"));
    expect(tax).toBe(450000);
    expect(await balanceOf("bank")).toBe(1000000);
    // Running it again changes nothing.
    expect((await A("POST", "sync")).json).toMatchObject({ added: 0, changed: 0, removed: 0 });
    // A second invoice, voided: its entry goes.
    const two = (await B("POST", `${bookId}/documents`, { document: doc({ lines: [{ id: "b", name: "Audit", hsn: "998221", quantity: 1, rate: 1000000, taxBps: 1800 }] }), issue: true })).json.document.id;
    await A("POST", "sync");
    expect(await balanceOf("sales")).toBe(3500000);
    await B("POST", `${bookId}/documents/${two}/void`, {});
    expect((await A("POST", "sync")).json.removed).toBe(1);
    expect(await balanceOf("sales")).toBe(2500000);
  });

  it("keeps bills and expenses with input GST, and pays them", async () => {
    const meta = (await A("GET", "meta")).json;
    const rent = meta.accounts.find((a: { name: string }) => a.name === "Rent").id;
    const net = meta.accounts.find((a: { name: string }) => a.name === "Internet and phone").id;
    const bill = await A("POST", "bills", { supplierName: "Sunrise Properties", billNo: "SP/10", date: day, dueDate: "2026-10-20", lines: [{ accountId: rent, description: "October rent", amount: 5000000, gstRate: 18 }], interState: false });
    expect(bill.status).toBe(200);
    expect(bill.json.bill).toMatchObject({ number: "BL-0001", subtotal: 5000000, tax: 900000, total: 5900000, status: "open" });
    ids.bill = bill.json.bill.id;
    expect(await balanceOf("ap")).toBe(5900000);
    expect((await balanceOf("cgst_in")) + (await balanceOf("sgst_in"))).toBe(900000);
    // Can't pay more than is due, or from an expense account.
    expect((await A("POST", `bills/${ids.bill}/payments`, { accountId: meta.settings.defaultBankId, amount: 9000000, date: "2026-10-15" })).status).toBe(422);
    expect((await A("POST", `bills/${ids.bill}/payments`, { accountId: rent, amount: 100, date: "2026-10-15" })).status).toBe(422);
    await A("POST", `bills/${ids.bill}/payments`, { accountId: meta.settings.defaultBankId, amount: 2000000, date: "2026-10-15", reference: "NEFT1" });
    expect((await A("GET", `bills/${ids.bill}`)).json.bill).toMatchObject({ status: "partial", amountPaid: 2000000 });
    expect(await balanceOf("ap")).toBe(3900000);
    // An expense without input credit: the GST is part of the cost.
    const cash = (await acct("cash")).id;
    const exp = await A("POST", "expenses", { supplierName: "Airtel", date: day, lines: [{ accountId: net, amount: 100000, gstRate: 18 }], itc: false, paidFrom: cash });
    expect(exp.json.bill).toMatchObject({ status: "paid", total: 118000 });
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.lines.find((l: { id: string }) => l.id === net).balance).toBe(118000);
    expect(tb.totalDr).toBe(tb.totalCr);
  });

  it("turns goods received in Inventory into bills, and posts stock adjustments", async () => {
    const meta = (await I("GET", "meta")).json;
    const wh = meta.warehouses[0].id;
    await I("PUT", `warehouses/${wh}`, { name: "Main", state: "MH", isDefault: true });
    const sup = (await I("POST", "suppliers", { name: "Sharma Packaging", state: "MH" })).json.supplier.id;
    const item = (await I("POST", "items", { name: "Box", gstRate: 12 })).json.item.id;
    await I("POST", "receipts", { supplierId: sup, warehouseId: wh, date: day, supplierInvoice: "SPK-1", lines: [{ itemId: item, qty: 100, rate: 2000, gstRate: 12 }] });
    await I("POST", "adjust", { itemId: item, warehouseId: wh, qty: -5, reason: "damaged" });
    await A("POST", "sync");
    const bills = (await A("GET", "bills")).json.bills;
    const grn = bills.find((b: { billNo: string }) => b.billNo === "SPK-1");
    expect(grn).toMatchObject({ supplierName: "Sharma Packaging", subtotal: 200000, tax: 24000, total: 224000, status: "open" });
    expect(await balanceOf("inventory")).toBe(200000 - 10000);
    expect(await balanceOf("stock_adjust")).toBe(10000);
    // A bill from goods received follows Inventory.
    expect((await A("PUT", `bills/${grn.id}`, { supplierName: "X", date: day, lines: [{ accountId: (await acct("purchases")).id, amount: 1 }] })).status).toBe(409);
  });

  it("posts payroll: costs, statutory dues and what's paid", async () => {
    const [run] = await db
      .insert(schema.hrPayrollRuns)
      .values({ orgId, month: "2026-09", status: "paid", finalisedAt: new Date("2026-09-30T10:00:00Z"), paidAt: new Date("2026-10-01T06:00:00Z"), totals: { gross: 10000000, deductions: 1500000, net: 8550000, reimbursements: 50000, cost: 10300000, pf: 360000, epf: 360000, esi: 0, eesi: 0, pt: 40000, tds: 900000 } })
      .returning();
    await A("POST", "sync");
    expect(await balanceOf("salaries")).toBe(10000000);
    expect(await balanceOf("employer_contrib")).toBe(360000);
    expect(await balanceOf("pf_payable")).toBe(720000);
    expect(await balanceOf("tds_payable")).toBe(900000);
    // 1,500,000 deducted, 1,300,000 of it statutory: the rest recovers an advance.
    expect(await balanceOf("advances")).toBe(-200000);
    expect(await balanceOf("salaries_payable")).toBe(0);
    void run;
  });

  it("imports a bank statement, matches what it can, and posts the rest from it", async () => {
    const bank = (await acct("bank")).id;
    const charges = (await acct("bank_charges")).id;
    const csv = ["Date,Description,Ref,Debit,Credit", "12/10/2026,UPI SHAH TRADERS,UTR1,,10000.00", "15/10/2026,NEFT SUNRISE PROPERTIES,NEFT1,20000.00,", "16/10/2026,SMS CHARGES,,17.70,", "17/10/2026,UNKNOWN CREDIT,X9,,500.00"].join("\n");
    const r = await A("POST", `bank/${bank}/import`, { csv });
    expect(r.json).toMatchObject({ read: 4, added: 4, matched: 2 });
    // Importing the same file again adds nothing.
    expect((await A("POST", `bank/${bank}/import`, { csv })).json).toMatchObject({ added: 0, skipped: 4 });
    const view = (await A("GET", `bank/${bank}`)).json;
    const sms = view.lines.find((l: { description: string }) => l.description === "SMS CHARGES");
    await A("POST", `bank/${bank}/create`, { bankLineId: sms.id, accountId: charges });
    const odd = view.lines.find((l: { description: string }) => l.description === "UNKNOWN CREDIT");
    await A("POST", `bank/${bank}/ignore`, { bankLineId: odd.id });
    expect((await A("GET", `bank/${bank}`)).json.lines).toHaveLength(0);
    expect(await balanceOf("bank_charges")).toBe(1770);
    // A matched entry isn't changed by a sync until it's unmatched.
    const all = (await A("GET", `bank/${bank}?status=matched`)).json.lines;
    expect(all).toHaveLength(3);
  });

  it("produces a balanced trial balance, P&L and balance sheet", async () => {
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.totalDr).toBe(tb.totalCr);
    const pl = (await A("GET", "reports/profit-loss?from=2026-04-01&to=2026-10-31")).json;
    expect(pl.totalIncome).toBe(2500000);
    expect(pl.net).toBe(pl.totalIncome - pl.totalExpenses);
    const bs = (await A("GET", "reports/balance-sheet?asOf=2026-10-31")).json;
    expect(bs.balanced).toBe(true);
    expect(bs.thisYear).toBe(pl.net);
    const ag = (await A("GET", "reports/aging")).json;
    expect(ag.receivables.total).toBe(1950000);
    expect(ag.payables.rows.map((r: { party: string }) => r.party).sort()).toEqual(["Sharma Packaging", "Sunrise Properties"]);
  });

  it("works out GSTR-1 and GSTR-3B for the month", async () => {
    const g1 = (await A("GET", "gst/gstr1?month=2026-10")).json;
    expect(g1.b2b).toHaveLength(1);
    expect(g1.b2b[0]).toMatchObject({ gstin: "24AAACS1234F1Z5", taxable: 2500000 });
    expect(g1.hsn[0]).toMatchObject({ hsn: "998311", taxable: 2500000 });
    const g3 = (await A("GET", "gst/gstr3b?month=2026-10")).json;
    expect(g3.outward.igst + g3.outward.cgst + g3.outward.sgst).toBe(450000);
    expect(g3.itc.cgst + g3.itc.sgst + g3.itc.igst).toBe(900000 + 24000);
    expect(g3.ineligible).toBe(18000);
    // More credit than tax: nothing to pay, the rest carries forward.
    expect(g3.payable.total).toBe(0);
    expect(g3.carryForward.total).toBe(924000 - 450000);
    const exp = await A("GET", "gst/gstr1/export?month=2026-10&section=hsn");
    expect(exp.text).toContain("998311");
  });

  it("locks a period: nothing changes on or before the lock date", async () => {
    await A("PUT", "settings", { lockDate: "2026-10-31" });
    const cash = (await acct("cash")).id;
    const cap = (await acct("capital")).id;
    const j = await A("POST", "journals", { date: "2026-10-20", narration: "Capital", lines: [{ accountId: cash, debit: 100000 }, { accountId: cap, credit: 100000 }] });
    expect(j.status).toBe(409);
    expect((await A("POST", `bills/${ids.bill}/void`, {})).status).toBe(409);
    // A change to a locked invoice is noted, not posted.
    await B("POST", `${bookId}/documents/${ids.inv}/payments`, { amount: 100000, method: "cash", paidOn: "2026-10-25" });
    const s = (await A("POST", "sync")).json;
    expect(s.added).toBe(0);
    expect(s.notes.some((n: { why: string }) => /locked/.test(n.why))).toBe(true);
    await A("PUT", "settings", { lockDate: null });
    expect((await A("POST", "sync")).json.added).toBe(1);
    // Manual journals must balance.
    const bad = await A("POST", "journals", { date: "2026-11-01", lines: [{ accountId: cash, debit: 100 }, { accountId: cap, credit: 90 }] });
    expect(bad.status).toBe(422);
    const ok = await A("POST", "journals", { date: "2026-11-01", narration: "Owner put in cash", lines: [{ accountId: cash, debit: 100000 }, { accountId: cap, credit: 100000 }] });
    expect(ok.json.journal.number).toBe("JV-0002");
  });
});

import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as horecaApi from "@/app/api/v1/projects/[projectId]/horeca/[[...slug]]/route";
describe("restaurant bills", () => {
  it("post paid bills: cash and UPI in, sales with service charge, GST and tips", async () => {
    const projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Masala Lane" } })).json.project.id;
    const h = (method: string, path: string, body?: unknown) => call(horecaApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/projects/${projectId}/horeca/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
    await h("PUT", "venue", { name: "Masala Lane", kind: "restaurant", taxBps: 500, serviceChargeBps: 1000 });
    const area = (await h("POST", "areas", { name: "Main" })).json.area;
    const table = (await h("POST", "tables/bulk", { areaId: area.id, prefix: "T", count: 1, seats: 4 })).json.tables[0];
    const cat = (await h("POST", "categories", { name: "Mains", station: "kitchen" })).json.category;
    const dish = (await h("POST", "menu-items", { categoryId: cat.id, name: "Dal makhani", price: 40000 })).json.item.id;
    const order = (await h("POST", "orders", { tableId: table.id, lines: [{ itemId: dish, qty: 2 }] })).json.order;
    // ₹800 food + ₹80 service = ₹880, 5% GST on both = ₹44, tip ₹50 → ₹974.
    await h("POST", `orders/${order.id}/bill`, { tip: 5000 });
    await h("POST", `orders/${order.id}/pay`, { method: "cash", amount: 50000 });
    await h("POST", `orders/${order.id}/pay`, { method: "upi", amount: 47400 });
    const before = await balanceOf("restaurant_sales");
    await A("POST", "sync");
    expect((await balanceOf("restaurant_sales")) - before).toBe(88000);
    expect(await balanceOf("tips_payable")).toBe(5000);
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.totalDr).toBe(tb.totalCr);
  });
});
