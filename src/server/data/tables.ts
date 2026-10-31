// Data tables: structure changes, row CRUD, filtered queries and CSV.
// Rows are JSONB keyed by stable field ids; every query is built from field
// metadata with bound parameters, never from user-supplied SQL.
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkFields, coerce, csvEscape, LIMITS, newFieldId, parseCsv, slugKey, toApi, toStored, type Field, type Filter, type RowQuery } from "@/lib/data/model";
import { emitEvent } from "../events/bus";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";

export type Table = typeof schema.dataTables.$inferSelect & { fields: Field[] };

export async function listTables(projectId: string): Promise<Table[]> {
  return (await db.select().from(schema.dataTables).where(eq(schema.dataTables.projectId, projectId)).orderBy(asc(schema.dataTables.createdAt))) as Table[];
}

/** By id or slug. */
export async function getTable(projectId: string, ref: string): Promise<Table> {
  const isId = /^[0-9a-f-]{36}$/i.test(ref);
  const [t] = await db
    .select()
    .from(schema.dataTables)
    .where(and(eq(schema.dataTables.projectId, projectId), isId ? eq(schema.dataTables.id, ref) : eq(schema.dataTables.slug, ref)));
  if (!t) throw notFound("Table");
  return t as Table;
}

function slugify(s: string) {
  return slugKey(s).replace(/_/g, "-").slice(0, 40) || "table";
}

export async function createTable(projectId: string, input: { name: string; slug?: string; description?: string; fields?: Omit<Field, "id">[] }) {
  const n = await db.select({ id: schema.dataTables.id }).from(schema.dataTables).where(eq(schema.dataTables.projectId, projectId));
  if (n.length >= LIMITS.tables) throw new ApiError("conflict", `A project can have up to ${LIMITS.tables} tables`);
  const fields: Field[] = (input.fields?.length ? input.fields : [{ key: "name", name: "Name", type: "text" as const, required: true }]).map((f) => ({ ...f, id: newFieldId() }) as Field);
  const errs = checkFields(fields);
  if (errs.length) throw new ApiError("validation_failed", errs[0], { fields: errs });
  await checkRelations(projectId, fields);
  const slug = input.slug ? input.slug : slugify(input.name);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(slug)) throw new ApiError("validation_failed", "The API name may use lowercase letters, numbers and dashes", { slug: ["Invalid"] });
  const [t] = await db
    .insert(schema.dataTables)
    .values({ projectId, slug, name: input.name.trim().slice(0, 80), description: (input.description ?? "").slice(0, 300), fields })
    .onConflictDoNothing()
    .returning();
  if (!t) throw new ApiError("conflict", `A table called "${slug}" already exists`, { slug: ["Taken"] });
  return t as Table;
}

async function checkRelations(projectId: string, fields: Field[]) {
  const targets = [...new Set(fields.filter((f) => f.type === "relation").map((f) => f.relationTable!))];
  if (!targets.length) return;
  const found = await db.select({ id: schema.dataTables.id }).from(schema.dataTables).where(and(eq(schema.dataTables.projectId, projectId), inArray(schema.dataTables.id, targets)));
  if (found.length !== targets.length) throw new ApiError("validation_failed", "A link field points to a table that doesn't exist");
}

/**
 * Updates name/access/fields. Removing a field drops its values. Changing a
 * field's type converts existing values; if some can't convert, nothing is
 * changed unless `clearInvalid` is set, which empties those cells.
 */
