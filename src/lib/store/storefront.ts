// Storefront HTML: product cards, grids and the full shop, product, cart,
// checkout, order and policy pages. Pure functions over plain data; all
// output is escaped. Pages are rendered per request with live data and work
// without JavaScript (forms + redirects).
import { PROMO_CSS } from "../promotions/model";
import { esc, safeImageUrl, safeUrl } from "../site/html";
import { iconSvg } from "../site/icons";
import { formatPrice, minorDigits } from "./money";
import { COUNTRIES, INDIAN_STATES } from "./shipping";

export type SfVariant = { id: string; title: string; price: number; compareAt: number | null; available: number; options: Record<string, string>; sku?: string };
export type SfProduct = {
  id: string;
  slug: string;
  title: string;
  description: string;
  images: string[];
  vendor: string;
  tags: string[];
  featured: boolean;
  createdAt: string;
  collectionIds: string[];
  options: { name: string; values: string[] }[];
  variants: SfVariant[];
  rating?: { avg: number; count: number };
  /** Template sample: shown, but not buyable or listed in feeds. */
  isSample?: boolean;
};
export type SfCollection = { id: string; slug: string; title: string; description: string; image: string; productCount: number };
export type Catalog = { currency: string; products: SfProduct[]; collections: SfCollection[]; /** Codes shoppers can choose, base first. */ currencies?: string[] };

