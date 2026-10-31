import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Task dependencies and the critical path, rescheduling, booking people
// against capacity, project expenses billed with markup and counted in
// profit, risks, change requests moving the budget, and document links.
let owner = "";
let editor = "";
let orgId = "";
let editorId = "";
const ids: Record<string, string> = {};
const w = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/work/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Owner", email: "meera.plus@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  editor = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dev Editor", email: "dev.plus@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "dev.plus@example.com"));
  editorId = u.id;
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  ids.book = (await B("POST", "", { orgId, name: "Studio books" })).json.book.id;
  ids.client = (await B("POST", `${ids.book}/clients`, { name: "Rohan Mehta", company: "Lumen Labs", email: "rohan@lumen.example", billing: { line1: "", line2: "", city: "Pune", state: "Maharashtra", postalCode: "", country: "IN" }, notes: "" })).json.client.id;
  ids.project = (await w("POST", "projects", { name: "Lumen website", ownerId: ids.book, clientId: ids.client, billing: "fixed", fee: 500000_00, budgetHours: 100, dueDate: "2026-11-30" })).json.project.id;
});
afterAll(closeDb);

describe("schedule", () => {
  it("links tasks, refuses loops, finds the critical path and pushes late tasks", async () => {
    const t = async (title: string, startDate: string, dueDate: string) => (await w("POST", "tasks", { projectId: ids.project, title, startDate, dueDate })).json.task.id as string;
    ids.design = await t("Design", "2026-11-02", "2026-11-06");
    ids.build = await t("Build", "2026-11-04", "2026-11-20");
    ids.copy = await t("Copy", "2026-11-03", "2026-11-05");
    ids.launch = await t("Launch", "2026-11-23", "2026-11-23");
    for (const [a, b] of [["design", "build"], ["build", "launch"], ["copy", "launch"]]) expect((await w("POST", "links", { fromId: ids[a], toId: ids[b] })).status).toBe(200);
    expect((await w("POST", "links", { fromId: ids.launch, toId: ids.design })).status).toBe(422);
    expect((await w("POST", "links", { fromId: ids.design, toId: ids.build })).status).toBe(409);

    let sc = (await w("GET", `projects/${ids.project}/schedule`)).json;
    // Build starts before design ends; pushing it pushes launch too.
    expect(new Set(sc.conflicts)).toEqual(new Set([ids.build, ids.launch]));
    const r = (await w("POST", `projects/${ids.project}/reschedule`, {})).json;
    // Build waits for design: it starts the day after, keeps its 16 days, and launch follows it.
    expect(r.moved.find((m: { id: string }) => m.id === ids.build)).toMatchObject({ startDate: "2026-11-07", dueDate: "2026-11-23" });
    expect(r.moved.find((m: { id: string }) => m.id === ids.launch)).toMatchObject({ startDate: "2026-11-24", dueDate: "2026-11-24" });
    sc = (await w("GET", `projects/${ids.project}/schedule`)).json;
    expect(sc.conflicts).toEqual([]);
    expect(new Set(sc.critical)).toEqual(new Set([ids.design, ids.build, ids.launch]));
    expect(sc).toMatchObject({ finish: "2026-11-24", late: false });
  });
});

describe("resources", () => {
  it("books people against capacity and flags weeks they're over", async () => {
    // Mon 2 – Sun 8 Nov: six working days at 8 hours = 48.
    expect((await w("POST", "allocations", { projectId: ids.project, userId: editorId, from: "2026-11-02", to: "2026-11-08", hoursPerDay: 6 })).status).toBe(200);
    const other = (await w("POST", "projects", { name: "Side project" })).json.project.id;
    ids.alloc = (await w("POST", "allocations", { projectId: other, userId: editorId, from: "2026-11-04", to: "2026-11-05", hoursPerDay: 4 })).json.allocation.id;
    const r = (await w("GET", "resources?from=2026-11-02&to=2026-11-08")).json;
    const dev = r.people.find((p: { userId: string }) => p.userId === editorId);
    expect(dev).toMatchObject({ capacity: 48, booked: 44, free: 4, overWeeks: [] });
    await w("PUT", `allocations/${ids.alloc}`, { projectId: other, userId: editorId, from: "2026-11-04", to: "2026-11-05", hoursPerDay: 8 });
    const r2 = (await w("GET", "resources?from=2026-11-02&to=2026-11-08")).json;
    expect(r2.people.find((p: { userId: string }) => p.userId === editorId)).toMatchObject({ booked: 52, overWeeks: ["2026-11-02"] });
    // Booking puts them on the project's team.
    expect((await w("GET", `projects/${other}`)).json.members.map((m: { userId: string }) => m.userId)).toContain(editorId);
  });
});

