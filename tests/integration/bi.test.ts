import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/bi/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import { sendDue } from "@/server/bi/core";
import { call, cookieFrom, resetDb } from "../helpers";

// Datasets by role, a report grouped, filtered and measured, the CRM's
// "own records" rule holding in reports, values that try to be SQL staying
// values, a KPI against the period before, dashboards, report files, and a
// scheduled email.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const B = mk(api, "bi");
const CRM = mk(crmApi, "crm");
const I = mk(invApi, "inventory");
const spec = (x: object) => ({ measures: [{ agg: "count" }], range: { preset: "all" }, ...x });

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bina Boss", email: "bina.bi@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [k, role] of [["rep", "editor"], ["viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "rep" ? "Ravi Rep" : "Vee Viewer", email: `${k}.bi@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.bi@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  const meta = (await CRM("GET", "meta")).json;
  const won = meta.pipelines[0].stages.find((s: { kind: string }) => s.kind === "won").id;
  for (const [title, value, owner, win] of [["A", 100000_00, "owner", true], ["B", 50000_00, "owner", false], ["C", 30000_00, "rep", true], ["D", 20000_00, "rep", false]] as const) {
    const d = (await CRM("POST", "deals", { title, value, ownerId: U[owner] })).json.deal;
    if (win) await CRM("POST", `deals/${d.id}/move`, { stageId: won });
  }
  await I("GET", "meta");
  const wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  const item = (await I("POST", "items", { name: "Steel shelf", sku: "SH-1", unit: "pcs", gstRate: 18 })).json.item.id;
  await I("POST", "receipts", { warehouseId: wh, date: "2026-10-01", lines: [{ itemId: item, qty: 10, rate: 1500_00, gstRate: 18 }] });
});
afterAll(closeDb);

describe("datasets and reports", () => {
  it("offers each role only the data it may read", async () => {
    const owner = (await B("GET", "meta")).json.datasets.map((d: { id: string }) => d.id);
    expect(owner).toEqual(expect.arrayContaining(["deals", "contacts", "stock", "ledger", "invoices", "employees"]));
    const viewer = (await B("GET", "meta", undefined, "viewer")).json.datasets.map((d: { id: string }) => d.id);
    expect(viewer).toContain("deals");
    expect(viewer).not.toContain("ledger");
    expect(viewer).not.toContain("employees");
    expect((await B("POST", "preview", { dataset: "ledger", spec: spec({}) }, "viewer")).status).toBe(403);
    // Salary is only for those who run payroll.
    const emp = (await B("GET", "meta")).json.datasets.find((d: { id: string }) => d.id === "employees");
    expect(emp.fields.map((f: { key: string }) => f.key)).toContain("ctc");
  });

  it("groups, measures, filters and sorts", async () => {
    const r = (await B("POST", "preview", { dataset: "deals", spec: spec({ dims: [{ field: "owner" }], measures: [{ agg: "count" }, { field: "value", agg: "sum" }, { field: "won", agg: "sum" }], sort: { by: "m1", dir: "desc" } }) })).json;
    expect(r.columns.map((c: { label: string }) => c.label)).toEqual(["Owner", "Count", "Total value", "Total won value"]);
    expect(r.rows).toEqual([["Bina Boss", 2, 150000_00, 100000_00], ["Ravi Rep", 2, 50000_00, 30000_00]]);
    expect(r.totals).toEqual([null, 4, 200000_00, 130000_00]);
    // Money filters are typed in rupees.
    const big = (await B("POST", "preview", { dataset: "deals", spec: spec({ filters: [{ field: "value", op: "gte", value: 50000 }, { field: "status", op: "eq", value: "won" }] }) })).json;
    expect(big.rows).toEqual([[1]]);
    // "Is one of" lists, for text and money (a JS array once broke the SQL).
    expect((await B("POST", "preview", { dataset: "deals", spec: spec({ filters: [{ field: "owner", op: "in", value: ["Bina Boss", "Nobody, with a comma"] }] }) })).json.rows).toEqual([[2]]);
    expect((await B("POST", "preview", { dataset: "deals", spec: spec({ filters: [{ field: "owner", op: "in", value: ["Ravi Rep"] }] }) })).json.rows).toEqual([[2]]);
    const months = (await B("POST", "preview", { dataset: "deals", spec: spec({ dims: [{ field: "created", bucket: "month" }], range: { preset: "this_month" } }) })).json;
    expect(months.rows).toHaveLength(1);
    expect(months.rows[0][0]).toMatch(/^\d{4}-\d{2}-01$/);
    const stock = (await B("POST", "preview", { dataset: "stock", spec: spec({ dims: [{ field: "item" }], measures: [{ field: "qty", agg: "sum" }, { field: "value", agg: "sum" }] }) })).json;
    expect(stock.rows).toEqual([["Steel shelf", 10, 15000_00]]);
  });

  it("keeps values as values, and refuses unknown fields", async () => {
    const evil = "x'; drop table crm_deals; --";
    const r = await B("POST", "preview", { dataset: "deals", spec: spec({ filters: [{ field: "title", op: "eq", value: evil }, { field: "owner", op: "contains", value: "%" }] }) });
    expect(r.status).toBe(200);
    expect(r.json.rows).toEqual([[0]]);
    expect((await db.select().from(schema.crmDeals).where(eq(schema.crmDeals.orgId, orgId))).length).toBe(4);
    expect((await B("POST", "preview", { dataset: "deals", spec: spec({ dims: [{ field: "x_from_users" }] }) })).status).toBe(422);
    expect((await B("POST", "preview", { dataset: "deals", spec: spec({ measures: [{ field: "title", agg: "sum" }] }) })).status).toBe(422);
  });

  it("holds the CRM's 'own records' rule in reports", async () => {
    await CRM("PUT", "settings", { visibility: "own" });
    const r = (await B("POST", "preview", { dataset: "deals", spec: spec({ measures: [{ field: "value", agg: "sum" }] }) }, "rep")).json;
    expect(r.rows).toEqual([[50000_00]]);
    expect((await B("POST", "preview", { dataset: "deals", spec: spec({ measures: [{ field: "value", agg: "sum" }] }) })).json.rows).toEqual([[200000_00]]);
  });
});

