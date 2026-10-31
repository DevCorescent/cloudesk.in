// Re-shoots the Accounting feature page (public/marketing/accounting/) and the
// website-builder shots (public/marketing/builder/) with the current app shell
// (Mail, Calendar and Chat in the sidebar, with their badges).
//
// One demo business — Asha's Studio, a Bengaluru ceramics and interiors studio —
// is signed up fresh and filled through the app's own APIs: GST invoices with
// payments (Finance), counter sales at the till (POS), suppliers, purchase
// orders, goods received and stock adjustments (Inventory), eight people and
// September's payroll (HR), and in Accounts an opening balance, bills,
// expenses and the October HDFC statement. Only what has no API goes straight
// into the dev database: e-mail verification, a teammate's membership, the
// dates of the till sales (the till always sells "now"), and the paused
// demo mailbox that gives Mail its unread badge.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-books
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "../../src/db";
import { ingest } from "../../src/server/mail/sync";
import { encryptSecret } from "../../src/server/security/secrets";
import { clean, ip, shoot } from "./shoot";

test.describe.configure({ mode: "serial" });

const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const O = { origin: BASE };
const PW = "correct-horse-42";
const T = Date.now().toString(36);

// ── Dates (IST) ──
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const iso = (d = 0) => new Date(istNow().getTime() + d * 86_400_000).toISOString().slice(0, 10);
const TODAY = iso(0);
const MONTH = TODAY.slice(0, 7);
const prevMonth = (() => {
  const [y, m] = MONTH.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();
/** The financial year's first day (April). */
const FY_START = (() => {
  const [y, m] = TODAY.split("-").map(Number) as [number, number];
  return `${m >= 4 ? y : y - 1}-04-01`;
})();
const daysSince = (date: string) => Math.round((Date.parse(TODAY) - Date.parse(date)) / 86_400_000);

type Api = <R = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<R>;
const call = (req: APIRequestContext, prefix: string): Api => async (method, path, body) => {
  let last = "";
  // The shared dev server is busy with other captures; one retry on a timeout or 5xx.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await req.fetch(`${prefix}${path}`, { method, data: body, headers: O, timeout: 180_000 });
      const text = await res.text();
      if (res.ok()) return (text ? JSON.parse(text) : {}) as never;
      last = `${method} ${prefix}${path} → ${res.status()}: ${text.slice(0, 400)}`;
      if (res.status() < 500) break;
    } catch (e) {
      last = `${method} ${prefix}${path}: ${String(e).slice(0, 300)}`;
    }
  }
  throw new Error(last);
};

async function signup(req: APIRequestContext, name: string, email: string, orgName?: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, ...(orgName ? { orgName } : {}) }, headers: { ...O, "x-forwarded-for": ip() }, timeout: 180_000 });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O, timeout: 180_000 });
  const me = await (await req.get("/api/v1/auth/me", { timeout: 180_000 })).json();
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  return { userId: me.user.id as string, orgId: me.organizations[0].id as string };
}

/** Try a capture step twice: the shared dev server sometimes stalls on a compile. */
async function twice(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.log(`retrying ${label}: ${String(e).slice(0, 300)}`);
    await fn();
  }
}

async function open(page: Page, path: string, ready?: string | RegExp, settle = 1500) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (ready) {
    const ok = await expect(page.getByText(ready).first()).toBeVisible({ timeout: 60_000 }).then(() => true, () => false);
    if (!ok) {
      await page.reload({ timeout: 180_000 });
      await expect(page.getByText(ready).first()).toBeVisible({ timeout: 150_000 });
    }
  }
  const skip = page.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
  await clean(page);
  await page.waitForTimeout(settle);
}

/** No error toast, no failed screen, no dev overlay before a shot. */
async function assertClean(page: Page) {
  await expect(page.getByText(/Something went wrong|Unhandled Runtime Error|Failed to load/i)).toHaveCount(0);
}

/** Unread mail through the real ingest pipeline (the mailbox is paused). */
async function seedMail(orgId: string, ownerId: string, address: string, display: string, mails: { from: string; subject: string; text: string; ago: number }[]) {
  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId, name: display, address, displayName: display, provider: "google_workspace", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: address, secretEnc: encryptSecret("demo"), status: "paused", color: "#6366f1", settings: { syncDays: 30, sendDelaySec: 10 } } as never).returning();
  let uid = 1;
  for (const m of mails) await ingest(acc as never, "INBOX", uid++, await new MailComposer({ to: address, from: m.from, subject: m.subject, text: m.text, date: new Date(Date.now() - m.ago * 60_000) } as never).compile().build(), []);
}

// ── Shared state ──
let page: Page;
let orgId = "";
let api: Api; // /api/v1/orgs/<org>/
let acc: Api; // /api/v1/orgs/<org>/accounts/
const ids: Record<string, string> = {};

// ════════════════════════════════════════════════════════════════════════════
// Finance: the studio's GST invoices
// ════════════════════════════════════════════════════════════════════════════

