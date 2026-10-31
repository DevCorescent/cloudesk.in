// Running a report: the spec (fields picked by key) is turned into one SQL
// query against its dataset — every expression comes from the dataset's
// catalogue, every value people typed is a bound parameter — grouped, sorted
// and limited, inside a read-only transaction with a time limit.
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bucketLabel, rangeFor, type Spec } from "@/lib/bi/model";
import { ApiError } from "../http/errors";
import type { Ctx, Dataset, Field } from "./datasets";

export type Column = { key: string; label: string; type: Field["type"] | "count"; bucket?: string | null };
export type Result = { /** How many leading columns are dimensions. */ dims: number; columns: Column[]; rows: (string | number | boolean | null)[][]; totals: (number | null)[]; range: { from: string | null; to: string | null }; truncated: boolean };

/** The fields a person may use on a dataset (salary fields need payroll access). */
export const fieldsFor = (d: Dataset, c: Pick<Ctx, "can">) => d.fields.filter((x) => !x.perm || c.can(x.perm));

function need(d: Dataset, c: Ctx, key: string) {
  const f = fieldsFor(d, c).find((x) => x.key === key);
  if (!f) throw new ApiError("validation_failed", `“${key}” isn't a field of ${d.label}`);
  return f;
}

const raw = (s: string) => sql.raw(`(${s})`);

function filterSql(f: Field, op: Spec["filters"][number]["op"], value: Spec["filters"][number]["value"]): SQL {
  const e = raw(f.sql);
  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ApiError("validation_failed", `${f.label}: enter a number`);
    // Money is kept in paise; people type rupees.
    return f.type === "money" ? Math.round(n * 100) : n;
  };
  const val = (v: unknown) => (f.type === "number" || f.type === "money" ? num(v) : String(v ?? ""));
  switch (op) {
    case "empty":
      return sql`(${e} is null or ${e}::text = '')`;
    case "notempty":
      return sql`(${e} is not null and ${e}::text <> '')`;
    case "true":
      return sql`coalesce(${e}, false) = true`;
    case "false":
      return sql`coalesce(${e}, false) = false`;
    case "contains":
      return sql`${e}::text ilike ${`%${String(value ?? "").replace(/[%_\\]/g, (m) => `\\${m}`)}%`}`;
    case "in": {
      const list = (Array.isArray(value) ? value : String(value ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);
      if (!list.length) throw new ApiError("validation_failed", `${f.label}: pick at least one`);
      return f.type === "number" || f.type === "money" ? sql`${e} = any(ARRAY[${sql.join(list.map((x) => sql`${num(x)}`), sql`, `)}]::numeric[])` : sql`${e}::text = any(ARRAY[${sql.join(list.map((x) => sql`${x}`), sql`, `)}]::text[])`;
    }
    case "eq":
      return f.type === "date" ? sql`${e} = ${String(value)}::date` : sql`${e} = ${val(value)}`;
    case "ne":
      return f.type === "date" ? sql`${e} is distinct from ${String(value)}::date` : sql`${e} is distinct from ${val(value)}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const cmp = { gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` }[op];
      return f.type === "date" ? sql`${e} ${cmp} ${String(value)}::date` : sql`${e} ${cmp} ${num(value)}`;
    }
  }
}

