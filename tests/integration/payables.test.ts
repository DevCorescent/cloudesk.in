import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as apApi from "@/app/api/v1/orgs/[orgId]/approvals/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { tdsQuarter } from "@/lib/accounting/tds";
import { call, cookieFrom, resetDb } from "../helpers";

let orgId = "";
let owner = "";
let other = "";
const ids: Record<string, string> = {};
const A = (method: string, path: string, body?: unknown, c = owner) => call(accApi[method as "GET"], { method, cookie: c, body, path: `/api/v1/orgs/${orgId}/accounts/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const I = (method: string, path: string, body?: unknown) => call(invApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/inventory/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const P = (method: string, path: string, body?: unknown, c = owner) => call(apApi[method as "GET"], { method, cookie: c, body, path: `/api/v1/orgs/${orgId}/approvals/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const day = "2026-08-10";
const bal = async (key: string) => {
  const a = (await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).find((x) => x.systemKey === key || x.id === key)!;
  return (await A("GET", "reports/trial-balance")).json.lines.find((l: { id: string }) => l.id === a.id)?.balance ?? 0;
};
const bill = async (id: string) => (await db.select().from(schema.accBills).where(eq(schema.accBills.id, id)))[0];

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Rekha Owner", email: "rekha.pay@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  other = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bilal Billing", email: "bilal.pay@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "bilal.pay@example.com"));
  ids.bilal = u.id;
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "billing" });
  const meta = (await A("GET", "meta")).json;
  ids.prof = meta.accounts.find((a: { name: string }) => a.name === "Professional fees").id;
  ids.repairs = meta.accounts.find((a: { name: string }) => a.name === "Repairs and maintenance").id;
  ids.bank = meta.accounts.find((a: { systemKey: string }) => a.systemKey === "bank").id;
  ids.cash = meta.accounts.find((a: { systemKey: string }) => a.systemKey === "cash").id;
  ids.bank2 = (await A("POST", "accounts", { code: "1011", name: "HDFC current", type: "asset", subtype: "bank" })).json.account.id;
});
afterAll(closeDb);

describe("TDS", () => {
  it("deducts at the section's rate once the threshold is crossed, and keeps it out of what's owed", async () => {
    ids.contractor = (await I("POST", "suppliers", { name: "Sharma Contractors", pan: "AAAPS1234C", tdsSection: "194C", deductee: "other", bank: { name: "Sharma Contractors", account: "50100123456789", ifsc: "HDFC0001234" } })).json.supplier.id;
    expect((await I("POST", "suppliers", { name: "Bad", pan: "NOPE" })).status).toBe(422);
    // Over ₹30,000 on one bill: 1% for an individual.
    const sug = (await A("GET", `tds-suggest?supplierId=${ids.contractor}&amount=5000000&date=${day}`)).json;
    expect(sug).toMatchObject({ section: "194C", rate: 1, amount: 50000, panValid: true });
    const b = (await A("POST", "bills", { supplierId: ids.contractor, date: day, tdsSection: "194C", lines: [{ accountId: ids.repairs, amount: 5000000, gstRate: 18 }] })).json.bill;
    expect(b).toMatchObject({ subtotal: 5000000, total: 5900000, tdsRate: 1, tdsAmount: 50000 });
    ids.bill1 = b.id;
    expect(await bal("tds_payable")).toBe(50000);
    expect(await bal("ap")).toBe(5900000 - 50000);
    // Can't pay more than what's owed after TDS.
    expect((await A("POST", `bills/${b.id}/payments`, { accountId: ids.bank, amount: 5900000, date: day })).status).toBe(422);
  });

  it("uses 20% without a valid PAN, and the year's total for yearly thresholds", async () => {
    const nopan = (await I("POST", "suppliers", { name: "No PAN Co", tdsSection: "194J-prof" })).json.supplier.id;
    const s1 = (await A("GET", `tds-suggest?supplierId=${nopan}&amount=6000000&date=${day}`)).json;
    expect(s1).toMatchObject({ rate: 20, amount: 1200000 });
    const ca = (await I("POST", "suppliers", { name: "Iyer & Co, CAs", pan: "AAAFI1234D", tdsSection: "194J-prof" })).json.supplier.id;
    await A("POST", "bills", { supplierId: ca, date: "2026-07-01", tdsSection: "194J-prof", tdsAmount: 0, lines: [{ accountId: ids.prof, amount: 3000000, gstRate: 18 }] });
    // ₹30,000 so far plus ₹25,000 crosses ₹50,000: deducted on the whole ₹55,000.
    const s2 = (await A("GET", `tds-suggest?supplierId=${ca}&amount=2500000&date=${day}`)).json;
    expect(s2).toMatchObject({ rate: 10, amount: 550000, yearBefore: 3000000 });
  });

  it("records deposits and reports the quarter, with a 26Q-style file", async () => {
    await A("POST", "tds-deposits", { date: "2026-09-07", section: "194C", amount: 50000, accountId: ids.bank, challanNo: "00123", bsrCode: "0510002" });
    expect(await bal("tds_payable")).toBe(0);
    const r = (await A("GET", `tds?quarter=${encodeURIComponent(tdsQuarter(day))}`)).json;
    expect(r.quarter).toBe("2026-27 Q2");
    expect(r.sections.find((x: { section: string }) => x.section === "194C")).toMatchObject({ deducted: 50000, deposited: 50000, due: 0 });
    expect(r.entries[0]).toMatchObject({ supplier: "Sharma Contractors", pan: "AAAPS1234C", panValid: true, tds: 50000 });
    const csv = await A("GET", `tds-export?quarter=${encodeURIComponent("2026-27 Q2")}`);
    expect(csv.text).toContain("AAAPS1234C");
  });
});

