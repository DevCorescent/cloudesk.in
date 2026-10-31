// Quality API for a workspace. Dispatches on "METHOD section :id sub".
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { ensureSettings, saveSettings, scope } from "@/server/quality/access";
import { closeNcr, deletePlan, home, inspectionDetail, inspections, ncrDetail, ncrs, plans, raiseInspection, raiseNcr, recordResults, savePlan, updateNcr } from "@/server/quality/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta": {
      await ensureSettings(orgId);
      const [items, warehouses, suppliers, people] = await Promise.all([
        db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit, category: schema.invItems.category }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), eq(schema.invItems.active, true))),
        db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)),
        db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name }).from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, orgId)),
        db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)),
      ]);
      return { me: { id: s.userId, write: s.write, manage: s.manage }, settings: s.settings, items, warehouses, suppliers, people };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "GET plans":
      return { plans: await plans(orgId) };
    case "POST plans":
      return { plan: await savePlan(s, null, await body(ctx)) };
    case "PUT plans :id":
      return { plan: await savePlan(s, id!, await body(ctx)) };
    case "DELETE plans :id":
      await deletePlan(s, id!);
      return { ok: true };
    case "GET inspections":
      return { inspections: await inspections(s, qs) };
    case "POST inspections":
      return { inspection: await raiseInspection(s, await body(ctx)) };
    case "GET inspections :id":
      return inspectionDetail(s, id!);
    case "POST inspections :id results":
      return recordResults(s, id!, await body(ctx));
    case "GET ncrs":
      return { ncrs: await ncrs(s, qs) };
    case "POST ncrs":
      return { ncr: await raiseNcr(s, await body(ctx)) };
    case "GET ncrs :id":
      return ncrDetail(s, id!);
    case "PUT ncrs :id":
      return { ncr: await updateNcr(s, id!, await body(ctx)) };
    case "POST ncrs :id close":
      return closeNcr(s, id!);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
