import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { quoteCart } from "@/server/commerce/cart";
import { setLabelHttp } from "@/server/commerce/labels";
import { setPaymentHttp } from "@/server/commerce/payments";
import * as storeHooks from "@/app/api/v1/store/[projectId]/webhooks/[provider]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let depId = "";
let intlRate = "";
const BASE = "/s/x/y";
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });

async function post(handler: typeof cartRoute.POST, fields: Record<string, string>, c = "") {
  const f = new FormData();
  f.set("_base", BASE);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/api/v1/store/${projectId}/x`, { method: "POST", headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? c };
}
const page = async (path: string, c: string) => (await siteServe.GET(new Request(`${ORIGIN}/sites/${depId}${path}`, { headers: { cookie: c } }), { params: Promise.resolve({ deploymentId: depId, path: path.split("/").filter(Boolean) }) })).text();

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Ina Intl", email: "ina@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Loom" } })).json.project.id;
  await store("POST", "setup", { name: "Loom", template: "home", country: "IN", region: "Karnataka", email: "owner@example.com", replaceDesign: true });
  for (const p of (await store("GET", "products")).json.products) await store("DELETE", `products/${p.id}`);
  setPaymentHttp(async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/balance")) return Response.json({ object: "balance" });
    if (url.endsWith("/v1/checkout/sessions")) return Response.json({ id: "cs_intl_1", url: "https://checkout.stripe.com/c/pay/intl" });
    return Response.json({ error: { message: "unexpected" } }, { status: 400 });
  });
  await store("PUT", "payments/stripe", { enabled: true, credentials: { secretKey: "sk_test_abcdef123456", webhookSecret: "whsec_x" } });
  await store("PUT", "payments/cod", { enabled: true, credentials: {} });
  // International shipping at a flat ₹1,200.
  type Z = { name: string; countries: string[]; regions: string[]; postalPrefixes: string[]; rates: Record<string, unknown>[] };
  const s = (await store("GET", "shipping")).json as { zones: Z[] };
  const clean = (z: Z) => ({ name: z.name, countries: z.countries, regions: z.regions, postalPrefixes: z.postalPrefixes, rates: z.rates.map(({ name, kind, amount, freeOver, weightTiers, eta, codAllowed }) => ({ name, kind, amount, freeOver, weightTiers, eta, codAllowed })) });
  const saved = await store("PUT", "shipping", { zones: [...s.zones.map(clean), { name: "Rest of world", countries: ["US", "DE"], regions: [], postalPrefixes: [], rates: [{ name: "International", kind: "flat", amount: 120000, freeOver: null, weightTiers: [], eta: "7-12 days", codAllowed: false }] }] });
  intlRate = saved.json.zones.find((z: Z) => z.name === "Rest of world").rates[0].id;
  depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
});
afterAll(async () => {
  setPaymentHttp((i, init) => fetch(i, init));
  await closeDb();
});

describe("multi-currency storefront", () => {
  let variantId = "";

  it("validates the store's currencies", async () => {
    const p = await store("POST", "products", { title: "Linen throw", status: "active", variants: [{ options: {}, price: 149900, compareAt: 199900, stock: 20 }] });
    variantId = p.json.product.variants[0].id;
    expect((await store("PUT", "currencies", { currencies: [{ code: "INR", rate: "1", rounding: "none" }] })).status).toBe(422);
    expect((await store("PUT", "currencies", { currencies: [{ code: "USD", rate: "-1", rounding: "none" }] })).status).toBe(422);
    expect((await store("PUT", "currencies", { currencies: [{ code: "XYZ", rate: "1", rounding: "none" }] })).status).toBe(422);
    const ok = await store("PUT", "currencies", { currencies: [{ code: "usd", rate: "0.012", rounding: "x.99" }, { code: "EUR", rate: "0.011", rounding: "none" }] });
    expect(ok.status).toBe(200);
    expect(ok.json.store.currencies.map((c: { code: string }) => c.code)).toEqual(["USD", "EUR"]);
  });

  it("shows prices in the shopper's currency and keeps checkout in it", async () => {
    const add = await post(cartRoute.POST, { action: "add", variant: variantId, qty: "2" });
    let html = await page("/cart", add.cookie);
    expect(html).toContain("₹2,998");
    expect(html).toMatch(/<select name="currency"[^>]*>[\s\S]*<option value="USD">USD<\/option>/);
    const sw = await post(cartRoute.POST, { action: "currency", currency: "usd", return: "/cart" }, add.cookie);
    expect(sw.location).toBe(`${BASE}/cart`);
    html = await page("/cart", add.cookie);
    expect(html).toContain("$35.98"); // 2 × $17.99 (₹1,499 at 0.012, rounded to .99)
    const product = await page("/shop", add.cookie);
    expect(product).toContain("$17.99");
    expect(product).toContain("$23.99"); // compare-at ₹1,999 → $23.99

    await post(checkoutRoute.POST, { step: "details", email: "amy@example.com", phone: "5550100", name: "Amy Ray", line1: "1 Main St", line2: "", city: "Austin", region: "TX", postalCode: "73301", country: "US" }, add.cookie);
    const [cart] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.projectId, projectId));
    const q = await quoteCart(projectId, cart);
    expect(q.currency).toBe("USD");
    expect(q.selectedRate).toBeNull();
    expect(q.rates.find((r) => r.id === intlRate)!.price).toBe(1440); // ₹1,200 → $14.40 exact (no price rounding on shipping)
    expect(q.payments.map((p) => p.id)).toEqual(["stripe"]); // no cash on delivery in USD
    const placed = await post(checkoutRoute.POST, { step: "place", rate: intlRate, payment: "stripe" }, add.cookie);
    expect(placed.location).toBe("https://checkout.stripe.com/c/pay/intl");
    const [order] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.email, "amy@example.com")));
    expect(order).toMatchObject({ currency: "USD", subtotal: 3598, shippingTotal: 1440, exchangeRate: "0.012" });
    expect(order.baseTotal).toBe(Math.round((order.total / 100 / 0.012) * 100));
    // Reports add up in rupees.
    const ins = (await store("GET", "insights?days=30")).json;
    expect(JSON.stringify(ins)).toContain(String(order.baseTotal));
  });

  it("keeps gift cards and cash in the base currency", async () => {
    const add = await post(cartRoute.POST, { action: "add", variant: variantId, qty: "1" });
    await post(cartRoute.POST, { action: "currency", currency: "EUR", return: "/cart" }, add.cookie);
    const carts = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.currency, "EUR"));
    const q = await quoteCart(projectId, { ...carts[0], giftCardCode: "ANYCODE" });
    expect(q.giftCard).toMatchObject({ ok: false, reason: "Gift cards can be used when paying in INR." });
    expect(q.lines[0].unitPrice).toBe(1649); // exact: ₹1,499 × 0.011 = €16.489 → €16.49
    // Back to rupees: everything is as before.
    await post(cartRoute.POST, { action: "currency", currency: "INR", return: "/cart" }, add.cookie);
    expect(await page("/cart", add.cookie)).toContain("₹1,499");
  });
});

describe("shipping labels (EasyPost and Shippo)", () => {
  type Req = { url: string; method: string; body: Record<string, unknown> | null; auth: string };
  let reqs: Req[] = [];
  let orderId = "";

  beforeAll(async () => {
    setLabelHttp(async (input, init) => {
      const url = String(input);
      const r = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") };
      reqs.push(r);
      if (url.includes("easypost.com/v2/addresses")) return Response.json({ addresses: [] });
      if (url.endsWith("easypost.com/v2/shipments")) return Response.json({ id: "shp_1", rates: [{ id: "rate_ups", carrier: "UPS", service: "Expedited", rate: "41.20", currency: "USD", delivery_days: 4 }, { id: "rate_usps", carrier: "USPS", service: "PriorityMailInternational", rate: "35.10", currency: "USD", delivery_days: 7 }] });
      if (url.endsWith("/v2/shipments/shp_1/buy")) return Response.json({ id: "shp_1", tracking_code: "9400111", postage_label: { label_url: "https://easypost-files.s3.amazonaws.com/label.png" }, tracker: { id: "trk_1", public_url: "https://track.easypost.com/trk_1" } });
      if (url.includes("goshippo.com/carrier_accounts")) return Response.json({ results: [] });
      if (url.endsWith("goshippo.com/customs/declarations/")) return Response.json({ object_id: "cust_1" });
      if (url.endsWith("goshippo.com/shipments/")) return Response.json({ object_id: "shp_s", rates: [{ object_id: "r_dhl", provider: "DHL Express", servicelevel: { name: "Worldwide" }, amount: "52.00", currency: "USD", estimated_days: 3 }] });
      if (url.endsWith("goshippo.com/transactions/")) return Response.json({ status: "SUCCESS", tracking_number: "DHL777", label_url: "https://shippo-delivery.s3.amazonaws.com/l.pdf", tracking_url_provider: "https://www.dhl.com/track?DHL777" });
      return new Response("{}", { status: 404 });
    });
    // A business address for the return label.
    const st = (await store("GET", "")).json.store;
    await store("PUT", "settings", { name: st.name, email: st.email, phone: "9876543210", currency: st.currency, country: st.country, region: st.region, address: { line1: "12 MG Road", line2: "", city: "Bengaluru", region: "Karnataka", postalCode: "560001", country: "IN" }, orderPrefix: st.orderPrefix, lowStockThreshold: st.lowStockThreshold, notifyEmails: [], policies: st.policies, checkout: st.checkout });
    const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.email, "amy@example.com")));
    await db.update(schema.storeOrders).set({ financialStatus: "paid" }).where(eq(schema.storeOrders.id, o.id));
    orderId = o.id;
  });
  afterAll(() => setLabelHttp(null));

  it("checks the EasyPost key, quotes international rates with customs, and buys the cheapest", async () => {
    reqs = [];
    expect((await store("PUT", "integrations/easypost", { enabled: true, apiKey: "EZTK_test_key", webhookSecret: "ep_secret" })).status).toBe(200);
    expect(reqs[0].auth).toBe(`Basic ${Buffer.from("EZTK_test_key:").toString("base64")}`);
    const prov = (await store("GET", "integrations/labels")).json.providers.find((p: { provider: string }) => p.provider === "easypost");
    expect(prov).toMatchObject({ enabled: true, status: "connected", testMode: true });
    const r = await store("POST", `orders/${orderId}/label-rates`, { provider: "easypost" });
    expect(r.json.shipment.rates.map((x: { carrier: string }) => x.carrier)).toEqual(["USPS", "UPS"]); // cheapest first
    const sent = reqs.find((x) => x.url.endsWith("/v2/shipments"))!.body!.shipment as Record<string, { country?: string; customs_items?: { description: string; hs_tariff_number: string }[] }>;
    expect(sent.to_address.country).toBe("US");
    expect(sent.from_address.country).toBe("IN");
    expect(sent.customs_info.customs_items![0].description).toBe("Linen throw");
    const bought = await store("POST", `orders/${orderId}/label-buy`, { rateId: "rate_usps" });
    expect(bought.json.order).toMatchObject({ fulfillmentStatus: "shipped", tracking: { number: "9400111", url: "https://track.easypost.com/trk_1" }, shipment: { labelUrl: "https://easypost-files.s3.amazonaws.com/label.png", carrier: "USPS" } });
    expect((await store("POST", `orders/${orderId}/label-buy`, { rateId: "rate_usps" })).status).toBe(409);

    const url = new URL(prov.webhookUrl);
    const raw = JSON.stringify({ description: "tracker.updated", result: { tracking_code: "9400111", status: "delivered" } });
    const hook = (sig: string, token = url.searchParams.get("token")!) => storeHooks.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/webhooks/easypost?token=${token}`, { method: "POST", headers: { "x-hmac-signature": sig }, body: raw }), { params: Promise.resolve({ projectId, provider: "easypost" }) });
    expect((await hook("hmac-sha256-hex=bad")).status).toBe(403);
    expect((await hook(`hmac-sha256-hex=${createHmac("sha256", "ep_secret").update(raw).digest("hex")}`, "wrong-token")).status).toBe(403);
    expect((await hook(`hmac-sha256-hex=${createHmac("sha256", "ep_secret").update(raw).digest("hex")}`)).status).toBe(200);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, orderId));
    expect(o.fulfillmentStatus).toBe("delivered");
  });

  it("buys a Shippo label with a customs declaration", async () => {
    await store("PUT", "integrations/easypost", { enabled: false });
    expect((await store("PUT", "integrations/shippo", { enabled: true, apiKey: "shippo_test_abc" })).status).toBe(200);
    const add = await post(cartRoute.POST, { action: "add", variant: (await db.select().from(schema.storeVariants).limit(1))[0].id, qty: "1" });
    await post(cartRoute.POST, { action: "currency", currency: "USD", return: "/cart" }, add.cookie);
    await post(checkoutRoute.POST, { step: "details", email: "lena@example.com", phone: "4930123", name: "Lena Berg", line1: "Hauptstr. 1", line2: "", city: "Berlin", region: "BE", postalCode: "10115", country: "DE" }, add.cookie);
    await post(checkoutRoute.POST, { step: "place", rate: intlRate, payment: "stripe" }, add.cookie);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.email, "lena@example.com"));
    await db.update(schema.storeOrders).set({ financialStatus: "paid" }).where(eq(schema.storeOrders.id, o.id));
    reqs = [];
    const r = await store("POST", `orders/${o.id}/label-rates`, { provider: "shippo" });
    expect(r.json.shipment.rates[0]).toMatchObject({ carrier: "DHL Express", amount: 5200 });
    expect(reqs.find((x) => x.url.endsWith("/customs/declarations/"))!.body).toMatchObject({ certify: true, items: [{ description: "Linen throw", value_currency: "USD", origin_country: "IN" }] });
    expect(reqs.find((x) => x.url.endsWith("/shipments/"))!.body).toMatchObject({ customs_declaration: "cust_1", address_to: { country: "DE" } });
    expect(reqs[0].auth).toBe("ShippoToken shippo_test_abc");
    const b = await store("POST", `orders/${o.id}/label-buy`, { rateId: "r_dhl" });
    expect(b.json.order.tracking).toMatchObject({ number: "DHL777", url: "https://www.dhl.com/track?DHL777" });
  });
});

