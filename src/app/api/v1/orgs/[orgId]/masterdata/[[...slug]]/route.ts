// Master data & migration for a workspace: export rules (and logging each
// export), import history, saved column mappings, duplicates and merging.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { deleteMapping, duplicates, finishRun, getSettings, mappings, mergeSuppliers, recordExport, runDetail, runs, saveMapping, saveSettings, scope, startRun } from "@/server/masterdata/core";

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
      return { me: { manage: s.manage, auditor: s.auditor }, settings: await getSettings(orgId) };
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "POST exports":
      return recordExport(s, await body(ctx));
    case "GET imports":
      return { imports: await runs(s) };
    case "POST imports":
      return startRun(s, await body(ctx));
    case "GET imports :id":
      return { import: await runDetail(s, id!) };
    case "POST imports :id finish":
      return { import: await finishRun(s, id!, await body(ctx)) };
    case "GET mappings":
      return { mappings: await mappings(s, qs.target ?? "") };
    case "POST mappings":
      return { mapping: await saveMapping(s, await body(ctx)) };
    case "DELETE mappings :id":
      await deleteMapping(s, id!);
      return { ok: true };
    case "GET duplicates":
      return { groups: await duplicates(s) };
    case "POST merge suppliers":
      return mergeSuppliers(s, await body(ctx));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
