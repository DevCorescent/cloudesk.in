// The smart importer. Any spreadsheet (CSV, TSV, Excel, ODS, Numbers) is read
// into a grid; the header row is found (skipping titles and blank rows);
// each column is matched to a field by its name and by what's in it; and
// every value is cleaned up — ₹1,299.00, "1.5 lakh", 24/10/2026, "yes",
// "Maharashtra" — with a suggestion when it can't be used as it is. Nothing
// here talks to the server: the screens run it, show what needs fixing, and
// send clean rows. The server checks them again with the same code.

export type FieldType = "text" | "longtext" | "number" | "int" | "money" | "percent" | "date" | "email" | "phone" | "bool" | "enum" | "gstin" | "state" | "pan" | "url" | "duration";
export type Option = { value: string; label: string; aliases?: string[] };
export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Other headings this field goes by ("Mobile", "Contact no"). */
  aliases?: string[];
  options?: Option[];
  hint?: string;
  example?: string;
  /** Fill blank cells with this when the column has nothing. */
  fallback?: string;
};
export type Target = {
  id: string;
  label: string;
  /** What a row is called ("item", "employee"). */
  noun: string;
  fields: Field[];
  /** How rows that already exist are found, and what to do with them. */
  modes?: { value: string; label: string }[];
  defaultMode?: string;
};

export type Cell = { value: string | number | boolean | null; raw: string; error?: string; suggestion?: { value: string | number | boolean; label: string } };

// ─── Reading ───

