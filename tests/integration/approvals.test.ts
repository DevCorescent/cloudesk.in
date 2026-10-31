import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as apApi from "@/app/api/v1/orgs/[orgId]/approvals/[[...slug]]/route";
import * as nApi from "@/app/api/v1/orgs/[orgId]/notifications/[[...slug]]/route";
import * as inbox from "@/app/api/v1/orgs/[orgId]/inbox/route";
import { escalate } from "@/server/approvals/engine";
import { sendDueReminders } from "@/server/notify/notify";
import { call, cookieFrom, resetDb } from "../helpers";

let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const A = mk(accApi, "accounts");
const I = mk(invApi, "inventory");
const H = mk(hrApi, "hr");
const P = mk(apApi, "approvals");
const N = mk(nApi, "notifications");
const decide = (requestId: string, who: string, approve = true, note = "") => P("POST", `requests/${requestId}/decide`, { approve, note }, who);
const queueOf = async (who: string) => (await P("GET", "queue", undefined, who)).json.requests as { id: string; label: string; kind: string; step: number; canAct: boolean }[];
const billStatus = async (id: string) => (await db.select().from(schema.accBills).where(eq(schema.accBills.id, id)))[0].status;
const day = "2026-10-10";

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Asha Owner", email: "asha.ap@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [who, name, role] of [["admin", "Bina Admin", "admin"], ["finance", "Chetan Finance", "billing"], ["editor", "Dev Editor", "editor"]] as const) {
    C[who] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${who}.ap@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${who}.ap@example.com`));
    U[who] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
});
afterAll(closeDb);

describe("approval engine", () => {
  it("lets bills through when no policy applies", async () => {
    const meta = (await A("GET", "meta")).json;
    ids.rent = meta.accounts.find((a: { name: string }) => a.name === "Rent").id;
    ids.cash = meta.accounts.find((a: { subtype: string }) => a.subtype === "cash").id;
    const b = (await A("POST", "bills", { supplierName: "Sunrise Properties", date: day, lines: [{ accountId: ids.rent, amount: 6000000, gstRate: 0 }] }, "admin")).json.bill;
    expect(b.status).toBe("open");
  });

  it("only owners and admins write policies; they're validated", async () => {
    expect((await P("POST", "policies", { kind: "acc.bill", name: "x", steps: [{ name: "a", approvers: [{ type: "role", role: "billing" }] }] }, "editor")).status).toBe(403);
    expect((await P("POST", "policies", { kind: "acc.bill", name: "Bad", steps: [] })).status).toBe(422);
    const r = await P("POST", "policies", {
      kind: "acc.bill",
      name: "Bills over ₹50,000",
      conditions: { minAmount: 5000000 },
      steps: [
        { name: "Finance", approvers: [{ type: "role", role: "billing" }] },
        { name: "Director", approvers: [{ type: "user", userId: U.owner }], minAmount: 20000000, slaHours: 4, escalateTo: [U.admin] },
      ],
    });
    expect(r.status).toBe(200);
    ids.billPolicy = r.json.policy.id;
    const meta = (await P("GET", "meta")).json;
    expect(meta.kinds.map((k: { kind: string }) => k.kind)).toContain("acc.bill");
  });

  it("holds a bill until finance approves it, keeps it out of the books, and blocks paying it", async () => {
    // Below the threshold: straight through.
    const small = (await A("POST", "bills", { supplierName: "Stationers", date: day, lines: [{ accountId: ids.rent, amount: 100000, gstRate: 0 }] }, "admin")).json.bill;
    expect(small.status).toBe("open");
    const b = (await A("POST", "bills", { supplierName: "Shah Interiors", billNo: "SI/1", date: day, lines: [{ accountId: ids.rent, amount: 6000000, gstRate: 0 }] }, "admin")).json.bill;
    expect(b.status).toBe("pending_approval");
    ids.bill = b.id;
    await A("POST", "sync");
    const tb = (await A("GET", "reports/trial-balance")).json;
    const rentLine = tb.lines.find((l: { id: string }) => l.id === ids.rent);
    expect(rentLine.balance).toBe(6000000 + 100000); // the first bill and the small one, not this one
    expect((await A("POST", `bills/${b.id}/payments`, { accountId: ids.cash, amount: 100000, date: day }, "admin")).status).toBe(409);
    // Finance's queue has it; the owner's doesn't (only finance is asked for this amount).
    const q = await queueOf("finance");
    expect(q.map((x) => x.label)).toContain(`${b.number} · Shah Interiors (SI/1)`);
    expect((await queueOf("owner")).some((x) => x.label.includes("Shah Interiors"))).toBe(false);
    // The requester can't approve their own; nor can someone who isn't asked.
    const req = q.find((x) => x.label.includes("Shah Interiors"))!;
    expect((await decide(req.id, "admin")).status).toBe(403);
    expect((await decide(req.id, "editor")).status).toBe(403);
    // Finance was told, in the app.
    const n = (await N("GET", "", undefined, "finance")).json;
    expect(n.unread).toBeGreaterThan(0);
    expect(n.items[0]).toMatchObject({ kind: "approval.requested", link: "/inbox", email: "recorded" });
    expect((await decide(req.id, "finance")).json).toMatchObject({ status: "approved" });
    expect(await billStatus(b.id)).toBe("open");
    await A("POST", "sync");
    const after = (await A("GET", "reports/trial-balance")).json.lines.find((l: { id: string }) => l.id === ids.rent);
    expect(after.balance).toBe(6000000 + 100000 + 6000000);
    expect((await N("GET", "", undefined, "admin")).json.items[0]).toMatchObject({ kind: "approval.approved", link: `/accounts/bills/${b.id}` });
    // The history says who did what.
    const d = (await P("GET", `doc?kind=acc.bill&refId=${b.id}`, undefined, "admin")).json.requests[0];
    expect(d.history.map((h: { action: string; by: string }) => `${h.action}:${h.by}`)).toEqual(["submitted:Bina Admin", "approved:Chetan Finance"]);
  });

  it("adds the director step above ₹2 lakh, with delegation and escalation", async () => {
    const b = (await A("POST", "bills", { supplierName: "Big Vendor", date: day, lines: [{ accountId: ids.rent, amount: 30000000, gstRate: 0 }] }, "admin")).json.bill;
    let req = (await queueOf("finance")).find((x) => x.label.includes("Big Vendor"))!;
    await decide(req.id, "finance");
    expect(await billStatus(b.id)).toBe("pending_approval");
    // Now it's the owner's turn — who is away and has delegated bills to Dev.
    expect((await queueOf("editor")).some((x) => x.label.includes("Big Vendor"))).toBe(false);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect((await P("POST", "delegations", { toUserId: U.editor, starts: today, ends: today, kinds: ["acc.bill"] })).status).toBe(200);
    req = (await queueOf("editor")).find((x) => x.label.includes("Big Vendor"))!;
    expect(req.step).toBe(1);
    // Overdue: escalated once, to the person named.
    await db.update(schema.approvalRequests).set({ stepStartedAt: new Date(Date.now() - 5 * 3600_000) }).where(eq(schema.approvalRequests.id, req.id));
    expect(await escalate()).toBe(1);
    expect(await escalate()).toBe(0);
    expect((await N("GET", "", undefined, "admin")).json.items.some((x: { kind: string }) => x.kind === "approval.escalated")).toBe(true);
    expect((await decide(req.id, "editor")).json.status).toBe("approved");
    const d = (await P("GET", `requests/${req.id}`, undefined, "admin")).json.request;
    expect(d.history.find((h: { action: string; step: number }) => h.action === "approved" && h.step === 1)).toMatchObject({ by: "Dev Editor", onBehalfOf: "Asha Owner" });
    expect(d.history.some((h: { action: string }) => h.action === "escalated")).toBe(true);
    expect(await billStatus(b.id)).toBe("open");
  });

  it("sends back with a note, and resubmits when the bill is changed", async () => {
    const b = (await A("POST", "bills", { supplierName: "Pricey Co", date: day, lines: [{ accountId: ids.rent, amount: 7000000, gstRate: 0 }] }, "admin")).json.bill;
    const req = (await queueOf("finance")).find((x) => x.label.includes("Pricey Co"))!;
    expect((await decide(req.id, "finance", false)).status).toBe(422);
    await decide(req.id, "finance", false, "Wrong rate — should be ₹65,000");
    expect(await billStatus(b.id)).toBe("rejected");
    expect((await N("GET", "", undefined, "admin")).json.items[0]).toMatchObject({ kind: "approval.rejected" });
    expect((await decide(req.id, "finance")).status).toBe(409);
    await A("PUT", `bills/${b.id}`, { supplierName: "Pricey Co", date: day, lines: [{ accountId: ids.rent, amount: 6500000, gstRate: 0 }] }, "admin");
    expect(await billStatus(b.id)).toBe("pending_approval");
    const again = (await P("GET", `doc?kind=acc.bill&refId=${b.id}`, undefined, "admin")).json.requests;
    expect(again).toHaveLength(2);
    expect(again[0].history[0].action).toBe("resubmitted");
    // Voiding it closes the request.
    await A("POST", `bills/${b.id}/void`, {}, "admin");
    expect((await P("GET", `doc?kind=acc.bill&refId=${b.id}`, undefined, "admin")).json.requests[0].status).toBe("cancelled");
  });

  it("holds an expense's payment until it's approved", async () => {
    await P("POST", "policies", { kind: "acc.expense", name: "All expenses", steps: [{ name: "Finance", approvers: [{ type: "role", role: "billing" }] }] });
    const e = (await A("POST", "expenses", { supplierName: "Cab Co", date: day, lines: [{ accountId: ids.rent, amount: 50000, gstRate: 0 }], paidFrom: ids.cash }, "admin")).json;
    const bill = e.bill ?? e;
    expect(bill.status).toBe("pending_approval");
    expect(bill.amountPaid).toBe(0);
    const req = (await queueOf("finance")).find((x) => x.label.includes("Cab Co"))!;
    await decide(req.id, "finance");
    const [after] = await db.select().from(schema.accBills).where(eq(schema.accBills.id, bill.id));
    expect(after).toMatchObject({ status: "paid", amountPaid: 50000, pendingPayment: null });
  });

  it("posts a manual journal only once it's approved, and respects approval limits", async () => {
    await P("POST", "policies", { kind: "acc.journal", name: "Journals", steps: [{ name: "Admin", approvers: [{ type: "role", role: "admin", limit: 1000000 }, { type: "user", userId: U.owner }] }] });
    const meta = (await A("GET", "meta")).json;
    const bank = meta.accounts.find((a: { subtype: string }) => a.subtype === "bank").id;
    const j = await A("POST", "journals", { date: day, narration: "Owner's capital", lines: [{ accountId: bank, debit: 5000000, credit: 0 }, { accountId: meta.accounts.find((a: { name: string }) => a.name === "Owner's capital").id, debit: 0, credit: 5000000 }] }, "finance");
    expect(j.json).toMatchObject({ journal: null });
    const before = (await A("GET", "journals?type=manual")).json.journals.length;
    const req = (await queueOf("owner")).find((x) => x.kind === "acc.journal")!;
    // The admin's limit is ₹10,000, below ₹50,000 — their approval doesn't count.
    expect((await decide(req.id, "admin")).status).toBe(403);
    await decide(req.id, "owner");
    expect((await A("GET", "journals?type=manual")).json.journals.length).toBe(before + 1);
  });

  it("holds purchase orders and receiving until approved", async () => {
    await P("POST", "policies", { kind: "inv.po", name: "POs", steps: [{ name: "Owner", approvers: [{ type: "user", userId: U.owner }] }] });
    const sup = (await I("POST", "suppliers", { name: "Paper Co", state: "MH" })).json.supplier.id;
    const item = (await I("POST", "items", { name: "Paper", sku: "PAP" })).json.item.id;
    const wh = (await I("GET", "meta")).json.warehouses[0].id;
    const po = (await I("POST", "orders", { supplierId: sup, warehouseId: wh, orderDate: day, lines: [{ itemId: item, qty: 10, rate: 1000, gstRate: 18 }] }, "admin")).json.order;
    const sent = (await I("POST", `orders/${po.id}/send`, {}, "admin")).json;
    expect(sent).toMatchObject({ pendingApproval: true, emailed: false });
    expect((await I("GET", `orders/${po.id}`)).json.po.status).toBe("draft");
    expect((await I("POST", "receipts", { poId: po.id, warehouseId: wh, date: day, lines: [{ itemId: item, qty: 10, rate: 1000 }] }, "admin")).status).toBe(409);
    const req = (await queueOf("owner")).find((x) => x.kind === "inv.po")!;
    await decide(req.id, "owner");
    expect((await I("POST", `orders/${po.id}/send`, {}, "admin")).json.pendingApproval).toBeUndefined();
    expect((await I("GET", `orders/${po.id}`)).json.po.status).toBe("sent");
  });

  it("adds steps after a manager approves a claim, and finalises payroll only when approved", async () => {
    const mgr = (await H("POST", "people", { name: "Asha Owner", email: "asha.ap@example.com", joinDate: "2024-01-01", ctc: 2400000_00 })).json.employee;
    const staff = (await H("POST", "people", { name: "Dev Editor", email: "editor.ap@example.com", joinDate: "2025-01-01", managerId: mgr.id, ctc: 600000_00 })).json.employee;
    expect(staff.userId).toBe(U.editor);
    await P("POST", "policies", { kind: "hr.claim", name: "Claims over ₹5,000", conditions: { minAmount: 500000 }, steps: [{ name: "Finance", approvers: [{ type: "role", role: "billing" }] }] });
    const claim = (await H("POST", "claims", { category: "Travel", amount: 800000, date: day, description: "Client visit" }, "editor")).json.claim;
    await H("POST", `claims/${claim.id}/decide`, { action: "approve" });
    let [c] = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.id));
    expect(c.status).toBe("approving");
    // Finance gets it in "My work".
    const work = (await call(inbox.GET, { method: "GET", cookie: C.finance, path: `/api/v1/orgs/${orgId}/inbox`, params: { orgId } })).json;
    expect(work.approvals.some((a: { kind: string }) => a.kind === "hr.claim")).toBe(true);
    await decide(work.approvals.find((a: { kind: string }) => a.kind === "hr.claim").id, "finance");
    [c] = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.id));
    expect(c.status).toBe("approved");

    await P("POST", "policies", { kind: "hr.payroll", name: "Payroll", steps: [{ name: "Owner", approvers: [{ type: "user", userId: U.owner }] }] });
    const run = (await H("POST", "payroll", { month: "2026-10" }, "finance")).json.run;
    const fin = (await H("POST", `payroll/${run.id}/finalise`, {}, "finance")).json;
    expect(fin.run.status).toBe("draft");
    expect(fin.approval).toBeTruthy();
    const req = (await queueOf("owner")).find((x) => x.kind === "hr.payroll")!;
    await decide(req.id, "owner");
    const [r] = await db.select().from(schema.hrPayrollRuns).where(eq(schema.hrPayrollRuns.id, run.id));
    expect(r.status).toBe("finalised");
    // The approved claim went out with it.
    [c] = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.id));
    expect(c.status).toBe("paid");
  });

  it("keeps preferences, the workspace's wording, reminders and read marks", async () => {
    await N("PUT", "prefs", { "approval.requested": { app: true, email: false } }, "finance");
    expect((await N("GET", "prefs", undefined, "finance")).json.prefs["approval.requested"]).toMatchObject({ app: true, email: false });
    expect((await N("PUT", "templates/approval.requested", { subject: "Please check {{document}}", body: "{{requester}} asks for {{amount}}." }, "editor")).status).toBe(403);
    await N("PUT", "templates/approval.requested", { subject: "Please check {{document}}", body: "{{requester}} asks for {{amount}}." });
    await A("POST", "bills", { supplierName: "Worded Co", date: day, lines: [{ accountId: ids.rent, amount: 5500000, gstRate: 0 }] }, "admin");
    const n = (await N("GET", "", undefined, "finance")).json.items[0];
    expect(n.title).toMatch(/^Please check BL-\d+ · Worded Co$/);
    expect(n.body).toBe("Bina Admin asks for ₹55,000.00.");
    expect(n.email).toBeNull(); // email switched off for this kind
    await N("POST", "read", { ids: "all" }, "finance");
    expect((await N("GET", "", undefined, "finance")).json.unread).toBe(0);
    // A reminder in the past is refused; one due now is sent once.
    expect((await N("POST", "reminders", { at: new Date(Date.now() - 3600_000).toISOString(), title: "Late" })).status).toBe(422);
    const r = (await N("POST", "reminders", { at: new Date(Date.now() + 1000).toISOString(), title: "Call the auditor", link: "/accounts" })).json.reminder;
    await db.update(schema.reminders).set({ at: new Date(Date.now() - 1000) }).where(eq(schema.reminders.id, r.id));
    expect(await sendDueReminders()).toBe(1);
    expect(await sendDueReminders()).toBe(0);
    const mine = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner), eq(schema.notifications.kind, "reminder")));
    expect(mine).toHaveLength(1);
  });

  it("reports how approvals are going", async () => {
    const a = (await P("GET", "analytics")).json;
    const bills = a.byKind.find((k: { kind: string }) => k.kind === "acc.bill");
    expect(bills.approved).toBeGreaterThanOrEqual(2);
    expect(bills.rejected).toBe(1);
    expect((await P("GET", "analytics", undefined, "editor")).status).toBe(403);
  });
});
