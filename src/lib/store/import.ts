// Smart product import: turns any spreadsheet (Shopify/WooCommerce/Amazon/
// Meesho exports, or a hand-made sheet with its own headings) into draft
// products. Columns are recognised by their names and, when names don't
// help, by what the values look like. Each product lists what still needs
// filling so the owner can fix it before anything is published.

export const IMPORT_FIELDS = ["title", "description", "price", "compareAt", "cost", "sku", "barcode", "stock", "category", "tags", "vendor", "images", "weight", "group", "status", "hsn"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** A column can feed a product field, become a variant option (e.g. "Size"), or be ignored. */
export type Mapping = { field: ImportField | "option" | "ignore"; option?: string; confidence: number };

export const FIELD_LABEL: Record<ImportField | "option" | "ignore", string> = {
  title: "Product name",
  description: "Description",
  price: "Price",
  compareAt: "Compare-at / MRP",
  cost: "Cost price",
  sku: "SKU / code",
  barcode: "Barcode (EAN/UPC)",
  stock: "Stock",
  category: "Category",
  tags: "Tags",
  vendor: "Brand",
  images: "Image links",
  weight: "Weight",
  group: "Group variants by",
  status: "Status",
  hsn: "HSN code",
  option: "Variant option",
  ignore: "Don't import",
};

const norm = (s: string) =>
  s
    .replace(/\b([A-Za-z])\.(?=[A-Za-z]\.)/g, "$1")
    .replace(/\b([A-Za-z])\.(?=\s|$)/g, "$1")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Heading synonyms, most specific first. Normalised (lowercase, words only).
const SYNONYMS: Record<ImportField, string[]> = {
  title: ["product name", "product title", "item name", "title", "name", "product", "item", "article name", "item title", "nombre", "produktname", "nom du produit", "designation", "style name"],
  description: ["description", "product description", "body html", "body", "details", "long description", "short description", "about", "product details", "features", "item description", "desc"],
  price: ["selling price", "sale price", "variant price", "price", "offer price", "our price", "unit price", "retail price", "rate", "sp", "final price", "price inr", "amount", "special price", "precio", "preis", "prix"],
  compareAt: ["mrp", "compare at price", "variant compare at price", "compare at", "original price", "list price", "regular price", "max retail price", "maximum retail price", "was price", "strike price", "market price"],
  cost: ["cost price", "cost per item", "cost", "purchase price", "buying price", "wholesale price", "cp", "landing cost"],
  sku: ["variant sku", "sku", "sku code", "item code", "product code", "article number", "article no", "style code", "model number", "model", "code", "seller sku", "item sku"],
  barcode: ["variant barcode", "barcode", "bar code", "ean", "ean13", "ean 13", "upc", "gtin", "isbn", "barcode number", "ean code"],
  stock: ["variant inventory qty", "inventory qty", "stock quantity", "stock qty", "quantity", "qty", "stock", "inventory", "available", "in stock", "units", "on hand", "available quantity", "inventory quantity", "count"],
  category: ["product category", "category", "categories", "collection", "collections", "product type", "type", "department", "group name", "section"],
  tags: ["tags", "keywords", "labels", "search terms"],
  vendor: ["brand", "vendor", "manufacturer", "brand name", "maker", "marca", "marke"],
  images: ["image src", "image url", "image urls", "images", "image", "photo", "photos", "picture", "pictures", "img", "thumbnail", "main image", "main image url", "image link", "additional images", "variant image", "other images", "gallery"],
  weight: ["weight grams", "variant grams", "grams", "weight g", "weight", "shipping weight", "weight kg", "package weight", "net weight"],
  group: ["handle", "parent sku", "parent", "group id", "item group id", "product id", "slug", "url handle", "style id", "parent id"],
  status: ["status", "published", "active", "visibility", "enabled"],
  hsn: ["hsn", "hsn code", "hsn sac", "sac"],
};
// Headings that are variant options.
const OPTION_WORDS = ["size", "colour", "color", "material", "variant", "style", "flavour", "flavor", "pack", "pack size", "capacity", "length", "fit", "finish", "scent", "shade", "storage", "ram", "edition", "format", "age"];

const URL_RE = /https?:\/\/[^\s,|;"'<>]+/gi;
const IMAGE_URL = /^https?:\/\/[^\s]+?(\.(jpe?g|png|webp|gif|avif)(\?[^\s]*)?$|\/(images?|photos?|media|cdn|uploads?)\/|googleusercontent|cloudinary|shopify|unsplash|imgur|drive\.google)/i;
const NUMERIC = /^[\s(₹$€£¥]*(rs\.?|inr|usd|eur|gbp|aed)?\s*[-+]?[\d.,\s']+\s*(rs\.?|inr|usd|eur|gbp|aed|\/-)?[\s)]*$/i;

/** Finds the header row: the first of the top rows that looks most like headings. */
export function findHeaderRow(grid: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] ?? [];
    const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const words = cells.filter((c) => /[a-zA-ZÀ-ɏऀ-ॿ]/.test(c) && !NUMERIC.test(c) && c.length < 60);
    const known = cells.filter((c) => Object.values(SYNONYMS).some((list) => list.includes(norm(c))) || OPTION_WORDS.includes(norm(c))).length;
    const score = known * 3 + words.length - (cells.length - words.length) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** Proposes a mapping for each column from its heading and sample values. */
export function guessMapping(headers: string[], rows: unknown[][]): Mapping[] {
  const sample = (i: number) => rows.slice(0, 200).map((r) => r[i]).filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
  const scored: { col: number; field: ImportField | "option"; score: number; option?: string }[] = [];
  headers.forEach((h, col) => {
    const n = norm(h);
    if (!n) return;
    for (const f of IMPORT_FIELDS) {
      const list = SYNONYMS[f];
      const idx = list.indexOf(n);
      if (idx >= 0) scored.push({ col, field: f, score: 1 - idx * 0.01 });
      else if (list.some((s) => s.length > 3 && (n.startsWith(`${s} `) || n.endsWith(` ${s}`) || n === `${s}s`))) scored.push({ col, field: f, score: 0.7 });
    }
    // Shopify "Option1 Name/Value" pairs are handled when building products.
    const opt = OPTION_WORDS.find((w) => n === w || n === `${w}s` || n.startsWith(`${w} `) || n.endsWith(` ${w}`));
    if (opt && !/name$/.test(n)) scored.push({ col, field: "option", score: n === opt ? 0.95 : 0.75, option: titleCase(h.replace(/\(.*?\)/g, "").trim()) });
    if (/^option\s?\d\s?value$/.test(n)) scored.push({ col, field: "option", score: 0.9, option: "" });
  });
  // Content-based guesses for columns without a confident name match.
  headers.forEach((_, col) => {
    if (scored.some((s) => s.col === col && s.score >= 0.7)) return;
    const vals = sample(col).map(String);
    if (vals.length < 2) return;
    const share = (fn: (v: string) => boolean) => vals.filter(fn).length / vals.length;
    if (share((v) => !!v.match(URL_RE)?.some((u) => IMAGE_URL.test(u))) > 0.6) scored.push({ col, field: "images", score: 0.6 });
    else if (share((v) => v.length > 80) > 0.5) scored.push({ col, field: "description", score: 0.45 });
    else if (share((v) => /[₹$€£]|rs\.?\s*\d/i.test(v)) > 0.6) scored.push({ col, field: "price", score: 0.5 });
  });
  // Assign greedily: highest score first, one column per field (images, options may repeat).
  const out: Mapping[] = headers.map(() => ({ field: "ignore", confidence: 0 }));
  const taken = new Set<string>();
  for (const s of scored.sort((a, b) => b.score - a.score)) {
    if (out[s.col].field !== "ignore") continue;
    const repeatable = s.field === "images" || s.field === "option" || s.field === "tags";
    if (!repeatable && taken.has(s.field)) continue;
    out[s.col] = { field: s.field, option: s.option, confidence: Math.round(s.score * 100) / 100 };
    taken.add(s.field);
  }
  // With only "MRP" and no selling price, MRP is the price.
  if (!out.some((m) => m.field === "price")) {
    const mrp = out.findIndex((m) => m.field === "compareAt");
    if (mrp >= 0) out[mrp] = { field: "price", confidence: 0.6 };
  }
  // Shopify pairs: "Option1 Name" column says what "Option1 Value" is.
  headers.forEach((h, col) => {
    const m = /^option\s?(\d)\s?value$/.exec(norm(h));
    if (!m || out[col].field !== "option") return;
    const nameCol = headers.findIndex((x) => norm(x) === `option${m[1]} name` || norm(x) === `option ${m[1]} name`);
    const name = nameCol >= 0 ? String(rows.find((r) => String(r[nameCol] ?? "").trim())?.[nameCol] ?? "").trim() : "";
    out[col].option = name && name.toLowerCase() !== "title" ? name : "";
    if (!out[col].option) out[col] = { field: "ignore", confidence: 0.5 };
  });
  return out;
}

const titleCase = (s: string) => s.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Parses prices like ₹1,299.00 · Rs. 499/- · 1.299,00 € · $12 · 1 299,50 into minor units. */
export function parseMoney(v: unknown, digits = 2): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 10 ** digits) : null;
  let s = String(v ?? "")
    .replace(/[^\d.,\s'-]/g, "")
    .trim();
  if (!s || !/\d/.test(s)) return null;
  // Leading/trailing punctuation comes from currency words ("Rs.") and suffixes ("/-").
  s = s.replace(/[\s']/g, "").replace(/^[.,-]+/, "").replace(/[.,-]+$/, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimal: "," | "." | null = null;
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) decimal = /,\d{1,2}$/.test(s) && (s.match(/,/g)?.length ?? 0) === 1 ? "," : null;
  // "1.200" is twelve hundred (European grouping); real prices don't have three decimals.
  else if (lastDot >= 0) decimal = /\.\d{3}$/.test(s) && (digits <= 2 || (s.match(/\./g)?.length ?? 0) > 1) ? null : ".";
  const cleaned = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : decimal === "." ? s.replace(/,/g, "") : s.replace(/[.,]/g, "");
  const n = Number(cleaned.replace(/-$/, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** digits) : null;
}

export function parseStock(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(in stock|available|yes|y|true)$/.test(s)) return null;
  if (/^(out of stock|sold out|no|n|false|0)$/.test(s)) return 0;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && s.match(/\d/) ? Math.max(0, Math.round(n)) : null;
}

export function parseWeightGrams(v: unknown, heading: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).toLowerCase();
  const n = typeof v === "number" ? v : Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const kg = /\bkg\b|kilo/.test(s) || (/\bkg\b|kilo/.test(heading.toLowerCase()) && !/\bg\b|gram/.test(s));
  const lb = /\blbs?\b|pound/.test(s) || /\blbs?\b/.test(heading.toLowerCase());
  return Math.round(kg ? n * 1000 : lb ? n * 453.6 : n);
}

/** Pulls image links out of a cell; Google Drive share links become direct image links. */
export function extractImages(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(v ?? "").match(URL_RE) ?? []) {
    let u = raw.replace(/[).,;]+$/, "");
    const drive = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/.exec(u);
    if (drive) u = `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1600`;
    if (u.startsWith("http://")) u = `https://${u.slice(7)}`;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 10);
}

export type DraftVariant = { options: Record<string, string>; price: number | null; compareAt: number | null; cost: number | null; sku: string; barcode?: string; stock: number | null; weightGrams: number | null };
export type Issue = { field: "title" | "price" | "images" | "description" | "stock" | "category" | "variants"; level: "required" | "recommended"; message: string };
export type DraftProduct = {
  key: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  vendor: string;
  images: string[];
  hsn: string;
  active: boolean;
  options: { name: string; values: string[] }[];
  variants: DraftVariant[];
  rows: number[];
  issues: Issue[];
  /** Photo links from the file that didn't load (removed from images). */
  brokenImages?: string[];
};

const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());

/** Builds draft products from rows using a mapping. Rows with the same group key (or name) become variants. */
export function buildProducts(headers: string[], rows: unknown[][], mapping: Mapping[], opts: { digits?: number } = {}): DraftProduct[] {
  const digits = opts.digits ?? 2;
  const idx = (f: ImportField) => mapping.findIndex((m) => m.field === f);
  const all = (f: ImportField) => mapping.map((m, i) => (m.field === f ? i : -1)).filter((i) => i >= 0);
  const optionCols = mapping.map((m, i) => (m.field === "option" ? { i, name: m.option || titleCase(headers[i]) } : null)).filter(Boolean) as { i: number; name: string }[];
  const groups = new Map<string, DraftProduct>();
  let lastKey = "";
  rows.forEach((r, n) => {
    if (!r.some((c) => text(c))) return;
    const title = text(cell(r, idx("title")));
    const groupVal = text(cell(r, idx("group")));
    // Shopify-style continuation rows have a handle but no title.
    const key = (groupVal || title).toLowerCase() || (optionCols.some((o) => text(r[o.i])) || all("images").some((i) => text(r[i])) ? lastKey : "");
    if (!key) return;
    lastKey = key;
    let p = groups.get(key);
    if (!p) {
      p = { key, title: title.slice(0, 160), description: "", category: "", tags: [], vendor: "", images: [], hsn: "", active: true, options: [], variants: [], rows: [], issues: [] };
      groups.set(key, p);
    }
    p.rows.push(n);
    if (!p.title && title) p.title = title.slice(0, 160);
    const d = text(cell(r, idx("description")));
    if (d && d.length > p.description.length) p.description = d.slice(0, 5000);
    if (!p.category) p.category = text(cell(r, idx("category"))).split(/[>/|]/).map((s) => s.trim()).filter(Boolean).pop() ?? "";
    if (!p.vendor) p.vendor = text(cell(r, idx("vendor"))).slice(0, 80);
    if (!p.hsn) p.hsn = text(cell(r, idx("hsn"))).replace(/\D/g, "").slice(0, 8);
    for (const t of all("tags").flatMap((i) => text(r[i]).split(/[,|;]/))) if (t.trim() && !p.tags.includes(t.trim())) p.tags.push(t.trim().slice(0, 40));
    for (const i of all("images")) for (const u of extractImages(r[i])) if (!p.images.includes(u)) p.images.push(u);
    const st = text(cell(r, idx("status"))).toLowerCase();
    if (st && /^(draft|archived|inactive|hidden|false|no|0|disabled)$/.test(st)) p.active = false;
    const options: Record<string, string> = {};
    for (const o of optionCols) {
      const val = text(r[o.i]);
      if (val && val.toLowerCase() !== "default title") options[o.name] = val.slice(0, 60);
    }
    const price = parseMoney(cell(r, idx("price")), digits);
    const v: DraftVariant = {
      options,
      price,
      compareAt: parseMoney(cell(r, idx("compareAt")), digits),
      cost: parseMoney(cell(r, idx("cost")), digits),
      sku: text(cell(r, idx("sku"))).slice(0, 60),
      // Excel turns long codes into numbers (8.9E+12); read them back as digits.
      barcode: barcodeText(cell(r, idx("barcode"))),
      stock: parseStock(cell(r, idx("stock"))),
      weightGrams: idx("weight") >= 0 ? parseWeightGrams(cell(r, idx("weight")), headers[idx("weight")]) : null,
    };
    // Image-only continuation rows add images, not variants.
    const blank = !Object.keys(options).length && price === null && !v.sku && v.stock === null;
    if (blank && p.variants.length) return;
    // A repeated row with identical options replaces nothing; keep the first.
    if (p.variants.some((x) => JSON.stringify(x.options) === JSON.stringify(options) && Object.keys(options).length)) return;
    p.variants.push(v);
  });
  const out = [...groups.values()].slice(0, 2000);
  for (const p of out) {
    // Options with a single value across all variants stay as options only if there are variants.
    const names = [...new Set(p.variants.flatMap((v) => Object.keys(v.options)))];
    p.options = names.map((name) => ({ name, values: [...new Set(p.variants.map((v) => v.options[name]).filter(Boolean))] }));
    if (p.variants.length === 1 && p.options.every((o) => o.values.length <= 1)) {
      p.options = [];
      p.variants[0].options = {};
    }
    // Fill a missing variant price from a sibling (common in exports).
    const known = p.variants.find((v) => v.price !== null)?.price ?? null;
    for (const v of p.variants) if (v.price === null && known !== null && p.variants.length > 1) v.price = known;
    dropFakeDiscounts(p);
    p.issues = issuesFor(p);
  }
  return out;
}

// MRP lower than the selling price is almost always a swapped column; drop it rather than show a fake discount.
function dropFakeDiscounts(p: DraftProduct) {
  for (const v of p.variants) if (v.compareAt !== null && v.price !== null && v.compareAt <= v.price) v.compareAt = null;
}

export function issuesFor(p: Pick<DraftProduct, "title" | "variants" | "images" | "description" | "category" | "brokenImages">): Issue[] {
  const out: Issue[] = [];
  if (!p.title.trim()) out.push({ field: "title", level: "required", message: "Add a product name" });
  if (!p.variants.length || p.variants.some((v) => v.price === null || v.price <= 0)) out.push({ field: "price", level: "required", message: p.variants.length > 1 ? "Every variant needs a price" : "Add a price" });
  if (p.variants.length > 1 && new Set(p.variants.map((v) => JSON.stringify(v.options))).size < p.variants.length) out.push({ field: "variants", level: "required", message: "Two variants have the same options" });
  if (p.brokenImages?.length) out.push({ field: "images", level: "recommended", message: `${p.brokenImages.length} photo link${p.brokenImages.length === 1 ? "" : "s"} didn't open — replace ${p.brokenImages.length === 1 ? "it" : "them"}` });
  else if (!p.images.length) out.push({ field: "images", level: "recommended", message: "Add a photo — products with photos sell far better" });
  if (p.description.trim().length < 20) out.push({ field: "description", level: "recommended", message: "Add a short description" });
  if (p.variants.some((v) => v.stock === null)) out.push({ field: "stock", level: "recommended", message: "Stock not given — we'll start at 10" });
  if (!p.category.trim()) out.push({ field: "category", level: "recommended", message: "Add a category to group it in the shop" });
  return out;
}

function barcodeText(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.round(v)).toString();
  return text(v).replace(/\s+/g, "").slice(0, 48);
}

