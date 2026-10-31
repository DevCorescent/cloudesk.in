import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as books from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { buildRows, matchColumns, plain, tableFrom } from "@/lib/import/engine";
import { target } from "@/lib/import/targets";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let orgId = "";
let bookId = "";
const mk = (mod: { GET: unknown; POST: unknown }, base: string) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = mk(invApi, "inventory");
const H = mk(hrApi, "hr");
const A = mk(accApi, "accounts");
const B = (method: string, path: string, body?: unknown) => call(books[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });

/** What the screen does: read a grid, match columns, clean rows. */
const prepare = (id: Parameters<typeof target>[0], grid: unknown[][]) => {
  const t = target(id);
  const tab = tableFrom(grid, t);
  const mapping = matchColumns(tab.headers, tab.rows, t).map((m) => m.field);
  return buildRows(tab.rows, mapping, t).map(plain);
};

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Nina Import", email: "nina.import@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  bookId = (await B("POST", "", { orgId, name: "Nina Traders" })).json.book.id;
});
afterAll(closeDb);

describe("smart imports", () => {
  it("imports items from a messy stock sheet: suppliers and locations added, stock opened", async () => {
    await I("GET", "meta");
    const grid = [
      ["Stock summary as on 24-10-2026", "", "", "", "", ""],
      [],
      ["Item Code", "Particulars", "UOM", "Closing Qty", "Rate (₹)", "Godown", "Vendor", "GST"],
      ["BOX-M", "Shipping box — medium", "Nos", "1,200", "24.50", "Bhiwandi", "Sharma Packaging", "12%"],
      ["TAPE", "Packing tape", "pcs", "300", "₹ 45", "", "Sharma Packaging", "18"],
      ["", "No name here", "pcs", "5", "1", "", "", "18"],
    ];
    const rows = prepare("inventory.items", grid);
    const r = await I("POST", "items/import", { rows, mode: "update" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ created: 3, updated: 0, errors: [] });
    const items = (await I("GET", "items")).json.items;
    const box = items.find((i: { sku: string }) => i.sku === "BOX-M");
    expect(box).toMatchObject({ name: "Shipping box — medium", unit: "pcs", avgCost: 2450, gstRate: 12, onHand: 1200 });
    const meta = (await I("GET", "meta")).json;
    expect(meta.warehouses.map((w: { name: string }) => w.name)).toContain("Bhiwandi");
    expect(meta.suppliers.map((s: { name: string }) => s.name)).toEqual(["Sharma Packaging"]);
    // Again: matched by SKU, updated, stock not doubled.
    const again = await I("POST", "items/import", { rows: rows.slice(0, 1).map((x) => ({ ...x, cost: 2600 })), mode: "update" });
    expect(again.json).toMatchObject({ created: 0, updated: 1 });
    const after = (await I("GET", "items")).json.items.find((i: { sku: string }) => i.sku === "BOX-M");
    expect(after).toMatchObject({ avgCost: 2600, onHand: 1200 });
    // A bad GST rate is turned down with a reason, the rest still go in.
    const bad = await I("POST", "items/import", { rows: [{ name: "Odd", gstRate: 7 }, { name: "Fine", gstRate: 5 }], mode: "update" });
    expect(bad.json.created).toBe(1);
    expect(bad.json.errors[0]).toMatchObject({ row: 0, message: expect.stringMatching(/isn't a GST rate/) });
  });

  it("imports suppliers, filling the state from the GSTIN", async () => {
    const rows = prepare("inventory.suppliers", [["Vendor Name", "GST No", "Mobile", "Credit Period"], ["Khurja Clay Works", "09AAKFK4471M1Z2", "98370 11245", "30"], ["sharma packaging", "", "9820133410", "15"]]);
    const r = await I("POST", "suppliers/import", { rows, mode: "update" });
    expect(r.json).toMatchObject({ created: 1, updated: 1 });
    const sups = (await I("GET", "suppliers")).json.suppliers;
    expect(sups.find((s: { name: string }) => s.name === "Khurja Clay Works")).toMatchObject({ state: "UP", paymentTermsDays: 30 });
  });

  it("never changes a supplier's existing bank account from a file (that goes through approval)", async () => {
    const first = prepare("inventory.suppliers", [["Vendor Name", "Bank Account", "IFSC"], ["Khurja Clay Works", "11112222333344", "SBIN0000001"]]);
    await I("POST", "suppliers/import", { rows: first, mode: "update" });
    const swap = prepare("inventory.suppliers", [["Vendor Name", "Bank Account", "IFSC", "Mobile"], ["Khurja Clay Works", "99998888777766", "HDFC0000999", "98370 99999"]]);
    expect((await I("POST", "suppliers/import", { rows: swap, mode: "update" })).json).toMatchObject({ updated: 1 });
    const s = (await I("GET", "suppliers")).json.suppliers.find((x: { name: string }) => x.name === "Khurja Clay Works");
    expect(s.bank).toMatchObject({ account: "11112222333344", ifsc: "SBIN0000001" });
    expect(s.phone).toMatch(/99999/);
  });

  it("imports employees with departments, and reporting lines in a second pass", async () => {
    const rows = prepare("hr.people", [
      ["Employee Name", "Email ID", "Dept", "DOJ", "Reporting Manager", "Annual CTC", "Employment"],
      ["Rohit Verma", "rohit@ex.in", "Service", "1/4/2024", "Vikram Shah", "4.2 lakh", "Permanent"],
      ["Vikram Shah", "vikram@ex.in", "Operations", "15-Jan-2021", "", "18 lakh", "permanent"],
    ]);
    expect(rows[0]).toMatchObject({ joinDate: "2024-04-01", ctc: 42000000, employmentType: "full_time" });
    const r = await H("POST", "people/import", { rows, mode: "update" });
    expect(r.json).toMatchObject({ created: 2, errors: [] });
    const people = (await H("GET", "people")).json.people;
    const rohit = people.find((p: { name: string }) => p.name === "Rohit Verma");
    const vikram = people.find((p: { name: string }) => p.name === "Vikram Shah");
    expect(rohit.managerId).toBe(vikram.id);
    const depts = (await H("GET", "meta")).json.departments.map((d: { name: string }) => d.name).sort();
    expect(depts).toEqual(["Operations", "Service"]);
  });

  it("imports a chart of accounts from Tally-style groups, opening balances and bills", async () => {
    await A("GET", "meta");
    const chart = prepare("accounts.accounts", [["Ledger Code", "Ledger Name", "Primary Group"], ["1011", "ICICI Current A/c", "Bank Accounts"], ["5310", "Courier charges", "Indirect Expenses"], ["4000", "Sales", "Sales Accounts"]]);
    const r = await A("POST", "accounts/import", { rows: chart, mode: "update" });
    expect(r.json).toMatchObject({ created: 2, updated: 1 });
    const accts = (await A("GET", "meta")).json.accounts;
    expect(accts.find((a: { code: string }) => a.code === "1011")).toMatchObject({ type: "asset", subtype: "bank" });
    // Opening balances that don't quite balance: the difference is kept aside.
    const open = await A("POST", "opening/import", { date: "2026-04-01", rows: prepare("accounts.opening", [["Particulars", "Dr", "Cr"], ["1011", "2,50,000", ""], ["Owner's capital", "", "2,00,000"]]) });
    expect(open.json).toMatchObject({ created: 2, difference: 5000000 });
    const tb = (await A("GET", "reports/trial-balance")).json;
    expect(tb.totalDr).toBe(tb.totalCr);
    const bills = await A("POST", "bills/import", { rows: prepare("accounts.bills", [["Vendor", "Bill No", "Bill Date", "Expense Head", "Taxable Value", "GST %"], ["BlueDart", "BD-1", "10/10/2026", "Courier charges", "1000", "18"], ["Unknown", "X", "10/10/2026", "Spaceships", "10", "0"]]) });
    expect(bills.json.created).toBe(1);
    expect(bills.json.errors[0].message).toMatch(/no account “Spaceships”/);
    expect((await A("POST", "bills/import", { rows: prepare("accounts.bills", [["Vendor", "Bill No", "Bill Date", "Expense Head", "Taxable Value"], ["BlueDart", "BD-1", "10/10/2026", "Courier charges", "1000"]]) })).json.skipped).toBe(1);
  });

  it("imports a bank statement with withdrawal and deposit columns", async () => {
    const bank = (await A("GET", "meta")).json.accounts.find((a: { code: string }) => a.code === "1011").id;
    const rows = prepare("accounts.bank", [["Tran Date", "Particulars", "Chq No", "Withdrawals", "Deposits"], ["05-10-2026", "NEFT IN", "", "", "15,000.00"], ["06-10-2026", "ATM", "", "2,000.00", ""]]);
    const r = await A("POST", `bank/${bank}/import-rows`, { rows });
    expect(r.json).toMatchObject({ created: 2 });
    const view = (await A("GET", `bank/${bank}`)).json;
    expect(view.lines.map((l: { amount: number }) => l.amount).sort()).toEqual([-200000, 1500000]);
  });

  it("imports invoicing clients (matched by email) and items", async () => {
    const c = await B("POST", `${bookId}/clients/import`, { rows: prepare("invoicing.clients", [["Customer Name", "Firm", "Email", "GSTIN", "State"], ["Ravi Shah", "Shah Traders", "ravi@shah.in", "24AAACS1234F1Z5", "Gujarat"]]), mode: "update" });
    expect(c.json).toMatchObject({ created: 1 });
    const again = await B("POST", `${bookId}/clients/import`, { rows: [{ name: "Ravi Shah", email: "RAVI@shah.in", phone: "9898989898" }], mode: "update" });
    expect(again.json).toMatchObject({ updated: 1 });
    const clients = (await B("GET", `${bookId}/clients`)).json.clients;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ company: "Shah Traders", phone: "+91 98989 89898" });
    expect(clients[0].billing.state).toBe("Gujarat");
    const it = await B("POST", `${bookId}/items/import`, { rows: prepare("invoicing.items", [["Service", "SAC", "Price", "Tax %"], ["Consulting (per hour)", "998311", "2,500", "18%"]]), mode: "update" });
    expect(it.json.created).toBe(1);
    const items = (await B("GET", `${bookId}/items`)).json.items;
    expect(items[0]).toMatchObject({ rate: 250000, taxBps: 1800, hsn: "998311" });
  });

  it("checks rows again on the server", async () => {
    const r = await I("POST", "suppliers/import", { rows: [{ name: "X", gstin: "NOTVALID" }], mode: "update" });
    expect(r.json.errors[0].message).toMatch(/isn't a GSTIN/);
    void eq;
    void db;
    void schema;
  });
});
