// Custom fields, custom objects and rules. One definition shape serves both
// the extra fields a workspace adds to its records (items, employees,
// tickets…) and the fields of the objects it makes itself; values are checked
// here, on the screen and again on the server, and rules are plain
// conditions — never code — so they can't do anything but say "no".
import { z } from "zod";
import type { Field as ImportField, Target } from "@/lib/import/engine";

export const CF_TYPES = ["text", "longtext", "number", "money", "date", "select", "multiselect", "checkbox", "url", "email", "phone", "link"] as const;
export type CfType = (typeof CF_TYPES)[number];

export const CF_TYPE_LABEL: Record<CfType, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  money: "Amount (₹)",
  date: "Date",
  select: "One of a list",
  multiselect: "Several of a list",
  checkbox: "Yes / no",
  url: "Link (web address)",
  email: "Email",
  phone: "Phone",
  link: "Link to a record",
};

export const LIMITS = { fieldsPerEntity: 40, objects: 30, rulesPerEntity: 30, bulk: 1000, importRows: 5000, longtext: 20_000, text: 500 };

const key = z
  .string()
  .trim()
  .min(1, "Give the field a key")
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores, starting with a letter");

export const fieldDefSchema = z
  .object({
    key,
    label: z.string().trim().min(1, "Name the field").max(60),
    type: z.enum(CF_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
    required: z.boolean().default(false),
    help: z.string().trim().max(200).default(""),
    /** For "link": a built-in entity ("inventory.item") or a custom object ("obj:<id>"). */
    linkTo: z.string().max(60).nullable().default(null),
    sort: z.number().int().min(0).max(999).default(0),
  })
  .superRefine((f, ctx) => {
    if ((f.type === "select" || f.type === "multiselect") && !f.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Add the choices" });
    if (new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Each choice only once" });
    if (f.type === "link" && !f.linkTo) ctx.addIssue({ code: "custom", path: ["linkTo"], message: "Pick what it links to" });
  });
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const slugKey = (label: string) => {
  const k = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(k) ? k : `f_${k || "field"}`.slice(0, 40);
};

export type Value = string | number | boolean | string[] | null;
export type Values = Record<string, Value>;

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

/** One value, cleaned to how it's stored (money in paise, dates as YYYY-MM-DD). */
export function coerce(f: Pick<FieldDef, "type" | "options" | "label">, raw: unknown): { ok: true; value: Value } | { ok: false; error: string } {
  if (isEmpty(raw)) return { ok: true, value: null };
  const bad = (m: string) => ({ ok: false as const, error: `${f.label}: ${m}` });
  switch (f.type) {
    case "text":
    case "longtext": {
      const s = String(raw).trim();
      const max = f.type === "text" ? LIMITS.text : LIMITS.longtext;
      if (s.length > max) return bad(`at most ${max.toLocaleString("en-IN")} characters`);
      return { ok: true, value: s || null };
    }
    case "number":
    case "money": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[₹,\s]/g, ""));
      if (!Number.isFinite(n)) return bad("needs a number");
      if (Math.abs(n) > 1e13) return bad("is too large");
      return { ok: true, value: f.type === "money" ? Math.round(n) : n };
    }
    case "date": {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) return bad("needs a date");
      return { ok: true, value: s };
    }
    case "checkbox":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (/^(yes|y|true|1)$/i.test(String(raw).trim())) return { ok: true, value: true };
      if (/^(no|n|false|0)$/i.test(String(raw).trim())) return { ok: true, value: false };
      return bad("needs yes or no");
    case "select": {
      const hit = f.options.find((o) => o.toLowerCase() === String(raw).trim().toLowerCase());
      return hit ? { ok: true, value: hit } : bad(`isn't one of ${f.options.join(", ")}`);
    }
    case "multiselect": {
      const list = (Array.isArray(raw) ? raw : String(raw).split(/[,;]/)).map((x) => String(x).trim()).filter(Boolean);
      const out: string[] = [];
      for (const x of list) {
        const hit = f.options.find((o) => o.toLowerCase() === x.toLowerCase());
        if (!hit) return bad(`"${x}" isn't one of ${f.options.join(", ")}`);
        if (!out.includes(hit)) out.push(hit);
      }
      return { ok: true, value: out.length ? out : null };
    }
    case "url": {
      const s = String(raw).trim();
      try {
        const u = new URL(s);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
        return { ok: true, value: u.toString() };
      } catch {
        return bad("needs a web address starting with http:// or https://");
      }
    }
    case "email": {
      const s = String(raw).trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200 ? { ok: true, value: s } : bad("needs an email address");
    }
    case "phone": {
      const s = String(raw).trim();
      const digits = s.replace(/[\s\-().]/g, "");
      return /^\+?\d{7,15}$/.test(digits) ? { ok: true, value: digits } : bad("needs a phone number (7–15 digits)");
    }
    case "link": {
      const s = String(raw).trim();
      return /^[0-9a-f-]{36}$/i.test(s) ? { ok: true, value: s.toLowerCase() } : bad("needs a record");
    }
  }
}

