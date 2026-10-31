// Real screenshots for the operations feature pages: sales, manufacturing,
// quality, maintenance, documents, logistics, reports and portals. Creates a
// fresh demo workspace (Northwind Components, a Pune furniture-parts maker),
// fills it through the app's own API and screens, and saves the captures to
// public/marketing/<feature>/.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-ops
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { textPdf } from "../../src/lib/documents/pdf";
import { ip, shoot, phoneShots } from "./shoot";

config({ path: ".env.local", quiet: true });
test.describe.configure({ mode: "serial" });

const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const H = { origin: BASE };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const pdf = (title: string, body: string[]) => Buffer.from(textPdf([{ text: title, size: 18, bold: true }, ...body.map((text) => ({ text }))], { title }));

let page: Page;
let req: APIRequestContext;
let orgId = "";
const ids: Record<string, string> = {};
const items: Record<string, string> = {};
const clients: Record<string, string> = {};

async function post<T = Record<string, unknown>>(url: string, data: unknown): Promise<T> {
  const r = await req.post(url, { data, headers: H, timeout: 180_000 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok()) throw new Error(`${url} → ${r.status()} ${JSON.stringify(j).slice(0, 300)}`);
  return j as T;
}
async function put<T = Record<string, unknown>>(url: string, data: unknown): Promise<T> {
  const r = await req.put(url, { data, headers: H, timeout: 180_000 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok()) throw new Error(`${url} → ${r.status()} ${JSON.stringify(j).slice(0, 300)}`);
  return j as T;
}
const get = async <T = Record<string, unknown>>(url: string): Promise<T> => (await (await req.get(url, { timeout: 180_000 })).json()) as T;
const org = (p: string) => `/api/v1/orgs/${orgId}/${p}`;
const inv = (p: string) => org(`inventory/${p}`);
const addr = (city: string, state: string, line1: string, postalCode: string) => ({ line1, line2: "", city, state, postalCode, country: "IN" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": ip() } });
  page = await ctx.newPage();
  req = page.request;
  const stamp = Date.now();
  // Signed up through the API so the workspace gets its real name.
  const r = await req.post("/api/v1/auth/signup", { data: { name: "Ananya Rao", email: `ananya.${stamp}@northwind-demo.in`, password: "correct-horse-42", orgName: "Northwind Components" }, headers: H });
  expect(r.status()).toBe(201);
  await page.goto("/welcome");
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL(/\/home$/);
  orgId = (await get<{ organizations: { id: string }[] }>("/api/v1/auth/me")).organizations[0]!.id;

  // Shared master data: a finance book with customers, stock items and suppliers.
  ids.book = (await post<{ book: { id: string } }>("/api/v1/finance/books", { orgId, name: "Northwind Components" })).book.id;
  for (const [company, name, city, state, line1, pin] of [
    ["Lumen Interiors", "Meera Iyer", "Bengaluru", "Karnataka", "4 Residency Road", "560025"],
    ["Kavya Home Studio", "Kavya Nair", "Kochi", "Kerala", "12 MG Road", "682016"],
    ["Urban Nest Furnishings", "Rohit Bansal", "Gurugram", "Haryana", "Sector 29", "122001"],
    ["Shree Office Systems", "Vikram Shah", "Ahmedabad", "Gujarat", "CG Road", "380009"],
    ["Greenleaf Cafés", "Priya Menon", "Mumbai", "Maharashtra", "Linking Road, Bandra", "400050"],
    ["Coastal Hospitality", "Arjun Pai", "Panaji", "Goa", "Dona Paula", "403004"],
  ] as const) {
    clients[company] = (await post<{ client: { id: string } }>(`/api/v1/finance/books/${ids.book}/clients`, { name, company, email: `${name.split(" ")[0]!.toLowerCase()}@${company.split(" ")[0]!.toLowerCase()}.example`, billing: addr(city, state, line1, pin), notes: "" })).client.id;
  }
  await req.get(inv("meta"), { timeout: 180_000 });
  ids.wh = (await get<{ warehouses: { id: string }[] }>(inv("warehouses"))).warehouses[0]!.id;
  for (const [key, name, sku, category, hsn] of [
    ["chair", "Ergo office chair", "CH-ERG", "Seating", "94013000"],
    ["desk", "Oak work desk 1.4 m", "DK-OAK14", "Desks", "94033010"],
    ["shelf", "Steel shelving unit", "SH-STL5", "Storage", "94032090"],
    ["cabinet", "Filing cabinet, 3 drawer", "CB-FIL3", "Storage", "94031090"],
    ["table", "Café table, round", "TB-CAF60", "Tables", "94036000"],
    ["top", "Oak table top", "RM-TOP", "Components", "44219990"],
    ["leg", "Steel table leg", "RM-LEG", "Components", "73269099"],
    ["screw", "Wood screw 8 × 40", "RM-SCR", "Fasteners", "73181200"],
    ["bolt", "Hex bolt M8", "RM-M8", "Fasteners", "73181500"],
    ["castor", "Castor wheel 50 mm", "RM-CST", "Components", "83022000"],
  ] as const) items[key] = (await post<{ item: { id: string } }>(inv("items"), { name, sku, unit: "pcs", category, hsn, gstRate: 18 })).item.id;
  ids.supplier = (await post<{ supplier: { id: string } }>(inv("suppliers"), { name: "Bharat Fasteners Pvt Ltd", email: "orders@bharatfasteners.example", state: "MH" })).supplier.id;
  ids.supplier2 = (await post<{ supplier: { id: string } }>(inv("suppliers"), { name: "Deccan Timber Works", email: "sales@deccantimber.example", state: "MH" })).supplier.id;
  for (const [k, qty] of [["chair", 60], ["desk", 35], ["shelf", 48], ["cabinet", 22], ["table", 40]] as const) await post(inv("adjust"), { itemId: items[k], warehouseId: ids.wh, qty, reason: "opening" });
  await post(inv("receipts"), { supplierId: ids.supplier2, warehouseId: ids.wh, date: day(-12), lines: [{ itemId: items.top, qty: 40, rate: 320000, gstRate: 18 }, { itemId: items.leg, qty: 200, rate: 45000, gstRate: 18 }] });
  await post(inv("receipts"), { warehouseId: ids.wh, date: day(-10), lines: [{ itemId: items.screw, qty: 2000, rate: 300, gstRate: 18 }, { itemId: items.castor, qty: 300, rate: 9000, gstRate: 18 }] });
});

test("sales", async () => {
  const S = (p: string) => org(`sales/${p}`);
  await req.get(S("meta"), { timeout: 180_000 });
  const lists = (await get<{ lists: { id: string; name: string }[] }>(S("price-lists"))).lists;
  const std = lists[0]?.id;
  if (std) for (const [k, price] of [["chair", 12500], ["desk", 18900], ["shelf", 7400], ["cabinet", 9800], ["table", 6200]] as const) await post(S(`price-lists/${std}/prices`), { itemId: items[k], price: price * 100 });
  const dealer = (await post<{ list: { id: string } }>(S("price-lists"), { name: "Dealer", kind: "fixed" })).list.id;
  for (const [k, price] of [["chair", 11200], ["desk", 17200], ["shelf", 6600]] as const) await post(S(`price-lists/${dealer}/prices`), { itemId: items[k], price: price * 100, minQty: 10 });
  await post(S("price-lists"), { name: "Diwali offer", kind: "discount", discountPct: 8, validFrom: day(-5), validTo: day(20) });
  for (const [c, limit, terms] of [["Lumen Interiors", 1500000, 30], ["Urban Nest Furnishings", 2500000, 45], ["Shree Office Systems", 1000000, 30], ["Greenleaf Cafés", 600000, 15]] as const) await post(S("customers"), { ownerId: ids.book, clientId: clients[c], creditLimit: limit * 100, paymentTermsDays: terms, ...(c === "Urban Nest Furnishings" ? { priceListId: dealer } : {}) });

  const line = (id: string, k: keyof typeof items | string, name: string, qty: number, rate: number) => ({ id, itemId: items[k as string], name, unit: "pcs", qty, rate: rate * 100, taxBps: 1800 });
  const orders: [string, ReturnType<typeof line>[], "draft" | "confirmed" | "delivered" | "invoiced", number][] = [
    ["Lumen Interiors", [line("a", "chair", "Ergo office chair", 24, 12500), line("b", "desk", "Oak work desk 1.4 m", 12, 18900)], "invoiced", -18],
    ["Urban Nest Furnishings", [line("a", "shelf", "Steel shelving unit", 30, 6600), line("b", "cabinet", "Filing cabinet, 3 drawer", 10, 9800)], "delivered", -9],
    ["Shree Office Systems", [line("a", "chair", "Ergo office chair", 16, 12500)], "confirmed", -4],
    ["Greenleaf Cafés", [line("a", "table", "Café table, round", 18, 6200)], "confirmed", -2],
    ["Kavya Home Studio", [line("a", "desk", "Oak work desk 1.4 m", 3, 18900), line("b", "cabinet", "Filing cabinet, 3 drawer", 2, 9800)], "draft", -1],
    ["Coastal Hospitality", [line("a", "table", "Café table, round", 12, 6200), line("b", "chair", "Ergo office chair", 6, 12500)], "invoiced", -25],
  ];
  for (const [c, lines, state, offset] of orders) {
    const o = (await post<{ order: { id: string } }>(S("orders"), { ownerId: ids.book, clientId: clients[c], date: day(offset), lines })).order;
    if (state === "draft") continue;
    const conf = await post<{ order: { status: string } }>(S(`orders/${o.id}/confirm`), {});
    if (conf.order?.status !== "confirmed") await post(S(`orders/${o.id}/approve`), { approve: true });
    if (state === "confirmed") continue;
    await post(S("deliveries"), { orderId: o.id, warehouseId: ids.wh, date: day(offset + 2), lines: lines.map((l) => ({ lineId: l.id, qty: l.qty })), vehicleNo: "MH12 QT 4471" });
    if (state === "invoiced") await post(S(`orders/${o.id}/invoice`), {});
    ids[`so_${c}`] = o.id;
  }
  await post(S("plans"), { name: "Standard 3%", ratePct: 3, basis: "invoiced" }).catch(() => {});

  await page.goto("/sales");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "sales", "home");
  await page.goto("/sales/orders");
  await expect(page.getByText("Lumen Interiors").first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "sales", "orders");
  await page.goto(`/sales/orders/${ids["so_Urban Nest Furnishings"]}`);
  await expect(page.getByText("Urban Nest Furnishings").first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "sales", "order");
  await page.goto("/sales/price-lists");
  await page.getByText("Dealer").first().click().catch(() => {});
  await shoot(page, "sales", "price-lists");
  await phoneShots(page, [["/sales", "sales"]]);
});

test("manufacturing", async () => {
  const M = (p: string) => org(`manufacturing/${p}`);
  await req.get(M("meta"), { timeout: 180_000 });
  const saw = (await post<{ centre: { id: string } }>(M("work-centres"), { code: "SAW", name: "Panel saw", costPerHour: 60000 })).centre.id;
  const weld = (await post<{ centre: { id: string } }>(M("work-centres"), { code: "WELD", name: "Welding bay", costPerHour: 45000 })).centre.id;
  const bench = (await post<{ centre: { id: string } }>(M("work-centres"), { code: "ASM", name: "Assembly line", costPerHour: 30000 })).centre.id;
  await post(M("work-centres"), { code: "PNT", name: "Powder coating", costPerHour: 40000 });
  const desk = (await post<{ bom: { id: string } }>(M("boms"), { itemId: items.desk, lines: [{ itemId: items.top, qty: 1 }, { itemId: items.leg, qty: 4 }, { itemId: items.screw, qty: 16, scrapPct: 5 }], operations: [{ id: "cut", workCentreId: saw, name: "Cut and edge the top", minutes: 18, setupMinutes: 30 }, { id: "fit", workCentreId: bench, name: "Assemble and inspect", minutes: 25 }] })).bom.id;
  ids.deskBom = desk;
  await post(M("boms"), { itemId: items.table, lines: [{ itemId: items.top, qty: 1 }, { itemId: items.leg, qty: 1 }, { itemId: items.screw, qty: 6 }], operations: [{ id: "cut", workCentreId: saw, name: "Cut round top", minutes: 12 }, { id: "weld", workCentreId: weld, name: "Weld the base", minutes: 15 }, { id: "fit", workCentreId: bench, name: "Assemble", minutes: 10 }] });
  await post(M("boms"), { itemId: items.chair, lines: [{ itemId: items.castor, qty: 5 }, { itemId: items.bolt, qty: 8 }], operations: [{ id: "fit", workCentreId: bench, name: "Fit base and castors", minutes: 14 }] }).catch(() => {});
  const mk = async (item: string, qty: number, start: number, end: number) => (await post<{ order: { id: string } }>(M("work-orders"), { itemId: items[item], qty, plannedStart: day(start), plannedEnd: day(end) })).order.id;
  // Done.
  const w1 = await mk("desk", 6, -9, -6);
  await post(M(`work-orders/${w1}/release`), {});
  await post(M(`work-orders/${w1}/issue`), { lines: [{ itemId: items.top, qty: 6 }, { itemId: items.leg, qty: 24 }, { itemId: items.screw, qty: 100 }] });
  await post(M(`work-orders/${w1}/time`), { operationId: "cut", minutes: 140, done: true });
  await post(M(`work-orders/${w1}/time`), { operationId: "fit", minutes: 160, done: true });
  await post(M(`work-orders/${w1}/complete`), { produced: 6 });
  const w0 = await mk("table", 8, -7, -5);
  await post(M(`work-orders/${w0}/release`), {});
  await post(M(`work-orders/${w0}/issue`), { lines: [{ itemId: items.top, qty: 8 }, { itemId: items.leg, qty: 8 }, { itemId: items.screw, qty: 48 }] });
  for (const [op, min] of [["cut", 90], ["weld", 130], ["fit", 70]] as const) await post(M(`work-orders/${w0}/time`), { operationId: op, minutes: min, done: true });
  await post(M(`work-orders/${w0}/complete`), { produced: 8 });
  // In production.
  const w2 = await mk("desk", 10, -2, 3);
  await post(M(`work-orders/${w2}/release`), {});
  await post(M(`work-orders/${w2}/issue`), { lines: [{ itemId: items.top, qty: 10 }, { itemId: items.leg, qty: 40 }, { itemId: items.screw, qty: 168 }] });
  await post(M(`work-orders/${w2}/time`), { operationId: "cut", minutes: 210, done: true });
  await post(M(`work-orders/${w2}/time`), { operationId: "fit", minutes: 75 });
  ids.wo = w2;
  // Released and drafts.
  const w3 = await mk("table", 12, 1, 4);
  await post(M(`work-orders/${w3}/release`), {});
  await mk("table", 20, 5, 9);
  await mk("desk", 8, 7, 12);

  await page.goto("/manufacturing");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "manufacturing", "home");
  await page.goto("/manufacturing/work-orders");
  await shoot(page, "manufacturing", "work-orders");
  await page.goto(`/manufacturing/work-orders/${w2}`);
  await expect(page.getByText(/MO-0003/).first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, "manufacturing", "work-order");
  await page.goto(`/manufacturing/boms/${desk}`);
  await shoot(page, "manufacturing", "recipe");
  await phoneShots(page, [["/manufacturing", "manufacturing"]]);
});

