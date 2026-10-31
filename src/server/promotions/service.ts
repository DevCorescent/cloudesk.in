// Promotions for a project: saved settings, honest checks before they go live,
// rendering into served pages, cart extras and daily stats.
import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatPrice } from "@/lib/store/money";
import { CONFIG_SCHEMAS, promotionInputSchema, renderPromotions, shippingGoalHtml, STORE_ONLY, type CartUpsellConfig, type Promotion, type PromotionInput, type ShippingGoalConfig } from "@/lib/promotions/model";
import { esc } from "@/lib/site/html";
import { ApiError, notFound } from "../http/errors";

type Row = typeof schema.promotions.$inferSelect;
const view = (r: Row): Promotion => ({ id: r.id, kind: r.kind as Promotion["kind"], name: r.name, enabled: r.enabled, config: r.config as Record<string, unknown>, startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null });

/** Short cache for served pages, cleared on every change. */
const cache = new Map<string, { at: number; promos: Promotion[] }>();
const TTL = 15_000;

export async function livePromotions(projectId: string): Promise<Promotion[]> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL) return hit.promos;
  const rows = await db.select().from(schema.promotions).where(and(eq(schema.promotions.projectId, projectId), eq(schema.promotions.enabled, true))).orderBy(asc(schema.promotions.createdAt));
  const promos = rows.map(view);
  cache.set(projectId, { at: Date.now(), promos });
  return promos;
}

export async function listPromotions(projectId: string) {
  const rows = await db.select().from(schema.promotions).where(eq(schema.promotions.projectId, projectId)).orderBy(asc(schema.promotions.createdAt));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const stats = rows.length
    ? await db
        .select({ id: schema.promotionStats.promotionId, views: sql<number>`sum(${schema.promotionStats.views})::int`, clicks: sql<number>`sum(${schema.promotionStats.clicks})::int`, submits: sql<number>`sum(${schema.promotionStats.submits})::int` })
        .from(schema.promotionStats)
        .innerJoin(schema.promotions, eq(schema.promotions.id, schema.promotionStats.promotionId))
        .where(and(eq(schema.promotions.projectId, projectId), gte(schema.promotionStats.day, since)))
        .groupBy(schema.promotionStats.promotionId)
    : [];
  const by = new Map(stats.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...view(r), stats: { views: by.get(r.id)?.views ?? 0, clicks: by.get(r.id)?.clicks ?? 0, submits: by.get(r.id)?.submits ?? 0 } }));
}

/** The lowest "free over" amount among the store's shipping rates, if any. */
export async function freeDeliveryThreshold(projectId: string) {
  const [r] = await db
    .select({ min: sql<number | null>`min(${schema.storeShippingRates.freeOver})::int` })
    .from(schema.storeShippingRates)
    .where(and(eq(schema.storeShippingRates.projectId, projectId), eq(schema.storeShippingRates.kind, "free_over"), isNotNull(schema.storeShippingRates.freeOver)));
  return r?.min ?? null;
}

async function hasStore(projectId: string) {
  const [s] = await db.select({ id: schema.stores.projectId }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  return !!s;
}

/** Checks a promotion against the real store before saving: no invented codes, thresholds or targets. */
async function check(projectId: string, input: PromotionInput, id?: string) {
  const store = await hasStore(projectId);
  if (STORE_ONLY.includes(input.kind) && !store) throw new ApiError("validation_failed", "This promotion needs an online store. Set one up first.");
  const config = CONFIG_SCHEMAS[input.kind].parse(input.config) as Record<string, unknown>;
  // Drafts may hold any code; switching on requires it to work at checkout.
  if (input.kind === "popup" && config.code && store && input.enabled) {
    const [d] = await db.select({ active: schema.storeDiscounts.active, endsAt: schema.storeDiscounts.endsAt }).from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`upper(${schema.storeDiscounts.code}) = ${String(config.code)}`));
    if (!d) throw new ApiError("validation_failed", `There's no discount code "${config.code}" in your store. Create it under Store → Discounts first, so it works at checkout.`, { "config.code": ["Not found in your store's discounts"] });
    if (!d.active || (d.endsAt && d.endsAt.getTime() < Date.now())) throw new ApiError("validation_failed", `The discount code "${config.code}" isn't active, so shoppers couldn't use it.`, { "config.code": ["Inactive or expired"] });
  }
  if (input.kind === "shipping_goal" && !(await freeDeliveryThreshold(projectId))) throw new ApiError("validation_failed", "Add a free-delivery rate (\"free over\" an amount) under Store → Shipping first — the progress bar uses it, so the promise is real.");
  if (input.kind === "floating" && config.opens) {
    const [p] = await db.select({ kind: schema.promotions.kind }).from(schema.promotions).where(and(eq(schema.promotions.id, String(config.opens)), eq(schema.promotions.projectId, projectId)));
    if (!p || p.kind !== "popup" || config.opens === id) throw new ApiError("validation_failed", "Choose one of this site's pop-ups to open.", { "config.opens": ["Not a pop-up on this site"] });
  }
  return config;
}

