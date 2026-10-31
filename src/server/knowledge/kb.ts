// Knowledge base: what a project's chatbot knows. Built from the published
// site, live products, store policies and details, bookable services, and
// any text or web pages the owner adds. Search is Postgres full-text (English
// stemming) plus trigram matching for typos; when VOYAGE_API_KEY is set,
// semantic embeddings are blended in.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { walkStrings } from "@/lib/site/diagnostics";
import { sectionDef, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { formatMoney } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue } from "../jobs/queue";
import { safeFetchText, validateUrl } from "../net/safe-fetch";
import { readFile } from "../services/files";
import { cfg } from "../platform/config";

export const MAX_SOURCES = 50;
export const MAX_TEXT = 200_000;
const BUILT_IN = ["site", "products", "policies"] as const;

// ─── Chunking ────────────────────────────────────────────────────────────────

/** Splits text on paragraph boundaries into ~`max`-character chunks with a little overlap. */
export function chunkText(text: string, max = 900): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}|(?<=[.!?])\s{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > max) {
      if (cur) out.push(cur);
      cur = "";
      // Long paragraphs split on sentences.
      let buf = "";
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        if ((buf + " " + s).length > max && buf) {
          out.push(buf);
          buf = buf.split(/(?<=[.!?])\s+/).slice(-1)[0] ?? ""; // one sentence of overlap
        }
        buf = buf ? `${buf} ${s}` : s;
      }
      if (buf) out.push(buf.slice(0, max * 2));
      continue;
    }
    if ((cur + "\n\n" + p).length > max && cur) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n")
    .trim();
}

// ─── Embeddings (optional) ───────────────────────────────────────────────────

type Fetch = typeof fetch;
let http: Fetch = (i, init) => fetch(i, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) });
/** Test hook. */
export function setEmbeddingHttp(f: Fetch | null) {
  http = f ?? ((i, init) => fetch(i, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) }));
}
export const embeddingsEnabled = () => !!cfg("VOYAGE_API_KEY");

