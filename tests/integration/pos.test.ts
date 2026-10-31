import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { isValidEan13 } from "@/lib/store/barcode";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let biller = "";
let projectId = "";
const store = (method: string, path: string, body?: unknown, c = cookie) => call(admin[method as "GET"], { method, cookie: c, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const draft = (title: string, price: number | null, extra: Record<string, unknown> = {}) => ({ title, description: "", category: "", tags: [], vendor: "", images: [], hsn: "", active: true, options: [], variants: [{ options: {}, price, compareAt: null, cost: null, sku: "", stock: 5, weightGrams: null }], ...extra });
let mug: { id: string; variantId: string; barcode: string } = { id: "", variantId: "", barcode: "" };
let tee: { id: string; variants: { id: string; title: string }[] } = { id: "", variants: [] };

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pooja Pos", email: "pooja@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Corner Shop" } })).json.project.id;
  await store("POST", "setup", { name: "Corner Shop", template: "home", country: "IN", region: "Karnataka", replaceDesign: true });
  biller = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bill Ing", email: "bill@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "bill@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "billing" });
});
afterAll(closeDb);

describe("imported products", () => {
  it("can always be edited and saved afterwards", async () => {
    const long = "Hand-thrown speckled stoneware mug with a matte sage glaze, a generous thumb rest, and a foot left raw so the clay shows — made in small batches in Khurja";
    const r = await store("POST", "import/smart", { products: [draft(long + " extra words to exceed the limit", 45000, { hsn: "69120" }), draft("Cotton Tee", 79900, { options: [{ name: "Size", values: ["M", "L"] }], variants: [{ options: { Size: "M" }, price: 79900, compareAt: null, cost: null, sku: "TEE-M", stock: 3, weightGrams: null }, { options: { Size: "L" }, price: 79900, compareAt: null, cost: null, sku: "TEE-L", stock: 2, weightGrams: null }] })] });
    expect(r.json).toMatchObject({ imported: 2, drafts: 0, problems: [] });
    const list = (await store("GET", "products")).json.products as { id: string; title: string; isSample: boolean }[];
    const m = list.find((p) => p.title.startsWith("Hand-thrown"))!;
    expect(m.title.length).toBeLessThanOrEqual(160);
    // The editor sends the whole product back: it must save.
    const full = (await store("GET", `products/${m.id}`)).json;
    const p = full.product ?? full;
    expect(p.hsn).toBe(""); // the 5-digit HSN from the file was dropped, not kept invalid
    const body = { ...p, title: "Sage Mug", variants: p.variants.map((v: Record<string, unknown>) => ({ id: v.id, options: v.options, sku: v.sku, price: v.price, compareAt: v.compareAt, cost: v.cost, trackInventory: v.trackInventory, stock: v.stock, weightGrams: v.weightGrams })) };
    const saved = await store("PUT", `products/${m.id}`, body);
    expect(saved.status).toBe(200);
    expect(saved.json.product.title).toBe("Sage Mug");
    mug = { id: m.id, variantId: p.variants[0].id, barcode: "" };
    const t = list.find((x) => x.title === "Cotton Tee")!;
    const tf = (await store("GET", `products/${t.id}`)).json;
    tee = { id: t.id, variants: (tf.product ?? tf).variants };
  });

  it("show on the live shop, and template samples step aside", async () => {
    const dep = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
    const home = await (await siteServe.GET(new Request(`${ORIGIN}/sites/${dep}/`), { params: Promise.resolve({ deploymentId: dep, path: [] }) })).text();
    expect(home).toContain("Sage Mug");
    expect(home).toContain("Cotton Tee");
    const samples = (await store("GET", "products")).json.products.filter((p: { isSample: boolean }) => p.isSample);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(home).not.toContain(s.title);
  });
});

describe("barcodes and scanning", () => {
  it("assigns unique in-store EAN-13 codes and keeps them on save", async () => {
    const r = await store("POST", "barcodes", {});
    expect(r.json.assigned).toBe(3); // the mug and two tee sizes; samples are skipped
    const v = (await store("GET", "pos")).json.products.flatMap((p: { variants: { barcode: string }[] }) => p.variants.map((x) => x.barcode));
    expect(v.every((c: string) => isValidEan13(c) && c.startsWith("20"))).toBe(true);
    expect(new Set(v).size).toBe(v.length);
    expect((await store("POST", "barcodes", {})).json.assigned).toBe(0);
    mug.barcode = (await store("GET", "pos")).json.products.find((p: { id: string }) => p.id === mug.id).variants[0].barcode;
  });

  it("refuses a barcode another product already uses", async () => {
    const full = (await store("GET", `products/${tee.id}`)).json;
    const p = full.product ?? full;
    const r = await store("PUT", `products/${tee.id}`, { ...p, variants: p.variants.map((v: Record<string, unknown>, i: number) => ({ id: v.id, options: v.options, sku: v.sku, price: v.price, stock: v.stock, barcode: i === 0 ? mug.barcode : v.barcode })) });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toBe(`Barcode ${mug.barcode} is already used by “Sage Mug”`);
  });

  it("finds items by barcode, SKU or product QR", async () => {
    const look = async (code: string) => (await store("GET", `pos/lookup?code=${encodeURIComponent(code)}`)).json.match;
    expect(await look(mug.barcode)).toMatchObject({ variantId: mug.variantId });
    expect(await look("tee-l")).toMatchObject({ variantId: tee.variants[1].id });
    expect(await look(`https://example.com/s/x/y/product/cotton-tee?v=${tee.variants[0].id}`)).toMatchObject({ variantId: tee.variants[0].id });
    expect(await look("https://example.com/s/x/y/product/cotton-tee")).toMatchObject({ variantId: null, ambiguous: true });
    expect(await look("0000000000000")).toBeNull();
  });
});

