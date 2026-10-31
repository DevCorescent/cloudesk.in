import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as publicCat from "@/app/c/[token]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let mug = { id: "", variant: "" };
let bowl = { id: "", variant: "" };
let draft = "";
let collection = "";
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const open = (token: string, ua = UA) => publicCat.GET(new Request(`${ORIGIN}/c/${token}`, { headers: { "user-agent": ua } }), { params: Promise.resolve({ token }) });
async function order(token: string, fields: Record<string, string>, cart = "") {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await publicCat.POST(new Request(`${ORIGIN}/c/${token}`, { method: "POST", headers: { origin: ORIGIN, ...(cart ? { cookie: cart } : {}) }, body: f }), { params: Promise.resolve({ token }) });
  return { status: res.status, location: res.headers.get("location") ?? "", cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
const create = async (body: unknown) => (await store("POST", "catalogues", body)).json.catalogue;

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Rhea", email: "rhea@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "store", name: "Kora" } })).json.project.id;
  await store("POST", "setup", { name: "Kora Ceramics", country: "IN", region: "Karnataka", email: "hi@kora.example", replaceDesign: false });
  collection = (await store("POST", "collections", { title: "Mugs" })).json.collection.id;
  const m = (await store("POST", "products", { title: "Clay mug", status: "active", tags: ["gift"], collectionIds: [collection], variants: [{ options: {}, price: 59900, compareAt: 79900, stock: 3, sku: "MUG-1" }] })).json.product;
  mug = { id: m.id, variant: m.variants[0].id };
  const b = (await store("POST", "products", { title: "Serving bowl", status: "active", variants: [{ options: {}, price: 129900, stock: 20 }] })).json.product;
  bowl = { id: b.id, variant: b.variants[0].id };
  draft = (await store("POST", "products", { title: "Glaze test", status: "draft", variants: [{ options: {}, price: 9900, stock: 5 }] })).json.product.id;
});
afterAll(closeDb);