test("quality", async () => {
  const Q = (p: string) => org(`quality/${p}`);
  await req.get(Q("meta"), { timeout: 180_000 });
  await post(inv("bins"), { warehouseId: ids.wh, code: "Q-01", kind: "quarantine" });
  await post(Q("plans"), { name: "Incoming fasteners", category: "Fasteners", stage: "receipt", sampleSize: 3, parameters: [{ id: "len", name: "Length", kind: "measure", min: 39.5, max: 40.5, unit: "mm" }, { id: "dia", name: "Thread diameter", kind: "measure", min: 7.9, max: 8.1, unit: "mm" }, { id: "finish", name: "Zinc finish", kind: "check" }] });
  await post(Q("plans"), { name: "Castor load check", category: "Components", stage: "receipt", sampleSize: 2, parameters: [{ id: "spin", name: "Spins freely", kind: "check" }, { id: "load", name: "Load test (kg)", kind: "measure", min: 60, max: 200, unit: "kg" }] });
  const good = { len: 40.1, dia: 8.0, finish: true };
  const g2 = { len: 39.9, dia: 8.02, finish: true };
  for (const [qty, samples] of [[500, [good, good, g2]], [400, [g2, good, good]], [800, [good, { len: 41.2, dia: 8.0, finish: true }, good]], [700, [good, g2, good]], [650, [g2, g2, good]], [900, [good, good, good]], [600, null]] as const) {
    await post(inv("receipts"), { supplierId: ids.supplier, warehouseId: ids.wh, date: day(-6), lines: [{ itemId: items.bolt, qty, rate: 450, gstRate: 18 }] });
    if (!samples) continue;
    const pending = (await get<{ inspections: { id: string }[] }>(Q("inspections?status=pending"))).inspections;
    const insp = pending[pending.length - 1]!;
    await post(Q(`inspections/${insp.id}/results`), { samples });
  }
  await post(inv("receipts"), { supplierId: ids.supplier, warehouseId: ids.wh, date: day(-3), lines: [{ itemId: items.castor, qty: 200, rate: 9000, gstRate: 18 }] });
  const ncrs = (await get<{ ncrs: { id: string }[] }>(Q("ncrs"))).ncrs;
  ids.ncr = ncrs[0]!.id;
  await put(Q(`ncrs/${ids.ncr}`), { rootCause: "Supplier's heading die is worn, so a batch came out 1 mm long", disposition: "return", actions: [{ id: "a1", action: "Return the lot to Bharat Fasteners", kind: "corrective", done: true }, { id: "a2", action: "Ask the supplier to replace the die and share a first-article report", kind: "preventive", done: false }] });
  await post(Q("ncrs"), { title: "Scratches on desk tops after edging", severity: "minor", description: "Light scratches seen on 3 of 10 tops at final inspection." }).catch(() => {});

  await page.goto("/quality");
  await shoot(page, "quality", "home");
  await page.goto("/quality/inspections");
  await shoot(page, "quality", "inspections");
  const pending = (await get<{ inspections: { id: string; itemId?: string; lotQty?: number }[] }>(Q("inspections?status=pending"))).inspections;
  const bolts = pending.find((x) => x.lotQty === 600) ?? pending[pending.length - 1]!;
  await page.goto(`/quality/inspections/${bolts.id}`);
  // Results being typed in: one sample is out of tolerance and shows red.
  for (const [n, len, dia] of [[1, "40.05", "7.98"], [2, "40.62", "8.01"], [3, "39.94", "8.03"]] as const) {
    await page.getByLabel(`Length, sample ${n}`).fill(len);
    await page.getByLabel(`Thread diameter, sample ${n}`).fill(dia);
  }
  await page.getByRole("textbox").last().fill("Lot from Bharat Fasteners, invoice BF/2431. Sample 2 measured twice.").catch(() => {});
  await shoot(page, "quality", "inspection");
  await page.goto(`/quality/ncrs/${ids.ncr}`);
  await shoot(page, "quality", "ncr");
  await phoneShots(page, [["/quality", "quality"]]);
});

