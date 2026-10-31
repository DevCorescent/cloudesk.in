// Real screenshots for Cloudesk for Horeca (public/marketing/horeca/). Signs up
// a fresh owner, sets up "Saffron House" — an Indian restaurant with rooms, a
// bar and valet — through the app's own APIs (menu in ₹, tables with QR codes,
// staff with PINs, rooms, bar and kitchen stock, reservations, a day of bills),
// then captures the dashboard at 1440×900 @2x and the guest pages on a phone
// (402×874 @3x). Timestamps are moved back in the dev database afterwards so
// timers and the day's report look like a real service.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-horeca
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { ip, shoot, asVisitor } from "./shoot";

const DIR = "horeca";
const PW = "correct-horse-42";
const T = Date.now().toString(36);
const ORIGIN = { origin: "http://localhost:3000" };
const rs = (r: number) => Math.round(r * 100); // ₹ → paise
const IST = 5.5 * 3600_000;
const istDate = (d = 0) => new Date(Date.now() + IST + d * 86_400_000).toISOString().slice(0, 10);
const today = istDate(0);
/** Today at HH:MM venue time — or, if that's still to come, a little before now. */
const todayAt = (hhmm: string, fallbackMin: number) => {
  const t = new Date(`${today}T${hhmm}:00+05:30`);
  return t.getTime() < Date.now() - 3 * 60_000 ? t : new Date(Date.now() - fallbackMin * 60_000);
};
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`;

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });

test("Saffron House — Cloudesk for Horeca", async ({ page, browser }) => {
  // The shared dev server can be slow to compile a route the first time.
  page.context().setDefaultNavigationTimeout(180_000);
  // ── Owner and workspace ──
  await asVisitor(page);
  const su = await page.request.post("/api/v1/auth/signup", { data: { name: "Asha Rao", email: `asha.${T}@saffronhouse-demo.in`, password: PW, orgName: "Asha's Studio" }, headers: { ...ORIGIN, "x-forwarded-for": ip() } });
  expect(su.status(), await su.text()).toBe(201);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = me.organizations[0].id as string;
  await page.request.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: ORIGIN });
  const created = await (await page.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "restaurant", name: "Saffron House" }, headers: ORIGIN })).json();
  const pid = created.project.id as string;

  const h = async <R = J>(method: string, path: string, body?: unknown): Promise<R> => {
    const res = await page.request.fetch(`/api/v1/projects/${pid}/horeca/${path}`, { method, data: body, headers: ORIGIN, timeout: 120_000 });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as R;
  };

  // ── Venue ──
  await h("PUT", "venue", { name: "Saffron House", kind: "restaurant", taxBps: 500, serviceChargeBps: 500 });
  const settings = (await h("GET", "venue")).venue.settings as J;
  Object.assign(settings.qr, { approval: "auto", theme: "warm", welcome: "Namaste! Order from your table — we'll bring it fresh from the tandoor.", cover: photo("1517248135467-4c7edcad34c4"), upiId: "saffronhouse@icici", tipOptions: [0, 5, 10], footer: "Prices exclude 5% GST · FSSAI 11522998000123" });
  settings.kitchen.stations = ["kitchen", "tandoor", "bar", "desserts"];
  Object.assign(settings.valet, { slots: 40, fee: 0 });
  Object.assign(settings.security, { autoLockMinutes: 5, discountLimitPct: 15 });
  Object.assign(settings.loyalty, { enabled: true, pointsPer100: 5, pointValue: 100, minRedeem: 100 });
  Object.assign(settings.receipt, { header: "Saffron House · Bandra West", gstin: "27AAFCS1234K1Z5", fssai: "11522998000123", address: "14 Hill Road, Bandra West, Mumbai 400050", phone: "+91 22 2640 1188" });
  const putVenue = (s: J) => h("PUT", "venue", { name: "Saffron House", kind: "restaurant", currency: "INR", taxBps: 500, serviceChargeBps: 500, settings: s });
  await putVenue(settings);

  // ── Staff ──
  const staff: Record<string, string> = {};
  for (const [name, role, pin] of [["Asha Rao", "owner", "1234"], ["Vikram Shah", "manager", "4321"], ["Chef Kunal", "chef", "1111"], ["Imran", "waiter", "2222"], ["Neha Kulkarni", "cashier", "3333"], ["Rohit", "captain", "5555"]] as const) {
    staff[name] = (await h("POST", "staff", { name, role, pin })).staff.id;
  }
  const asha = staff["Asha Rao"]!, imran = staff["Imran"]!, rohit = staff["Rohit"]!, neha = staff["Neha Kulkarni"]!, vikram = staff["Vikram Shah"]!;
  await h("POST", "unlock", { staffId: asha, pin: "1234" });
  await h("POST", "unlock", { staffId: imran, pin: "2222" });

  // ── Floor ──
  const areas: Record<string, string> = {};
  for (const [i, name] of ["Main dining", "Terrace", "Bar"].entries()) areas[name] = (await h("POST", "areas", { name, sort: i })).area.id;
  await h("POST", "tables/bulk", { areaId: areas["Main dining"], prefix: "T", from: 1, count: 10, seats: 4 });
  await h("POST", "tables/bulk", { areaId: areas["Terrace"], prefix: "P", from: 1, count: 6, seats: 2 });
  await h("POST", "tables/bulk", { areaId: areas["Bar"], prefix: "B", from: 1, count: 4, seats: 2 });

  // ── Kitchen stock (ingredients for recipes) ──
  const dairy = (await h("POST", "suppliers", { name: "Bandra Dairy & Grocers", phone: "+91 98200 44110", gstin: "27AAKFB7781L1Z2" })).supplier.id;
  const meat = (await h("POST", "suppliers", { name: "Fresh Catch & Meats", phone: "+91 98190 22771" })).supplier.id;
  const stock: Record<string, string> = {};
  const ingredients: [string, string, string, number, number, number, string, number][] = [
    // name, category, unit, packSize, ₹ per pack, reorderAt, supplier, packs bought
    ["Butter", "dairy", "g", 500, 275, 1000, dairy, 8],
    ["Cream", "dairy", "ml", 1000, 220, 1500, dairy, 6],
    ["Milk", "dairy", "ml", 1000, 68, 2500, dairy, 6],
    ["Paneer", "dairy", "g", 1000, 380, 1500, dairy, 5],
    ["Basmati rice", "dry", "g", 5000, 625, 3000, dairy, 2],
    ["Black urad dal", "dry", "g", 1000, 140, 1000, dairy, 3],
    ["Coffee beans", "dry", "g", 1000, 1400, 500, dairy, 2],
    ["Maida", "dry", "g", 5000, 210, 3000, dairy, 3],
    ["Chicken (boneless)", "meat", "g", 1000, 320, 2000, meat, 8],
    ["Tomato", "veg", "g", 1000, 40, 2000, meat, 10],
  ];
  for (const [name, category, unit, packSize, cost, reorderAt, supplierId] of ingredients) stock[name] = (await h("POST", "stock-items", { name, category, unit, packSize, costPerPack: rs(cost), reorderAt, supplierId })).item.id;
  for (const sup of [dairy, meat]) {
    const lines = ingredients.filter((x) => x[6] === sup).map(([name, , , , cost, , , packs]) => ({ stockItemId: stock[name]!, packs, cost: rs(cost * packs) }));
    await h("POST", "purchases", { supplierId: sup, invoiceNo: sup === dairy ? "BDG/2410/318" : "FCM-5521", date: istDate(-3), lines });
  }

  // ── Bar ──
  const bar: Record<string, string> = {};
  const bottles: [string, string, number, number, number, number][] = [
    // name, category, bottle ml, ₹ per bottle, reorder ml, bottles bought
    ["Kingfisher Ultra (330 ml)", "beer", 330, 110, 3300, 48],
    ["Bombay Sapphire", "gin", 750, 2400, 750, 4],
    ["Tonic water (300 ml)", "mixer", 300, 60, 1500, 4],
    ["Old Monk", "rum", 750, 600, 750, 6],
    ["Jose Cuervo Gold", "tequila", 750, 2800, 750, 1],
    ["Absolut Vodka", "vodka", 750, 1600, 750, 3],
    ["Glenfiddich 12", "whisky", 750, 4200, 750, 3],
    ["Johnnie Walker Black Label", "whisky", 1000, 3600, 1000, 4],
    ["Sula Shiraz", "wine", 750, 950, 1500, 6],
  ];
  for (const [name, category, bottleMl, cost, reorderMl, n] of bottles) {
    bar[name] = (await h("POST", "bar-items", { name, category, bottleMl, costPerBottle: rs(cost), reorderMl })).item.id;
    await h("POST", "bar-moves", { barItemId: bar[name], kind: "purchase", bottles: n, note: "Opening stock" });
  }
  await h("POST", "bar-moves", { barItemId: bar["Jose Cuervo Gold"], kind: "wastage", ml: 90, note: "Bottle tipped over at the bar" });
  // Last night's closing count, a little short on whisky and rum.
  const barNow = (await h<{ items: { id: string; stockMl: number }[] }>("GET", "bar")).items;
  const ml = (name: string) => barNow.find((b) => b.id === bar[name])!.stockMl;
  const counted = await h("POST", "bar-counts", {
    note: "Closing count",
    lines: [
      { barItemId: bar["Johnnie Walker Black Label"], countedMl: ml("Johnnie Walker Black Label") - 90 },
      { barItemId: bar["Glenfiddich 12"], countedMl: ml("Glenfiddich 12") - 30 },
      { barItemId: bar["Bombay Sapphire"], countedMl: ml("Bombay Sapphire") },
      { barItemId: bar["Old Monk"], countedMl: ml("Old Monk") - 60 },
      { barItemId: bar["Kingfisher Ultra (330 ml)"], countedMl: ml("Kingfisher Ultra (330 ml)") },
    ],
  });

  // ── Menu ──
  const cats: Record<string, string> = {};
  const catDefs: [string, string, string, string][] = [
    ["Small plates", "tandoor", "", ""],
    ["Mains", "kitchen", "", ""],
    ["Biryani & rice", "kitchen", "", ""],
    ["Breads", "tandoor", "", ""],
    ["Desserts", "desserts", "", ""],
    ["Coffee & shakes", "bar", "", ""],
    ["Cocktails", "bar", "", ""],
    ["Beer, wine & spirits", "bar", "", ""],
    ["Breakfast", "kitchen", "07:00", "11:30"],
  ];
  for (const [i, [name, station, availableFrom, availableTo]] of catDefs.entries()) cats[name] = (await h("POST", "categories", { name, station, availableFrom, availableTo, sort: i })).category.id;
  const mods: Record<string, string> = {};
  const modDefs: [string, number, number, [string, string, number][]][] = [
    ["Spice level", 1, 1, [["mild", "Mild", 0], ["medium", "Medium", 0], ["hot", "Hot", 0]]],
    ["Portion", 1, 1, [["half", "Half", 0], ["full", "Full", 160]]],
    ["Milk", 1, 1, [["regular", "Regular", 0], ["oat", "Oat milk", 60], ["almond", "Almond milk", 60]]],
    ["Extras", 0, 3, [["cheese", "Cheese", 60], ["xbutter", "Extra butter", 40], ["onion", "Onion salad", 30]]],
    ["Mixer", 0, 1, [["soda", "Soda", 0], ["tonic", "Tonic", 60], ["cola", "Cola", 60]]],
  ];
  for (const [name, minSelect, maxSelect, options] of modDefs) mods[name] = (await h("POST", "modifiers", { name, minSelect, maxSelect, options: options.map(([id, n, p]) => ({ id, name: n, price: rs(p) })) })).group.id;
  const R = (name: string, qty: number) => ({ stockItemId: stock[name]!, qty });
  type Dish = { name: string; cat: string; price: number; diet?: string; spice?: number; desc?: string; img?: string; tags?: string[]; prep?: number; mods?: string[]; code?: string; bar?: [string, number]; recipe?: { stockItemId: string; qty: number }[] };
  const dishes: Dish[] = [
    { name: "Butter pav bhaji", cat: "Small plates", price: 220, spice: 1, desc: "Mumbai-style mashed vegetable curry with buttered buns.", img: "1606491956689-2ea866880c84", prep: 12, mods: ["Extras"], code: "PB" },
    { name: "Mutton seekh kebab", cat: "Small plates", price: 420, diet: "nonveg", spice: 2, desc: "Minced lamb with mint and spices, cooked on skewers in the tandoor.", img: "1599487488170-d11ec9c172f0", prep: 20, code: "SK" },
    { name: "Paneer tikka sizzler", cat: "Small plates", price: 380, spice: 1, desc: "Charred cottage cheese, peppers and onions on a hot plate.", img: "1567188040759-fb8a883dc6d8", tags: ["Bestseller"], prep: 15, mods: ["Spice level"], code: "PT", recipe: [R("Paneer", 180), R("Butter", 10)] },
    { name: "Punjabi samosa (2 pcs)", cat: "Small plates", price: 180, spice: 1, desc: "Crisp pastry, spiced potato and peas, mint and tamarind chutney.", img: "1601050690597-df0568f70950", prep: 10, code: "SA", recipe: [R("Maida", 80)] },
    { name: "Butter chicken", cat: "Mains", price: 490, diet: "nonveg", spice: 1, desc: "Tandoori chicken in a silky tomato, butter and fenugreek gravy.", img: "1565557623262-b51c2513a641", tags: ["Signature"], prep: 20, mods: ["Spice level", "Portion"], code: "BC", recipe: [R("Chicken (boneless)", 220), R("Butter", 30), R("Cream", 40), R("Tomato", 120)] },
    { name: "Dal makhani", cat: "Mains", price: 320, desc: "Black lentils slow-cooked overnight with butter and cream.", img: "1585937421612-70a008356fbe", tags: ["Bestseller"], prep: 12, mods: ["Extras"], code: "DM", recipe: [R("Black urad dal", 90), R("Butter", 25), R("Cream", 30), R("Tomato", 60)] },
    { name: "Paneer butter masala", cat: "Mains", price: 390, spice: 1, desc: "Cottage cheese in a rich tomato and cashew gravy.", img: "1631452180519-c014fe946bc7", prep: 15, mods: ["Spice level"], code: "PBM", recipe: [R("Paneer", 180), R("Butter", 25), R("Cream", 30), R("Tomato", 100)] },
    { name: "Kerala fish curry", cat: "Mains", price: 520, diet: "nonveg", spice: 2, desc: "Seer fish simmered in coconut milk, kokum and curry leaves.", img: "1541518763669-27fef04b14ea", prep: 18, code: "FC" },
    { name: "Peppercorn tenderloin & fries", cat: "Mains", price: 690, diet: "nonveg", desc: "Grilled tenderloin with a green peppercorn sauce and hand-cut fries.", img: "1600891964092-4316c288032e", prep: 22, code: "PT2" },
    { name: "Saffron House thali", cat: "Mains", price: 450, desc: "Dal, two sabzis, raita, rice, two rotis and a sweet.", img: "1546833999-b9f581a1996d", prep: 15, code: "TH" },
    { name: "Rainbow Buddha bowl", cat: "Mains", price: 340, diet: "vegan", desc: "Quinoa, roasted veggies, chickpeas and tahini.", img: "1512621776951-a57141f2eefd", prep: 10, code: "BB" },
    { name: "Hyderabadi chicken biryani", cat: "Biryani & rice", price: 460, diet: "nonveg", spice: 2, desc: "Dum-cooked basmati with chicken, saffron and fried onions.", img: "1563379091339-03b21ab4a4f8", prep: 25, code: "HB", recipe: [R("Basmati rice", 160), R("Chicken (boneless)", 180)] },
    { name: "Subz pulao", cat: "Biryani & rice", price: 280, desc: "Fragrant basmati with seasonal vegetables and whole spices.", img: "1589302168068-964664d93dc0", prep: 15, code: "SP", recipe: [R("Basmati rice", 150)] },
    { name: "Butter naan", cat: "Breads", price: 70, prep: 6, code: "BN", recipe: [R("Maida", 120), R("Butter", 10)] },
    { name: "Garlic naan", cat: "Breads", price: 80, prep: 6, code: "GN", recipe: [R("Maida", 120), R("Butter", 8)] },
    { name: "Lachha paratha", cat: "Breads", price: 75, prep: 7, code: "LP", recipe: [R("Maida", 110), R("Butter", 12)] },
    { name: "Gulab jamun with rabri", cat: "Desserts", price: 160, desc: "Warm gulab jamun on chilled saffron rabri.", prep: 5, code: "GJ" },
    { name: "Sizzling brownie", cat: "Desserts", price: 260, diet: "egg", desc: "Walnut brownie, vanilla ice cream and hot chocolate sauce.", prep: 8, code: "SB" },
    { name: "Sprinkle doughnuts (2)", cat: "Desserts", price: 220, diet: "egg", prep: 5, code: "DN" },
    { name: "Café latte", cat: "Coffee & shakes", price: 190, desc: "Double shot with steamed milk.", img: "1461023058943-07fcbe16d735", prep: 5, mods: ["Milk"], code: "LAT", recipe: [R("Coffee beans", 18), R("Milk", 200)] },
    { name: "Cappuccino", cat: "Coffee & shakes", price: 180, img: "1572442388796-11668a67e53d", prep: 5, mods: ["Milk"], code: "CAP", recipe: [R("Coffee beans", 18), R("Milk", 150)] },
    { name: "Flat white", cat: "Coffee & shakes", price: 200, prep: 5, mods: ["Milk"], code: "FW", recipe: [R("Coffee beans", 18), R("Milk", 120)] },
    { name: "Classic cold coffee", cat: "Coffee & shakes", price: 220, img: "1572490122747-3968b75cc699", prep: 5, recipe: [R("Coffee beans", 14), R("Milk", 250)] },
    { name: "Nutella freakshake", cat: "Coffee & shakes", price: 290, img: "1563805042-7684c019e1cb", prep: 6, recipe: [R("Milk", 250)] },
    { name: "Berry gin smash", cat: "Cocktails", price: 620, diet: "none", desc: "Bombay Sapphire, muddled berries, lime and mint.", img: "1536935338788-846bb9981813", prep: 5, bar: ["Bombay Sapphire", 60] },
    { name: "Saffron old fashioned", cat: "Cocktails", price: 720, diet: "none", desc: "Glenfiddich 12 stirred with saffron syrup and orange bitters.", img: "1514362545857-3bc16c4c7d1b", prep: 5, bar: ["Glenfiddich 12", 60] },
    { name: "Classic dry martini", cat: "Cocktails", price: 680, diet: "none", img: "1551024709-8f23befc6f87", prep: 4, bar: ["Absolut Vodka", 60] },
    { name: "Margarita", cat: "Cocktails", price: 640, diet: "none", prep: 4, bar: ["Jose Cuervo Gold", 60] },
    { name: "Virgin mojito trio", cat: "Cocktails", price: 260, desc: "Classic, watermelon and kala khatta.", prep: 5 },
    { name: "Kingfisher Ultra", cat: "Beer, wine & spirits", price: 320, diet: "none", prep: 1, bar: ["Kingfisher Ultra (330 ml)", 330] },
    { name: "Sula Shiraz (glass)", cat: "Beer, wine & spirits", price: 450, diet: "none", prep: 1, bar: ["Sula Shiraz", 150] },
    { name: "Glenfiddich 12 (60 ml)", cat: "Beer, wine & spirits", price: 900, diet: "none", prep: 1, mods: ["Mixer"], bar: ["Glenfiddich 12", 60] },
    { name: "Old Monk (60 ml)", cat: "Beer, wine & spirits", price: 260, diet: "none", prep: 1, mods: ["Mixer"], bar: ["Old Monk", 60] },
    { name: "Indori poha", cat: "Breakfast", price: 160, desc: "Flattened rice with peanuts, sev and lime.", img: "1610192244261-3f33de3f55e4", prep: 8 },
    { name: "Masala omelette & toast", cat: "Breakfast", price: 220, diet: "egg", spice: 1, img: "1525351484163-7529414344d8", prep: 8 },
  ];
  const item: Record<string, string> = {};
  for (const [i, d] of dishes.entries()) {
    item[d.name] = (
      await h("POST", "menu-items", {
        categoryId: cats[d.cat],
        name: d.name,
        description: d.desc ?? "",
        price: rs(d.price),
        image: d.img ? photo(d.img) : "",
        diet: d.diet ?? "veg",
        spice: d.spice ?? 0,
        tags: d.tags ?? [],
        prepMinutes: d.prep ?? 15,
        modifierGroupIds: (d.mods ?? []).map((m) => mods[m]),
        barItemId: d.bar ? bar[d.bar[0]] : null,
        pourMl: d.bar ? d.bar[1] : null,
        recipe: d.recipe ?? [],
        code: d.code ?? "",
        sort: i,
      })
    ).item.id;
  }

  // ── Rooms (each room gets its own in-room dining QR) ──
  const types: Record<string, string> = {};
  for (const [i, [name, rate, maxGuests, description]] of ([
    ["Deluxe King", 6500, 2, "A king bed, a work desk and a rain shower."],
    ["Premier Twin", 7200, 2, "Two beds and a city view."],
    ["Saffron Suite", 12500, 3, "A separate lounge, a bathtub and a balcony."],
    ["Garden Villa", 18000, 4, "A private garden and plunge pool."],
  ] as const).entries())
    types[name] = (await h("POST", "room-types", { name, rate: rs(rate), maxGuests, description, amenities: ["Wi-Fi", "Breakfast"], sort: i })).type.id;
  const room: Record<string, string> = {};
  for (const [num, type, floor] of [["101", "Deluxe King", "1"], ["102", "Deluxe King", "1"], ["103", "Deluxe King", "1"], ["104", "Deluxe King", "1"], ["105", "Deluxe King", "1"], ["106", "Deluxe King", "1"], ["201", "Premier Twin", "2"], ["202", "Premier Twin", "2"], ["203", "Premier Twin", "2"], ["204", "Premier Twin", "2"], ["301", "Saffron Suite", "3"], ["302", "Saffron Suite", "3"], ["V1", "Garden Villa", "G"], ["V2", "Garden Villa", "G"]] as const)
    room[num] = (await h("POST", "rooms", { typeId: types[type], number: num, floor })).room.id;
  // (Room QR codes show under their own "Rooms" filter on the floor and QR pages.)
  const tables = (await h<{ tables: { id: string; name: string; token: string; kind: string; seats: number; sort: number }[] }>("GET", "tables")).tables;
  const tid = (name: string) => tables.find((t) => t.name === name)!.id;
  const tok = (name: string) => tables.find((t) => t.name === name)!.token;

  const booking = async (num: string, guestName: string, inDay: number, outDay: number, o: J = {}) => (await h("POST", "bookings", { roomId: room[num], guestName, checkIn: istDate(inDay), checkOut: istDate(outDay), adults: 2, children: 0, source: "direct", ...o })).booking.id as string;
  const checkIn = (id: string) => h("POST", `bookings/${id}/action`, { action: "check_in", force: true });
  const b101 = await booking("101", "Ananya Iyer", -1, 2, { guestPhone: "+91 98450 11223", source: "ota" });
  await booking("102", "Arjun Mehta", 1, 4, { guestPhone: "+91 98190 99881" });
  const b103 = await booking("103", "Sameer Khan", -3, 0, { adults: 1, source: "corporate" });
  await booking("104", "Kabir Malhotra", 0, 2, { guestPhone: "+91 98201 55443", source: "phone" });
  await booking("105", "Daniel Brooks", 3, 6, { adults: 1, source: "ota" });
  await booking("106", "Rahul Verma", 9, 12);
  await booking("201", "Neha Gupta", 7, 11, { adults: 1 });
  const b202 = await booking("202", "Vikram Shah", -2, 0, { source: "corporate" });
  await booking("203", "Priya Nair", 0, 1, { adults: 1, source: "phone" });
  const b301 = await booking("301", "Rohan & Meera Kapoor", -2, 1, { adults: 2, children: 1, guestPhone: "+91 9844936670", guestEmail: "rohan.kapoor@gmail.com" });
  const bV1 = await booking("V1", "The Fernandes family", -1, 3, { adults: 2, children: 2 });
  for (const b of [b101, b103, b202, b301, bV1]) await checkIn(b);
  await h("POST", `bookings/${b301}/payments`, { method: "card", amount: rs(15000), ref: "Advance" });
  await h("POST", `bookings/${b301}/charges`, { label: "Spa · couples massage", amount: rs(6400) });
  await h("POST", `bookings/${b301}/charges`, { label: "Laundry", amount: rs(850) });
  // Sameer checked out this morning (his room needs cleaning).
  const v103 = await h("GET", `bookings/${b103}`);
  await h("POST", `bookings/${b103}/payments`, { method: "upi", amount: v103.folio.due, ref: "" });
  await h("POST", `bookings/${b103}/action`, { action: "check_out" });

  // ── Guests & loyalty ──
  const regulars: [string, string, string, string[], number, number, number][] = [
    // name, phone, birthday, tags, visits, spend ₹, days since last visit
    ["Kavya Iyer", "9833300011", "1992-11-04", ["Regular", "Birthday in Nov"], 9, 21480, 6],
    ["Rahul Desai", "9833300022", "", ["Regular"], 6, 14250, 3],
    ["Meera Joshi", "9833300044", "", ["Jain"], 4, 8640, 11],
    ["Aditya Rao", "9867055512", "", [], 2, 3120, 18],
    ["Farah Khan", "9930012457", "1988-03-21", ["VIP"], 12, 38900, 2],
  ];
  for (const [name, phone, birthday, tags] of regulars) await h("POST", "guests", { name, phone, birthday, tags });

  // ── The till opens ──
  await h("POST", "shift/open", { openingFloat: rs(5000), staffId: asha });
  await h("POST", "shift/cash", { kind: "pay_in", amount: rs(2000), reason: "Change from the bank", staffId: asha });
  await h("POST", "shift/cash", { kind: "pay_out", amount: rs(450), reason: "Ice and lemons from the market", staffId: asha });

  // ── Orders ──
  type Ln = [string, number, string[]?, string?];
  const lines = (ls: Ln[]) => ls.map(([n, qty, options, notes]) => ({ itemId: item[n]!, qty, options: options ?? [], notes: notes ?? "" }));
  const order = (o: { table?: string; source?: string; covers?: number; guestName?: string; guestPhone?: string; staffId?: string; address?: string }, ls: Ln[]) =>
    h<{ order: J; items: J[]; totals: J }>("POST", "orders", { tableId: o.table ? tid(o.table) : null, source: o.source ?? "staff", covers: o.covers ?? 0, guestName: o.guestName ?? "", guestPhone: o.guestPhone ?? "", staffId: o.staffId ?? null, deliveryAddress: o.address ?? "", lines: lines(ls) });
  const pay = async (v: { order: J; totals: J }, methods: [string, number?][], staffId: string) => {
    let due = v.totals.due as number;
    let last = v;
    for (const [i, [method, part]] of methods.entries()) {
      const amount = i === methods.length - 1 ? due : Math.round(due * (part ?? 0.5));
      last = await h("POST", `orders/${v.order.id}/pay`, { method, amount, ref: method === "upi" ? `UPI${Math.floor(Math.random() * 1e9)}` : "", staffId });
      due -= amount;
    }
    return last;
  };
  const paidOrders: { id: string; at: Date }[] = [];
  const closed = async (when: [string, number], o: Parameters<typeof order>[0], ls: Ln[], methods: [string, number?][], payer: string, extra: { discount?: number; tip?: number; feedback?: [number, string] } = {}) => {
    const v = await order(o, ls);
    for (const it of v.items) await h("POST", `items/${it.id}/status`, { status: "served" });
    let cur = v;
    if (extra.discount || extra.tip) cur = await h("POST", `orders/${v.order.id}/bill`, { discount: extra.discount ?? 0, tip: extra.tip ?? 0, discountReason: "Regular guest", staffId: vikram });
    await pay(cur, methods, payer);
    if (extra.feedback && o.table) await page.request.post(`/t/${tok(o.table)}`, { data: { action: "feedback", rating: extra.feedback[0], comment: extra.feedback[1] }, headers: ORIGIN });
    paidOrders.push({ id: v.order.id, at: todayAt(when[0], when[1]) });
    return v;
  };
  // Breakfast and lunch, settled.
  await closed(["08:40", 300], { table: "T6", covers: 2, staffId: rohit }, [["Indori poha", 2], ["Masala omelette & toast", 1], ["Cappuccino", 2, ["regular"]]], [["upi"]], neha);
  await closed(["09:20", 290], { source: "takeaway", staffId: neha, guestName: "Swiggy #4471" }, [["Café latte", 2, ["oat"]], ["Classic cold coffee", 1]], [["upi"]], neha);
  await closed(["12:35", 260], { table: "T1", covers: 4, staffId: imran, guestName: "Farah Khan", guestPhone: "9930012457" }, [["Butter chicken", 2, ["medium", "full"]], ["Dal makhani", 1], ["Garlic naan", 4], ["Butter naan", 2], ["Saffron House thali", 1], ["Gulab jamun with rabri", 2]], [["card"]], neha, { feedback: [5, "The butter chicken was spot on. Imran looked after us beautifully."] });
  await closed(["12:50", 250], { table: "T3", covers: 2, staffId: imran, guestName: "Rahul Desai", guestPhone: "9833300022" }, [["Hyderabadi chicken biryani", 2], ["Mutton seekh kebab", 1], ["Virgin mojito trio", 2]], [["upi"]], neha, { feedback: [4, "Biryani was lovely, a bit slow today."] });
  await closed(["13:05", 240], { table: "P1", covers: 2, staffId: rohit, guestName: "Priya Mehta", guestPhone: "9820012345" }, [["Paneer tikka sizzler", 1, ["medium"]], ["Paneer butter masala", 1, ["mild"]], ["Butter chicken", 1, ["mild", "full"]], ["Garlic naan", 3], ["Lachha paratha", 2], ["Kingfisher Ultra", 2], ["Sizzling brownie", 1], ["Berry gin smash", 2], ["Sula Shiraz (glass)", 2]], [["upi"]], neha, { feedback: [5, "Perfect terrace lunch!"] });
  await closed(["13:20", 230], { source: "takeaway", staffId: neha, guestName: "Zomato #8812" }, [["Hyderabadi chicken biryani", 1], ["Subz pulao", 1], ["Butter naan", 2]], [["upi"]], neha);
  await closed(["13:40", 220], { table: "T5", covers: 3, staffId: imran, guestName: "Kavya Iyer", guestPhone: "9833300011" }, [["Kerala fish curry", 1], ["Dal makhani", 1, ["xbutter"]], ["Butter naan", 3], ["Subz pulao", 1], ["Nutella freakshake", 2]], [["cash"]], neha, { discount: rs(100), tip: rs(100), feedback: [5, "Kavya's birthday lunch — thank you for the candle!"] });
  await closed(["14:00", 210], { table: "B2", covers: 2, staffId: rohit, guestName: "Sana Qureshi", guestPhone: "9867011223" }, [["Saffron old fashioned", 2], ["Classic dry martini", 1], ["Mutton seekh kebab", 1], ["Punjabi samosa (2 pcs)", 1], ["Glenfiddich 12 (60 ml)", 1, ["soda"]]], [["card"]], neha);
  await closed(["14:15", 200], { table: "T8", covers: 4, staffId: imran, guestName: "Meera Joshi", guestPhone: "9833300044" }, [["Saffron House thali", 3], ["Paneer butter masala", 1, ["medium"]], ["Lachha paratha", 3], ["Café latte", 2, ["regular"]]], [["card", 0.5], ["upi"]], neha, { feedback: [4, "Jain thali on request — very thoughtful."] });
  await closed(["14:30", 190], { source: "takeaway", staffId: asha, guestName: "Arjun Kapoor", guestPhone: "9819098765" }, [["Butter chicken", 1, ["mild", "half"]], ["Garlic naan", 2]], [["cash"]], asha);
  await closed(["14:50", 180], { table: "P3", covers: 2, staffId: rohit }, [["Rainbow Buddha bowl", 2], ["Flat white", 2, ["almond"]]], [["upi"]], neha, { feedback: [3, "Good food, the music was a bit loud."] });
  await closed(["15:10", 170], { table: "T9", covers: 2, staffId: imran, guestName: "Aditya Rao", guestPhone: "9867055512" }, [["Peppercorn tenderloin & fries", 1], ["Butter chicken", 1, ["hot", "full"]], ["Butter naan", 2], ["Old Monk (60 ml)", 2, ["cola"]]], [["cash"]], neha);
  await closed(["15:25", 160], { source: "takeaway", staffId: neha }, [["Butter pav bhaji", 2], ["Classic cold coffee", 2]], [["cash"]], neha);
  // Room service, charged to the suite's folio.
  const rs301 = await order({ table: "Room 301", source: "room", staffId: imran }, [["Butter chicken", 1, ["mild", "half"]], ["Garlic naan", 2], ["Gulab jamun with rabri", 1], ["Sula Shiraz (glass)", 1]]);
  for (const it of rs301.items) await h("POST", `items/${it.id}/status`, { status: "served" });
  await h("POST", `orders/${rs301.order.id}/pay`, { method: "room", amount: rs301.totals.due, ref: "", staffId: neha });
  paidOrders.push({ id: rs301.order.id, at: todayAt("15:30", 150) });

  // Regulars' history (visits before today), so the guest list reads like a real one.
  const guestRows = await db.select().from(schema.horecaGuests).where(eq(schema.horecaGuests.projectId, pid));
  for (const [name, phone, , , visits, spend, daysAgo] of regulars) {
    const g = guestRows.find((x) => x.phone.endsWith(phone));
    if (!g) continue;
    await db.update(schema.horecaGuests).set({ name, visits: sql`${schema.horecaGuests.visits} + ${visits}`, spend: sql`${schema.horecaGuests.spend} + ${rs(spend)}`, points: sql`${schema.horecaGuests.points} + ${Math.floor(spend / 100) * 5 - visits * 20}`, lastVisitAt: g.visits ? g.lastVisitAt : ago(daysAgo * 1440), createdAt: ago(120 * 1440) }).where(eq(schema.horecaGuests.id, g.id));
  }

  // ── Open tables right now ──
  const open: Record<string, { id: string; min: number }> = {};
  const live = async (table: string, min: number, o: Parameters<typeof order>[0], ls: Ln[]) => {
    const v = await order({ table, ...o }, ls);
    open[table] = { id: v.order.id, min };
    return v;
  };
  await live("T2", 24, { covers: 2, staffId: imran }, [["Dal makhani", 1], ["Paneer butter masala", 1, ["mild"]], ["Butter naan", 2]]);
  await live("T3", 38, { covers: 2, staffId: imran }, [["Butter chicken", 1, ["medium", "full"]], ["Saffron House thali", 1], ["Classic cold coffee", 2]]);
  await live("T5", 52, { covers: 3, staffId: imran, guestName: "Vikram Nair" }, [["Hyderabadi chicken biryani", 2], ["Mutton seekh kebab", 1], ["Virgin mojito trio", 2]]);
  await live("T8", 31, { covers: 4, staffId: rohit }, [["Peppercorn tenderloin & fries", 1], ["Kerala fish curry", 1], ["Paneer tikka sizzler", 1, ["medium"]], ["Lachha paratha", 2], ["Berry gin smash", 1], ["Classic dry martini", 1]]);
  await live("T10", 18, { covers: 3, staffId: imran }, [["Hyderabadi chicken biryani", 1], ["Butter chicken", 1, ["mild", "half"]], ["Garlic naan", 2], ["Kingfisher Ultra", 1]]);
  await live("P2", 44, { covers: 3, staffId: rohit, guestName: "Rahul Desai", guestPhone: "9833300022" }, [["Butter pav bhaji", 1, ["cheese"]], ["Paneer tikka sizzler", 1, ["mild"]], ["Mutton seekh kebab", 1], ["Cappuccino", 2, ["regular"]], ["Saffron old fashioned", 2], ["Sizzling brownie", 1], ["Margarita", 2]]);
  await live("P4", 27, { covers: 2, staffId: rohit }, [["Punjabi samosa (2 pcs)", 1], ["Rainbow Buddha bowl", 1], ["Café latte", 1, ["oat"]]]);
  await live("B1", 15, { covers: 2, staffId: rohit }, [["Glenfiddich 12 (60 ml)", 2, ["soda"]], ["Old Monk (60 ml)", 1, ["cola"]], ["Mutton seekh kebab", 1]]);
  // A QR order on T7 that a waiter still has to confirm.
  settings.qr.approval = "staff";
  await putVenue(settings);
  const qr7 = await page.request.post(`/t/${tok("T7")}`, { data: { action: "order", lines: lines([["Butter chicken", 1, ["mild", "full"]], ["Dal makhani", 1], ["Garlic naan", 4], ["Classic cold coffee", 2]]), name: "Ishaan", phone: "" }, headers: ORIGIN });
  expect(qr7.ok(), await qr7.text()).toBeTruthy();
  settings.qr.approval = "auto";
  await putVenue(settings);
  const floor0 = await h<{ tables: { name: string; order: { id: string } | null }[] }>("GET", "floor");
  open["T7"] = { id: floor0.tables.find((t) => t.name === "T7")!.order!.id, min: 6 };

  // The kitchen moves things along.
  const kotsOf = async (table: string) => {
    const v = await h<{ items: { id: string; kotNo: number; station: string; name: string; status: string }[] }>("GET", `orders/${open[table]!.id}`);
    return v.items;
  };
  const bump = async (table: string, station: string, status: string) => {
    for (const k of new Set((await kotsOf(table)).filter((i) => i.station === station).map((i) => i.kotNo))) await h("POST", "kot", { orderId: open[table]!.id, kotNo: k, status });
  };
  await bump("T3", "kitchen", "ready");
  await bump("T3", "bar", "served");
  await bump("T2", "kitchen", "preparing");
  await bump("P2", "bar", "served");
  await bump("P2", "tandoor", "preparing");
  await bump("T8", "bar", "served");
  await bump("T8", "tandoor", "ready");
  await bump("P4", "bar", "ready");
  await bump("B1", "bar", "served");
  // T5: the biryani was a mistake (a manager cancelled it), the kebab is ready, the mojitos are out.
  for (const it of await kotsOf("T5")) {
    if (it.name === "Hyderabadi chicken biryani") await h("POST", `items/${it.id}/status`, { status: "void", reason: "Wrong item entered", staffId: vikram });
    if (it.name === "Mutton seekh kebab") await h("POST", `items/${it.id}/status`, { status: "ready" });
    if (it.name === "Virgin mojito trio") await h("POST", `items/${it.id}/status`, { status: "served" });
  }
  // T8 has asked for the bill already.
  const t8 = await h("POST", `orders/${open["T8"]!.id}/bill`, { staffId: rohit });
  // Guests calling from their tables.
  await page.request.post(`/t/${tok("T5")}`, { data: { action: "request", kind: "bill" }, headers: ORIGIN });
  await page.request.post(`/t/${tok("T3")}`, { data: { action: "request", kind: "waiter" }, headers: ORIGIN });
  await page.request.post(`/t/${tok("P4")}`, { data: { action: "request", kind: "water" }, headers: ORIGIN });

  // ── Reservations tonight ──
  const at = (hhmm: string) => `${today}T${hhmm}:00+05:30`;
  const r1 = await h("POST", "reservations", { guestName: "Kavya Iyer", guestPhone: "9833300011", partySize: 6, at: at("20:00"), tableId: tid("T9"), source: "phone", notes: "Birthday — cake at 9" });
  const r2 = await h("POST", "reservations", { guestName: "Rahul Desai", guestPhone: "9833300022", partySize: 2, at: at("20:30"), tableId: tid("P1"), source: "online", notes: "Window table" });
  await h("POST", "reservations", { guestName: "The Fernandes family", guestPhone: "9833300033", partySize: 8, at: at("21:00"), source: "staff" });
  await h("POST", "reservations", { guestName: "Meera Joshi", guestPhone: "9833300044", partySize: 4, at: at("21:30"), source: "online", notes: "Jain food" });
  await h("POST", `reservations/${r1.reservation.id}/status`, { status: "confirmed" });
  await h("POST", `reservations/${r2.reservation.id}/status`, { status: "confirmed" });
  await h("POST", "reservations", { kind: "waitlist", guestName: "Walk-in · Nikhil", guestPhone: "9821177340", partySize: 3, at: new Date(Date.now() - 12 * 60_000).toISOString(), source: "walk_in" });

  // ── Valet ──
  const car = (o: J) => h("POST", "valet", o).then((r) => r.ticket as J);
  const v1 = await car({ plate: "MH 01 AB 4521", car: "Hyundai Creta", color: "White", guestName: "Rohan Kapoor", guestPhone: "9844936670", slot: "A-03" });
  const v2 = await car({ plate: "MH 02 CK 1188", car: "Honda City", color: "Red", guestName: "Farah Khan", slot: "A-05" });
  const v3 = await car({ plate: "MH 04 GT 7790", car: "Mahindra XUV700", color: "Grey", guestName: "", slot: "B-12", tableId: tid("T1") });
  const v4 = await car({ plate: "MH 12 PQ 0042", car: "Tata Nexon EV", color: "Teal", guestName: "Aditi", slot: "B-02", notes: "EV — plug in if a charger frees up" });
  const v5 = await car({ plate: "KA 03 MN 6612", car: "Toyota Fortuner", color: "White", guestName: "The Fernandes family", slot: "C-01", roomBookingId: bV1 });
  const v6 = await car({ plate: "MH 01 DX 3333", car: "Mercedes C-Class", color: "Silver", guestName: "Mr. Rao", guestPhone: "9820456789", slot: "A-11" });
  const v7 = await car({ plate: "MH 47 Z 9090", car: "Kia Seltos", color: "Blue", guestName: "Sana Qureshi", slot: "A-08" });
  await car({ guestName: "Kabir Malhotra", guestPhone: "9820155443", car: "Audi Q5", expectedAt: new Date(Date.now() + 150 * 60_000).toISOString() });
  await car({ guestName: "Priya Nair", guestPhone: "9821133442", expectedAt: new Date(Date.now() + 240 * 60_000).toISOString() });
  await car({ guestName: "Arjun Mehta", guestPhone: "9819099881", plate: "MH 03 AZ 1001", car: "Honda City", expectedAt: new Date(Date.now() + 300 * 60_000).toISOString() });
  await h("POST", `valet/${v2.id}/status`, { status: "delivered" });
  await h("POST", `valet/${v3.id}/status`, { status: "ready" });
  // Mr. Rao taps "Bring my car" on his phone.
  const vr = await page.request.post(`/v/${v6.token}`, { headers: ORIGIN, maxRedirects: 0 });
  expect(vr.status()).toBe(303);

  // ── Housekeeping ──
  for (const [num, state] of [["204", "dirty"], ["203", "inspect"], ["106", "out_of_order"]] as const) await h("POST", `rooms/${room[num]}/housekeeping`, { state });

  // ── Feedback rows exist and the day's numbers are in. Now move the clock back on the day. ──
  for (const p of paidOrders) {
    await db.update(schema.horecaOrders).set({ createdAt: new Date(p.at.getTime() - 55 * 60_000), billedAt: new Date(p.at.getTime() - 4 * 60_000), closedAt: p.at }).where(eq(schema.horecaOrders.id, p.id));
    await db.update(schema.horecaOrderItems).set({ createdAt: new Date(p.at.getTime() - 54 * 60_000), updatedAt: new Date(p.at.getTime() - 20 * 60_000) }).where(eq(schema.horecaOrderItems.orderId, p.id));
    await db.update(schema.horecaFeedback).set({ createdAt: new Date(p.at.getTime() + 2 * 60_000) }).where(eq(schema.horecaFeedback.orderId, p.id));
  }
  for (const o of Object.values(open)) {
    await db.update(schema.horecaOrders).set({ createdAt: ago(o.min) }).where(eq(schema.horecaOrders.id, o.id));
    await db.update(schema.horecaOrderItems).set({ createdAt: ago(o.min - 0.5), updatedAt: ago(Math.max(1, o.min / 3)) }).where(eq(schema.horecaOrderItems.orderId, o.id));
  }
  await db.update(schema.horecaOrders).set({ billedAt: ago(3) }).where(eq(schema.horecaOrders.id, t8.order.id));
  await db.update(schema.horecaShifts).set({ openedAt: todayAt("08:15", 320) }).where(eq(schema.horecaShifts.projectId, pid));
  await db.update(schema.horecaCashMoves).set({ createdAt: todayAt("11:05", 280) }).where(eq(schema.horecaCashMoves.reason, "Change from the bank"));
  await db.update(schema.horecaCashMoves).set({ createdAt: todayAt("12:10", 270) }).where(eq(schema.horecaCashMoves.reason, "Ice and lemons from the market"));
  await db.update(schema.horecaEvents).set({ createdAt: todayAt("11:05", 280) }).where(sql`${schema.horecaEvents.projectId} = ${pid} and ${schema.horecaEvents.kind} in ('pay_in','pay_out')`);
  await db.update(schema.horecaBarCounts).set({ createdAt: new Date(`${istDate(-1)}T23:40:00+05:30`) }).where(eq(schema.horecaBarCounts.id, counted.count.id));
  await db.update(schema.horecaRequests).set({ createdAt: ago(4) }).where(eq(schema.horecaRequests.projectId, pid));
  const parked: [J, number][] = [[v1, 96], [v3, 140], [v4, 74], [v5, 210], [v6, 118], [v7, 52]];
  for (const [t, min] of parked) await db.update(schema.horecaValet).set({ parkedAt: ago(min), createdAt: ago(min) }).where(eq(schema.horecaValet.id, t.id));
  await db.update(schema.horecaValet).set({ requestedAt: ago(3) }).where(eq(schema.horecaValet.id, v6.id));
  await db.update(schema.horecaValet).set({ readyAt: ago(2) }).where(eq(schema.horecaValet.id, v3.id));
  await db.update(schema.horecaValet).set({ parkedAt: ago(260), deliveredAt: ago(95) }).where(eq(schema.horecaValet.id, v2.id));
  // A week of pours, so "days left" reads true.
  await db.update(schema.horecaBarMoves).set({ createdAt: ago(3 * 1440) }).where(sql`${schema.horecaBarMoves.projectId} = ${pid} and ${schema.horecaBarMoves.kind} = 'purchase'`);
  await db.update(schema.horecaStockMoves).set({ createdAt: ago(3 * 1440) }).where(sql`${schema.horecaStockMoves.projectId} = ${pid} and ${schema.horecaStockMoves.kind} = 'purchase'`);

  // ── Capture: the dashboard ──
  const base = `/projects/${pid}/horeca`;
  const asOperator = async (ctx: BrowserContext, who: { id: string; name: string; role: string } | null, locked = false) => {
    await ctx.addInitScript(
      ([key, op, lock]) => {
        try {
          if (op) sessionStorage.setItem(`${key}:operator`, op);
          else sessionStorage.removeItem(`${key}:operator`);
          if (lock) sessionStorage.setItem(`${key}:locked`, "1");
          else sessionStorage.removeItem(`${key}:locked`);
        } catch {
          /* ignore */
        }
      },
      [`horeca:${pid}`, who ? JSON.stringify(who) : "", locked] as const,
    );
  };
  const ctx = page.context();
  await asOperator(ctx, { id: asha, name: "Asha Rao", role: "owner" });
  const go = async (p: Page, path: string, ready?: string | RegExp) => {
    await p.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await p.waitForLoadState("networkidle").catch(() => {});
    if (ready) await expect(p.getByText(ready).first()).toBeVisible({ timeout: 60_000 });
    await p.getByRole("button", { name: /^(Got it|Not now|Skip)$/ }).first().click({ timeout: 1500 }).catch(() => {});
  };
  const dialog = (p: Page) => p.locator("dialog[open]").last();
  /** A dialog on its own (no focus ring); `bottom` keeps just its last N CSS pixels. */
  const panel = async (p: Page, name: string, loc = dialog(p), bottom?: number) => {
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await p.waitForTimeout(700);
    const path = `public/marketing/${DIR}/${name}.jpg`;
    if (!bottom) return void (await loc.screenshot({ path, type: "jpeg", quality: 85 }));
    const b = (await loc.boundingBox())!;
    await p.screenshot({ path, type: "jpeg", quality: 85, clip: { x: b.x, y: b.y + b.height - bottom, width: b.width, height: bottom } });
  };

  await go(page, "", "Sales today");
  await shoot(page, DIR, "overview", { settle: 2500 });

  await go(page, "/floor", "Takeaway / counter");
  await page.goto(`${base}/floor/${open["T5"]!.id}`);
  await expect(page.getByText("Wants the bill").first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, DIR, "floor", { settle: 2000 });

  // Settling T8's printed bill.
  await page.goto(`${base}/floor/${open["T8"]!.id}`);
  await page.getByRole("button", { name: /^Settle ₹/ }).click();
  await expect(dialog(page)).toBeVisible();
  await panel(page, "settle-panel");
  await page.keyboard.press("Escape");

  await go(page, "/kitchen", "All stations");
  await shoot(page, DIR, "kitchen", { settle: 2000 });

  await go(page, "/reservations", "Kavya Iyer");
  await shoot(page, DIR, "reservations");

  await go(page, "/menu", "Butter chicken");
  await shoot(page, DIR, "menu", { settle: 2500 });
  await page.getByRole("button", { name: "Actions for Butter chicken" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(/food cost 20\.5%/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await panel(page, "menu-item-panel");
  await dialog(page).locator(".overflow-y-auto").first().evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await panel(page, "recipe-panel", dialog(page), 513);
  await page.keyboard.press("Escape");

  await go(page, "/qr", "Tables & QR codes");
  await shoot(page, DIR, "qr", { settle: 2000 });
  await page.getByRole("tab", { name: "QR menu options" }).click();
  await page.waitForTimeout(3500);
  await shoot(page, DIR, "qr-design", { settle: 2000 });

  await go(page, "/inventory", "Butter");
  await shoot(page, DIR, "stock");
  await page.getByRole("tab", { name: "Food cost" }).click();
  await expect(page.getByText(/Average food cost/).first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, DIR, "food-cost");

  await go(page, "/bar", "Bombay Sapphire");
  await shoot(page, DIR, "bar");
  await page.getByRole("tab", { name: "Counts & variance" }).click();
  await expect(page.getByText(/Closing count/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(/Closing count/).first().click();
  await expect(page.getByText("Johnnie Walker Black Label").first()).toBeVisible();
  await shoot(page, DIR, "bar-counts");

  await go(page, "/rooms", "Occupancy");
  await expect(page.getByText(/Rohan & Meera/).first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, DIR, "rooms", { settle: 2000 });
  await page.getByRole("tab", { name: "Housekeeping" }).click();
  await expect(page.getByText("To inspect").first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, DIR, "housekeeping");
  await page.goto(`${base}/rooms/${b301}`);
  await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
  await expect(dialog(page).getByText("Balance due")).toBeVisible();
  await panel(page, "folio-panel");

  await go(page, "/valet", "Guest booking page");
  await shoot(page, DIR, "valet");

  await go(page, "/guests", "Farah Khan");
  await shoot(page, DIR, "guests");

  await go(page, "/till", "Cash expected");
  await shoot(page, DIR, "till");

  await go(page, "/reports", "Busiest hours");
  await shoot(page, DIR, "reports", { settle: 2500 });

  await go(page, "/settings", "Venue & bills");
  await page.getByRole("tab", { name: "Staff & security" }).click();
  await expect(page.getByText("Approver").first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, DIR, "staff");

  // ── POS: table T4 for Priya, then payment ──
  await go(page, "/pos", "Choose a table");
  await page.getByText("Choose a table").click();
  await dialog(page).getByRole("button", { name: /^T4\b/ }).click();
  await page.getByRole("button", { name: "More covers" }).click();
  await page.getByRole("button", { name: "More covers" }).click();
  const tile = (name: string) => page.locator('section[aria-label="Dishes"] button').filter({ has: page.locator("span.line-clamp-2", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
  const pickOpts = async (opts: string[]) => {
    for (const o of opts) await dialog(page).getByRole("button", { name: new RegExp(`^${o}`) }).click();
    await dialog(page).getByRole("button", { name: /^Add · / }).click();
  };
  await tile("Butter chicken").click();
  await pickOpts(["Mild", "Full"]);
  await tile("Dal makhani").click();
  await pickOpts(["Cheese"]);
  await tile("Garlic naan").click();
  await tile("Garlic naan").click();
  await tile("Butter naan").click();
  await tile("Saffron House thali").click();
  await tile("Classic cold coffee").click();
  await page.getByRole("button", { name: "Customer" }).click();
  await dialog(page).getByLabel("Phone").fill("9820012345");
  await expect(dialog(page).getByText(/Welcome back/)).toBeVisible({ timeout: 15_000 });
  await panel(page, "pos-customer-panel");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await page.mouse.move(10, 890);
  await shoot(page, DIR, "pos", { settle: 1500 });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Pay ₹/ })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(dialog(page)).toBeVisible();
  await shoot(page, DIR, "pos-pay", { settle: 1200 });
  await panel(page, "pos-pay-panel");
  await page.keyboard.press("Escape");

  // Priya's card, now with tonight's open order on T4 as well.
  const priya = (await h<{ guests: { id: string; phone: string }[] }>("GET", "guests?q=9820012345")).guests[0]!;
  await page.goto(`${base}/guests/${priya.id}`);
  await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
  await panel(page, "guest-panel");

  // ── Lock screen and manager approval (a waiter at the till) ──
  {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", storageState: await ctx.storageState() });
    await asOperator(c2, null, true);
    c2.setDefaultNavigationTimeout(180_000);
    const p2 = await c2.newPage();
    await p2.goto(base);
    await expect(p2.getByText("Who's using the till?")).toBeVisible({ timeout: 30_000 });
    await shoot(p2, DIR, "lock", { settle: 1500 });
    await c2.close();
  }
  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", storageState: await ctx.storageState() });
    await asOperator(c3, { id: imran, name: "Imran", role: "waiter" });
    c3.setDefaultNavigationTimeout(180_000);
    const p3 = await c3.newPage();
    await p3.goto(`${base}/floor/${open["T5"]!.id}`);
    await expect(p3.getByText("Mutton seekh kebab").first()).toBeVisible({ timeout: 30_000 });
    await p3.getByRole("button", { name: /Update/ }).first().click();
    await p3.getByRole("menuitem", { name: "Cancel item" }).click();
    await dialog(p3).getByRole("button", { name: "Wrong item entered" }).click();
    await dialog(p3).getByRole("button", { name: "Cancel it" }).click();
    const prompt = p3.locator('dialog[aria-label="Manager approval"]');
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    // Only the PIN pad over the floor (the reason dialog underneath shows through its glass).
    await p3.addStyleTag({ content: 'dialog[open]:not([aria-label="Manager approval"]){visibility:hidden!important}' });
    await p3.keyboard.press("4");
    await p3.keyboard.press("3");
    await p3.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await shoot(p3, DIR, "approval", { settle: 1200 });
    await panel(p3, "approval-panel", prompt.locator("> div"));
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await c3.close();
  }

  // ── Capture: the guest's phone ──
  await phoneShots(browser, tok("P6"), v6.token as string);
});

async function phoneShots(browser: Browser, tableToken: string, valetToken: string) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", extraHTTPHeaders: { "x-forwarded-for": ip() } });
  ctx.setDefaultNavigationTimeout(180_000);
  const p = await ctx.newPage();
  await p.goto(`/t/${tableToken}`);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(1500);
  await shoot(p, DIR, "phone-menu", { settle: 1500 });

  // Choosing options for butter chicken.
  await p.locator('.tabs a[href*="Mains"], .tabs a').filter({ hasText: /^Mains$/ }).first().click();
  await p.waitForTimeout(900);
  const bcAdd = p.locator("article.item").filter({ hasText: "Butter chicken" }).locator("[data-add]");
  await bcAdd.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -260));
  await p.waitForTimeout(400);
  await bcAdd.click();
  const sheet = p.locator("#item-panel");
  await expect(sheet).toBeVisible();
  for (const label of ["Mild", "Half"]) {
    const radio = sheet.locator("label").filter({ hasText: new RegExp(`^\\s*${label}`) }).locator("input");
    if (!(await radio.isChecked().catch(() => true))) await radio.check({ force: true });
  }
  await shoot(p, DIR, "phone-addons", { settle: 1200 });

  // Add it, plus a cold coffee and two garlic naan, and place the order.
  await p.locator("#it-add").click();
  await p.waitForTimeout(500);
  for (const name of ["Classic cold coffee", "Garlic naan", "Garlic naan"]) {
    await p.locator("article.item").filter({ hasText: name }).first().locator("[data-add]").click();
    await p.waitForTimeout(300);
    await p.locator("#it-add").click();
    await p.waitForTimeout(400);
  }
  await p.locator("#cartbar").click();
  await p.locator("#place").click();
  await expect(p.locator("#track.on")).toBeVisible({ timeout: 20_000 });
  await p.waitForTimeout(3200); // the toast fades
  await p.locator("#track").click();
  await expect(p.locator("#status-panel")).toBeVisible();
  await shoot(p, DIR, "phone-track", { settle: 1500 });

  // The valet ticket after "Bring my car".
  await p.goto(`/v/${valetToken}`);
  await shoot(p, DIR, "phone-valet", { settle: 1000 });
  await ctx.close();
}
