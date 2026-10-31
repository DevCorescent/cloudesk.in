import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/dashboard/[[...slug]]/route";
import { humanise } from "@/server/dashboard/core";
import { call, cookieFrom, resetDb } from "../helpers";

// Home: numbers, charts and alerts from the workspace's own records, only for
// what's switched on and what the person may see; layout and quick-action use
// saved per person.
let orgId = "";
let userId = "";
const C: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const D = (method: string, path = "", body?: unknown, who = "owner") => call((api as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/dashboard/${path}`, params: { orgId, slug: seg(path) } });
const ist = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dia Dash", email: "dia.dash@example.com", password: "correct-horse-42" } }));
  const who = (await call(me.GET, { cookie: C.owner })).json;
  orgId = who.organizations[0].id;
  userId = who.user.id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik Viewer", email: "vik.dash@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "vik.dash@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v!.id, role: "viewer" });

  const today = ist();
  // Invoices in a finance book: one paid this month, one overdue.
  const [book] = await db.insert(schema.financeBooks).values({ orgId, name: "Main books" } as typeof schema.financeBooks.$inferInsert).returning();
  await db.insert(schema.invoiceOwners).values({ id: book!.id, bookId: book!.id });
  const doc = (n: string, total: number, paid: number, issue: string, due: string) => ({ projectId: book!.id, type: "invoice", number: n, status: paid >= total ? "paid" : "sent", client: { name: "Acme" }, issueDate: issue, dueDate: due, currency: "INR", lines: [], adjustments: [], taxMode: "none", total, amountPaid: paid, shareToken: `tok-${n}` });
  await db.insert(schema.invoiceDocuments).values([doc("INV-1", 50_000_00, 50_000_00, today, addDays(today, 15)), doc("INV-2", 20_000_00, 0, addDays(today, -40), addDays(today, -10))] as never);
  // A pipeline with two open deals and one won this month.
  const [pl] = await db.insert(schema.crmPipelines).values({ orgId, name: "Sales" } as never).returning();
  const [s1, s2] = await db.insert(schema.crmStages).values([{ orgId, pipelineId: pl!.id, name: "Qualified", sort: 1, kind: "open", rotDays: 7 }, { orgId, pipelineId: pl!.id, name: "Proposal", sort: 2, kind: "open" }] as never).returning();
  await db.insert(schema.crmDeals).values([
    { orgId, pipelineId: pl!.id, stageId: s1!.id, title: "Old deal", value: 1_00_000_00, status: "open", updatedAt: new Date(Date.now() - 30 * 86_400_000) },
    { orgId, pipelineId: pl!.id, stageId: s2!.id, title: "Fresh deal", value: 2_00_000_00, status: "open" },
    { orgId, pipelineId: pl!.id, stageId: s2!.id, title: "Won deal", value: 50_000_00, status: "won", closedAt: new Date() },
  ] as never);
  // HR: two people, one in today.
  const [e1] = await db.insert(schema.hrEmployees).values([{ orgId, empNo: "E1", name: "Asha", joinDate: "2025-01-01" }, { orgId, empNo: "E2", name: "Ravi", joinDate: "2025-02-01" }] as never).returning();
  await db.insert(schema.hrAttendance).values({ orgId, employeeId: e1!.id, date: today, status: "present" } as never);
  // Inventory: one item below its reorder level.
  const [wh] = await db.insert(schema.invWarehouses).values({ orgId, name: "Main" } as never).returning();
  const [it] = await db.insert(schema.invItems).values({ orgId, name: "Cups", reorderLevel: 10, avgCost: 50_00 } as never).returning();
  await db.insert(schema.invStock).values({ orgId, itemId: it!.id, warehouseId: wh!.id, qty: 4 } as never);
  // A web app's shop: one paid order today, waiting to ship.
  const [proj] = await db.insert(schema.projects).values({ orgId, name: "Shop", slug: "shop-dash" } as never).returning();
  await db.insert(schema.storeOrders).values({ projectId: proj!.id, number: 1, accessKeyHash: "x", email: "b@example.com", shippingAddress: {}, currency: "INR", subtotal: 1_000_00, total: 1_000_00, taxIncluded: true, paymentMethod: "upi", paidAt: new Date(), channel: "online" } as never);
  // Projects: an active project and 90 minutes logged this week.
  const [wp] = await db.insert(schema.workProjects).values({ orgId, code: "P1", name: "Website", status: "active" } as never).returning();
  await db.insert(schema.workTime).values({ orgId, projectId: wp!.id, userId, date: today, minutes: 90 } as never);
  // Helpdesk: one ticket past its response target.
  await db.insert(schema.hdTickets).values([{ orgId, number: "T-1", subject: "Broken", status: "open", firstResponseDue: new Date(Date.now() - 3_600_000) }, { orgId, number: "T-2", subject: "Done", status: "resolved", resolvedAt: new Date() }] as never);
});
afterAll(closeDb);

describe("the Home dashboard", () => {
  it("shows numbers, charts and alerts from the workspace's own records", async () => {
    const r = await D("GET");
    expect(r.status).toBe(200);
    const k = Object.fromEntries(r.json.kpis.map((x: { id: string }) => [x.id, x]));
    expect(k.invoiced.value).toBe(50_000_00);
    expect(k.owed.value).toBe(20_000_00);
    expect(k.pipeline.value).toBe(3_00_000_00);
    expect(k.won.value).toBe(50_000_00);
    expect(k.tickets.value).toBe(1);
    expect(k.team).toMatchObject({ value: 1, sub: "of 2 people" });
    expect(k.stock.value).toBe(4 * 50_00);
    expect(k.sales.value).toBe(1_000_00);
    expect(k.hours.value).toBe(1.5);
    const ids = r.json.insights.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["inv-overdue", "crm-stale", "hd-late", "inv-low", "store-ship"]));
    // Most serious first.
    expect(r.json.insights[0].tone).toBe("danger");
    const overdue = r.json.insights.find((i: { id: string }) => i.id === "inv-overdue");
    expect(overdue.title).toBe("₹20,000 overdue from 1 invoice");
    const charts = r.json.charts.map((c: { id: string }) => c.id);
    expect(charts).toEqual(expect.arrayContaining(["invoicing", "pipeline", "tickets", "store", "attendance"]));
    const pipeline = r.json.charts.find((c: { id: string }) => c.id === "pipeline").result;
    expect(pipeline.rows).toEqual([["Qualified", 1_00_000_00], ["Proposal", 2_00_000_00]]);
    const inv = r.json.charts.find((c: { id: string }) => c.id === "invoicing").result;
    expect(inv.rows).toHaveLength(6);
    expect(inv.totals[1]).toBe(70_000_00);
  });

  it("leaves out what the workspace has switched off", async () => {
    await db.update(schema.organizations).set({ modules: ["invoicing"] }).where(eq(schema.organizations.id, orgId));
    const r = (await D("GET")).json;
    expect(r.kpis.map((x: { module: string }) => x.module).every((m: string) => m === "invoicing")).toBe(true);
    expect(r.quick.map((q: { id: string }) => q.id)).not.toContain("deal");
    await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
  });

  it("shows a viewer no money they can't see", async () => {
    const r = (await D("GET", "", undefined, "viewer")).json;
    expect(r.kpis.find((x: { id: string }) => x.id === "invoiced")).toBeUndefined();
    expect(r.kpis.find((x: { id: string }) => x.id === "pipeline")).toBeDefined();
  });

  it("puts the quick actions you use first", async () => {
    const before = (await D("GET")).json.quick.map((q: { id: string }) => q.id);
    expect(before[0]).not.toBe("ticket");
    for (let i = 0; i < 3; i++) expect((await D("POST", "used", { id: "ticket" })).status).toBe(200);
    const after = (await D("GET")).json.quick;
    expect(after[0]).toMatchObject({ id: "ticket", mostUsed: true });
    expect((await D("POST", "used", { id: "nope" })).status).toBe(422);
  });

  it("saves each person's layout", async () => {
    expect((await D("PUT", "layout", { order: ["charts", "summary"], hidden: ["create"] })).status).toBe(200);
    expect((await D("GET")).json.layout).toEqual({ order: ["charts", "summary"], hidden: ["create"] });
    expect((await D("GET", "", undefined, "viewer")).json.layout).toEqual({ order: [], hidden: [] });
    expect((await D("PUT", "layout", { order: ["bogus"], hidden: [] })).status).toBe(422);
    const [row] = await db.select().from(schema.userDashboards).where(eq(schema.userDashboards.userId, userId));
    expect(row!.usage).toEqual({ ticket: 3 });
  });

  it("names audit actions in plain words", () => {
    expect(humanise("crm.deal_created")).toBe("CRM · deal created");
    expect(humanise("accounts.gst_filed")).toBe("Accounts · GST filed");
  });
});
