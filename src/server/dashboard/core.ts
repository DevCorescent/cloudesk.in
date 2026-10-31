// The Home dashboard: headline numbers, charts, what needs attention, what's
// waiting on you, recent activity and quick actions — each only for modules
// the workspace has switched on and this person's role can see. Every figure
// comes from the workspace's own records; a block that fails or has nothing
// to show is left out rather than shown as zero.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { home as accountsHome } from "../accounting/reports";
import { scope as accountsScope } from "../accounting/access";
import { myWork } from "../approvals/inbox";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { log } from "../log";

type Fmt = "money" | "number" | "hours" | "percent";
export type Kpi = { id: string; module: ModuleId | "core"; label: string; value: number; format: Fmt; sub?: string; change?: number | null; good?: "up" | "down"; href: string };
export type Insight = { id: string; module: ModuleId | "core"; tone: "danger" | "warning" | "info" | "success"; title: string; detail: string; href: string };
type Col = { key: string; label: string; type: "date" | "money" | "count" | "text" | "number"; bucket?: string | null };
type Result = { dims: number; columns: Col[]; rows: (string | number | null)[][]; totals: (number | null)[]; range: { from: string | null; to: string | null }; truncated: boolean };
export type ChartBlock = { id: string; module: ModuleId; title: string; sub: string; kind: "bar" | "line" | "area"; result: Result; href: string };

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));
const n = (x: unknown) => Number(x ?? 0);
const istNow = () => new Date(Date.now() + 5.5 * 3_600_000);
const today = () => istNow().toISOString().slice(0, 10);
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const prevMonthStart = (d: string) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() - 1);
  return x.toISOString().slice(0, 10);
};
/** The same stretch of last month: 1st to the same day (capped at its last day). */
const samePeriodLastMonth = (d: string) => {
  const from = prevMonthStart(d);
  const last = new Date(Date.parse(`${d.slice(0, 7)}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const to = `${from.slice(0, 8)}${d.slice(8, 10)}`;
  return { from, to: to > last ? last : to };
};
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const inr = (p: number) => {
  const r = p / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const months6 = (d: string) => Array.from({ length: 6 }, (_, i) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() - 5 + i);
  return x.toISOString().slice(0, 10);
});
const days = (d: string, k: number) => Array.from({ length: k }, (_, i) => addDays(d, i - k + 1));

function series(xs: string[], bucket: "month" | "day", cols: { key: string; label: string; type: "money" | "count" }[], get: (x: string, key: string) => number): Result {
  const rows = xs.map((x) => [x, ...cols.map((c) => get(x, c.key))]);
  return {
    dims: 1,
    columns: [{ key: "x", label: bucket === "month" ? "Month" : "Day", type: "date", bucket }, ...cols],
    rows,
    totals: [null, ...cols.map((_, i) => rows.reduce((a, r) => a + Number(r[i + 1] ?? 0), 0))],
    range: { from: xs[0] ?? null, to: xs[xs.length - 1] ?? null },
    truncated: false,
  };
}

export type Ctx = { orgId: string; userId: string; role: Role; on: (m: ModuleId) => boolean };

export async function context(ctx: AuthedContext, orgId: string): Promise<Ctx> {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  // Only what the workspace's plan includes (and the member's role allows).
  const ent = await (await import("../billing/subscriptions")).entitlementFor(orgId);
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null, entitled: ent.state === "expired" ? null : ent.modules };
  return { orgId, userId: ctx.user.id, role, on: (id) => visibleTo(visible, id) };
}

/** Runs one block; a failure is logged and the block left out. */
export async function safely<T>(name: string, orgId: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    if (!(e instanceof ApiError)) log.error("dashboard block failed", { orgId, block: name, error: String(e) });
    return null;
  }
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

type Block = { kpis?: Kpi[]; insights?: Insight[]; charts?: ChartBlock[]; links?: Record<string, string> };

/** Invoices (finance books and web apps' invoicing), in rupees only. */
async function invoicing(c: Ctx): Promise<Block> {
  const d = today();
  const docs = sql`select d.* from invoice_documents d join invoice_owners o on o.id = d.project_id left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${c.orgId} and d.type = 'invoice' and d.status not in ('draft', 'void') and d.currency = 'INR'`;
  const last = samePeriodLastMonth(d);
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`with docs as (${docs}) select
      coalesce(sum(total) filter (where issue_date >= ${monthStart(d)}::date), 0) as month,
      coalesce(sum(total) filter (where issue_date between ${last.from}::date and ${last.to}::date), 0) as prev,
      coalesce(sum(total - amount_paid) filter (where total > amount_paid), 0) as owed,
      count(*) filter (where total > amount_paid) as owed_n,
      coalesce(sum(total - amount_paid) filter (where total > amount_paid and due_date < ${d}::date), 0) as overdue,
      count(*) filter (where total > amount_paid and due_date < ${d}::date) as overdue_n,
      count(*) as n
    from docs`));
  if (!n(k?.n)) return {};
  const ms = months6(d);
  const billed = new Map(rowsOf<{ m: string; v: string }>(await db.execute(sql`with docs as (${docs}) select to_char(date_trunc('month', issue_date), 'YYYY-MM-DD') as m, sum(total) as v from docs where issue_date >= ${ms[0]}::date group by 1`)).map((r) => [r.m, n(r.v)]));
  const got = new Map(rowsOf<{ m: string; v: string }>(await db.execute(sql`with docs as (${docs}) select to_char(date_trunc('month', p.paid_on), 'YYYY-MM-DD') as m, sum(p.amount) as v from invoice_payments p join docs on docs.id = p.document_id where p.paid_on >= ${ms[0]}::date group by 1`)).map((r) => [r.m, n(r.v)]));
  const [book] = await db.select({ id: schema.financeBooks.id }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, c.orgId)).orderBy(schema.financeBooks.createdAt).limit(1);
  const insights: Insight[] = [];
  if (n(k!.overdue_n)) insights.push({ id: "inv-overdue", module: "invoicing", tone: "danger", title: `${inr(n(k!.overdue))} overdue from ${n(k!.overdue_n)} invoice${n(k!.overdue_n) === 1 ? "" : "s"}`, detail: "Past their due date — a reminder usually brings most of it in.", href: book ? `/finance/${book.id}/invoices` : "/finance" });
  return {
    kpis: [
      { id: "invoiced", module: "invoicing", label: "Invoiced this month", value: n(k!.month), format: "money", change: change(n(k!.month), n(k!.prev)), good: "up", sub: "vs the same days last month", href: book ? `/finance/${book.id}/invoices` : "/finance" },
      { id: "owed", module: "invoicing", label: "Customers owe you", value: n(k!.owed), format: "money", sub: `${n(k!.owed_n)} unpaid invoice${n(k!.owed_n) === 1 ? "" : "s"}`, href: book ? `/finance/${book.id}/invoices` : "/finance" },
    ],
    insights,
    charts: [{ id: "invoicing", module: "invoicing", title: "Invoiced and collected", sub: "Last six months, in rupees", kind: "bar", href: "/finance", result: series(ms, "month", [{ key: "billed", label: "Invoiced", type: "money" }, { key: "got", label: "Collected", type: "money" }], (x, key) => (key === "billed" ? billed.get(x) : got.get(x)) ?? 0) }],
    links: book ? { newInvoice: `/finance/${book.id}/invoices/new` } : {},
  };
}

async function accounting(ctx: AuthedContext, c: Ctx): Promise<Block> {
  const s = await accountsScope(ctx, c.orgId);
  const h = await accountsHome(s);
  const ms = months6(today());
  const byMonth = new Map(h.trend.map((t) => [`${t.month}-01`, t]));
  const insights: Insight[] = [];
  if (h.payableLate > 0) insights.push({ id: "acc-payable-late", module: "accounting", tone: "warning", title: `${inr(h.payableLate)} owed to suppliers is past due`, detail: "Plan a payment run before it costs you goodwill or interest.", href: "/accounts/payments" });
  if (h.cashAndBank < 0) insights.push({ id: "acc-negative-cash", module: "accounting", tone: "danger", title: "Cash and bank are below zero in your books", detail: "Usually a payment recorded without its receipt, or a bank statement not yet matched.", href: "/accounts/banking" });
  if (h.gst.net > 0) insights.push({ id: "acc-gst", module: "accounting", tone: "info", title: `${inr(h.gst.net)} GST payable so far`, detail: "Output tax less input credit, from your books today.", href: "/accounts/gst" });
  const hasTrend = h.trend.some((t) => t.income || t.expenses);
  // Books with nothing in them yet: no row of ₹0 tiles.
  const empty = !hasTrend && !h.cashAndBank && !h.payable && !h.receivable && !h.month.income && !h.month.expenses;
  return {
    kpis: empty ? [] : [
      { id: "cash", module: "accounting", label: "Cash and bank", value: h.cashAndBank, format: "money", sub: "in your books", href: "/accounts/banking" },
      { id: "profit", module: "accounting", label: "Profit this month", value: h.month.net, format: "money", sub: `${inr(h.month.income)} in · ${inr(h.month.expenses)} out`, good: "up", href: "/accounts/reports" },
      { id: "payable", module: "accounting", label: "You owe suppliers", value: h.payable, format: "money", sub: h.payableLate ? `${inr(h.payableLate)} overdue` : "nothing overdue", good: "down", href: "/accounts/bills" },
    ],
    insights,
    charts: hasTrend ? [{ id: "accounts", module: "accounting", title: "Income and expenses", sub: "Last six months, from your books", kind: "bar", href: "/accounts/reports", result: series(ms, "month", [{ key: "income", label: "Income", type: "money" }, { key: "expenses", label: "Expenses", type: "money" }], (x, key) => n((byMonth.get(x) as Record<string, number> | undefined)?.[key])) }] : [],
  };
}

/** Online store and counter sales: paid, not cancelled, in rupees, net of refunds. */
async function store(c: Ctx): Promise<Block> {
  const d = today();
  const last = samePeriodLastMonth(d);
  const orders = sql`select o.*, (o.paid_at at time zone 'Asia/Kolkata')::date as day from store_orders o join projects p on p.id = o.project_id where p.org_id = ${c.orgId} and o.paid_at is not null and o.cancelled_at is null and o.currency = 'INR'`;
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`with o as (${orders}) select
      coalesce(sum(total - refunded_total) filter (where day >= ${monthStart(d)}::date), 0) as month,
      coalesce(sum(total - refunded_total) filter (where day between ${last.from}::date and ${last.to}::date), 0) as prev,
      count(*) filter (where day >= ${monthStart(d)}::date) as orders,
      count(*) filter (where day = ${d}::date) as today,
      count(*) filter (where fulfillment_status = 'unfulfilled' and channel <> 'pos') as to_ship,
      count(*) as n from o`));
  if (!n(k?.n)) return {};
  const xs = days(d, 14);
  const daily = new Map(rowsOf<{ d: string; v: string; c: string }>(await db.execute(sql`with o as (${orders}) select to_char(day, 'YYYY-MM-DD') as d, sum(total - refunded_total) as v, count(*) as c from o where day >= ${xs[0]}::date group by 1`)).map((r) => [r.d, r]));
  const insights: Insight[] = [];
  if (n(k!.to_ship)) insights.push({ id: "store-ship", module: "store", tone: "warning", title: `${n(k!.to_ship)} paid order${n(k!.to_ship) === 1 ? "" : "s"} waiting to be shipped`, detail: "Customers have paid; pack and dispatch them next.", href: "/projects" });
  return {
    kpis: [{ id: "sales", module: "store", label: "Shop sales this month", value: n(k!.month), format: "money", change: change(n(k!.month), n(k!.prev)), good: "up", sub: `${n(k!.orders)} orders · ${n(k!.today)} today`, href: "/projects" }],
    insights,
    charts: [{ id: "store", module: "store", title: "Shop sales", sub: "Last 14 days, online and at the counter", kind: "area", href: "/projects", result: series(xs, "day", [{ key: "v", label: "Sales", type: "money" }], (x) => n(daily.get(x)?.v)) }],
  };
}

async function crm(c: Ctx): Promise<Block> {
  const D = schema.crmDeals;
  const S = schema.crmStages;
  const stages = rowsOf<{ name: string; v: string; c: string; sort: number; pipeline: string }>(await db.execute(sql`select s.name, s.sort, s.pipeline_id as pipeline, coalesce(sum(d.value), 0) as v, count(d.id) as c
    from crm_stages s left join crm_deals d on d.stage_id = s.id and d.status = 'open'
    where s.org_id = ${c.orgId} and s.kind = 'open' and s.pipeline_id = (select id from crm_pipelines where org_id = ${c.orgId} order by created_at limit 1)
    group by s.id, s.name, s.sort, s.pipeline_id order by s.sort`));
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select
      coalesce(sum(value) filter (where status = 'open'), 0) as open_v, count(*) filter (where status = 'open') as open_n,
      coalesce(sum(value) filter (where status = 'won' and closed_at >= date_trunc('month', now())), 0) as won_v,
      count(*) filter (where status = 'won' and closed_at >= date_trunc('month', now())) as won_n,
      count(*) filter (where status = 'open' and expected_close < ${today()}::date) as late_n
    from crm_deals where org_id = ${c.orgId}`));
  const [stale] = rowsOf<{ c: string }>(await db.execute(sql`select count(*) as c from ${D} d join ${S} s on s.id = d.stage_id where d.org_id = ${c.orgId} and d.status = 'open' and s.rot_days > 0 and d.updated_at < now() - (s.rot_days || ' days')::interval`));
  const insights: Insight[] = [];
  if (n(stale?.c)) insights.push({ id: "crm-stale", module: "crm", tone: "warning", title: `${n(stale!.c)} deal${n(stale!.c) === 1 ? " has" : "s have"} gone quiet`, detail: "No change for longer than their stage allows — a nudge keeps them warm.", href: "/crm/deals" });
  if (n(k?.late_n)) insights.push({ id: "crm-late", module: "crm", tone: "info", title: `${n(k!.late_n)} open deal${n(k!.late_n) === 1 ? " is" : "s are"} past the expected close date`, detail: "Update the date or the stage so your forecast stays honest.", href: "/crm/deals" });
  const hasDeals = stages.some((s) => n(s.c));
  return {
    kpis: n(k?.open_n) || n(k?.won_n) ? [
      { id: "pipeline", module: "crm", label: "Open pipeline", value: n(k!.open_v), format: "money", sub: `${n(k!.open_n)} deal${n(k!.open_n) === 1 ? "" : "s"}`, href: "/crm/deals" },
      { id: "won", module: "crm", label: "Won this month", value: n(k!.won_v), format: "money", sub: `${n(k!.won_n)} deal${n(k!.won_n) === 1 ? "" : "s"}`, good: "up", href: "/crm/deals" },
    ] : [],
    insights,
    charts: hasDeals ? [{ id: "pipeline", module: "crm", title: "Pipeline by stage", sub: "Value of open deals in your main pipeline", kind: "bar", href: "/crm/deals", result: { dims: 1, columns: [{ key: "stage", label: "Stage", type: "text" }, { key: "v", label: "Deal value", type: "money" }], rows: stages.map((s) => [s.name, n(s.v)]), totals: [null, stages.reduce((a, s) => a + n(s.v), 0)], range: { from: null, to: null }, truncated: false } }] : [],
  };
}

