import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as accountRoute from "@/app/api/v1/store/[projectId]/account/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as returnsRoute from "@/app/api/v1/store/[projectId]/returns/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { customerOrders, signAccountToken, verifyAccountToken } from "@/server/commerce/customer";
import { setShiprocketHttp } from "@/server/commerce/shiprocket";
import { setMailHttp } from "@/server/services/mail";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const BASE = "/s/acme/shop";
type H = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;

let owner: { cookie: string; orgId: string };
let projectId: string;

const store = (method: string, path: string, body?: unknown) =>
  call(admin[method as "GET"], { method, cookie: owner.cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });

async function form(handler: H, fields: Record<string, string>, cookie = "") {
  const f = new FormData();
  f.set("_base", BASE);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/api/v1/store/${projectId}/x`, { method: "POST", headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { status: res.status, location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}

/** Adds items, fills details and places an order; returns the redirect location. */
async function buy(variantId: string, opts: { qty?: number; email?: string; payment?: string; gift?: string } = {}) {
  let r = await form(cartRoute.POST, { action: "add", variant: variantId, qty: String(opts.qty ?? 1) });
  const cookie = r.cookie;
  if (opts.gift) await form(cartRoute.POST, { action: "giftcard", code: opts.gift }, cookie);
  await form(checkoutRoute.POST, { step: "details", email: opts.email ?? "asha@example.com", phone: "9876543210", name: "Asha Rao", line1: "12 MG Road", line2: "", city: "Bengaluru", region: "Karnataka", postalCode: "560001", country: "IN" }, cookie);
  const s = await store("GET", "shipping");
  const rate = s.json.zones[0].rates.find((x: { kind: string }) => x.kind === "flat").id;
  r = await form(checkoutRoute.POST, { step: "place", rate, payment: opts.payment ?? "cod" }, cookie);
  return r.location;
}

const orderFrom = async (location: string) => {
  const n = Number(/\/order\/(\d+)/.exec(location)?.[1]);
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, n)));
  return { order: o, key: new URL(`http://x${location}`).searchParams.get("key") ?? "" };
};

async function newProduct(title: string, price: number, stock: number) {
  const r = await store("POST", "products", { title, status: "active", variants: [{ options: {}, price, stock }] });
  expect(r.status).toBe(201);
  return { id: r.json.product.id as string, variantId: r.json.product.variants[0].id as string, slug: r.json.product.slug as string };
}

const mails = (to: string) => db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, to)).orderBy(desc(schema.outboundEmails.createdAt));

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "Olivia", email: "olivia@example.com", password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  owner = { cookie, orgId: m.json.organizations[0].id };
  const p = await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: owner.orgId }, body: { templateId: "blank", name: "Ops" } });
  projectId = p.json.project.id;
  const s = await store("POST", "setup", { name: "Ops Store", template: "home", country: "IN", region: "Karnataka", email: "owner@example.com", replaceDesign: true });
  expect(s.status).toBe(200);
  // Remove samples so checkout opens.
  for (const prod of (await store("GET", "products")).json.products) await store("DELETE", `products/${prod.id}`);
});

afterAll(async () => {
  setMailHttp((i, init) => fetch(i, init));
  setShiprocketHttp((i, init) => fetch(i, init));
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  await closeDb();
});

describe("email delivery", () => {
  it("sends through Resend when configured and records failures without breaking the flow", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    let fail = false;
    setMailHttp(async (input, init) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return fail ? Response.json({ message: "Domain not verified" }, { status: 403 }) : Response.json({ id: "re_msg_1" });
    });
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_FROM = "orders@example.com";
    const p = await newProduct("Mail mug", 50000, 50);
    await buy(p.variantId, { email: "mailme@example.com" });
    await new Promise((r) => setTimeout(r, 200));
    const [m] = await mails("mailme@example.com");
    expect(m).toMatchObject({ transport: "resend", status: "sent", providerId: "re_msg_1" });
    const req = sent.find((x) => (x.body.to as string[])[0] === "mailme@example.com")!;
    expect(req.url).toBe("https://api.resend.com/emails");
    expect(req.body.from).toBe('"Ops Store" <orders@example.com>');
    expect(req.body.reply_to).toBe("owner@example.com");

    fail = true;
    await buy(p.variantId, { email: "mailfail@example.com" });
    await new Promise((r) => setTimeout(r, 200));
    const [f] = await mails("mailfail@example.com");
    expect(f).toMatchObject({ status: "failed", error: "Domain not verified" });
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });
});

