import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { CreationCloud, CreationCloudError, verifyWebhook, type InstallHandoff } from "../../packages/sdk/src";
import * as publicApi from "@/app/api/public/v1/[[...path]]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgApps from "@/app/api/v1/orgs/[orgId]/apps/[[...slug]]/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as integrations from "@/app/api/v1/projects/[projectId]/integrations/[[...slug]]/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import { emitEvent } from "@/server/events/bus";
import { describeEvent, setIntegrationHttp } from "@/server/events/integrations";
import { setWebhookHttp } from "@/server/events/webhooks";
import { drain } from "@/server/jobs/queue";
import { setAppHttp } from "@/server/platform/apps";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let orgId = "";
let projectId = "";
const I = (method: string, slug: string[] = [], body?: unknown) => call(integrations[method as "GET"], { method, cookie, body, params: { projectId, slug } });
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
/** The SDK, talking to the real route handler. */
const sdk = (apiKey: string) =>
  new CreationCloud({
    apiKey,
    baseUrl: `${ORIGIN}/api/public/v1`,
    maxRetries: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/public/v1/", "").split("/").filter(Boolean);
      const h = publicApi[(init?.method ?? "GET") as "GET"];
      return h(new Request(url, init), { params: Promise.resolve({ path }) });
    }) as typeof fetch,
  });

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };
let sent: Sent[] = [];
let answer: (s: Sent) => { status: number; text: string } = () => ({ status: 200, text: "{}" });
const fake = async (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => {
  const s = { url, ...opts };
  sent.push(s);
  const r = answer(s);
  return { status: r.status, headers: {}, text: r.text, truncated: false };
};

async function buy(variantId: string, email: string, marketing = false) {
  const post = async (h: typeof cartRoute.POST, fields: Record<string, string>, c = "") => {
    const f = new FormData();
    f.set("_base", "/s/x/y");
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    const res = await h(new Request(`${ORIGIN}/api/v1/store/${projectId}/x`, { method: "POST", headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
    return res.headers.get("set-cookie")?.split(";")[0] ?? c;
  };
  const c = await post(cartRoute.POST, { action: "add", variant: variantId, qty: "1" });
  await post(checkoutRoute.POST, { step: "details", email, phone: "9876543210", name: "Asha Rao", line1: "12 MG Road", line2: "", city: "Bengaluru", region: "Karnataka", postalCode: "560001", country: "IN", ...(marketing ? { marketing: "on" } : {}) }, c);
  const rate = (await store("GET", "shipping")).json.zones[0].rates.find((x: { kind: string }) => x.kind === "flat").id;
  await post(checkoutRoute.POST, { step: "place", rate, payment: "cod" }, c);
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.email, email)));
  return o;
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dev Lee", email: "dev@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Gear Shop" } })).json.project.id;
  await store("POST", "setup", { name: "Gear Shop", template: "home", country: "IN", region: "Karnataka", email: "owner@example.com", replaceDesign: true });
  for (const p of (await store("GET", "products")).json.products) await store("DELETE", `products/${p.id}`);
  setWebhookHttp(fake);
  setIntegrationHttp(fake);
  setAppHttp(fake as never);
});
afterEach(() => {
  sent = [];
  answer = () => ({ status: 200, text: "{}" });
});
afterAll(async () => {
  setWebhookHttp(null);
  setIntegrationHttp(null);
  setAppHttp(null);
  await closeDb();
});