async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][] | null> {
  if (!embeddingsEnabled() || !texts.length) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const res = await http("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg("VOYAGE_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts.slice(i, i + 128), model: cfg("VOYAGE_MODEL") || "voyage-3.5-lite", input_type: inputType }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}`);
    const j = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    for (const d of j.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
  }
  return out;
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

// ─── Building sources ────────────────────────────────────────────────────────

type Doc = { title: string; url: string | null; text: string };

async function publishedDoc(projectId: string): Promise<SiteDoc | null> {
  const [p] = await db.select({ prod: schema.projects.productionDeploymentId }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (p?.prod) {
    const [d] = await db.select({ artifact: schema.deployments.artifact }).from(schema.deployments).where(eq(schema.deployments.id, p.prod));
    const raw = (d?.artifact as Record<string, string> | null)?.["/__doc"];
    if (raw) {
      const r = siteDocSchema.safeParse(JSON.parse(raw));
      if (r.success) return r.data;
    }
  }
  // Nothing published yet: use the working copy so the owner can try the bot.
  const f = await readFile(projectId, "site/site.json").catch(() => null);
  const r = f ? siteDocSchema.safeParse(JSON.parse(f.content)) : null;
  return r?.success ? r.data : null;
}

async function siteDocs(projectId: string): Promise<Doc[]> {
  const doc = await publishedDoc(projectId);
  if (!doc) return [];
  return doc.pages
    .filter((p) => !p.membersOnly)
    .map((page) => {
      const parts: string[] = [page.title, page.description];
      for (const s of page.sections) {
        const def = sectionDef(s.type);
        if (!def || ["navbar", "footer"].includes(s.type)) continue;
        const texts: string[] = [];
        walkStrings(s.props, def.fields, (_f, v) => {
          if (typeof v === "string" && v.trim() && !/^\[.*\]$/.test(v.trim())) texts.push(v.trim());
        });
        if (texts.length) parts.push(texts.join("\n"));
      }
      return { title: page.title, url: page.path, text: parts.filter(Boolean).join("\n\n") };
    })
    .filter((d) => d.text.length > 20);
}

async function productDocs(projectId: string): Promise<Doc[]> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!store) return [];
  const products = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, projectId), eq(schema.storeProducts.status, "active"), eq(schema.storeProducts.isSample, false)));
  if (!products.length) return [];
  const variants = await db.select().from(schema.storeVariants).where(inArray(schema.storeVariants.productId, products.map((p) => p.id))).orderBy(asc(schema.storeVariants.position));
  return products.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    const lines = vs.map((v) => `${v.title === "Default" ? "Price" : v.title}: ${formatMoney(v.price, store.currency)}${v.trackInventory && v.stock <= 0 ? " (sold out)" : ""}`);
    return { title: p.title, url: `/product/${p.slug}`, text: [p.title, p.description, ...lines, p.subscriptionInterval ? `Available as a subscription (every ${p.subscriptionIntervalCount} ${p.subscriptionInterval}).` : "", p.tags.length ? `Tags: ${p.tags.join(", ")}` : ""].filter(Boolean).join("\n") };
  });
}

async function policyDocs(projectId: string): Promise<Doc[]> {
  const out: Doc[] = [];
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (store) {
    const pol = (store.policies ?? {}) as Record<string, string>;
    const names: Record<string, string> = { refund: "Refund policy", shipping: "Shipping policy", privacy: "Privacy policy", terms: "Terms of service" };
    for (const [k, v] of Object.entries(pol)) if (v && !v.includes("[Edit this policy]")) out.push({ title: names[k] ?? k, url: `/policies/${k}`, text: v });
    const addr = store.address as { line1?: string; city?: string; region?: string; postalCode?: string } | null;
    out.push({ title: "Contact details", url: null, text: [`${store.name}`, store.email ? `Email: ${store.email}` : "", store.phone ? `Phone: ${store.phone}` : "", addr?.line1 ? `Address: ${[addr.line1, addr.city, addr.region, addr.postalCode].filter(Boolean).join(", ")}` : ""].filter(Boolean).join("\n") });
    const rates = await db.select().from(schema.storeShippingRates).where(eq(schema.storeShippingRates.projectId, projectId));
    if (rates.length) out.push({ title: "Delivery options", url: null, text: rates.map((r) => `${r.name}: ${r.amount ? formatMoney(r.amount, store.currency) : "free"}${r.freeOver ? `, free over ${formatMoney(r.freeOver, store.currency)}` : ""}${r.eta ? ` (${r.eta})` : ""}${r.codAllowed ? ", cash on delivery available" : ""}`).join("\n") });
    const services = await db.select().from(schema.bookingServices).where(and(eq(schema.bookingServices.projectId, projectId), eq(schema.bookingServices.active, true)));
    if (services.length) out.push({ title: "Bookable services", url: "/book", text: services.map((s) => `${s.name}: ${s.durationMin} minutes${s.price ? `, ${formatMoney(s.price, store.currency)}` : ""}${s.description ? `. ${s.description}` : ""}`).join("\n") });
  }
  return out;
}

async function docsFor(source: typeof schema.kbSources.$inferSelect): Promise<Doc[]> {
  switch (source.kind) {
    case "site":
      return siteDocs(source.projectId);
    case "products":
      return productDocs(source.projectId);
    case "policies":
      return policyDocs(source.projectId);
    case "text":
      return [{ title: source.title, url: null, text: source.content ?? "" }];
    case "url": {
      const r = await safeFetchText(source.url!, { maxBytes: 2_000_000 });
      const text = /html/i.test(r.contentType) ? htmlToText(r.text) : r.text;
      return [{ title: source.title, url: source.url, text: text.slice(0, MAX_TEXT) }];
    }
  }
  return [];
}

export async function ensureBuiltInSources(projectId: string) {
  const existing = await db.select({ kind: schema.kbSources.kind }).from(schema.kbSources).where(eq(schema.kbSources.projectId, projectId));
  const titles = { site: "Website pages", products: "Products", policies: "Store details and policies" };
  const missing = BUILT_IN.filter((k) => !existing.some((e) => e.kind === k));
  if (missing.length) await db.insert(schema.kbSources).values(missing.map((k) => ({ projectId, kind: k, title: titles[k] })));
}

/** Rebuilds one source's chunks. */
export async function indexSource(sourceId: string) {
  const [source] = await db.select().from(schema.kbSources).where(eq(schema.kbSources.id, sourceId));
  if (!source) return;
  try {
    const docs = await docsFor(source);
    const rows = docs.flatMap((d) => chunkText(d.text).map((text, i) => ({ sourceId: source.id, projectId: source.projectId, title: d.title, url: d.url, text, position: i })));
    const vectors = await embed(rows.map((r) => `${r.title}\n${r.text}`), "document").catch(() => null);
    await db.transaction(async (tx) => {
      await tx.delete(schema.kbChunks).where(eq(schema.kbChunks.sourceId, source.id));
      for (let i = 0; i < rows.length; i += 200) await tx.insert(schema.kbChunks).values(rows.slice(i, i + 200).map((r, j) => ({ ...r, embedding: vectors?.[i + j] ?? null })));
      await tx.update(schema.kbSources).set({ status: "ready", error: null, chunkCount: rows.length, refreshedAt: new Date() }).where(eq(schema.kbSources.id, source.id));
    });
  } catch (e) {
    await db.update(schema.kbSources).set({ status: "error", error: (e as Error).message.slice(0, 300) }).where(eq(schema.kbSources.id, source.id));
  }
}

defineJob<{ projectId: string }>("kb.reindex", async ({ projectId }) => reindexProject(projectId), { timeoutMs: 120_000 });
defineJob<{ sourceId: string }>("kb.index_source", async ({ sourceId }) => indexSource(sourceId), { timeoutMs: 120_000 });

export async function reindexProject(projectId: string) {
  await ensureBuiltInSources(projectId);
  const sources = await db.select().from(schema.kbSources).where(eq(schema.kbSources.projectId, projectId));
  for (const s of sources) await indexSource(s.id);
  return { sources: sources.length };
}

/** Queues a rebuild (e.g. after publishing); at most one per project per minute. */
export async function scheduleReindex(projectId: string) {
  await enqueue("kb.reindex", { projectId }, { projectId, dedupeKey: `kb:${projectId}:${Math.floor(Date.now() / 60_000)}` }).catch(() => null);
}

export async function listSources(projectId: string) {
  return db
    .select({ id: schema.kbSources.id, kind: schema.kbSources.kind, title: schema.kbSources.title, url: schema.kbSources.url, status: schema.kbSources.status, error: schema.kbSources.error, chunkCount: schema.kbSources.chunkCount, refreshedAt: schema.kbSources.refreshedAt, createdAt: schema.kbSources.createdAt })
    .from(schema.kbSources)
    .where(eq(schema.kbSources.projectId, projectId))
    .orderBy(asc(schema.kbSources.createdAt));
}

export async function addSource(projectId: string, input: { kind: "text" | "url"; title: string; content?: string; url?: string }) {
  const n = await db.select({ id: schema.kbSources.id }).from(schema.kbSources).where(eq(schema.kbSources.projectId, projectId));
  if (n.length >= MAX_SOURCES) throw new ApiError("conflict", `A chatbot can have up to ${MAX_SOURCES} sources`);
  if (input.kind === "url") validateUrl(input.url ?? "");
  if (input.kind === "text" && !(input.content ?? "").trim()) throw new ApiError("validation_failed", "Add some text", { content: ["Required"] });
  const [s] = await db.insert(schema.kbSources).values({ projectId, kind: input.kind, title: input.title.trim().slice(0, 120) || (input.url ?? "Notes"), url: input.kind === "url" ? input.url : null, content: input.kind === "text" ? input.content!.slice(0, MAX_TEXT) : null }).returning();
  await enqueue("kb.index_source", { sourceId: s.id }, { projectId, maxAttempts: 3 });
  return s;
}

export async function deleteSource(projectId: string, id: string) {
  const [s] = await db.select().from(schema.kbSources).where(and(eq(schema.kbSources.id, id), eq(schema.kbSources.projectId, projectId)));
  if (!s) throw notFound("Source");
  if ((BUILT_IN as readonly string[]).includes(s.kind)) throw new ApiError("conflict", "Built-in sources update themselves and can't be removed");
  await db.delete(schema.kbSources).where(eq(schema.kbSources.id, s.id));
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type Passage = { id: string; title: string; url: string | null; text: string; score: number };

export async function search(projectId: string, query: string, limit = 6): Promise<Passage[]> {
  const q = query.trim().slice(0, 500);
  if (!q) return [];
  // Natural questions rarely contain every word of the answer, so terms are OR-ed and
  // ranked by coverage; each longer word is also matched by trigram similarity for typos.
  const words = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 12);
  const tsq = sql`nullif(replace(websearch_to_tsquery('english', ${q})::text, ' & ', ' | '), '')::tsquery`;
  const fuzzy = words.length ? sql.join(words.map((w) => sql`${w} <% (title || ' ' || text)`), sql` or `) : sql`false`;
  const sim = words.length ? sql`((${sql.join(words.map((w) => sql`word_similarity(${w}, title || ' ' || text)`), sql` + `)}) / ${words.length})` : sql`0`;
  const r = await db.execute(sql`
    select * from (select id, title, url, text,
      coalesce(ts_rank_cd(tsv, ${tsq}), 0) + (case when tsv @@ websearch_to_tsquery('english', ${q}) then 0.5 else 0 end) as rank, ${sim} as sim
    from kb_chunks
    where project_id = ${projectId} and (coalesce(tsv @@ ${tsq}, false) or ${fuzzy})) m
    order by rank * 2 + sim desc
    limit 40`);
  const lexical = (r.rows as { id: string; title: string; url: string | null; text: string; rank: number; sim: number }[]).map((x) => ({ id: x.id, title: x.title, url: x.url, text: x.text, score: Math.min(1, Number(x.rank) * 2) * 0.7 + Number(x.sim) * 0.3 }));
  const qv = await embed([q], "query").catch(() => null);
  if (!qv) return lexical.filter((p) => p.score > 0.05).slice(0, limit);
  // Blend in semantic similarity over the project's chunks.
  const all = await db.select({ id: schema.kbChunks.id, title: schema.kbChunks.title, url: schema.kbChunks.url, text: schema.kbChunks.text, embedding: schema.kbChunks.embedding }).from(schema.kbChunks).where(and(eq(schema.kbChunks.projectId, projectId), sql`${schema.kbChunks.embedding} is not null`)).limit(5000);
  const scored = new Map<string, Passage>();
  for (const p of lexical) scored.set(p.id, { ...p, score: p.score * 0.5 });
  for (const c of all) {
    const cos = cosine(qv[0], c.embedding as number[]);
    const prev = scored.get(c.id);
    if (prev) prev.score += cos * 0.5;
    else if (cos > 0.3) scored.set(c.id, { id: c.id, title: c.title, url: c.url, text: c.text, score: cos * 0.5 });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).filter((p) => p.score > 0.08).slice(0, limit);
}
