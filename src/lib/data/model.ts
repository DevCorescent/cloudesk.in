// Project data tables: typed fields over JSON rows. Shared by the database
// studio, the generated REST API and published-site data sections.
import { z } from "zod";

export const FIELD_TYPES = ["text", "longtext", "number", "boolean", "date", "datetime", "email", "url", "select", "multiselect", "relation", "json"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_INFO: Record<FieldType, { label: string; hint: string }> = {
  text: { label: "Text", hint: "A short line, up to 500 characters" },
  longtext: { label: "Long text", hint: "Paragraphs, up to 20,000 characters" },
  number: { label: "Number", hint: "Integers or decimals" },
  boolean: { label: "Checkbox", hint: "Yes or no" },
  date: { label: "Date", hint: "YYYY-MM-DD" },
  datetime: { label: "Date & time", hint: "ISO 8601, stored in UTC" },
  email: { label: "Email", hint: "A valid address" },
  url: { label: "Link", hint: "http(s) address" },
  select: { label: "Single select", hint: "One of a fixed list" },
  multiselect: { label: "Multi select", hint: "Any of a fixed list" },
  relation: { label: "Link to row", hint: "A row in another table" },
  json: { label: "JSON", hint: "Any JSON value, up to 16 KB" },
};

export const LIMITS = { tables: 50, fields: 60, rows: 50_000, rowBytes: 64 * 1024, pageSize: 100, importRows: 5000 };

export const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores, starting with a letter");

export const fieldSchema = z.object({
  /** Stable id; row data is keyed by it, so renaming a field never touches rows. */
  id: z.string().regex(/^f_[a-z0-9]{6,16}$/),
  key: keySchema,
  name: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  relationTable: z.string().uuid().optional(),
  description: z.string().max(200).optional(),
});
export type Field = z.infer<typeof fieldSchema>;

export const RESERVED_KEYS = new Set(["id", "created_at", "updated_at"]);

export function slugKey(name: string) {
  const k = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return /^[a-z]/.test(k) ? k : `f_${k || "field"}`.slice(0, 48);
}

export function newFieldId() {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  for (const b of bytes) s += a[b % a.length];
  return `f_${s}`;
}

/** Checks a whole field list: unique keys, options for selects, a target for relations. */
export function checkFields(fields: Field[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  if (fields.length > LIMITS.fields) errs.push(`A table can have up to ${LIMITS.fields} fields`);
  for (const f of fields) {
    if (RESERVED_KEYS.has(f.key)) errs.push(`"${f.key}" is reserved`);
    if (seen.has(f.key)) errs.push(`Two fields use the key "${f.key}"`);
    if (ids.has(f.id)) errs.push(`Duplicate field id ${f.id}`);
    seen.add(f.key);
    ids.add(f.id);
    if ((f.type === "select" || f.type === "multiselect") && !f.options?.length) errs.push(`${f.name}: add at least one option`);
    if (f.type === "relation" && !f.relationTable) errs.push(`${f.name}: choose the table to link to`);
  }
  return errs;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Converts one input value to the field's stored form, or explains why it can't. */
export function coerce(f: Field, v: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (v === undefined || v === null || v === "") {
    if (f.type === "boolean") return { ok: true, value: false };
    if (f.type === "multiselect") return { ok: true, value: [] };
    return f.required ? { ok: false, error: "Required" } : { ok: true, value: null };
  }
  switch (f.type) {
    case "text":
    case "longtext": {
      const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;
      if (s === null) return { ok: false, error: "Expected text" };
      const max = f.type === "text" ? 500 : 20_000;
      return s.length > max ? { ok: false, error: `At most ${max} characters` } : { ok: true, value: f.type === "text" ? s.replace(/[\r\n]+/g, " ") : s };
    }
    case "number": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(/,/g, "")) : NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Expected a number" };
    }
    case "boolean": {
      if (typeof v === "boolean") return { ok: true, value: v };
      const s = String(v).trim().toLowerCase();
      if (["true", "yes", "1", "y", "on", "✓"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "0", "n", "off"].includes(s)) return { ok: true, value: false };
      return { ok: false, error: "Expected true or false" };
    }
    case "date": {
      const s = String(v).trim().slice(0, 10);
      if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return { ok: false, error: "Expected a date like 2026-10-21" };
      return { ok: true, value: s };
    }
    case "datetime": {
      const d = new Date(typeof v === "number" ? v : String(v));
      return Number.isNaN(d.getTime()) ? { ok: false, error: "Expected a date and time" } : { ok: true, value: d.toISOString() };
    }
    case "email": {
      const s = String(v).trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? { ok: true, value: s } : { ok: false, error: "Expected an email address" };
    }
    case "url": {
      const s = String(v).trim();
      try {
        const u = new URL(s);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        return s.length > 2000 ? { ok: false, error: "Link too long" } : { ok: true, value: u.toString() };
      } catch {
        return { ok: false, error: "Expected an http(s) link" };
      }
    }
    case "select": {
      const s = String(v).trim();
      return f.options?.includes(s) ? { ok: true, value: s } : { ok: false, error: `Expected one of: ${(f.options ?? []).join(", ")}` };
    }
    case "multiselect": {
      const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const bad = arr.filter((s) => !f.options?.includes(s));
      return bad.length ? { ok: false, error: `Not an option: ${bad.join(", ")}` } : { ok: true, value: [...new Set(arr)] };
    }
    case "relation": {
      const s = String(v).trim();
      return z.uuid().safeParse(s).success ? { ok: true, value: s } : { ok: false, error: "Expected a row id" };
    }
    case "json": {
      let val = v;
      if (typeof v === "string") {
        try {
          val = JSON.parse(v);
        } catch {
          return { ok: false, error: "Expected valid JSON" };
        }
      }
      return JSON.stringify(val).length > 16_384 ? { ok: false, error: "At most 16 KB" } : { ok: true, value: val };
    }
  }
}

/**
 * Validates API-shaped input ({ key: value }) into stored data ({ fieldId: value }).
 * `partial` (PATCH) only touches the keys given; unknown keys are rejected.
 */
export function toStored(fields: Field[], input: Record<string, unknown>, partial: boolean): { ok: true; data: Record<string, unknown> } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const data: Record<string, unknown> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const k of Object.keys(input)) if (!byKey.has(k) && !RESERVED_KEYS.has(k)) errors[k] = ["Unknown field"];
  for (const f of fields) {
    if (partial && !(f.key in input)) continue;
    const r = coerce(f, input[f.key]);
    if (r.ok) data[f.id] = r.value;
    else errors[f.key] = [r.error];
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

/** Stored data → API shape, keyed by field key. */
export function toApi(fields: Field[], row: { id: string; data: unknown; createdAt: Date | string; updatedAt: Date | string }) {
  const d = (row.data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { id: row.id };
  for (const f of fields) out[f.key] = d[f.id] ?? (f.type === "boolean" ? false : f.type === "multiselect" ? [] : null);
  out.created_at = new Date(row.createdAt).toISOString();
  out.updated_at = new Date(row.updatedAt).toISOString();
  return out;
}

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts", "in", "empty", "not_empty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export type Filter = { field: string; op: FilterOp; value?: string };
export type Sort = { field: string; dir: "asc" | "desc" };

/** Parses `?filter[key]=v`, `?filter[key][op]=v`, `?sort=-a,b`, `?q=`, `?limit=`, `?offset=`. */
export function parseQuery(params: URLSearchParams) {
  const filters: Filter[] = [];
  for (const [k, v] of params) {
    const m = /^filter\[([a-z_][a-z0-9_]*)\](?:\[([a-z_]+)\])?$/.exec(k);
    if (!m) continue;
    const op = (m[2] ?? "eq") as FilterOp;
    if (!FILTER_OPS.includes(op)) throw new Error(`Unknown filter operator "${m[2]}"`);
    filters.push({ field: m[1], op, value: v });
  }
  const sort: Sort[] = (params.get("sort") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => (s.startsWith("-") ? { field: s.slice(1), dir: "desc" as const } : { field: s, dir: "asc" as const }));
  return {
    filters,
    sort,
    q: (params.get("q") ?? "").slice(0, 200),
    limit: Math.min(LIMITS.pageSize, Math.max(1, Number(params.get("limit")) || 50)),
    offset: Math.min(1_000_000, Math.max(0, Number(params.get("offset")) || 0)),
    expand: (params.get("expand") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5),
  };
}
export type RowQuery = ReturnType<typeof parseQuery>;

// ── CSV ──

/**
 * Neutralises spreadsheet formula injection: a cell starting with = + - @ (or a
 * tab/CR) runs as a formula in Excel/Sheets, so it gets a leading quote — unless
 * the whole cell is a plain number like -12.50 (a "-1+cmd|…" payload is not).
 */
export function neutralizeFormula(s: string) {
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

export function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = neutralizeFormula(s);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
