import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as modules from "@/app/api/v1/orgs/[orgId]/modules/route";
import { hourlyCost, weekOf } from "@/lib/work/model";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let editor = "";
let viewer = "";
let orgId = "";
let ownerId = "";
let editorId = "";
const ids: Record<string, string> = {};
const w = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/work/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = (method: string, path: string, body?: unknown) => call(booksRoute[method as "GET"], { method, cookie: owner, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
// The clock is pinned to the latest Friday afternoon (IST), so this week's working days are
// all in the past — time can't be logged ahead — and a running timer still lands in the week.
const real = new Date();
vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate() - ((real.getUTCDay() + 2) % 7), 9, 30) });
// This week's Monday, so time can be logged on real working days.
const monday = weekOf(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
const day = (n: number) => new Date(Date.parse(`${monday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Owner", email: "meera.work@example.com", password: "correct-horse-42" } }));
  const meRes = (await call(me.GET, { cookie: owner })).json;
  orgId = meRes.organizations[0].id;
  ownerId = meRes.user.id;
  for (const [name, email, role] of [["Dev Editor", "dev.work@example.com", "editor"], ["Vik Viewer", "vik.work@example.com", "viewer"]] as const) {
    const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
    if (role === "editor") [editor, editorId] = [c, u.id];
    else viewer = c;
  }
});
afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
});

describe("Projects & timesheets", () => {
  it("opens with settings, the team and the books to bill from", async () => {
    const r = await w("GET", "meta");
    expect(r.status).toBe(200);
    expect(r.json.me).toMatchObject({ write: true, manage: true });
    expect(r.json.settings).toMatchObject({ dailyHours: 8, approval: true, projectPrefix: "PRJ-" });
    expect(r.json.people.map((p: { name: string }) => p.name)).toEqual(["Dev Editor", "Meera Owner", "Vik Viewer"]);
    ids.book = (await B("POST", "", { orgId, name: "Studio books" })).json.book.id;
    ids.client = (await B("POST", `${ids.book}/clients`, { name: "Rohan Mehta", company: "Lumen Labs", email: "rohan@lumen.example", billing: { line1: "", line2: "", city: "Pune", state: "Maharashtra", postalCode: "", country: "IN" }, notes: "" })).json.client.id;
    expect((await w("GET", "meta")).json.books.some((b: { id: string }) => b.id === ids.book)).toBe(true);
    expect((await w("GET", `clients?ownerId=${ids.book}`)).json.clients[0].company).toBe("Lumen Labs");
  });

  it("creates a project with a code, a team and rates", async () => {
    const r = await w("POST", "projects", { name: "Lumen website", ownerId: ids.book, clientId: ids.client, billing: "hourly", rate: 200000, budgetHours: 40, members: [{ userId: editorId, rate: 150000, costRate: 60000 }] });
    expect(r.status).toBe(200);
    expect(r.json.project).toMatchObject({ code: "PRJ-0001", clientName: "Lumen Labs", leadId: ownerId, status: "active" });
    ids.project = r.json.project.id;
    const d = (await w("GET", `projects/${ids.project}`)).json;
    // The lead is always on the team.
    expect(d.members.map((m: { name: string }) => m.name).sort()).toEqual(["Dev Editor", "Meera Owner"]);
    // A client from other books isn't accepted.
    const other = (await B("POST", "", { orgId, name: "Other" })).json.book.id;
    expect((await w("POST", "projects", { name: "Bad", ownerId: other, clientId: ids.client })).status).toBe(422);
    // Viewers can see, not plan.
    expect((await w("POST", "projects", { name: "Nope" }, viewer)).status).toBe(403);
    expect((await w("GET", "projects", undefined, viewer)).json.projects[0]).toMatchObject({ name: "Lumen website", rate: 0 });
  });

  it("keeps tasks on a board, numbered, with subtasks, checklists and comments", async () => {
    const mk = (title: string, extra: object = {}) => w("POST", "tasks", { projectId: ids.project, title, ...extra });
    ids.design = (await mk("Design the home page", { assigneeId: editorId, estimateHours: 10, checklist: [{ id: "a", text: "Mood board" }, { id: "b", text: "Wireframe" }] })).json.task.id;
    ids.build = (await mk("Build pages", { status: "doing", dueDate: "2020-01-01" })).json.task.id;
    const sub = (await mk("Hero section", { parentId: ids.design })).json.task;
    expect(sub.number).toBe(3);
    expect((await mk("Too deep", { parentId: sub.id })).status).toBe(422);
    // Assigning someone else emails them (recorded in the outbox in tests).
    const mail = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "dev.work@example.com"));
    expect(mail.some((m) => m.subject.includes("Design the home page"))).toBe(true);
    // Move into Review, ahead of nothing; then tick a checklist item as the assignee.
    expect((await w("POST", `tasks/${ids.design}/move`, { status: "review" })).json.task.status).toBe("review");
    expect((await w("POST", `tasks/${ids.design}/tick`, { item: "a", done: true }, editor)).json.checklist[0].done).toBe(true);
    expect((await w("POST", `tasks/${ids.design}/tick`, { item: "b", done: true }, viewer)).status).toBe(403);
    await w("POST", `tasks/${ids.design}/comments`, { body: "Client likes option B" }, editor);
    const d = (await w("GET", `tasks/${ids.design}`)).json;
    expect(d.subtasks).toHaveLength(1);
    expect(d.comments[0]).toMatchObject({ body: "Client likes option B", name: "Dev Editor" });
    const board = (await w("GET", `tasks?projectId=${ids.project}`)).json.tasks;
    expect(board).toHaveLength(2);
    expect(board.find((t: { id: string }) => t.id === ids.build).overdue).toBe(true);
    expect(board.find((t: { id: string }) => t.id === ids.design)).toMatchObject({ subtasks: 1, checklistDone: 1, comments: 1 });
    // My tasks.
    expect((await w("GET", "tasks?assignee=me", undefined, editor)).json.tasks.map((t: { title: string }) => t.title)).toEqual(["Design the home page"]);
  });

  it("logs time on the weekly grid, with a 24-hour day and locked weeks", async () => {
    const cell = (date: string, minutes: number, cookie = editor, taskId: string | null = ids.design) => w("PUT", "timesheet/cell", { projectId: ids.project, taskId, date, minutes }, cookie);
    expect((await cell(day(0), 180)).status).toBe(200);
    expect((await cell(day(1), 240)).status).toBe(200);
    // Lowering a cell trims it; 25 hours in a day is refused.
    await cell(day(1), 150);
    expect((await cell(day(2), 25 * 60)).status).toBe(422);
    const wk = (await w("GET", `timesheet?week=${monday}`, undefined, editor)).json;
    expect(wk.total).toBe(330);
    expect(wk.rows[0]).toMatchObject({ task: "Design the home page", total: 330 });
    expect(wk.capacity).toBe(6 * 8 * 60);
    expect(wk.status).toBe("draft");
    // An entry by hand, with a note.
    const e = await w("POST", "time", { projectId: ids.project, taskId: ids.build, date: day(2), minutes: 90, note: "Header and footer" }, editor);
    expect(e.json.entry).toMatchObject({ minutes: 90, billable: true, status: "draft" });
    // Logging for someone else needs owner or admin.
    expect((await w("POST", "time", { projectId: ids.project, date: day(2), minutes: 30, userId: ownerId }, editor)).status).toBe(403);
    // Submit the week: it's locked for the editor.
    expect((await w("POST", "timesheet/submit", { week: monday }, editor)).json).toMatchObject({ entries: 3, status: "submitted" });
    expect((await cell(day(0), 60)).status).toBe(409);
    // Taken back, changed, sent again.
    await w("POST", "timesheet/recall", { week: monday }, editor);
    await cell(day(0), 240);
    await w("POST", "timesheet/submit", { week: monday }, editor);
  });

  it("runs a timer that stops into an entry", async () => {
    const t = await w("POST", "timer/start", { projectId: ids.project, taskId: ids.build, note: "Bug fixing" });
    expect(t.json.timer).toMatchObject({ project: "Lumen website", task: "Build pages" });
    // Pretend it ran 47 minutes.
    await db.update(schema.workTime).set({ timerStartedAt: new Date(Date.now() - 47 * 60_000) }).where(eq(schema.workTime.id, t.json.id));
    const stop = await w("POST", "timer/stop", {});
    expect(stop.json.minutes).toBe(47);
    expect((await w("GET", "timer")).json.timer).toBeNull();
    expect((await w("POST", "timer/stop", {})).status).toBe(409);
  });

  it("approves or sends back weeks, and tells the person why", async () => {
    const q = (await w("GET", "approvals")).json.weeks;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ name: "Dev Editor", week: monday, minutes: 240 + 150 + 90 });
    expect((await w("GET", "approvals", undefined, editor)).status).toBe(403);
    expect((await w("POST", "approvals", { userId: editorId, week: monday, approve: false })).status).toBe(422);
    await w("POST", "approvals", { userId: editorId, week: monday, approve: false, note: "Split Tuesday between tasks" });
    expect((await w("GET", `timesheet?week=${monday}`, undefined, editor)).json).toMatchObject({ status: "rejected", rejected: "Split Tuesday between tasks" });
    const mail = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "dev.work@example.com"));
    expect(mail.some((m) => m.subject.includes("needs changes"))).toBe(true);
    await w("POST", "timesheet/submit", { week: monday }, editor);
    expect((await w("POST", "approvals", { userId: editorId, week: monday, approve: true })).json.entries).toBe(3);
    // The owner's own timer entry is a draft until submitted and approved too.
    await w("POST", "timesheet/submit", { week: monday });
    await w("POST", "approvals", { userId: ownerId, week: monday, approve: true });
  });

  it("bills approved time to the client as a draft invoice, once", async () => {
    const preview = (await w("GET", `billing/${ids.project}`)).json;
    expect(preview.ready).toBe(true);
    // The editor's hours at their own rate (₹1,500), the owner's at the project's (₹2,000); one line per task and rate.
    const lines = preview.lines.map((l: { name: string; minutes: number; rate: number }) => [l.name, l.minutes, l.rate]).sort();
    expect(lines).toEqual([["Build pages", 47, 200000], ["Build pages", 90, 150000], ["Design the home page", 390, 150000]].sort());
    const bill = await w("POST", `billing/${ids.project}`, { groupBy: "task" });
    expect(bill.status).toBe(200);
    expect(bill.json.entries).toBe(4);
    const doc = (await B("GET", `${ids.book}/documents/${bill.json.invoice.id}`)).json.document;
    expect(doc).toMatchObject({ status: "draft", type: "invoice", reference: "PRJ-0001", clientId: ids.client });
    expect(doc.lines).toHaveLength(3);
    // 6.5h × ₹1,500 + 1.5h × ₹1,500 + 0.783h × ₹2,000 = ₹9,750 + ₹2,250 + ₹1,566
    expect(doc.subtotal).toBe(975000 + 225000 + 156600);
    // Nothing left to bill; billed time is locked.
    expect((await w("POST", `billing/${ids.project}`, {})).status).toBe(409);
    const entry = (await w("GET", `time?projectId=${ids.project}`)).json.entries[0];
    expect(entry.invoiceId).toBe(bill.json.invoice.id);
    expect((await w("DELETE", `time/${entry.id}`)).status).toBe(409);
    // Deleting the draft frees the time again.
    await B("DELETE", `${ids.book}/documents/${bill.json.invoice.id}`);
    expect((await w("GET", `billing/${ids.project}`)).json.entries).toBe(4);
    ids.invoice = (await w("POST", `billing/${ids.project}`, { groupBy: "single" })).json.invoice.id;
    expect((await B("GET", `${ids.book}/documents/${ids.invoice}`)).json.document.lines).toHaveLength(2);
  });

  it("bills reached milestones on fixed-fee projects", async () => {
    const p = (await w("POST", "projects", { name: "Lumen brand book", ownerId: ids.book, clientId: ids.client, billing: "fixed", fee: 5000000 })).json.project;
    const m1 = (await w("POST", "milestones", { projectId: p.id, name: "Concepts", amount: 2000000 })).json.milestone;
    await w("POST", "milestones", { projectId: p.id, name: "Final files", amount: 3000000 });
    expect((await w("POST", `billing/${p.id}`, { milestoneIds: [m1.id] })).status).toBe(409);
    await w("POST", `milestones/${m1.id}/done`, { done: true });
    const r = await w("POST", `billing/${p.id}`, { milestoneIds: [m1.id] });
    expect(r.status).toBe(200);
    const doc = (await B("GET", `${ids.book}/documents/${r.json.invoice.id}`)).json.document;
    expect(doc.lines[0]).toMatchObject({ name: "Concepts", rate: 2000000, quantity: 1 });
    expect((await w("DELETE", `milestones/${m1.id}`)).status).toBe(409);
    // Issued and voided: the milestone can be billed again.
    await B("POST", `${ids.book}/documents/${r.json.invoice.id}/issue`, {});
    await B("POST", `${ids.book}/documents/${r.json.invoice.id}/void`, { reason: "Wrong amount" });
    expect((await w("GET", `billing/${p.id}`)).json.milestones).toHaveLength(1);
  });

  it("shows profit with costs from the project or from HR salaries", async () => {
    await call(modules.PUT, { method: "PUT", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules`, body: { modules: ["work", "invoicing", "crm", "hr"] } });
    await db.insert(schema.hrEmployees).values({ orgId, empNo: "E-1", userId: ownerId, name: "Meera Owner", joinDate: "2024-01-01", ctc: 2_400_000_00 });
    const r = (await w("GET", "profit")).json;
    expect(r.usesHr).toBe(true);
    const lumen = r.projects.find((p: { name: string }) => p.name === "Lumen website");
    // Editor: 480 minutes at ₹600 = ₹4,800. Owner: 47 minutes at their HR hourly cost.
    const ownerRate = hourlyCost(2_400_000_00, { dailyHours: 8, workDays: [1, 2, 3, 4, 5, 6] });
    expect(lumen.cost).toBe(480000 + Math.round((47 * ownerRate) / 60));
    expect(lumen.billed).toBe(975000 + 225000 + 156600);
    expect(r.missingCost).toEqual([]);
    // Without a cost rate or HR salary, people are listed as missing a cost.
    expect((await w("GET", "profit", undefined, editor)).status).toBe(403);
  });

  it("reports hours by project and person against capacity, less HR leave", async () => {
    const r = (await w("GET", `reports?from=${monday}&to=${day(6)}`)).json;
    expect(r.totals.minutes).toBe(480 + 47);
    const dev = r.byPerson.find((p: { name: string }) => p.name === "Dev Editor");
    expect(dev).toMatchObject({ minutes: 480, capacity: 6 * 8 * 60 });
    // Everyone on the team appears.
    expect(r.byPerson.some((p: { name: string; minutes: number }) => p.name === "Vik Viewer" && p.minutes === 0)).toBe(true);
    // Others only see their own.
    const mine = (await w("GET", `reports?from=${monday}&to=${day(6)}`, undefined, editor)).json;
    expect(mine.byPerson.map((p: { name: string }) => p.name)).toEqual(["Dev Editor"]);
    const home = (await w("GET", "home", undefined, editor)).json;
    expect(home.week.total).toBe(480);
    expect(home.counts.open).toBe(1);
  });

  it("starts a project from a won CRM deal, with its client matched", async () => {
    const crm = (method: string, path: string, body?: unknown) => call(crmApi[method as "GET"], { method, cookie: owner, body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
    const pipe = (await crm("GET", "meta")).json.pipelines[0];
    const [co] = await db.insert(schema.crmCompanies).values({ orgId, name: "Lumen Labs" }).returning();
    const [deal] = await db.insert(schema.crmDeals).values({ orgId, pipelineId: pipe.id, stageId: pipe.stages[0].id, title: "Lumen app redesign", value: 8_00_000_00, companyId: co.id, status: "won" }).returning();
    const r = (await w("GET", `deals/${deal.id}`)).json;
    expect(r.prefill).toMatchObject({ name: "Lumen app redesign", fee: 8_00_000_00, billing: "fixed", clientId: ids.client, ownerId: ids.book });
    const p = (await w("POST", "projects", r.prefill)).json.project;
    expect((await w("GET", `projects/${p.id}`)).json.deal).toMatchObject({ title: "Lumen app redesign" });
    expect((await w("GET", `deals/${deal.id}`)).json.existing.id).toBe(p.id);
  });

  it("imports projects, tasks and time from messy sheets", async () => {
    const rows = [
      { name: "Annual report", code: "AR-26", client: "lumen labs", status: "active", billing: "hourly", rate: 180000, budgetHours: 30, lead: "dev.work@example.com" },
      { name: "Lumen website", status: "on_hold" },
    ];
    const r = (await w("POST", "projects/import", { rows, mode: "update" })).json;
    expect(r).toMatchObject({ created: 1, updated: 1 });
    const ar = (await w("GET", "projects?status=all")).json.projects.find((p: { code: string }) => p.code === "AR-26");
    expect(ar).toMatchObject({ clientId: ids.client, leadId: editorId, rate: 180000 });
    const t = (await w("POST", "tasks/import", { rows: [{ title: "Draft copy", project: "AR-26", status: "doing", assignee: "Dev", milestone: "First draft", dueDate: "2026-11-05", tags: "copy, writing" }, { title: "Lost task", project: "Nope" }], mode: "update" })).json;
    expect(t.created).toBe(1);
    expect(t.errors[0].message).toContain("no project called");
    const tasks = (await w("GET", `tasks?projectId=${ar.id}`)).json.tasks;
    expect(tasks[0]).toMatchObject({ title: "Draft copy", status: "doing", assigneeId: editorId, tags: ["copy", "writing"] });
    const tm = (await w("POST", "time/import", { rows: [{ date: day(3), minutes: 150, project: "AR-26", task: "#1", note: "Outline" }, { date: day(3), minutes: 60, project: "AR-26", person: "Dev Editor" }], mode: "add" }, editor)).json;
    expect(tm.created).toBe(2);
    // Time for someone else needs owner or admin.
    const no = (await w("POST", "time/import", { rows: [{ date: day(3), minutes: 60, project: "AR-26", person: "meera.work@example.com" }], mode: "add" }, editor)).json;
    expect(no.errors).toHaveLength(1);
  });

  it("stops invoiced projects being deleted and honours switched-off parts", async () => {
    expect((await w("DELETE", `projects/${ids.project}`)).status).toBe(409);
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    await db.update(schema.organizations).set({ partsOff: { ...(org.partsOff as object), work: ["billing"] } }).where(eq(schema.organizations.id, orgId));
    expect((await w("GET", "billing")).status).toBe(403);
    expect((await w("GET", "meta")).json.parts).toMatchObject({ billing: false, timesheets: true });
    await db.update(schema.organizations).set({ modules: ["invoicing"] }).where(eq(schema.organizations.id, orgId));
    expect((await w("GET", "meta")).status).toBe(403);
  });
});