describe("debit notes", () => {
  it("reduce what's owed on a bill and the GST credit taken, and can't exceed it", async () => {
    const dn = await A("POST", "bills", { kind: "debit_note", againstBillId: ids.bill1, supplierId: ids.contractor, date: day, lines: [{ accountId: ids.repairs, amount: 1000000, gstRate: 18 }] });
    expect(dn.status).toBe(200);
    // Debit notes, runs and receipts each count from 1, apart from bills and journals.
    expect(dn.json.bill.number).toBe("DN-0001");
    const b = await bill(ids.bill1);
    expect(b).toMatchObject({ credited: 1180000, status: "partial" });
    // Plus the CA's ₹35,400 bill from above.
    expect(await bal("ap")).toBe(5900000 - 50000 - 1180000 + 3540000);
    const g = (await A("GET", "gst/gstr3b?month=2026-08")).json;
    expect(g.itc.taxable).toBe(5000000 - 1000000);
    expect((await A("POST", "bills", { kind: "debit_note", againstBillId: ids.bill1, supplierId: ids.contractor, date: day, lines: [{ accountId: ids.repairs, amount: 9000000 }] })).status).toBe(422);
    expect((await A("POST", "bills", { kind: "debit_note", supplierName: "Someone else", againstBillId: ids.bill1, date: day, lines: [{ accountId: ids.repairs, amount: 100 }] })).status).toBe(422);
    // A second note, voided, gives its amount back; the bill can't be voided under its notes.
    const dn2 = (await A("POST", "bills", { kind: "debit_note", againstBillId: ids.bill1, supplierId: ids.contractor, date: day, lines: [{ accountId: ids.repairs, amount: 10000, gstRate: 0 }] })).json.bill;
    expect((await bill(ids.bill1)).credited).toBe(1190000);
    await A("POST", `bills/${dn2.id}/void`);
    expect((await bill(ids.bill1)).credited).toBe(1180000);
    expect((await A("POST", `bills/${ids.bill1}/void`)).status).toBe(409);
  });
});

describe("payment runs", () => {
  it("are approved, give a bank file, and pay the bills", async () => {
    await P("POST", "policies", { kind: "acc.payment_run", name: "Runs", steps: [{ name: "Owner", approvers: [{ type: "role", role: "owner" }] }] });
    const owed = 5900000 - 50000 - 1180000;
    const run = (await A("POST", "payments", { date: "2026-09-15", accountId: ids.bank2, items: [{ billId: ids.bill1, amount: owed }] }, other)).json.run;
    expect(run).toMatchObject({ status: "draft", total: owed, number: "PR-0001" });
    expect((await A("POST", "payments", { date: "2026-09-15", accountId: ids.bank2, items: [{ billId: ids.bill1, amount: owed + 1 }] }, other)).status).toBe(422);
    expect((await A("POST", `payments/${run.id}/submit`, {}, other)).json.status).toBe("pending_approval");
    expect((await A("POST", `payments/${run.id}/pay`, {}, other)).status).toBe(409);
    const q = (await P("GET", "queue")).json.requests.find((r: { kind: string }) => r.kind === "acc.payment_run");
    await P("POST", `requests/${q.id}/decide`, { approve: true });
    const file = await A("GET", `payments/${run.id}/file`, undefined, other);
    expect(file.text).toContain("50100123456789");
    expect(file.text).toContain("HDFC0001234");
    expect((await A("POST", `payments/${run.id}/pay`, {}, other)).json.run.status).toBe("paid");
    expect((await bill(ids.bill1)).status).toBe("paid");
    expect(await bal(ids.bank2)).toBe(-owed);
  });
});

