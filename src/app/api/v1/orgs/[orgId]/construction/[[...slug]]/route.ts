// Construction API for a workspace: contracts and everything under one
// ("contracts/:id/boq", ".../measurements", ".../bills", ".../payments",
// ".../diary"), and actions on bills and measurements.
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { db, schema } from "@/db";
import { advanceBill, bills, boq, checkMeasurement, contractDetail, contracts, deleteDraft, deleteMeasurement, diary, importBoq, measure, measurements, payments, prepareBill, receive, saveContract, saveItem, scope, writeDiary } from "@/server/construction/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const id36 = /^[0-9a-f-]{36}$/;

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, subId] = slug;
  const m = ctx.req.method;
  const key = `${m} ${section ?? ""}${id ? (id36.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}${subId ? (id36.test(subId) ? " :sub" : ` ${subId}`) : ""}`;
  const s = await scope(ctx, orgId);
  switch (key) {
    case "GET meta": {
      const accounts = s.has("accounting") ? await db.select({ id: schema.accAccounts.id, name: schema.accAccounts.name }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), inArray(schema.accAccounts.subtype, ["cash", "bank"]), eq(schema.accAccounts.active, true))) : [];
      return { me: { write: s.write, manage: s.manage }, accounts };
    }
    case "GET contracts":
      return { contracts: await contracts(s) };
    case "POST contracts":
      return { contract: await saveContract(s, null, await body(ctx)) };
    case "GET contracts :id":
      return contractDetail(s, id!);
    case "PUT contracts :id":
      return { contract: await saveContract(s, id!, await body(ctx)) };
    case "GET contracts :id boq":
      return { items: await boq(s, id!) };
    case "POST contracts :id boq":
      return { item: await saveItem(s, id!, null, await body(ctx)) };
    case "POST contracts :id boq import":
      return importBoq(s, id!, await readJson(ctx.req, z.unknown()));
    case "PUT contracts :id boq :sub":
      return { item: await saveItem(s, id!, subId!, await body(ctx)) };
    case "GET contracts :id measurements":
      return { measurements: await measurements(s, id!) };
    case "POST contracts :id measurements":
      return { measurement: await measure(s, id!, await body(ctx)) };
    case "GET contracts :id bills":
      return { bills: await bills(s, id!) };
    case "POST contracts :id bills":
      return { bill: await prepareBill(s, id!, await body(ctx)) };
    case "GET contracts :id payments":
      return { payments: await payments(s, id!) };
    case "POST contracts :id payments":
      return { payment: await receive(s, id!, await body(ctx)) };
    case "GET contracts :id diary":
      return { diary: await diary(s, id!) };
    case "POST contracts :id diary":
      return { entry: await writeDiary(s, id!, await body(ctx)) };
    case "POST bills :id status":
      return { bill: await advanceBill(s, id!, await body(ctx)) };
    case "DELETE bills :id":
      await deleteDraft(s, id!);
      return { ok: true };
    case "POST measurements :id check":
      return { measurement: await checkMeasurement(s, id!) };
    case "DELETE measurements :id":
      await deleteMeasurement(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