describe("gift cards", () => {
  it("covers part of an order, then whole orders, and goes back to the card on cancel and refund", async () => {
    const issued = await store("POST", "giftcards", { value: 150000, recipientEmail: "friend@example.com", sendEmail: true, note: "Happy birthday" });
    expect(issued.status).toBe(201);
    const code = issued.json.giftCard.code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await mails("friend@example.com"))[0].body).toContain(code);

    const p = await newProduct("Lamp", 100000, 20);
    // ₹1,000 lamp + ₹199 express: the card covers all of it.
    const full = await orderFrom(await buy(p.variantId, { gift: code.toLowerCase(), payment: "giftcard" }));
    expect(full.order).toMatchObject({ paymentMethod: "giftcard", financialStatus: "paid", giftCardCode: code });
    expect(full.order.giftCardTotal).toBe(full.order.total);
    let card = (await store("GET", "giftcards")).json.giftCards[0];
    expect(card.balance).toBe(150000 - full.order.total);

    // The rest of the card pays part of the next order; COD collects the remainder.
    const part = await orderFrom(await buy(p.variantId, { gift: code }));
    expect(part.order.giftCardTotal).toBe(card.balance);
    expect(part.order.total - part.order.giftCardTotal).toBeGreaterThan(0);
    card = (await store("GET", "giftcards")).json.giftCards[0];
    expect(card.balance).toBe(0);
    expect((await form(cartRoute.POST, { action: "giftcard", code })).status).toBe(303);

    // Cancelling the first order puts its gift card share back.
    await store("POST", `orders/${full.order.id}`, { action: "cancel", reason: "Customer request" });
    card = (await store("GET", "giftcards")).json.giftCards[0];
    expect(card.balance).toBe(full.order.total);

    // Refund of a delivered part-card order: cash first, then the card.
    for (const status of ["packed", "shipped", "delivered"]) await store("POST", `orders/${part.order.id}`, { action: "fulfill", status, notify: false });
    const r = await store("POST", `orders/${part.order.id}`, { action: "refund", amount: part.order.total, reason: "Damaged" });
    expect(r.json.order).toMatchObject({ financialStatus: "refunded", refundedTotal: part.order.total });
    card = (await store("GET", "giftcards")).json.giftCards[0];
    expect(card.balance).toBe(full.order.total + part.order.giftCardTotal);
    const detail = await store("GET", `giftcards/${card.id}`);
    expect(detail.json.txns.map((t: { amount: number }) => t.amount).reduce((a: number, b: number) => a + b, 0)).toBe(card.balance);
  });

  it("refuses disabled cards at checkout", async () => {
    const c = await store("POST", "giftcards", { value: 1000, code: "STAFF-OFF-1" });
    await store("PUT", `giftcards/${c.json.giftCard.id}`, { disabled: true });
    const p = await newProduct("Pen", 5000, 5);
    const loc = await buy(p.variantId, { gift: "STAFF-OFF-1" });
    expect(loc).toContain("disabled");
  });
});

describe("low stock alerts", () => {
  it("emails the owner once when a sale crosses the alert level, and re-arms on restock", async () => {
    const p = await newProduct("Rare vase", 20000, 7);
    const before = (await mails("owner@example.com")).filter((m) => m.subject.includes("running low")).length;
    await buy(p.variantId, { qty: 2 });
    await new Promise((r) => setTimeout(r, 150));
    const low = (await mails("owner@example.com")).filter((m) => m.subject.includes("running low"));
    expect(low.length).toBe(before + 1);
    expect(low[0].body).toContain("Rare vase: 5 left");
    await buy(p.variantId);
    await new Promise((r) => setTimeout(r, 150));
    expect((await mails("owner@example.com")).filter((m) => m.subject.includes("running low")).length).toBe(before + 1);
    await store("POST", `inventory/${p.variantId}`, { mode: "add", quantity: 10, reason: "Received stock" });
    await buy(p.variantId, { qty: 10 });
    await new Promise((r) => setTimeout(r, 150));
    expect((await mails("owner@example.com")).filter((m) => m.subject.includes("running low")).length).toBe(before + 2);
  });
});

