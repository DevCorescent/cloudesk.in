import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as webhookRoute from "@/app/api/v1/store/[projectId]/webhooks/[provider]/route";
import { releaseExpired } from "@/server/commerce/orders";
import { setPaymentHttp } from "@/server/commerce/payments";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const BASE = "/s/acme/shop";

async function newUser(name: string, email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  return { cookie, orgId: m.json.organizations[0].id as string };
}

let owner: Awaited<ReturnType<typeof newUser>>;
let other: Awaited<ReturnType<typeof newUser>>;
let projectId: string;

const store = (method: string, path: string, body?: unknown, cookie = owner.cookie) =>
  call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });

/** A storefront shopper with their own cart cookie. */
function shopper() {
  let cookie = "";
  const post = async (handler: (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>, fields: Record<string, string>) => {
    const form = new FormData();
    form.set("_base", BASE);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const headers: Record<string, string> = { origin: ORIGIN };
    if (cookie) headers.cookie = cookie;
    const res = await handler(new Request(`${ORIGIN}/api/v1/store/${projectId}/x`, { method: "POST", headers, body: form }), { params: Promise.resolve({ projectId }) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, location: decodeURIComponent(res.headers.get("location") ?? "") };
  };
  return {
    add: (variant: string, qty = 1) => post(cartRoute.POST, { action: "add", variant, qty: String(qty) }),
    coupon: (code: string) => post(cartRoute.POST, { action: "coupon", code }),
    details: (email = "asha@example.com") => post(checkoutRoute.POST, { step: "details", email, phone: "9876543210", name: "Asha Rao", line1: "12 MG Road", line2: "", city: "Bengaluru", region: "Karnataka", postalCode: "560001", country: "IN" }),
    place: (rate: string, payment: string) => post(checkoutRoute.POST, { step: "place", rate, payment }),
  };
}

async function newProduct(title: string, price: number, stock: number) {
  const r = await store("POST", "products", { title, status: "active", variants: [{ options: {}, price, stock, cost: Math.round(price / 2) }] });
  expect(r.status).toBe(201);
  return { id: r.json.product.id as string, variantId: r.json.product.variants[0].id as string };
}

async function rateId() {
  const s = await store("GET", "shipping");
  return s.json.zones[0].rates.find((r: { kind: string }) => r.kind === "flat").id as string;
}

const orderNumber = (location: string) => Number(/\/order\/(\d+)/.exec(location)?.[1]);
const orderByNumber = async (n: number) => (await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.number, n)))[0];

beforeAll(async () => {
  await resetDb();
  owner = await newUser("Olivia Owner", "olivia@example.com");
  other = await newUser("Oscar Other", "oscar@example.com");
  const r = await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "store", name: "Kobo" } });
  projectId = r.json.project.id;
});

afterAll(async () => {
  setPaymentHttp((input, init) => fetch(input, init));
  await closeDb();
});

describe("store setup", () => {
  it("asks before replacing the design, then builds a storefront with a sample catalog", async () => {
    const refused = await store("POST", "setup", { name: "Thread & Loom", template: "fashion", country: "IN", region: "Karnataka" });
    expect(refused.status).toBe(409);

    const ok = await store("POST", "setup", { name: "Thread & Loom", template: "fashion", country: "IN", region: "Karnataka", replaceDesign: true });
    expect(ok.status).toBe(200);
    expect(ok.json.seeded).toBeGreaterThan(3);
    expect(ok.json.store).toMatchObject({ currency: "INR", pricesIncludeTax: true });

    const f = await call(file.GET, { cookie: owner.cookie, params: { projectId }, path: `/api/v1/projects/${projectId}/file?path=${SITE_DOC_PATH}` });
    const doc = JSON.parse(f.json.content);
    const types = doc.pages[0].sections.map((s: { type: string }) => s.type);
    expect(types).toEqual(expect.arrayContaining(["productGrid", "collectionList"]));
    expect(doc.pages[0].sections.find((s: { type: string }) => s.type === "navbar").props.showCart).toBe(true);

    const products = await store("GET", "products");
    expect(products.json.products.every((p: { isSample: boolean }) => p.isSample)).toBe(true);
    const payments = await store("GET", "payments");
    expect(payments.json.providers.find((p: { id: string }) => p.id === "cod").enabled).toBe(true);
  });

  it("hides the store from people outside the organization", async () => {
    expect((await store("GET", "", undefined, other.cookie)).status).toBe(404);
    expect((await store("GET", "orders", undefined, other.cookie)).status).toBe(404);
    expect((await store("POST", "products", { title: "X", variants: [{ options: {}, price: 1 }] }, other.cookie)).status).toBe(404);
  });

  it("refuses checkout while sample products are in the cart", async () => {
    const products = await store("GET", "products");
    const s = shopper();
    await s.add(products.json.products[0].variants[0].id);
    await s.details();
    const placed = await s.place(await rateId(), "cod");
    expect(placed.location).toContain("sample products");
  });
});

