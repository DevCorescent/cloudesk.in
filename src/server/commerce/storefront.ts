import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { fillDataLists } from "../data/site";
import { fillConnected } from "../site/connected";
import { db, schema } from "@/db";
import type { SiteDoc } from "@/lib/site/model";
import { fillCommerce, renderShell, type RenderMode } from "@/lib/site/render";
import { availableCurrencies, convertMinor, presentment, type StoreCurrency } from "@/lib/store/fx";
import { accountPage, cartPage, currencyBar, checkoutPage, memberGatePage, orderPage, policyPage, productPage, shopPage, STORE_FORMS, trackPage, type Catalog, type SfOrder, type SfProduct } from "@/lib/store/storefront";
import type { Address } from "@/lib/store/shipping";
import { readCookie } from "../auth/session";
import { clientIp } from "../http/handler";
import { rateLimit } from "../security/rate-limit";
import { getStore, listCollections, loadProducts, type CheckoutSettings, type Policies, type StoreRow } from "./catalog";
import { appUrl } from "../services/mail";
import { addDays, googleCalendarLink, localDate } from "@/lib/bookings/slots";
import { bookIndexPage, bookingPage, bookServicePage } from "@/lib/bookings/pages";
import { availability, bookingByKey, getBookingSettings, listServices, onlineProviders } from "../bookings/bookings";
import { chatLink, chatNumber, whatsappActive } from "./whatsapp";
import { MAX_DOWNLOADS } from "./digital";
import { intervalLabel } from "./subscriptions";
import { customerOrders, RETURN_REASONS, returnEligibility, returnWindowDays, verifyAccountToken, type ReturnItem } from "./customer";
import { cartCookieName, findCart, quoteCart, shippingSetup } from "./cart";
import { cartExtras } from "../promotions/service";
import { findOrderForTracking, getOrderByKey, orderLabel, releaseExpired } from "./orders";

/** The shopper's chosen currency (kept on their cart), if the store offers it. */
export async function shopperCurrency(projectId: string, store: Pick<StoreRow, "currency" | "currencies">, cookieHeader: string | null) {
  if (!(store.currencies as StoreCurrency[]).length) return null;
  const cart = await findCart(projectId, readCookie(cookieHeader, cartCookieName(projectId)));
  return presentment(store.currency, store.currencies as StoreCurrency[], cart?.currency);
}

export async function loadCatalog(projectId: string, cur: StoreCurrency | null = null): Promise<Catalog | null> {
  const store = await getStore(projectId);
  if (!store) return null;
  const price = (n: number) => (cur ? convertMinor(n, store.currency, cur, { price: true }) : n);
  const [all, collections] = await Promise.all([loadProducts(projectId, { status: "active" }), listCollections(projectId)]);
  // Template samples fill an empty shop; once the owner has real products, shoppers only see those.
  const products = all.some((p) => !p.isSample) ? all.filter((p) => !p.isSample) : all;
  const ratings = products.length
    ? await db
        .select({ productId: schema.storeReviews.productId, avg: sql<number>`avg(${schema.storeReviews.rating})::float`, count: sql<number>`count(*)::int` })
        .from(schema.storeReviews)
        .where(and(eq(schema.storeReviews.projectId, projectId), eq(schema.storeReviews.status, "approved"), inArray(schema.storeReviews.productId, products.map((p) => p.id))))
        .groupBy(schema.storeReviews.productId)
    : [];
  return {
    currency: cur?.code ?? store.currency,
    currencies: availableCurrencies(store.currency, store.currencies as StoreCurrency[]),
    collections: collections.map((c) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description, image: c.image, productCount: c.productCount })),
    products: products
      .filter((p) => p.variants.length)
      .map<SfProduct>((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        images: p.images as string[],
        vendor: p.vendor,
        tags: p.tags,
        featured: p.featured,
        createdAt: p.createdAt.toISOString(),
        collectionIds: p.collectionIds,
        options: p.options as SfProduct["options"],
        isSample: p.isSample,
        variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: price(v.price), compareAt: v.compareAt === null ? null : price(v.compareAt), available: v.trackInventory ? Math.max(0, v.stock) : 99, options: v.options as Record<string, string>, sku: v.sku })),
        rating: (() => {
          const r = ratings.find((x) => x.productId === p.id);
          return r ? { avg: r.avg, count: r.count } : undefined;
        })(),
      })),
  };
}