describe("expenses", () => {
  it("bills expenses with markup once, frees them on void, and counts them in profit", async () => {
    const e1 = (await w("POST", "expenses", { projectId: ids.project, date: "2026-10-10", category: "Software", description: "Stock photos", amount: 10000_00, markupPct: 10 })).json.expense;
    await w("POST", "expenses", { projectId: ids.project, date: "2026-10-11", category: "Travel", amount: 4000_00, billable: false });
    const ex = (await w("GET", `projects/${ids.project}/expenses`)).json;
    expect(ex.totals).toEqual({ spent: 14000_00, billable: 11000_00, toBill: 11000_00 });
    const u = (await w("GET", `billing/${ids.project}`)).json;
    expect(u.expenses).toEqual([expect.objectContaining({ id: e1.id, charge: 11000_00 })]);
    const bill = (await w("POST", `billing/${ids.project}`, { expenseIds: [e1.id] })).json;
    expect(bill.expenses).toBe(1);
    expect((await w("POST", `billing/${ids.project}`, { expenseIds: [e1.id] })).status).toBe(409);
    expect((await w("DELETE", `expenses/${e1.id}`)).status).toBe(409);

    // Fixed fee ₹5,00,000 plus ₹11,000 re-charged; cost is the ₹14,000 spent.
    let p = (await w("GET", "profit")).json.projects.find((x: { id: string }) => x.id === ids.project);
    expect(p).toMatchObject({ billed: 11000_00, revenue: 511000_00, expenses: 14000_00, cost: 14000_00, toBill: 500000_00 });

    await db.update(schema.invoiceDocuments).set({ status: "void" }).where(eq(schema.invoiceDocuments.id, bill.invoice.id));
    expect((await w("GET", `billing/${ids.project}`)).json.expenses).toHaveLength(1);
    p = (await w("GET", "profit")).json.projects.find((x: { id: string }) => x.id === ids.project);
    expect(p).toMatchObject({ billed: 0, revenue: 511000_00, toBill: 511000_00 });
  });

  it("imports expenses from a sheet", async () => {
    const imp = await w("POST", "expenses/import", { rows: [{ date: "2026-10-12", amount: 2500_00, category: "Printing", vendor: "Quick Print", markupPct: 20 }, { date: "2026-10-13", amount: 100_00, project: "Nope" }], mode: "add", projectId: ids.project });
    expect(imp.json).toMatchObject({ created: 1, errors: [expect.objectContaining({ row: 1 })] });
    const all = (await w("GET", `projects/${ids.project}/expenses`)).json.expenses;
    expect(all.find((e: { vendor: string }) => e.vendor === "Quick Print")).toMatchObject({ amount: 2500_00, category: "Printing", markupPct: 20, charge: 3000_00 });
  });
});

describe("risks, changes and documents", () => {
  it("scores risks and keeps them in order", async () => {
    await w("POST", "risks", { projectId: ids.project, title: "Client slow on feedback", probability: 4, impact: 4, ownerId: editorId });
    await w("POST", "risks", { projectId: ids.project, kind: "issue", title: "Hosting outage", probability: 2, impact: 2, due: "2026-01-01" });
    const r = (await w("GET", `projects/${ids.project}/risks`)).json.risks;
    expect(r.map((x: { title: string; level: string }) => [x.title, x.level])).toEqual([["Client slow on feedback", "high"], ["Hosting outage", "low"]]);
    expect(r[0].owner).toBe("Dev Editor");
    expect(r[1].overdue).toBe(true);
  });

  it("holds an editor's change for a manager, then moves the budget, fee and due date", async () => {
    const c = (await w("POST", "changes", { projectId: ids.project, title: "Add a blog", hours: 20, fee: 80000_00, days: 7 }, editor)).json.change;
    expect(c.number).toBe("CR-001");
    expect((await w("POST", `changes/${c.id}/submit`, {}, editor)).json.status).toBe("pending");
    expect((await w("POST", `changes/${c.id}/decide`, { approve: true }, editor)).status).toBe(403);
    expect((await w("DELETE", `changes/${c.id}`)).status).toBe(409);
    expect((await w("POST", `changes/${c.id}/decide`, { approve: true })).json.status).toBe("approved");
    const p = (await w("GET", `projects/${ids.project}`)).json.project;
    expect(p).toMatchObject({ budgetHours: 120, fee: 580000_00, dueDate: "2026-12-07" });
    // A manager's own change takes effect straight away, and only once.
    const c2 = (await w("POST", "changes", { projectId: ids.project, title: "Drop the FAQ", hours: -5, fee: -10000_00 })).json.change;
    expect((await w("POST", `changes/${c2.id}/submit`, {})).json.status).toBe("approved");
    expect((await w("POST", `changes/${c2.id}/submit`, {})).status).toBe(409);
    expect((await w("GET", `projects/${ids.project}`)).json.project).toMatchObject({ budgetHours: 115, fee: 570000_00 });
    expect((await w("GET", `projects/${ids.project}/changes`)).json.changes.map((x: { number: string }) => x.number)).toEqual(["CR-002", "CR-001"]);
  });

  it("keeps links to the project's documents", async () => {
    expect((await w("POST", "docs", { projectId: ids.project, title: "Contract", url: "javascript:alert(1)" })).status).toBe(422);
    const d = (await w("POST", "docs", { projectId: ids.project, title: "Contract", url: "https://drive.example.com/contract" })).json.doc;
    expect((await w("GET", `projects/${ids.project}/docs`)).json.docs).toEqual([expect.objectContaining({ title: "Contract", by: "Meera Owner" })]);
    await w("DELETE", `docs/${d.id}`);
    expect((await w("GET", `projects/${ids.project}/docs`)).json.docs).toHaveLength(0);
  });
});