/**
 * Checks values against the definitions. `partial` only looks at the keys
 * given (and leaves required fields alone unless they're being emptied).
 */
export function checkValues(fields: Pick<FieldDef, "key" | "type" | "options" | "label" | "required">[], input: Record<string, unknown>, opts: { partial?: boolean } = {}): { values: Values; errors: Record<string, string> } {
  const values: Values = {};
  const errors: Record<string, string> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const k of Object.keys(input)) if (!byKey.has(k)) errors[k] = `There's no field "${k}"`;
  for (const f of fields) {
    if (opts.partial && !(f.key in input)) continue;
    const r = coerce(f, input[f.key]);
    if (!r.ok) errors[f.key] = r.error;
    else if (f.required && r.value === null) errors[f.key] = `${f.label} is needed`;
    else values[f.key] = r.value;
  }
  return { values, errors };
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "filled", "empty", "contains", "in"] as const;
export type Op = (typeof OPS)[number];
export const OP_LABEL: Record<Op, string> = { eq: "is", ne: "isn't", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most", filled: "is filled in", empty: "is empty", contains: "contains", in: "is one of" };
export const NO_VALUE: Op[] = ["filled", "empty"];

export const condSchema = z.object({
  field: z.string().min(1).max(60),
  op: z.enum(OPS),
  /** A value, a list for "in", "today" for dates, or "@other_field" to compare two fields. */
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(60)).max(50), z.null()]).default(null),
});
export type Cond = z.infer<typeof condSchema>;

export const ruleSchema = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  /** All of these must be true for the rule to apply (none: always). */
  when: z.array(condSchema).max(10).default([]),
  /** …and then all of these must be true, or the save is refused. */
  then: z.array(condSchema).min(1, "Say what must be true").max(10),
  message: z.string().trim().min(1, "Write the message people see").max(200),
  active: z.boolean().default(true),
});
export type Rule = z.infer<typeof ruleSchema>;

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function resolve(v: Cond["value"], rec: Record<string, unknown>): unknown {
  if (typeof v === "string" && v.startsWith("@")) return rec[v.slice(1)];
  if (v === "today") return todayIST();
  return v;
}

const cmp = (a: unknown, b: unknown): number | null => {
  if (a === null || a === undefined || b === null || b === undefined || a === "" || b === "") return null;
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && typeof a !== "boolean" && typeof b !== "boolean") return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

const lc = (x: unknown) => (typeof x === "string" ? x.toLowerCase() : x);

export function evalCond(c: Cond, rec: Record<string, unknown>): boolean {
  const a = rec[c.field];
  const b = resolve(c.value, rec);
  switch (c.op) {
    case "filled":
      return !isEmpty(a);
    case "empty":
      return isEmpty(a);
    case "eq":
      if (Array.isArray(a)) return a.some((x) => lc(x) === lc(b));
      if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === (b === true || b === "true" || b === "yes");
      return cmp(a, b) === 0 || lc(a) === lc(b);
    case "ne":
      return !evalCond({ ...c, op: "eq" }, rec);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const d = cmp(a, b);
      if (d === null) return false;
      return c.op === "gt" ? d > 0 : c.op === "gte" ? d >= 0 : c.op === "lt" ? d < 0 : d <= 0;
    }
    case "contains":
      if (Array.isArray(a)) return a.some((x) => lc(x) === lc(b));
      return typeof a === "string" && typeof b === "string" && a.toLowerCase().includes(b.toLowerCase());
    case "in": {
      const list = (Array.isArray(b) ? b : String(b ?? "").split(",")).map((x) => String(x).trim().toLowerCase());
      return Array.isArray(a) ? a.some((x) => list.includes(String(x).toLowerCase())) : list.includes(String(a ?? "").toLowerCase());
    }
  }
}

