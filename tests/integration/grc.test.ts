import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/grc/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import { remind } from "@/server/grc/calendar";
import { call, cookieFrom, resetDb } from "../helpers";

// Risks scored before and after controls, control tests moving the next due
// date, the statutory calendar laid out with reminders, policies acknowledged
// per version, incidents anyone can report, audit findings, duties held by
// one person, fraud indicators and emissions from the fuel log.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const G = mk(api, "grc");
const I = mk(invApi, "inventory");
const HR = mk(hrApi, "hr");
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Gita Governance", email: "gita.grc@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [k, role] of [["editor", "editor"], ["staff", "employee"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "editor" ? "Eshan Editor" : "Sunil Staff", email: `${k}.grc@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.grc@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  await G("GET", "meta");
});
afterAll(closeDb);

describe("risks and controls", () => {
  it("scores risks before and after controls, and links tested controls", async () => {
    const c = (await G("POST", "controls", { code: "AP-01", name: "Two people approve supplier bank changes", frequency: "quarterly", ownerId: U.editor })).json.control;
    ids.control = c.id;
    expect(c.nextTestDue).toBe(today());
    expect((await G("POST", "controls", { code: "ap-01", name: "Dup" })).status).toBe(409);
    const r = (await G("POST", "risks", { title: "Payment to a fake supplier", category: "financial", likelihood: 3, impact: 5, residualLikelihood: 1, residualImpact: 5, controlIds: [c.id], ownerId: U.editor })).json.risk;
    expect(r).toMatchObject({ number: "RSK-0001", inherent: 15, inherentRating: "high", residual: 5, residualRating: "medium" });
    expect(r.reviewDate > today()).toBe(true);
    expect((await G("POST", "risks", { title: "x", residualLikelihood: 2 })).status).toBe(422);
    expect((await G("POST", "risks", { title: "x", controlIds: [orgId] })).status).toBe(422);
    const t = await G("POST", `controls/${c.id}/tests`, { testedOn: "2026-10-10", result: "effective", notes: "Sampled 10 changes" }, "editor");
    expect(t.status).toBe(200);
    const d = (await G("GET", `controls/${c.id}`)).json;
    expect(d.control).toMatchObject({ lastResult: "effective", lastTestedOn: "2026-10-10", nextTestDue: "2027-01-10" });
    expect(d.risks.map((x: { number: string }) => x.number)).toEqual(["RSK-0001"]);
    // An older test doesn't overwrite the latest.
    await G("POST", `controls/${c.id}/tests`, { testedOn: "2026-07-10", result: "ineffective" });
    expect((await G("GET", `controls/${c.id}`)).json.control.lastResult).toBe("effective");
    expect((await G("GET", "home")).json.risks).toMatchObject({ open: 1, byRating: { medium: 1 } });
  });

  it("imports a risk register from a sheet once, clamping scores", async () => {
    const rows = [{ title: "Key supplier fails", category: "vendor", likelihood: 4, impact: 9, treatment: "mitigate", plan: "Second source" }, { title: "Payment to a fake supplier" }];
    expect((await G("POST", "risks/import", { rows, mode: "add" })).json).toMatchObject({ created: 1, skipped: 1 });
    const r = (await G("GET", "risks")).json.risks.find((x: { title: string }) => x.title === "Key supplier fails");
    expect(r).toMatchObject({ category: "supply_chain", likelihood: 4, impact: 5, inherent: 20, inherentRating: "critical", treatment: "reduce" });
  });

  it("keeps the registers from employees, who can still report and read", async () => {
    expect((await G("GET", "risks", undefined, "staff")).status).toBe(403);
    expect((await G("POST", "controls", { code: "X", name: "x" }, "staff")).status).toBe(403);
    expect((await G("GET", "home", undefined, "staff")).json).toEqual({ registers: false, policiesToAck: [] });
  });
});

describe("the compliance calendar", () => {
  it("adds the Indian pack once, lays out due dates and marks them", async () => {
    const r = (await G("POST", "obligations/pack", {})).json;
    expect(r.added).toBeGreaterThanOrEqual(14);
    expect((await G("POST", "obligations/pack", {})).json.added).toBe(0);
    const f = (await G("GET", `filings?from=${today()}&to=${addDays(today(), 45)}`)).json.filings;
    const gst = f.find((x: { title: string }) => x.title.startsWith("GSTR-3B"));
    expect(gst.dueDate.slice(8)).toBe("20");
    expect((await G("PUT", `filings/${gst.id}`, { status: "waived" })).status).toBe(422);
    const done = (await G("PUT", `filings/${gst.id}`, { status: "done", reference: "ARN AA2710260012345" })).json.filing;
    expect(done).toMatchObject({ status: "done", reference: "ARN AA2710260012345", doneBy: U.owner });
  });

  it("reminds the owner before the due date and once more when overdue", async () => {
    const o = (await G("POST", "obligations", { title: "Shop licence renewal", category: "licence", recurrence: { freq: "once", date: addDays(today(), 3) }, ownerId: U.editor, remindDays: 5 })).json.obligation;
    expect(await remind()).toBeGreaterThanOrEqual(1);
    const n1 = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.editor), eq(schema.notifications.kind, "grc.due")));
    expect(n1.map((n) => n.title)).toContain(`Shop licence renewal (Once) is due ${addDays(today(), 3)}`);
    const before = n1.length;
    await remind();
    expect((await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.editor), eq(schema.notifications.kind, "grc.due")))).length).toBe(before);
    // Four days later it's overdue: one more reminder.
    await remind(new Date(Date.now() + 4 * 86_400_000));
    const n2 = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.editor), eq(schema.notifications.kind, "grc.due")));
    expect(n2.some((n) => n.title.startsWith("Overdue: Shop licence renewal"))).toBe(true);
    await remind(new Date(Date.now() + 5 * 86_400_000));
    expect((await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.editor), eq(schema.notifications.kind, "grc.due")))).length).toBe(n2.length);
    void o;
  });
});

describe("policies, incidents and audits", () => {
  it("asks everyone to acknowledge each published version", async () => {
    const p = (await G("POST", "policies", { title: "Acceptable use", body: "Use company laptops for work." })).json.policy;
    expect((await G("GET", `policies/${p.id}`, undefined, "staff")).status).toBe(404);
    await G("POST", `policies/${p.id}/publish`);
    expect((await G("GET", "home", undefined, "staff")).json.policiesToAck).toEqual([{ id: p.id, title: "Acceptable use", version: 1 }]);
    await G("POST", `policies/${p.id}/acknowledge`, undefined, "staff");
    let list = (await G("GET", "policies")).json.policies;
    expect(list[0]).toMatchObject({ version: 1, progress: { done: 1, of: 3 } });
    await G("PUT", `policies/${p.id}`, { title: "Acceptable use", body: "Use company laptops for work. No personal cloud storage." });
    list = (await G("GET", "policies")).json.policies;
    expect(list[0]).toMatchObject({ version: 2, progress: { done: 0, of: 3 } });
    const n = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.staff), eq(schema.notifications.kind, "grc.policy")));
    expect(n).toHaveLength(2);
  });

  it("takes incident reports from anyone, and won't resolve without a root cause", async () => {
    const r = await G("POST", "incidents", { title: "Lost laptop", type: "security", severity: "high", occurredAt: new Date(Date.now() - 3600_000).toISOString(), description: "Left in a cab", personalData: true }, "staff");
    expect(r.json.incident.number).toBe("INC-0001");
    expect((await G("GET", "incidents", undefined, "staff")).json.incidents).toHaveLength(1);
    expect((await G("PATCH", `incidents/${r.json.incident.id}`, { status: "resolved" }, "staff")).status).toBe(403);
    expect((await G("PATCH", `incidents/${r.json.incident.id}`, { status: "resolved" })).status).toBe(422);
    const ok = (await G("PATCH", `incidents/${r.json.incident.id}`, { status: "resolved", rootCause: "No disk encryption", actions: "Enable FileVault on all laptops" })).json.incident;
    expect(ok.resolvedAt).not.toBeNull();
    expect((await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner), eq(schema.notifications.kind, "grc.incident"))))).toHaveLength(1);
  });

  it("closes audit findings only with management's response", async () => {
    const a = (await G("POST", "audits", { title: "Purchase cycle FY27 H1", periodFrom: "2026-04-01", periodTo: "2026-09-30", auditorId: U.editor })).json.audit;
    expect(a.number).toBe("AUD-0001");
    const f = (await G("POST", `audits/${a.id}/findings`, { title: "POs raised after invoice", severity: "high", ownerId: U.owner, dueDate: addDays(today(), -1) })).json.finding;
    expect((await G("PUT", `audits/${a.id}/findings/${f.id}`, { title: f.title, status: "closed" })).status).toBe(422);
    expect((await G("GET", `audits/${a.id}`)).json.findings[0].overdue).toBe(true);
    expect((await G("PUT", `audits/${a.id}/findings/${f.id}`, { title: f.title, status: "closed", response: "PO-first rule enforced in Inventory" })).json.finding.closedAt).not.toBeNull();
  });
});

describe("checks across the business", () => {
  it("finds duties held by one person, by role and in what happened", async () => {
    await I("GET", "meta");
    const wh = (await I("GET", "warehouses")).json.warehouses[0].id;
    const sup = (await I("POST", "suppliers", { name: "Quick Supplies", state: "MH", bank: { name: "Quick", account: "50100123456789", ifsc: "HDFC0000123" } })).json.supplier.id;
    const item = (await I("POST", "items", { name: "Paper", sku: "P-1", unit: "pcs", gstRate: 12 })).json.item.id;
    const po = (await I("POST", "orders", { supplierId: sup, warehouseId: wh, orderDate: today(), lines: [{ itemId: item, qty: 10, rate: 100, gstRate: 12 }] })).json.order;
    await I("POST", `orders/${po.id}/send`, {});
    expect((await I("POST", "receipts", { warehouseId: wh, poId: po.id, supplierId: sup, date: today(), lines: [{ itemId: item, qty: 10, rate: 100, gstRate: 12 }] })).status).toBe(200);
    const r = (await G("GET", "sod")).json;
    expect(r.byRole.find((x: { key: string }) => x.key === "buy_pay").members.map((m: { name: string }) => m.name)).toContain("Gita Governance");
    expect(r.happened.map((h: { kind: string }) => h.kind)).toContain("po_received_by_buyer");
    expect((await G("GET", "sod", undefined, "editor")).status).toBe(403);
  });

  it("flags a supplier paid into an employee's account", async () => {
    await HR("GET", "meta");
    expect((await HR("POST", "people", { name: "Ravi Clerk", email: "ravi.clerk@example.com", designation: "Clerk", joinDate: "2025-01-01", ctc: 300000_00, bank: { name: "Ravi", account: "50100123456789", ifsc: "HDFC0000123" }, ids: { pan: "ABCDE1234F" } })).status).toBe(200);
    const f = (await G("GET", "fraud")).json;
    expect(f.payrollChecked).toBe(true);
    expect(f.indicators.map((i: { title: string }) => i.title)).toContain("Quick Supplies shares a bank account with Ravi Clerk");
  });

  it("turns electricity and the fleet's fuel into emissions", async () => {
    expect((await G("POST", "esg", { month: "2026-09", metric: "electricity_kwh", quantity: 1000 })).status).toBe(200);
    expect((await G("POST", "esg", { month: "2099-01", metric: "diesel_l", quantity: 1 })).status).toBe(422);
    await db.update(schema.grcSettings).set({ settings: { factors: { electricity_kwh: 0.8 } } }).where(eq(schema.grcSettings.orgId, orgId));
    const e = (await G("GET", "esg")).json;
    expect(e.monthly).toEqual([{ month: "2026-09", scope1: 0, scope2: 800, total: 800 }]);
    expect(e.factors.diesel_l).toBe(2.68);
  });
});
