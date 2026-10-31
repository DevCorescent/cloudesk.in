// The generated REST API over a project's data tables. One implementation
// serves API keys (/api/public/v1/data/…), anonymous access to tables marked
// public (/api/public/v1/p/<projectId>/data/…) and the in-app API console.
import { z } from "zod";
import { FIELD_INFO, LIMITS, parseQuery, type Field } from "@/lib/data/model";
import { ApiError, notFound } from "../http/errors";
import { apiRows, deleteRows, getRow, getTable, insertRows, listTables, queryRows, updateRow, type Table } from "./tables";

export type DataAuth = { kind: "key"; scopes: string[] } | { kind: "anonymous" } | { kind: "member"; canWrite: boolean };

function canRead(a: DataAuth, t: Table) {
  return a.kind === "member" || (a.kind === "key" && a.scopes.includes("data:read")) || (a.kind === "anonymous" && t.publicRead);
}
function canWrite(a: DataAuth) {
  return (a.kind === "member" && a.canWrite) || (a.kind === "key" && a.scopes.includes("data:write"));
}
const denied = (a: DataAuth, what: "read" | "write") =>
  a.kind === "anonymous" ? notFound("Table") : new ApiError("forbidden", a.kind === "key" ? `This key needs the "data:${what}" permission` : "You don't have permission to change data");

/** `path` is what follows /data: [] | [table] | [table, id]. */
export async function dataApi(projectId: string, auth: DataAuth, method: string, path: string[], url: URL, body: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  const [ref, id] = path;
  if (!ref) {
    if (method !== "GET") throw new ApiError("method_not_allowed", "Use GET");
    const tables = (await listTables(projectId)).filter((t) => auth.kind !== "anonymous" || t.publicRead || t.publicInsert);
    if (auth.kind === "key" && !auth.scopes.includes("data:read") && !auth.scopes.includes("data:write")) throw denied(auth, "read");
    return { status: 200, body: { data: tables.map(describeTable) } };
  }
  if (ref === "openapi.json" && method === "GET") {
    const tables = (await listTables(projectId)).filter((t) => auth.kind !== "anonymous" || t.publicRead || t.publicInsert);
    return { status: 200, body: dataOpenApi(tables, url.origin) };
  }
  const t = await getTable(projectId, ref).catch(() => {
    throw notFound("Table");
  });
  if (!id) {
    if (method === "GET") {
      if (!canRead(auth, t)) throw denied(auth, "read");
      let q;
      try {
        q = parseQuery(url.searchParams);
      } catch (e) {
        throw new ApiError("validation_failed", (e as Error).message);
      }
      const { rows, total } = await queryRows(t, q);
      const data = await apiRows(projectId, t, rows, q.expand, (x) => canRead(auth, x));
      return { status: 200, body: { data, total, limit: q.limit, offset: q.offset, next: q.offset + rows.length < total ? q.offset + rows.length : null } };
    }
    if (method === "POST") {
      const anonInsert = auth.kind === "anonymous" && t.publicInsert;
      if (!canWrite(auth) && !anonInsert) throw denied(auth, "write");
      const b = await body();
      const many = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(anonInsert ? 1 : 500) }).safeParse(b);
      const one = z.record(z.string(), z.unknown()).safeParse(b);
      if (!many.success && !one.success) throw new ApiError("validation_failed", "Send a JSON object, or { rows: [...] }");
      const rows = await insertRows(projectId, t, many.success ? many.data.rows : [one.data!]);
      const out = await apiRows(projectId, t, rows);
      // Anonymous inserts don't echo other columns back beyond the id.
      if (anonInsert) return { status: 201, body: { id: out[0].id } };
      return { status: 201, body: many.success ? { data: out } : out[0] };
    }
    throw new ApiError("method_not_allowed", "Use GET or POST");
  }
  if (method === "GET") {
    if (!canRead(auth, t)) throw denied(auth, "read");
    const r = await getRow(t, id);
    return { status: 200, body: (await apiRows(projectId, t, [r], parseQuery(url.searchParams).expand, (x) => canRead(auth, x)))[0] };
  }
  if (method === "PATCH") {
    if (!canWrite(auth)) throw denied(auth, "write");
    const b = await body();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new ApiError("validation_failed", "Send a JSON object with the fields to change");
    const r = await updateRow(projectId, t, id, b as Record<string, unknown>);
    return { status: 200, body: (await apiRows(projectId, t, [r]))[0] };
  }
  if (method === "DELETE") {
    if (!canWrite(auth)) throw denied(auth, "write");
    await getRow(t, id);
    await deleteRows(projectId, t, [id]);
    return { status: 200, body: { id, deleted: true } };
  }
  throw new ApiError("method_not_allowed", "Use GET, PATCH or DELETE");
}