describe("public API with scoped keys", () => {
  let readKey = "";
  let productId = "";
  let variantId = "";

  it("shows a key once, stores only its hash, and enforces scopes", async () => {
    const p = await store("POST", "products", { title: "Trail bottle", status: "active", variants: [{ options: {}, price: 89900, stock: 10, sku: "TB-1" }] });
    productId = p.json.product.id;
    variantId = p.json.product.variants[0].id;
    const k = await I("POST", ["keys"], { name: "Reporting", scopes: ["project:read", "products:read", "orders:read"] });
    expect(k.status).toBe(201);
    readKey = k.json.key;
    expect(readKey).toMatch(/^cc_live_/);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, k.json.id));
    expect(row.keyHash).toBe(createHash("sha256").update(readKey).digest("hex"));
    expect(JSON.stringify((await I("GET")).json.apiKeys)).not.toContain(readKey);

    const cc = sdk(readKey);
    expect((await cc.project()).name).toBe("Gear Shop");
    const list = await cc.products.list({ status: "active" });
    expect(list.data[0]).toMatchObject({ title: "Trail bottle", variants: [{ sku: "TB-1", stock: 10, price: 89900 }] });
    const denied = await cc.products.updateVariant(productId, variantId, { stock: 1 }).catch((e) => e);
    expect(denied).toBeInstanceOf(CreationCloudError);
    expect(denied).toMatchObject({ status: 403, message: 'This key needs the "products:write" permission' });
    expect(await sdk("cc_live_" + "x".repeat(40)).project().catch((e) => e.status)).toBe(401);
  });

  it("updates stock and fulfils orders, and stops working once revoked", async () => {
    const w = await I("POST", ["keys"], { name: "Warehouse", scopes: ["products:write", "orders:read", "orders:write"] });
    const cc = sdk(w.json.key);
    expect(await cc.products.updateVariant(productId, variantId, { stock: 42 })).toMatchObject({ stock: 42 });
    const [log] = await db.select().from(schema.storeInventoryLog).where(and(eq(schema.storeInventoryLog.variantId, variantId), eq(schema.storeInventoryLog.reason, "Set through the API")));
    expect(log).toMatchObject({ delta: 32, reason: "Set through the API" });
    const o = await buy(variantId, "asha@example.com");
    const page = await cc.orders.list({ limit: 10 });
    expect(page.data.map((x) => x.number)).toContain(o.number);
    const got = await cc.orders.get(o.number);
    expect(got.items?.[0]).toMatchObject({ title: "Trail bottle", quantity: 1 });
    const shipped = await cc.orders.fulfill(o.number, { status: "shipped", carrier: "delhivery", trackingNumber: "DL999", notifyCustomer: false });
    expect(shipped).toMatchObject({ fulfillmentStatus: "shipped", tracking: { number: "DL999" } });
    const all: number[] = [];
    for await (const x of cc.orders.all({})) all.push(x.number);
    expect(all).toContain(o.number);
    await I("DELETE", ["keys", w.json.id]);
    expect(await cc.orders.list().catch((e) => e.status)).toBe(401);
  });

  it("publishes an OpenAPI document without a key", async () => {
    const r = await publicApi.GET(new Request(`${ORIGIN}/api/public/v1/openapi.json`), { params: Promise.resolve({ path: ["openapi.json"] }) });
    const doc = await r.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/orders", "/products/{productId}/variants/{variantId}", "/orders/{number}/fulfillment"]));
    expect(Object.keys(doc.webhooks)).toContain("order.paid");
  });
});

describe("outgoing webhooks", () => {
  it("delivers signed events that the SDK verifies, retries failures, and stops on 410", async () => {
    const c = await I("POST", ["webhooks"], { url: "https://erp.example.com/hooks", events: ["order.placed", "order.shipped"], description: "ERP" });
    expect(c.status).toBe(201);
    const secret = c.json.secret as string;
    expect(secret).toMatch(/^whsec_/);
    let n = 0;
    answer = () => (++n === 1 ? { status: 500, text: "oops" } : { status: 200, text: "ok" });
    const [v] = await db.select().from(schema.storeVariants).limit(1);
    const o = await buy(v.id, "bo@example.com");
    await drain();
    const [d1] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.event, "order.placed"));
    expect(d1).toMatchObject({ status: "failed", attempts: 1, responseStatus: 500 });
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() - 1000) });
    await drain();
    const [d2] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, d1.id));
    expect(d2).toMatchObject({ status: "succeeded", attempts: 2, responseStatus: 200 });
    const last = sent.at(-1)!;
    const evt = await verifyWebhook(secret, last.body!, last.headers["CC-Signature"]);
    expect(evt).toMatchObject({ type: "order.placed", projectId, data: { number: o.number, email: "bo@example.com" } });
    await expect(verifyWebhook(secret, last.body!.replace("bo@", "eve@"), last.headers["CC-Signature"])).rejects.toThrow(/does not match/);
    await expect(verifyWebhook(secret, last.body!, last.headers["CC-Signature"], { now: Date.now() + 3600_000 })).rejects.toThrow(/tolerance/);

    answer = () => ({ status: 410, text: "gone" });
    await I("POST", ["webhooks", c.json.id, "test"], {});
    await drain();
    expect((await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, c.json.id)))[0].enabled).toBe(false);
  });
});