describe("receipts", () => {
  it("spread money over a client's invoices, keep the rest as an advance, and use it later", async () => {
    const book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
    const client = (await B("POST", `${book}/clients`, { name: "Meera", company: "Lumen Labs", billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" }, notes: "" })).json.client.id;
    const doc = (rate: number, d: string) => ({ type: "invoice", clientId: client, client: { name: "Meera", company: "Lumen Labs", billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" } }, issueDate: d, dueDate: d, currency: "INR", taxMode: "none", lines: [{ id: "a", name: "Work", quantity: 1, rate, taxBps: 0 }] });
    const i1 = (await B("POST", `${book}/documents`, { document: doc(10000000, "2026-07-01"), issue: true })).json.document;
    const i2 = (await B("POST", `${book}/documents`, { document: doc(5000000, "2026-08-01"), issue: true })).json.document;
    const open = (await A("GET", `receipts-for?ownerId=${book}&clientId=${client}`)).json.invoices;
    expect(open.map((x: { number: string }) => x.number)).toEqual([i1.number, i2.number]);
    const r = (await A("POST", "receipts", { ownerId: book, clientId: client, date: "2026-09-01", amount: 20000000, accountId: ids.bank2, reference: "NEFT 123" })).json.receipt;
    expect(r.allocations.map((a: { amount: number }) => a.amount)).toEqual([10000000, 5000000]);
    expect(r.advance).toBe(5000000);
    expect(r.number).toBe("RC-0001");
    // Both invoices are paid, the money went into HDFC, and the rest is owed back to the customer as an advance.
    const docs = await db.select().from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, book)));
    expect(docs.every((d) => d.status === "paid")).toBe(true);
    expect(await bal(ids.bank2)).toBe(-(5900000 - 50000 - 1180000) + 20000000);
    expect(await bal("customer_advances")).toBe(5000000);
    expect(await bal("ar")).toBe(0);
    // A new invoice, settled from the advance.
    const i3 = (await B("POST", `${book}/documents`, { document: doc(3000000, "2026-09-10"), issue: true })).json.document;
    const after = (await A("POST", `receipts/${r.id}/apply`, { documentId: i3.id, amount: 3000000, date: "2026-09-10" })).json.receipt;
    expect(after.advanceUsed).toBe(3000000);
    expect(await bal("customer_advances")).toBe(2000000);
    expect(await bal("ar")).toBe(0);
    expect((await A("POST", `receipts/${r.id}/apply`, { documentId: i3.id, amount: 1, date: "2026-09-10" })).status).toBe(422);
    // Undone: the payments come off and the advance goes.
    await A("DELETE", `receipts/${r.id}`);
    expect(await bal("customer_advances")).toBe(0);
    expect(await bal("ar")).toBe(18000000);
  });
});

describe("petty cash", () => {
  it("counts a cash box and books the difference", async () => {
    await A("POST", "journals", { date: "2026-09-01", narration: "Top up petty cash", lines: [{ accountId: ids.cash, debit: 1000000, credit: 0 }, { accountId: ids.bank, debit: 0, credit: 1000000 }] });
    const r = (await A("POST", "cash-count", { accountId: ids.cash, date: "2026-09-30", counted: 990000 })).json;
    expect(r).toMatchObject({ book: 1000000, counted: 990000, difference: -10000 });
    expect(await bal("cash_over_short")).toBe(10000);
    expect(await bal(ids.cash)).toBe(990000);
    expect((await A("POST", "cash-count", { accountId: ids.bank, date: "2026-09-30", counted: 1 })).status).toBe(422);
  });
});
