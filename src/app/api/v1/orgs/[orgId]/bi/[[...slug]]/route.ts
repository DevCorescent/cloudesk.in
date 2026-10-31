// Reports & dashboards API for a workspace. Dispatches on
// "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { dashboardDetail, dashboards, datasets, deleteDashboard, deleteReport, deleteSchedule, exportReport, home, importReport, preview, reports, runReport, saveDashboard, saveReport, saveSchedule, schedules, scope } from "@/server/bi/core";
import { db, schema } from "@/db";
import { and, asc, eq, sql } from "drizzle-orm";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return { me: { id: s.userId, write: s.write, manage: s.manage }, datasets: datasets(s), people: await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.role} <> 'employee'`)).orderBy(asc(schema.users.name)), fyStartMonth: s.fyStartMonth };
    case "GET home":
      return home(s);
    case "POST preview":
      return preview(s, await body(ctx));

    case "GET reports":
      return { reports: await reports(s) };
    case "POST reports":
      return { report: await saveReport(s, null, await body(ctx)) };
    case "POST reports import":
      return { report: await importReport(s, await body(ctx)) };
    case "GET reports :id":
      return runReport(s, id!, qs);
    case "GET reports :id export":
      return exportReport(s, id!);
    case "PUT reports :id":
      return { report: await saveReport(s, id!, await body(ctx)) };
    case "DELETE reports :id":
      await deleteReport(s, id!);
      return { ok: true };

    case "GET dashboards":
      return { dashboards: await dashboards(s) };
    case "POST dashboards":
      return { dashboard: await saveDashboard(s, null, await body(ctx)) };
    case "GET dashboards :id":
      return dashboardDetail(s, id!);
    case "PUT dashboards :id":
      return { dashboard: await saveDashboard(s, id!, await body(ctx)) };
    case "DELETE dashboards :id":
      await deleteDashboard(s, id!);
      return { ok: true };

    case "GET schedules":
      return { schedules: await schedules(s) };
    case "POST schedules":
      return { schedule: await saveSchedule(s, null, await body(ctx)) };
    case "PUT schedules :id":
      return { schedule: await saveSchedule(s, id!, await body(ctx)) };
    case "DELETE schedules :id":
      await deleteSchedule(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