export async function updateTable(projectId: string, id: string, input: { name?: string; slug?: string; description?: string; publicRead?: boolean; publicInsert?: boolean; fields?: Field[]; clearInvalid?: boolean }) {
  const t = await getTable(projectId, id);
  const patch: Partial<typeof schema.dataTables.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 80);
  if (input.description !== undefined) patch.description = input.description.slice(0, 300);
  if (input.publicRead !== undefined) patch.publicRead = input.publicRead;
  if (input.publicInsert !== undefined) patch.publicInsert = input.publicInsert;
  if (input.slug !== undefined && input.slug !== t.slug) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(input.slug)) throw new ApiError("validation_failed", "The API name may use lowercase letters, numbers and dashes", { slug: ["Invalid"] });
    patch.slug = input.slug;
  }
  let conversions: { field: Field; from: Field }[] = [];
  let removed: string[] = [];
  if (input.fields) {
    const errs = checkFields(input.fields);
    if (errs.length) throw new ApiError("validation_failed", errs[0], { fields: errs });
    await checkRelations(projectId, input.fields);
    const before = new Map(t.fields.map((f) => [f.id, f]));
    removed = t.fields.filter((f) => !input.fields!.some((n) => n.id === f.id)).map((f) => f.id);
    conversions = input.fields.filter((f) => before.has(f.id) && (before.get(f.id)!.type !== f.type || JSON.stringify(before.get(f.id)!.options ?? []) !== JSON.stringify(f.options ?? []) || before.get(f.id)!.relationTable !== f.relationTable)).map((f) => ({ field: f, from: before.get(f.id)! }));
    patch.fields = input.fields;
  }
  return db.transaction(async (tx) => {
    if (conversions.length) {
      const rows = await tx.select({ id: schema.dataRows.id, data: schema.dataRows.data }).from(schema.dataRows).where(eq(schema.dataRows.tableId, t.id));
      const failures: string[] = [];
      let failed = 0;
      const updates: { id: string; data: Record<string, unknown> }[] = [];
      for (const r of rows) {
        const d = { ...(r.data as Record<string, unknown>) };
        let changed = false;
        for (const { field } of conversions) {
          const v = d[field.id];
          if (v === undefined || v === null) continue;
          const c = coerce({ ...field, required: false }, Array.isArray(v) && field.type !== "multiselect" && field.type !== "json" ? v.join(", ") : typeof v === "object" && field.type !== "json" ? JSON.stringify(v) : v);
          if (c.ok) {
            if (JSON.stringify(c.value) !== JSON.stringify(v)) {
              d[field.id] = c.value;
              changed = true;
            }
          } else if (input.clearInvalid) {
            d[field.id] = null;
            changed = true;
          } else if (++failed <= 5) failures.push(`${field.name}: "${String(v).slice(0, 40)}" — ${c.error}`);
        }
        if (changed) updates.push({ id: r.id, data: d });
      }
      if (failed) throw new ApiError("conflict", `${failed} value${failed === 1 ? "" : "s"} can't be converted. Fix them or choose to clear them.`, { conversions: failures, count: [String(failed)] });
      for (const u of updates) await tx.update(schema.dataRows).set({ data: u.data }).where(eq(schema.dataRows.id, u.id));
    }
    for (const fid of removed) await tx.execute(sql`update data_rows set data = data - ${fid} where table_id = ${t.id}`);
    try {
      const [out] = await tx.update(schema.dataTables).set(patch).where(eq(schema.dataTables.id, t.id)).returning();
      return out as Table;
    } catch (e) {
      if (/data_tables_slug_uq/.test(String((e as { cause?: unknown }).cause ?? e))) throw new ApiError("conflict", `A table called "${patch.slug}" already exists`, { slug: ["Taken"] });
      throw e;
    }
  });
}

export async function deleteTable(projectId: string, id: string) {
  const t = await getTable(projectId, id);
  const refs = (await listTables(projectId)).filter((o) => o.id !== t.id && o.fields.some((f) => f.type === "relation" && f.relationTable === t.id));
  if (refs.length) throw new ApiError("conflict", `"${refs[0].name}" links to this table. Remove that link field first.`);
  await db.delete(schema.dataTables).where(eq(schema.dataTables.id, t.id));
  return t;
}

// ── Queries ──

const SYSTEM: Record<string, SQL> = { id: sql`id::text`, created_at: sql`created_at`, updated_at: sql`updated_at` };

function expr(f: Field): SQL {
  switch (f.type) {
    case "number":
      return sql`(case when jsonb_typeof(data->${f.id}) = 'number' then (data->>${f.id})::numeric end)`;
    case "boolean":
      return sql`coalesce((case when jsonb_typeof(data->${f.id}) = 'boolean' then (data->>${f.id})::boolean end), false)`;
    default:
      return sql`(data->>${f.id})`;
  }
}