describe("built-in integrations", () => {
  it("verifies credentials when connecting, then posts event messages", async () => {
    answer = (s) => (s.url.endsWith("/getMe") ? { status: 200, text: '{"ok":true,"result":{"username":"shopbot"}}' } : { status: 200, text: '{"ok":true}' });
    expect((await I("POST", ["connect", "slack"], { creds: { webhookUrl: "https://evil.example.com/x" } })).status).toBe(422);
    expect((await I("POST", ["connect", "slack"], { creds: { webhookUrl: "https://hooks.slack.com/services/T1/B1/abc" }, settings: { events: ["order.paid"] } })).status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ url: "https://hooks.slack.com/services/T1/B1/abc" });
    expect((await I("POST", ["connect", "telegram"], { creds: { botToken: "123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789", chatId: "-100200300" }, settings: { events: ["form.submitted"] } })).status).toBe(200);
    sent = [];
    await emitEvent(projectId, "order.paid", { label: "#7", email: "x@example.com", customerName: "Riya", total: "899.00", currency: "INR" });
    await emitEvent(projectId, "form.submitted", { formId: "contact", data: { name: "Kabir", email: "k@example.com", message: "Do you ship to Pune?" } });
    await drain();
    const slack = sent.find((s) => s.url.includes("hooks.slack.com"))!;
    expect(JSON.parse(slack.body!).text).toBe("💸 Gear Shop: Riya paid INR 899.00 for order #7");
    const tg = sent.find((s) => s.url.includes("/sendMessage"))!;
    expect(JSON.parse(tg.body!)).toMatchObject({ chat_id: "-100200300", text: expect.stringContaining("Kabir <k@example.com>") });
    expect(describeEvent({ type: "booking.confirmed", data: { name: "A", service: "Cut", startsAt: "2026-11-01T10:00:00Z" } }, "Salon")).toContain("A booked Cut");
  });

  it("adds Mailchimp contacts only with consent, with double opt-in by default", async () => {
    answer = (s) => (s.method === "GET" ? { status: 200, text: '{"id":"abc123"}' } : { status: 200, text: "{}" });
    expect((await I("POST", ["connect", "mailchimp"], { creds: { apiKey: "0123456789abcdef-us21" }, settings: { listId: "abc123" } })).status).toBe(200);
    sent = [];
    await emitEvent(projectId, "form.submitted", { formId: "newsletter", data: { email: "News@Example.com" } });
    await emitEvent(projectId, "order.paid", { email: "noconsent@example.com", customerName: "No Consent" });
    await drain();
    const puts = sent.filter((s) => s.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(`https://us21.api.mailchimp.com/3.0/lists/abc123/members/${createHash("md5").update("news@example.com").digest("hex")}`);
    expect(JSON.parse(puts[0].body!)).toMatchObject({ email_address: "News@Example.com", status_if_new: "pending" });
  });
});

describe("apps (plugin SDK)", () => {
  const manifest = {
    name: "Stock Sync",
    slug: "stock-sync",
    scopes: ["products:read", "products:write"],
    events: ["order.paid"],
    webhookUrl: "https://stocksync.example.com/events",
    installUrl: "https://stocksync.example.com/install",
    uninstallUrl: "https://stocksync.example.com/uninstall",
    configFields: [{ key: "warehouse", label: "Warehouse code", type: "text", required: true }, { key: "token", label: "Token", type: "secret" }],
  };
  let appId = "";
  let appSecret = "";

  it("validates and registers an app manifest", async () => {
    const bad = await call(orgApps.POST, { method: "POST", cookie, params: { orgId }, body: { ...manifest, installUrl: undefined } });
    expect(bad.status).toBe(422);
    const r = await call(orgApps.POST, { method: "POST", cookie, params: { orgId }, body: manifest });
    expect(r.status).toBe(201);
    appId = r.json.id;
    appSecret = r.json.secret;
  });

  it("rolls back if the app refuses the install", async () => {
    answer = () => ({ status: 500, text: "down" });
    const r = await I("POST", ["apps", appId, "install"], { config: { warehouse: "BLR-1" } });
    expect(r.status).toBe(502);
    expect(await db.select().from(schema.appInstalls)).toHaveLength(0);
    expect((await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, "App: Stock Sync")))[0].revokedAt).not.toBeNull();
  });

  it("installs with a signed hand-off whose key works, and uninstall revokes everything", async () => {
    expect((await I("POST", ["apps", appId, "install"], { config: {} })).status).toBe(422);
    const r = await I("POST", ["apps", appId, "install"], { config: { warehouse: "BLR-1", token: "tok_123" } });
    expect(r.status).toBe(200);
    const handoff = sent.find((s) => s.url === manifest.installUrl)!;
    const evt = (await verifyWebhook(appSecret, handoff.body!, handoff.headers["CC-Signature"])) as unknown as InstallHandoff;
    expect(evt).toMatchObject({ type: "app.installed", projectId, scopes: ["products:read", "products:write"], config: { warehouse: "BLR-1", token: "tok_123" } });
    const [install] = await db.select().from(schema.appInstalls);
    expect(JSON.stringify(install.config)).not.toContain("tok_123"); // secret config stored encrypted
    const cc = sdk(evt.apiKey!);
    expect((await cc.products.list()).data.length).toBeGreaterThan(0);
    expect(await cc.orders.list().catch((e) => e.status)).toBe(403);
    // The app receives events signed with its own webhook secret.
    sent = [];
    await emitEvent(projectId, "order.paid", { label: "#9", email: "z@example.com" });
    await drain();
    const delivery = sent.find((s) => s.url === manifest.webhookUrl)!;
    expect((await verifyWebhook(evt.webhookSecret!, delivery.body!, delivery.headers["CC-Signature"])).type).toBe("order.paid");

    expect((await I("DELETE", ["apps", appId, "install"])).status).toBe(200);
    expect(await cc.products.list().catch((e) => e.status)).toBe(401);
    expect(await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.url, manifest.webhookUrl))).toHaveLength(0);
    expect(sent.some((s) => s.url === manifest.uninstallUrl)).toBe(true);
  });
});
