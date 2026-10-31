import { z } from "zod";
import { fieldSchema, FIELD_TYPES, keySchema } from "@/lib/data/model";
import { API_SCOPES } from "@/lib/platform/events";
import { can } from "@/server/authz/permissions";
import { dataApi, dataOpenApi, describeTable } from "@/server/data/api";
import { createTable, deleteTable, exportCsv, getTable, importCsv, listTables, updateTable } from "@/server/data/tables";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { appUrl } from "@/server/services/mail";

type P = { projectId: string; slug?: string[] };

const tableInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().max(40).optional(),
  description: z.string().max(300).optional(),
  fields: z.array(fieldSchema.omit({ id: true }).extend({ type: z.enum(FIELD_TYPES), key: keySchema })).max(60).optional(),
});

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, action] = slug;
  const method = ctx.req.method;
  const url = new URL(ctx.req.url);

  // Row operations: the same code path as the public API, as a project member.
  if (section === "api") {
    const { role } = await requireProject(ctx, projectId, "project:read");
    const out = await dataApi(projectId, { kind: "member", canWrite: can(role, "data:write") }, method, slug.slice(1), url, () => ctx.req.json());
    return Response.json(out.body, { status: out.status });
  }

  const key = `${method} ${[section, id && ":id", action].filter(Boolean).join(" ")}`.trim();
  switch (key) {
    case "GET": {
      await requireProject(ctx, projectId, "project:read");
      const tables = await listTables(projectId);
      return { tables: tables.map((t) => ({ ...describeTable(t), fields: t.fields, updatedAt: t.updatedAt })), apiBase: appUrl("/api/public/v1"), publicBase: appUrl(`/api/public/v1/p/${projectId}`) };
    }
    case "GET openapi":
      await requireProject(ctx, projectId, "project:read");
      return dataOpenApi(await listTables(projectId), new URL(appUrl("/")).origin);
    case "POST tables": {
      const { project } = await requireProject(ctx, projectId, "data:schema");
      const body = await readJson(ctx.req, tableInput);
      const t = await createTable(projectId, body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "data.table_created", targetType: "data_table", targetId: t.id, metadata: { slug: t.slug } });
      return Response.json({ table: { ...describeTable(t), fields: t.fields } }, { status: 201 });
    }
    case "PATCH tables :id": {
      const { project } = await requireProject(ctx, projectId, "data:schema");
      const body = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(80).optional(), slug: z.string().max(40).optional(), description: z.string().max(300).optional(), publicRead: z.boolean().optional(), publicInsert: z.boolean().optional(), fields: z.array(fieldSchema).max(60).optional(), clearInvalid: z.boolean().optional() }));
      const before = await getTable(projectId, id);
      const t = await updateTable(projectId, before.id, body);
      if (body.publicRead !== undefined || body.publicInsert !== undefined) await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "data.table_access", targetType: "data_table", targetId: t.id, metadata: { publicRead: t.publicRead, publicInsert: t.publicInsert } });
      return { table: { ...describeTable(t), fields: t.fields } };
    }
    case "DELETE tables :id": {
      const { project } = await requireProject(ctx, projectId, "data:schema");
      const t = await deleteTable(projectId, id);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "data.table_deleted", targetType: "data_table", targetId: t.id, metadata: { slug: t.slug, rows: t.rowCount } });
      return { ok: true };
    }
    case "GET tables :id export": {
      await requireProject(ctx, projectId, "project:read");
      const t = await getTable(projectId, id);
      return new Response(await exportCsv(t), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t.slug}.csv"` } });
    }
    case "POST tables :id import": {
      await requireProject(ctx, projectId, "data:write");
      await rateLimit(`data-import:${ctx.user.id}`, 20, 3600_000);
      const body = await readJson(ctx.req, z.object({ csv: z.string().max(5_000_000), skipInvalid: z.boolean().default(false) }));
      return importCsv(projectId, await getTable(projectId, id), body.csv, body.skipInvalid);
    }
    case "POST console": {
      // The API studio: send a request to the data API as a key with chosen scopes, or anonymously.
      const { role } = await requireProject(ctx, projectId, "project:read");
      await rateLimit(`data-console:${ctx.user.id}`, 120, 60_000);
      const body = await readJson(ctx.req, z.object({ method: z.enum(["GET", "POST", "PATCH", "DELETE"]), path: z.string().max(2000), body: z.string().max(200_000).optional(), as: z.enum(["key", "anonymous"]), scopes: z.array(z.enum(API_SCOPES)).default([]) }));
      if (body.method !== "GET" && !can(role, "data:write")) throw new ApiError("forbidden", "You can only send GET requests");
      const target = new URL(body.path.startsWith("/") ? body.path : `/${body.path}`, "http://console.local");
      const parts = target.pathname.split("/").filter(Boolean);
      if (parts[0] !== "data") throw new ApiError("validation_failed", "The console sends requests to /data/…");
      const started = performance.now();
      let status: number;
      let out: unknown;
      try {
        const r = await dataApi(projectId, body.as === "key" ? { kind: "key", scopes: body.scopes } : { kind: "anonymous" }, body.method, parts.slice(1), target, async () => {
          try {
            return JSON.parse(body.body || "null");
          } catch {
            throw new ApiError("validation_failed", "The body is not valid JSON");
          }
        });
        status = r.status;
        out = r.body;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("internal_error", "Something went wrong");
        status = err.status;
        out = { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
      }
      return { status, body: out, durationMs: Math.round(performance.now() - started) };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
