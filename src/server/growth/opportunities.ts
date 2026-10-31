import { createHash } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseSiteDoc, sectionDef, SITE_DOC_PATH, variantOf, type Page, type Section, type SiteDoc } from "@/lib/site/model";
import { reviewPage } from "@/lib/site/review";
import { formatMoney } from "@/lib/store/money";
import { readFile } from "../services/files";
import { pageViews } from "../services/stats";

// Opportunities are recomputed from live data on every request; nothing here
// is stored except what the owner dismisses. Every action needs approval.

export type Metric = "submit" | "cart_add" | "checkout" | "order";

export type TestChange = { variant?: string; props?: Record<string, unknown> };

export type Opportunity = {
  key: string;
  kind: "test" | "store" | "design";
  title: string;
  why: string;
  evidence: string[];
  impact: "high" | "medium" | "low";
  page?: string;
  test?: { path: string; sectionId: string; sectionLabel: string; change: TestChange; before: TestChange; metric: Metric; hypothesis: string; aiWritable: boolean };
  action?:
    | { type: "feature_product" | "unfeature_product"; productId: string; label: string }
    | { type: "set_free_shipping"; rateId: string; amount: number; label: string }
    | { type: "add_product_grid"; pageId: string; label: string }
    | { type: "set_banner"; pageId: string; text: string; label: string }
    | { type: "link"; href: string; label: string };
};

const key = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);

// Button wording that commonly outperforms generic labels, grouped by intent.
const CTA_ALTERNATIVES: [RegExp, string[]][] = [
  [/shop|buy|collection|store|browse/i, ["Shop bestsellers", "Shop the collection", "Shop now"]],
  [/table|reserv/i, ["Book your table", "Reserve your spot", "Book now"]],
  [/book|appointment|slot|session|visit/i, ["Book your appointment", "See open times", "Book now"]],
  [/contact|touch|talk|enquir|quote|call/i, ["Get a free quote", "Talk to us today", "Get in touch"]],
  [/start|try|sign|join|demo|trial/i, ["Start free today", "Get started free", "Book a demo"]],
  [/menu/i, ["See today's menu", "View the menu"]],
  [/learn|story|more|discover/i, ["See how it works", "Discover more"]],
];

export function alternativeLabel(current: string): string | null {
  const c = current.trim();
  if (!c) return null;
  for (const [re, alts] of CTA_ALTERNATIVES) if (re.test(c)) return alts.find((a) => a.toLowerCase() !== c.toLowerCase()) ?? null;
  return null;
}

/** Layout to try against the current one, preferring known strong pairings. */
function alternativeVariant(s: Section): string | null {
  const def = sectionDef(s.type);
  const current = variantOf(s);
  const options = (def?.variants ?? []).map((v) => v.value).filter((v) => v !== current && v !== "default");
  const prefer: Record<string, string[]> = { hero: ["split", "overlay", "centered"], productGrid: ["grid", "editorial", "carousel"], features: ["cards", "bento", "icons"], testimonials: ["cards", "spotlight"], pricing: ["cards"], cta: ["card", "band"] };
  return (prefer[s.type] ?? []).find((v) => options.includes(v)) ?? options[0] ?? null;
}

const usesStore = (p: Page) => p.sections.some((s) => s.type === "productGrid" || s.type === "collectionList" || s.type === "products");

export function metricFor(page: Page, storeExists: boolean): Metric {
  // Add-to-carts only where the page sells products; otherwise its forms (bookings, enquiries) are the goal.
  if (storeExists && usesStore(page)) return "cart_add";
  return "submit";
}

export const METRIC_LABEL: Record<Metric, string> = { submit: "form submissions", cart_add: "add-to-carts", checkout: "checkouts started", order: "orders" };

const label = (s: Section) => sectionDef(s.type)?.label ?? s.type;