function filterSql(fields: Field[], flt: Filter): SQL {
  const f = fields.find((x) => x.key === flt.field);
  const sys = SYSTEM[flt.field];
  if (!f && !sys) throw new ApiError("validation_failed", `Unknown field "${flt.field}" in filter`);
  const v = flt.value ?? "";
  if (flt.op === "empty" || flt.op === "not_empty") {
    const e = f ? sql`(data->${f.id} is null or data->${f.id} = 'null'::jsonb or data->>${f.id} = '' or data->${f.id} = '[]'::jsonb)` : sql`false`;
    return flt.op === "empty" ? e : sql`not ${e}`;
  }
  if (f?.type === "multiselect") {
    if (flt.op === "eq" || flt.op === "contains") return sql`(data->${f.id}) ? ${v}`;
    if (flt.op === "neq") return sql`not coalesce((data->${f.id}) ? ${v}, false)`;
    if (flt.op === "in") return sql`(data->${f.id}) ?| array(select jsonb_array_elements_text(${JSON.stringify(v.split(",").map((s) => s.trim()))}::jsonb))`;
    throw new ApiError("validation_failed", `"${flt.op}" doesn't apply to ${f.name}`);
  }
  const left = f ? expr(f) : sys!;
  const typed = (s: string): unknown => {
    if (f?.type === "number") {
      const n = Number(s);
      if (!Number.isFinite(n)) throw new ApiError("validation_failed", `Filter on ${f.name} needs a number`);
      return n;
    }
    if (f?.type === "boolean") return ["true", "1", "yes"].includes(s.toLowerCase());
    return s;
  };
  const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  switch (flt.op) {
    case "eq":
      return f?.type === "text" || f?.type === "email" || f?.type === "longtext" ? sql`lower(${left}) = lower(${v})` : sql`${left} = ${typed(v)}`;
    case "neq":
      return sql`${left} is distinct from ${typed(v)}`;
    case "gt":
      return sql`${left} > ${typed(v)}`;
    case "gte":
      return sql`${left} >= ${typed(v)}`;
    case "lt":
      return sql`${left} < ${typed(v)}`;
    case "lte":
      return sql`${left} <= ${typed(v)}`;
    case "contains":
      return sql`${left}::text ilike ${"%" + like(v) + "%"}`;
    case "starts":
      return sql`${left}::text ilike ${like(v) + "%"}`;
    case "in": {
      const vals = v.split(",").map((s) => s.trim()).slice(0, 100);
      // Arrays go in as one JSON parameter (drizzle would expand a JS array into a tuple).
      return f?.type === "number"
        ? sql`${left} in (select x::numeric from jsonb_array_elements_text(${JSON.stringify(vals.map(Number).filter(Number.isFinite))}::jsonb) x)`
        : sql`${left}::text in (select jsonb_array_elements_text(${JSON.stringify(vals)}::jsonb))`;
    }
  }
  throw new ApiError("validation_failed", "Unknown filter");
}

export async function queryRows(t: Table, q: Pick<RowQuery, "filters" | "sort" | "q" | "limit" | "offset">) {
  const where: SQL[] = [sql`table_id = ${t.id}`];
  for (const f of q.filters.slice(0, 20)) where.push(filterSql(t.fields, f));
  if (q.q) where.push(sql`data::text ilike ${"%" + q.q.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"}`);
  const order: SQL[] = [];
  for (const s of q.sort) {
    const f = t.fields.find((x) => x.key === s.field);
    const left = f ? expr(f) : SYSTEM[s.field];
    if (!left) throw new ApiError("validation_failed", `Unknown field "${s.field}" in sort`);
    order.push(s.dir === "desc" ? sql`${left} desc nulls last` : sql`${left} asc nulls last`);
  }
  order.push(sql`created_at desc`, sql`id`);
  const w = sql.join(where, sql` and `);
  const [rows, [{ total }]] = await Promise.all([
    db.execute(sql`select id, data, created_at as "createdAt", updated_at as "updatedAt" from data_rows where ${w} order by ${sql.join(order, sql`, `)} limit ${q.limit} offset ${q.offset}`),
    db.execute(sql`select count(*)::int as total from data_rows where ${w}`).then((r) => r.rows as { total: number }[]),
  ]);
  return { rows: rows.rows as { id: string; data: Record<string, unknown>; createdAt: Date; updatedAt: Date }[], total };
}