async function helpdesk(c: Ctx): Promise<Block> {
  const T = schema.hdTickets;
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select
      count(*) filter (where status not in ('resolved', 'closed')) as open,
      count(*) filter (where status not in ('resolved', 'closed') and ((first_responded_at is null and first_response_due < now()) or resolve_due < now())) as late,
      count(*) filter (where status not in ('resolved', 'closed') and assignee_id is null) as unassigned,
      count(*) as n from ${T} where org_id = ${c.orgId}`));
  if (!n(k?.n)) return {};
  const xs = days(today(), 14);
  const opened = new Map(rowsOf<{ d: string; c: string }>(await db.execute(sql`select to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d, count(*) as c from ${T} where org_id = ${c.orgId} and created_at >= ${xs[0]}::date - interval '1 day' group by 1`)).map((r) => [r.d, n(r.c)]));
  const solved = new Map(rowsOf<{ d: string; c: string }>(await db.execute(sql`select to_char((resolved_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d, count(*) as c from ${T} where org_id = ${c.orgId} and resolved_at >= ${xs[0]}::date - interval '1 day' group by 1`)).map((r) => [r.d, n(r.c)]));
  const insights: Insight[] = [];
  if (n(k!.late)) insights.push({ id: "hd-late", module: "helpdesk", tone: "danger", title: `${n(k!.late)} ticket${n(k!.late) === 1 ? " has" : "s have"} missed a response target`, detail: "Customers are waiting longer than you promised.", href: "/helpdesk" });
  if (n(k!.unassigned)) insights.push({ id: "hd-unassigned", module: "helpdesk", tone: "info", title: `${n(k!.unassigned)} open ticket${n(k!.unassigned) === 1 ? "" : "s"} not assigned to anyone`, detail: "Give each one an owner so nothing slips.", href: "/helpdesk" });
  return {
    kpis: [{ id: "tickets", module: "helpdesk", label: "Open tickets", value: n(k!.open), format: "number", sub: n(k!.late) ? `${n(k!.late)} past target` : "all within target", good: "down", href: "/helpdesk" }],
    insights,
    charts: [{ id: "tickets", module: "helpdesk", title: "Tickets opened and resolved", sub: "Last 14 days", kind: "line", href: "/helpdesk", result: series(xs, "day", [{ key: "o", label: "Opened", type: "count" }, { key: "r", label: "Resolved", type: "count" }], (x, key) => (key === "o" ? opened.get(x) : solved.get(x)) ?? 0) }],
  };
}

async function hr(c: Ctx): Promise<Block> {
  const d = today();
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select
      (select count(*) from hr_employees where org_id = ${c.orgId} and status <> 'exited') as people,
      (select count(*) from hr_employees where org_id = ${c.orgId} and status <> 'exited' and join_date >= ${monthStart(d)}::date) as joined,
      (select count(*) from hr_attendance where org_id = ${c.orgId} and date = ${d}::date and status in ('present', 'half_day', 'wfh')) as present,
      (select count(*) from hr_leave_requests where org_id = ${c.orgId} and status = 'approved' and ${d}::date between from_date and to_date) as on_leave,
      (select count(*) from hr_leave_requests where org_id = ${c.orgId} and status = 'pending') as leave_pending,
      (select status from hr_payroll_runs where org_id = ${c.orgId} and month = ${prevMonthStart(d).slice(0, 7)} limit 1) as last_run`));
  if (!n(k?.people)) return {};
  const xs = days(d, 7);
  const att = new Map(rowsOf<{ d: string; c: string }>(await db.execute(sql`select to_char(date, 'YYYY-MM-DD') as d, count(*) as c from hr_attendance where org_id = ${c.orgId} and date >= ${xs[0]}::date and status in ('present', 'half_day', 'wfh') group by 1`)).map((r) => [r.d, n(r.c)]));
  const insights: Insight[] = [];
  if (n(k!.leave_pending)) insights.push({ id: "hr-leave", module: "hr", tone: "info", title: `${n(k!.leave_pending)} leave request${n(k!.leave_pending) === 1 ? "" : "s"} waiting for a decision`, detail: "People plan around your answer.", href: "/hr/leave" });
  const dayOfMonth = Number(d.slice(8, 10));
  if (can(c.role, "hr:manage") && dayOfMonth >= 3 && (!k!.last_run || k!.last_run === "draft")) insights.push({ id: "hr-payroll", module: "hr", tone: "warning", title: `Payroll for ${new Date(`${prevMonthStart(d)}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" })} isn't finalised`, detail: k!.last_run ? "A draft run is waiting to be checked and finalised." : "No run yet — salaries, PF and ESI are due early in the month.", href: "/hr/payroll" });
  return {
    kpis: [{ id: "team", module: "hr", label: "Team in today", value: n(k!.present), format: "number", sub: `of ${n(k!.people)} people${n(k!.on_leave) ? ` · ${n(k!.on_leave)} on leave` : ""}${n(k!.joined) ? ` · ${n(k!.joined)} joined this month` : ""}`, href: "/hr/attendance" }],
    insights,
    charts: att.size ? [{ id: "attendance", module: "hr", title: "Attendance", sub: "People checked in, last 7 days", kind: "bar", href: "/hr/attendance", result: series(xs, "day", [{ key: "p", label: "Present", type: "count" }], (x) => att.get(x) ?? 0) }] : [],
  };
}

async function inventory(c: Ctx): Promise<Block> {
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`with s as (select i.id, i.reorder_level, i.avg_cost, coalesce(sum(st.qty), 0) as qty from inv_items i left join inv_stock st on st.item_id = i.id where i.org_id = ${c.orgId} group by i.id)
    select count(*) as n, coalesce(sum(qty * avg_cost), 0) as value, count(*) filter (where reorder_level > 0 and qty <= reorder_level) as low, count(*) filter (where qty < 0) as negative from s`));
  if (!n(k?.n)) return {};
  const insights: Insight[] = [];
  if (n(k!.low)) insights.push({ id: "inv-low", module: "inventory", tone: "warning", title: `${n(k!.low)} item${n(k!.low) === 1 ? " is" : "s are"} at or below the reorder level`, detail: "Raise purchase orders before you run out.", href: "/inventory/reorder" });
  if (n(k!.negative)) insights.push({ id: "inv-negative", module: "inventory", tone: "danger", title: `${n(k!.negative)} item${n(k!.negative) === 1 ? " shows" : "s show"} stock below zero`, detail: "Usually a sale recorded before its goods were received — check the receipts.", href: "/inventory/items" });
  return { kpis: [{ id: "stock", module: "inventory", label: "Stock value", value: Math.round(n(k!.value)), format: "money", sub: `${n(k!.n)} items${n(k!.low) ? ` · ${n(k!.low)} to reorder` : ""}`, href: "/inventory" }], insights };
}