const normText = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[_\-./#()[\]:*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The header row: the one among the first 20 that looks most like headings for this target. */
export function headerRow(grid: unknown[][], target: Target) {
  const names = new Set(target.fields.flatMap((f) => [f.label, f.key, ...(f.aliases ?? [])].map(normText)));
  let best = 0;
  let bestScore = -Infinity;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const cells = (grid[r] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const known = cells.filter((c) => names.has(normText(c))).length;
    const wordy = cells.filter((c) => /[a-z]/i.test(c) && !/^[\d\s.,₹$%/-]+$/.test(c) && c.length < 50).length;
    const score = known * 4 + wordy - (cells.length - wordy) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** Headings and data rows from a grid, with empty rows and columns dropped. */
export function tableFrom(grid: unknown[][], target: Target, at = headerRow(grid, target)) {
  const width = Math.max(0, ...grid.slice(at).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(grid[at]?.[i] ?? "").trim() || `Column ${i + 1}`);
  const all = grid.slice(at + 1).map((r, i) => ({ n: at + 2 + i, cells: Array.from({ length: width }, (_, c) => (r[c] === null || r[c] === undefined ? "" : r[c])) }));
  const kept = all.filter((r) => r.cells.some((c) => String(c).trim() !== ""));
  const rows = kept.map((r) => r.cells);
  const used = headers.map((_, i) => rows.some((r) => String(r[i]).trim() !== "") || !/^Column \d+$/.test(headers[i]));
  // headerRow is 0-based; rowNumbers are the spreadsheet's own 1-based row numbers.
  return { headers: headers.filter((_, i) => used[i]), rows: rows.map((r) => r.filter((_, i) => used[i])), headerRow: at, rowNumbers: kept.map((r) => r.n) };
}

// ─── Matching columns ───

/** Similarity of two short strings (Dice coefficient over letter pairs). */
export function similarity(a: string, b: string) {
  const x = normText(a).replace(/\s/g, "");
  const y = normText(b).replace(/\s/g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  const pairs = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const px = pairs(x);
  const py = pairs(y);
  let hit = 0;
  for (const [k, n] of px) hit += Math.min(n, py.get(k) ?? 0);
  return (2 * hit) / (Math.max(1, x.length - 1) + Math.max(1, y.length - 1));
}

const SNIFF: Partial<Record<FieldType, (v: string) => boolean>> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone: (v) => v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 13 && !/[a-z]/i.test(v),
  gstin: (v) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(v.trim()),
  pan: (v) => /^[A-Z]{5}\d{4}[A-Z]$/i.test(v.trim()),
  date: (v) => !!toDate(v),
  url: (v) => /^https?:\/\//i.test(v),
};

export type Match = { field: string | null; confidence: number; why: string };

/** Proposes which column fills each field: by heading first, then by what the values look like. */
export function matchColumns(headers: string[], rows: unknown[][], target: Target): Match[] {
  const out: Match[] = headers.map(() => ({ field: null, confidence: 0, why: "" }));
  const scored: { col: number; field: Field; score: number; why: string }[] = [];
  headers.forEach((h, col) => {
    const n = normText(h);
    for (const f of target.fields) {
      const names = [f.label, f.key, ...(f.aliases ?? [])].map(normText);
      if (names.includes(n)) scored.push({ col, field: f, score: 1, why: `Heading “${h}”` });
      else {
        // Whole words count: "Closing Qty" has "qty"; "Rate (₹) per unit" has "rate".
        const words = new Set(n.split(" "));
        const byWords = names.filter((x) => x.length >= 2 && x.split(" ").every((w) => words.has(w))).map((x) => (x.split(" ").length > 1 ? 0.85 : 0.75));
        const best = Math.max(...names.map((x) => similarity(x, n)), ...names.filter((x) => x.length > 3 && (n.includes(x) || x.includes(n))).map(() => 0.8), ...byWords);
        if (best >= 0.62) scored.push({ col, field: f, score: best * 0.9, why: `Heading “${h}” looks like ${f.label}` });
      }
    }
    // Values tell what a column is when its heading doesn't.
    const vals = rows.slice(0, 50).map((r) => String(r[col] ?? "").trim()).filter(Boolean);
    if (vals.length >= 2)
      for (const f of target.fields) {
        const sniff = SNIFF[f.type];
        if (!sniff) continue;
        const share = vals.filter(sniff).length / vals.length;
        if (share >= 0.8) scored.push({ col, field: f, score: 0.55 + share * 0.2, why: `Values look like ${f.type === "email" ? "email addresses" : f.type === "phone" ? "phone numbers" : f.type === "gstin" ? "GSTINs" : f.type === "pan" ? "PANs" : f.type === "url" ? "links" : "dates"}` });
      }
  });
  const taken = new Set<string>();
  for (const s of scored.sort((a, b) => b.score - a.score)) {
    if (out[s.col].field || taken.has(s.field.key)) continue;
    out[s.col] = { field: s.field.key, confidence: Math.round(s.score * 100) / 100, why: s.why };
    taken.add(s.field.key);
  }
  return out;
}

// ─── Cleaning values ───

const STATES: Record<string, string> = { AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh", CG: "Chhattisgarh", DN: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OD: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UK: "Uttarakhand", WB: "West Bengal" };
const STATE_ALIASES: Record<string, string> = { orissa: "OD", or: "OD", uttaranchal: "UK", ua: "UK", tg: "TS", ct: "CG", bombay: "MH", "new delhi": "DL", pondicherry: "PY", "j&k": "JK", "jammu kashmir": "JK", "tamilnadu": "TN", "west bengal": "WB" };
export const stateName = (code: string) => STATES[code] ?? code;

/** 24/10/2026 · 24-10-26 · 2026-10-24 · 24 Oct 2026 · Oct 24, 2026 · an Excel serial number → 2026-10-24. Day first, as in India. */
export function toDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(+v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400_000).toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  if (!t) return null;
  const mon = (s: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3).toLowerCase()) + 1;
  const y = (n: number) => (n < 100 ? 2000 + n : n);
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(y(+m[3]), +m[2], +m[1]);
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,})[\s,-]+(\d{2,4})$/);
  if (m && mon(m[2])) return iso(y(+m[3]), mon(m[2]), +m[1]);
  m = t.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2,4})$/);
  if (m && mon(m[1])) return iso(y(+m[3]), mon(m[1]), +m[2]);
  return null;
}
function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? dt.toISOString().slice(0, 10) : null;
}