describe("customer subscriptions", () => {
  type Req = { url: string; method: string; body: string };
  let reqs: Req[] = [];
  let subVariant = "";
  const stripeHook = (obj: Record<string, unknown>, type: string, id: string) => {
    const raw = JSON.stringify({ id, type, data: { object: obj } });
    const t = Math.floor(Date.now() / 1000);
    return storeHooks.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": `t=${t},v1=${createHmac("sha256", "whsec_x").update(`${t}.${raw}`).digest("hex")}` }, body: raw }), { params: Promise.resolve({ projectId, provider: "stripe" }) });
  };
  const rzpHook = (event: string, sub: Record<string, unknown>, payment?: Record<string, unknown>) => {
    const raw = JSON.stringify({ event, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) } });
    return storeHooks.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/webhooks/razorpay`, { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "rzp_wh").update(raw).digest("hex"), "x-razorpay-event-id": `evt_${event}_${payment?.id ?? sub.status}` }, body: raw }), { params: Promise.resolve({ projectId, provider: "razorpay" }) });
  };
  async function buySub(email: string, payment: "stripe" | "razorpay") {
    const add = await post(cartRoute.POST, { action: "add", variant: subVariant, qty: "1" });
    await post(checkoutRoute.POST, { step: "details", email, phone: "9876543210", name: "Sia Rao", line1: "1 Hill Rd", line2: "", city: "Mumbai", region: "Maharashtra", postalCode: "400050", country: "IN" }, add.cookie);
    const [cart] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.email, email));
    const q = await quoteCart(projectId, cart);
    const placed = await post(checkoutRoute.POST, { step: "place", rate: q.rates[0].id, payment }, add.cookie);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.email, email));
    return { placed, order: o, cookie: add.cookie, quote: q };
  }

  beforeAll(async () => {
    setPaymentHttp(async (input, init) => {
      const url = String(input);
      reqs.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
      if (url.endsWith("/v1/balance") || url.includes("/v1/payments?count=1")) return Response.json({ object: "ok", items: [] });
      if (url.endsWith("/v1/checkout/sessions")) return Response.json({ id: "cs_sub_1", url: "https://checkout.stripe.com/c/pay/sub" });
      if (url.includes("api.stripe.com/v1/subscriptions/sub_s1")) return Response.json({ id: "sub_s1", cancel_at_period_end: true });
      if (url.endsWith("razorpay.com/v1/plans")) return Response.json({ id: "plan_box" });
      if (url.endsWith("razorpay.com/v1/subscriptions")) return Response.json({ id: "sub_r1", short_url: "https://rzp.io/i/sub" });
      return Response.json({ error: { message: "unexpected" } }, { status: 400 });
    });
    await store("PUT", "payments/razorpay", { enabled: true, credentials: { keyId: "rzp_test_k", keySecret: "rzp_s", webhookSecret: "rzp_wh" } });
    const p = await store("POST", "products", { title: "Coffee box", status: "active", subscriptionInterval: "month", subscriptionIntervalCount: 1, variants: [{ options: {}, price: 59900, stock: 50 }] });
    subVariant = p.json.product.variants[0].id;
  });

  it("checks out on its own, online only, as a recurring Stripe price", async () => {
    const add = await post(cartRoute.POST, { action: "add", variant: subVariant, qty: "1" });
    const other = (await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.projectId, projectId))).find((v) => v.id !== subVariant)!;
    await post(cartRoute.POST, { action: "add", variant: other.id, qty: "1" }, add.cookie);
    const [mixed] = (await db.select().from(schema.storeCarts)).filter((c) => (c.items as { variantId: string }[]).length === 2 && (c.items as { variantId: string }[]).some((i) => i.variantId === subVariant));
    expect((await quoteCart(projectId, mixed)).problems).toContain("A subscription is checked out on its own. Remove the other items, or buy them in a separate order.");

    reqs = [];
    const { placed, order, quote } = await buySub("sia@example.com", "stripe");
    expect(quote.payments.map((x) => x.id).sort()).toEqual(["razorpay", "stripe"]);
    expect(placed.location).toBe("https://checkout.stripe.com/c/pay/sub");
    const session = new URLSearchParams(reqs.find((r) => r.url.endsWith("/v1/checkout/sessions"))!.body);
    expect(session.get("mode")).toBe("subscription");
    expect(session.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(session.get("line_items[0][price_data][unit_amount]")).toBe(String(order.total));
    expect(session.get("subscription_data[metadata][order_id]")).toBe(order.id);
  });

  it("is confirmed by Stripe's webhook, renews into new paid orders, and can be cancelled by the customer", async () => {
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.email, "sia@example.com"));
    expect((await stripeHook({ id: "cs_sub_1", mode: "subscription", subscription: "sub_s1", payment_status: "paid", amount_total: o.total, payment_intent: null }, "checkout.session.completed", "evt_s1")).status).toBe(200);
    const [paid] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id));
    expect(paid.financialStatus).toBe("paid");
    const [sub] = await db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.providerSubId, "sub_s1"));
    expect(sub).toMatchObject({ status: "active", amount: o.total, interval: "month", email: "sia@example.com" });
    const stockBefore = (await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.id, subVariant)))[0].stock;

    const r = await stripeHook({ id: "in_2", subscription: "sub_s1", billing_reason: "subscription_cycle", amount_paid: o.total, payment_intent: "pi_r2" }, "invoice.paid", "evt_s2");
    expect((await r.json()).renewalOrder).toBe(o.number + 1);
    await stripeHook({ id: "in_2", subscription: "sub_s1", billing_reason: "subscription_cycle", amount_paid: o.total }, "invoice.paid", "evt_s2"); // duplicate ignored
    const renewals = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.subscriptionId, sub.id));
    expect(renewals.filter((x) => x.id !== o.id)).toEqual([expect.objectContaining({ financialStatus: "paid", total: o.total, paymentCaptureRef: "pi_r2", email: "sia@example.com" })]);
    expect((await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.id, subVariant)))[0].stock).toBe(stockBefore - 1);
    expect((await db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.id, sub.id)))[0].renewals).toBe(1);

    // The customer's order page offers cancelling; it cancels at period end with Stripe.
    const form = new FormData();
    form.set("_base", BASE);
    form.set("number", String(o.number));
    form.set("key", "wrong-key");
    const { POST: cancelPost } = await import("@/app/api/v1/store/[projectId]/subscription/route");
    const bad = await cancelPost(new Request(`${ORIGIN}/api/v1/store/${projectId}/subscription`, { method: "POST", headers: { origin: ORIGIN }, body: form }), { params: Promise.resolve({ projectId }) });
    expect(decodeURIComponent(bad.headers.get("location")!)).toContain("couldn't find that subscription");
    const staff = await store("POST", `subscriptions/${sub.id}/cancel`, {});
    expect(staff.status).toBe(200);
    expect(new URLSearchParams(reqs.at(-1)!.body).get("cancel_at_period_end")).toBe("true");
    expect((await store("POST", `subscriptions/${sub.id}/cancel`, {})).status).toBe(409);
    expect((await store("GET", "subscriptions")).json.subscriptions[0]).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("works with Razorpay: plan + subscription, first charge pays the order, later charges renew", async () => {
    reqs = [];
    const { placed, order } = await buySub("ravi@example.com", "razorpay");
    expect(placed.location).toBe("https://rzp.io/i/sub");
    expect(JSON.parse(reqs.find((r) => r.url.endsWith("/v1/plans"))!.body)).toMatchObject({ period: "monthly", interval: 1, item: { amount: order.total, currency: "INR" } });
    expect(JSON.parse(reqs.find((r) => r.url.endsWith("/v1/subscriptions"))!.body)).toMatchObject({ plan_id: "plan_box", notes: { order_id: order.id } });
    const sub = { id: "sub_r1", status: "active", current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { order_id: order.id } };
    await rzpHook("subscription.charged", sub, { id: "pay_1", amount: order.total });
    expect((await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, order.id)))[0].financialStatus).toBe("paid");
    const r2 = await rzpHook("subscription.charged", sub, { id: "pay_2", amount: order.total });
    expect((await r2.json()).renewalOrder).toBeGreaterThan(order.number);
    await rzpHook("subscription.halted", { ...sub, status: "halted" });
    const [row] = await db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.providerSubId, "sub_r1"));
    expect(row).toMatchObject({ status: "past_due", renewals: 1 });
  });
});