export async function cartCount(projectId: string, cookieHeader: string | null) {
  const cart = await findCart(projectId, readCookie(cookieHeader, cartCookieName(projectId)));
  return ((cart?.items as { qty: number }[]) ?? []).reduce((a, i) => a + i.qty, 0);
}

export const isCommercePath = (path: string) => /^\/(shop(\/[a-z0-9-]+)?|product\/[a-z0-9-]+|cart|checkout|order\/\d+|track|account|book(\/[0-9a-f-]{36})?|booking\/[0-9a-f-]{36}|policies\/(refund|shipping|privacy|terms))$/.test(path);

const POLICY_TITLES: Record<string, string> = { refund: "Refund policy", shipping: "Shipping policy", privacy: "Privacy policy", terms: "Terms of service" };

/** Renders a dynamic storefront page, or null when the path is not a store page. */
export async function renderStorePage(req: Request, projectId: string, doc: SiteDoc, path: string, base: string, mode: RenderMode, extra: { trackForm?: FormData } = {}): Promise<{ html: string; status: number } | null> {
  if (!isCommercePath(path)) return null;
  const store = await getStore(projectId);
  if (!store) return null;
  const url = new URL(req.url);
  const formBase = STORE_FORMS(projectId);
  const cookie = req.headers.get("cookie");
  const cur = await shopperCurrency(projectId, store, cookie);
  const catalog = (await loadCatalog(projectId, cur))!;
  // Shop, product and cart pages offer the store's other currencies.
  const switcher = (catalog.currencies?.length ?? 0) > 1 && /^(shop|product|cart)$/.test(path.split("/")[1] ?? "") ? currencyBar({ codes: catalog.currencies!, current: catalog.currency, formBase, base, returnTo: path + url.search }) : "";
  const shell = (title: string, main: string, opts: { noindex?: boolean; description?: string; status?: number } = {}) => ({
    html: renderShell(doc, mode, { title, main: switcher + main, noindex: opts.noindex, description: opts.description }),
    status: opts.status ?? 200,
  });
  const notFound = () => shell("Not found", `<section class="sec"><div class="wrap narrow sf-empty"><h1>Page not found</h1><a class="btn btn-secondary" href="${base}/shop">Back to the shop</a></div></section>`, { status: 404, noindex: true });
  const policies = store.policies as Policies;
  const checkoutCfg = store.checkout as CheckoutSettings;

  const seg = path.split("/").filter(Boolean);
  const wa = seg[0] === "product" || seg[0] === "order" ? await chatNumber(projectId) : null;
  if (seg[0] === "shop") {
    const collection = seg[1] ? catalog.collections.find((c) => c.slug === seg[1]) : null;
    if (seg[1] && !collection) return notFound();
    const q = { q: (url.searchParams.get("q") ?? "").slice(0, 100), sort: url.searchParams.get("sort") ?? "featured", min: url.searchParams.get("min") ?? "", max: url.searchParams.get("max") ?? "", inStock: url.searchParams.get("stock") === "1", page: Number(url.searchParams.get("page")) || 1 };
    return shell(collection?.title ?? "Shop", shopPage(catalog, base, q, collection ?? null, store.name), { description: collection?.description || `Shop ${store.name}` });
  }
  if (seg[0] === "product") {
    const p = catalog.products.find((x) => x.slug === seg[1]);
    if (!p) return notFound();
    const reviews = await db
      .select()
      .from(schema.storeReviews)
      .where(and(eq(schema.storeReviews.productId, p.id), eq(schema.storeReviews.status, "approved")))
      .orderBy(desc(schema.storeReviews.createdAt))
      .limit(50);
    const [row] = await db.select({ seoTitle: schema.storeProducts.seoTitle, seoDescription: schema.storeProducts.seoDescription }).from(schema.storeProducts).where(eq(schema.storeProducts.id, p.id));
    const msg = url.searchParams.get("err") ?? undefined;
    return shell(row?.seoTitle || p.title, productPage(p, { catalog, base, formBase, reviews: reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), message: msg, policies, trust: checkoutCfg.showTrustBadges !== false, reviewSubmitted: url.searchParams.get("review") === "1", chatUrl: wa ? chatLink(wa, `Hi! I have a question about “${p.title}”: ${appUrl(`${base}/product/${p.slug}`)}`) : null }), { description: row?.seoDescription || p.description.slice(0, 160) });
  }
  if (seg[0] === "cart" || seg[0] === "checkout") {
    await releaseExpired(projectId);
    const cart = await findCart(projectId, readCookie(cookie, cartCookieName(projectId)));
    const q = cart ? await quoteCart(projectId, cart) : null;
    const lines = (q?.lines ?? []).map((l) => ({ variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, slug: l.slug, image: l.image, unitPrice: l.unitPrice, compareAt: l.compareAt, quantity: l.quantity, available: l.available }));
    const totals = { ...(q?.totals ?? { subtotal: 0, discount: 0, shipping: 0, fee: 0, tax: 0, total: 0, taxIncluded: store.pricesIncludeTax }), giftCard: q?.giftCard?.applied ?? 0 };
    const sample = q?.lines.some((l) => l.isSample);
    const hasPayment = (await db.select({ id: schema.storePaymentProviders.id }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.enabled, true)))).length > 0;
    const closedReason = sample ? "This store is still showing sample products, so checkout is not open yet." : !hasPayment ? "This store has not set up payments yet." : undefined;
    if (seg[0] === "cart" || !lines.length || closedReason) {
      const buyable = catalog.products.some((p) => !p.isSample) ? catalog.products.filter((p) => !p.isSample) : catalog.products;
      const extras = lines.length
        ? await cartExtras(projectId, {
            subtotal: totals.subtotal,
            currency: q?.currency ?? catalog.currency,
            inCart: (q?.lines ?? []).map((l) => ({ productId: l.productId })),
            products: buyable.map((p) => ({ id: p.id, slug: p.slug, title: p.title, image: p.images[0] ?? null, price: p.variants[0]?.price ?? 0, collectionIds: p.collectionIds, variantId: p.variants.length === 1 && p.variants[0].available > 0 ? p.variants[0].id : null })),
            base,
            formBase,
          })
        : null;
      return shell("Cart", cartPage({ extras, lines, totals, currency: q?.currency ?? catalog.currency, base, formBase, problems: q?.problems ?? [], notice: url.searchParams.get("m") === "added" ? "Added to your cart." : url.searchParams.get("m") === "recovered" ? `Welcome back — your cart is just as you left it.${/^[A-Z0-9_-]{1,40}$/.test(url.searchParams.get("code") ?? "") ? ` Code ${url.searchParams.get("code")} is applied.` : ""}` : undefined, message: url.searchParams.get("err") ?? undefined, discount: q?.discount ?? null, giftCard: q?.giftCard ?? null, checkoutOpen: !closedReason, closedReason }), { noindex: true });
    }
    const addr = cart!.address as Address | null;
    const step = addr && cart!.email && url.searchParams.get("edit") !== "1" ? "pay" : "details";
    const { zones } = await shippingSetup(projectId);
    const errors = url.searchParams.get("err") ? [url.searchParams.get("err")!] : [];
    return shell(
      "Checkout",
      checkoutPage({
        step,
        base,
        formBase,
        currency: q?.currency ?? catalog.currency,
        lines,
        totals,
        email: cart!.email,
        phone: addr?.phone ?? "",
        address: addr,
        rates: q!.rates.map((r) => ({ id: r.id, name: r.name, price: r.price, eta: r.eta })),
        selectedRate: cart!.shippingRateId,
        payments: q!.payments,
        selectedPayment: cart!.paymentMethod,
        errors: [...q!.problems, ...errors],
        requirePhone: checkoutCfg.requirePhone !== false,
        allowNotes: checkoutCfg.orderNotes !== false,
        termsRequired: !!checkoutCfg.termsRequired,
        defaultCountry: store.country,
        discountCode: q!.discount?.ok ? q!.discount.code : null,
        marketingConsent: cart!.marketingConsent,
        whatsapp: await whatsappActive(projectId),
        whatsappOptIn: cart!.whatsappOptIn,
        gst: store.country === "IN",
        buyerGstin: cart!.buyerGstin,
        buyerBusinessName: cart!.buyerBusinessName,
        shipCountries: [...new Set(zones.flatMap((z) => z.countries))],
      }),
      { noindex: true },
    );
  }
  const flash = { message: url.searchParams.get("return") === "1" ? "Your return request was sent. The store will reply by email." : url.searchParams.get("sub") === "cancelled" ? "Your subscription is cancelled. It ends after the period you've paid for." : undefined, error: url.searchParams.get("err") ?? undefined };
  if (seg[0] === "order") {
    const key = url.searchParams.get("key") ?? "";
    const found = await getOrderByKey(projectId, Number(seg[1]), key);
    if (!found) return notFound();
    const sf = await withReturns(await toSfOrder(found, store.name, store.orderPrefix), found, store, { key });
    if (found.order.subscriptionId) {
      const [sub] = await db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.id, found.order.subscriptionId));
      if (sub && sub.firstOrderId === found.order.id) sf.subscription = { label: `${sub.title} — ${intervalLabel(sub.interval, sub.intervalCount).toLowerCase()}`, status: sub.status, renewsOn: sub.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, cancel: { number: found.order.number, key } };
    }
    if (["paid", "partially_refunded"].includes(found.order.financialStatus) && !found.order.cancelledAt)
      sf.downloads = found.items.filter((i) => i.kind === "digital").map((i) => ({ title: i.title, url: `${formBase}/orders/${found.order.number}/download/${i.id}?key=${encodeURIComponent(key)}`, remaining: Math.max(0, MAX_DOWNLOADS * i.quantity - i.downloads) }));
    return shell(`Order ${orderLabel(store.orderPrefix, found.order.number)}`, orderPage(sf, { base, formBase, justPlaced: url.searchParams.get("placed") === "1", paymentFailed: url.searchParams.get("payment") === "failed", ...flash, chatUrl: wa ? chatLink(wa, `Hi! I have a question about my order ${orderLabel(store.orderPrefix, found.order.number)}.`) : null }), { noindex: true });
  }
  if (seg[0] === "account" && !seg[1]) {
    const token = url.searchParams.get("token");
    if (!token) return shell("Your orders", accountPage({ base, formBase, storeName: store.name, sent: url.searchParams.get("sent") === "1", error: flash.error }), { noindex: true });
    const email = verifyAccountToken(projectId, token);
    if (!email) return shell("Your orders", accountPage({ base, formBase, storeName: store.name, error: "That link has expired. Enter your email to get a new one." }), { noindex: true });
    const list = await customerOrders(projectId, email);
    const orders = await Promise.all(list.map(async (f) => withReturns(await toSfOrder(f, store.name, store.orderPrefix), f, store, { token }, f.returns)));
    return shell("Your orders", accountPage({ base, formBase, storeName: store.name, orders, ...flash }), { noindex: true });
  }
  if (seg[0] === "track") {
    if (extra.trackForm) {
      const number = Number(String(extra.trackForm.get("number") ?? "").replace(/\D/g, ""));
      const email = String(extra.trackForm.get("email") ?? "");
      // Order numbers run in sequence: limit guesses for one email, and from one address.
      const limited = await Promise.all([rateLimit(`track:${projectId}:${clientIp(req) ?? "?"}`, 20, 600_000), rateLimit(`track:${projectId}:${email.trim().toLowerCase()}`, 10, 600_000)]).then(() => false, () => true);
      if (limited) return shell("Track your order", trackPage({ base, formBase, error: "Too many tries — wait a few minutes and try again." }), { noindex: true });
      const found = number && email ? await findOrderForTracking(projectId, number, email) : null;
      if (found) return shell(`Order ${orderLabel(store.orderPrefix, found.order.number)}`, orderPage(await toSfOrder(found, store.name, store.orderPrefix), { base, justPlaced: false }), { noindex: true });
      return shell("Track your order", trackPage({ base, formBase, error: "We could not find an order with that number and email." }), { noindex: true });
    }
    return shell("Track your order", trackPage({ base, formBase }));
  }
  if (seg[0] === "book") {
    const services = await listServices(projectId, true);
    const view = (s: (typeof services)[number]) => ({ id: s.id, name: s.name, description: s.description, durationMin: s.durationMin, price: s.price, payment: s.payment, capacity: s.capacity });
    if (!seg[1]) return shell("Book an appointment", bookIndexPage(services.map(view), { base, currency: store.currency, storeName: store.name }));
    const svc = services.find((s) => s.id === seg[1]);
    if (!svc) return notFound();
    const st = await getBookingSettings(projectId);
    const today = localDate(new Date(), st.timezone);
    const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
    const days = [];
    for (let i = 0; i < Math.min(14, st.maxDaysAhead + 1); i++) {
      const date = addDays(today, i);
      const a = await availability(projectId, svc.id, date);
      days.push({ date, label: fmt(date, { day: "numeric", month: "short" }), weekday: fmt(date, { weekday: "short" }), open: !!a?.slots.length });
    }
    const wanted = url.searchParams.get("date") ?? "";
    const date = days.some((d) => d.date === wanted) ? wanted : (days.find((d) => d.open)?.date ?? today);
    const a = await availability(projectId, svc.id, date);
    const payments = (await onlineProviders(projectId)).map((p) => ({ id: p.id, name: p.name }));
    return shell(
      `Book ${svc.name}`,
      bookServicePage(view(svc), { base, formBase, currency: store.currency, tz: st.timezone, days, date, slots: (a?.slots ?? []).map((x) => ({ time: x.time, start: x.start.toISOString(), remaining: x.remaining })), time: url.searchParams.get("time") ?? undefined, payments, error: url.searchParams.get("err") ?? undefined }),
      { noindex: !!url.searchParams.get("time") },
    );
  }
  if (seg[0] === "booking") {
    const key = url.searchParams.get("key") ?? "";
    const b = await bookingByKey(projectId, seg[1], key);
    if (!b) return notFound();
    const st = await getBookingSettings(projectId);
    const when = new Intl.DateTimeFormat("en-IN", { timeZone: st.timezone, dateStyle: "full", timeStyle: "short" }).format(b.startsAt);
    const cancellable = !b.cancelledAt && b.startsAt.getTime() - Date.now() >= st.cancelHours * 3600_000;
    return shell(
      "Your booking",
      bookingPage(
        {
          id: b.id,
          serviceName: b.serviceName,
          when,
          tz: st.timezone,
          name: b.name,
          email: b.email,
          status: b.status,
          amount: b.amount,
          currency: b.currency,
          paid: b.paid,
          paymentMethod: b.paymentMethod,
          googleLink: googleCalendarLink(`${b.serviceName} — ${store.name}`, b.startsAt, b.endsAt, `Booked with ${store.name}`),
          icsLink: `${formBase}/bookings/${b.id}/ics?key=${encodeURIComponent(key)}`,
          canCancel: cancellable && b.status !== "completed",
          cancelNote: !b.cancelledAt && !cancellable && b.startsAt > new Date() ? `Online cancellation closes ${st.cancelHours} hours before your booking. Please contact us.` : "",
        },
        { base, formBase, key, justBooked: url.searchParams.get("booked") === "1", paymentFailed: url.searchParams.get("payment") === "failed", message: url.searchParams.get("cancelled") === "1" ? "Your booking was cancelled." : undefined, error: url.searchParams.get("err") ?? undefined },
      ),
      { noindex: true },
    );
  }
  if (seg[0] === "policies") {
    const body = policies[seg[1] as keyof Policies];
    if (!body) return notFound();
    return shell(POLICY_TITLES[seg[1]], policyPage(POLICY_TITLES[seg[1]], body));
  }
  return null;
}

