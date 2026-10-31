// Real screenshots for the online store and the point of sale
// (public/marketing/store/ and public/marketing/pos/). Each run signs up a
// fresh "Asha's Studio" workspace on the local dev server with a teammate,
// a little mail and chat (so the sidebar shows its everyday badges), then:
//   • The Bread Room — a Bengaluru bakery-café: real products with photos,
//     variants, collections and costs; a month of counter sales rung up
//     through the till's own API; then a sale on the till itself, its
//     receipt, today's takings, labels and the store admin screens.
//   • NOIR/DEPT — the Noir streetwear template, published: its storefront on
//     desktop and phone, and its sample products in the admin.
//   • A design picker and every modern store template, published and
//     captured as a full page (store/templates/<id>.jpg).
//   npx playwright test -c scripts/marketing/pw.config.ts capture-store
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import sharp from "sharp";
import { db, schema } from "../../src/db";
import { ingest } from "../../src/server/mail/sync";
import { encryptSecret } from "../../src/server/security/secrets";
import { clean, ip, shoot } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const O = { origin: BASE };
const U = (id: string, w = 1200) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IST = 330 * 60_000;

test.describe.configure({ mode: "serial" });
test.use({ timezoneId: "Asia/Kolkata" });

type Api = <R = any>(method: string, path: string, body?: unknown) => Promise<R>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Runs a step, and once more if the busy dev server drops it. */
async function retry<R>(what: string, fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { final?: boolean }).final) throw e;
    console.warn(`↻ ${what}: ${String(e).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000));
    return fn();
  }
}

const apiFor = (req: APIRequestContext): Api => async (method, path, body) =>
  retry(`${method} ${path}`, async () => {
    const res = await req.fetch(`/api/v1/${path}`, { method, data: body, headers: O, timeout: 180_000 });
    const text = await res.text();
    if (!res.ok()) {
      const err = new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 300)}`);
      if (res.status() < 500) Object.assign(err, { final: true });
      throw err;
    }
    return (text ? JSON.parse(text) : {}) as never;
  });

async function signup(req: APIRequestContext, name: string, email: string, orgName?: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, ...(orgName ? { orgName } : {}) }, headers: { ...O, "x-forwarded-for": ip() }, timeout: 180_000 });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O, timeout: 180_000 });
  const me = await (await req.get("/api/v1/auth/me", { timeout: 180_000 })).json();
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  return { userId: me.user.id as string, orgId: me.organizations[0].id as string, orgSlug: me.organizations[0].slug as string };
}

/**
 * Asha's Studio: the owner, her shop-floor lead and an everyday inbox, so
 * the sidebar's Mail and Chat rows carry their usual unread counts.
 */