/** API-shaped rows, with `expand`ed relation fields replaced by the linked row. */
/** `mayRead` says whether the caller may see a linked table's rows (an anonymous caller only sees public tables). */
export async function apiRows(projectId: string, t: Table, rows: { id: string; data: unknown; createdAt: Date; updatedAt: Date }[], expand: string[] = [], mayRead: (target: Table) => boolean = () => true) {
  const out = rows.map((r) => toApi(t.fields, r));
  for (const key of expand) {
    const f = t.fields.find((x) => x.key === key && x.type === "relation");
    if (!f) continue;
    const ids = [...new Set(out.map((r) => r[key]).filter((v): v is string => typeof v === "string"))];
    if (!ids.length) continue;
    const target = await getTable(projectId, f.relationTable!);
    if (!mayRead(target)) continue;
    const linked = await db.select().from(schema.dataRows).where(and(eq(schema.dataRows.tableId, target.id), inArray(schema.dataRows.id, ids)));
    const byId = new Map(linked.map((r) => [r.id, toApi(target.fields, r)]));
    for (const r of out) if (typeof r[key] === "string") r[key] = byId.get(r[key] as string) ?? null;
  }
  return out;
}

export async function getRow(t: Table, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Row");
  const [r] = await db.select().from(schema.dataRows).where(and(eq(schema.dataRows.tableId, t.id), eq(schema.dataRows.id, id)));
  if (!r) throw notFound("Row");
  return r;
}

async function assertLinksExist(projectId: string, t: Table, items: Record<string, unknown>[]) {
  for (const f of t.fields.filter((x) => x.type === "relation")) {
    const ids = [...new Set(items.map((d) => d[f.id]).filter((v): v is string => typeof v === "string"))];
    if (!ids.length) continue;
    const found = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(and(eq(schema.dataRows.tableId, f.relationTable!), eq(schema.dataRows.projectId, projectId), inArray(schema.dataRows.id, ids)));
    if (found.length !== ids.length) throw new ApiError("validation_failed", `${f.name}: linked row not found`, { [f.key]: ["Linked row not found"] });
  }
}

async function refreshCount(tableId: string) {
  await db.execute(sql`update data_tables set row_count = (select count(*) from data_rows where table_id = ${tableId}), updated_at = now() where id = ${tableId}`);
}

function emit(projectId: string, type: "row.created" | "row.updated" | "row.deleted", t: Table, row: Record<string, unknown>) {
  void emitEvent(projectId, type, { table: t.slug, tableName: t.name, row }).catch((e) => log.warn("row_event_failed", { error: (e as Error).message }));
}

export async function insertRows(projectId: string, t: Table, inputs: Record<string, unknown>[], opts: { emit?: boolean } = {}) {
  if (t.rowCount + inputs.length > LIMITS.rows) throw new ApiError("conflict", `A table can hold up to ${LIMITS.rows.toLocaleString("en")} rows`);
  const data: Record<string, unknown>[] = [];
  const errors: Record<string, string[]> = {};
  inputs.forEach((input, i) => {
    const r = toStored(t.fields, input, false);
    if (!r.ok) for (const [k, v] of Object.entries(r.errors)) errors[inputs.length > 1 ? `${i}.${k}` : k] = v;
    else if (JSON.stringify(r.data).length > LIMITS.rowBytes) errors[inputs.length > 1 ? String(i) : "row"] = ["Row is too large"];
    else data.push(r.data);
  });
  if (Object.keys(errors).length) throw new ApiError("validation_failed", "Some values are invalid", errors);
  await assertLinksExist(projectId, t, data);
  const rows = [];
  for (let i = 0; i < data.length; i += 500) rows.push(...(await db.insert(schema.dataRows).values(data.slice(i, i + 500).map((d) => ({ tableId: t.id, projectId, data: d }))).returning()));
  await refreshCount(t.id);
  if (opts.emit !== false && rows.length <= 20) for (const r of rows) emit(projectId, "row.created", t, toApi(t.fields, r));
  return rows;
}