describe("saved reports, KPIs, dashboards and schedules", () => {
  it("saves, runs with another range, compares a KPI, and travels as a file", async () => {
    const rep = (await B("POST", "reports", { name: "Won value", dataset: "deals", spec: { measures: [{ field: "won", agg: "sum" }], range: { preset: "last_30" }, chart: "number", compare: true } })).json.report;
    ids.won = rep.id;
    const run = (await B("GET", `reports/${rep.id}`)).json;
    expect(run.result.rows).toEqual([[130000_00]]);
    expect(run.result.compare).toEqual({ previous: 0, change: null });
    expect((await B("GET", `reports/${rep.id}?preset=last_year`)).json.result.rows).toEqual([[0]]);
    const file = (await B("GET", `reports/${rep.id}/export`)).json;
    expect(file).toMatchObject({ cloudeskReport: 1, name: "Won value", dataset: "deals" });
    const copy = (await B("POST", "reports/import", file, "rep")).json.report;
    expect(copy).toMatchObject({ name: "Won value", shared: false });
    // A private report isn't the viewer's to see.
    expect((await B("GET", `reports/${copy.id}`, undefined, "viewer")).status).toBe(404);
    expect((await B("PUT", `reports/${rep.id}`, { name: "Mine now", dataset: "deals", spec: file.spec }, "rep")).status).toBe(403);
  });

  it("shows a dashboard, with a widget the person can't open saying so", async () => {
    const ledger = (await B("POST", "reports", { name: "Ledger by type", dataset: "ledger", spec: spec({ dims: [{ field: "accountType" }], measures: [{ field: "net", agg: "sum" }] }) })).json.report;
    const d = (await B("POST", "dashboards", { name: "Weekly", widgets: [{ id: "w1", reportId: ids.won, size: "s", target: 2000000 }, { id: "w2", reportId: ledger.id, size: "l" }] })).json.dashboard;
    const mine = (await B("GET", `dashboards/${d.id}`)).json;
    expect(mine.widgets.map((w: { error: string | null }) => w.error)).toEqual([null, null]);
    const theirs = (await B("GET", `dashboards/${d.id}`, undefined, "viewer")).json;
    // CRM visibility is "own" now, and the viewer owns no deals: the KPI is theirs, at nothing.
    expect(theirs.widgets[0]).toMatchObject({ error: null, result: { rows: [[0]] } });
    expect(theirs.widgets[1]).toMatchObject({ result: null, error: "That data isn't open to you" });
  });

  it("emails a scheduled report as whoever set it up, and pauses it if they leave", async () => {
    const sch = (await B("POST", "schedules", { reportId: ids.won, frequency: "daily", hour: 9, recipients: [U.owner, U.viewer] })).json.schedule;
    expect(new Date(sch.nextAt).getTime()).toBeGreaterThan(Date.now());
    await db.update(schema.biSchedules).set({ nextAt: new Date(Date.now() - 60_000) }).where(eq(schema.biSchedules.id, sch.id));
    expect(await sendDue()).toBe(1);
    const mails = (await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "viewer.bi@example.com"))).filter((x) => x.subject.startsWith("Won value"));
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/^Won value \(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\)$/);
    expect(mails[0].body).toContain("₹1,30,000");
    const [after] = await db.select().from(schema.biSchedules).where(eq(schema.biSchedules.id, sch.id));
    expect(after.nextAt.getTime()).toBeGreaterThan(Date.now());
    expect(await sendDue()).toBe(0);

    const repSch = (await B("POST", "schedules", { reportId: ids.won, frequency: "weekly", recipients: [U.rep] }, "rep")).json.schedule;
    await db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, U.rep)));
    await db.update(schema.biSchedules).set({ nextAt: new Date(Date.now() - 60_000) }).where(eq(schema.biSchedules.id, repSch.id));
    await sendDue();
    const [paused] = await db.select().from(schema.biSchedules).where(eq(schema.biSchedules.id, repSch.id));
    expect(paused).toMatchObject({ active: false, lastError: "Whoever set this up is no longer in the workspace" });
  });
});
