// Reports & dashboards: the datasets a person can use, saved reports
// (shared with the team or private), running them (always as the person
// looking, so each sees only what their role allows), KPIs against the period
// before, dashboards, and schedules that email a report.
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { change, dashboardSchema, nextRun, previous, reportSchema, scheduleSchema, specSchema, type Spec } from "@/lib/bi/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Permission, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";
import { DATASETS, datasetById, type Ctx, type Dataset } from "./datasets";
import { asText, fieldsFor, run, type Result } from "./query";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; ctx: Ctx; has: (m: ModuleId) => boolean; fyStartMonth: number };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields");
  return r.data;
}

/** A person's view for reports: their role, the modules they see, and the limits the CRM puts on them. */
export async function scopeFor(orgId: string, userId: string, role: Role): Promise<Scope> {
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  const [crm] = await db.select({ visibility: schema.crmSettings.visibility }).from(schema.crmSettings).where(eq(schema.crmSettings.orgId, orgId));
  const crmOwn = crm?.visibility === "own" && !can(role, "crm:manage");
  const [acc] = await db.select({ settings: schema.accSettings.settings }).from(schema.accSettings).where(eq(schema.accSettings.orgId, orgId));
  return { orgId, userId, role, write: can(role, "bi:write"), manage: can(role, "bi:manage"), has: (id) => visibleTo(visible, id), ctx: { orgId, userId, can: (p: Permission) => can(role, p), crmOwn }, fyStartMonth: Number((acc?.settings as { fyStartMonth?: number } | undefined)?.fyStartMonth) || 4 };
}