async function work(c: Ctx): Promise<Block> {
  const d = today();
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(d, -dow);
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select
      coalesce(sum(minutes) filter (where user_id = ${c.userId} and date >= ${monday}::date), 0) as mine,
      coalesce(sum(minutes) filter (where date >= ${monday}::date), 0) as team,
      coalesce(sum(minutes) filter (where date >= ${monday}::date and billable), 0) as billable,
      (select count(*) from work_projects where org_id = ${c.orgId} and status = 'active') as active,
      (select count(*) from work_tasks t join work_projects p on p.id = t.project_id where t.org_id = ${c.orgId} and t.status <> 'done' and t.due_date < ${d}::date and p.status in ('planned', 'active')) as late
    from work_time where org_id = ${c.orgId}`));
  if (!n(k?.active) && !n(k?.team)) return {};
  const insights: Insight[] = [];
  if (n(k!.late)) insights.push({ id: "work-late", module: "work", tone: "warning", title: `${n(k!.late)} task${n(k!.late) === 1 ? " is" : "s are"} past due across projects`, detail: "Reassign or move the dates so the schedule stays real.", href: "/work/tasks" });
  const team = n(k!.team);
  return { kpis: [{ id: "hours", module: "work", label: "Hours this week", value: Math.round(n(k!.mine) / 6) / 10, format: "hours", sub: `${Math.round(team / 6) / 10}h team · ${team ? Math.round((n(k!.billable) / team) * 100) : 0}% billable · ${n(k!.active)} active project${n(k!.active) === 1 ? "" : "s"}`, href: "/work/timesheet" }], insights };
}

async function sales(c: Ctx): Promise<Block> {
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select count(*) filter (where status in ('confirmed', 'partial')) as open_n, coalesce(sum(total) filter (where status in ('confirmed', 'partial')), 0) as open_v,
      count(*) filter (where status = 'pending_approval') as waiting, count(*) filter (where status in ('confirmed', 'partial') and expected_date < ${today()}::date) as late
    from sales_orders where org_id = ${c.orgId}`));
  if (!n(k?.open_n) && !n(k?.waiting)) return {};
  const insights: Insight[] = [];
  if (n(k!.late)) insights.push({ id: "sales-late", module: "sales", tone: "warning", title: `${n(k!.late)} sales order${n(k!.late) === 1 ? " is" : "s are"} late to deliver`, detail: "Past the date you promised the customer.", href: "/sales/orders" });
  return { kpis: [{ id: "orders", module: "sales", label: "Orders to deliver", value: n(k!.open_v), format: "money", sub: `${n(k!.open_n)} open${n(k!.waiting) ? ` · ${n(k!.waiting)} awaiting approval` : ""}`, href: "/sales/orders" }], insights };
}

