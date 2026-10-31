// Custom fields, objects, rules and bulk changes for a workspace. Dispatches
// on "METHOD section :id sub", like the module APIs. Which kind of record a
// call is about comes in ?entity= ("inventory.item", or "obj:<id>").
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { bulk, bulkRuns, deleteField, deleteObject, deleteRecord, deleteRule, entityRecords, fields, getValues, importRecords, importValues, lookup, meta, objectDetail, objects, putValues, recordDetail, records, rules, saveField, saveObject, saveRecord, saveRule, scope, undoBulk } from "@/server/custom/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, subId] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}${subId ? " :sub" : ""}`;
  const s = await scope(ctx, orgId);
  const entity = () => {
    if (!qs.entity) throw new ApiError("validation_failed", "Say which kind of record (?entity=)");
    return qs.entity;
  };

  switch (key) {
    case "GET meta":
      return meta(s);

    case "GET fields":
      return { fields: await fields(s, entity()) };
    case "POST fields":
      return { field: await saveField(s, entity(), null, await body(ctx)) };
    case "PUT fields :id":
      return { field: await saveField(s, entity(), id!, await body(ctx)) };
    case "DELETE fields :id":
      await deleteField(s, id!, qs.confirm);
      return { ok: true };

    case "GET rules":
      return { rules: await rules(s, entity()) };
    case "POST rules":
      return { rule: await saveRule(s, entity(), null, await body(ctx)) };
    case "PUT rules :id":
      return { rule: await saveRule(s, entity(), id!, await body(ctx)) };
    case "DELETE rules :id":
      await deleteRule(s, id!);
      return { ok: true };

    case "GET values":
      return getValues(s, entity(), qs.id ?? "");
    case "PUT values":
      return putValues(s, entity(), qs.id ?? "", await body(ctx));
    case "POST values import":
      return importValues(s, entity(), await readJson(ctx.req, z.unknown()));
    case "GET records":
      return entityRecords(s, entity(), qs.q);
    case "GET lookup":
      return { results: await lookup(s, entity(), qs.q ?? "") };

    case "GET objects":
      return { objects: await objects(s) };
    case "POST objects":
      return { object: await saveObject(s, null, await body(ctx)) };
    case "GET objects :id":
      return objectDetail(s, id!);
    case "PUT objects :id":
      return { object: await saveObject(s, id!, await body(ctx)) };
    case "DELETE objects :id":
      await deleteObject(s, id!, qs.confirm);
      return { ok: true };
    case "GET objects :id records":
      return records(s, id!, qs);
    case "POST objects :id records":
      return { record: await saveRecord(s, id!, null, await body(ctx)) };
    case "POST objects :id import":
      return importRecords(s, id!, await readJson(ctx.req, z.unknown()));
    case "GET objects :id records :sub":
      return recordDetail(s, id!, subId!);
    case "PUT objects :id records :sub":
      return { record: await saveRecord(s, id!, subId!, await body(ctx)) };
    case "DELETE objects :id records :sub":
      await deleteRecord(s, id!, subId!);
      return { ok: true };

    case "GET bulk":
      return { runs: await bulkRuns(s) };
    case "POST bulk":
      return bulk(s, await body(ctx));
    case "POST bulk :id undo":
      return undoBulk(s, id!);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