describe("returns and customer links", () => {
  it("lets a customer request a return after shipping; the owner approves, receives and restocks", async () => {
    const p = await newProduct("Throw cushion", 120000, 10);
    const { order, key } = await orderFrom(await buy(p.variantId, { qty: 2, email: "ravi@example.com" }));
    const [item] = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, order.id));
    const early = await form(returnsRoute.POST, { number: String(order.number), key, reason: "Changed my mind", [`qty_${item.id}`]: "1" });
    expect(early.location).toContain("once your order has shipped");

    await store("POST", `orders/${order.id}`, { action: "fulfill", status: "shipped", notify: false });
    const tooMany = await form(returnsRoute.POST, { number: String(order.number), key, reason: "Changed my mind", [`qty_${item.id}`]: "3" });
    expect(tooMany.location).toContain("at most 2");
    const wrongKey = await form(returnsRoute.POST, { number: String(order.number), key: "nope", reason: "Changed my mind", [`qty_${item.id}`]: "1" });
    expect(wrongKey.location).toContain("err=");

    const ok = await form(returnsRoute.POST, { number: String(order.number), key, reason: "Damaged or defective", details: "Seam split", [`qty_${item.id}`]: "2" });
    expect(ok.location).toContain("return=1");
    const again = await form(returnsRoute.POST, { number: String(order.number), key, reason: "Other", [`qty_${item.id}`]: "1" });
    expect(again.location).toContain("already in progress");

    const list = await store("GET", "returns?status=requested");
    const ret = list.json.returns.find((r: { ret: { orderId: string } }) => r.ret.orderId === order.id).ret;
    expect(ret).toMatchObject({ reason: "Damaged or defective", details: "Seam split" });
    expect((await store("PUT", `returns/${ret.id}`, { status: "received" })).status).toBe(409);
    await store("PUT", `returns/${ret.id}`, { status: "approved", resolution: "Send it to our Bengaluru studio." });
    expect((await mails("ravi@example.com"))[0].body).toContain("Bengaluru studio");
    const stockBefore = (await store("GET", "inventory")).json.items.find((i: { variantId: string }) => i.variantId === p.variantId).stock;
    await store("PUT", `returns/${ret.id}`, { status: "received", restock: true });
    const stockAfter = (await store("GET", "inventory")).json.items.find((i: { variantId: string }) => i.variantId === p.variantId).stock;
    expect(stockAfter).toBe(stockBefore + 2);
    expect((await store("GET", `orders/${order.id}`)).json.order.fulfillmentStatus).toBe("returned");
  });

  it("emails a signed link to past customers only, and the link cannot be forged or reused elsewhere", async () => {
    const r1 = await form(accountRoute.POST, { email: "Ravi@Example.com" });
    expect(r1.location).toBe(`${BASE}/account?sent=1`);
    const link = (await mails("ravi@example.com")).find((m) => m.subject.endsWith("your orders"))!;
    const token = decodeURIComponent(/token=([^\s]+)/.exec(link.body)![1]);
    expect(verifyAccountToken(projectId, token)).toBe("ravi@example.com");
    expect(verifyAccountToken("00000000-0000-0000-0000-000000000000", token)).toBeNull();
    expect(verifyAccountToken(projectId, token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(verifyAccountToken(projectId, signAccountToken(projectId, "ravi@example.com", Date.now() - 25 * 3600_000))).toBeNull();
    expect((await customerOrders(projectId, "ravi@example.com")).length).toBe(1);

    const before = (await db.select().from(schema.outboundEmails)).length;
    const r2 = await form(accountRoute.POST, { email: "nobody@example.com" });
    expect(r2.location).toBe(r1.location);
    expect((await db.select().from(schema.outboundEmails)).length).toBe(before);
  });
});

describe("bulk order tools", () => {
  it("packs several orders at once, exports CSV and prints packing slips with the COD amount", async () => {
    const p = await newProduct("Coaster set", 80000, 20);
    const a = await orderFrom(await buy(p.variantId, { email: "b1@example.com" }));
    const b = await orderFrom(await buy(p.variantId, { email: "b2@example.com" }));
    const bulk = await store("POST", "orders/bulk", { ids: [a.order.id, b.order.id], action: "packed" });
    expect(bulk.json.done).toHaveLength(2);
    expect((await store("GET", `orders/${a.order.id}`)).json.order.fulfillmentStatus).toBe("packed");

    const csv = await store("GET", `orders/export?ids=${a.order.id},${b.order.id}`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.text.split("\n")).toHaveLength(3);
    expect(csv.text).toContain("b1@example.com");

    const slips = await store("GET", `orders/slips?ids=${a.order.id},${b.order.id}`);
    expect(slips.text.match(/class="slip"/g)).toHaveLength(2);
    expect(slips.text).toContain("COLLECT CASH ON DELIVERY");
  });
});

