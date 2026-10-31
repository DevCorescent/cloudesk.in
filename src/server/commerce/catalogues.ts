// Catalogues: saved selections of a store's products with their own look,
// shared by link, QR or PDF, and able to take orders. They store rules only,
// so every view shows today's prices, stock and photos.
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { qrSvg } from "@/lib/store/barcode";
import { catalogueInputSchema, catalogueLockPage, cataloguePage, channelOf, selectProducts, whatsappOrderText, type CatalogueChannel, type CatalogueDesign, type CatalogueOrdering, type CatalogueSource } from "@/lib/store/catalogue";
import { formatPrice } from "@/lib/store/money";
import { MAX_LINE_QTY, saveCart, type CartItem } from "./cart";
import { getStore, loadProducts } from "./catalog";
import { cartCookie, cartFor, redirect } from "./http";
import { loadCatalog } from "./storefront";
import { readCookie, resolveSession, SESSION_COOKIE } from "../auth/session";
import { getMembership } from "../http/handler";
import { cartCookieName } from "./cart";
import { ApiError, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { appUrl } from "../services/mail";
import { isBot } from "../services/stats";

type Row = typeof schema.storeCatalogues.$inferSelect;
export const SHARE_CHANNELS = ["link", "qr", "whatsapp", "email", "sms", "pdf", "native", "facebook", "x", "linkedin", "telegram", "pinterest", "text", "embed"] as const;

const shareUrl = (token: string) => appUrl(`/c/${token}`);
const codeHash = (code: string) => sha256(`catalogue-code:${code.trim().toLowerCase()}`);
/** What an unlocked visitor's cookie holds: tied to the link and the current code. */
const passFor = (r: Pick<Row, "token" | "accessCodeHash">) => sha256(`${r.token}:${r.accessCodeHash}`);
export const passCookieName = (token: string) => `cc_cat_${token.replace(/[^\w-]/g, "")}`;

const today = sql`(now() at time zone 'Asia/Kolkata')::date`;
const istDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function parse(projectId: string, raw: unknown) {
  const r = catalogueInputSchema.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  const input = r.data;
  // An offer code must be one of the store's live discounts, so it works at checkout.
  if (input.ordering.offerCode) {
    const [d] = await db.select({ active: schema.storeDiscounts.active, endsAt: schema.storeDiscounts.endsAt }).from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`upper(${schema.storeDiscounts.code}) = ${input.ordering.offerCode}`));
    if (!d) throw new ApiError("validation_failed", `There's no discount code "${input.ordering.offerCode}" in your store. Create it under Store → Discounts first.`, { "ordering.offerCode": ["Not found in your store's discounts"] });
    if (!d.active || (d.endsAt && d.endsAt.getTime() < Date.now())) throw new ApiError("validation_failed", `The discount code "${input.ordering.offerCode}" isn't active.`, { "ordering.offerCode": ["Inactive or expired"] });
  }
  if (input.startsAt && input.expiresAt && Date.parse(input.startsAt) >= Date.parse(input.expiresAt)) throw new ApiError("validation_failed", "The end date must be after the start date.", { expiresAt: ["Before the start"] });
  return input;
}

/** Where the store takes checkouts, and whether it can right now. */
export async function checkoutReadiness(projectId: string) {
  const [p] = await db
    .select({ projectSlug: schema.projects.slug, orgSlug: schema.organizations.slug, live: schema.projects.productionDeploymentId })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(eq(schema.projects.id, projectId));
  const payments = await db.select({ id: schema.storePaymentProviders.id }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.enabled, true)));
  const base = p?.live ? `/s/${p.orgSlug}/${p.projectSlug}` : null;
  const reason = !base ? "Publish your site to production so shoppers can check out." : !payments.length ? "Turn on a payment method (cash on delivery, UPI or a card gateway) under Store → Payments." : null;
  return { base, ready: !reason, reason };
}