export async function scope(c: AuthedContext, orgId: string) {
  const { role } = await requireOrg(c, orgId, "bi:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "bi")) throw new ApiError("forbidden", "Switch on Reports & dashboards in Settings → Features first");
  return scopeFor(orgId, c.user.id, role);
}

const requireWrite = (s: Scope) => {
  if (!s.write) throw new ApiError("forbidden", "Your role can open reports, but not build them");
};

/** Datasets this person can report on: the module is open to them and their role reads it. */
export function datasets(s: Scope) {
  return DATASETS.filter((d) => s.has(d.module) && s.ctx.can(d.perm)).map((d) => ({ id: d.id, label: d.label, group: d.group, dateField: d.dateField, fields: fieldsFor(d, s.ctx).map(({ key, label, type }) => ({ key, label, type })) }));
}

function usable(s: Scope, id: string): Dataset {
  const d = datasetById(id);
  if (!d || !s.has(d.module) || !s.ctx.can(d.perm)) throw new ApiError("forbidden", "That data isn't open to you");
  return d;
}

/** Run a spec now (unsaved, from the builder). */
export async function preview(s: Scope, raw: unknown) {
  const v = check(z.object({ dataset: z.string().max(40), spec: specSchema }), raw);
  return runAs(s, usable(s, v.dataset), v.spec);
}

async function runAs(s: Scope, d: Dataset, spec: Spec) {
  const today = todayIst();
  const result = await run(d, spec, s.ctx, today, s.fyStartMonth);
  let compare: { previous: number | null; change: number | null } | null = null;
  // A number compared with the same length of time before.
  if (spec.compare && !spec.dims.length && result.range.from && result.range.to) {
    const before = previous(result.range)!;
    const prev = await run(d, { ...spec, range: { ...spec.range, preset: "custom", from: before.from, to: before.to } }, s.ctx, today, s.fyStartMonth);
    const now = Number(result.rows[0]?.[0] ?? 0);
    const was = prev.rows[0]?.[0] === null || prev.rows[0]?.[0] === undefined ? null : Number(prev.rows[0][0]);
    compare = { previous: was, change: change(now, was) };
  }
  return { ...result, compare };
}

// ── Reports ─────────────────────────────────────────────────────────────────

const visibleReport = (s: Scope) => (s.manage ? sql`true` : or(eq(schema.biReports.shared, true), eq(schema.biReports.createdBy, s.userId))!);

async function getReport(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Report");
  const [r] = await db.select().from(schema.biReports).where(and(eq(schema.biReports.id, id), eq(schema.biReports.orgId, s.orgId), visibleReport(s)));
  if (!r) throw notFound("Report");
  return r;
}

export async function reports(s: Scope) {
  const rows = await db.select({ r: schema.biReports, by: schema.users.name }).from(schema.biReports).leftJoin(schema.users, eq(schema.users.id, schema.biReports.createdBy)).where(and(eq(schema.biReports.orgId, s.orgId), visibleReport(s))).orderBy(asc(schema.biReports.name));
  const open = new Set(datasets(s).map((d) => d.id));
  return rows.map(({ r, by }) => ({ ...r, by, dataLabel: datasetById(r.dataset)?.label ?? r.dataset, open: open.has(r.dataset), mine: r.createdBy === s.userId }));
}

export async function saveReport(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(reportSchema, raw);
  const d = usable(s, v.dataset);
  // Checks every field the spec uses, by running it on no rows.
  await run(d, { ...v.spec, limit: 1 }, s.ctx, todayIst(), s.fyStartMonth);
  if (id) {
    const r = await getReport(s, id);
    if (r.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Only whoever made it, or an owner or admin, can change this report");
    const [row] = await db.update(schema.biReports).set({ ...v, updatedAt: new Date() }).where(eq(schema.biReports.id, r.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.biReports).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteReport(s: Scope, id: string) {
  requireWrite(s);
  const r = await getReport(s, id);
  if (r.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Only whoever made it, or an owner or admin, can delete this report");
  await db.delete(schema.biReports).where(eq(schema.biReports.id, r.id));
}

/** Run a saved report, with an optional different date range. */
export async function runReport(s: Scope, id: string, q: { preset?: string; from?: string; to?: string } = {}) {
  const r = await getReport(s, id);
  const d = usable(s, r.dataset);
  const spec = specSchema.parse(r.spec);
  if (q.preset) spec.range = { ...spec.range, ...check(specSchema.shape.range, { field: spec.range.field, preset: q.preset, from: q.from ?? null, to: q.to ?? null }) };
  return { report: { ...r, spec }, dataLabel: d.label, result: await runAs(s, d, spec) };
}

/** A report's definition as a file, to bring into another workspace. */
export async function exportReport(s: Scope, id: string) {
  const r = await getReport(s, id);
  return { cloudeskReport: 1, name: r.name, description: r.description, dataset: r.dataset, spec: r.spec };
}

export async function importReport(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(z.object({ cloudeskReport: z.literal(1, "That isn't a Cloudesk report file"), name: z.string(), description: z.string().default(""), dataset: z.string(), spec: z.unknown() }), raw);
  return saveReport(s, null, { name: v.name, description: v.description, dataset: v.dataset, spec: v.spec, shared: false });
}

// ── Dashboards ──────────────────────────────────────────────────────────────

const visibleDash = (s: Scope) => (s.manage ? sql`true` : or(eq(schema.biDashboards.shared, true), eq(schema.biDashboards.createdBy, s.userId))!);

export async function dashboards(s: Scope) {
  return db.select().from(schema.biDashboards).where(and(eq(schema.biDashboards.orgId, s.orgId), visibleDash(s))).orderBy(asc(schema.biDashboards.name));
}

export async function saveDashboard(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(dashboardSchema, raw);
  const ids = [...new Set(v.widgets.map((w) => w.reportId))];
  if (ids.length) {
    const found = await db.select({ id: schema.biReports.id }).from(schema.biReports).where(and(eq(schema.biReports.orgId, s.orgId), inArray(schema.biReports.id, ids), visibleReport(s)));
    if (found.length !== ids.length) throw new ApiError("validation_failed", "Some of those reports aren't open to you");
  }
  if (id) {
    if (!isId(id)) throw notFound("Dashboard");
    const [d] = await db.select().from(schema.biDashboards).where(and(eq(schema.biDashboards.id, id), eq(schema.biDashboards.orgId, s.orgId), visibleDash(s)));
    if (!d) throw notFound("Dashboard");
    if (d.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Only whoever made it, or an owner or admin, can change this dashboard");
    const [row] = await db.update(schema.biDashboards).set(v).where(eq(schema.biDashboards.id, d.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.biDashboards).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteDashboard(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Dashboard");
  const [d] = await db.select().from(schema.biDashboards).where(and(eq(schema.biDashboards.id, id), eq(schema.biDashboards.orgId, s.orgId)));
  if (!d) throw notFound("Dashboard");
  if (d.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Only whoever made it, or an owner or admin, can delete this dashboard");
  await db.delete(schema.biDashboards).where(eq(schema.biDashboards.id, d.id));
}

/** A dashboard with every widget's result; a widget whose data isn't open to the person says so instead. */
export async function dashboardDetail(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Dashboard");
  const [d] = await db.select().from(schema.biDashboards).where(and(eq(schema.biDashboards.id, id), eq(schema.biDashboards.orgId, s.orgId), visibleDash(s)));
  if (!d) throw notFound("Dashboard");
  const widgets = await Promise.all(
    d.widgets.map(async (w) => {
      try {
        const r = await runReport(s, w.reportId);
        return { ...w, name: r.report.name, chart: r.report.spec.chart, result: r.result, error: null as string | null };
      } catch (e) {
        return { ...w, name: "", chart: "table", result: null, error: e instanceof ApiError ? e.message : "This report couldn't run" };
      }
    }),
  );
  return { dashboard: d, widgets };
}

// ── Schedules ───────────────────────────────────────────────────────────────

export async function schedules(s: Scope) {
  const rows = await db.select({ x: schema.biSchedules, report: schema.biReports.name }).from(schema.biSchedules).innerJoin(schema.biReports, eq(schema.biReports.id, schema.biSchedules.reportId)).where(and(eq(schema.biSchedules.orgId, s.orgId), s.manage ? sql`true` : eq(schema.biSchedules.createdBy, s.userId))).orderBy(asc(schema.biSchedules.nextAt));
  return rows.map(({ x, report }) => ({ ...x, report }));
}

export async function saveSchedule(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(scheduleSchema, raw);
  await getReport(s, v.reportId);
  const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, v.recipients)));
  if (found.length !== new Set(v.recipients).size) throw new ApiError("validation_failed", "Everyone it goes to must be in this workspace");
  const nextAt = nextRun(v, new Date());
  if (id) {
    if (!isId(id)) throw notFound("Schedule");
    const [row] = await db.update(schema.biSchedules).set({ ...v, nextAt }).where(and(eq(schema.biSchedules.id, id), eq(schema.biSchedules.orgId, s.orgId), s.manage ? sql`true` : eq(schema.biSchedules.createdBy, s.userId))).returning();
    if (!row) throw notFound("Schedule");
    return row;
  }
  const [row] = await db.insert(schema.biSchedules).values({ ...v, orgId: s.orgId, nextAt, createdBy: s.userId }).returning();
  return row;
}

export async function deleteSchedule(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Schedule");
  const [row] = await db.delete(schema.biSchedules).where(and(eq(schema.biSchedules.id, id), eq(schema.biSchedules.orgId, s.orgId), s.manage ? sql`true` : eq(schema.biSchedules.createdBy, s.userId))).returning();
  if (!row) throw notFound("Schedule");
}

/**
 * Send what's due: each schedule's report is run as the person who set it up
 * (so it never shows more than they may see), and emailed to its recipients.
 * A schedule whose maker has left, or whose data is no longer open to them, is
 * paused with the reason.
 */
export async function sendDue(now = new Date()) {
  const due = await db.select().from(schema.biSchedules).where(and(eq(schema.biSchedules.active, true), lte(schema.biSchedules.nextAt, now))).limit(50);
  let sent = 0;
  for (const x of due) {
    const [claimed] = await db.update(schema.biSchedules).set({ nextAt: nextRun({ ...x, frequency: x.frequency as "daily" | "weekly" | "monthly" }, now) }).where(and(eq(schema.biSchedules.id, x.id), eq(schema.biSchedules.nextAt, x.nextAt))).returning();
    if (!claimed) continue;
    try {
      const [m] = x.createdBy ? await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, x.orgId), eq(schema.memberships.userId, x.createdBy))) : [];
      if (!m) throw new ApiError("forbidden", "Whoever set this up is no longer in the workspace");
      const s = await scopeFor(x.orgId, x.createdBy!, m.role as Role);
      const { report, result } = await runReport(s, x.reportId);
      const people = await db.select({ email: schema.users.email }).from(schema.users).innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.orgId, x.orgId))).where(inArray(schema.users.id, x.recipients));
      const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, x.orgId));
      const period = result.range.from ? ` (${result.range.from} to ${result.range.to})` : "";
      for (const p of people) await sendMail({ to: p.email, fromName: org?.name, subject: `${report.name}${period}`, body: `${report.name}${period}\n\n${asText(result as Result)}\n\nOpen the full report: ${appUrl(`/reports/${report.id}`)}` });
      await db.update(schema.biSchedules).set({ lastSentAt: now, lastError: "" }).where(eq(schema.biSchedules.id, x.id));
      sent++;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      await db.update(schema.biSchedules).set({ active: false, lastError: msg.slice(0, 300) }).where(eq(schema.biSchedules.id, x.id));
      log.warn("bi_schedule_failed", { id: x.id, error: msg });
    }
  }
  return sent;
}

export async function home(s: Scope) {
  const [rs, ds, sc] = await Promise.all([reports(s), dashboards(s), schedules(s)]);
  return { reports: rs.slice(0, 12), dashboards: ds, schedules: sc.filter((x) => x.active).length, datasets: datasets(s).length };
}