async function workspace(page: Page, browser: Browser, opts: { everyday?: boolean } = {}) {
  const owner = await signup(page.request, "Asha Mehra", `asha.${T}.${Math.random().toString(36).slice(2, 6)}@ashasstudio-demo.in`, "Asha's Studio");
  const api = apiFor(page.request);
  await api("PUT", `orgs/${owner.orgId}/modules`, { modules: ["store", "pos", "invoicing", "mail", "calendar", "chat"] });
  if (opts.everyday === false) return { ...owner, api };

  // A teammate who runs the counter.
  const ctx = await browser.newContext({ baseURL: BASE });
  const kabir = await signup(ctx.request, "Kabir Shah", `kabir.${T}.${Math.random().toString(36).slice(2, 6)}@ashasstudio-demo.in`);
  await db.insert(schema.memberships).values({ orgId: owner.orgId, userId: kabir.userId, role: "editor" } as never);
  const K = apiFor(ctx.request);
  const meta = await api<{ channels: { id: string; name: string }[] }>("GET", `orgs/${owner.orgId}/chat/meta`);
  const general = meta.channels.find((c) => c.name === "general")?.id;
  if (general) {
    await K("POST", `orgs/${owner.orgId}/chat/channels/${general}/messages`, { body: "Morning! Sourdough is out of the oven — 30 loaves on the shelf, 6 kept aside for the Indiranagar pre-orders." }).catch(() => {});
    await K("POST", `orgs/${owner.orgId}/chat/channels/${general}/messages`, { body: "Milk delivery came in short by 10 litres, Nandini says the rest arrives by 11." }).catch(() => {});
  }
  await ctx.close();

  // Mail through the real ingest pipeline (the mailbox is paused: nothing is sent or fetched).
  const [acc] = await db
    .insert(schema.mailAccounts)
    .values({ orgId: owner.orgId, ownerId: owner.userId, name: "The Bread Room", address: "asha@thebreadroom.in", displayName: "Asha Mehra", provider: "google_workspace", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "asha@thebreadroom.in", secretEnc: encryptSecret("demo"), status: "paused", color: "#d97706", settings: { syncDays: 30, sendDelaySec: 10 } } as never)
    .returning();
  let uid = 1;
  const mail = async (m: Record<string, unknown>, minsAgo: number) => ingest(acc!, "INBOX", uid++, await new MailComposer({ to: "asha@thebreadroom.in", date: new Date(Date.now() - minsAgo * 60_000), ...m } as never).compile().build(), []);
  await mail({ from: "Priya Nair <priya@thirdwavecoffee.example>", subject: "Weekly croissant order — 120 boxes", text: "Hi Asha,\n\nCan we bump this Saturday's order to 120 boxes of six? Same delivery window, 7:30 am at the Koramangala outlet.\n\nThanks,\nPriya" }, 45);
  await mail({ from: "Hosur Flour Mills <orders@hosurflour.example>", subject: "Invoice HFM-2291 — 25 kg T65 flour × 12", text: "Please find the invoice for this week's flour delivery. Payment due in 15 days." }, 160);
  await mail({ from: "Rahul Desai <rahul@desaica.example>", subject: "October GST — sales summary needed", text: "Hi Asha, please share the counter and online sales summary for October by the 5th so we can file GSTR-1." }, 320);
  return { ...owner, api };
}

async function go(page: Page, path: string, opts: { text?: string | RegExp; settle?: number } = {}) {
  await retry(`open ${path}`, async () => {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    if (opts.text) await expect(page.getByText(opts.text).first()).toBeVisible({ timeout: 120_000 });
  });
  for (const name of [/^Got it$/, /^Not now$/, /^Skip setup$/]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
  await clean(page);
  await page.waitForTimeout(opts.settle ?? 1500);
}

/**
 * Saves a panel at a fixed pixel size (at 2×), centred on an element — the
 * size the marketing pages already lay out for it. `top` pins the crop's top
 * edge that far (CSS px) above the element instead of centring it vertically.
 */
async function panelAt(loc: Locator, dir: string, name: string, px: [w: number, h: number], top?: number) {
  const page = loc.page();
  await page.waitForTimeout(700);
  await clean(page);
  const b = (await loc.boundingBox())!;
  // Screenshots clip to whole CSS pixels, so take a hair more and trim to the exact size.
  const width = Math.ceil(px[0] / 2), height = Math.ceil(px[1] / 2);
  const x = Math.max(0, Math.round(b.x - (width - b.width) / 2));
  const y = Math.max(0, Math.round(top === undefined ? b.y - (height - b.height) / 2 : b.y - top));
  const out = join(process.cwd(), "public", "marketing", dir);
  mkdirSync(out, { recursive: true });
  const shot = await page.screenshot({ type: "png", clip: { x, y, width, height } });
  await sharp(shot).extract({ left: 0, top: 0, width: px[0], height: px[1] }).jpeg({ quality: 85 }).toFile(join(out, `${name}.jpg`));
}

/** Scrolls the whole page so lazy photos load and reveal-on-scroll sections show. */
async function scrollThrough(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 400) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
}

async function deploy(api: Api, projectId: string) {
  const { deployment } = await api<{ deployment: { id: string; error: string | null } }>("POST", `projects/${projectId}/deployments`, { environment: "production" });
  expect(deployment.error ?? "", "deploy failed").toBe("");
  await expect.poll(async () => (await api<{ deployments: { id: string; status: string }[] }>("GET", `projects/${projectId}/deployments`)).deployments.find((d) => d.id === deployment.id)?.status, { timeout: 180_000, intervals: [2000] }).toBe("ready");
}