/** The messages of the rules a record breaks. */
export function brokenRules(rules: (Pick<Rule, "when" | "then" | "message"> & { active?: boolean })[], rec: Record<string, unknown>): string[] {
  return rules.filter((r) => r.active !== false && r.when.every((c) => evalCond(c, rec)) && !r.then.every((c) => evalCond(c, rec))).map((r) => r.message);
}

/** Fields a rule refers to that don't exist (a field removed after the rule was made). */
export function unknownRefs(rule: Pick<Rule, "when" | "then">, keys: Set<string>): string[] {
  const out = new Set<string>();
  for (const c of [...rule.when, ...rule.then]) {
    if (!keys.has(c.field)) out.add(c.field);
    if (typeof c.value === "string" && c.value.startsWith("@") && !keys.has(c.value.slice(1))) out.add(c.value.slice(1));
  }
  return [...out];
}

export function describeCond(c: Cond, label: (k: string) => string): string {
  if (NO_VALUE.includes(c.op)) return `${label(c.field)} ${OP_LABEL[c.op]}`;
  const v = typeof c.value === "string" && c.value.startsWith("@") ? label(c.value.slice(1)) : Array.isArray(c.value) ? c.value.join(", ") : c.value === "today" ? "today" : String(c.value ?? "");
  return `${label(c.field)} ${OP_LABEL[c.op]} ${v}`;
}

// ─── Custom objects ──────────────────────────────────────────────────────────

export const objectSchema = z.object({
  name: z.string().trim().min(1, "Name it (one of them, like “Site visit”)").max(40),
  plural: z.string().trim().min(1, "And more than one, like “Site visits”").max(40),
  description: z.string().trim().max(300).default(""),
  /** Records are numbered PREFIX-0001. */
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, "1–6 letters")
    .default("REC"),
  /** The field that names a record in lists and links; none: its number. */
  titleField: z.string().max(40).nullable().default(null),
  /** Roles that can add and change records; empty: everyone who can edit in the workspace. */
  editRoles: z.array(z.string().max(40)).max(20).default([]),
});
export type ObjectDef = z.infer<typeof objectSchema>;

export const recordNo = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(4, "0")}`;

// ─── Bulk ────────────────────────────────────────────────────────────────────

export const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), entity: z.string().min(1).max(60), ids: z.array(z.string().uuid()).min(1).max(LIMITS.bulk), field: z.string().min(1).max(40), value: z.unknown() }),
  z.object({ action: z.literal("delete"), entity: z.string().regex(/^obj:[0-9a-f-]{36}$/), ids: z.array(z.string().uuid()).min(1).max(LIMITS.bulk), confirm: z.number().int() }),
]);

// ─── Import targets from definitions ─────────────────────────────────────────

const IMPORT_TYPE: Record<CfType, ImportField["type"]> = { text: "text", longtext: "longtext", number: "number", money: "money", date: "date", select: "enum", multiselect: "text", checkbox: "bool", url: "url", email: "email", phone: "phone", link: "text" };

/** A smart-import target for a set of fields (links are matched by the linked record's name). */
export function importTarget(id: string, label: string, noun: string, fields: FieldDef[], match?: { key: string; label: string }): Target {
  return {
    id,
    label,
    noun,
    modes: [
      { value: "update", label: match ? `Update the ${noun} with the same ${match.label}` : "Add every row" },
      { value: "skip", label: match ? `Leave ${noun}s already filled in alone` : "Add every row" },
    ],
    defaultMode: "update",
    fields: [
      ...(match ? [{ key: match.key, label: match.label, type: "text" as const, required: true, aliases: [match.label.toLowerCase()] }] : []),
      ...fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: IMPORT_TYPE[f.type],
        required: !match && f.required,
        aliases: [f.label.toLowerCase(), f.key.replace(/_/g, " ")],
        ...(f.type === "select" ? { options: f.options.map((o) => ({ value: o, label: o })) } : {}),
        ...(f.type === "multiselect" ? { hint: `Separate with commas: ${f.options.join(", ")}` } : {}),
        ...(f.type === "link" ? { hint: "The linked record's name or number" } : {}),
      })),
    ],
  };
}