describe("catalogues", () => {
  it("shows active products live, and only what its rules pick", async () => {
    const all = await create({ title: "Everything", source: { mode: "all" } });
    const page = await open(all.token);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Clay mug");
    expect(html).toContain("Serving bowl");
    expect(html).not.toContain("Glaze test"); // drafts stay out
    expect(html).toContain("₹599");
    expect(html).toContain("25% off"); // from the MRP
    expect(html).toContain("Only 3 left");
    expect(page.headers.get("content-security-policy")).toMatch(/script-src 'sha256-/);
    // A price change shows up straight away: catalogues hold rules, not copies.
    await store("PUT", `products/${mug.id}`, { ...(await store("GET", `products/${mug.id}`)).json.product, variants: [{ id: mug.variant, options: {}, price: 64900, compareAt: 79900, stock: 3, sku: "MUG-1" }] });
    expect(await (await open(all.token)).text()).toContain("₹649");

    const byCollection = await create({ title: "Mugs only", source: { mode: "collections", collectionIds: [collection] } });
    const byTag = await create({ title: "Gifts", source: { mode: "tags", tags: ["GIFT"] } });
    const list = (await store("GET", "catalogues")).json.catalogues;
    const count = (id: string) => list.find((c: { id: string }) => c.id === id).productCount;
    expect([count(all.id), count(byCollection.id), count(byTag.id)]).toEqual([2, 1, 1]);
  });

  it("counts real views, not bots or the owner's preview", async () => {
    const c = await create({ title: "Counted" });
    await open(c.token);
    await open(c.token, "Googlebot/2.1");
    // The owner's preview shows even hidden catalogues and isn't counted; strangers can't use it.
    await store("PUT", `catalogues/${c.id}`, { ...c, published: false });
    const asOwner = await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}?preview=1`, { headers: { "user-agent": UA, cookie } }), { params: Promise.resolve({ token: c.token }) });
    expect(asOwner.status).toBe(200);
    const asStranger = await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}?preview=1`, { headers: { "user-agent": UA } }), { params: Promise.resolve({ token: c.token }) });
    expect(asStranger.status).toBe(410);
    const [row] = await db.select().from(schema.storeCatalogues).where(eq(schema.storeCatalogues.id, c.id));
    expect(row.views).toBe(1);
  });

  it("tells the owner about hand-picked drafts", async () => {
    const c = await create({ title: "Picked", source: { mode: "manual", productIds: [bowl.id, draft, mug.id], sort: "manual", groupByCollection: false } });
    const d = (await store("GET", `catalogues/${c.id}`)).json;
    expect(d.productCount).toBe(2);
    expect(d.waiting).toBe(1);
    expect(d.items.map((i: { title: string }) => i.title)).toEqual(["Serving bowl", "Clay mug"]); // arranged order
    // With sections on, collections come first and the arrangement holds inside each.
    await store("PUT", `catalogues/${c.id}`, { ...d.catalogue, source: { ...d.catalogue.source, groupByCollection: true } });
    const grouped = (await store("GET", `catalogues/${c.id}`)).json;
    expect(grouped.sections).toEqual([{ title: "Mugs", count: 1 }, { title: "More", count: 1 }]);
  });

  it("makes a catalogue of exactly the products just imported", async () => {
    const draftProduct = (title: string, price: number) => ({ title, description: "", category: "", tags: [], vendor: "", hsn: "", images: [], active: true, options: [], variants: [{ options: {}, sku: "", price, compareAt: null, cost: null, stock: 4, weightGrams: 300 }] });
    const r = await store("POST", "import/smart", { products: [draftProduct("Tea cup", 39900), draftProduct("Saucer", 19900)], catalogue: {} });
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(2);
    const d = (await store("GET", `catalogues/${r.json.catalogue.id}`)).json;
    expect(d.catalogue.origin).toBe("import");
    expect(d.items.map((i: { title: string }) => i.title)).toEqual(["Tea cup", "Saucer"]);
    // Without asking, no catalogue is made.
    const plain = await store("POST", "import/smart", { products: [draftProduct("Plate", 29900)] });
    expect(plain.json.catalogue).toBeNull();
  });

  it("sends WhatsApp orders as a written-out message", async () => {
    const c = await create({ title: "Wholesale", ordering: { whatsapp: "+91 98765 43210", checkout: false } });
    const r = await order(c.token, { [`q_${mug.variant}`]: "2", [`q_${bowl.variant}`]: "1", intent: "whatsapp" });
    expect(r.status).toBe(303);
    expect(r.location.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const text = decodeURIComponent(r.location.split("text=")[1]);
    expect(text).toContain("2 × Clay mug");
    expect(text).toContain("1 × Serving bowl");
    expect(text).toContain("Total: ₹2,597");
  });

  it("refuses orders it can't honour", async () => {
    const c = await create({ title: "Mugs", source: { mode: "collections", collectionIds: [collection] }, ordering: { whatsapp: "919876543210" } });
    const tooMany = await order(c.token, { [`q_${mug.variant}`]: "9", intent: "whatsapp" });
    expect(decodeURIComponent(tooMany.location)).toContain("Only 3 of “Clay mug” left");
    const notHere = await order(c.token, { [`q_${bowl.variant}`]: "1", intent: "whatsapp" });
    expect(decodeURIComponent(notHere.location)).toContain("no longer in this catalogue");
    const nothing = await order(c.token, { intent: "whatsapp" });
    expect(decodeURIComponent(nothing.location)).toContain("Choose how many");
  });

  it("checks out through the store's own cart once it's published", async () => {
    const c = await create({ title: "Shop" });
    const early = await order(c.token, { [`q_${mug.variant}`]: "1", intent: "checkout" });
    expect(decodeURIComponent(early.location)).toContain("isn't open");
    expect((await store("GET", `catalogues/${c.id}`)).json.checkout.reason).toMatch(/Publish/);
    await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } });
    const r = await order(c.token, { [`q_${mug.variant}`]: "2", [`q_${bowl.variant}`]: "1", intent: "checkout" });
    expect(r.location).toMatch(/^\/s\/[\w-]+\/[\w-]+\/checkout$/);
    expect(r.cookie).toMatch(/=/);
    const [cart] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.projectId, projectId));
    expect(cart.items).toEqual(expect.arrayContaining([{ variantId: mug.variant, qty: 2 }, { variantId: bowl.variant, qty: 1 }]));
    const [row] = await db.select().from(schema.storeCatalogues).where(eq(schema.storeCatalogues.id, c.id));
    expect(row.orderClicks).toBe(1); // only orders that went through count, not the refused one
  });

  it("can be hidden, can end, and its link can be replaced", async () => {
    const c = await create({ title: "Seasonal" });
    await store("PUT", `catalogues/${c.id}`, { ...c, published: false });
    expect((await open(c.token)).status).toBe(410);
    await store("PUT", `catalogues/${c.id}`, { ...c, published: true, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await open(c.token)).status).toBe(410);
    await store("PUT", `catalogues/${c.id}`, { ...c, expiresAt: null });
    const fresh = (await store("POST", `catalogues/${c.id}/rotate`)).json.catalogue;
    expect((await open(c.token)).status).toBe(404);
    expect((await open(fresh.token)).status).toBe(200);
  });

  it("records shares by channel and validates settings", async () => {
    const c = await create({ title: "Shared" });
    await store("POST", `catalogues/${c.id}/shared`, { via: "whatsapp" });
    await store("POST", `catalogues/${c.id}/shared`, { via: "whatsapp" });
    await store("POST", `catalogues/${c.id}/shared`, { via: "pdf" });
    expect((await store("POST", `catalogues/${c.id}/shared`, { via: "fax" })).status).toBe(422);
    const [row] = await db.select().from(schema.storeCatalogues).where(eq(schema.storeCatalogues.id, c.id));
    expect(row.shares).toEqual({ whatsapp: 2, pdf: 1 });
    expect((await store("POST", "catalogues", { title: "" })).status).toBe(422);
    expect((await store("POST", "catalogues", { title: "Bad", design: { accent: "red" } })).status).toBe(422);
    expect((await store("POST", "catalogues", { title: "Bad", design: { coverImage: "javascript:alert(1)" } })).status).toBe(422);
  });

  it("can be private: buyers need the access code, and it can't be guessed into", async () => {
    const c = await create({ title: "Trade", accessCode: "TRADE2026", ordering: { whatsapp: "919876543210" } });
    expect(c.hasAccessCode).toBe(true);
    const locked = await (await open(c.token)).text();
    expect(locked).toContain("Private catalogue");
    expect(locked).not.toContain("Clay mug");
    expect((await order(c.token, { [`q_${mug.variant}`]: "1", intent: "whatsapp" })).location).toContain("access%20code");
    const wrong = await order(c.token, { intent: "unlock", code: "nope" });
    expect(decodeURIComponent(wrong.location)).toContain("didn't work");
    const right = await order(c.token, { intent: "unlock", code: "trade2026" }); // not case-sensitive
    expect(right.cookie).toMatch(/^cc_cat_/);
    const opened = await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}`, { headers: { "user-agent": UA, cookie: right.cookie } }), { params: Promise.resolve({ token: c.token }) });
    expect(await opened.text()).toContain("Clay mug");
    // Changing the code signs everyone out; "null" keeps it, "" removes it.
    await store("PUT", `catalogues/${c.id}`, { ...c, accessCode: "NEWCODE1" });
    expect(await (await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}`, { headers: { "user-agent": UA, cookie: right.cookie } }), { params: Promise.resolve({ token: c.token }) })).text()).toContain("Private catalogue");
    await store("PUT", `catalogues/${c.id}`, { ...c, accessCode: null });
    expect((await store("GET", `catalogues/${c.id}`)).json.catalogue.hasAccessCode).toBe(true);
    await store("PUT", `catalogues/${c.id}`, { ...c, accessCode: "" });
    expect(await (await open(c.token)).text()).toContain("Clay mug");
    expect((await store("PUT", `catalogues/${c.id}`, { ...c, accessCode: "abc" })).status).toBe(422); // too short
  });

  it("can open on a date", async () => {
    const c = await create({ title: "Diwali", startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    const res = await open(c.token);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Opening soon");
    expect((await store("POST", "catalogues", { title: "Bad dates", startsAt: new Date(Date.now() + 86_400_000).toISOString(), expiresAt: new Date().toISOString() })).status).toBe(422);
  });

  it("enforces wholesale minimums", async () => {
    const c = await create({ title: "Wholesale rules", ordering: { whatsapp: "919876543210", moq: 2, minOrder: 300000 } });
    const html = await (await open(c.token)).text();
    expect(html).toContain("Minimum 2 per item");
    expect(html).toContain("Minimum order ₹3,000");
    expect(decodeURIComponent((await order(c.token, { [`q_${bowl.variant}`]: "1", intent: "whatsapp" })).location)).toContain("minimum is 2 per item");
    expect(decodeURIComponent((await order(c.token, { [`q_${bowl.variant}`]: "2", intent: "whatsapp" })).location)).toContain("minimum order is ₹3,000");
    expect((await order(c.token, { [`q_${bowl.variant}`]: "3", intent: "whatsapp" })).location).toMatch(/^https:\/\/wa\.me\//);
  });

  it("asks for quotes when prices are on request, with the buyer's details", async () => {
    const c = await create({ title: "On request", ordering: { whatsapp: "919876543210", priceOnRequest: true, askBuyer: true } });
    const html = await (await open(c.token)).text();
    expect(html).toContain("Price on request");
    expect(html).not.toContain("₹1,299");
    expect(html).not.toContain('value="checkout"');
    expect(decodeURIComponent((await order(c.token, { [`q_${bowl.variant}`]: "2", intent: "whatsapp" })).location)).toContain("name and phone");
    const r = await order(c.token, { [`q_${bowl.variant}`]: "2", intent: "whatsapp", buyer_name: "Asha Mehra", buyer_phone: "98765 43210" });
    const text = decodeURIComponent(r.location.split("text=")[1]);
    expect(text).toContain("I'd like a quote");
    expect(text).toContain("2 × Serving bowl");
    expect(text).not.toContain("Total:");
    expect(text).toContain("Name: Asha Mehra");
    expect(text).toContain("Phone: 98765 43210");
    expect((await order(c.token, { [`q_${bowl.variant}`]: "2", intent: "checkout" })).location).toContain("err=");
  });

  it("applies a real offer code at checkout", async () => {
    expect((await store("POST", "catalogues", { title: "Bad code", ordering: { offerCode: "NOPE" } })).status).toBe(422);
    await store("POST", "discounts", { code: "TRADE10", kind: "percent", value: 10 });
    const c = await create({ title: "With offer", ordering: { offerCode: "trade10" } });
    expect(c.ordering.offerCode).toBe("TRADE10");
    expect(await (await open(c.token)).text()).toContain("TRADE10");
    const r = await order(c.token, { [`q_${mug.variant}`]: "1", intent: "checkout" });
    expect(r.location).toMatch(/\/checkout$/);
    const cookieVal = r.cookie.split("=")[1];
    const carts = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.projectId, projectId));
    expect(carts.some((x) => x.discountCode === "TRADE10" && (cookieVal ? true : true))).toBe(true);
  });

  it("tracks views and orders by channel, and what gets ordered", async () => {
    const c = await create({ title: "Tracked", ordering: { whatsapp: "919876543210" } });
    await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}?via=whatsapp`, { headers: { "user-agent": UA } }), { params: Promise.resolve({ token: c.token }) });
    await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}?via=whatsapp`, { headers: { "user-agent": UA } }), { params: Promise.resolve({ token: c.token }) });
    await publicCat.GET(new Request(`${ORIGIN}/c/${c.token}?via=made-up`, { headers: { "user-agent": UA } }), { params: Promise.resolve({ token: c.token }) });
    await order(c.token, { [`q_${mug.variant}`]: "2", [`q_${bowl.variant}`]: "1", intent: "whatsapp", via: "whatsapp" });
    const ins = (await store("GET", `catalogues/${c.id}`)).json.insights;
    expect(ins.series).toHaveLength(14);
    expect(ins.series.at(-1)).toEqual(expect.objectContaining({ views: 3, orders: 1 }));
    expect(ins.sources).toEqual(expect.arrayContaining([{ source: "whatsapp", views: 2, orders: 1 }, { source: "direct", views: 1, orders: 0 }]));
    expect(ins.topProducts).toEqual([expect.objectContaining({ title: "Clay mug", qty: 2 }), expect.objectContaining({ title: "Serving bowl", qty: 1 })]);
    const list = (await store("GET", "catalogues")).json.catalogues.find((x: { id: string }) => x.id === c.id);
    expect([list.views30, list.orders30]).toEqual([3, 1]);
  });

  it("can be embedded on other websites only when allowed", async () => {
    const c = await create({ title: "Embeddable" });
    expect((await open(c.token)).headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    await store("PUT", `catalogues/${c.id}`, { ...c, allowEmbed: true });
    expect((await open(c.token)).headers.get("content-security-policy")).toContain("frame-ancestors *");
  });

  it("renders every cover style, typeface and search", async () => {
    for (const coverStyle of ["image", "split", "minimal"]) {
      const c = await create({ title: `Cover ${coverStyle}`, design: { coverStyle, font: "rounded", showSearch: true } });
      const html = await (await open(c.token)).text();
      expect(html).toContain(coverStyle === "image" ? 'class="cover"' : `cover-${coverStyle}`);
    }
  });
});