const sitePath = async (api: Api, orgSlug: string, projectId: string) => `/s/${orgSlug}/${(await api<{ project: { slug: string } }>("GET", `projects/${projectId}`)).project.slug}`;

/** A tiny seeded random, so every run rings up the same believable day. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

// ─────────────────────────────────────────────────────────────────────────────
// The Bread Room: the store admin, the till and its receipts.
// ─────────────────────────────────────────────────────────────────────────────
test("The Bread Room — store admin and point of sale", async ({ page, browser }) => {
  test.setTimeout(3_000_000);
  const { api, orgId } = await workspace(page, browser);
  const { project } = await api<{ project: { id: string } }>("POST", `orgs/${orgId}/projects`, { templateId: "store", name: "The Bread Room" });
  const id = project.id;
  const S = (p: string) => `projects/${id}/store/${p}`;
  const setup = { name: "The Bread Room", currency: "INR", country: "IN", region: "Karnataka", email: "orders@thebreadroom.example" };
  await api("POST", S("setup"), setup);

  // GST: prices include 5% GST, and the shop's GSTIN prints on every receipt.
  const taxes = await api<{ rates: { country: string; region: string; rateBps: number; name: string }[] }>("GET", S("taxes"));
  const rates = (taxes.rates ?? []).map(({ country, region, rateBps, name }) => ({ country, region, rateBps, name }));
  await api("PUT", S("taxes"), { pricesIncludeTax: true, defaultTaxBps: 500, taxId: "29AABCT0000T1Z7", rates }).catch(async (e) => {
    console.warn(`GSTIN not accepted (${String(e).slice(0, 120)}); saving GST without it`);
    await api("PUT", S("taxes"), { pricesIncludeTax: true, defaultTaxBps: 500, taxId: "", rates });
  });
  // UPI for the till's pay-by-QR (a demo ID that can't receive real money).
  await api("PUT", S("payments/manual"), { enabled: true, settings: { label: "UPI / bank transfer", upiId: "breadroom.demo@example", instructions: "Pay by UPI to breadroom.demo@example and share the reference." } });

  // Collections, then the real products (created oldest-first so the list reads coffee first).
  const col: Record<string, string> = {};
  for (const title of ["Breads", "Pastries & treats", "Coffee"]) col[title] = (await api<{ collection: { id: string } }>("POST", S("collections"), { title })).collection.id;
  type V = { id: string; options: Record<string, string>; price: number };
  type P = { id: string; title: string; variants: V[] };
  const products: Record<string, P> = {};
  const add = async (key: string, body: Record<string, unknown>) => (products[key] = (await api<{ product: P }>("POST", S("products"), { status: "active", ...body })).product);
  await add("croissant", {
    title: "Butter croissant box",
    description: "Six all-butter croissants, laminated by hand.",
    images: [U("1555507036-ab1f4038808a")],
    hsn: "1905",
    tags: ["bakery", "breakfast"],
    collectionIds: [col["Pastries & treats"]],
    options: [{ name: "Box", values: ["Box of 6", "Box of 12"] }],
    variants: [
      { options: { Box: "Box of 6" }, price: 44900, cost: 21000, stock: 400, trackInventory: true, weightGrams: 420 },
      { options: { Box: "Box of 12" }, price: 84900, cost: 40000, stock: 400, trackInventory: true, weightGrams: 840 },
    ],
  });
  await add("sourdough", { title: "Country sourdough loaf", description: "A 36-hour levain loaf with a crackly crust and an open crumb. 800 g.", images: [U("1509440159596-0249088772ff")], hsn: "1905", tags: ["bread"], collectionIds: [col.Breads], variants: [{ options: {}, price: 24900, cost: 9500, stock: 400, trackInventory: true, weightGrams: 800 }] });
  await add("cupcakes", { title: "Mint frosting cupcakes", description: "Four vanilla cupcakes with mint buttercream and sprinkles.", images: [U("1486427944299-d1955d23e34d")], hsn: "1905", tags: ["cakes"], collectionIds: [col["Pastries & treats"]], variants: [{ options: {}, price: 39900, cost: 16000, stock: 400, trackInventory: true, weightGrams: 320 }] });
  await add("beans", {
    title: "House espresso beans",
    description: "Chocolatey, low-acid medium roast from Chikmagalur. 250 g, roasted every Tuesday.",
    images: [U("1587734195503-904fca47e0e9")],
    hsn: "0901",
    tags: ["coffee"],
    collectionIds: [col.Coffee],
    options: [{ name: "Grind", values: ["Whole bean", "Espresso", "Filter"] }],
    variants: ["Whole bean", "Espresso", "Filter"].map((g) => ({ options: { Grind: g }, price: 59900, cost: 31000, stock: 300, trackInventory: true, weightGrams: 250 })),
  });
  await add("cappuccino", { title: "Cappuccino", description: "A double shot of our house espresso with velvety foam.", images: [U("1509042239860-f550ce710b93")], hsn: "2101", tags: ["coffee", "cafe"], collectionIds: [col.Coffee], variants: [{ options: {}, price: 16000, cost: 4500, stock: 600, trackInventory: true }] });
  await add("latte", { title: "Iced latte", description: "A double shot over ice with cold milk.", images: [U("1541167760496-1628856ab772")], hsn: "2101", tags: ["coffee", "cafe"], collectionIds: [col.Coffee], variants: [{ options: {}, price: 19000, cost: 5500, stock: 600, trackInventory: true }] });
  await add("filter", { title: "Filter coffee powder, 250 g", description: "South Indian filter blend, 80:20 coffee and chicory, ground fresh.", images: [U("1511920170033-f8396924c348")], hsn: "0901", tags: ["coffee"], collectionIds: [col.Coffee], variants: [{ options: {}, price: 32000, cost: 17000, stock: 400, trackInventory: true, weightGrams: 250 }] });
  // The bakery design, applied after the real products so no samples are added.
  await api("POST", S("setup"), { ...setup, template: "bakery", replaceDesign: true });
  await api("POST", S("barcodes"), {});

  // ── A month at the counter, rung up through the till's own API ──
  const v = (k: string, i = 0) => products[k]!.variants[i]!.id;
  const items: [string, number][] = [["sourdough", 0], ["cappuccino", 0], ["latte", 0], ["filter", 0], ["cupcakes", 0], ["croissant", 0], ["croissant", 1], ["beans", 0], ["beans", 1], ["beans", 2]];
  const weights = [16, 22, 14, 8, 9, 12, 3, 4, 3, 3];
  const rand = rng(4242);
  const pickItem = () => {
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (const [i, w] of weights.entries()) if ((r -= w) < 0) return items[i]!;
    return items[0]!;
  };
  const basket = () => {
    const n = 1 + Math.floor(rand() * rand() * 4);
    const m = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const [k, vi] = pickItem();
      const key = v(k, vi);
      m.set(key, (m.get(key) ?? 0) + (k === "cappuccino" && rand() < 0.4 ? 2 : 1));
    }
    return [...m].map(([variantId, quantity]) => ({ variantId, quantity }));
  };
  const named = [["Fatima Sheikh", "98451 22036"], ["Karan Mehta", "99000 41782"], ["Sneha Iyer", "98860 13579"], ["Arjun Nair", "97411 60224"], ["Ritu Sharma", "99860 72413"], ["Vikram Rao", "98440 55120"], ["Meera Pillai", "99459 31876"]] as const;
  let ref = 0;
  const ring = async (at: Date, opts: { customer?: readonly [string, string] } = {}) => {
    const lines = basket();
    const r = rand();
    const method = r < 0.58 ? "upi" : r < 0.86 ? "cash" : "card";
    const sale = await api<{ order: { id: string; total: number } }>("POST", S("pos/sale"), {
      lines,
      discount: null,
      customer: { name: opts.customer?.[0] ?? "", phone: opts.customer?.[1] ?? "", email: "" },
      payment: { method, reference: "" },
      clientRef: `bread-${T}-${ref++}`,
    });
    const order = sale.order;
    // The sale happened earlier: move it (and its timeline) to when it was rung up.
    await db.update(schema.storeOrders).set({ createdAt: at, paidAt: at, fulfilledAt: at } as never).where(eq(schema.storeOrders.id, order.id));
    await db.update(schema.storeOrderEvents).set({ createdAt: at } as never).where(eq(schema.storeOrderEvents.orderId, order.id));
    return order;
  };
  const now = Date.now();
  const istMidnight = Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST; // today 00:00 in IST, as UTC ms
  for (let d = 29; d >= 1; d--) {
    const dow = new Date(istMidnight - d * 86_400_000 + IST).getUTCDay();
    const n = (dow === 0 || dow === 6 ? 3 : 1) + Math.floor(rand() * 2);
    const times = Array.from({ length: n }, () => 8.5 + rand() * 12.5).sort((a, b) => a - b);
    for (const h of times) await ring(new Date(istMidnight - d * 86_400_000 + h * 3_600_000), { customer: rand() < 0.2 ? named[Math.floor(rand() * named.length)] : undefined });
  }
  // Today: 28 sales since the doors opened at 9.
  const open = istMidnight + 9 * 3_600_000 + 5 * 60_000;
  const last = Math.max(open + 3 * 3_600_000, now - 25 * 60_000);
  const todayNamed = new Map<number, readonly [string, string]>([[5, named[0]], [8, named[1]], [11, named[2]], [16, named[3]], [19, named[4]]]);
  for (let i = 0; i < 28; i++) {
    const at = open + ((last - open) * i) / 27 + Math.floor(rand() * 9 - 4) * 60_000;
    await ring(new Date(Math.min(at, now - 5 * 60_000)), { customer: todayNamed.get(i) });
  }

  // Tonight's stock count on the shelves.
  const count: [string, number, number][] = [["filter", 0, 30], ["latte", 0, 29], ["cappuccino", 0, 28], ["beans", 0, 9], ["beans", 1, 8], ["beans", 2, 8], ["cupcakes", 0, 15], ["sourdough", 0, 30], ["croissant", 0, 13], ["croissant", 1, 7]];
  for (const [k, i, n] of count) await api("POST", S(`inventory/${v(k, i)}`), { mode: "set", quantity: n, reason: "Shelf count" });

  // ── Store admin ──
  const P = `/projects/${id}/store`;
  await go(page, P, { text: "Get ready to sell", settle: 2500 });
  await page.getByRole("radio", { name: "30 days" }).click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 890);
  await shoot(page, "store", "overview");
  await go(page, `${P}/orders`, { text: "Walk-in customer", settle: 1500 });
  await shoot(page, "store", "orders");
  await go(page, `${P}/products`, { text: "Butter croissant box", settle: 2500 });
  await shoot(page, "store", "products");
  await go(page, `${P}/products/${products.croissant!.id}`, { text: "Labels & scanning", settle: 3000 });
  await page.mouse.move(5, 890);
  await shoot(page, "store", "editor");
  await go(page, `${P}/labels`, { text: /Print \d+ labels/, settle: 3000 });
  await shoot(page, "pos", "labels");
  await page.getByRole("button", { name: /Print \d+ labels/ }).first().click();
  await expect(page.getByRole("dialog").getByText("Print preview").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await shoot(page, "pos", "print", { settle: 1500 });
  await page.keyboard.press("Escape");

  // ── The till ──
  await go(page, `/projects/${id}/pos`, { text: "Country sourdough loaf", settle: 3000 });
  const tile = (name: string) => page.locator("button.glass-card", { hasText: name }).first();
  const grid = page.locator("main div.grid").first();
  await page.locator("input[aria-label^='Scan or type']").blur().catch(() => {});
  await page.mouse.move(1430, 890);
  await panelAt(grid, "pos", "grid-panel", [2070, 1060], 14);
  await tile("Country sourdough loaf").click();
  await tile("Cappuccino").click();
  await tile("Cappuccino").click();
  await tile("Mint frosting cupcakes").click();
  await tile("Iced latte").click();
  await page.getByRole("button", { name: "Customer", exact: true }).click();
  await page.getByLabel("Customer name").fill("Ananya Rao");
  await page.getByLabel("Customer phone").fill("98450 00000");
  await page.getByRole("radiogroup", { name: "Payment method" }).getByRole("radio", { name: "UPI" }).click();
  await page.waitForTimeout(1500);
  await page.locator("body").click({ position: { x: 900, y: 860 } });
  await page.mouse.move(1000, 880);
  await shoot(page, "pos", "till", { settle: 1500 });
  await panelAt(page.locator("aside .border-t.space-y-3").first(), "pos", "pay-panel", [799, 950]);

  // Ananya pays cash instead: ₹1,500 for a ₹1,158 bill.
  await page.getByRole("radiogroup", { name: "Payment method" }).getByRole("radio", { name: "Cash" }).click();
  await page.getByLabel("Cash received").fill("1500");
  const saleRes = page.waitForResponse((r) => r.url().includes("/pos/sale") && r.request().method() === "POST", { timeout: 180_000 });
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  const sold = (await (await saleRes).json()) as { order: { id: string } };
  const done = page.getByRole("dialog").filter({ hasText: "Sale complete" });
  await expect(done).toBeVisible({ timeout: 60_000 });
  await page.mouse.move(5, 890);
  await shoot(page, "pos", "done", { settle: 1500 });
  await panelAt(done, "pos", "done-panel", [700, 565]);

  // The printed receipt (80 mm), as the receipt window shows it.
  const rc = await browser.newContext({ baseURL: BASE, viewport: { width: 420, height: 640 }, deviceScaleFactor: 2, storageState: await page.context().storageState() });
  const rp = await rc.newPage();
  await go(rp, `/api/v1/projects/${id}/store/pos/receipt/${sold.order.id}`, { text: "Thank you", settle: 1200 });
  // The 80 mm slip at the size the site lays out (420 × 580), trimmed from the top margin.
  await shoot(rp, "pos", "receipt", { settle: 600, clip: { x: 0, y: 6, width: 420, height: 580 } });
  await rc.close();

  await done.getByRole("button", { name: "New sale" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Today" }).click();
  const today = page.getByRole("dialog").filter({ hasText: "Today at the till" });
  await expect(today.getByText("Recent sales")).toBeVisible({ timeout: 60_000 });
  await page.mouse.move(5, 890);
  await shoot(page, "pos", "today", { settle: 2000 });
  await panelAt(today, "pos", "today-panel", [1204, 1560]);
  await page.keyboard.press("Escape");

  // The same till on a phone, mid-sale.
  const mc = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE, timezoneId: "Asia/Kolkata", storageState: await page.context().storageState() });
  const m = await mc.newPage();
  await go(m, `/projects/${id}/pos`, { text: "Country sourdough loaf", settle: 2500 });
  const mt = (name: string) => m.locator("button.glass-card", { hasText: name }).first();
  await mt("Country sourdough loaf").tap();
  await mt("Cappuccino").tap();
  await mt("Cappuccino").tap();
  await m.locator("input[aria-label^='Scan or type']").blur().catch(() => {});
  await shoot(m, "pos", "phone", { settle: 1500 });
  await mc.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// NOIR/DEPT: the Noir template, published; plus the design picker.
// ─────────────────────────────────────────────────────────────────────────────
test("NOIR/DEPT — storefront, sample products and the design picker", async ({ page, browser }) => {
  test.setTimeout(1_800_000);
  const { api, orgId, orgSlug } = await workspace(page, browser);
  const { project } = await api<{ project: { id: string } }>("POST", `orgs/${orgId}/projects`, { templateId: "store", name: "NOIR/DEPT" });
  const id = project.id;
  await api("POST", `projects/${id}/store/setup`, { name: "NOIR/DEPT", currency: "INR", country: "IN", region: "Karnataka", email: "hello@noirdept.example", template: "noir", replaceDesign: true });
  await deploy(api, id);
  const SITE = await sitePath(api, orgSlug, id);

  await go(page, `/projects/${id}/store/products`, { text: "Night-shift heavyweight hoodie", settle: 2500 });
  await shoot(page, "store", "products-noir");

  // A new store project, at its first step: choosing a design.
  const fresh = (await api<{ project: { id: string } }>("POST", `orgs/${orgId}/projects`, { templateId: "store", name: "Asha's shop" })).project.id;
  await go(page, `/projects/${fresh}/store`, { text: "Add an online store", settle: 2000 });
  await page.getByRole("button", { name: "redesign this project as a store" }).click();
  await expect(page.getByText("Start selling online")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.mouse.move(5, 890);
  await shoot(page, "store", "picker", { settle: 2000 });

  // The storefront, as a shopper sees it. (No extra request headers here: they
  // would make the storefront's web-font requests cross-origin preflights, which the font CDN refuses.)
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, userAgent: UA });
  const v = await ctx.newPage();
  await go(v, `${SITE}/`, { text: /night shift/i, settle: 3500 });
  await shoot(v, "store", "sf-home", { settle: 1500 });
  await go(v, `${SITE}/shop`, { text: "Night-shift heavyweight hoodie", settle: 1500 });
  const href = await v.getByRole("link", { name: /Night-shift heavyweight hoodie/ }).first().getAttribute("href");
  await go(v, href!, { text: /Add to cart/i, settle: 3000 });
  await v.mouse.move(5, 890);
  await shoot(v, "store", "sf-product", { settle: 1500 });
  await ctx.close();

  const mc = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });
  const m = await mc.newPage();
  await go(m, `${SITE}/`, { text: /night shift/i, settle: 3500 });
  await shoot(m, "store", "sf-phone", { settle: 1500 });
  await mc.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Every modern store template, published as it comes, as a full page.
// ─────────────────────────────────────────────────────────────────────────────
test("store templates — full storefronts", async ({ page, browser }) => {
  test.setTimeout(3_600_000);
  const { api, orgId, orgSlug } = await workspace(page, browser, { everyday: false });
  const only = process.env.TEMPLATES?.split(",");
  const ids = ["noir", "kiln", "verde", "sonic", "casa", "lumen", "saanjh", "brewhouse", "harvest", "tote", "tinytales", "pawpal", "optica", "folio", "aurum", "kundan", "crumb"].filter((t) => !only || only.includes(t));
  const heroes = new Set(["noir", "kiln", "verde", "sonic", "casa"]);
  const failed: string[] = [];
  for (const t of ids) {
    try {
      await retry(`template ${t}`, async () => {
        const { project } = await api<{ project: { id: string } }>("POST", `orgs/${orgId}/projects`, { templateId: "store", name: `${t} store` });
        const info = await api<{ templates: { id: string; storeName: string }[] }>("GET", `projects/${project.id}/store`);
        const name = info.templates.find((x) => x.id === t)?.storeName ?? t;
        await api("POST", `projects/${project.id}/store/setup`, { name, currency: "INR", country: "IN", region: "Karnataka", email: "hello@shop.example", template: t, replaceDesign: true });
        await deploy(api, project.id);
        const SITE = await sitePath(api, orgSlug, project.id);

        // Reduced motion: every section shows as it does once a visitor has scrolled to it.
        const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, userAgent: UA, reducedMotion: "reduce" });
        const v = await ctx.newPage();
        await go(v, `${SITE}/`, { settle: 3000 });
        await scrollThrough(v);
        const height = await v.evaluate(() => document.documentElement.scrollHeight);
        await shoot(v, "store/templates", t, { fullPage: true, clip: { x: 0, y: 0, width: 1200, height }, settle: 1500 });
        await ctx.close();

        if (heroes.has(t)) {
          const hc = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, userAgent: UA });
          const h = await hc.newPage();
          await go(h, `${SITE}/`, { settle: 3500 });
          await shoot(h, "store/templates", `${t}-hero`, { settle: 1500 });
          await hc.close();
        }
      });
    } catch (e) {
      failed.push(t);
      console.warn(`✗ template ${t}: ${String(e).slice(0, 300)}`);
    }
  }
  expect(failed, `templates not captured: ${failed.join(", ")}`).toEqual([]);
});