describe("selling at the counter", () => {
  let orderId = "";
  it("sells for cash with GST, change, stock and an invoice number", async () => {
    const r = await store("POST", "pos/sale", { clientRef: "till-1-0001", lines: [{ variantId: mug.variantId, quantity: 2 }, { variantId: tee.variants[0].id, quantity: 1 }], payment: { method: "cash", tendered: 200000 }, customer: { name: "Ravi", phone: "9876543210" } });
    expect(r.status).toBe(201);
    const o = r.json.order;
    orderId = o.id;
    expect(o).toMatchObject({ channel: "pos", financialStatus: "paid", fulfillmentStatus: "delivered", paymentMethod: "pos_cash", subtotal: 169900, total: 169900, taxIncluded: true });
    expect(o.taxTotal).toBe(169900 - Math.round(90000 / 1.18) - Math.round(79900 / 1.18));
    expect(o.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    expect(r.json.change).toBe(30100);
    const stock = (await store("GET", "pos")).json.products.find((p: { id: string }) => p.id === mug.id).variants[0].stock;
    expect(stock).toBe(3);
    // A retried request doesn't sell twice.
    const again = await store("POST", "pos/sale", { clientRef: "till-1-0001", lines: [{ variantId: mug.variantId, quantity: 2 }], payment: { method: "cash", tendered: 200000 } });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true, order: { id: orderId } });
  });

  it("checks cash, stock and price-change rights", async () => {
    expect((await store("POST", "pos/sale", { clientRef: "till-1-0002", lines: [{ variantId: mug.variantId, quantity: 1 }], payment: { method: "cash", tendered: 100 } })).json.error.message).toBe("Cash received is less than the total");
    const short = await store("POST", "pos/sale", { clientRef: "till-1-0003", lines: [{ variantId: tee.variants[1].id, quantity: 5 }], payment: { method: "upi" } });
    expect(short.status).toBe(409);
    expect(short.json.error.message).toBe("Not enough stock: Cotton Tee (L) has 2");
    const ok = await store("POST", "pos/sale", { clientRef: "till-1-0004", lines: [{ variantId: tee.variants[1].id, quantity: 5 }], payment: { method: "upi", reference: "UTR123" }, allowOversell: true });
    expect(ok.status).toBe(201);
    expect((await store("POST", "pos/sale", { clientRef: "till-2-0001", lines: [{ variantId: mug.variantId, quantity: 1, unitPrice: 100 }], payment: { method: "card" } }, biller)).json.error.message).toBe("Only people who manage the catalog can change prices at the till");
    const disc = await store("POST", "pos/sale", { clientRef: "till-1-0005", lines: [{ variantId: mug.variantId, quantity: 1 }], discount: { kind: "percent", value: 10 }, payment: { method: "card", reference: "4242" } }, biller);
    expect(disc.json.order).toMatchObject({ discountTotal: 4500, total: 40500, paymentMethod: "pos_card" });
  });

  it("summarises the day and prints a receipt", async () => {
    const s = (await store("GET", "pos/summary")).json;
    expect(s).toMatchObject({ sales: 3, byMethod: { cash: 169900, upi: 399500, card: 40500 } });
    expect(s.items).toBe(9);
    const res = await call(admin.GET, { cookie, path: `/api/v1/projects/${projectId}/store/pos/receipt/${orderId}`, params: { projectId, slug: ["pos", "receipt", orderId] } });
    expect(res.text).toContain("Tax invoice INV/");
    expect(res.text).toContain("CGST (incl.)");
    expect(res.text).toContain("Change");
    expect(res.text).toContain("Shop online any time"); // QR to the live site
    // POS orders refund like any order.
    const refund = await store("POST", `orders/${orderId}`, { action: "refund", amount: 45000, reason: "Chipped", restock: true });
    expect(refund.status).toBe(200);
  });
});