export function describeTable(t: Table) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    rowCount: t.rowCount,
    publicRead: t.publicRead,
    publicInsert: t.publicInsert,
    fields: t.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, required: f.required, ...(f.options ? { options: f.options } : {}), ...(f.relationTable ? { relationTable: f.relationTable } : {}) })),
  };
}

function jsonType(f: Field): Record<string, unknown> {
  switch (f.type) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "email":
      return { type: "string", format: "email" };
    case "url":
      return { type: "string", format: "uri" };
    case "select":
      return { type: "string", enum: f.options };
    case "multiselect":
      return { type: "array", items: { type: "string", enum: f.options } };
    case "relation":
      return { type: "string", format: "uuid", description: "Row id in the linked table; use ?expand=<field> to inline it" };
    case "json":
      return {};
    default:
      return { type: "string", maxLength: f.type === "text" ? 500 : 20000 };
  }
}

/** OpenAPI 3.1 for this project's tables, generated from their fields. */
export function dataOpenApi(tables: Table[], origin: string) {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  const listParams = [
    { name: "limit", in: "query", schema: { type: "integer", maximum: LIMITS.pageSize, default: 50 } },
    { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
    { name: "sort", in: "query", description: "Comma-separated keys; prefix with - for descending", schema: { type: "string" } },
    { name: "q", in: "query", description: "Full-row text search", schema: { type: "string" } },
    { name: "expand", in: "query", description: "Link fields to inline", schema: { type: "string" } },
    { name: "filter", in: "query", style: "deepObject", explode: true, description: "filter[key]=value or filter[key][op]=value; ops: eq neq gt gte lt lte contains starts in empty not_empty", schema: { type: "object" } },
  ];
  for (const t of tables) {
    const name = t.slug.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());
    const props: Record<string, unknown> = {};
    for (const f of t.fields) props[f.key] = { ...jsonType(f), title: f.name, description: f.description ?? FIELD_INFO[f.type].label };
    schemas[`${name}Input`] = { type: "object", properties: props, required: t.fields.filter((f) => f.required).map((f) => f.key), additionalProperties: false };
    schemas[name] = { allOf: [{ $ref: `#/components/schemas/${name}Input` }, { type: "object", properties: { id: { type: "string", format: "uuid" }, created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" } } }] };
    const ref = { $ref: `#/components/schemas/${name}` };
    paths[`/data/${t.slug}`] = {
      get: { summary: `List ${t.name}`, tags: [t.name], parameters: listParams, responses: { 200: { description: "Rows", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: ref }, total: { type: "integer" }, next: { type: ["integer", "null"] } } } } } } } },
      post: { summary: `Add to ${t.name}`, tags: [t.name], requestBody: { content: { "application/json": { schema: { $ref: `#/components/schemas/${name}Input` } } } }, responses: { 201: { description: "Created", content: { "application/json": { schema: ref } } }, 422: { description: "Invalid values" } } },
    };
    paths[`/data/${t.slug}/{id}`] = {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: { summary: `Get one ${t.name} row`, tags: [t.name], responses: { 200: { description: "Row", content: { "application/json": { schema: ref } } }, 404: { description: "Not found" } } },
      patch: { summary: `Update a ${t.name} row`, tags: [t.name], requestBody: { content: { "application/json": { schema: { $ref: `#/components/schemas/${name}Input` } } } }, responses: { 200: { description: "Updated", content: { "application/json": { schema: ref } } } } },
      delete: { summary: `Delete a ${t.name} row`, tags: [t.name], responses: { 200: { description: "Deleted" } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Project data API", version: "1.0.0", description: "Generated from your data tables. Authenticate with Authorization: Bearer cc_live_… (scopes data:read / data:write)." },
    servers: [{ url: `${origin}/api/public/v1` }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas },
    security: [{ bearer: [] }],
    paths,
  };
}