const view = (r: Row) => ({
  id: r.id,
  title: r.title,
  token: r.token,
  url: shareUrl(r.token),
  source: r.source as CatalogueSource,
  design: r.design as CatalogueDesign,
  ordering: r.ordering as CatalogueOrdering,
  published: r.published,
  startsAt: r.startsAt?.toISOString() ?? null,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  hasAccessCode: !!r.accessCodeHash,
  allowEmbed: r.allowEmbed,
  origin: r.origin,
  views: r.views,
  orderClicks: r.orderClicks,
  shares: r.shares as Record<string, number>,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
export type CatalogueView = ReturnType<typeof view>;

export async function listCatalogues(projectId: string) {
  const rows = await db.select().from(schema.storeCatalogues).where(eq(schema.storeCatalogues.projectId, projectId)).orderBy(desc(schema.storeCatalogues.updatedAt));
  const catalog = rows.length ? await loadCatalog(projectId) : null;
  const recent = rows.length
    ? await db
        .select({ id: schema.storeCatalogueStats.catalogueId, views: sql<number>`sum(${schema.storeCatalogueStats.views})::int`, orders: sql<number>`sum(${schema.storeCatalogueStats.orders})::int` })
        .from(schema.storeCatalogueStats)
        .where(and(inArray(schema.storeCatalogueStats.catalogueId, rows.map((r) => r.id)), gte(schema.storeCatalogueStats.day, sql`${today} - 29`)))
        .groupBy(schema.storeCatalogueStats.catalogueId)
    : [];
  return rows.map((r) => {
    const sel = catalog ? selectProducts(catalog, r.source as CatalogueSource) : { sections: [], count: 0 };
    const images = sel.sections.flatMap((s) => s.products.flatMap((p) => p.images.slice(0, 1))).slice(0, 4);
    const s30 = recent.find((x) => x.id === r.id);
    return { ...view(r), productCount: sel.count, images, views30: s30?.views ?? 0, orders30: s30?.orders ?? 0 };
  });
}

/** Views and order starts over the last two weeks, where they came from, and what got ordered. */
async function insights(r: Row) {
  const days = await db
    .select({ day: sql<string>`to_char(${schema.storeCatalogueStats.day}, 'YYYY-MM-DD')`, views: sql<number>`sum(${schema.storeCatalogueStats.views})::int`, orders: sql<number>`sum(${schema.storeCatalogueStats.orders})::int` })
    .from(schema.storeCatalogueStats)
    .where(and(eq(schema.storeCatalogueStats.catalogueId, r.id), gte(schema.storeCatalogueStats.day, sql`${today} - 13`)))
    .groupBy(schema.storeCatalogueStats.day);
  const [{ d0 }] = await db.select({ d0: sql<string>`to_char(${today} - 13, 'YYYY-MM-DD')` }).from(sql`(select 1) x`);
  const series = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.parse(`${d0}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const hit = days.find((d) => d.day === day);
    return { day, views: hit?.views ?? 0, orders: hit?.orders ?? 0 };
  });
  const sources = await db
    .select({ source: schema.storeCatalogueStats.source, views: sql<number>`sum(${schema.storeCatalogueStats.views})::int`, orders: sql<number>`sum(${schema.storeCatalogueStats.orders})::int` })
    .from(schema.storeCatalogueStats)
    .where(and(eq(schema.storeCatalogueStats.catalogueId, r.id), gte(schema.storeCatalogueStats.day, sql`${today} - 29`)))
    .groupBy(schema.storeCatalogueStats.source);
  const counts = Object.entries((r.productOrders ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const titles = counts.length ? await db.select({ id: schema.storeProducts.id, title: schema.storeProducts.title }).from(schema.storeProducts).where(inArray(schema.storeProducts.id, counts.map(([id]) => id))) : [];
  return {
    series,
    sources: sources.sort((a, b) => b.views - a.views),
    topProducts: counts.map(([id, qty]) => ({ id, title: titles.find((t) => t.id === id)?.title ?? "Removed product", qty })),
  };
}

export async function getCatalogue(projectId: string, id: string) {
  const [r] = await db.select().from(schema.storeCatalogues).where(and(eq(schema.storeCatalogues.id, id), eq(schema.storeCatalogues.projectId, projectId)));
  if (!r) throw notFound("Catalogue");
  const catalog = await loadCatalog(projectId);
  const sel = catalog ? selectProducts(catalog, r.source as CatalogueSource) : { sections: [], count: 0 };
  // Hand-picked products that aren't active yet: they appear once published in the store.
  const src = r.source as CatalogueSource;
  const waiting = src.mode === "manual" && src.productIds.length ? (await loadProducts(projectId, { ids: src.productIds })).filter((p) => p.status !== "active").length : 0;
  // Exactly what the page shows, for the "as text" share option.
  const items = sel.sections.flatMap((s) => s.products).slice(0, 300).map((p) => ({ title: p.title, price: Math.min(...p.variants.map((v) => v.price)), soldOut: p.variants.every((v) => v.available <= 0) }));
  return { catalogue: view(r), productCount: sel.count, sections: sel.sections.map((s) => ({ title: s.title, count: s.products.length })), items, waiting, checkout: await checkoutReadiness(projectId), insights: await insights(r) };
}

const fields = (input: Awaited<ReturnType<typeof parse>>) => ({
  title: input.title,
  source: input.source,
  design: input.design,
  ordering: input.ordering,
  published: input.published,
  startsAt: input.startsAt ? new Date(input.startsAt) : null,
  expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  allowEmbed: input.allowEmbed,
  ...(input.accessCode === null ? {} : { accessCodeHash: input.accessCode ? codeHash(input.accessCode) : null }),
});

export async function createCatalogue(projectId: string, userId: string, raw: unknown, origin: "manual" | "import" = "manual") {
  const input = await parse(projectId, raw);
  const [r] = await db
    .insert(schema.storeCatalogues)
    .values({ projectId, token: randomToken(9), origin, createdBy: userId, ...fields(input) })
    .returning();
  return view(r);
}

export async function updateCatalogue(projectId: string, id: string, raw: unknown) {
  const input = await parse(projectId, raw);
  const [r] = await db
    .update(schema.storeCatalogues)
    .set({ ...fields(input), updatedAt: new Date() })
    .where(and(eq(schema.storeCatalogues.id, id), eq(schema.storeCatalogues.projectId, projectId)))
    .returning();
  if (!r) throw notFound("Catalogue");
  return view(r);
}

export async function deleteCatalogue(projectId: string, id: string) {
  const rows = await db.delete(schema.storeCatalogues).where(and(eq(schema.storeCatalogues.id, id), eq(schema.storeCatalogues.projectId, projectId))).returning({ id: schema.storeCatalogues.id });
  if (!rows.length) throw notFound("Catalogue");
}

export async function duplicateCatalogue(projectId: string, userId: string, id: string) {
  const { catalogue: c } = await getCatalogue(projectId, id);
  // The copy starts hidden and without the original's access code.
  return createCatalogue(projectId, userId, { title: `${c.title} (copy)`.slice(0, 120), source: c.source, design: c.design, ordering: c.ordering, published: false, startsAt: c.startsAt, expiresAt: c.expiresAt, allowEmbed: c.allowEmbed });
}

/** A new link (the old one, its QR codes and unlocked visitors stop working). */
export async function rotateCatalogueLink(projectId: string, id: string) {
  const [r] = await db.update(schema.storeCatalogues).set({ token: randomToken(9), updatedAt: new Date() }).where(and(eq(schema.storeCatalogues.id, id), eq(schema.storeCatalogues.projectId, projectId))).returning();
  if (!r) throw notFound("Catalogue");
  return view(r);
}

export async function recordShare(projectId: string, id: string, via: (typeof SHARE_CHANNELS)[number]) {
  await db
    .update(schema.storeCatalogues)
    .set({ shares: sql`jsonb_set(${schema.storeCatalogues.shares}, ${`{${via}}`}::text[], to_jsonb(coalesce((${schema.storeCatalogues.shares}->>${via})::int, 0) + 1))` })
    .where(and(eq(schema.storeCatalogues.id, id), eq(schema.storeCatalogues.projectId, projectId)));
}

/** After an import: a catalogue of exactly the products just added, in file order. */
export async function catalogueFromImport(projectId: string, userId: string, productIds: string[], title?: string) {
  if (!productIds.length) return null;
  const store = await getStore(projectId);
  return createCatalogue(
    projectId,
    userId,
    {
      title: (title?.trim() || `${store?.name ?? "Our"} catalogue · ${istDate(new Date())}`).slice(0, 120),
      source: { mode: "manual", productIds: productIds.slice(0, 2000), sort: "manual", groupByCollection: true },
      design: { contactEmail: store?.email ?? "", contactPhone: store?.phone ?? "" },
    },
    "import",
  );
}

/** The store's bestsellers: most units sold in paid, uncancelled orders over 90 days. */
async function bestsellers(projectId: string) {
  const rows = await db
    .select({ productId: schema.storeOrderItems.productId, units: sql<number>`sum(${schema.storeOrderItems.quantity})::int` })
    .from(schema.storeOrderItems)
    .innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeOrderItems.orderId))
    .where(and(eq(schema.storeOrders.projectId, projectId), isNotNull(schema.storeOrders.paidAt), isNull(schema.storeOrders.cancelledAt), gte(schema.storeOrders.createdAt, sql`now() - interval '90 days'`), isNotNull(schema.storeOrderItems.productId)))
    .groupBy(schema.storeOrderItems.productId)
    .orderBy(desc(sql`sum(${schema.storeOrderItems.quantity})`))
    .limit(3);
  return rows.filter((r) => r.units >= 2).map((r) => r.productId!);
}

async function count(catalogueId: string, source: CatalogueChannel, what: "views" | "orders") {
  const col = schema.storeCatalogueStats[what];
  await db
    .insert(schema.storeCatalogueStats)
    .values({ catalogueId, day: sql`${today}` as unknown as string, source, [what]: 1 })
    .onConflictDoUpdate({ target: [schema.storeCatalogueStats.catalogueId, schema.storeCatalogueStats.day, schema.storeCatalogueStats.source], set: { [what]: sql`${col} + 1` } });
}

// ─── Public ──────────────────────────────────────────────────────────────────

async function publicRow(token: string) {
  if (!/^[\w-]{8,32}$/.test(token)) return null;
  const [r] = await db.select().from(schema.storeCatalogues).where(eq(schema.storeCatalogues.token, token));
  if (!r) return null;
  const [p] = await db.select({ archived: schema.projects.archivedAt }).from(schema.projects).where(eq(schema.projects.id, r.projectId));
  if (!p || p.archived) return null;
  return r;
}

type State = { ok: true } | { ok: false; status: number; title: string; text: string };
function stateOf(r: Row): State {
  const now = Date.now();
  if (!r.published || (r.expiresAt && r.expiresAt.getTime() <= now)) return { ok: false, status: 410, title: "This catalogue has ended", text: "It's no longer available. Ask the store for their latest catalogue." };
  if (r.startsAt && r.startsAt.getTime() > now) return { ok: false, status: 403, title: "Opening soon", text: `This catalogue opens on ${istDate(r.startsAt)}. Come back then!` };
  return { ok: true };
}
const unlocked = (r: Row, cookieHeader: string | null) => {
  if (!r.accessCodeHash) return true;
  const have = readCookie(cookieHeader, passCookieName(r.token)) ?? "";
  const want = passFor(r);
  return have.length === want.length && timingSafeEqual(Buffer.from(have), Buffer.from(want));
};

/** Whether the signed-in visitor works on the store that owns this catalogue (for previews). */
export async function canPreview(token: string, cookieHeader: string | null) {
  const session = await resolveSession(readCookie(cookieHeader, SESSION_COOKIE));
  const r = session ? await publicRow(token) : null;
  if (!session || !r) return false;
  const [p] = await db.select({ orgId: schema.projects.orgId }).from(schema.projects).where(eq(schema.projects.id, r.projectId));
  return !!p && !!(await getMembership(session.user.id, p.orgId));
}

/** The catalogue page for a public link (or the owner's preview). */
export async function renderCatalogue(token: string, opts: { preview?: boolean; message?: { tone: "ok" | "bad"; text: string }; ua?: string | null; via?: string | null; cookie?: string | null } = {}) {
  const r = await publicRow(token);
  if (!r) return null;
  const via = channelOf(opts.via);
  if (!opts.preview) {
    const st = stateOf(r);
    if (!st.ok) return { closed: st };
    if (!unlocked(r, opts.cookie ?? null)) return { html: catalogueLockPage({ title: r.title, storeName: (await getStore(r.projectId))?.name ?? "", design: r.design as CatalogueDesign, error: opts.message?.tone === "bad" ? opts.message.text : undefined, via }), allowEmbed: r.allowEmbed };
  }
  const store = await getStore(r.projectId);
  const catalog = await loadCatalog(r.projectId);
  if (!store || !catalog) return null;
  const sel = selectProducts(catalog, r.source as CatalogueSource);
  const ordering = r.ordering as CatalogueOrdering;
  const design = r.design as CatalogueDesign;
  const ready = ordering.checkout ? await checkoutReadiness(r.projectId) : null;
  if (!opts.preview && !isBot(opts.ua ?? null)) {
    await db.update(schema.storeCatalogues).set({ views: sql`${schema.storeCatalogues.views} + 1` }).where(eq(schema.storeCatalogues.id, r.id));
    await count(r.id, via, "views");
  }
  const url = shareUrl(r.token);
  const html = cataloguePage({
    title: r.title,
    storeName: store.name,
    currency: catalog.currency,
    design,
    ordering: { checkout: !!ready?.ready, whatsapp: !!ordering.whatsapp.replace(/\D/g, ""), note: ordering.note, minOrder: ordering.minOrder ?? 0, moq: ordering.moq ?? 1, offerCode: ordering.offerCode ?? "", askBuyer: !!ordering.askBuyer, priceOnRequest: !!ordering.priceOnRequest },
    bestsellers: design.showBestseller ? await bestsellers(r.projectId) : [],
    newSince: new Date(Date.now() - (design.newDays ?? 30) * 86_400_000).toISOString(),
    via,
    sections: sel.sections,
    count: sel.count,
    url,
    // Scans of a printed or shared QR code count as "QR".
    qr: qrSvg(`${url}?via=qr`, { margin: 1 }),
    updatedAt: istDate(new Date()),
    message: opts.message,
    preview: opts.preview,
  });
  return { html, allowEmbed: r.allowEmbed };
}

/** A buyer typed the access code: let them in for 30 days (until the code or link changes). */
export async function unlockCatalogue(token: string, form: FormData): Promise<Response> {
  const via = channelOf(String(form.get("via") ?? ""));
  const r = await publicRow(token);
  const back = (q: string) => redirect(`/c/${encodeURIComponent(token)}?${q}`);
  if (!r?.accessCodeHash) return back(`via=${via}`);
  const tried = codeHash(String(form.get("code") ?? ""));
  const ok = tried.length === r.accessCodeHash.length && timingSafeEqual(Buffer.from(tried), Buffer.from(r.accessCodeHash));
  if (!ok) return back(`via=${via}&err=${encodeURIComponent("That code didn't work. Check it and try again.")}`);
  const secure = (process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  const res = back(`via=${via}`);
  res.headers.append("Set-Cookie", `${passCookieName(r.token)}=${passFor(r)}; Path=/c/${r.token}; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
  return res;
}

/**
 * An order from a catalogue page: quantities arrive as q_<variantId>. Checkout
 * puts them in the store's own cart (so payment, delivery and GST work as
 * usual); WhatsApp sends the owner a ready-written order or quote request.
 */
export async function placeCatalogueOrder(req: Request, token: string, form: FormData): Promise<Response> {
  const via = channelOf(String(form.get("via") ?? ""));
  const back = (text: string) => redirect(`/c/${encodeURIComponent(token)}?via=${via}&err=${encodeURIComponent(text)}`);
  const r = await publicRow(token);
  if (!r || !stateOf(r).ok) return back("This catalogue isn't taking orders right now.");
  if (!unlocked(r, req.headers.get("cookie"))) return back("Enter the access code to order from this catalogue.");
  const catalog = await loadCatalog(r.projectId);
  if (!catalog) return back("This store isn't available.");
  const ordering = r.ordering as CatalogueOrdering;
  const moq = ordering.moq ?? 1;
  const sel = selectProducts(catalog, r.source as CatalogueSource);
  const products = sel.sections.flatMap((s) => s.products);
  const wanted: { qty: number; product: (typeof products)[number]; variant: (typeof products)[number]["variants"][number] }[] = [];
  for (const [k, v] of form.entries()) {
    const m = /^q_([0-9a-f-]{36})$/i.exec(k);
    const qty = Math.min(Math.max(Math.floor(Number(v)) || 0, 0), MAX_LINE_QTY);
    if (!m || !qty) continue;
    const product = products.find((p) => p.variants.some((x) => x.id === m[1]));
    const variant = product?.variants.find((x) => x.id === m[1]);
    // Only products this catalogue shows can be ordered from it.
    if (!product || !variant) return back("Some items are no longer in this catalogue. Please review your order.");
    if (variant.available < qty) return back(variant.available > 0 ? `Only ${variant.available} of “${product.title}” left.` : `“${product.title}” has just sold out.`);
    if (qty < moq) return back(`The minimum is ${moq} per item — “${product.title}” has ${qty}.`);
    wanted.push({ qty, product, variant });
  }
  if (!wanted.length) return back("Choose how many of each item you'd like first.");
  const total = wanted.reduce((a, w) => a + w.qty * w.variant.price, 0);
  const intent = String(form.get("intent") ?? "");
  const enquiry = !!ordering.priceOnRequest;
  if (!enquiry && ordering.minOrder && total < ordering.minOrder) return back(`The minimum order is ${formatPrice(ordering.minOrder, catalog.currency)} — add ${formatPrice(ordering.minOrder - total, catalog.currency)} more.`);

  const tally = async () => {
    const add = Object.fromEntries(wanted.map((w) => [w.product.id, 0]));
    for (const w of wanted) add[w.product.id] += w.qty;
    let merged = sql`${schema.storeCatalogues.productOrders}`;
    for (const [id, q] of Object.entries(add)) merged = sql`jsonb_set(${merged}, ${`{${id}}`}::text[], to_jsonb(coalesce((${schema.storeCatalogues.productOrders}->>${id})::int, 0) + ${q}))`;
    await db.update(schema.storeCatalogues).set({ orderClicks: sql`${schema.storeCatalogues.orderClicks} + 1`, productOrders: merged }).where(eq(schema.storeCatalogues.id, r.id));
    await count(r.id, via, "orders");
  };

  if (intent === "whatsapp") {
    const number = ordering.whatsapp.replace(/\D/g, "");
    if (!number) return back("WhatsApp orders are turned off for this catalogue.");
    const name = String(form.get("buyer_name") ?? "").trim().slice(0, 80);
    const phone = String(form.get("buyer_phone") ?? "").trim().slice(0, 20);
    if (ordering.askBuyer && (!name || phone.replace(/\D/g, "").length < 7)) return back("Add your name and phone number so the store can reach you.");
    await tally();
    const text = whatsappOrderText({ catalogue: r.title, url: shareUrl(r.token), currency: catalog.currency, enquiry, code: ordering.offerCode || undefined, name: name || undefined, phone: phone || undefined, lines: wanted.map((w) => ({ qty: w.qty, title: w.product.title, variant: w.variant.title, price: w.variant.price })) });
    return redirect(`https://wa.me/${number}?text=${encodeURIComponent(text)}`);
  }

  if (enquiry) return back("Prices are on request for this catalogue — please ask for a quote on WhatsApp.");
  const ready = ordering.checkout ? await checkoutReadiness(r.projectId) : null;
  if (!ready?.ready || !ready.base) return back("Online checkout isn't open for this catalogue yet. Please order on WhatsApp or contact the store.");
  const cookieName = cartCookieName(r.projectId);
  const { cart, token: cartToken, created } = await cartFor(r.projectId, readCookie(req.headers.get("cookie"), cookieName), true);
  if (!cart) return back("Couldn't start your order. Please try again.");
  let items = [...((cart.items as CartItem[]) ?? [])];
  for (const w of wanted) {
    const existing = items.find((i) => i.variantId === w.variant.id);
    items = existing ? items.map((i) => (i.variantId === w.variant.id ? { ...i, qty: Math.min(w.qty, w.variant.available, MAX_LINE_QTY) } : i)) : [...items, { variantId: w.variant.id, qty: w.qty }];
  }
  // The catalogue's offer code rides along, if it's still a live discount.
  let discountCode: string | undefined;
  if (ordering.offerCode) {
    const [d] = await db.select({ active: schema.storeDiscounts.active, endsAt: schema.storeDiscounts.endsAt }).from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, r.projectId), sql`upper(${schema.storeDiscounts.code}) = ${ordering.offerCode}`));
    if (d?.active && (!d.endsAt || d.endsAt.getTime() > Date.now())) discountCode = ordering.offerCode;
  }
  await saveCart(cart.id, { items: items.slice(-50), ...(discountCode ? { discountCode } : {}) });
  await tally();
  return redirect(`${ready.base}/checkout`, created && cartToken ? cartCookie(cookieName, cartToken) : undefined);
}