async function education(c: Ctx): Promise<Block> {
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select coalesce(sum(amount + tax - paid) filter (where status in ('due', 'partial') and due_date < ${today()}::date), 0) as overdue, count(distinct student_id) filter (where status in ('due', 'partial') and due_date < ${today()}::date) as students from edu_fees where org_id = ${c.orgId}`));
  if (!n(k?.overdue)) return {};
  return { insights: [{ id: "edu-fees", module: "education", tone: "warning", title: `${inr(n(k!.overdue))} in fees overdue from ${n(k!.students)} student${n(k!.students) === 1 ? "" : "s"}`, detail: "Reminders go out automatically; follow up with guardians who haven't paid.", href: "/school/fees" }] };
}

async function clinic(c: Ctx): Promise<Block> {
  const [k] = rowsOf<Record<string, string>>(await db.execute(sql`select count(*) filter (where status not in ('cancelled', 'no_show')) as booked, count(*) filter (where status = 'arrived') as waiting, count(*) filter (where status = 'done') as seen from clinic_appointments where org_id = ${c.orgId} and date = ${today()}::date`));
  if (!n(k?.booked)) return {};
  return { kpis: [{ id: "clinic", module: "clinic", label: "Appointments today", value: n(k!.booked), format: "number", sub: `${n(k!.seen)} seen · ${n(k!.waiting)} waiting`, href: "/clinic" }] };
}

// ─── Quick actions ───────────────────────────────────────────────────────────

/** Quick actions; `audit` prefixes count towards "most used" from this person's activity. */
export const QUICK = [
  { id: "invoice", label: "New invoice", module: "invoicing", href: "/finance", audit: ["invoicing.", "finance."], icon: "receipt" },
  { id: "expense", label: "Record an expense", module: "accounting", href: "/accounts/bills?new=expense", audit: ["accounts."], icon: "wallet" },
  { id: "deal", label: "Add a deal", module: "crm", href: "/crm/deals", audit: ["crm."], icon: "handshake" },
  { id: "contact", label: "Add a contact", module: "crm", href: "/crm/contacts", audit: ["crm."], icon: "contact" },
  { id: "sale", label: "New sales order", module: "sales", href: "/sales/orders/new", audit: ["sales."], icon: "cart" },
  { id: "po", label: "New purchase order", module: "inventory", href: "/inventory/orders/new", audit: ["inventory."], icon: "boxes" },
  { id: "person", label: "Add a person", module: "hr", href: "/hr/people", audit: ["hr."], icon: "user" },
  { id: "payroll", label: "Run payroll", module: "hr", href: "/hr/payroll", audit: ["hr.payroll"], icon: "rupee" },
  { id: "time", label: "Log time", module: "work", href: "/work/timesheet", audit: ["work."], icon: "clock" },
  { id: "project", label: "New project", module: "work", href: "/work/projects/new", audit: ["work."], icon: "kanban" },
  { id: "ticket", label: "New ticket", module: "helpdesk", href: "/helpdesk/tickets/new", audit: ["support.", "helpdesk."], icon: "lifebuoy" },
  { id: "campaign", label: "New campaign", module: "marketing", href: "/marketing/campaigns", audit: ["marketing."], icon: "send" },
  { id: "report", label: "New report", module: "bi", href: "/reports/new", audit: ["bi."], icon: "chart" },
  { id: "patient", label: "New patient", module: "clinic", href: "/clinic/patients?new=1", audit: ["clinic."], icon: "stethoscope" },
  { id: "breakdown", label: "Report a breakdown", module: "maintenance", href: "/maintenance/orders/new", audit: ["maintenance."], icon: "wrench" },
  { id: "copilot", label: "Ask Copilot", module: "copilot", href: "/copilot", audit: ["copilot."], icon: "sparkles" },
  { id: "webapp", label: "New web app", module: null, href: "/create", audit: ["project.", "deployment."], icon: "app" },
  { id: "invite", label: "Invite someone", module: null, href: "/team", audit: ["invitation.", "member."], icon: "users" },
] as const;

async function quickActions(c: Ctx, usage: Record<string, number>, links: Record<string, string>) {
  const counts = rowsOf<{ a: string; c: string }>(await db.execute(sql`select action as a, count(*) as c from audit_logs where org_id = ${c.orgId} and actor_id = ${c.userId} and created_at > now() - interval '60 days' group by 1`));
  const score = (q: (typeof QUICK)[number]) => (usage[q.id] ?? 0) * 10 + counts.filter((x) => q.audit.some((p) => x.a.startsWith(p))).reduce((a, x) => a + n(x.c), 0);
  const list = QUICK.filter((q) => !q.module || c.on(q.module as ModuleId)).map((q, i) => ({ id: q.id, label: q.label, href: q.id === "invoice" && links.newInvoice ? links.newInvoice : q.href, icon: q.icon, used: (usage[q.id] ?? 0) > 0, score: score(q), i }));
  return list.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 8).map((q) => ({ id: q.id, label: q.label, href: q.href, icon: q.icon, used: q.used, mostUsed: q.score > 0 }));
}

// ─── Recent activity ─────────────────────────────────────────────────────────

const WORDS: Record<string, string> = { crm: "CRM", hr: "HR", gst: "GST", tds: "TDS", po: "PO", ai: "AI", sso: "SSO", scim: "SCIM", bi: "Reports", grc: "Compliance", pos: "POS" };
export function humanise(action: string) {
  const [area, what = ""] = action.split(".");
  const a = WORDS[area!] ?? `${area!.charAt(0).toUpperCase()}${area!.slice(1)}`.replace(/_/g, " ");
  const w = what.replace(/_/g, " ").replace(/\b(gst|tds|po|ai|sso)\b/g, (m) => m.toUpperCase());
  return w ? `${a} · ${w}` : a;
}

async function activity(c: Ctx) {
  const A = schema.auditLogs;
  const rows = await db.select({ id: A.id, action: A.action, at: A.createdAt, who: schema.users.name, targetType: A.targetType }).from(A).leftJoin(schema.users, eq(schema.users.id, A.actorId)).where(and(eq(A.orgId, c.orgId), gte(A.createdAt, new Date(Date.now() - 30 * 86_400_000)), sql`${A.action} not like 'user.%' and ${A.action} not like 'org.dashboard%'`)).orderBy(desc(A.createdAt)).limit(12);
  return rows.map((r) => ({ id: r.id, what: humanise(r.action), who: r.who ?? "System", at: r.at }));
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export const SECTIONS = ["desk", "summary", "actions", "attention", "waiting", "charts", "activity", "webapps", "create"] as const;
const layoutSchema = z.object({ order: z.array(z.enum(SECTIONS)).max(20), hidden: z.array(z.enum(SECTIONS)).max(20) });

async function prefs(c: Ctx) {
  const [p] = await db.select().from(schema.userDashboards).where(and(eq(schema.userDashboards.userId, c.userId), eq(schema.userDashboards.orgId, c.orgId)));
  return { layout: p?.layout ?? { order: [], hidden: [] }, usage: p?.usage ?? {} };
}

export async function dashboard(ctx: AuthedContext, orgId: string) {
  const c = await context(ctx, orgId);
  const p = await prefs(c);
  const has = (m: ModuleId, perm: Parameters<typeof can>[1]) => c.on(m) && can(c.role, perm);
  const jobs: [string, () => Promise<Block>][] = [];
  if (has("accounting", "accounts:read")) jobs.push(["accounting", () => accounting(ctx, c)]);
  if (has("invoicing", "invoices:manage")) jobs.push(["invoicing", () => invoicing(c)]);
  if (has("store", "store:orders")) jobs.push(["store", () => store(c)]);
  if (has("crm", "crm:read")) jobs.push(["crm", () => crm(c)]);
  if (has("sales", "sales:read")) jobs.push(["sales", () => sales(c)]);
  if (has("hr", "hr:manage")) jobs.push(["hr", () => hr(c)]);
  if (has("inventory", "inventory:read")) jobs.push(["inventory", () => inventory(c)]);
  if (has("work", "work:read")) jobs.push(["work", () => work(c)]);
  if (has("helpdesk", "hd:read")) jobs.push(["helpdesk", () => helpdesk(c)]);
  if (has("education", "edu:read")) jobs.push(["education", () => education(c)]);
  if (has("clinic", "clinic:read")) jobs.push(["clinic", () => clinic(c)]);
  const blocks = (await Promise.all(jobs.map(([name, f]) => safely(name, orgId, f)))).filter((b): b is Block => !!b);
  const links = Object.assign({}, ...blocks.map((b) => b.links ?? {}));
  const charts = blocks.flatMap((b) => b.charts ?? []);
  // With the books on, the money chart comes from them rather than from invoices alone.
  const money = charts.some((x) => x.id === "accounts") ? charts.filter((x) => x.id !== "invoicing") : charts;
  const [waiting, recent, quick, apps] = await Promise.all([
    safely("waiting", orgId, () => myWork(ctx, orgId)),
    safely("activity", orgId, () => activity(c)),
    safely("quick", orgId, () => quickActions(c, p.usage, links)),
    safely("apps", orgId, async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), sql`${schema.projects.archivedAt} is null`)))[0]?.n ?? 0),
  ]);
  const insights = blocks.flatMap((b) => b.insights ?? []);
  const rank = { danger: 0, warning: 1, info: 2, success: 3 } as const;
  insights.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return {
    generatedAt: new Date().toISOString(),
    layout: p.layout,
    kpis: blocks.flatMap((b) => b.kpis ?? []),
    charts: money,
    insights,
    waiting: waiting ? { approvals: waiting.approvals.slice(0, 6), todo: waiting.todo.slice(0, 6), counts: waiting.counts } : null,
    activity: recent ?? [],
    quick: quick ?? [],
    webApps: apps ?? 0,
  };
}

export async function saveLayout(ctx: AuthedContext, orgId: string, raw: unknown) {
  const c = await context(ctx, orgId);
  const r = layoutSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", "That layout isn't valid");
  await db.insert(schema.userDashboards).values({ userId: c.userId, orgId, layout: r.data }).onConflictDoUpdate({ target: [schema.userDashboards.userId, schema.userDashboards.orgId], set: { layout: r.data, updatedAt: new Date() } });
  return r.data;
}

/** Counts a quick action used from Home, so the ones you use rise to the front. */
export async function used(ctx: AuthedContext, orgId: string, id: unknown) {
  const c = await context(ctx, orgId);
  if (typeof id !== "string" || !QUICK.some((q) => q.id === id)) throw new ApiError("validation_failed", "Unknown action");
  const p = await prefs(c);
  const usage = { ...p.usage, [id]: (p.usage[id] ?? 0) + 1 };
  await db.insert(schema.userDashboards).values({ userId: c.userId, orgId, usage }).onConflictDoUpdate({ target: [schema.userDashboards.userId, schema.userDashboards.orgId], set: { usage, updatedAt: new Date() } });
  return { ok: true };
}