/** Candidate A/B tests for one page, best first. */
export function testsForPage(page: Page, metric: Metric): NonNullable<Opportunity["test"]>[] {
  const out: NonNullable<Opportunity["test"]>[] = [];
  const goal = METRIC_LABEL[metric];
  for (const s of page.sections) {
    if (s.ab?.running) continue;
    const p = s.props;
    if (s.type === "hero") {
      const alt = alternativeLabel(String(p.primaryLabel ?? ""));
      if (alt) out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { props: { primaryLabel: alt } }, before: { props: { primaryLabel: p.primaryLabel } }, metric, hypothesis: `A more specific main button (“${alt}” instead of “${p.primaryLabel}”) gets more ${goal}.`, aiWritable: false });
      out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { props: { heading: p.heading, subheading: p.subheading } }, before: { props: { heading: p.heading, subheading: p.subheading } }, metric, hypothesis: `A sharper headline that states the benefit gets more ${goal}.`, aiWritable: true });
      const v = alternativeVariant(s);
      if (v) out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { variant: v }, before: { variant: variantOf(s) }, metric, hypothesis: `The “${sectionDef(s.type)?.variants?.find((x) => x.value === v)?.label ?? v}” hero layout gets more ${goal} than “${variantOf(s)}”.`, aiWritable: false });
    }
    if (s.type === "cta") {
      const alt = alternativeLabel(String(p.buttonLabel ?? ""));
      if (alt) out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { props: { buttonLabel: alt } }, before: { props: { buttonLabel: p.buttonLabel } }, metric, hypothesis: `“${alt}” as the closing button gets more ${goal} than “${p.buttonLabel}”.`, aiWritable: false });
    }
    if (s.type === "productGrid") {
      const v = alternativeVariant(s);
      if (v) out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { variant: v }, before: { variant: variantOf(s) }, metric, hypothesis: `Showing products as “${v}” instead of “${variantOf(s)}” gets more add-to-carts.`, aiWritable: false });
    }
    if (s.type === "features" || s.type === "testimonials" || s.type === "pricing") {
      const v = alternativeVariant(s);
      if (v) out.push({ path: page.path, sectionId: s.id, sectionLabel: label(s), change: { variant: v }, before: { variant: variantOf(s) }, metric, hypothesis: `The ${label(s).toLowerCase()} section as “${v}” keeps visitors moving toward ${goal}.`, aiWritable: false });
    }
  }
  return out;
}

/** “Main button: “Shop bestsellers” vs “Shop now” (Home)” */
export function describeTest(t: NonNullable<Opportunity["test"]>, pageTitle: string) {
  const b = t.change.props ?? {};
  const a = t.before.props ?? {};
  if ("primaryLabel" in b) return `Main button on ${pageTitle}: “${b.primaryLabel}” vs “${a.primaryLabel}”`;
  if ("buttonLabel" in b) return `Closing button on ${pageTitle}: “${b.buttonLabel}” vs “${a.buttonLabel}”`;
  if ("heading" in b) return `Headline on ${pageTitle}: “${b.heading}” vs “${a.heading}”`;
  if (t.change.variant) return `${t.sectionLabel} layout on ${pageTitle}: ${t.change.variant} vs ${t.before.variant}`;
  return `${t.sectionLabel} on ${pageTitle}`;
}

export async function loadDoc(projectId: string): Promise<{ doc: SiteDoc; revision: number } | null> {
  try {
    const f = await readFile(projectId, SITE_DOC_PATH);
    const parsed = parseSiteDoc(f.content);
    return parsed.ok ? { doc: parsed.doc, revision: f.revision } : null;
  } catch {
    return null;
  }
}