test("maintenance", async () => {
  const M = (p: string) => org(`maintenance/${p}`);
  await req.get(M("meta"), { timeout: 180_000 });
  await put(M("settings"), { partsWarehouseId: ids.wh, labourRate: 450_00 }).catch(() => {});
  const asset = async (data: Record<string, unknown>) => (await post<{ asset: { id: string } }>(M("assets"), data)).asset.id;
  const gen = await asset({ name: "Diesel generator 250 kVA", category: "Power", location: "Plant 1 · Utility room", make: "Kirloskar", model: "KG1-250", serial: "KG-99812", criticality: "high", meterUnit: "hours" });
  const cnc = await asset({ name: "CNC panel router", category: "Production", location: "Plant 1 · Line A", make: "Biesse", model: "Rover A", serial: "BR-20417", criticality: "high", meterUnit: "hours" });
  const comp = await asset({ name: "Air compressor 15 HP", category: "Utilities", location: "Plant 1 · Utility room", make: "Elgi", serial: "EG-15-3321", criticality: "medium", meterUnit: "hours" });
  const fork = await asset({ name: "Forklift 2.5 t", category: "Material handling", location: "Warehouse", make: "Godrej", serial: "GX-25-118", criticality: "medium", meterUnit: "hours" });
  await asset({ name: "Powder coating oven", category: "Production", location: "Plant 1 · Line B", make: "Nordson", criticality: "high" });
  await asset({ name: "Office AC, 2 t", category: "Facilities", location: "Admin block", make: "Voltas", criticality: "low" });
  const meters = [[gen, 1180, 1246], [cnc, 3400, 3655], [comp, 820, 905], [fork, 2100, 2160]] as const;
  for (const [a, before] of meters) await post(M(`assets/${a}/readings`), { value: before, on: day(-20) });
  await post(M("plans"), { assetId: gen, title: "Oil and filter change", everyDays: 180, everyMeter: 250, startOn: day(-30), startMeter: 1000, leadMeter: 10, checklist: [{ id: "a", text: "Drain engine oil" }, { id: "b", text: "Replace oil filter" }, { id: "c", text: "Check coolant level" }] });
  await post(M("plans"), { assetId: cnc, title: "Spindle and rail lubrication", everyDays: 30, startOn: day(-28), checklist: [{ id: "a", text: "Clean rails" }, { id: "b", text: "Grease bearings" }] });
  await post(M("plans"), { assetId: comp, title: "Drain moisture and check belts", everyDays: 14, startOn: day(-14), checklist: [{ id: "a", text: "Drain tank" }, { id: "b", text: "Check belt tension" }] });
  await post(M("plans"), { assetId: fork, title: "Monthly safety inspection", everyDays: 30, startOn: day(-30), checklist: [{ id: "a", text: "Brakes" }, { id: "b", text: "Forks and chains" }, { id: "c", text: "Horn and lights" }] });
  for (const [a, , now] of meters) await post(M(`assets/${a}/readings`), { value: now, on: day(0) });
  await post(M("plans/raise"), {}).catch(() => {});
  // A finished preventive job and a breakdown in progress.
  const orders = (await get<{ orders: { id: string; status: string; title: string }[] }>(M("orders"))).orders;
  const pm = orders.find((o) => o.title.startsWith("Drain moisture")) ?? orders[0];
  if (pm) {
    await post(M(`orders/${pm.id}/step`), { step: "start" });
    for (const item of ["a", "b"]) await post(M(`orders/${pm.id}/tick`), { item, done: true }).catch(() => {});
    await post(M(`orders/${pm.id}/complete`), {}).catch(() => {});
  }
  const bd = (await post<{ order: { id: string } }>(M("orders"), { assetId: cnc, kind: "breakdown", title: "Spindle overheating on long cuts", stopped: true })).order.id;
  const me = (await get<{ user: { id: string } }>("/api/v1/auth/me")).user.id;
  await put(M(`orders/${bd}`), { title: "Spindle overheating on long cuts", kind: "breakdown", priority: "urgent", assigneeId: me, description: "Spindle temperature alarm after about 40 minutes of continuous cutting on 18 mm ply." }).catch(() => {});
  await post(M(`orders/${bd}/step`), { step: "start" }).catch(() => {});
  await post(M(`orders/${bd}/labour`), { userId: me, minutes: 95, on: day(0) }).catch(() => {});
  await post(M(`orders/${bd}/parts`), { lines: [{ itemId: items.bolt, qty: 6 }] }).catch(() => {});
  await post(M(`orders/${bd}/external`), { cost: 8500_00, note: "Biesse service engineer visit" }).catch(() => {});
  ids.mntOrder = bd;
  await post(M("contracts"), { kind: "amc", vendor: "Kirloskar Service", assetIds: [gen], startOn: day(-200), endOn: day(165), cost: 60000_00, visits: 4 });
  await post(M("contracts"), { kind: "amc", vendor: "Biesse India", assetIds: [cnc], startOn: day(-330), endOn: day(35), cost: 145000_00, visits: 2 });
  ids.cnc = cnc;

  await page.goto("/maintenance");
  await shoot(page, "maintenance", "home");
  await page.goto("/maintenance/assets");
  await shoot(page, "maintenance", "assets");
  await page.goto(`/maintenance/orders/${bd}`);
  await shoot(page, "maintenance", "work-order");
  await page.goto(`/maintenance/assets/${cnc}`);
  await shoot(page, "maintenance", "asset");
  await phoneShots(page, [["/maintenance", "maintenance"]]);
});