type L = [name: string, hsn: string, unit: string, qty: number, rate: number];
const ITEMS = {
  styling: ["Interior styling consultation", "998391", "hr", 3500],
  boards: ["Concept & mood boards", "998391", "room", 18000],
  dinner: ["Custom dinnerware — 12-piece set", "6912", "set", 14500],
  mugs: ["Hand-thrown mugs (logo glaze)", "6912", "pc", 650],
  planters: ["Large stoneware planters", "6913", "pc", 4800],
  tiles: ["Hand-painted wall tiles", "6907", "sq ft", 420],
  lamps: ["Ceramic table lamps", "9405", "pc", 7800],
  workshop: ["Pottery workshop — team session", "999723", "session", 24000],
  installation: ["Feature-wall installation", "995414", "lot", 92500],
} as const;
const li = (k: keyof typeof ITEMS, qty: number, rate?: number): L => {
  const [n, h, u, r] = ITEMS[k];
  return [n, h, u, qty, rate ?? r];
};
const CLIENTS = {
  vikram: { name: "Vikram Rao", company: "", email: "vikram.rao@mail.example", gstin: "", city: "Bengaluru", state: "Karnataka", line1: "Road No. 3, Sadashivanagar", pin: "560080" },
  greenleaf: { name: "Karthik Shetty", company: "Greenleaf Co-working", email: "karthik@greenleafcowork.example", gstin: "29AAGCG4821K1Z3", city: "Bengaluru", state: "Karnataka", line1: "80 Feet Road, Koramangala", pin: "560034" },
  patel: { name: "Nisha Patel", company: "Patel Homes", email: "nisha@patelhomes.example", gstin: "24AAKFP7712L1Z8", city: "Ahmedabad", state: "Gujarat", line1: "SG Highway", pin: "380054" },
  lotus: { name: "Rohan D'Souza", company: "Lotus Boutique Hotels", email: "rohan@lotushotels.example", gstin: "30AABCL5618M1Z9", city: "Panaji", state: "Goa", line1: "Dona Paula Road", pin: "403004" },
  nambiar: { name: "Meera Nambiar", company: "Nambiar & Co", email: "meera@nambiar.example", gstin: "", city: "Kochi", state: "Kerala", line1: "MG Road", pin: "682016" },
  bloom: { name: "Sana Sheikh", company: "Bloom Café", email: "sana@bloomcafe.example", gstin: "29ABCFB9921R1Z6", city: "Bengaluru", state: "Karnataka", line1: "12th Main, Indiranagar", pin: "560038" },
  sharma: { name: "Dr. Kavita Sharma", company: "Sharma Dental Clinic", email: "kavita@sharmadental.example", gstin: "29AAQPS3381H1Z2", city: "Bengaluru", state: "Karnataka", line1: "100 Feet Road, HAL 2nd Stage", pin: "560008" },
  verma: { name: "Anil Verma", company: "Verma Residences", email: "anil@vermaresidences.example", gstin: "", city: "Bengaluru", state: "Karnataka", line1: "Prestige Shantiniketan, Whitefield", pin: "560048" },
} as const;
type Ck = keyof typeof CLIENTS;