export async function updateRow(projectId: string, t: Table, id: string, input: Record<string, unknown>) {
  const cur = await getRow(t, id);
  const r = toStored(t.fields, input, true);
  if (!r.ok) throw new ApiError("validation_failed", "Some values are invalid", r.errors);
  const data = { ...(cur.data as Record<string, unknown>), ...r.data };
  if (JSON.stringify(data).length > LIMITS.rowBytes) throw new ApiError("payload_too_large", "Row is too large");
  await assertLinksExist(projectId, t, [r.data]);
  const [row] = await db.update(schema.dataRows).set({ data, updatedAt: new Date() }).where(eq(schema.dataRows.id, cur.id)).returning();
  emit(projectId, "row.updated", t, toApi(t.fields, row));
  return row;
}

export async function deleteRows(projectId: string, t: Table, ids: string[]) {
  const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 1000);
  if (!valid.length) return 0;
  // Rows other tables link to keep their links pointing nowhere; clear them so reads don't dangle.
  const gone = await db.delete(schema.dataRows).where(and(eq(schema.dataRows.tableId, t.id), inArray(schema.dataRows.id, valid))).returning({ id: schema.dataRows.id });
  if (gone.length) {
    for (const other of await listTables(projectId)) {
      for (const f of other.fields.filter((x) => x.type === "relation" && x.relationTable === t.id)) {
        await db.execute(sql`update data_rows set data = jsonb_set(data, ${`{${f.id}}`}::text[], 'null'::jsonb) where table_id = ${other.id} and data->>${f.id} in (select jsonb_array_elements_text(${JSON.stringify(gone.map((g) => g.id))}::jsonb))`);
      }
    }
    await refreshCount(t.id);
    if (gone.length <= 20) for (const g of gone) emit(projectId, "row.deleted", t, { id: g.id });
  }
  return gone.length;
}

// ── CSV ──

export async function exportCsv(t: Table) {
  const rows = await db.select().from(schema.dataRows).where(eq(schema.dataRows.tableId, t.id)).orderBy(asc(schema.dataRows.createdAt)).limit(LIMITS.rows);
  const head = ["id", ...t.fields.map((f) => f.key), "created_at"];
  const body = rows.map((r) => {
    const a = toApi(t.fields, r);
    return head.map((k) => csvEscape(a[k])).join(",");
  });
  return [head.join(","), ...body].join("\r\n") + "\r\n";
}

/** Imports rows; header cells match field keys or names. All-or-nothing unless skipInvalid. */
export async function importCsv(projectId: string, t: Table, text: string, skipInvalid: boolean) {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new ApiError("validation_failed", "The file needs a header row and at least one row");
  if (grid.length - 1 > LIMITS.importRows) throw new ApiError("payload_too_large", `Import up to ${LIMITS.importRows} rows at a time`);
  const header = grid[0].map((h) => h.trim());
  const map = header.map((h) => t.fields.find((f) => f.key === h || f.name.toLowerCase() === h.toLowerCase() || f.key === slugKey(h)) ?? null);
  if (!map.some(Boolean)) throw new ApiError("validation_failed", "None of the columns match this table's fields");
  const good: Record<string, unknown>[] = [];
  const problems: { line: number; errors: string[] }[] = [];
  grid.slice(1).forEach((cells, i) => {
    const input: Record<string, unknown> = {};
    map.forEach((f, c) => {
      if (f) input[f.key] = cells[c] ?? "";
    });
    const r = toStored(t.fields, input, false);
    if (r.ok) good.push(input);
    else problems.push({ line: i + 2, errors: Object.entries(r.errors).map(([k, v]) => `${k}: ${v[0]}`) });
  });
  if (problems.length && !skipInvalid) return { inserted: 0, skipped: 0, problems: problems.slice(0, 50), matched: map.filter(Boolean).map((f) => f!.key), ignored: header.filter((_, i) => !map[i]) };
  const rows = good.length ? await insertRows(projectId, t, good, { emit: false }) : [];
  return { inserted: rows.length, skipped: problems.length, problems: problems.slice(0, 50), matched: map.filter(Boolean).map((f) => f!.key), ignored: header.filter((_, i) => !map[i]) };
}