export async function savePromotion(projectId: string, raw: unknown, id?: string) {
  const parsed = promotionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", parsed.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  const input = parsed.data;
  const config = await check(projectId, input, id);
  const values = { kind: input.kind, name: input.name, enabled: input.enabled, config, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, updatedAt: new Date() };
  const [row] = id
    ? await db.update(schema.promotions).set(values).where(and(eq(schema.promotions.id, id), eq(schema.promotions.projectId, projectId))).returning()
    : await db.insert(schema.promotions).values({ projectId, ...values }).returning();
  if (!row) throw notFound("Promotion");
  cache.delete(projectId);
  return view(row);
}

export async function deletePromotion(projectId: string, id: string) {
  const rows = await db.delete(schema.promotions).where(and(eq(schema.promotions.id, id), eq(schema.promotions.projectId, projectId))).returning({ id: schema.promotions.id });
  if (!rows.length) throw notFound("Promotion");
  cache.delete(projectId);
}

/** Counts a view, click or sign-up for one of the project's promotions. */
export async function recordPromoStat(projectId: string, promoId: string, event: "view" | "click" | "submit") {
  if (!(await livePromotions(projectId)).some((p) => p.id === promoId)) return;
  const day = new Date().toISOString().slice(0, 10);
  const col = event === "view" ? "views" : event === "click" ? "clicks" : "submits";
  await db
    .insert(schema.promotionStats)
    .values({ promotionId: promoId, day, [col]: 1 })
    .onConflictDoUpdate({ target: [schema.promotionStats.promotionId, schema.promotionStats.day], set: { [col]: sql`${schema.promotionStats[col]} + 1` } });
}

/** Adds the live bars, pop-ups and floating buttons to a served page. */
export async function withPromotions(html: string, projectId: string, base: string, path: string, deploymentId: string, opts: { track: boolean }) {
  if (!html.includes("</body>")) return html;
  const promos = await livePromotions(projectId);
  if (!promos.length) return html;
  const out = renderPromotions(promos, path, {
    base,
    formAction: (promoId) => `/api/v1/sites/${deploymentId}/forms/newsletter?page=${encodeURIComponent(path)}&promo=${promoId}`,
    ping: opts.track ? `${base}/__promo` : "",
  });
  if (!out) return html;
  return html.replace(/<body([^>]*)>/, (m) => `${m}${out.top}`).replace("</body>", `${out.end}</body>`);
}

type UpsellProduct = { id: string; slug: string; title: string; image: string | null; price: number; collectionIds: string[]; variantId: string | null };

/** Free-delivery progress and "complete your order" for the cart page. */
export async function cartExtras(projectId: string, ctx: { subtotal: number; currency: string; inCart: { productId: string }[]; products: UpsellProduct[]; base: string; formBase: string }) {
  const promos = (await livePromotions(projectId)).filter((p) => p.kind === "shipping_goal" || p.kind === "cart_upsell");
  const live = promos.filter((p) => (!p.startsAt || Date.parse(p.startsAt) <= Date.now()) && (!p.endsAt || Date.parse(p.endsAt) > Date.now()));
  let top = "";
  let bottom = "";
  const money = (n: number) => formatPrice(n, ctx.currency);
  const goal = live.find((p) => p.kind === "shipping_goal");
  if (goal) {
    const threshold = await freeDeliveryThreshold(projectId);
    if (threshold) top = shippingGoalHtml(goal.config as ShippingGoalConfig, ctx.subtotal, threshold, money);
  }
  const up = live.find((p) => p.kind === "cart_upsell");
  if (up) {
    const c = up.config as CartUpsellConfig;
    const have = new Set(ctx.inCart.map((l) => l.productId));
    const cols = new Set(ctx.products.filter((p) => have.has(p.id)).flatMap((p) => p.collectionIds));
    const pool = ctx.products.filter((p) => !have.has(p.id));
    const related = pool.filter((p) => p.collectionIds.some((x) => cols.has(x)));
    const pick = (c.source === "related" && related.length ? related : pool).slice(0, c.limit);
    if (pick.length)
      bottom = `<section class="ccp-upsell"><h2>${esc(c.heading)}</h2><ul class="ccp-up-list">${pick
        .map(
          (p) =>
            `<li class="ccp-up-item">${p.image ? `<img src="${esc(p.image)}" alt="">` : "<span></span>"}<div><a href="${esc(`${ctx.base}/product/${p.slug}`)}">${esc(p.title)}</a><div class="muted">${esc(money(p.price))}</div>${
              p.variantId ? `<form method="post" action="${esc(ctx.formBase)}/cart"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="action" value="add"><input type="hidden" name="variant" value="${esc(p.variantId)}"><input type="hidden" name="qty" value="1"><button type="submit">Add</button></form>` : `<a class="muted" href="${esc(`${ctx.base}/product/${p.slug}`)}">Choose options →</a>`
            }</div></li>`,
        )
        .join("")}</ul></section>`;
  }
  return top || bottom ? { top, bottom } : null;
}