/** Adds return history and, when allowed, a return form authorised by the order key or account link. */
async function withReturns(sf: SfOrder, found: { order: typeof schema.storeOrders.$inferSelect; items: (typeof schema.storeOrderItems.$inferSelect)[] }, store: StoreRow, auth: { key?: string; token?: string }, preloaded?: (typeof schema.storeReturns.$inferSelect)[]) {
  const rets = preloaded ?? (await db.select().from(schema.storeReturns).where(eq(schema.storeReturns.orderId, found.order.id)));
  const ok = returnEligibility(found.order, returnWindowDays(store.checkout), rets);
  const taken = new Map<string, number>();
  for (const r of rets.filter((x) => x.status !== "rejected")) for (const it of r.items as ReturnItem[]) taken.set(it.itemId, (taken.get(it.itemId) ?? 0) + it.quantity);
  const items = found.items.map((i) => ({ id: i.id, title: i.title, variantTitle: i.variantTitle, max: Math.min(99, i.quantity - (taken.get(i.id) ?? 0)) })).filter((i) => i.max > 0);
  return {
    ...sf,
    number: found.order.number,
    returns: rets.map((r) => ({ status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString(), items: (r.items as ReturnItem[]).map((i) => ({ title: i.title, quantity: i.quantity })) })),
    returnForm: ok.ok && items.length ? { auth, items, reasons: RETURN_REASONS } : null,
    returnNote: ok.ok ? undefined : found.order.fulfillmentStatus === "delivered" ? ok.reason : undefined,
  };
}