test("documents", async () => {
  const D = (p: string) => org(`documents/${p}`);
  await req.get(D("meta"), { timeout: 180_000 });
  const folder = async (name: string, access?: string) => (await post<{ folder: { id: string } }>(D("folders"), { name, ...(access ? { access } : {}) })).folder.id;
  const legal = await folder("Legal", "managers");
  const hr = await folder("HR policies");
  const quality = await folder("Quality certificates");
  const vendors = await folder("Vendor agreements");
  const upload = async (name: string, title: string, meta: Record<string, unknown>, lines: string[]) => {
    const r = await req.post(D("files"), { timeout: 180_000, headers: H, multipart: { file: { name, mimeType: "application/pdf", buffer: pdf(title, lines) }, meta: JSON.stringify(meta) } });
    if (!r.ok()) throw new Error(`upload ${name}: ${r.status()} ${await r.text()}`);
    return ((await r.json()) as { file: { id: string } }).file.id;
  };
  const msa = await upload("Master supply agreement - Lumen Interiors.pdf", "Master supply agreement", { folderId: legal, tags: ["customer", "msa"] }, ["Between Northwind Components and Lumen Interiors.", "Term: 12 months from 1 October 2026.", "Payment within 30 days of invoice."]);
  const nda = await upload("Mutual NDA - Urban Nest.pdf", "Mutual non-disclosure agreement", { folderId: legal, tags: ["nda"] }, ["Between Northwind Components and Urban Nest Furnishings."]);
  await upload("Leave and attendance policy 2026.pdf", "Leave and attendance policy", { folderId: hr, tags: ["policy"] }, ["Applies to all employees from 1 April 2026."]);
  await upload("Code of conduct.pdf", "Code of conduct", { folderId: hr, tags: ["policy"] }, ["How we work together."]);
  await upload("ISO 9001 certificate.pdf", "ISO 9001:2015 certificate", { folderId: quality, tags: ["iso", "certificate"], expiresOn: day(160) }, ["Northwind Components, Plant 1, Pune."]);
  await upload("Fire NOC - Plant 1.pdf", "Fire safety NOC", { folderId: quality, tags: ["compliance"], expiresOn: day(18) }, ["Valid for Plant 1, Chakan MIDC."]);
  await upload("GST registration certificate.pdf", "GST registration certificate", { tags: ["statutory"] }, ["GSTIN 27AAKCN4417Q1Z2"]);
  await upload("Price list 2026-27.pdf", "Price list 2026-27", { tags: ["sales"] }, ["Effective 1 April 2026."]);
  await upload("Product catalogue - office range.pdf", "Office range catalogue", { tags: ["sales", "catalogue"] }, ["Desks, chairs, storage."]);
  const timber = await upload("Timber supply contract - Deccan Timber.pdf", "Timber supply contract", { folderId: vendors, tags: ["supplier"] }, ["Oak table tops, monthly call-offs."]);
  // Contracts at different stages.
  const c1 = (await post<{ contract: { id: string } }>(D("contracts"), { title: "Master supply agreement — Lumen Interiors", kind: "msa", counterparty: "Lumen Interiors", value: 4500000_00, startOn: day(-25), endOn: day(340), autoRenew: true, renewalMonths: 12, noticeDays: 60, fileId: msa, obligations: [{ id: "o1", text: "Quarterly price review", due: day(65) }] })).contract.id;
  await post(D(`contracts/${c1}/submit`), {});
  await post(D(`contracts/${c1}/decide`), { approve: true }).catch(() => {});
  const c2 = (await post<{ contract: { id: string } }>(D("contracts"), { title: "Mutual NDA — Urban Nest", kind: "nda", counterparty: "Urban Nest Furnishings", startOn: day(-3), endOn: day(727), fileId: nda })).contract.id;
  await post(D(`contracts/${c2}/submit`), {});
  await post(D(`contracts/${c2}/decide`), { approve: true }).catch(() => {});
  const c3 = (await post<{ contract: { id: string } }>(D("contracts"), { title: "Timber supply contract", kind: "vendor", counterparty: "Deccan Timber Works", value: 1800000_00, startOn: day(-340), endOn: day(24), noticeDays: 30, fileId: timber, obligations: [{ id: "o1", text: "Confirm next year's volumes", due: day(9) }] })).contract.id;
  await post(D(`contracts/${c3}/submit`), {});
  await post(D(`contracts/${c3}/decide`), { approve: true }).catch(() => {});
  await post(D(`contracts/${c3}/signed`), {}).catch(() => {});
  for (const c of [
    { title: "Office lease — Baner", kind: "lease", counterparty: "Shree Estates", value: 1440000_00, startOn: day(-120), endOn: day(600), noticeDays: 90 },
    { title: "AMC — Kirloskar generator", kind: "service", counterparty: "Kirloskar Service", value: 60000_00, startOn: day(-200), endOn: day(165), obligations: [{ id: "o1", text: "Second service visit", due: day(14) }] },
    { title: "Dealer agreement — Urban Nest", kind: "customer", counterparty: "Urban Nest Furnishings", value: 2500000_00, startOn: day(-2), endOn: day(363) },
  ]) {
    const id = (await post<{ contract: { id: string } }>(D("contracts"), c)).contract.id;
    if (c.kind !== "customer") {
      await post(D(`contracts/${id}/submit`), {}).catch(() => {});
      await post(D(`contracts/${id}/decide`), { approve: true }).catch(() => {});
      await post(D(`contracts/${id}/signed`), {}).catch(() => {});
    } else await post(D(`contracts/${id}/submit`), {}).catch(() => {});
  }
  // Signatures: one fully signed by link, one waiting.
  const s1 = await post<{ links: { url: string }[] }>(D("signatures"), { fileId: msa, contractId: c1, title: "Master supply agreement — Lumen Interiors", message: "Please review and sign.", signers: [{ name: "Meera Iyer", email: "meera@lumen.example" }] });
  const t1 = s1.links[0]!.url.split("/sign/")[1]!;
  await req.get(`/api/v1/sign/${t1}`);
  await req.get(`/api/v1/sign/${t1}/file`);
  await post(`/api/v1/sign/${t1}/sign`, { name: "Meera Iyer", consent: true });
  await post(D("signatures"), { fileId: nda, contractId: c2, title: "Mutual NDA — Urban Nest", message: "Sign when you can.", signers: [{ name: "Rohit Bansal", email: "rohit@urban.example" }, { name: "Ananya Rao", email: "ananya@northwind-demo.in" }] });
  ids.contract = c1;

  await page.goto("/documents");
  await shoot(page, "documents", "home");
  await page.goto("/documents/library");
  await shoot(page, "documents", "library");
  await page.goto(`/documents/contracts/${c1}`);
  await shoot(page, "documents", "contract");
  await page.goto("/documents/contracts");
  await shoot(page, "documents", "contracts");
  await phoneShots(page, [["/documents", "documents"]]);
});