async function seedInvoices() {
  ids.book = (await call(page.request, "")<{ book: { id: string } }>("POST", "/api/v1/finance/books", { orgId, name: "Asha's Studio" })).book.id;
  const fin = call(page.request, `/api/v1/finance/books/${ids.book}/`);
  const boot = await fin<{ settings: Record<string, unknown> }>("GET", "");
  await fin("PUT", "settings", {
    ...boot.settings,
    business: { name: "Asha's Studio", legalName: "Asha's Studio LLP", email: "hello@ashasstudio.example", phone: "+91 80 4100 2200", website: "ashasstudio.example", gstin: "29AAAFA0000A1Z5", pan: "AAAFA0000A", address: { line1: "12, 4th Cross, Indiranagar", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560038", country: "IN" }, logo: "" },
    payment: { upiId: "ashasstudio.demo@example", bankName: "HDFC Bank", accountName: "Asha's Studio LLP", accountNumber: "50200064214821", ifsc: "HDFC0001234", branch: "Indiranagar", swift: "", instructions: "" },
  });
  const clientIds: Partial<Record<Ck, string>> = {};
  for (const k of Object.keys(CLIENTS) as Ck[]) {
    const c = CLIENTS[k];
    clientIds[k] = (await fin<{ client: { id: string } }>("POST", "clients", { name: c.name, company: c.company, email: c.email, phone: "", gstin: c.gstin, billing: { line1: c.line1, line2: "", city: c.city, state: c.state, postalCode: c.pin, country: "IN" }, notes: "" })).client.id;
  }
  const doc = async (k: Ck, day: number, lines: L[]) => {
    const c = CLIENTS[k];
    const r = await fin<{ document: { id: string; number: string; total: number } }>("POST", "documents", {
      issue: true,
      document: {
        type: "invoice",
        clientId: clientIds[k] ?? null,
        client: { name: c.company || c.name, company: c.company, email: c.email, phone: "", gstin: c.gstin, billing: { line1: c.line1, line2: "", city: c.city, state: c.state, postalCode: c.pin, country: "IN" }, shipping: null },
        issueDate: iso(day),
        dueDate: iso(day + 15),
        currency: "INR",
        lines: lines.map(([name, hsn, unit, quantity, rate], i) => ({ id: `l${i + 1}`, name, hsn, unit, quantity, rate: rate * 100, taxBps: 1800 })),
        taxMode: "gst",
        placeOfSupply: c.state,
        title: "",
        reference: "",
      },
    });
    return r.document;
  };
  // [client, days ago, lines, paid after N days (null = unpaid), method]
  const since = daysSince(FY_START);
  const plan: [Ck, number, L[], number | null, string?][] = [
    ["vikram", since - 3, [li("dinner", 3), li("styling", 6)], 9, "bank"],
    ["greenleaf", since - 8, [li("mugs", 120), li("workshop", 1)], 12, "bank"],
    ["patel", since - 14, [li("planters", 4)], 6, "upi"],
    ["bloom", since - 36, [li("mugs", 60), li("tiles", 80)], 12, "bank"],
    ["sharma", since - 44, [li("lamps", 4), li("styling", 4)], 10, "bank"],
    ["lotus", since - 56, [li("boards", 2), li("dinner", 1)], 14, "bank"],
    ["nambiar", 140, [li("installation", 1), li("boards", 2, 25500)], null],
    ["vikram", 126, [li("tiles", 120), li("styling", 4)], 11, "upi"],
    ["greenleaf", 104, [li("workshop", 2), li("mugs", 40)], 9, "bank"],
    ["patel", 92, [li("planters", 6), li("lamps", 2)], 18, "bank"],
    ["sharma", 76, [li("tiles", 60), li("styling", 3)], 13, "bank"],
    ["bloom", 63, [li("dinner", 4), li("mugs", 48)], 8, "upi"],
    ["verma", 55, [li("lamps", 3), li("planters", 3)], 12, "bank"],
    ["lotus", 47, [li("installation", 1, 78000)], 15, "bank"],
    ["greenleaf", 33, [li("workshop", 1), li("mugs", 30)], 14, "bank"],
    ["sharma", 25, [li("lamps", 6), li("styling", 2)], null],
    ["bloom", 22, [li("tiles", 90)], 8, "bank"],
    ["lotus", 20, [li("installation", 1, 92500)], null],
    ["vikram", 16, [li("dinner", 2), li("styling", 3)], 6, "upi"],
    ["patel", 13, [li("planters", 5), li("tiles", 40)], null],
    ["verma", 9, [li("boards", 2), li("lamps", 2)], null],
    ["greenleaf", 6, [li("mugs", 80)], 4, "bank"],
  ];
  for (const [k, ago, lines, paidAfter, method] of plan) {
    const d = await doc(k, -ago, lines);
    if (paidAfter !== null && ago - paidAfter >= 0) await fin("POST", `documents/${d.id}/payments`, { amount: d.total, method, paidOn: iso(-ago + paidAfter), reference: method === "upi" ? `UPI${String(d.total).slice(0, 6)}` : `NEFT${String(d.total).slice(-6)}`, note: "" });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// The counter: the studio shop's till
// ════════════════════════════════════════════════════════════════════════════

async function seedTill() {
  const created = await call(page.request, "")<{ project: { id: string } }>("POST", `/api/v1/orgs/${orgId}/projects`, { templateId: "store", name: "Asha's Studio Shop" });
  const pid = created.project.id;
  ids.shop = pid;
  const S = call(page.request, `/api/v1/projects/${pid}/store/`);
  await S("POST", "setup", { name: "Asha's Studio Shop", currency: "INR", country: "IN", region: "Karnataka", email: "" });
  const sample = await S<{ products: { id: string }[] }>("GET", "products").catch(() => ({ products: [] }));
  for (const p of sample.products) await S("DELETE", `products/${p.id}`).catch(() => {});
  const products: [string, number][] = [
    ["Speckled stoneware mug", 649],
    ["Reactive-glaze dinner plate", 1158],
    ["Twin bud vases", 899],
    ["Charcoal bottle vase", 1895],
    ["Ceramic incense holder", 249],
    ["Glazed serving bowl", 1499],
  ];
  for (const [title, price] of products) await S("POST", "products", { title, status: "active", vendor: "Asha's Studio", hsn: "6912", taxBps: 500, kind: "physical", variants: [{ options: {}, price: price * 100, trackInventory: false, stock: 0 }] });
  const cat = await S<{ products: { title: string; variants: { id: string }[] }[] }>("GET", "pos");
  const v = (t: string) => cat.products.find((p) => p.title === t)!.variants[0]!.id;
  // [days ago, hour, [product, qty][], method, customer]
  const sales: [number, number, [string, number][], "upi" | "cash" | "card", string][] = [];
  const names = ["", "", "Sneha", "", "Ritika", "", "Arvind", ""];
  const baskets: [string, number][][] = [
    [["Reactive-glaze dinner plate", 1]],
    [["Speckled stoneware mug", 2]],
    [["Ceramic incense holder", 1]],
    [["Twin bud vases", 1], ["Ceramic incense holder", 1]],
    [["Charcoal bottle vase", 1]],
    [["Glazed serving bowl", 1], ["Speckled stoneware mug", 1]],
    [["Reactive-glaze dinner plate", 1]],
    [["Ceramic incense holder", 2]],
  ];
  // Across the year, busier in the festive weeks; the last few days before the statement is imported.
  const days = [176, 160, 147, 131, 118, 104, 90, 77, 63, 49, 38, 30, 24, 18, 14, 12, 10, 9, 8, 6, 5, 5, 5, 5, 5, 4, 4, 3, 2];
  days.forEach((d, i) => sales.push([d, 11 + (i % 8), baskets[i % baskets.length]!, i % 5 === 2 ? "cash" : i % 7 === 4 ? "card" : "upi", names[i % names.length]!]));
  const made: { id: string; at: Date }[] = [];
  for (const [i, [ago, hour, lines, method, name]] of sales.entries()) {
    const r = await S<{ order?: { id: string }; id?: string }>("POST", "pos/sale", { lines: lines.map(([t, quantity]) => ({ variantId: v(t), quantity })), discount: null, customer: { name, phone: "", email: "" }, payment: { method, reference: method === "upi" ? `UPI${4100 + i}` : "" }, buyerGstin: "", note: "", allowOversell: true, clientRef: `books-${T}-${i}` });
    const id = (r.order?.id ?? r.id)!;
    made.push({ id, at: new Date(`${iso(-ago)}T${String(hour).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}:00+05:30`) });
  }
  // The till always sells "now"; spread these over the year they stand for.
  for (const m of made) await db.update(schema.storeOrders).set({ paidAt: m.at, createdAt: m.at }).where(eq(schema.storeOrders.id, m.id));
}

// ════════════════════════════════════════════════════════════════════════════
// Inventory: clay, glaze and packaging, goods received and stock moves
// ════════════════════════════════════════════════════════════════════════════

async function seedInventory() {
  await api("GET", "inventory/meta");
  const wh = (await api<{ warehouses: { id: string }[] }>("GET", "inventory/warehouses")).warehouses[0]!.id;
  await api("PUT", `inventory/warehouses/${wh}`, { name: "Indiranagar studio", code: "IND", address: "12, 4th Cross, Indiranagar, Bengaluru 560038", state: "KA", isDefault: true });
  const popup = (await api<{ warehouse: { id: string } }>("POST", "inventory/warehouses", { name: "Pop-up — Phoenix Marketcity", code: "POP", address: "Whitefield Main Road, Bengaluru", state: "KA" })).warehouse.id;
  const glaze = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Bengaluru Glaze Supplies", contactName: "Divya Rao", phone: "+91 99001 77821", email: "orders@blrglaze.example", gstin: "29AAGCB8812R1Z9", state: "KA", address: "Peenya Industrial Area, Bengaluru", paymentTermsDays: 45, leadTimeDays: 7 })).supplier.id;
  const clay = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Khurja Clay Works", contactName: "Irfan Qureshi", phone: "+91 98370 11245", email: "orders@khurjaclay.example", gstin: "09AAKFK4471M1Z2", state: "UP", address: "GT Road, Khurja, Bulandshahr", paymentTermsDays: 30, leadTimeDays: 10 })).supplier.id;
  const pack = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Sharma Packaging", contactName: "Neeraj Sharma", phone: "+91 98451 33410", email: "sales@sharmapack.example", gstin: "29AAJFS2290K1ZQ", state: "KA", address: "Bommasandra Industrial Area, Bengaluru", paymentTermsDays: 15, leadTimeDays: 3 })).supplier.id;
  const items: Record<string, string> = {};
  const raw: [string, string, string, string, string, boolean, number, number, string][] = [
    ["Matte sage glaze", "RM-GLZ-SAGE", "kg", "Raw materials", "3207", true, 8, 20, glaze],
    ["Satin white glaze", "RM-GLZ-WHT", "kg", "Raw materials", "3207", true, 8, 20, glaze],
    ["Stoneware clay (25 kg bag)", "RM-CLAY-25", "pcs", "Raw materials", "2508", false, 12, 30, clay],
    ["Charcoal bottle vases", "FG-VASE-CH", "pcs", "Finished goods", "6913", false, 6, 24, clay],
    ["Bubble wrap roll (50 m)", "PK-BUB-50", "pcs", "Packaging", "3920", false, 4, 10, pack],
    ["Kraft tissue sheets", "PK-TIS", "pack", "Packaging", "4823", false, 4, 10, pack],
    ["Shipping box — medium", "PK-BOX-M", "pcs", "Packaging", "4819", false, 100, 300, pack],
  ];
  for (const [name, sku, unit, category, hsn, trackBatches, reorderLevel, reorderQty, supplierId] of raw) items[name] = (await api<{ item: { id: string } }>("POST", "inventory/items", { name, sku, unit, category, hsn, gstRate: 18, trackBatches, reorderLevel, reorderQty, supplierId })).item.id;
  const po = async (supplierId: string, orderDate: string, expectedDate: string, lines: [string, number, number][]) => {
    const id = (await api<{ order: { id: string } }>("POST", "inventory/orders", { supplierId, warehouseId: wh, orderDate, expectedDate, notes: "", lines: lines.map(([n, qty, rate]) => ({ itemId: items[n], qty, rate: rate * 100, gstRate: 18 })) })).order.id;
    await api("POST", `inventory/orders/${id}/send`, { email: false });
    return id;
  };
  const po1 = await po(pack, iso(-24), iso(-21), [["Shipping box — medium", 600, 24], ["Bubble wrap roll (50 m)", 12, 680], ["Kraft tissue sheets", 12, 340]]);
  await api("POST", "inventory/receipts", { poId: po1, warehouseId: wh, date: iso(-21), supplierInvoice: "SP/2026/1182", lines: ([["Shipping box — medium", 600, 24], ["Bubble wrap roll (50 m)", 12, 680], ["Kraft tissue sheets", 12, 340]] as const).map(([n, qty, rate]) => ({ itemId: items[n], qty, rate: rate * 100, gstRate: 18 })) });
  const po2 = await po(clay, iso(-20), iso(-8), [["Stoneware clay (25 kg bag)", 30, 1680], ["Charcoal bottle vases", 24, 300]]);
  await api("POST", "inventory/receipts", { poId: po2, warehouseId: wh, date: iso(-10), supplierInvoice: "KCW-7731", lines: [{ itemId: items["Stoneware clay (25 kg bag)"], qty: 15, rate: 168000, gstRate: 18 }, { itemId: items["Charcoal bottle vases"], qty: 24, rate: 30000, gstRate: 18 }] });
  const po3 = await po(glaze, iso(-18), iso(-11), [["Matte sage glaze", 20, 920], ["Satin white glaze", 20, 780]]);
  await api("POST", "inventory/receipts", { poId: po3, warehouseId: wh, date: iso(-12), supplierInvoice: "BGS-0412", lines: [
    { itemId: items["Matte sage glaze"], qty: 12, rate: 92000, gstRate: 18, batch: "SG-2608", expiry: iso(170) },
    { itemId: items["Satin white glaze"], qty: 6, rate: 78000, gstRate: 18, batch: "SW-2609", expiry: iso(240) },
  ] });
  await api("POST", "inventory/adjust", { itemId: items["Satin white glaze"], warehouseId: wh, batch: "SW-2609", qty: -2.5, reason: "used", note: "Test tiles" });
  await api("POST", "inventory/adjust", { itemId: items["Stoneware clay (25 kg bag)"], warehouseId: wh, qty: -4, reason: "used", note: "Studio — week 42 throwing" });
  await api("POST", "inventory/adjust", { itemId: items["Charcoal bottle vases"], warehouseId: wh, qty: -2, reason: "damaged", note: "Chipped in transit" });
  const t = await api<{ transfer: { id: string } }>("POST", "inventory/transfers", { fromId: wh, toId: popup, lines: [{ itemId: items["Shipping box — medium"], qty: 60, batch: "" }, { itemId: items["Charcoal bottle vases"], qty: 6, batch: "" }] });
  await api("POST", `inventory/transfers/${t.transfer.id}/send`, {});
  await api("POST", `inventory/transfers/${t.transfer.id}/receive`, {});
  await api("POST", "inventory/counts", { warehouseId: popup, lines: [{ itemId: items["Shipping box — medium"], counted: 57 }], note: "Pop-up weekly count" });
}

// ════════════════════════════════════════════════════════════════════════════
// HR: eight people and September's payroll
// ════════════════════════════════════════════════════════════════════════════

async function seedPayroll(ownerEmail: string) {
  await api("GET", "hr/meta");
  await api("PUT", "hr/settings", { company: { legalName: "Asha's Studio LLP", address: "12, 4th Cross, Indiranagar, Bengaluru 560038", pan: "AAAFA0000A", tan: "BLRA21458C", pfCode: "KNBNG0045821000", esiCode: "53000458210001002", signatory: "Asha Mehra", signatoryTitle: "Designated Partner" } });
  const dept: Record<string, string> = {};
  for (const name of ["Studio", "Design", "Shop"]) dept[name] = (await api<{ department: { id: string } }>("POST", "hr/departments", { name })).department.id;
  const loc = (await api<{ location: { id: string } }>("POST", "hr/locations", { name: "Bengaluru — Indiranagar", address: "12, 4th Cross, Indiranagar, Bengaluru 560038", state: "KA" })).location.id;
  const people: [string, string, string, number, string, string, "female" | "male", string?][] = [
    ["Asha Mehra", "Founder & Designer", "Design", 30, "2019-04-01", "1985-10-28", "female", ownerEmail],
    ["Rohan Mehta", "Studio Manager", "Studio", 12, "2021-06-14", "1990-10-29", "male"],
    ["Priya Nair", "Interior Designer", "Design", 9.6, "2022-07-11", "1995-05-21", "female"],
    ["Imran Khan", "Senior Potter", "Studio", 6, "2020-01-17", "1991-07-19", "male"],
    ["Meena Pillai", "Potter", "Studio", 3.6, "2024-03-04", "1999-02-08", "female"],
    ["Arjun Rao", "Glaze Technician", "Studio", 4.2, "2023-08-01", "1996-10-31", "male"],
    ["Neha Kulkarni", "Shop Lead", "Shop", 4.8, "2023-11-06", "1998-06-25", "female"],
    ["Sana Qureshi", "Shop Associate", "Shop", 3, "2024-07-15", "2000-01-30", "female"],
  ];
  const banks = ["HDFC0000123", "ICIC0001842", "KKBK0000654", "SBIN0004512", "UTIB0000221"];
  for (const [i, [name, designation, d, lakh, join, dob, gender, email]] of people.entries()) {
    await api("POST", "hr/people", {
      name, designation, departmentId: dept[d], locationId: loc, managerId: null, joinDate: join, dob, gender,
      email: email ?? `${name.split(" ")[0]!.toLowerCase()}@ashasstudio.example`, phone: `+91 98${String(45000000 + i * 1234567).slice(0, 8)}`,
      ctc: Math.round(lakh * 100_000 * 100),
      bank: { name, account: `5010${String(1031678924 + i * 7919).slice(0, 10)}`, ifsc: banks[i % banks.length] },
      ids: { pan: `ABC${"DEFGHJKLMN"[i]}E${String(1148 + i * 37).slice(0, 4)}F`, uan: `1009000${String(6868 + i * 113).padStart(5, "0")}`, aadhaarLast4: String(1452 + i * 311).slice(-4) },
    });
  }
  const sep = await api<{ run: { id: string } }>("POST", "hr/payroll", { month: prevMonth });
  await api("POST", `hr/payroll/${sep.run.id}/finalise`, {});
  await api("POST", `hr/payroll/${sep.run.id}/paid`, {});
}

// ════════════════════════════════════════════════════════════════════════════
// Accounts: opening balances, bills, expenses and the bank statement
// ════════════════════════════════════════════════════════════════════════════

type Account = { id: string; code: string; name: string; type: string; subtype: string; systemKey: string | null; description: string; bank: unknown; active: boolean };

async function seedBooks() {
  await acc("GET", "meta");
  const accounts = (await acc<{ accounts: Account[] }>("GET", "accounts")).accounts;
  const byCode = (c: string) => accounts.find((a) => a.code === c)!;
  const bank = byCode("1010");
  ids.bank = bank.id;
  await acc("PUT", `accounts/${bank.id}`, { code: bank.code, name: "HDFC Current Account", type: bank.type, subtype: bank.subtype, description: "", bank: { bankName: "HDFC Bank", last4: "4821", ifsc: "HDFC0001234" }, active: true });
  await acc("PUT", "settings", { gstin: "29AAAFA0000A1Z5", state: "KA", defaultBankId: bank.id });
  // Opening balances at the start of the year, carried from last year's books.
  await acc("POST", "journals", {
    date: FY_START,
    narration: "Opening balances from FY closing",
    opening: true,
    lines: [
      { accountId: bank.id, debit: 11_44_090_00, credit: 0, description: "HDFC Current Account" },
      { accountId: byCode("1000").id, debit: 18_500_00, credit: 0, description: "Cash in hand" },
      { accountId: byCode("3000").id, debit: 0, credit: 2_00_000_00, description: "Partners' capital" },
      { accountId: byCode("3900").id, debit: 0, credit: 9_62_590_00, description: "Profit carried from earlier years" },
    ],
  });
  const line = (code: string, amount: number, description: string, gstRate = 18) => ({ accountId: byCode(code).id, description, amount: amount * 100, gstRate });
  // Bills to pay later.
  await acc("POST", "bills", { supplierName: "Mehta & Associates", billNo: "MA/0918", date: iso(-11), dueDate: iso(19), lines: [line("5280", 25000, "Statutory audit — first half")], itc: true, interState: false, notes: "" });
  const adani = await acc<{ bill: { id: string; total: number } }>("POST", "bills", { supplierName: "BESCOM", billNo: "BES-7781203", date: iso(-17), dueDate: iso(-3), lines: [line("5210", 18640, "Studio kiln and lights — Sept", 0)], itc: true, interState: false, notes: "" });
  ids.power = adani.bill.id;
  await acc("POST", `bills/${adani.bill.id}/payments`, { accountId: bank.id, amount: 10_000_00, date: iso(-6), reference: "BBPS 22190" });
  // Expenses already paid, recorded and paid in one go.
  const exp = (code: string, supplier: string, ref: string, day: number, amount: number, desc: string, from: string, gstRate = 18) => acc("POST", "expenses", { supplierName: supplier, billNo: ref, date: iso(day), dueDate: null, lines: [line(code, amount, desc, gstRate)], itc: gstRate > 0, interState: false, notes: "", paidFrom: from, reference: ref });
  // Rent on the 5th of every month of the year so far.
  for (let d = FY_START; d.slice(0, 7) <= MONTH; ) {
    const day5 = `${d.slice(0, 7)}-05`;
    if (day5 <= TODAY) await exp("5200", "Sunrise Properties", `RENT-${day5.slice(0, 7)}`, -daysSince(day5), 85000, "Studio rent", bank.id);
    const [y, m] = d.split("-").map(Number) as [number, number];
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  await exp("5220", "ACT Fibernet", "ACT-88214", -13, 1185, "Studio broadband — Oct", bank.id);
  await exp("5230", "Meta Platforms", "FBADS-2210", -9, 15000, "Instagram ads — Diwali collection", bank.id);
  await exp("5260", "Ramesh Stationers", "RS-412", -4, 640, "Packing tape and labels", byCode("1000").id);
}

/** The October statement from HDFC net banking, in its own CSV layout. */
async function importStatement() {
  await acc("POST", "sync", {});
  // Book entries on the bank this month, to write the statement from.
  const journals = (await acc<{ journals: { id: string; date: string; narration: string; party: string; lines: { accountId: string; debit: number; credit: number }[] }[] }>("GET", `journals?from=${MONTH}-01&to=${TODAY}`)).journals;
  const onBank = journals
    .map((j) => ({ date: j.date, narration: j.narration, party: j.party, amount: j.lines.filter((l) => l.accountId === ids.bank).reduce((a, l) => a + l.debit - l.credit, 0) }))
    .filter((x) => x.amount !== 0 && x.date <= iso(-1));
  const ddmmyyyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const rupees = (p: number) => (Math.abs(p) / 100).toFixed(2);
  const rows: string[][] = [];
  let ref = 718200;
  for (const e of onBank) {
    const desc = /Counter sale/.test(e.narration) ? `UPI/${(e.party || "WALK-IN CUSTOMER").toUpperCase()}/ASHASSTUDIO` : /Payment for/.test(e.narration) ? `NEFT CR-${(e.party || "CUSTOMER").toUpperCase()}` : `${e.amount < 0 ? "NEFT DR" : "CR"}-${(e.party || e.narration).toUpperCase().slice(0, 40)}`;
    rows.push([ddmmyyyy(e.date), desc, String(ref++), e.amount < 0 ? rupees(e.amount) : "", e.amount > 0 ? rupees(e.amount) : ""]);
  }
  // What only the bank knew about.
  rows.push([ddmmyyyy(iso(-2)), "UPI/RAZORPAY SETTLEMENT", "RZP881", "", "18650.00"]);
  rows.push([ddmmyyyy(iso(-1)), "INT.PD: SAVINGS SWEEP", "", "", "412.00"]);
  rows.push([ddmmyyyy(iso(-1)), "CHRG: SMS ALERTS Q3", "", "17.70", ""]);
  const csv = ["HDFC BANK Ltd. — Statement of account", "Account No: XXXXXXXX4821", "", "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.", ...rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))].join("\n");
  const r = await acc<{ read: number; matched: number }>("POST", `bank/${ids.bank}/import`, { csv });
  console.log(`statement: ${r.read} lines, ${r.matched} matched`);
}

// ════════════════════════════════════════════════════════════════════════════

test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(2_400_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", extraHTTPHeaders: { "x-forwarded-for": ip() } });
  page = await ctx.newPage();
  const ownerEmail = `asha.${T}@ashasstudio-demo.in`;
  const asha = await signup(page.request, "Asha Mehra", ownerEmail, "Asha's Studio");
  orgId = asha.orgId;
  api = call(page.request, `/api/v1/orgs/${orgId}/`);
  acc = call(page.request, `/api/v1/orgs/${orgId}/accounts/`);
  await api("PUT", "modules", { modules: ["crm", "hr", "inventory", "invoicing", "accounting", "store", "pos", "mail", "calendar", "chat"] });
  // A teammate who chats (for the Chat badge).
  const c = await (browser as Browser).newContext({ baseURL: BASE });
  const rohan = await signup(c.request, "Rohan Mehta", `rohan.${T}@ashasstudio-demo.in`);
  await db.insert(schema.memberships).values({ orgId, userId: rohan.userId, role: "editor" } as never);
  const rohanApi = call(c.request, `/api/v1/orgs/${orgId}/`);

  await seedInvoices();
  await seedTill();
  await seedInventory();
  await seedPayroll(ownerEmail);
  await seedBooks();
  await importStatement();

  // Sidebar badges: unread mail and chat.
  await api("GET", "calendar/meta").catch(() => {});
  await seedMail(orgId, asha.userId, "asha@ashasstudio.example", "Asha Mehra", [
    { from: "Rahul Desai <rahul@desaiandco.example>", subject: "GSTR-3B for October — figures to check", text: "Hi Asha, please confirm the input credit before the 20th.", ago: 40 },
    { from: "Divya Rao <divya@blrglaze.example>", subject: "Balance of PO-0003 dispatching Thursday", text: "The rest of the glaze leaves Peenya on Thursday.", ago: 150 },
    { from: "Rohan D'Souza <rohan@lotushotels.example>", subject: "Feature wall — payment next week", text: "Accounts will release the payment next week.", ago: 320 },
  ]).catch((e) => console.log(`mail: ${String(e).slice(0, 200)}`));
  const chat = await api<{ channels: { id: string; name: string }[] }>("GET", "chat/meta").catch(() => ({ channels: [] }));
  const general = chat.channels.find((x) => x.name === "general")?.id;
  if (general) {
    await rohanApi("POST", `chat/channels/${general}/messages`, { body: "Bank statement for October is in — 3 lines left to match." }).catch((e) => console.log(String(e).slice(0, 200)));
    await rohanApi("POST", `chat/channels/${general}/messages`, { body: "Paid BESCOM ₹10,000 on account; the rest goes out Friday." }).catch(() => {});
  }
  await acc("POST", "sync", {});
});

test.afterAll(async () => {
  await page?.context().close();
});

// ════════════════════════════════════════════════════════════════════════════
// Accounting
// ════════════════════════════════════════════════════════════════════════════

test("accounting", async () => {
  test.setTimeout(1_800_000);
  const A = "accounting";
  const at = async (path: string, ready: string | RegExp, name: string, extra?: () => Promise<void>, settle = 2000) =>
    twice(name, async () => {
      await open(page, path, ready, settle);
      if (extra) await extra();
      await assertClean(page);
      await shoot(page, A, name, { settle: 900 });
    });

  await at("/accounts", "Income and costs, last six months", "home", undefined, 3000);
  await at("/accounts/journals", "Every entry in the books", "journals");
  await at("/accounts/journals", "Every entry in the books", "journal-open", async () => {
    await page.getByRole("row").filter({ hasText: "Salaries paid for" }).first().click();
    await page.waitForTimeout(900);
  });
  await at(`/accounts/accounts/${ids.bank}`, "HDFC Current Account", "ledger");
  await at("/accounts/accounts", "Where every rupee is recorded", "coa");
  await at("/accounts/bills", "To pay", "bills");
  await at(`/accounts/bills/${ids.power}`, "BESCOM", "bill");
  await at("/accounts/bills", "To pay", "bill-new", async () => {
    await page.getByRole("button", { name: "New bill" }).click();
    await expect(page.getByRole("dialog", { name: "New bill" })).toBeVisible();
    await page.waitForTimeout(900);
  });
  await at("/accounts/bank", "HDFC Current Account", "bank");
  await at(`/accounts/bank/${ids.bank}`, "Reconcile", "reconcile");
  await at("/accounts/reports/profit-loss", "Total income", "pl");
  await at("/accounts/reports/balance-sheet", "What the business has", "bs");
  await at("/accounts/reports/trial-balance", "Debits equal credits", "tb");
  await at("/accounts/reports/aging", "Customers owe you", "aging");
  await at("/accounts/gst/gstr1", "To businesses (B2B)", "gstr1");
  await at("/accounts/gst/gstr3b", "Head by head", "gstr3b");
  // Settings now open with Closed months and TDS; frame the lock date and posting switches.
  await at("/accounts/settings", "Lock the books", "settings", async () => {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2, h3, p, span")].find((x) => x.textContent?.trim() === "Lock the books");
      window.scrollBy(0, (h?.getBoundingClientRect().top ?? 0) - 120);
    });
    await page.waitForTimeout(700);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Website builder
// ════════════════════════════════════════════════════════════════════════════

async function builder(pid: string) {
  await page.goto(`/projects/${pid}/builder`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await expect(page.locator('iframe[title^="Canvas"]')).toBeVisible({ timeout: 150_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 4000 }).catch(() => {});
  await closeRail();
  await clean(page);
}
/** The builder remembers the last side panel; these shots start with none open. */
async function closeRail() {
  const x = page.getByRole("button", { name: "Close panel" });
  if (await x.isVisible().catch(() => false)) await x.click();
  await page.waitForTimeout(600);
}
const canvas = () => page.frameLocator('iframe[title^="Canvas"]');
const rail = (name: string) => page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: new RegExp(`^${name}`) });

test("builder", async () => {
  test.setTimeout(1_800_000);
  const B = "builder";
  const project = async (templateId: string, name: string) => (await call(page.request, "")<{ project: { id: string } }>("POST", `/api/v1/orgs/${orgId}/projects`, { templateId, name })).project.id;
  const cafe = await project("cafe", "Brew & Bloom");
  const hotel = await project("hotel", "Saffron House");
  const spa = await project("spa", "Still Waters Spa");

  // ── The café: a heading selected, its section toolbar, the gallery, AI and branches ──
  await twice("overview", async () => {
    await builder(cafe);
    const h1 = canvas().locator("h1").first();
    await h1.click();
    await page.waitForTimeout(900);
    await h1.click();
    await expect(page.getByText(/Element · Heading/i).first()).toBeVisible({ timeout: 20_000 });
    // Picking an element opens Layers; keep the canvas wide, as in the original framing.
    await closeRail();
    await expect(page.getByText(/Element · Heading/i).first()).toBeVisible();
    await page.mouse.move(720, 880);
    await shoot(page, B, "overview", { settle: 1500 });
    const bar = page.getByRole("toolbar", { name: /actions$/ }).first();
    // The toolbar with a little of the page around it (52 CSS px tall, as before).
    const bb = (await bar.boundingBox())!;
    const pad = (52 - bb.height) / 2;
    await clean(page);
    await page.waitForTimeout(500);
    const dir = join(process.cwd(), "public", "marketing", B);
    await page.screenshot({ path: join(dir, "toolbar.jpg"), type: "jpeg", quality: 82, clip: { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: 52 } });
    await page.screenshot({ path: join(dir, "toolbar 2.jpg"), type: "jpeg", quality: 82, clip: { x: bb.x - pad - 6, y: bb.y - pad, width: bb.width + 2 * pad + 12, height: 52 } });
  });
  await twice("add", async () => {
    await builder(cafe);
    await rail("Add").click();
    await expect(page.getByRole("textbox", { name: "Search sections" })).toBeVisible();
    await shoot(page, B, "add", { settle: 3000 });
  });
  await twice("ai", async () => {
    await builder(cafe);
    await page.getByRole("button", { name: /Ask AI to change anything/ }).click();
    const box = page.getByRole("textbox", { name: "Ask the assistant" });
    await box.fill("Add a gallery of our cakes after the menu, and make the hero warmer");
    await shoot(page, B, "ai", { settle: 1200 });
    await page.keyboard.press("Escape");
  });
  await twice("branches", async () => {
    await builder(cafe);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: /Branches/ }).click();
    const dlg = page.getByRole("dialog", { name: "Branches" });
    await expect(dlg).toBeVisible();
    const inputs = dlg.getByRole("textbox");
    await inputs.nth(0).fill("Diwali look");
    await inputs.nth(1).fill("A festive offers banner");
    await shoot(page, B, "branches", { settle: 900 });
    await page.keyboard.press("Escape");
  });
  await twice("freeform", async () => {
    await builder(cafe);
    const already = await canvas().getByText("Make it yours").count();
    if (!already) {
      await rail("Add").click();
      await page.getByRole("textbox", { name: "Search sections" }).fill("free");
      await page.getByRole("button", { name: /Free-form/ }).first().click();
      await page.waitForTimeout(2500);
      await rail("Add").click().catch(() => {});
    }
    await canvas().getByText("Make it yours").first().scrollIntoViewIfNeeded();
    await canvas().getByText("Make it yours").first().click();
    await page.getByRole("button", { name: "Open free-form editor" }).click();
    await expect(page.getByRole("dialog", { name: "Free-form editor" })).toBeVisible();
    await shoot(page, B, "freeform", { settle: 1500 });
    await page.keyboard.press("Escape");
  });

  // ── The hotel: Luxury applied, and the design review ──
  await twice("style", async () => {
    await builder(hotel);
    await rail("Style").click();
    const lux = page.getByRole("button", { name: /^Aa Studio\s*Luxury/ }).first();
    if ((await lux.getAttribute("aria-pressed")) !== "true") await lux.click();
    await page.waitForTimeout(2500);
    await shoot(page, B, "style", { settle: 1500 });
  });
  await twice("review", async () => {
    await builder(hotel);
    await rail("Review").click();
    await expect(page.getByRole("heading", { name: "Design review" })).toBeVisible();
    await shoot(page, B, "review", { settle: 2000 });
  });

  // ── The spa on a phone ──
  await twice("mobile", async () => {
    await builder(spa);
    await page.getByRole("radio", { name: /Mobile/ }).click();
    await page.waitForTimeout(2500);
    await page.mouse.move(1300, 850);
    await shoot(page, B, "mobile", { settle: 1500 });
    const f = (await page.locator('iframe[title^="Canvas"]').boundingBox())!;
    await clean(page);
    await page.screenshot({ path: join(process.cwd(), "public", "marketing", B, "phone.jpg"), type: "jpeg", quality: 82, clip: { x: f.x - 8, y: f.y - 7, width: f.width + 16, height: 600 } });
  });
});