describe("shiprocket", () => {
  const calls: string[] = [];
  let awbFails = true;
  beforeAll(() => {
    setShiprocketHttp(async (input, init) => {
      const url = String(input).replace("https://apiv2.shiprocket.in/v1/external", "");
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/auth/login") return JSON.parse(String(init?.body)).password === "right" ? Response.json({ token: "tok" }) : Response.json({ message: "Invalid email and password combination" }, { status: 401 });
      if (url === "/orders/create/adhoc") return Response.json({ order_id: 111, shipment_id: 222, status: "NEW" });
      if (url === "/courier/assign/awb") return awbFails ? Response.json({ message: "Wallet balance is low" }, { status: 400 }) : Response.json({ awb_assign_status: 1, response: { data: { awb_code: "AWB123", courier_name: "Delhivery Surface" } } });
      if (url === "/courier/generate/label") return Response.json({ label_created: 1, label_url: "https://example.com/label.pdf" });
      if (url === "/courier/generate/pickup") return Response.json({ pickup_status: 1 });
      if (url.startsWith("/courier/track/awb/")) return Response.json({ tracking_data: { shipment_track: [{ current_status: "DELIVERED" }] } });
      return Response.json({ message: "unexpected" }, { status: 404 });
    });
  });

  it("verifies credentials, books a courier (resuming after a failure without duplicates) and syncs delivery", async () => {
    const bad = await store("PUT", "integrations/shiprocket", { enabled: true, email: "api@example.com", password: "wrong" });
    expect(bad.status).toBe(422);
    const ok = await store("PUT", "integrations/shiprocket", { enabled: true, email: "api@example.com", password: "right", settings: { pickupLocation: "Studio" } });
    expect(ok.json.shiprocket).toMatchObject({ enabled: true, status: "connected", hasPassword: true });
    expect(JSON.stringify(ok.json)).not.toContain("right");

    const p = await newProduct("Rug", 300000, 5);
    const { order } = await orderFrom(await buy(p.variantId, { email: "ship@example.com" }));
    const first = await store("POST", `orders/${order.id}/ship-book`, {});
    expect(first.status).toBe(502);
    expect(first.json.error.message).toContain("Wallet balance");
    awbFails = false;
    const booked = await store("POST", `orders/${order.id}/ship-book`, {});
    expect(booked.status).toBe(200);
    expect(calls.filter((c) => c.endsWith("/orders/create/adhoc"))).toHaveLength(1);
    expect(booked.json.order).toMatchObject({ fulfillmentStatus: "packed", shipment: { awb: "AWB123", courier: "Delhivery Surface", labelUrl: "https://example.com/label.pdf", pickupScheduled: true } });
    expect(booked.json.order.tracking.url).toContain("AWB123");
    expect((await store("POST", `orders/${order.id}/ship-book`, {})).status).toBe(409);

    const synced = await store("POST", `orders/${order.id}/ship-sync`, {});
    expect(synced.json.order).toMatchObject({ fulfillmentStatus: "delivered", financialStatus: "paid" });
    expect(synced.json.order.tracking.number).toBe("AWB123");
  });
});

describe("search engines and shopping feeds", () => {
  it("serves robots.txt, a sitemap with products and a Google product feed for the live site", async () => {
    const p = await newProduct("Linen throw", 249900, 3);
    const dep = await call(deployments.POST, { method: "POST", cookie: owner.cookie, params: { projectId }, body: { environment: "production" } });
    expect(dep.json.deployment.status).toBe("ready");
    const get = async (file: string) => {
      const res = await siteServe.GET(new Request(`${ORIGIN}/sites/${dep.json.deployment.id}/${file}`), { params: Promise.resolve({ deploymentId: dep.json.deployment.id, path: [file] }) });
      return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
    };
    const robots = await get("robots.txt");
    expect(robots.text).toContain("Disallow: /sites/");
    expect(robots.text).toMatch(/Sitemap: http:\/\/localhost:3000\/sites\/.+\/sitemap\.xml/);
    const sitemap = await get("sitemap.xml");
    expect(sitemap.type).toContain("application/xml");
    expect(sitemap.text).toContain(`/product/${p.slug}</loc>`);
    expect(sitemap.text).toContain("/shop</loc>");
    const feed = await get("products.xml");
    expect(feed.text).toContain("<g:price>2499.00 INR</g:price>");
    expect(feed.text).toContain("<g:availability>in_stock</g:availability>");
  });
});