test("logistics", async () => {
  const L = (p: string) => org(`logistics/${p}`);
  await req.get(L("meta"), { timeout: 180_000 });
  const vrl = (await post<{ carrier: { id: string } }>(L("carriers"), { name: "VRL Logistics", kind: "transporter", trackingUrl: "https://track.example/?lr={tracking}" })).carrier.id;
  await post(L("rates"), { carrierId: vrl, perKg: 1400, minCharge: 50000 });
  await post(L("rates"), { carrierId: vrl, fromState: "MH", toState: "KA", perKg: 900, minCharge: 30000, fixed: 10000 });
  const gati = (await post<{ carrier: { id: string } }>(L("carriers"), { name: "Gati Express", kind: "courier" })).carrier.id;
  await post(L("rates"), { carrierId: gati, perKg: 2200, minCharge: 25000 });
  await post(L("carriers"), { name: "Safexpress", kind: "transporter" });
  const driver = (await post<{ driver: { id: string } }>(L("drivers"), { name: "Ramesh Patil", phone: "98220 41188", licenceNo: "MH14 2016 0045123", licenceExpires: day(900) })).driver.id;
  await post(L("drivers"), { name: "Sunil Jadhav", phone: "97300 22871", licenceNo: "MH12 2018 0091877", licenceExpires: day(30) });
  const van = (await post<{ vehicle: { id: string } }>(L("vehicles"), { regNo: "MH14 KQ 2231", name: "Tata 407", type: "truck", capacityKg: 2500, driverId: driver, docs: [{ kind: "insurance", number: "POL-889211", expiresOn: day(210) }, { kind: "fitness", number: "FC-2231", expiresOn: day(25) }] })).vehicle.id;
  await post(L("vehicles"), { regNo: "MH12 TZ 0917", name: "Mahindra Bolero Pik-Up", type: "tempo", capacityKg: 1500, docs: [{ kind: "insurance", number: "POL-551820", expiresOn: day(95) }] });
  for (const [d, litres, odo] of [[-28, 60, 41200], [-19, 55, 41820], [-9, 58, 42440], [-2, 52, 43010]] as const) await post(L("fuel"), { vehicleId: van, date: day(d), litres, amount: litres * 104_00, odometer: odo, full: true });
  // Shipments: from deliveries, and direct ones in different states.
  const deliveries = (await get<{ deliveries: { id: string; number?: string; status?: string }[] }>(org("sales/deliveries"))).deliveries;
  const ship = async (data: Record<string, unknown>) => (await post<{ shipment: { id: string } }>(L("shipments"), { warehouseId: ids.wh, ...data })).shipment.id;
  const sh1 = deliveries[0] ? await ship({ mode: "carrier", carrierId: vrl, deliveryIds: [deliveries[0].id], consignee: "Lumen Interiors", address: "4 Residency Road, Bengaluru", state: "Karnataka", weightKg: 420, packages: 12, lrNo: "VRL-558120", trackingNo: "VRL-558120" }) : await ship({ mode: "carrier", carrierId: vrl, consignee: "Lumen Interiors", state: "Karnataka", weightKg: 420, packages: 12, lrNo: "VRL-558120", trackingNo: "VRL-558120" });
  await post(L(`shipments/${sh1}/step`), { status: "picked" });
  await post(L(`shipments/${sh1}/step`), { status: "in_transit", note: "Left Pune hub" });
  ids.shipment = sh1;
  const sh2 = await ship({ mode: "carrier", carrierId: gati, consignee: "Kavya Home Studio", address: "12 MG Road, Kochi", state: "Kerala", weightKg: 85, packages: 3, trackingNo: "GT77120934" });
  await post(L(`shipments/${sh2}/step`), { status: "picked" });
  await post(L(`shipments/${sh2}/step`), { status: "in_transit" });
  await post(L(`shipments/${sh2}/deliver`), { podName: "Kavya Nair" });
  const sh3 = await ship({ mode: "carrier", carrierId: vrl, consignee: "Shree Office Systems", address: "CG Road, Ahmedabad", state: "Gujarat", weightKg: 310, packages: 16 });
  await post(L(`shipments/${sh3}/step`), { status: "picked" });
  const own = await ship({ mode: "own", consignee: "Greenleaf Cafés", address: "Linking Road, Bandra, Mumbai", state: "Maharashtra", weightKg: 640, packages: 18 });
  await ship({ mode: "own", consignee: "Coastal Hospitality", address: "Dona Paula, Panaji", state: "Goa", weightKg: 380, packages: 12 });
  const trip = (await post<{ trip: { id: string } }>(L("trips"), { date: day(0), vehicleId: van, shipmentIds: [own], force: true })).trip.id;
  await post(L(`trips/${trip}/start`), { odometer: 43050 }).catch(() => {});

  await page.goto("/logistics");
  await shoot(page, "logistics", "home");
  await page.goto("/logistics/shipments");
  await shoot(page, "logistics", "shipments");
  await page.goto("/logistics/carriers");
  await page.getByText("VRL Logistics").first().click().catch(() => {});
  await shoot(page, "logistics", "carriers");
  await page.goto(`/logistics/vehicles/${van}`);
  await shoot(page, "logistics", "vehicle");
  await phoneShots(page, [["/logistics", "logistics"]]);
});