describe("orders", () => {
  it("runs a cash-on-delivery order from cart to delivery and refund", async () => {
    const p = await newProduct("Linen shirt", 149900, 5);
    const s = shopper();
    expect((await s.add(p.variantId, 2)).location).toContain("/cart");
    await s.details();
    const placed = await s.place(await rateId(), "cod");
    expect(placed.location).toMatch(new RegExp(`^${BASE}/order/\\d+\\?key=.+&placed=1$`));
    const order = await orderByNumber(orderNumber(placed.location));
    expect(order).toMatchObject({ paymentMethod: "cod", financialStatus: "pending", subtotal: 299800 });
    // Free shipping applies over ₹999 on the default rate, so the cheapest rate costs nothing; express is flat.
    expect(order.total).toBe(order.subtotal - order.discountTotal + order.shippingTotal + order.feeTotal);

    const inv = await store("GET", "inventory");
    expect(inv.json?.items?.find((i: { variantId: string }) => i.variantId === p.variantId).stock).toBe(3);

    for (const status of ["packed", "shipped", "delivered"]) {
      const r = await store("POST", `orders/${order.id}`, { action: "fulfill", status, carrier: "delhivery", trackingNumber: "DL123", notify: false });
      expect(r.status).toBe(200);
    }
    const done = await store("GET", `orders/${order.id}`);
    expect(done.json.order).toMatchObject({ fulfillmentStatus: "delivered", financialStatus: "paid" });
    expect(done.json.order.tracking.url).toContain("delhivery");

    const refund = await store("POST", `orders/${order.id}`, { action: "refund", amount: 50000, reason: "Damaged", restock: false });
    expect(refund.json.order).toMatchObject({ financialStatus: "partially_refunded", refundedTotal: 50000 });
    const tooMuch = await store("POST", `orders/${order.id}`, { action: "refund", amount: order.total, reason: "" });
    expect(tooMuch.status).toBe(422);

    const invoice = await store("GET", `orders/${order.id}/invoice`);
    expect(invoice.text).toContain("Tax invoice");
    expect(invoice.text).toMatch(/CGST|IGST/);

    // Aggregates computed with correlated subqueries.
    const list = await store("GET", "orders");
    expect(list.json.orders.find((o: { id: string }) => o.id === order.id).items).toBe(2);
    const customers = await store("GET", "customers");
    expect(customers.json.customers.find((c: { email: string }) => c.email === "asha@example.com")).toMatchObject({ orders: 1, spent: order.total - 50000 });
    const cols = await store("GET", "collections");
    expect(cols.json.collections.some((c: { productCount: number }) => c.productCount > 0)).toBe(true);

    const insights = await store("GET", "insights?days=30");
    expect(insights.json.kpis.orders.value).toBe(1);
    expect(insights.json.kpis.grossProfit.value).toBeGreaterThan(0);
  });

  it("never sells more than is in stock, even with two carts racing", async () => {
    const p = await newProduct("Last one", 99900, 1);
    const a = shopper();
    const b = shopper();
    await a.add(p.variantId);
    await b.add(p.variantId);
    expect((await a.add(p.variantId)).location).toContain("Only 1 available");
    await a.details("a@example.com");
    await b.details("b@example.com");
    const rate = await rateId();
    const [ra, rb] = await Promise.all([a.place(rate, "cod"), b.place(rate, "cod")]);
    const wins = [ra, rb].filter((r) => r.location.includes("/order/"));
    expect(wins).toHaveLength(1);
    const inv = await store("GET", "inventory");
    expect(inv.json?.items?.find((i: { variantId: string }) => i.variantId === p.variantId).stock).toBe(0);
  });

  it("enforces one use per customer and usage limits on discount codes", async () => {
    const p = await newProduct("Tote bag", 120000, 10);
    expect((await store("POST", "discounts", { code: "welcome10", kind: "percent", value: 10, oncePerCustomer: true, usageLimit: 2 })).status).toBe(201);
    const rate = await rateId();
    const buy = async (email: string) => {
      const s = shopper();
      await s.add(p.variantId);
      await s.coupon("WELCOME10");
      await s.details(email);
      return s.place(rate, "cod");
    };
    const first = await buy("x@example.com");
    expect((await orderByNumber(orderNumber(first.location))).discountTotal).toBe(12000);
    expect((await buy("x@example.com")).location).toContain("once per customer");
    await buy("y@example.com");
    expect((await buy("z@example.com")).location).toMatch(/limit|redeemed/i);
  });
});