/** A small, script-free currency chooser for store pages. */
export function currencyBar(c: { codes: string[]; current: string; formBase: string; base: string; returnTo: string }) {
  return `<div class="wrap sf-cur"><form method="post" action="${esc(c.formBase)}/cart"><input type="hidden" name="action" value="currency"><input type="hidden" name="_base" value="${esc(c.base)}"><input type="hidden" name="return" value="${esc(c.returnTo)}"><label>Prices in <select name="currency" aria-label="Currency">${c.codes.map((x) => `<option value="${esc(x)}"${x === c.current ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label><button class="btn btn-secondary" type="submit">Change</button></form></div>`;
}

export const STORE_FORMS = (projectId: string) => `/api/v1/store/${projectId}`;

const href = (base: string, path: string) => `${base}${path}`;
const minPrice = (p: SfProduct) => Math.min(...p.variants.map((v) => v.price));
const maxPrice = (p: SfProduct) => Math.max(...p.variants.map((v) => v.price));
const inStock = (p: SfProduct) => p.variants.some((v) => v.available > 0);
const compareFor = (p: SfProduct) => {
  const v = p.variants.find((x) => x.price === minPrice(p));
  return v?.compareAt && v.compareAt > v.price ? v.compareAt : null;
};

function stars(avg: number) {
  const full = Math.round(avg);
  return `<span class="stars" aria-label="${avg.toFixed(1)} out of 5">${"★".repeat(full)}<span class="stars-off">${"★".repeat(5 - full)}</span></span>`;
}

export function priceHtml(p: SfProduct, currency: string) {
  const lo = minPrice(p);
  const hi = maxPrice(p);
  const cmp = compareFor(p);
  const main = lo === hi ? formatPrice(lo, currency) : `From ${formatPrice(lo, currency)}`;
  return `<span class="price-now">${esc(main)}</span>${cmp ? `<s class="price-was">${esc(formatPrice(cmp, currency))}</s>` : ""}`;
}

export function productCard(p: SfProduct, base: string, currency: string, size: "md" | "lg" = "md") {
  const [a, b] = p.images.map(safeImageUrl).filter(Boolean);
  const cmp = compareFor(p);
  const badge = !inStock(p) ? `<span class="pc-badge pc-badge-muted">Sold out</span>` : cmp ? `<span class="pc-badge">Save ${Math.round(((cmp - minPrice(p)) / cmp) * 100)}%</span>` : p.featured ? `<span class="pc-badge pc-badge-soft">Bestseller</span>` : "";
  return `<article class="pc pc-${size}"><a href="${esc(href(base, `/product/${p.slug}`))}" class="pc-link">
<div class="pc-media">${a ? `<img src="${esc(a)}" alt="${esc(p.title)}" loading="lazy" decoding="async">` : `<div class="pc-ph"></div>`}${b ? `<img class="pc-alt" src="${esc(b)}" alt="" loading="lazy" decoding="async">` : ""}${badge}</div>
<div class="pc-body">${p.vendor ? `<p class="pc-vendor">${esc(p.vendor)}</p>` : ""}<h3 class="pc-title">${esc(p.title)}</h3>
<p class="pc-price">${priceHtml(p, currency)}</p>${p.rating && p.rating.count ? `<p class="pc-rating">${stars(p.rating.avg)} <span class="muted">(${p.rating.count})</span></p>` : ""}</div></a></article>`;
}

export function sortProducts(list: SfProduct[], sort: string) {
  const l = [...list];
  if (sort === "price-asc") l.sort((a, b) => minPrice(a) - minPrice(b));
  else if (sort === "price-desc") l.sort((a, b) => minPrice(b) - minPrice(a));
  else if (sort === "newest") l.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else l.sort((a, b) => Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt));
  return l;
}

/** Product grid section body (used by the builder canvas and live pages). */
export function productGridBody(props: Record<string, unknown>, variant: string, catalog: Catalog | null, base: string, editor: boolean) {
  const heading = String(props.heading ?? "").trim();
  const sub = String(props.subheading ?? "").trim();
  const head = heading || sub ? `<header class="sec-head sf-head">${heading ? `<h2>${esc(heading)}</h2>` : ""}${sub ? `<p class="lead">${esc(sub)}</p>` : ""}</header>` : "";
  const limit = Math.min(Math.max(Number(props.limit) || 8, 1), 24);
  if (!catalog) {
    const ph = Array.from({ length: Math.min(limit, 4) }, (_, i) => `<article class="pc"><div class="pc-media"><div class="pc-ph"></div></div><div class="pc-body"><h3 class="pc-title">Product ${i + 1}</h3><p class="pc-price"><span class="price-now">—</span></p></div></article>`).join("");
    return `<div class="wrap">${head}<div class="pgrid">${ph}</div>${editor ? `<p class="placeholder">Products appear here from your store catalog.</p>` : ""}</div>`;
  }
  const coll = String(props.collection ?? "").trim();
  const c = coll ? catalog.collections.find((x) => x.slug === coll) : null;
  let list = catalog.products.filter((p) => !c || p.collectionIds.includes(c.id));
  list = sortProducts(list, String(props.sort ?? "featured")).slice(0, limit);
  if (!list.length) return `<div class="wrap">${head}${editor ? `<p class="placeholder">No active products${c ? ` in “${esc(c.title)}”` : ""} yet. Add them in Store → Products.</p>` : ""}</div>`;
  const cards = list.map((p, i) => productCard(p, base, catalog.currency, variant === "editorial" && i === 0 ? "lg" : "md")).join("");
  const btn = String(props.buttonLabel ?? "").trim();
  const more = btn ? `<div class="actions sf-more"><a class="btn btn-secondary" href="${esc(href(base, c ? `/shop/${c.slug}` : "/shop"))}">${esc(btn)}</a></div>` : "";
  return `<div class="wrap">${head}<div class="pgrid pgrid-${esc(variant)}">${cards}</div>${more}</div>`;
}

export function collectionListBody(props: Record<string, unknown>, variant: string, catalog: Catalog | null, base: string, editor: boolean) {
  const heading = String(props.heading ?? "").trim();
  const head = heading ? `<header class="sec-head sf-head"><h2>${esc(heading)}</h2></header>` : "";
  const limit = Math.min(Math.max(Number(props.limit) || 6, 1), 12);
  const cols = (catalog?.collections ?? []).filter((c) => c.productCount > 0).slice(0, limit);
  if (!cols.length) return `<div class="wrap">${head}${editor ? `<p class="placeholder">Collections appear here once they contain active products.</p>` : ""}</div>`;
  if (variant === "minimal") return `<div class="wrap">${head}<div class="clist">${cols.map((c) => `<a class="clist-item" href="${esc(href(base, `/shop/${c.slug}`))}"><span>${esc(c.title)}</span><span class="muted">${c.productCount} →</span></a>`).join("")}</div></div>`;
  return `<div class="wrap">${head}<div class="ctiles">${cols
    .map((c) => {
      const img = safeImageUrl(c.image) || safeImageUrl(catalog!.products.find((p) => p.collectionIds.includes(c.id))?.images[0]);
      return `<a class="ctile" href="${esc(href(base, `/shop/${c.slug}`))}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="pc-ph"></div>`}<span class="ctile-label"><strong>${esc(c.title)}</strong><span>${c.productCount} ${c.productCount === 1 ? "product" : "products"}</span></span></a>`;
    })
    .join("")}</div></div>`;
}

// ─── Full pages (main content only; the site shell wraps them) ───────────────

export type ShopQuery = { q: string; sort: string; min: string; max: string; inStock: boolean; page: number };

export function shopPage(catalog: Catalog, base: string, query: ShopQuery, collection: SfCollection | null, storeName: string) {
  const perPage = 24;
  let list = catalog.products.filter((p) => !collection || p.collectionIds.includes(collection.id));
  const q = query.q.trim().toLowerCase();
  if (q) list = list.filter((p) => `${p.title} ${p.vendor} ${p.tags.join(" ")} ${p.description}`.toLowerCase().includes(q));
  const unit = 10 ** minorDigits(catalog.currency);
  const min = Math.round(Number(query.min) * unit) || 0;
  const max = Math.round(Number(query.max) * unit) || 0;
  if (min) list = list.filter((p) => maxPrice(p) >= min);
  if (max) list = list.filter((p) => minPrice(p) <= max);
  if (query.inStock) list = list.filter(inStock);
  list = sortProducts(list, query.sort);
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const page = Math.min(Math.max(1, query.page), pages);
  const shown = list.slice((page - 1) * perPage, page * perPage);
  const title = collection?.title ?? "Shop all";
  const action = href(base, collection ? `/shop/${collection.slug}` : "/shop");
  const qs = (p: number) => `?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.sort ? { sort: query.sort } : {}), ...(query.min ? { min: query.min } : {}), ...(query.max ? { max: query.max } : {}), ...(query.inStock ? { stock: "1" } : {}), page: String(p) })}`;
  const nav = catalog.collections.filter((c) => c.productCount > 0);
  return `<section class="sec sf-shop"><div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="${esc(href(base, "/"))}">Home</a><span>/</span>${collection ? `<a href="${esc(href(base, "/shop"))}">Shop</a><span>/</span><span>${esc(collection.title)}</span>` : `<span>Shop</span>`}</nav>
<header class="sf-shop-head"><h1>${esc(title)}</h1>${collection?.description ? `<p class="lead">${esc(collection.description)}</p>` : `<p class="lead">${list.length} product${list.length === 1 ? "" : "s"} from ${esc(storeName)}</p>`}</header>
${nav.length ? `<div class="chips" role="navigation" aria-label="Collections"><a class="chip${!collection ? " chip-on" : ""}" href="${esc(href(base, "/shop"))}">All</a>${nav.map((c) => `<a class="chip${collection?.id === c.id ? " chip-on" : ""}" href="${esc(href(base, `/shop/${c.slug}`))}">${esc(c.title)}</a>`).join("")}</div>` : ""}
<form class="sf-filters" method="get" action="${esc(action)}" role="search">
<label class="sf-search">${iconSvg("target", 16)}<input name="q" value="${esc(query.q)}" placeholder="Search products" aria-label="Search products"></label>
<label>Sort<select name="sort"><option value="featured"${query.sort === "featured" || !query.sort ? " selected" : ""}>Featured</option><option value="newest"${query.sort === "newest" ? " selected" : ""}>Newest</option><option value="price-asc"${query.sort === "price-asc" ? " selected" : ""}>Price: low to high</option><option value="price-desc"${query.sort === "price-desc" ? " selected" : ""}>Price: high to low</option></select></label>
<label>Min<input name="min" inputmode="decimal" value="${esc(query.min)}" size="5" aria-label="Minimum price"></label><label>Max<input name="max" inputmode="decimal" value="${esc(query.max)}" size="5" aria-label="Maximum price"></label>
<label class="sf-check"><input type="checkbox" name="stock" value="1"${query.inStock ? " checked" : ""}> In stock</label>
<button class="btn btn-secondary" type="submit">Apply</button></form>
${shown.length ? `<div class="pgrid pgrid-shop">${shown.map((p) => productCard(p, base, catalog.currency)).join("")}</div>` : `<div class="sf-empty"><h2>No products found</h2><p class="muted">Try a different search or clear the filters.</p><a class="btn btn-secondary" href="${esc(action)}">Clear filters</a></div>`}
${pages > 1 ? `<nav class="pager" aria-label="Pages">${page > 1 ? `<a class="btn btn-secondary" href="${esc(action + qs(page - 1))}">← Previous</a>` : "<span></span>"}<span class="muted">Page ${page} of ${pages}</span>${page < pages ? `<a class="btn btn-secondary" href="${esc(action + qs(page + 1))}">Next →</a>` : "<span></span>"}</nav>` : ""}
</div></section>`;
}

export type SfReview = { name: string; rating: number; title: string; body: string; verified: boolean; createdAt: string };

export function productPage(p: SfProduct, ctx: { catalog: Catalog; base: string; formBase: string; reviews: SfReview[]; message?: string; policies: { shipping?: string; refund?: string }; trust: boolean; reviewSubmitted?: boolean; chatUrl?: string | null }) {
  const { currency } = ctx.catalog;
  const imgs = p.images.map(safeImageUrl).filter(Boolean);
  const available = p.variants.filter((v) => v.available > 0);
  const single = p.variants.length === 1;
  const v0 = available[0] ?? p.variants[0];
  const variantPicker = single
    ? `<input type="hidden" name="variant" value="${esc(v0.id)}">`
    : `<label class="sf-field"><span>${esc(p.options.map((o) => o.name).join(" / ") || "Option")}</span><select name="variant" required>${p.variants
        .map((v) => `<option value="${esc(v.id)}"${v.available <= 0 ? " disabled" : ""}${v.id === v0.id ? " selected" : ""}>${esc(v.title)} — ${esc(formatPrice(v.price, currency))}${v.available <= 0 ? " (sold out)" : v.available <= 5 ? ` (only ${v.available} left)` : ""}</option>`)
        .join("")}</select></label>`;
  const related = ctx.catalog.products.filter((x) => x.id !== p.id && x.collectionIds.some((c) => p.collectionIds.includes(c))).slice(0, 4);
  const fallback = related.length ? related : ctx.catalog.products.filter((x) => x.id !== p.id).slice(0, 4);
  const desc = p.description
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const avg = ctx.reviews.length ? ctx.reviews.reduce((a, r) => a + r.rating, 0) / ctx.reviews.length : 0;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: imgs.filter((u) => u.startsWith("http")),
    description: p.description.slice(0, 500),
    offers: { "@type": "AggregateOffer", priceCurrency: currency, lowPrice: (minPrice(p) / 100).toFixed(2), highPrice: (maxPrice(p) / 100).toFixed(2), availability: inStock(p) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
    ...(ctx.reviews.length ? { aggregateRating: { "@type": "AggregateRating", ratingValue: avg.toFixed(1), reviewCount: ctx.reviews.length } } : {}),
  };
  return `<section class="sec sf-product"><div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="${esc(href(ctx.base, "/"))}">Home</a><span>/</span><a href="${esc(href(ctx.base, "/shop"))}">Shop</a><span>/</span><span>${esc(p.title)}</span></nav>
<div class="pdp">
<div class="pdp-gallery">${imgs.length ? imgs.map((u, i) => `<figure class="pdp-img${i === 0 ? " pdp-img-main" : ""}"><img src="${esc(u)}" alt="${esc(p.title)}${i ? ` — image ${i + 1}` : ""}" ${i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}></figure>`).join("") : `<div class="pdp-img pdp-img-main"><div class="pc-ph"></div></div>`}</div>
<div class="pdp-info">
${p.vendor ? `<p class="eyebrow">${esc(p.vendor)}</p>` : ""}<h1 class="pdp-title">${esc(p.title)}</h1>
${ctx.reviews.length ? `<a class="pdp-rating" href="#reviews">${stars(avg)} <span class="muted">${avg.toFixed(1)} · ${ctx.reviews.length} review${ctx.reviews.length === 1 ? "" : "s"}</span></a>` : ""}
<p class="pdp-price">${priceHtml(p, currency)}</p>
${ctx.message ? `<p class="sf-alert" role="alert">${esc(ctx.message)}</p>` : ""}
${available.length ? `<form class="pdp-form" method="post" action="${esc(ctx.formBase)}/cart"><input type="hidden" name="action" value="add"><input type="hidden" name="_base" value="${esc(ctx.base)}">${variantPicker}
<div class="pdp-buy"><label class="qty"><span class="sr-only">Quantity</span><input type="number" name="qty" value="1" min="1" max="${Math.min(99, Math.max(...available.map((v) => v.available)))}" inputmode="numeric"></label><button class="btn btn-primary btn-block" type="submit">Add to cart</button></div>
<button class="btn btn-secondary btn-block" type="submit" name="buyNow" value="1">Buy it now</button></form>` : `<p class="sf-soldout">Sold out</p>`}
${ctx.chatUrl ? `<a class="btn btn-ghost btn-block wa-link" href="${esc(ctx.chatUrl)}" target="_blank" rel="noopener">${iconSvg("chat", 18)} Ask about this on WhatsApp</a>` : ""}
${ctx.trust ? `<ul class="trust"><li>${iconSvg("truck", 18)}<span>Fast, tracked delivery</span></li><li>${iconSvg("shield", 18)}<span>Secure checkout</span></li><li>${iconSvg("heart", 18)}<span>Easy returns</span></li></ul>` : ""}
${desc ? `<div class="pdp-desc">${desc}</div>` : ""}
${ctx.policies.shipping ? `<details class="faq-item"><summary>Shipping</summary><p>${esc(ctx.policies.shipping)}</p></details>` : ""}${ctx.policies.refund ? `<details class="faq-item"><summary>Returns &amp; refunds</summary><p>${esc(ctx.policies.refund)}</p></details>` : ""}
</div></div>

<section id="reviews" class="pdp-reviews"><h2>Reviews</h2>
${ctx.reviews.length ? `<div class="rev-list">${ctx.reviews.map((r) => `<article class="rev">${stars(r.rating)}${r.title ? `<h3>${esc(r.title)}</h3>` : ""}<p>${esc(r.body)}</p><p class="muted rev-by">${esc(r.name)}${r.verified ? " · Verified buyer" : ""}</p></article>`).join("")}</div>` : `<p class="muted">No reviews yet. Be the first to share your thoughts.</p>`}
${ctx.reviewSubmitted ? `<p class="sf-ok" role="status">Thank you! Your review will appear once it has been approved.</p>` : `<details class="rev-form-wrap"><summary class="btn btn-secondary">Write a review</summary><form class="form rev-form" method="post" action="${esc(ctx.formBase)}/reviews"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="product" value="${esc(p.id)}"><input type="text" name="_hp" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
<fieldset class="rate"><legend>Rating</legend>${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="r${n}" name="rating" value="${n}"${n === 5 ? " checked" : ""}><label for="r${n}" title="${n} stars">★</label>`).join("")}</fieldset>
<div class="row"><label>Name<input name="name" required maxlength="80"></label><label>Email (not shown)<input name="email" type="email" required maxlength="200"></label></div>
<label>Title<input name="title" maxlength="120"></label><label>Review<textarea name="body" required maxlength="2000" rows="4"></textarea></label><button class="btn btn-primary" type="submit">Submit review</button></form></details>`}
</section>
${fallback.length ? `<section class="pdp-related"><h2>You may also like</h2><div class="pgrid">${fallback.map((x) => productCard(x, ctx.base, currency)).join("")}</div></section>` : ""}
</div><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script></section>`;
}

export type SfLine = { variantId: string; title: string; variantTitle: string; slug: string; image: string; unitPrice: number; compareAt: number | null; quantity: number; available: number };
export type SfTotals = { subtotal: number; discount: number; shipping: number; fee: number; tax: number; total: number; taxIncluded: boolean; giftCard?: number };

function summary(lines: SfLine[], totals: SfTotals, currency: string, opts: { shippingKnown: boolean; discountCode?: string | null; compact?: boolean }) {
  const m = (n: number) => esc(formatPrice(n, currency));
  return `<div class="sum">${opts.compact ? `<ul class="sum-lines">${lines.map((l) => `<li><span class="sum-thumb">${safeImageUrl(l.image) ? `<img src="${esc(safeImageUrl(l.image))}" alt="">` : ""}<b>${l.quantity}</b></span><span class="sum-name">${esc(l.title)}${l.variantTitle ? `<small>${esc(l.variantTitle)}</small>` : ""}</span><span>${m(l.unitPrice * l.quantity)}</span></li>`).join("")}</ul>` : ""}
<dl class="sum-rows"><div><dt>Subtotal</dt><dd>${m(totals.subtotal)}</dd></div>${totals.discount ? `<div class="sum-disc"><dt>Discount${opts.discountCode ? ` (${esc(opts.discountCode)})` : ""}</dt><dd>−${m(totals.discount)}</dd></div>` : ""}
<div><dt>Shipping</dt><dd>${opts.shippingKnown ? (totals.shipping ? m(totals.shipping) : "Free") : '<span class="muted">Calculated at checkout</span>'}</dd></div>${totals.fee ? `<div><dt>Payment fee</dt><dd>${m(totals.fee)}</dd></div>` : ""}
${totals.taxIncluded ? "" : `<div><dt>Tax</dt><dd>${m(totals.tax)}</dd></div>`}
<div class="sum-total"><dt>Total</dt><dd>${m(totals.total)}</dd></div>${totals.taxIncluded && totals.tax ? `<p class="muted sum-note">Including ${m(totals.tax)} in taxes</p>` : ""}
${totals.giftCard ? `<div class="sum-disc"><dt>Gift card</dt><dd>−${m(totals.giftCard)}</dd></div><div class="sum-total"><dt>Amount to pay</dt><dd>${m(totals.total - totals.giftCard)}</dd></div>` : ""}</dl></div>`;
}

export function cartPage(ctx: { lines: SfLine[]; totals: SfTotals; currency: string; base: string; formBase: string; problems: string[]; message?: string; /** A success message, shown in the success style. */ notice?: string; /** Live promotions: free-delivery progress (top) and upsells (bottom). */ extras?: { top: string; bottom: string } | null; discount: { code: string; ok: boolean; reason?: string } | null; giftCard?: { code: string; ok: boolean; reason?: string; balance: number } | null; checkoutOpen: boolean; closedReason?: string }) {
  if (!ctx.lines.length) {
    return `<section class="sec sf-cart"><div class="wrap narrow sf-empty">${iconSvg("bag", 36)}<h1>Your cart is empty</h1><p class="muted">Find something you love.</p><a class="btn btn-primary" href="${esc(href(ctx.base, "/shop"))}">Continue shopping</a></div></section>`;
  }
  const m = (n: number) => esc(formatPrice(n, ctx.currency));
  const hidden = `<input type="hidden" name="_base" value="${esc(ctx.base)}">`;
  return `<section class="sec sf-cart"><div class="wrap"><h1>Your cart</h1>
${ctx.notice ? `<p class="sf-ok" role="status">${esc(ctx.notice)}</p>` : ""}${[...ctx.problems, ...(ctx.message ? [ctx.message] : [])].map((p) => `<p class="sf-alert" role="status">${esc(p)}</p>`).join("")}${ctx.extras ? `<style>${PROMO_CSS}</style>${ctx.extras.top}` : ""}
<div class="cart-grid"><div><ul class="cart-lines">${ctx.lines
    .map(
      (l) => `<li class="cart-line"><a class="cart-img" href="${esc(href(ctx.base, `/product/${l.slug}`))}">${safeImageUrl(l.image) ? `<img src="${esc(safeImageUrl(l.image))}" alt="">` : `<div class="pc-ph"></div>`}</a>
<div class="cart-info"><a class="cart-title" href="${esc(href(ctx.base, `/product/${l.slug}`))}">${esc(l.title)}</a>${l.variantTitle ? `<p class="muted">${esc(l.variantTitle)}</p>` : ""}<p>${m(l.unitPrice)}${l.compareAt && l.compareAt > l.unitPrice ? ` <s class="muted">${m(l.compareAt)}</s>` : ""}</p>
<form class="cart-qty" method="post" action="${esc(ctx.formBase)}/cart">${hidden}<input type="hidden" name="action" value="update"><input type="hidden" name="variant" value="${esc(l.variantId)}"><label><span class="sr-only">Quantity</span><input type="number" name="qty" value="${l.quantity}" min="0" max="${Math.min(99, l.available)}"></label><button class="btn btn-ghost" type="submit">Update</button></form>
<form method="post" action="${esc(ctx.formBase)}/cart">${hidden}<input type="hidden" name="action" value="remove"><input type="hidden" name="variant" value="${esc(l.variantId)}"><button class="link-btn" type="submit">Remove</button></form></div>
<p class="cart-line-total">${m(l.unitPrice * l.quantity)}</p></li>`,
    )
    .join("")}</ul>
<a class="btn btn-ghost" href="${esc(href(ctx.base, "/shop"))}">← Continue shopping</a>${ctx.extras?.bottom ?? ""}</div>
<aside class="cart-side card">
<form class="coupon" method="post" action="${esc(ctx.formBase)}/cart">${hidden}<input type="hidden" name="action" value="coupon"><label><span class="sr-only">Discount code</span><input name="code" placeholder="Discount code" value="${esc(ctx.discount?.code ?? "")}" maxlength="40"></label><button class="btn btn-secondary" type="submit">Apply</button></form>
${ctx.discount && !ctx.discount.ok ? `<p class="sf-alert">${esc(ctx.discount.reason ?? "Invalid code")}</p>` : ""}
<form class="coupon" method="post" action="${esc(ctx.formBase)}/cart">${hidden}<input type="hidden" name="action" value="giftcard"><label><span class="sr-only">Gift card code</span><input name="code" placeholder="Gift card code" value="${esc(ctx.giftCard?.code ?? "")}" maxlength="40" autocomplete="off"></label><button class="btn btn-secondary" type="submit">${ctx.giftCard?.ok ? "Change" : "Apply"}</button></form>
${ctx.giftCard && !ctx.giftCard.ok ? `<p class="sf-alert">${esc(ctx.giftCard.reason ?? "Invalid gift card")}</p>` : ctx.giftCard?.ok ? `<p class="muted sum-note">Gift card balance: ${m(ctx.giftCard.balance)}</p>` : ""}
${summary(ctx.lines, ctx.totals, ctx.currency, { shippingKnown: false, discountCode: ctx.discount?.ok ? ctx.discount.code : null })}
${ctx.checkoutOpen ? `<a class="btn btn-primary btn-block" href="${esc(href(ctx.base, "/checkout"))}">Checkout</a>` : `<p class="sf-alert">${esc(ctx.closedReason ?? "Checkout is not open yet.")}</p>`}
<p class="muted sum-note">${iconSvg("lock", 14)} Secure checkout</p></aside></div></div></section>`;
}

export type CheckoutCtx = {
  step: "details" | "pay";
  base: string;
  formBase: string;
  currency: string;
  lines: SfLine[];
  totals: SfTotals;
  email: string;
  phone: string;
  address: { name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string } | null;
  rates: { id: string; name: string; price: number; eta: string }[];
  selectedRate: string | null;
  payments: { id: string; name: string; description: string; fee: number }[];
  selectedPayment: string | null;
  errors: string[];
  requirePhone: boolean;
  allowNotes: boolean;
  termsRequired: boolean;
  defaultCountry: string;
  discountCode?: string | null;
  marketingConsent: boolean;
  shipCountries: string[];
  /** Offer the WhatsApp order-updates opt-in. */
  whatsapp?: boolean;
  whatsappOptIn?: boolean;
  /** Offer the optional GSTIN fields (Indian stores). */
  gst?: boolean;
  buyerGstin?: string;
  buyerBusinessName?: string;
};

export function checkoutPage(c: CheckoutCtx) {
  const a = c.address ?? { name: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: c.defaultCountry };
  const hidden = `<input type="hidden" name="_base" value="${esc(c.base)}">`;
  const countries = COUNTRIES.filter(([code]) => !c.shipCountries.length || c.shipCountries.includes("*") || c.shipCountries.includes(code));
  const regionField =
    a.country === "IN"
      ? `<select name="region" required autocomplete="address-level1"><option value="">Select state</option>${INDIAN_STATES.map((s) => `<option${s === a.region ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`
      : `<input name="region" value="${esc(a.region)}" required maxlength="80" autocomplete="address-level1">`;
  const steps = `<ol class="steps-bar"><li class="${c.step === "details" ? "on" : "done"}">Details</li><li class="${c.step === "pay" ? "on" : ""}">Delivery &amp; payment</li></ol>`;
  const details = `<form class="form co-form" method="post" action="${esc(c.formBase)}/checkout">${hidden}<input type="hidden" name="step" value="details">
<h2>Contact</h2><div class="row"><label>Email<input type="email" name="email" value="${esc(c.email)}" required maxlength="200" autocomplete="email"></label><label>Phone${c.requirePhone ? "" : " (optional)"}<input type="tel" name="phone" value="${esc(c.phone)}" ${c.requirePhone ? "required " : ""}maxlength="30" autocomplete="tel"></label></div>
<label class="sf-check"><input type="checkbox" name="consent" value="1"${c.marketingConsent ? " checked" : ""}> Email me with news and offers</label>
${c.whatsapp ? `<label class="sf-check"><input type="checkbox" name="whatsapp" value="1"${c.whatsappOptIn ? " checked" : ""}> Send me order updates on WhatsApp</label>` : ""}
<h2>Delivery address</h2><label>Full name<input name="name" value="${esc(a.name)}" required maxlength="120" autocomplete="name"></label>
<label>Address<input name="line1" value="${esc(a.line1)}" required maxlength="200" autocomplete="address-line1"></label><label>Apartment, suite, landmark (optional)<input name="line2" value="${esc(a.line2 ?? "")}" maxlength="200" autocomplete="address-line2"></label>
<div class="row"><label>City<input name="city" value="${esc(a.city)}" required maxlength="80" autocomplete="address-level2"></label><label>${a.country === "IN" ? "State" : "State / region"}${regionField}</label><label>${a.country === "IN" ? "PIN code" : "Postal code"}<input name="postalCode" value="${esc(a.postalCode)}" required maxlength="12" autocomplete="postal-code"></label></div>
${c.gst ? `<details class="gst-box"${c.buyerGstin ? " open" : ""}><summary>Buying for a business? Add your GSTIN</summary><div class="row"><label>GSTIN<input name="gstin" value="${esc(c.buyerGstin ?? "")}" maxlength="15" autocomplete="off" style="text-transform:uppercase"></label><label>Registered business name<input name="businessName" value="${esc(c.buyerBusinessName ?? "")}" maxlength="120" autocomplete="organization"></label></div><p class="muted">Your GSTIN is printed on the tax invoice so you can claim input tax credit.</p></details>` : ""}
<label>Country<select name="country" autocomplete="country">${countries.map(([code, name]) => `<option value="${code}"${code === a.country ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>
<button class="btn btn-primary btn-block" type="submit">Continue to delivery &amp; payment</button></form>`;
  const pay = `<div class="co-recap card"><p><strong>${esc(a.name)}</strong> · ${esc(c.email)}${c.phone ? ` · ${esc(c.phone)}` : ""}</p><p class="muted">${esc([a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", "))}</p><a href="${esc(href(c.base, "/checkout?edit=1"))}">Change</a></div>
<form class="form co-form" method="post" action="${esc(c.formBase)}/checkout">${hidden}<input type="hidden" name="step" value="place">
<h2>Delivery</h2>${c.rates.length ? `<div class="radio-cards">${c.rates.map((r, i) => `<label class="radio-card"><input type="radio" name="rate" value="${esc(r.id)}"${(c.selectedRate ? r.id === c.selectedRate : i === 0) ? " checked" : ""} required><span><strong>${esc(r.name)}</strong>${r.eta ? `<small>${esc(r.eta)}</small>` : ""}</span><b>${r.price ? esc(formatPrice(r.price, c.currency)) : "Free"}</b></label>`).join("")}</div>` : `<p class="sf-alert">We don't deliver to this address yet. Please choose another address.</p>`}
<h2>Payment</h2>${c.payments.length ? `<div class="radio-cards">${c.payments.map((p, i) => `<label class="radio-card"><input type="radio" name="payment" value="${esc(p.id)}"${(c.selectedPayment ? p.id === c.selectedPayment : i === 0) ? " checked" : ""} required><span><strong>${esc(p.name)}</strong><small>${esc(p.description)}${p.fee ? ` (+${esc(formatPrice(p.fee, c.currency))})` : ""}</small></span></label>`).join("")}</div>` : `<p class="sf-alert">No payment methods are available for this order.</p>`}
${c.allowNotes ? `<label>Order note (optional)<textarea name="note" maxlength="1000" rows="2"></textarea></label>` : ""}
${c.termsRequired ? `<label class="sf-check"><input type="checkbox" name="terms" value="1" required> I agree to the <a href="${esc(href(c.base, "/policies/terms"))}">terms</a> and <a href="${esc(href(c.base, "/policies/refund"))}">refund policy</a></label>` : ""}
<button class="btn btn-primary btn-block btn-lg" type="submit"${c.rates.length && c.payments.length ? "" : " disabled"}>Place order · ${esc(formatPrice(c.totals.total - (c.totals.giftCard ?? 0), c.currency))}</button>
<p class="muted sum-note">${iconSvg("lock", 14)} Online payments are completed on the provider's secure page. We never see your card details.</p></form>`;
  return `<section class="sec sf-checkout"><div class="wrap"><div class="co-grid"><div>
<a class="crumb-back" href="${esc(href(c.base, "/cart"))}">← Back to cart</a><h1>Checkout</h1>${steps}
${c.errors.map((e) => `<p class="sf-alert" role="alert">${esc(e)}</p>`).join("")}
${c.step === "details" ? details : pay}</div>
<aside class="co-side card"><h2 class="sr-only">Order summary</h2>${summary(c.lines, c.totals, c.currency, { shippingKnown: c.step === "pay", discountCode: c.discountCode, compact: true })}</aside></div></div></section>`;
}

export type SfOrder = {
  label: string;
  createdAt: string;
  email: string;
  address: { name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string };
  items: { title: string; variantTitle: string; quantity: number; total: number; image: string }[];
  totals: SfTotals;
  currency: string;
  paymentMethod: string;
  financialStatus: string;
  fulfillmentStatus: string;
  cancelled: boolean;
  shippingMethod: string;
  tracking: { carrier: string; number: string; url: string } | null;
  manual?: { label: string; upiId?: string; instructions?: string; storeName: string } | null;
  number?: number;
  returns?: { status: string; reason: string; createdAt: string; items: { title: string; quantity: number }[] }[];
  /** Present when the customer may request a return now. */
  returnForm?: { auth: { key?: string; token?: string }; items: { id: string; title: string; variantTitle: string; max: number }[]; reasons: readonly string[] } | null;
  returnNote?: string;
  /** Purchased files (paid orders only). */
  downloads?: { title: string; url: string; remaining: number }[];
  /** For the first order of a subscription. */
  subscription?: { label: string; status: string; renewsOn: string | null; cancelAtPeriodEnd: boolean; cancel?: { number: number; key: string } };
};

const RETURN_STATUS: Record<string, string> = { requested: "Requested — the store will reply soon", approved: "Approved — send the items back", rejected: "Declined", received: "Items received — refund on its way", refunded: "Refunded" };

/** Return requests on an order, plus the form to request one when allowed. */
export function returnsBlock(o: SfOrder, formBase: string, base: string) {
  const list = (o.returns ?? [])
    .map((r) => `<li><strong>${esc(RETURN_STATUS[r.status] ?? r.status)}</strong><span class="muted"> · ${esc(r.reason)} · ${esc(r.items.map((i) => `${i.quantity} × ${i.title}`).join(", "))}</span></li>`)
    .join("");
  const f = o.returnForm;
  const form = f
    ? `<details class="sf-return"><summary class="btn btn-secondary">Request a return</summary><form class="form" method="post" action="${esc(formBase)}/returns"><input type="hidden" name="_base" value="${esc(base)}"><input type="hidden" name="number" value="${o.number ?? ""}">${f.auth.key ? `<input type="hidden" name="key" value="${esc(f.auth.key)}">` : ""}${f.auth.token ? `<input type="hidden" name="token" value="${esc(f.auth.token)}">` : ""}
<p class="muted">Choose what you want to return.</p>${f.items.map((i) => `<label class="row-inline"><span>${esc(i.title)}${i.variantTitle && i.variantTitle !== "Default" ? ` <small class="muted">${esc(i.variantTitle)}</small>` : ""}</span><select name="qty_${esc(i.id)}" aria-label="Quantity to return of ${esc(i.title)}"><option value="0">0</option>${Array.from({ length: i.max }, (_, n) => `<option value="${n + 1}">${n + 1}</option>`).join("")}</select></label>`).join("")}
<label>Reason<select name="reason" required>${f.reasons.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label><label>Anything else? (optional)<textarea name="details" rows="2" maxlength="1000"></textarea></label><button class="btn btn-primary" type="submit">Send return request</button></form></details>`
    : "";
  if (!list && !form && !o.returnNote) return "";
  return `<div class="card sf-returns"><h2>Returns</h2>${list ? `<ul class="plain">${list}</ul>` : ""}${form}${!form && o.returnNote && !list ? `<p class="muted">${esc(o.returnNote)}</p>` : ""}</div>`;
}

export function accountPage(ctx: { base: string; formBase: string; storeName: string; sent?: boolean; error?: string; message?: string; orders?: SfOrder[] }) {
  if (!ctx.orders) {
    return `<section class="sec sf-track"><div class="wrap narrow"><h1>Your orders</h1><p class="lead">Enter the email you used at checkout and we'll send you a link to see all your orders, track deliveries and request returns.</p>
${ctx.sent ? `<p class="sf-ok" role="status">If there are orders for that email, a link is on its way. It works for 24 hours.</p>` : ""}${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
<form class="form card" method="post" action="${esc(ctx.formBase)}/account"><input type="hidden" name="_base" value="${esc(ctx.base)}"><label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label><button class="btn btn-primary" type="submit">Email me a link</button></form>
<p class="muted">Have your order number? <a href="${esc(href(ctx.base, "/track"))}">Track a single order</a>.</p></div></section>`;
  }
  const cards = ctx.orders
    .map((o) => {
      const m = (n: number) => esc(formatPrice(n, o.currency));
      const status = o.cancelled ? "Cancelled" : ({ unfulfilled: o.financialStatus === "pending" && o.paymentMethod !== "cod" ? "Awaiting payment" : "Being prepared", packed: "Packed", shipped: "On its way", delivered: "Delivered", returned: "Returned" } as Record<string, string>)[o.fulfillmentStatus] ?? o.fulfillmentStatus;
      return `<article class="card acct-order"><header><div><h2>Order ${esc(o.label)}</h2><p class="muted">${esc(new Date(o.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }))} · ${m(o.totals.total)}</p></div><span class="chip chip-on">${esc(status)}</span></header>
<ul class="plain">${o.items.map((i) => `<li>${i.quantity} × ${esc(i.title)}${i.variantTitle && i.variantTitle !== "Default" ? ` <small class="muted">${esc(i.variantTitle)}</small>` : ""}</li>`).join("")}</ul>
${o.tracking ? `<p>${esc(o.tracking.carrier)} · ${esc(o.tracking.number)}${safeUrl(o.tracking.url) ? ` · <a href="${esc(safeUrl(o.tracking.url))}" target="_blank" rel="noopener">Track package</a>` : ""}</p>` : ""}
${returnsBlock(o, ctx.formBase, ctx.base)}</article>`;
    })
    .join("");
  return `<section class="sec sf-account"><div class="wrap narrow"><h1>Your orders</h1>${ctx.message ? `<p class="sf-ok" role="status">${esc(ctx.message)}</p>` : ""}${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}${cards || `<p class="muted">No orders yet.</p>`}<p class="muted"><a href="${esc(href(ctx.base, "/shop"))}">Continue shopping →</a></p></div></section>`;
}

export function orderPage(o: SfOrder, ctx: { base: string; justPlaced: boolean; paymentFailed?: boolean; formBase?: string; message?: string; error?: string; chatUrl?: string | null }) {
  const m = (n: number) => esc(formatPrice(n, o.currency));
  const stage = o.cancelled ? -1 : { unfulfilled: o.financialStatus === "paid" || o.paymentMethod === "cod" ? 1 : 0, packed: 2, shipped: 3, delivered: 4, returned: 4 }[o.fulfillmentStatus] ?? 0;
  const stages = ["Placed", "Confirmed", "Packed", "Shipped", "Delivered"];
  const due = o.totals.total - (o.totals.giftCard ?? 0);
  const amount = (due / 10 ** minorDigits(o.currency)).toFixed(minorDigits(o.currency));
  const upi = o.manual?.upiId ? `upi://pay?pa=${encodeURIComponent(o.manual.upiId)}&pn=${encodeURIComponent(o.manual.storeName)}&am=${amount}&cu=${o.currency}&tn=${encodeURIComponent(`Order ${o.label}`)}` : "";
  const head = o.cancelled
    ? `<h1>Order ${esc(o.label)} was cancelled</h1>`
    : ctx.paymentFailed
      ? `<h1>Payment not completed</h1><p class="lead">Your order ${esc(o.label)} is saved but unpaid. Stock is held for a short time.</p>`
      : `<span class="ok-badge">${iconSvg("check", 22)}</span><h1>${ctx.justPlaced ? "Thank you! Your order is confirmed." : `Order ${esc(o.label)}`}</h1><p class="lead">${ctx.justPlaced ? `Order ${esc(o.label)} · a confirmation is on its way to ${esc(o.email)}.` : `Placed on ${esc(new Date(o.createdAt).toLocaleDateString("en-IN", { dateStyle: "long" }))}`}</p>`;
  return `<section class="sec sf-order"><div class="wrap narrow">
<div class="order-head">${head}</div>
${ctx.message ? `<p class="sf-ok" role="status">${esc(ctx.message)}</p>` : ""}${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
${!o.cancelled ? `<ol class="track">${stages.map((s, i) => `<li class="${i <= stage ? "on" : ""}">${esc(s)}</li>`).join("")}</ol>` : ""}
${o.tracking ? `<div class="card order-track"><p><strong>${esc(o.tracking.carrier)}</strong> · ${esc(o.tracking.number)}</p>${safeUrl(o.tracking.url) ? `<a class="btn btn-secondary" href="${esc(safeUrl(o.tracking.url))}" target="_blank" rel="noopener">Track package</a>` : ""}</div>` : ""}
${o.paymentMethod === "manual" && o.financialStatus === "pending" && !o.cancelled && o.manual ? `<div class="card order-pay"><h2>Complete your payment</h2><p>Pay <strong>${m(due)}</strong> and mention <strong>${esc(o.label)}</strong> as the reference.</p>${o.manual.upiId ? `<p>UPI ID: <strong>${esc(o.manual.upiId)}</strong></p><a class="btn btn-primary" href="${esc(upi)}">Pay with a UPI app</a>` : ""}${o.manual.instructions ? `<p class="muted pre">${esc(o.manual.instructions)}</p>` : ""}<p class="muted">We will confirm your order as soon as the payment arrives.</p></div>` : ""}
${o.paymentMethod === "cod" && !o.cancelled && o.financialStatus === "pending" ? `<p class="sf-ok">Pay ${m(due)} in cash or UPI when your order arrives.</p>` : ""}
<div class="order-grid"><div class="card"><h2>Items</h2><ul class="sum-lines">${o.items.map((i) => `<li><span class="sum-thumb">${safeImageUrl(i.image) ? `<img src="${esc(safeImageUrl(i.image))}" alt="">` : ""}<b>${i.quantity}</b></span><span class="sum-name">${esc(i.title)}${i.variantTitle ? `<small>${esc(i.variantTitle)}</small>` : ""}</span><span>${m(i.total)}</span></li>`).join("")}</ul>
${summary([], o.totals, o.currency, { shippingKnown: true })}</div>
<div class="card"><h2>Delivery</h2><p><strong>${esc(o.address.name)}</strong><br>${esc([o.address.line1, o.address.line2].filter(Boolean).join(", "))}<br>${esc([o.address.city, o.address.region, o.address.postalCode].filter(Boolean).join(", "))}<br>${esc(o.address.country)}</p><p class="muted">${esc(o.shippingMethod)}</p>
<h2>Payment</h2><p>${esc({ cod: "Cash on delivery", manual: "UPI / bank transfer", stripe: "Card (Stripe)", razorpay: "Razorpay", paypal: "PayPal", giftcard: "Gift card" }[o.paymentMethod] ?? o.paymentMethod)} · ${esc({ pending: "Awaiting payment", paid: "Paid", refunded: "Refunded", partially_refunded: "Partially refunded", voided: "Voided" }[o.financialStatus] ?? o.financialStatus)}</p></div></div>
${o.subscription ? `<div class="card sf-returns"><h2>Your subscription</h2><p>${esc(o.subscription.label)} · ${o.subscription.status === "canceled" ? "Cancelled" : o.subscription.cancelAtPeriodEnd ? `Ends ${o.subscription.renewsOn ? esc(new Date(o.subscription.renewsOn).toLocaleDateString("en-IN", { dateStyle: "long" })) : "after this period"}` : o.subscription.renewsOn ? `Renews ${esc(new Date(o.subscription.renewsOn).toLocaleDateString("en-IN", { dateStyle: "long" }))}` : esc(o.subscription.status)}</p>${o.subscription.cancel && ctx.formBase && o.subscription.status !== "canceled" && !o.subscription.cancelAtPeriodEnd ? `<form method="post" action="${esc(ctx.formBase)}/subscription"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="number" value="${o.subscription.cancel.number}"><input type="hidden" name="key" value="${esc(o.subscription.cancel.key)}"><button class="btn btn-secondary" type="submit">Cancel subscription</button><p class="muted">You keep it until the end of the period you've paid for.</p></form>` : ""}</div>` : ""}
${o.downloads?.length ? `<div class="card sf-returns"><h2>Your downloads</h2><ul class="plain">${o.downloads.map((d) => `<li><a class="btn btn-secondary" href="${esc(d.url)}">${iconSvg("check", 16)} Download ${esc(d.title)}</a> <span class="muted">${d.remaining} download${d.remaining === 1 ? "" : "s"} left</span></li>`).join("")}</ul></div>` : ""}
${ctx.formBase ? returnsBlock(o, ctx.formBase, ctx.base) : ""}
<p class="center"><a class="btn btn-secondary" href="${esc(href(ctx.base, "/shop"))}">Continue shopping</a> <a class="btn btn-ghost" href="${esc(href(ctx.base, "/account"))}">All my orders</a>${ctx.chatUrl ? ` <a class="btn btn-ghost wa-link" href="${esc(ctx.chatUrl)}" target="_blank" rel="noopener">${iconSvg("chat", 16)} Questions? Chat on WhatsApp</a>` : ""}</p></div></section>`;
}

/** Sign-in for a members-only page (no passwords: an emailed link). */
export function memberGatePage(ctx: { base: string; formBase: string; path: string; storeName: string; sent?: boolean; error?: string }) {
  return `<section class="sec sf-track"><div class="wrap narrow"><h1>Members only</h1><p class="lead">This page is for ${esc(ctx.storeName)} members. Enter the email you used when you joined and we'll send you a sign-in link.</p>
${ctx.sent ? `<p class="sf-ok" role="status">If that email has an active membership, a sign-in link is on its way. It works for 30 minutes.</p>` : ""}${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
<form class="form card" method="post" action="${esc(ctx.formBase)}/member-login"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="next" value="${esc(ctx.path)}"><label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label><button class="btn btn-primary" type="submit">Email me a sign-in link</button></form>
<p class="muted">Not a member yet? <a href="${esc(href(ctx.base, "/shop"))}">See membership options</a>.</p></div></section>`;
}

export function trackPage(ctx: { base: string; formBase: string; error?: string }) {
  return `<section class="sec sf-track"><div class="wrap narrow"><h1>Track your order</h1><p class="lead">Enter your order number and the email you used at checkout.</p>${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
<form class="form card" method="post" action="${esc(href(ctx.base, "/track"))}"><div class="row"><label>Order number<input name="number" required inputmode="numeric" maxlength="12" placeholder="1001"></label><label>Email<input name="email" type="email" required maxlength="200"></label></div><button class="btn btn-primary" type="submit">Find my order</button></form></div></section>`;
}

export function policyPage(title: string, body: string) {
  return `<section class="sec"><div class="wrap narrow prose"><h1>${esc(title)}</h1>${body
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("")}</div></section>`;
}

/** Commerce styles, layered on the site theme tokens. */
export const STORE_CSS = `.sf-cur{display:flex;justify-content:flex-end;padding-top:14px}.sf-cur form{display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--muted)}.sf-cur select{font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}.sf-cur .btn{padding:6px 12px;font-size:.8rem}
.sf-head{margin-bottom:36px}
.pgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:28px 22px}.pgrid-shop{grid-template-columns:repeat(4,minmax(0,1fr))}
.pgrid-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px}.pgrid-carousel .pc{flex:0 0 min(70%,280px);scroll-snap-align:start}
.pgrid-editorial{grid-template-columns:repeat(4,minmax(0,1fr))}.pgrid-editorial .pc-lg{grid-column:span 2;grid-row:span 2}.pgrid-editorial .pc-lg .pc-media{aspect-ratio:4/5}.pgrid-editorial .pc-lg .pc-title{font-size:1.4rem}
.pc{position:relative}.pc-link{text-decoration:none;color:inherit;display:block}
.pc-media{position:relative;aspect-ratio:4/5;overflow:hidden;border-radius:var(--radius);background:var(--surface)}
.pc-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .45s ease,transform .8s cubic-bezier(.2,.8,.2,1)}
.pc-alt{opacity:0}.pc:hover .pc-alt{opacity:1}.pc:hover .pc-media img:first-child{transform:scale(1.04)}
.pc-ph{position:absolute;inset:0;background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--accent) 10%,var(--surface)))}
.pc-badge{position:absolute;top:12px;left:12px;background:var(--accent);color:var(--accent-text);font-size:.72rem;font-weight:600;letter-spacing:.04em;padding:5px 10px;border-radius:999px}
.pc-badge-soft{background:var(--bg);color:var(--text)}.pc-badge-muted{background:color-mix(in srgb,var(--text) 75%,transparent);color:var(--bg)}
.pc-body{padding-top:14px}.pc-vendor{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 4px}
.pc-title{font-size:1rem;font-weight:550;letter-spacing:-.005em;margin:0 0 6px;font-family:var(--font);line-height:1.35}.pc-price{margin:0;display:flex;gap:8px;align-items:baseline}
.price-now{font-weight:600;font-variant-numeric:tabular-nums}.price-was{color:var(--muted);font-size:.9em}.pc-rating{margin:6px 0 0;font-size:.85rem}
.stars{color:#e2a32b;letter-spacing:1px}.stars-off{color:color-mix(in srgb,var(--text) 18%,transparent)}
.sf-more{justify-content:center;margin-top:44px}
.ctiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.ctile{position:relative;aspect-ratio:4/3;border-radius:var(--radius);overflow:hidden;display:block;color:#fff;text-decoration:none;background:var(--surface)}
.ctile img{width:100%;height:100%;object-fit:cover;transition:transform .8s cubic-bezier(.2,.8,.2,1)}.ctile:hover img{transform:scale(1.05)}
.ctile::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.6))}
.ctile-label{position:absolute;left:20px;bottom:18px;z-index:1;display:grid}.ctile-label strong{font-family:var(--heading-font);font-size:1.4rem;font-weight:var(--hw)}.ctile-label span{opacity:.85;font-size:.85rem}
.clist{display:grid;border-top:1px solid var(--line)}.clist-item{display:flex;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--line);text-decoration:none;font-family:var(--heading-font);font-size:1.4rem}
.crumbs{display:flex;gap:8px;flex-wrap:wrap;font-size:.85rem;color:var(--muted);margin-bottom:26px}.crumbs a{color:var(--muted);text-decoration:none}.crumbs a:hover{color:var(--text)}
.sf-shop-head{margin-bottom:28px}.sf-shop-head h1{margin-bottom:.2em}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}.chip{padding:8px 16px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:.9rem}.chip-on{background:var(--text);color:var(--bg);border-color:var(--text)}
.sf-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:34px;padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.sf-filters label{display:grid;gap:4px;font-size:.78rem;font-weight:600;color:var(--muted)}
.sf-filters input,.sf-filters select,.sf-field select,.qty input,.coupon input,.cart-qty input{font:inherit;font-size:.95rem;padding:10px 12px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);border-radius:calc(var(--radius) * .6 + 2px);background:var(--bg);color:var(--text)}
.sf-search{flex:1;min-width:200px;position:relative}.sf-search .ico{position:absolute;left:12px;bottom:12px;color:var(--muted)}.sf-search input{padding-left:36px;width:100%}
.sf-check{display:flex!important;align-items:center;gap:8px;font-weight:500!important;font-size:.92rem!important;color:inherit!important}
.sf-empty{text-align:center;padding:60px 0}.sf-empty .ico{margin:0 auto 12px;color:var(--muted)}
.pager{display:flex;justify-content:space-between;align-items:center;margin-top:48px}
.pdp{display:grid;grid-template-columns:1.25fr 1fr;gap:64px;align-items:start}
.pdp-gallery{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pdp-img{margin:0;border-radius:var(--radius);overflow:hidden;background:var(--surface);aspect-ratio:4/5;position:relative}.pdp-img img{width:100%;height:100%;object-fit:cover}.pdp-img-main{grid-column:span 2}
.pdp-info{position:sticky;top:96px;display:grid;gap:18px}.pdp-title{font-size:clamp(1.8rem,3.2vw,2.6rem);margin:0}.pdp-rating{text-decoration:none;font-size:.92rem}
.pdp-price{font-size:1.4rem;margin:0;display:flex;gap:10px;align-items:baseline}
.pdp-form{display:grid;gap:12px}.sf-field{display:grid;gap:6px;font-size:.85rem;font-weight:600}.sf-field select{width:100%}
.pdp-buy{display:grid;grid-template-columns:96px 1fr;gap:10px}.qty input{width:100%;text-align:center}
.btn-block{width:100%}.btn-lg{min-height:56px;font-size:1.02rem}
.sf-soldout{padding:14px;border-radius:var(--radius);background:var(--surface);text-align:center;font-weight:600}
.trust{list-style:none;padding:16px 0;margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.trust li{display:grid;justify-items:center;gap:6px;text-align:center;font-size:.8rem;color:var(--muted)}.trust .ico{color:var(--text)}
.pdp-desc{color:var(--muted)}.pdp-desc p:last-child{margin:0}
.pdp-reviews{margin-top:96px;max-width:860px}.rev-list{display:grid;gap:18px;margin:24px 0}.rev{border-bottom:1px solid var(--line);padding-bottom:18px}.rev h3{margin:8px 0 4px;font-size:1.05rem}.rev p{margin:4px 0}.rev-by{font-size:.85rem}
.rev-form-wrap>summary{list-style:none;display:inline-flex}.rev-form-wrap>summary::-webkit-details-marker{display:none}.rev-form{margin-top:18px;max-width:640px}
.rate{border:0;padding:0;margin:0;display:inline-flex;flex-direction:row-reverse;justify-content:flex-end;gap:2px}.rate legend{font-size:.88rem;font-weight:600;margin-bottom:4px;float:left;width:100%}
.rate input{position:absolute;opacity:0}.rate label{font-size:1.8rem;color:color-mix(in srgb,var(--text) 20%,transparent);cursor:pointer;display:inline}
.rate input:checked~label,.rate label:hover,.rate label:hover~label{color:#e2a32b}.rate input:focus-visible+label{outline:2px solid var(--accent)}
.pdp-related{margin-top:96px}.pdp-related h2{margin-bottom:28px}
.sf-alert{padding:12px 14px;border-radius:calc(var(--radius) * .6 + 2px);background:color-mix(in srgb,#d93f2b 10%,var(--bg));color:inherit;border:1px solid color-mix(in srgb,#d93f2b 30%,transparent);font-size:.92rem;margin:0 0 12px}
.sf-ok{padding:12px 14px;border-radius:calc(var(--radius) * .6 + 2px);background:color-mix(in srgb,#1d7a46 10%,var(--bg));border:1px solid color-mix(in srgb,#1d7a46 30%,transparent);font-size:.95rem}
.cart-grid{display:grid;grid-template-columns:1.6fr 1fr;gap:48px;align-items:start;margin-top:24px}
.cart-lines{list-style:none;padding:0;margin:0 0 24px;border-top:1px solid var(--line)}.cart-line{display:grid;grid-template-columns:110px 1fr auto;gap:20px;padding:22px 0;border-bottom:1px solid var(--line)}
.cart-img{display:block;position:relative;aspect-ratio:4/5;border-radius:calc(var(--radius) * .7);overflow:hidden;background:var(--surface)}.cart-img img{width:100%;height:100%;object-fit:cover}
.cart-info p{margin:2px 0}.cart-title{font-weight:600;text-decoration:none}.cart-qty{display:flex;gap:6px;align-items:center;margin-top:10px}.cart-qty input{width:72px}.cart-line-total{font-weight:600;margin:0}
.link-btn{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:.88rem;margin-top:6px}
.cart-side{position:sticky;top:96px;display:grid;gap:16px}.coupon{display:flex;gap:8px}.coupon label{flex:1}.coupon input{width:100%}
.sum-rows{margin:0;display:grid;gap:10px}.sum-rows div{display:flex;justify-content:space-between;gap:12px}.sum-rows dt{color:var(--muted)}.sum-rows dd{margin:0;font-variant-numeric:tabular-nums}
.sum-disc dd{color:#1d7a46}.sum-total{border-top:1px solid var(--line);padding-top:12px;font-size:1.15rem;font-weight:650}.sum-total dt{color:var(--text)!important}.sum-note{font-size:.82rem;display:flex;align-items:center;gap:6px;margin:0}
.sum-lines{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:14px}.sum-lines li{display:grid;grid-template-columns:56px 1fr auto;gap:14px;align-items:center}
.sum-thumb{position:relative;width:56px;height:56px;border-radius:calc(var(--radius) * .6);background:var(--surface);overflow:visible}.sum-thumb img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.sum-thumb b{position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;border-radius:11px;background:var(--muted);color:var(--bg);font-size:.75rem;display:flex;align-items:center;justify-content:center}
.sum-name{display:grid;font-size:.92rem}.sum-name small{color:var(--muted)}
.co-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:56px;align-items:start}.co-side{position:sticky;top:96px}.co-form{gap:14px}.co-form h2{font-size:1.15rem;margin:18px 0 4px;font-family:var(--font);font-weight:650;letter-spacing:0}
.co-form select{font:inherit;font-size:1rem;padding:13px 15px;border-radius:calc(var(--radius) * .6 + 2px);border:1px solid color-mix(in srgb,var(--text) 18%,transparent);background:var(--bg);color:var(--text);width:100%}
.crumb-back{font-size:.88rem;color:var(--muted);text-decoration:none}
.steps-bar{list-style:none;display:flex;gap:28px;padding:0;margin:0 0 24px;font-size:.88rem;color:var(--muted);counter-reset:s}.steps-bar li{counter-increment:s}.steps-bar li::before{content:counter(s);display:inline-flex;width:22px;height:22px;border-radius:50%;align-items:center;justify-content:center;border:1px solid var(--line);margin-right:8px;font-size:.75rem}
.steps-bar li.on{color:var(--text);font-weight:600}.steps-bar li.on::before{background:var(--text);color:var(--bg);border-color:var(--text)}.steps-bar li.done::before{content:"✓"}
.radio-cards{display:grid;gap:10px}.radio-card{display:grid!important;grid-template-columns:auto 1fr auto;gap:12px!important;align-items:center;padding:16px;border:1px solid var(--line);border-radius:var(--radius);cursor:pointer;font-weight:400!important;font-size:.95rem!important}
.radio-card:has(input:checked){border-color:var(--text);box-shadow:0 0 0 1px var(--text)}.radio-card span{display:grid}.radio-card small{color:var(--muted)}.radio-card input{width:auto!important;accent-color:var(--accent)}
.co-recap{display:grid;gap:2px;margin-bottom:8px;padding:18px}.co-recap p{margin:0}.co-recap a{font-size:.88rem;justify-self:start;margin-top:6px}
.order-head{text-align:center;margin-bottom:32px}.ok-badge{display:inline-flex;width:56px;height:56px;border-radius:50%;align-items:center;justify-content:center;background:#1d7a46;color:#fff;margin-bottom:16px}
.track{list-style:none;display:grid;grid-template-columns:repeat(5,1fr);padding:0;margin:0 0 32px;position:relative}.track li{text-align:center;font-size:.8rem;color:var(--muted);padding-top:22px;position:relative}
.track li::before{content:"";position:absolute;top:4px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--line);z-index:1}.track li::after{content:"";position:absolute;top:9px;left:-50%;width:100%;height:2px;background:var(--line)}.track li:first-child::after{display:none}
.track li.on{color:var(--text);font-weight:600}.track li.on::before,.track li.on::after{background:var(--accent)}
.wa-link{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin-top:8px}
.gst-box{margin:8px 0}.gst-box summary{cursor:pointer;font-weight:600;font-size:.92rem}.gst-box .row{margin-top:12px}
.sf-returns{margin-bottom:24px}.sf-returns h2{font-size:1rem;margin:0 0 10px}.sf-return summary{list-style:none;display:inline-flex;cursor:pointer}.sf-return summary::-webkit-details-marker{display:none}.sf-return form{margin-top:14px}.row-inline{display:flex;justify-content:space-between;align-items:center;gap:12px}.row-inline select{width:84px}ul.plain{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:6px}.acct-order{margin-bottom:16px}.acct-order header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.acct-order h2{font-size:1.05rem;margin:0}
.order-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;margin-bottom:32px}.order-grid h2{font-size:1rem;font-family:var(--font);font-weight:650;letter-spacing:0;margin:0 0 12px}.order-grid h2:not(:first-child){margin-top:20px}
.order-track,.order-pay{margin-bottom:20px;display:grid;gap:8px;justify-items:start}.order-pay h2{font-size:1.2rem;margin:0}.pre{white-space:pre-wrap}.center{text-align:center}
.cart-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none}.cart-count{display:inline-flex;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:var(--accent-text);font-size:.72rem;font-weight:700;align-items:center;justify-content:center}
.cart-count:empty{display:none}
@media (max-width:1023px){.pgrid,.pgrid-shop,.pgrid-editorial{grid-template-columns:repeat(3,minmax(0,1fr))}.pdp{gap:40px}.ctiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:767px){.pgrid,.pgrid-shop,.pgrid-editorial{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 14px}.pgrid-editorial .pc-lg{grid-column:span 2;grid-row:auto}
.pdp,.cart-grid,.co-grid,.order-grid{grid-template-columns:1fr}.pdp-info,.cart-side,.co-side{position:static}.pdp-gallery{grid-template-columns:1fr 1fr}.ctiles{grid-template-columns:1fr}
.cart-line{grid-template-columns:84px 1fr;}.cart-line-total{grid-column:2}.co-side{order:-1}.track li{font-size:.68rem}.sf-filters{display:grid;grid-template-columns:1fr 1fr}.sf-search{grid-column:span 2}}`;