/** Run a report on a dataset for a person, as of today (in India). */
export async function run(d: Dataset, spec: Spec, c: Ctx, today: string, fyStartMonth = 4): Promise<Result> {
  const dims = spec.dims.map((x) => ({ f: need(d, c, x.field), bucket: x.bucket }));
  const measures = spec.measures.map((m) => {
    if (m.agg === "count" && !m.field) return { f: null as Field | null, agg: m.agg };
    if (!m.field) throw new ApiError("validation_failed", "Pick what to measure");
    const f = need(d, c, m.field);
    if (["sum", "avg"].includes(m.agg) && !["number", "money"].includes(f.type)) throw new ApiError("validation_failed", `${f.label} isn't a number to add up`);
    return { f, agg: m.agg };
  });
  const where: SQL[] = [];
  for (const x of spec.filters) where.push(filterSql(need(d, c, x.field), x.op, x.value));
  const rangeField = spec.range.field ?? d.dateField;
  const range = rangeField ? rangeFor(spec.range, today, fyStartMonth) : { from: null, to: null };
  if (rangeField) {
    const rf = need(d, c, rangeField);
    if (rf.type !== "date") throw new ApiError("validation_failed", `${rf.label} isn't a date`);
    if (range.from) where.push(sql`${raw(rf.sql)} >= ${range.from}::date`);
    if (range.to) where.push(sql`${raw(rf.sql)} <= ${range.to}::date`);
  }
  const dimSql = dims.map(({ f, bucket }) => (f.type === "date" && bucket ? sql`date_trunc(${bucket}, ${raw(f.sql)})::date` : raw(f.sql)));
  const mSql = measures.map(({ f, agg }) => {
    if (agg === "count") return f ? sql`count(${raw(f.sql)})` : sql`count(*)`;
    if (agg === "distinct") return sql`count(distinct ${raw(f!.sql)})`;
    if (agg === "sum") return sql`coalesce(sum(${raw(f!.sql)}), 0)`;
    if (agg === "avg") return sql`avg(${raw(f!.sql)})`;
    if (agg === "min") return sql`min(${raw(f!.sql)})`;
    return sql`max(${raw(f!.sql)})`;
  });
  const select = sql.join([...dimSql.map((x, i) => sql`${x} as ${sql.raw(`d${i}`)}`), ...mSql.map((x, i) => sql`${x} as ${sql.raw(`m${i}`)}`)], sql`, `);
  const sortKey = spec.sort.by && ((spec.sort.by.startsWith("d") && Number(spec.sort.by.slice(1)) < dims.length) || (spec.sort.by.startsWith("m") && Number(spec.sort.by.slice(1)) < measures.length)) ? spec.sort.by : dims.some((x) => x.f.type === "date") ? `d${dims.findIndex((x) => x.f.type === "date")}` : measures.length ? "m0" : null;
  const dir = sortKey && sortKey.startsWith("d") && dims[Number(sortKey.slice(1))]?.f.type === "date" && !spec.sort.by ? sql`asc` : spec.sort.dir === "asc" ? sql`asc` : sql`desc`;
  const q = sql`select ${select} from ${d.from(c)} ${where.length ? sql`and ${sql.join(where, sql` and `)}` : sql``} ${dims.length ? sql`group by ${sql.join(dims.map((_, i) => sql.raw(String(i + 1))), sql`, `)}` : sql``} ${sortKey ? sql`order by ${sql.raw(sortKey)} ${dir} nulls last` : sql``} limit ${spec.limit + 1}`;
  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = 15000`);
    await tx.execute(sql`set local transaction read only`);
    return (await tx.execute(q)) as unknown as { rows: Record<string, unknown>[] };
  });
  const truncated = res.rows.length > spec.limit;
  const out = res.rows.slice(0, spec.limit).map((r) => [
    ...dims.map(({ f }, i) => {
      const v = r[`d${i}`];
      if (v === null || v === undefined) return null;
      if (f.type === "date") return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
      if (f.type === "number" || f.type === "money") return Number(v);
      if (f.type === "bool") return Boolean(v);
      return String(v);
    }),
    ...measures.map((_, i) => {
      const v = r[`m${i}`];
      return v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;
    }),
  ]);
  const columns: Column[] = [
    ...dims.map(({ f, bucket }) => ({ key: f.key, label: f.type === "date" && bucket ? `${f.label} (${bucket})` : f.label, type: f.type, bucket: f.type === "date" ? bucket : null })),
    ...measures.map(({ f, agg }) => ({ key: f?.key ?? "rows", label: !f ? "Count" : agg === "count" ? `Count of ${f.label.toLowerCase()}` : agg === "distinct" ? `Distinct ${f.label.toLowerCase()}` : `${{ sum: "Total", avg: "Average", min: "Lowest", max: "Highest" }[agg as "sum" | "avg" | "min" | "max"]} ${f.label.toLowerCase()}`, type: (!f || agg === "count" || agg === "distinct" ? "count" : f.type) as Column["type"] })),
  ];
  // Totals for measures that add up (sums and counts), over the rows shown.
  const totals = columns.map((col, i) => (i < dims.length ? null : ["sum", "count", "distinct"].includes(measures[i - dims.length].agg) && measures[i - dims.length].agg !== "distinct" ? out.reduce((n, r) => n + (Number(r[i]) || 0), 0) : null));
  return { dims: dims.length, columns, rows: out, totals, range, truncated };
}

/** Plain text of a result, for an email: up to 20 rows, labels formatted. */
export function asText(r: Result) {
  const fmt = (v: unknown, c: Column) => (v === null || v === undefined ? "—" : c.type === "money" ? `₹${(Number(v) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : c.type === "date" ? bucketLabel(String(v), (c.bucket as never) ?? null) : c.type === "bool" ? (v ? "Yes" : "No") : typeof v === "number" ? v.toLocaleString("en-IN") : String(v));
  const lines = r.rows.slice(0, 20).map((row) => row.map((v, i) => fmt(v, r.columns[i])).join("  ·  "));
  return [r.columns.map((c) => c.label).join("  ·  "), ...lines, r.rows.length > 20 ? `…and ${r.rows.length - 20} more rows` : ""].filter(Boolean).join("\n");
}
