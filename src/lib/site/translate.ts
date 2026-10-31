// Translation by field: only user-visible text leaves the document, keyed by
// a stable path, and only those fields are written back. Structure, links,
// prices and images cannot change.
import { sectionDef, type FieldDef, type SiteDoc } from "./model";

export type TextItem = { key: string; text: string };

const TRANSLATABLE = new Set(["text", "textarea"]);
// Fields whose values are names or codes rather than prose.
const KEEP = new Set(["brand", "currency", "price", "email", "phone", "whatsapp", "address", "icon"]);

function walk(value: unknown, fields: FieldDef[], prefix: string, out: TextItem[]) {
  const obj = (value ?? {}) as Record<string, unknown>;
  for (const f of fields) {
    const v = obj[f.key];
    if (f.kind === "list") {
      if (Array.isArray(v)) v.forEach((item, i) => walk(item, f.fields, `${prefix}${f.key}.${i}.`, out));
    } else if (f.kind === "strings") {
      if (Array.isArray(v)) v.forEach((s, i) => typeof s === "string" && s.trim() && out.push({ key: `${prefix}${f.key}.${i}`, text: s }));
    } else if (TRANSLATABLE.has(f.kind) && !KEEP.has(f.key) && typeof v === "string" && v.trim() && !/^https?:\/\//.test(v)) {
      out.push({ key: `${prefix}${f.key}`, text: v });
    }
  }
}

/** Text of every page in a language: page titles, descriptions and section copy. */
export function collectTexts(doc: SiteDoc, lang: string): TextItem[] {
  const out: TextItem[] = [];
  for (const page of doc.pages) {
    if ((page.lang ?? doc.lang) !== lang) continue;
    if (page.title.trim()) out.push({ key: `p:${page.id}|title`, text: page.title });
    if (page.description.trim()) out.push({ key: `p:${page.id}|description`, text: page.description });
    for (const s of page.sections) {
      const def = sectionDef(s.type);
      if (def) walk(s.props, def.fields, `s:${page.id}:${s.id}|`, out);
    }
  }
  return out;
}

function setPath(obj: Record<string, unknown>, path: string, value: string) {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = (cur as Record<string, unknown>)?.[parts[i]];
    if (cur === undefined || cur === null || typeof cur !== "object") return false;
  }
  const last = parts.at(-1)!;
  if (typeof (cur as Record<string, unknown>)[last] !== "string") return false;
  (cur as Record<string, unknown>)[last] = value;
  return true;
}

/** Writes translations back by key and marks those pages translated. Returns how many fields changed. */
export function applyTexts(doc: SiteDoc, lang: string, translations: Record<string, string>) {
  let n = 0;
  for (const [key, text] of Object.entries(translations)) {
    const m = /^(p|s):([^|:]+)(?::([^|]+))?\|(.+)$/.exec(key);
    if (!m) continue;
    const page = doc.pages.find((p) => p.id === m[2] && (p.lang ?? doc.lang) === lang);
    if (!page) continue;
    if (m[1] === "p") {
      if (m[4] === "title") page.title = text.slice(0, 120);
      else if (m[4] === "description") page.description = text.slice(0, 300);
      else continue;
      n++;
    } else {
      const s = page.sections.find((x) => x.id === m[3]);
      if (s && setPath(s.props, m[4], text)) n++;
    }
  }
  for (const p of doc.pages) if ((p.lang ?? doc.lang) === lang) delete p.needsTranslation;
  return n;
}

/** Problems with a model's answer for one chunk: missing or extra keys, empty text, markup. */
export function checkTranslations(items: TextItem[], answer: Record<string, string>) {
  const problems: string[] = [];
  const want = new Set(items.map((i) => i.key));
  for (const k of want) if (typeof answer[k] !== "string" || !answer[k].trim()) problems.push(`Missing translation for "${k}"`);
  for (const k of Object.keys(answer)) if (!want.has(k)) problems.push(`Unexpected key "${k}"`);
  for (const [k, v] of Object.entries(answer)) if (typeof v === "string" && /<\/?[a-z][^>]*>/i.test(v)) problems.push(`"${k}" contains HTML; return plain text`);
  return problems.slice(0, 20);
}

/** Splits texts into chunks that fit comfortably in one request. */
export function chunkTexts(items: TextItem[], maxChars = 12_000) {
  const chunks: TextItem[][] = [];
  let cur: TextItem[] = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && size + it.text.length > maxChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.text.length + it.key.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