test("reports", async () => {
  const crm = (p: string) => org(`crm/${p}`);
  const B = (p: string) => org(`bi/${p}`);
  const stages = (await get<{ pipelines: { stages: { id: string; name: string }[] }[] }>(crm("meta"))).pipelines[0]!.stages;
  for (const [title, value, stage] of [
    ["Office fit-out, 120 seats", 1850000, 3], ["Café chain refresh, 14 outlets", 920000, 2], ["Hotel lobby seating", 640000, 4], ["Co-working desks, phase 2", 1240000, 1],
    ["School library shelving", 380000, 2], ["Clinic waiting area", 210000, 0], ["Retail store storage", 455000, 1], ["Annual dealer contract", 2600000, 3], ["Startup HQ desks", 540000, 4],
    ["Hostel furniture", 760000, 0], ["Bank branch counters", 1320000, 2], ["Hospital ward storage", 980000, 1], ["Studio apartments, 40 units", 1560000, 0],
  ] as const) {
    const d = (await post<{ deal: { id: string } }>(crm("deals"), { title, value: value * 100 })).deal;
    if (stage) await post(crm(`deals/${d.id}/move`), { stageId: stages[Math.min(stage, stages.length - 1)]!.id });
  }
  const all = { preset: "all" };
  // The builder, on screen: deal value by stage as bars.
  await page.goto("/reports/new");
  // The report builder compiles on first visit in dev; give it time.
  await expect(page.getByLabel("Data")).toBeVisible({ timeout: 120_000 });
  await page.getByLabel("Data").selectOption({ label: "Deals" });
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByLabel("Group 1", { exact: true }).selectOption({ label: "Stage" });
  await page.getByLabel("Measure 1 how").selectOption({ label: "Total" });
  await page.getByLabel("Measure 1", { exact: true }).selectOption({ label: "Value" });
  await page.getByRole("button", { name: "Bars" }).click();
  await page.getByLabel("Dates", { exact: true }).selectOption({ label: "All time" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("img", { name: "Bar chart" })).toBeVisible({ timeout: 60_000 });
  await shoot(page, "reports", "builder");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Pipeline value by stage");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline value by stage" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Email it" }).click();
  await shoot(page, "reports", "schedule", { settle: 800 });
  await page.getByRole("dialog").getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const reports = (await get<{ reports: { id: string; name: string }[] }>(B("reports"))).reports;
  const r1 = reports.find((r) => r.name === "Pipeline value by stage")!.id;
  const mk = async (name: string, dataset: string, spec: Record<string, unknown>) => (await post<{ report: { id: string } }>(B("reports"), { name, dataset, spec: { range: all, ...spec } })).report.id;
  const r0 = await mk("Open pipeline", "deals", { measures: [{ agg: "sum", field: "value" }], chart: "number" });
  const r2 = await mk("Revenue by product", "sales_lines", { dims: [{ field: "item" }], measures: [{ agg: "sum", field: "amount" }], chart: "pie" });
  const r3 = await mk("Orders by customer", "sales_orders", { dims: [{ field: "customer" }], measures: [{ agg: "count" }, { agg: "sum", field: "subtotal" }], chart: "table", sort: { by: "m1", dir: "desc" } });
  const r4 = await mk("Orders by month", "sales_orders", { dims: [{ field: "date", bucket: "week" }], measures: [{ agg: "sum", field: "subtotal" }], chart: "area" }).catch(() => null);
  const widgets = [{ id: "w0", reportId: r0, size: "s" }, { id: "w1", reportId: r1, size: "m" }, { id: "w2", reportId: r2, size: "m" }, { id: "w3", reportId: r3, size: "l" }, ...(r4 ? [{ id: "w4", reportId: r4, size: "l" }] : [])];
  const dash = (await post<{ dashboard: { id: string } }>(B("dashboards"), { name: "Sales this quarter", widgets })).dashboard.id;
  await page.goto(`/reports/dashboards/${dash}`);
  await expect(page.getByRole("heading", { name: "Sales this quarter" })).toBeVisible({ timeout: 90_000 });
  await shoot(page, "reports", "dashboard", { settle: 2500 });
  await page.goto("/reports");
  await shoot(page, "reports", "home");
  await phoneShots(page, [["/reports", "reports"]]);
});

test("portals", async ({ browser }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const linkFor = async (email: string, since: Date) => {
    for (let i = 0; i < 80; i++) {
      const r = await pool.query("select body from outbound_emails where \"to\" = $1 and subject like 'Your sign-in link%' and created_at >= $2 order by created_at desc limit 1", [email, since]);
      if (r.rows[0]) return new URL(/https?:\/\/\S+/.exec(r.rows[0].body as string)![0]);
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`No sign-in link for ${email}`);
  };
  try {
    // A customer with open invoices (one overdue) and a purchase order for the supplier.
    // (A customer with sales-order deliveries is avoided: the portal's home fails for them — reported.)
    const billing = addr("Pune", "Maharashtra", "Koregaon Park, Lane 5", "411001");
    const pk = (await post<{ client: { id: string } }>(`/api/v1/finance/books/${ids.book}/clients`, { name: "Neha Kulkarni", company: "Prakriti Wellness Studios", email: "neha@prakriti.example", billing, notes: "" })).client.id;
    for (const [issue, due, name, amount] of [[-48, -18, "Reception desk and storage, Baner studio", 8500000], [-12, 18, "Treatment room cabinets, 6 units", 14200000], [-70, -40, "Waiting area seating", 3600000]] as const) {
      await post(`/api/v1/finance/books/${ids.book}/documents`, { document: { type: "invoice", clientId: pk, client: { name: "Neha Kulkarni", company: "Prakriti Wellness Studios", billing }, issueDate: day(issue), dueDate: day(due), currency: "INR", taxMode: "none", lines: [{ id: "a", name, quantity: 1, rate: amount, taxBps: 0 }] }, issue: true });
    }
    const po = (await post<{ order: { id: string; number: string } }>(inv("orders"), { supplierId: ids.supplier, warehouseId: ids.wh, orderDate: day(-1), lines: [{ itemId: items.bolt, qty: 5000, rate: 450, gstRate: 18 }, { itemId: items.screw, qty: 10000, rate: 280, gstRate: 18 }] })).order;
    await post(inv(`orders/${po.id}/send`), { email: true });

    await page.goto("/portals");
    const portalUrl = new URL(await page.getByLabel("customers portal address").inputValue());
    await shoot(page, "portals", "home");

    // The customer's own portal.
    const cctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": ip() } });
    const cust = await cctx.newPage();
    await cust.goto(portalUrl.pathname + portalUrl.search);
    const cSince = new Date(Date.now() - 2000);
    await cust.getByLabel("Email").fill("neha@prakriti.example");
    await cust.getByRole("button", { name: "Email me a link" }).click();
    await expect(cust.getByText("Check your email")).toBeVisible({ timeout: 60_000 });
    const link = await linkFor("neha@prakriti.example", cSince);
    await cust.goto(link.pathname + link.search);
    await expect(cust.getByText(/overdue/).first()).toBeVisible({ timeout: 60_000 });
    await shoot(cust, "portals", "customer");
    await cust.getByRole("tab", { name: "Support" }).click();
    await cust.getByLabel("Subject").fill("Add our GSTIN to the October invoice");
    await cust.getByLabel("Details").fill("Please add GSTIN 27AAJCP5521K1Z8 to the latest invoice so we can claim input credit.");
    await cust.mouse.click(5, 880);
    await shoot(cust, "portals", "customer-support", { settle: 600 });
    await cctx.close();

    // The supplier's portal with the purchase order.
    const sctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": ip() } });
    const supp = await sctx.newPage();
    await supp.goto(portalUrl.pathname + "?kind=supplier");
    const sSince = new Date(Date.now() - 2000);
    await supp.getByLabel("Email").fill("orders@bharatfasteners.example");
    await supp.getByRole("button", { name: "Email me a link" }).click();
    const slink = await linkFor("orders@bharatfasteners.example", sSince);
    await supp.goto(slink.pathname + slink.search);
    await supp.getByRole("tab", { name: "Purchase orders" }).click();
    await supp.getByLabel("We'll deliver by").fill(day(6)).catch(() => {});
    await supp.getByLabel("Note").fill("Bolts ready Monday; screws follow on Wednesday.").catch(() => {});
    await supp.mouse.click(5, 880);
    await shoot(supp, "portals", "supplier");
    await sctx.close();
  } finally {
    await pool.end();
  }
  await phoneShots(page, [["/portals", "portals"]]);
});