/** 1,299.50 · ₹1,299 · Rs 499/- · (500) · 1.5 lakh · 2 cr · 12k → a number. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t0 = String(v ?? "").trim().toLowerCase();
  if (!t0) return null;
  // Shorthand only on a bare number with its unit, so "1,000.00 Cr" (a credit) isn't read as crores.
  const short = t0.match(/^₹?\s*(\d+(?:\.\d+)?)\s*(k|l|lakhs?|lacs?|cr|crores?)$/);
  if (short) return Number(short[1]) * (short[2] === "k" ? 1e3 : /^(l|la)/.test(short[2]) ? 1e5 : 1e7);
  const neg = /^\(.*\)$/.test(t0) || /^-/.test(t0) || /\bdr\.?$/.test(t0);
  let t = t0.replace(/[^\d.,]/g, "");
  if (!t || !/\d/.test(t)) return null;
  // 1.234,56 (European) vs 1,234.56; Indian grouping 1,23,456.78 is commas as grouping.
  const lc = t.lastIndexOf(",");
  const ld = t.lastIndexOf(".");
  if (lc > ld && /,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  t = t.replace(/^\.+|\.+$/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -1 : 1) * n : null;
}

const YES = /^(y|yes|true|1|on|active|✓|✔|x)$/i;
const NO = /^(n|no|false|0|off|inactive|-)$/i;

/** Read "1:30", "1h 30m", "90m", "1.5", "1,5", "2h" (or an Excel time) as minutes; null if it isn't a duration. */
export function toMinutes(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    // Excel keeps a time like 1:30 as a fraction of a day (0.0625); plain hours (0.5, 0.25) stay hours.
    if (raw < 1 && !Number.isInteger(Math.round(raw * 60 * 1e6) / 1e6) && Number.isInteger(Math.round(raw * 1440 * 1e6) / 1e6)) return Math.round(raw * 1440);
    return Math.round(raw * 60);
  }
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return 0;
  let m = s.match(/^(\d{1,3}):([0-5]?\d)(?::\d\d)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d+(?:[.,]\d+)?) ?(?:h|hr|hrs|hour|hours))? ?(?:(\d+) ?(?:m|min|mins|minutes?))?$/);
  if (m && (m[1] || m[2])) return Math.round(Number((m[1] ?? "0").replace(",", ".")) * 60) + Number(m[2] ?? 0);
  m = s.match(/^\d+(?:[.,]\d+)?$/);
  if (m) return Math.round(Number(s.replace(",", ".")) * 60);
  return null;
}

/** Clean one value for a field: the value to use, or an error with a suggestion. */
export function clean(raw: unknown, f: Field): Cell {
  const text = raw === null || raw === undefined ? "" : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim();
  const empty = text === "";
  if (empty) {
    if (f.fallback !== undefined && f.fallback !== "") return clean(f.fallback, { ...f, fallback: undefined });
    return f.required ? { value: null, raw: text, error: `${f.label} is needed` } : { value: null, raw: text };
  }
  switch (f.type) {
    case "text":
    case "longtext":
      return { value: text.slice(0, f.type === "text" ? 200 : 5000), raw: text };
    case "number":
    case "int":
    case "percent": {
      const n = toNumber(text.replace(/%$/, ""));
      if (n === null) return { value: null, raw: text, error: `“${text}” isn't a number` };
      return { value: f.type === "int" ? Math.round(n) : Math.round(n * 1000) / 1000, raw: text };
    }
    case "money": {
      const n = toNumber(text);
      if (n === null) return { value: null, raw: text, error: `“${text}” isn't an amount` };
      return { value: Math.round(n * 100), raw: text };
    }
    case "duration": {
      const m = toMinutes(typeof raw === "number" ? raw : text);
      if (m === null) return { value: null, raw: text, error: `“${text}” isn't a duration — use 1:30, 1.5 or 90m` };
      if (m > 24 * 60) return { value: null, raw: text, error: `${text} is more than a day` };
      return { value: m, raw: text };
    }
    case "date": {
      const d = toDate(raw instanceof Date ? raw : typeof raw === "number" ? raw : text);
      return d ? { value: d, raw: text } : { value: null, raw: text, error: `“${text}” isn't a date — use 24/10/2026` };
    }
    case "email": {
      const e = text.toLowerCase().replace(/^mailto:/, "").replace(/\s/g, "");
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { value: e, raw: text };
      // Common slips: a comma for a dot, a missing ".com".
      const fix = e.replace(/,/g, ".").replace(/@(gmail|yahoo|hotmail|outlook|rediffmail)$/, "@$1.com").replace(/\.con$/, ".com");
      return { value: null, raw: text, error: `“${text}” isn't an email address`, ...(fix !== e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fix) ? { suggestion: { value: fix, label: fix } } : {}) };
    }
    case "phone": {
      const digits = text.replace(/[^\d+]/g, "");
      const bare = digits.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
      if (/^\d{10}$/.test(bare)) return { value: `+91 ${bare.slice(0, 5)} ${bare.slice(5)}`, raw: text };
      if (/^\+\d{8,15}$/.test(digits)) return { value: digits, raw: text };
      return { value: null, raw: text, error: `“${text}” isn't a phone number` };
    }
    case "bool":
      if (YES.test(text)) return { value: true, raw: text };
      if (NO.test(text)) return { value: false, raw: text };
      return { value: null, raw: text, error: `Use yes or no` };
    case "gstin": {
      const g = text.toUpperCase().replace(/\s/g, "");
      if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { value: g, raw: text };
      return { value: null, raw: text, error: `“${text}” isn't a GSTIN (15 characters, like 27ABCDE1234F1Z5)` };
    }
    case "pan": {
      const p = text.toUpperCase().replace(/\s/g, "");
      return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? { value: p, raw: text } : { value: null, raw: text, error: `“${text}” isn't a PAN (like ABCDE1234F)` };
    }
    case "url":
      return /^https?:\/\/\S+$/i.test(text) ? { value: text, raw: text } : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) ? { value: `https://${text}`, raw: text } : { value: null, raw: text, error: `“${text}” isn't a link` };
    case "state": {
      const up = text.toUpperCase();
      if (STATES[up]) return { value: up, raw: text };
      const low = text.toLowerCase();
      if (STATE_ALIASES[low]) return { value: STATE_ALIASES[low], raw: text };
      // GST state code numbers: 27 → MH.
      const byNum = /^\d{2}$/.test(text) ? GST_NUM[text] : undefined;
      if (byNum) return { value: byNum, raw: text };
      const exact = Object.entries(STATES).find(([, n]) => n.toLowerCase() === low);
      if (exact) return { value: exact[0], raw: text };
      const best = Object.entries(STATES).map(([c, n]) => ({ c, n, s: similarity(n, text) })).sort((a, b) => b.s - a.s)[0];
      return { value: null, raw: text, error: `“${text}” isn't a state we know`, ...(best && best.s > 0.5 ? { suggestion: { value: best.c, label: `${best.n} (${best.c})` } } : {}) };
    }
    case "enum": {
      const opts = f.options ?? [];
      const low = normText(text);
      const hit = opts.find((o) => [o.value, o.label, ...(o.aliases ?? [])].map(normText).includes(low));
      if (hit) return { value: hit.value, raw: text };
      const best = opts.map((o) => ({ o, s: Math.max(similarity(o.label, text), similarity(o.value, text), ...(o.aliases ?? []).map((a) => similarity(a, text))) })).sort((a, b) => b.s - a.s)[0];
      return { value: null, raw: text, error: `“${text}” isn't one of: ${opts.slice(0, 6).map((o) => o.label).join(", ")}${opts.length > 6 ? "…" : ""}`, ...(best && best.s > 0.45 ? { suggestion: { value: best.o.value, label: best.o.label } } : {}) };
    }
  }
}