async function toSfOrder(found: { order: typeof schema.storeOrders.$inferSelect; items: (typeof schema.storeOrderItems.$inferSelect)[] }, storeName: string, prefix: string): Promise<SfOrder> {
  const o = found.order;
  const [mrow] = o.paymentMethod === "manual" ? await db.select({ settings: schema.storePaymentProviders.settings }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, o.projectId), eq(schema.storePaymentProviders.provider, "manual"))) : [];
  const ms = (mrow?.settings ?? {}) as { label?: string; upiId?: string; instructions?: string };
  return {
    label: orderLabel(prefix, o.number),
    createdAt: o.createdAt.toISOString(),
    email: o.email,
    address: o.shippingAddress as SfOrder["address"],
    items: found.items.map((i) => ({ title: i.title, variantTitle: i.variantTitle, quantity: i.quantity, total: i.total, image: i.image })),
    totals: { subtotal: o.subtotal, discount: o.discountTotal, shipping: o.shippingTotal, fee: o.feeTotal, tax: o.taxTotal, total: o.total, taxIncluded: o.taxIncluded, giftCard: o.giftCardTotal },
    currency: o.currency,
    paymentMethod: o.paymentMethod,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    cancelled: !!o.cancelledAt,
    shippingMethod: (o.shippingMethod as { name: string } | null)?.name ?? "",
    tracking: o.tracking as SfOrder["tracking"],
    manual: o.paymentMethod === "manual" ? { label: ms.label ?? "UPI / bank transfer", upiId: ms.upiId, instructions: ms.instructions, storeName } : null,
  };
}

/** Fills live commerce data into a static published page. */
export async function fillStaticPage(input: string, projectId: string, base: string, cookieHeader: string | null) {
  if (!input.includes("<!--cc:")) return input;
  const html = await fillConnected(await fillDataLists(input, projectId), projectId);
  const store = html.includes("<!--cc:product") || html.includes("<!--cc:collection") ? await getStore(projectId) : null;
  const catalog = store ? await loadCatalog(projectId, await shopperCurrency(projectId, store, cookieHeader)) : null;
  const count = html.includes("<!--cc:cart-->") ? await cartCount(projectId, cookieHeader) : 0;
  return fillCommerce(html, catalog, base, count);
}

/** The sign-in page shown in place of a members-only page. */
export async function renderMemberGate(req: Request, projectId: string, doc: SiteDoc, path: string, base: string, mode: RenderMode) {
  const store = await getStore(projectId);
  const url = new URL(req.url);
  const main = memberGatePage({ base, formBase: STORE_FORMS(projectId), path, storeName: store?.name ?? doc.name, sent: url.searchParams.get("sent") === "1", error: url.searchParams.get("err") ?? undefined });
  return renderShell(doc, mode, { title: "Members only", main, noindex: true });
}