describe("online payments", () => {
  const secret = "whsec_test_secret";
  const calls: string[] = [];

  beforeAll(() => {
    setPaymentHttp(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/balance")) return Response.json({ object: "balance" });
      if (url.endsWith("/v1/checkout/sessions")) return Response.json({ id: `cs_test_${calls.length}`, url: "https://checkout.stripe.com/c/pay/test" });
      if (url.endsWith("/v1/refunds")) return Response.json({ id: "re_1" });
      return Response.json({ error: { message: "unexpected" } }, { status: 400 });
    });
  });

  const sign = (raw: string, s = secret) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac("sha256", s).update(`${t}.${raw}`).digest("hex")}`;
  };
  const webhook = (raw: string, sig: string) =>
    webhookRoute.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig }, body: raw }), { params: Promise.resolve({ projectId, provider: "stripe" }) });

  it("verifies keys before saving them and never returns secrets", async () => {
    const r = await store("PUT", "payments/stripe", { enabled: true, credentials: { secretKey: "sk_test_abcdef123456", webhookSecret: secret } });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.endsWith("/v1/balance"))).toBe(true);
    const stripe = r.json.providers.find((p: { id: string }) => p.id === "stripe");
    expect(stripe).toMatchObject({ enabled: true, status: "connected", mode: "test" });
    expect(JSON.stringify(r.json)).not.toContain("sk_test_abcdef123456");
    expect(JSON.stringify(r.json)).not.toContain(secret);
  });

  it("marks orders paid only from a signed webhook, once, and refunds through Stripe", async () => {
    const p = await newProduct("Ceramic vase", 250000, 4);
    const s = shopper();
    await s.add(p.variantId);
    await s.details();
    const placed = await s.place(await rateId(), "stripe");
    expect(placed.location).toBe("https://checkout.stripe.com/c/pay/test");
    const [order] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.paymentMethod, "stripe"));
    expect(order).toMatchObject({ financialStatus: "pending" });
    expect(order.reservedUntil).not.toBeNull();

    const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: order.paymentRef, payment_status: "paid", amount_total: order.total, payment_intent: "pi_1" } } });
    expect((await webhook(raw, sign(raw, "wrong"))).status).toBe(403);
    expect((await orderByNumber(order.number)).financialStatus).toBe("pending");

    const ok = await webhook(raw, sign(raw));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, duplicate: false });
    const again = await webhook(raw, sign(raw));
    expect(await again.json()).toMatchObject({ duplicate: true });
    const paid = await orderByNumber(order.number);
    expect(paid).toMatchObject({ financialStatus: "paid", paymentCaptureRef: "pi_1", reservedUntil: null });

    const refund = await store("POST", `orders/${order.id}`, { action: "refund", amount: paid.total, reason: "Changed mind", restock: true });
    expect(refund.json.order.financialStatus).toBe("refunded");
    expect(calls.some((c) => c.endsWith("/v1/refunds"))).toBe(true);
  });

  it("releases stock held by online orders that were never paid", async () => {
    const p = await newProduct("Lamp", 300000, 2);
    const s = shopper();
    await s.add(p.variantId, 2);
    await s.details();
    await s.place(await rateId(), "stripe");
    let inv = await store("GET", "inventory");
    expect(inv.json?.items?.find((i: { variantId: string }) => i.variantId === p.variantId).stock).toBe(0);
    await db.update(schema.storeOrders).set({ reservedUntil: new Date(Date.now() - 1000) }).where(eq(schema.storeOrders.financialStatus, "pending"));
    expect(await releaseExpired(projectId)).toBeGreaterThan(0);
    inv = await store("GET", "inventory");
    expect(inv.json?.items?.find((i: { variantId: string }) => i.variantId === p.variantId).stock).toBe(2);
  });
});