const GST_NUM: Record<string, string> = { "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA" };

export type Row = Record<string, Cell>;

/** Every row cleaned against the fields, from the chosen columns and any one-for-all values. */
export function buildRows(rows: unknown[][], mapping: (string | null)[], target: Target, constants: Record<string, string> = {}): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const f of target.fields) {
      const col = mapping.indexOf(f.key);
      const cell = col >= 0 ? r[col] : "";
      // A value given for everyone fills the blanks (or the whole field when no column has it).
      const raw = cell !== "" && cell !== null && cell !== undefined && String(cell).trim() !== "" ? cell : (constants[f.key] ?? "");
      out[f.key] = clean(raw, f);
    }
    return out;
  });
}

export const rowErrors = (row: Row) => Object.values(row).filter((c) => c.error).length;
/** The plain values to send: { field: value }. */
export const plain = (row: Row) => Object.fromEntries(Object.entries(row).map(([k, c]) => [k, c.value]));

/** Re-check plain rows on the server with the same rules; returns cleaned values or the first problem. */
export function validateRow(values: Record<string, unknown>, target: Target): { ok: true; values: Record<string, string | number | boolean | null> } | { ok: false; error: string } {
  const out: Record<string, string | number | boolean | null> = {};
  for (const f of target.fields) {
    const v = values[f.key];
    // Money, durations and dates arrive already cleaned (paise, minutes, ISO); re-clean only text-like input.
    if ((f.type === "money" || f.type === "duration") && typeof v === "number") {
      out[f.key] = Math.round(v);
      continue;
    }
    const c = clean(v, f);
    if (c.error) return { ok: false, error: c.error };
    out[f.key] = c.value;
  }
  return { ok: true, values: out };
}