export async function findOpportunities(projectId: string, opts: { aiAvailable: boolean } = { aiAvailable: false }): Promise<Opportunity[]> {
  const loaded = await loadDoc(projectId);
  if (!loaded) return [];
  const { doc } = loaded;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const [settings] = await db.select().from(schema.growthSettings).where(eq(schema.growthSettings.projectId, projectId));
  const dismissed = new Set(settings?.dismissed ?? []);
  const running = await db.select({ path: schema.growthExperiments.path, opportunityKey: schema.growthExperiments.opportunityKey }).from(schema.growthExperiments).where(and(eq(schema.growthExperiments.projectId, projectId), eq(schema.growthExperiments.status, "running")));
  const tried = await db.select({ k: schema.growthExperiments.opportunityKey }).from(schema.growthExperiments).where(eq(schema.growthExperiments.projectId, projectId));
  const triedKeys = new Set(tried.map((t) => t.k));
  const busyPaths = new Set(running.map((r) => r.path));
  const views = await pageViews(projectId, 14);
  const out: Opportunity[] = [];

  // ─── Tests, on the busiest pages first ───
  const pages = doc.pages.filter((p) => (p.kind ?? "page") === "page" && !p.translationOf);
  pages.sort((a, b) => (views.get(b.path) ?? 0) - (views.get(a.path) ?? 0) || (a.path === "/" ? -1 : 1));
  for (const page of pages.slice(0, 5)) {
    if (busyPaths.has(page.path) || page.sections.some((s) => s.ab?.running)) continue;
    const v = views.get(page.path) ?? 0;
    const metric = metricFor(page, !!store);
    const perDay = v / 14;
    const days = perDay > 0 ? Math.ceil(200 / perDay) : null;
    let n = 0;
    for (const t of testsForPage(page, metric)) {
      if (t.aiWritable && !opts.aiAvailable) continue;
      const k = key("test", page.path, t.sectionId, JSON.stringify(t.change), t.aiWritable ? "ai" : "");
      if (dismissed.has(k) || triedKeys.has(k)) continue;
      out.push({
        key: k,
        kind: "test",
        page: page.path,
        title: t.aiWritable ? `Test an AI-written headline on ${page.title}` : describeTest(t, page.title),
        why: t.hypothesis,
        evidence: [
          v ? `${v.toLocaleString()} visits to ${page.path} in the last 14 days` : `No visits recorded on ${page.path} yet — publish the site and share it to get results`,
          days ? `About ${days} day${days === 1 ? "" : "s"} to reach the 100-visits-per-group minimum; small differences take longer` : "Results need at least 100 visits per group",
        ],
        impact: v >= 500 ? "high" : v >= 100 ? "medium" : "low",
        test: t,
      });
      if (++n >= 2) break;
    }
  }

  // ─── Store-aware fixes ───
  if (store) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const products = await db.select({ id: schema.storeProducts.id, title: schema.storeProducts.title, featured: schema.storeProducts.featured, images: schema.storeProducts.images, status: schema.storeProducts.status, isSample: schema.storeProducts.isSample }).from(schema.storeProducts).where(eq(schema.storeProducts.projectId, projectId));
    const variants = await db.select({ productId: schema.storeVariants.productId, stock: schema.storeVariants.stock, track: schema.storeVariants.trackInventory }).from(schema.storeVariants).where(eq(schema.storeVariants.projectId, projectId));
    const sales = await db.execute<{ product_id: string; units: number; revenue: number }>(sql`
      select i.product_id, sum(i.quantity)::int as units, sum(i.total)::bigint as revenue from store_order_items i join store_orders o on o.id = i.order_id
      where o.project_id = ${projectId} and o.cancelled_at is null and o.created_at >= ${since} and i.product_id is not null group by i.product_id order by units desc`);
    const [agg] = await db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${schema.storeOrders.subtotal}),0)::bigint` }).from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt), gte(schema.storeOrders.createdAt, since)));
    const active = products.filter((p) => p.status === "active" && !p.isSample);
    const soldOut = (id: string) => {
      const vs = variants.filter((v) => v.productId === id);
      return vs.length > 0 && vs.every((v) => v.track && v.stock <= 0);
    };
    for (const p of active.filter((x) => x.featured && soldOut(x.id))) {
      const k = key("unfeature", p.id);
      if (!dismissed.has(k)) out.push({ key: k, kind: "store", title: `“${p.title}” is sold out but featured`, why: "Featured products appear first in your product grids. A sold-out product there wastes your best spot.", evidence: ["Every option is out of stock"], impact: "high", action: { type: "unfeature_product", productId: p.id, label: "Stop featuring it" } });
    }
    const top = sales.rows[0];
    const topProduct = top && active.find((p) => p.id === top.product_id);
    if (topProduct && !topProduct.featured && !soldOut(topProduct.id) && Number(top.units) >= 3) {
      const k = key("feature", topProduct.id);
      if (!dismissed.has(k)) out.push({ key: k, kind: "store", title: `Feature your bestseller, “${topProduct.title}”`, why: "Your best seller isn't featured, so it isn't shown first in your product grids.", evidence: [`${top.units} sold in the last 30 days — your top product`], impact: "high", action: { type: "feature_product", productId: topProduct.id, label: "Feature it" } });
    }
    for (const r of sales.rows.slice(0, 5)) {
      const vs = variants.filter((v) => v.productId === r.product_id && v.track);
      const stock = vs.reduce((a, v) => a + Math.max(0, v.stock), 0);
      const perDay = Number(r.units) / 30;
      const p = active.find((x) => x.id === r.product_id);
      if (p && vs.length && perDay > 0 && stock > 0 && stock / perDay < 10) {
        const k = key("restock", p.id, String(Math.floor(stock / perDay)));
        if (!dismissed.has(k)) out.push({ key: k, kind: "store", title: `Restock “${p.title}” soon`, why: "At its current sales rate it will sell out in under 10 days.", evidence: [`${stock} left · selling about ${perDay.toFixed(1)} a day`], impact: "medium", action: { type: "link", href: "inventory", label: "Open inventory" } });
      }
    }
    const noImage = active.filter((p) => !(p.images as string[]).length);
    if (noImage.length) {
      const k = key("images", String(noImage.length));
      if (!dismissed.has(k)) out.push({ key: k, kind: "store", title: `${noImage.length} product${noImage.length === 1 ? " has" : "s have"} no photo`, why: "Products without photos rarely sell and make the whole shop look unfinished.", evidence: noImage.slice(0, 3).map((p) => p.title), impact: "medium", action: { type: "link", href: "products", label: "Add photos" } });
    }
    if (agg && agg.n >= 5) {
      const aov = Math.round(Number(agg.total) / agg.n);
      const rates = await db.select().from(schema.storeShippingRates).where(and(eq(schema.storeShippingRates.projectId, projectId), eq(schema.storeShippingRates.kind, "free_over")));
      for (const r of rates) {
        if (r.freeOver && r.freeOver > aov * 1.4) {
          const target = Math.ceil((aov * 1.15) / 10000) * 10000;
          const k = key("freeship", r.id, String(target));
          if (!dismissed.has(k))
            out.push({
              key: k,
              kind: "store",
              title: `Lower free shipping to ${formatMoney(target, store.currency)}`,
              why: "A free-shipping level just above a typical order nudges customers to add one more item. Yours is far above most orders, so few people try to reach it.",
              evidence: [`Average order (before shipping): ${formatMoney(aov, store.currency)} from ${agg.n} orders`, `Free shipping now starts at ${formatMoney(r.freeOver, store.currency)} (“${r.name}”)`],
              impact: "medium",
              action: { type: "set_free_shipping", rateId: r.id, amount: target, label: `Set to ${formatMoney(target, store.currency)}` },
            });
        }
        const home = doc.pages.find((p) => p.path === "/");
        const banner = home?.sections.find((s) => s.type === "banner");
        if (home && r.freeOver && !banner) {
          const text = `Free shipping on orders over ${formatMoney(r.freeOver, store.currency).replace(/\.00$/, "")}`;
          const k = key("banner", text);
          if (!dismissed.has(k)) out.push({ key: k, kind: "design", title: "Announce free shipping at the top of your site", why: "Free shipping is one of the strongest reasons to buy; most visitors won't find it in your policies.", evidence: [`Free shipping starts at ${formatMoney(r.freeOver, store.currency)}`], impact: "low", action: { type: "set_banner", pageId: home.id, text, label: "Add announcement bar" } });
        }
      }
    }
    const home = doc.pages.find((p) => p.path === "/");
    if (home && active.length && !home.sections.some((s) => s.type === "productGrid" || s.type === "products")) {
      const k = key("grid", home.id);
      if (!dismissed.has(k)) out.push({ key: k, kind: "design", title: "Show products on your home page", why: "Your store has products, but the home page doesn't show any. Most shoppers start there.", evidence: [`${active.length} active product${active.length === 1 ? "" : "s"}`], impact: "high", action: { type: "add_product_grid", pageId: home.id, label: "Add a bestsellers grid" } });
    }
  }

  // ─── Design review ───
  for (const page of pages.slice(0, 3)) {
    const high = reviewPage(doc, page).filter((f) => f.severity === "high");
    if (!high.length) continue;
    const k = key("review", page.path, high.map((f) => f.id).join(","));
    if (!dismissed.has(k)) out.push({ key: k, kind: "design", page: page.path, title: `${high.length} design fix${high.length === 1 ? "" : "es"} on ${page.title}`, why: high[0].detail, evidence: high.slice(0, 3).map((f) => f.title), impact: "medium", action: { type: "link", href: "builder", label: "Review in builder" } });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.impact] - rank[b.impact]);
}