export const isReady = (p: DraftProduct) => !p.issues.some((i) => i.level === "required");

/** Picks the sheet with the most product-like rows (from a workbook's sheets as grids). */
export function pickSheet(sheets: { name: string; grid: unknown[][] }[]) {
  let best = sheets[0];
  let bestScore = -1;
  for (const s of sheets) {
    const h = findHeaderRow(s.grid);
    const headers = (s.grid[h] ?? []).map((c) => String(c ?? ""));
    const m = guessMapping(headers, s.grid.slice(h + 1));
    const score = (m.some((x) => x.field === "title") ? 50 : 0) + (m.some((x) => x.field === "price") ? 30 : 0) + Math.min(s.grid.length, 2000) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Everything the review screen needs from one grid. */
export function analyse(grid: unknown[][], opts: { digits?: number } = {}) {
  const h = findHeaderRow(grid);
  const headers = (grid[h] ?? []).map((c, i) => String(c ?? "").trim() || `Column ${i + 1}`);
  const rows = grid.slice(h + 1).filter((r) => r.some((c) => String(c ?? "").trim()));
  const mapping = guessMapping(headers, rows);
  return { headerRow: h, headers, rows, mapping, products: buildProducts(headers, rows, mapping, opts) };
}

/** Delimited text (CSV, TSV, semicolon) without a spreadsheet library. */
export function parseDelimited(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const first = s.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = { ",": (first.match(/,/g) ?? []).length, ";": (first.match(/;/g) ?? []).length, "\t": (first.match(/\t/g) ?? []).length, "|": (first.match(/\|/g) ?? []).length };
  const sep = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === sep) {
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
  return rows;
}
