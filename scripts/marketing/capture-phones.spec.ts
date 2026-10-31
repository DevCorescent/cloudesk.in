// Real phone screenshots for the homepage "On your phone" deck and the hero
// slider (public/marketing/phones/<feature>.jpg, 402×874 @3x). One demo owner,
// Asha Mehra of Asha's Studio, gets a spa site (Still Waters Spa), a bakery
// store (The Bread Room), a restaurant (Saffron House) and a finance book
// (Atelier Nine Interiors), all filled through the app's own APIs; then each
// screen is captured on an iPhone-sized, touch-enabled browser.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-phones
import { expect, test, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { ip, shoot } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const O = { origin: BASE };
const U = (id: string, w = 1200) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;
const isoDay = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const pick = <X,>(xs: X[], i: number) => xs[i % xs.length]!;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

type Api = <R = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<R>;
const apiFor = (req: APIRequestContext): Api => async (method, path, body) => {
  const res = await req.fetch(`/api/v1/${path}`, { method, data: body, headers: O, timeout: 180_000 });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as never;
};

test.describe.configure({ mode: "serial" });

test("phone screens for the homepage", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE, colorScheme: "light", extraHTTPHeaders: { "x-forwarded-for": ip() } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const req = page.request;
  const api = apiFor(req);

  // ── The owner ──
  const r = await req.post("/api/v1/auth/signup", { data: { name: "Asha Mehra", email: `asha.${T}@ashasstudio-demo.in`, password: PW, orgName: "Asha's Studio" }, headers: O });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O });
  const me = await (await req.get("/api/v1/auth/me")).json();
  const orgId = me.organizations[0].id as string;
  const orgSlug = (me.organizations[0].slug as string | undefined) ?? "";
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  const newProject = async (templateId: string, name: string) => (await api<{ project: { id: string; slug?: string } }>("POST", `orgs/${orgId}/projects`, { templateId, name })).project;
  const deploy = async (pid: string) => (await api<{ deployment: { id: string; status?: string } }>("POST", `projects/${pid}/deployments`, { environment: "production" })).deployment;

  // ── Still Waters Spa: site, bookings, data, automations, chatbot, review, domain, growth ──
  const spaP = await newProject("spa", "Still Waters Spa");
  const spa = spaP.id;
  const S = (p: string) => `projects/${spa}/${p}`;
  await api("POST", S("store/setup"), { name: "Still Waters Spa", currency: "INR", country: "IN", region: "Maharashtra", email: "hello@stillwaters.example" });
  await api("PUT", S("store/booking-settings"), { timezone: "Asia/Kolkata", hours: { tue: [["10:00", "19:00"]], wed: [["10:00", "19:00"]], thu: [["10:00", "19:00"]], fri: [["10:00", "20:00"]], sat: [["09:00", "20:00"]], sun: [["09:00", "17:00"]] }, slotStepMin: 30, minNoticeHours: 2, maxDaysAhead: 45, closedDates: [], cancelHours: 24 });
  const services = [
    { name: "Signature deep-tissue massage", description: "Slow, firm pressure for tight shoulders and back. Includes a warm towel ritual.", durationMin: 60, price: 350000 },
    { name: "Aromatherapy facial", description: "A calming facial with essential oils, steam and a hydrating mask.", durationMin: 45, price: 280000 },
    { name: "Hot stone therapy", description: "Heated basalt stones melt away tension. Bring nothing — we have robes.", durationMin: 90, price: 520000 },
    { name: "Couples retreat", description: "Side-by-side massages in our garden suite, with herbal tea after.", durationMin: 90, price: 980000, capacity: 2 },
    { name: "Express foot ritual", description: "A quick reflexology reset between meetings.", durationMin: 30, price: 120000 },
  ];
  const svcIds: string[] = [];
  for (const [i, s] of services.entries()) {
    const res = await api<{ service?: { id: string }; id?: string }>("POST", S("store/booking-services"), { capacity: 1, bufferMin: 15, payment: "none", active: true, sort: i, ...s });
    svcIds.push((res.service?.id ?? res.id)!);
  }

  // Data tables.
  await api("POST", S("data/tables"), { name: "Memberships", slug: "memberships", description: "Monthly wellness members and their plans", fields: [
    { key: "full_name", name: "Full name", type: "text", required: true },
    { key: "email", name: "Email", type: "email" },
    { key: "plan", name: "Plan", type: "select", options: ["Calm", "Restore", "Ritual"] },
    { key: "visits_left", name: "Visits left", type: "number" },
    { key: "renews_on", name: "Renews on", type: "date" },
    { key: "auto_renew", name: "Auto-renew", type: "boolean" },
  ] });
  const members = ([["Ananya Iyer", "Ritual", 4, 8, true], ["Rohan Kapoor", "Restore", 2, 15, true], ["Meera Pillai", "Calm", 1, 3, false], ["Kabir Sethi", "Ritual", 6, 23, true], ["Tara Menon", "Restore", 3, 6, true], ["Vikram Rao", "Calm", 0, 1, false], ["Isha Banerjee", "Ritual", 5, 27, true], ["Dev Malhotra", "Restore", 2, 12, false], ["Nisha Verma", "Calm", 1, 19, true]] as const)
    .map(([n, plan, v, d, a]) => ({ full_name: n, email: `${n.toLowerCase().replace(" ", ".")}@gmail.com`, plan, visits_left: v, renews_on: isoDay(d), auto_renew: a }));
  await api("POST", S("data/api/memberships"), { rows: members });
  await api("POST", S("data/tables"), { name: "Gift cards", slug: "gift-cards", description: "Gift cards sold at the front desk", fields: [
    { key: "code", name: "Code", type: "text", required: true }, { key: "amount", name: "Amount (₹)", type: "number" }, { key: "buyer", name: "Bought by", type: "text" }, { key: "redeemed", name: "Redeemed", type: "boolean" },
  ] });
  await api("POST", S("data/api/gift-cards"), { rows: [{ code: "SW-4821", amount: 5000, buyer: "Priya S.", redeemed: false }, { code: "SW-4822", amount: 3500, buyer: "Arjun M.", redeemed: true }, { code: "SW-4823", amount: 10000, buyer: "Leela K.", redeemed: false }] });

  // Automations.
  const owner = `asha.${T}@ashasstudio-demo.in`;
  const flows = [
    { name: "New enquiry → reply within the hour", trigger: { type: "form_submitted", config: { formId: "" } }, steps: [
      { id: "s1", type: "condition", config: { left: "{{trigger.data.email}}", op: "exists", right: "" } },
      { id: "s2", type: "send_email", config: { to: "{{trigger.data.email}}", subject: "Thanks for getting in touch", body: "Hi {{trigger.data.name}}, we've got your message and will reply within the hour during opening times." } },
      { id: "s3", type: "send_email", config: { to: owner, subject: "New enquiry from {{trigger.data.name}}", body: "{{trigger.data.message}}" } } ] },
    { name: "Monday morning — week ahead", trigger: { type: "schedule", config: { cron: "0 9 * * 1", timezone: "Asia/Kolkata" } }, steps: [
      { id: "s1", type: "send_email", config: { to: owner, subject: "This week at Still Waters", body: "Check the bookings calendar and confirm therapist rotas for the week." } } ] },
    { name: "Booking confirmed → welcome note", trigger: { type: "booking_confirmed", config: {} }, steps: [
      { id: "s1", type: "send_email", config: { to: "{{trigger.email}}", subject: "See you soon, {{trigger.name}}", body: "Your {{trigger.service}} is booked. Arrive 10 minutes early — robes, slippers and herbal tea are on us." } },
      { id: "s2", type: "delay", config: { amount: 1, unit: "days" } },
      { id: "s3", type: "send_email", config: { to: "{{trigger.email}}", subject: "Tomorrow at Still Waters", body: "A gentle reminder of your {{trigger.service}}. Reply to this email if you need to move it." } } ] },
    { name: "VIP follow-up after a couples retreat", trigger: { type: "booking_confirmed", config: {} }, steps: [
      { id: "s1", type: "condition", config: { left: "{{trigger.service}}", op: "contains", right: "Couples" } },
      { id: "s2", type: "delay", config: { amount: 2, unit: "days" } },
      { id: "s3", type: "send_email", config: { to: "{{trigger.email}}", subject: "How was your retreat?", body: "We'd love to hear how it went — reply to this email any time." } } ] },
  ];
  for (const f of flows) {
    const w = await api<{ workflow?: { id: string }; id?: string }>("POST", S("automations"), f);
    const id = w.workflow?.id ?? w.id;
    if (id) await api("POST", S(`automations/${id}/enable`)).catch(() => {});
  }

  // Chatbot.
  await api("PUT", S("chatbot"), { enabled: true, name: "Mira", greeting: "Hi, I'm Mira 🌿 Ask me about treatments, prices or opening hours.", instructions: "Be warm and brief. Suggest booking online when someone asks about availability.", handoffEmail: "frontdesk@stillwaters.example", showLauncher: true });
  await api("POST", S("chatbot/sources"), { kind: "text", title: "Spa FAQ", content: "Opening hours: Tuesday to Thursday 10am–7pm, Friday 10am–8pm, Saturday 9am–8pm, Sunday 9am–5pm. Closed on Mondays.\nParking: free parking for guests in the basement.\nWhat to bring: nothing. We provide robes, slippers, towels and lockers.\nCancellations: cancel online up to 24 hours before your booking at no charge.\nGift cards: available at the front desk in any amount, valid for 12 months." }).catch(() => {});
  await api("POST", S("chatbot/sources"), { kind: "text", title: "Treatment guide", content: "Signature deep-tissue massage (60 min, ₹3,500): firm pressure for tight shoulders and back.\nAromatherapy facial (45 min, ₹2,800).\nHot stone therapy (90 min, ₹5,200).\nExpress foot ritual (30 min, ₹1,200)." }).catch(() => {});

  // Publish, then a client review link with comments, a custom domain and a running A/B test.
  await deploy(spa);
  const site = await api<{ content?: string; file?: { content: string } }>("GET", S("file?path=site/site.json"));
  const doc = JSON.parse(site.content ?? site.file?.content ?? "{}") as { pages: { id: string; sections: { id: string; type: string; props?: Record<string, unknown> }[] }[] };
  const home = doc.pages[0]!;
  const sec = (t: string) => home.sections.find((s) => s.type === t)?.id ?? home.sections[0]!.id;
  const c1 = await api<{ comment?: { id: string } }>("POST", S("collab/comments"), { pageId: home.id, sectionId: sec("hero"), body: "Can we try a warmer photo here? This one feels a bit cold for an evening visit.", parentId: null });
  await api("POST", S("collab/comments"), { pageId: home.id, sectionId: sec("hero"), body: "Good call — swapping in the garden suite shot from last week's shoot.", parentId: c1.comment?.id ?? null });
  await api("POST", S("collab/comments"), { pageId: home.id, sectionId: sec("features"), body: "Prices on the treatments list need the new Diwali rates before Friday.", parentId: null });
  const review = await api<{ url: string }>("POST", S("collab/review-links"), { label: "Owner review — Diwali update", days: 14 });
  // A custom domain waiting for DNS (the first that isn't already claimed on this dev server).
  for (const hostname of ["www.stillwatersspa.in", "www.stillwaters-spa.in", "www.stillwaterspune.in", "www.stillwatersspa.co.in", `www.stillwaters${T.slice(-4)}.in`]) {
    if (await api("POST", S("domains"), { hostname }).then(() => true, () => false)) break;
  }
  const hero = home.sections.find((s) => s.type === "hero")!;
  const started = await api<{ experiment: { id: string } }>("POST", S("growth/tests"), { path: "/", sectionId: hero.id, title: `Main button: “${String(hero.props?.primaryLabel ?? "Book an appointment")}” vs “Find your treatment”`, hypothesis: "Inviting people to explore treatments first gets more first-time visitors to start a booking.", metric: "submit", change: { props: { primaryLabel: "Find your treatment" } }, publish: true });
  const today = new Date().toISOString().slice(0, 10);
  const key = `g:${started.experiment.id}`;
  await db.insert(schema.siteStats).values([
    { projectId: spa, day: today, path: "/", kind: "view", experiment: key, variant: "A", count: 131 },
    { projectId: spa, day: today, path: "/", kind: "submit", experiment: key, variant: "A", count: 9 },
    { projectId: spa, day: today, path: "/", kind: "view", experiment: key, variant: "B", count: 114 },
    { projectId: spa, day: today, path: "/", kind: "submit", experiment: key, variant: "B", count: 8 },
  ] as never).onConflictDoNothing();

  // ── The Bread Room: bakery store, POS products, a sign-up pop-up and a bar ──
  const bread = (await newProject("store", "The Bread Room")).id;
  const B = (p: string) => `projects/${bread}/store/${p}`;
  await api("POST", B("setup"), { name: "The Bread Room", currency: "INR", country: "IN", region: "Maharashtra", email: "orders@thebreadroom.example" });
  for (const [title, inr, photo, stock] of ([
    ["Cappuccino", 160, "1509042239860-f550ce710b93", 24],
    ["Iced latte", 190, "1541167760496-1628856ab772", 27],
    ["Filter coffee powder, 250 g", 320, "1511920170033-f8396924c348", 30],
    ["Butter croissant", 120, "1555507036-ab1f4038808a", 18],
    ["Country sourdough loaf", 249, "1509440159596-0249088772ff", 27],
    ["Mint frosting cupcakes", 399, "1486427944299-d1955d23e34d", 13],
    ["House espresso beans", 599, "1587734195503-904fca47e0e9", 25],
  ] as [string, number, string, number][]).reverse()) await api("POST", B("products"), { title, status: "active", images: [U(photo)], variants: [{ options: {}, price: inr * 100, stock }] });
  // The bakery design, applied after the real products so no samples are added.
  await api("POST", B("setup"), { name: "The Bread Room", currency: "INR", country: "IN", region: "Maharashtra", email: "orders@thebreadroom.example", template: "bakery", replaceDesign: true });
  await api("POST", B("discounts"), { code: "LOAF10", kind: "percent", value: 10 }).catch(() => {});
  await api("POST", `projects/${bread}/promotions`, { kind: "bar", name: "Delivery bar", enabled: true, config: { messages: ["Order by 8 pm for fresh next-morning delivery in Pune"], linkLabel: "Order now", linkHref: "/shop" } });
  await api("POST", `projects/${bread}/promotions`, { kind: "popup", name: "Welcome offer", enabled: true, config: { layout: "center", eyebrow: "Welcome", heading: "10% off your first loaf box", body: "Join our list for the weekly bake schedule and members-only treats.", action: "email", buttonLabel: "Unlock my discount", code: "LOAF10", successHeading: "You're in! Here's your code", successBody: "Use it at checkout.", trigger: { type: "delay", delay: 1 }, frequency: "always" } });
  const breadDep = await deploy(bread);

  // ── NOIR/DEPT: the storefront ──
  const noir = (await newProject("store", "NOIR DEPT")).id;
  await api("POST", `projects/${noir}/store/setup`, { name: "NOIR/DEPT", currency: "INR", country: "IN", region: "Karnataka", email: "hello@noirdept.example", template: "noir", replaceDesign: true });
  const noirDep = await deploy(noir);

  // ── Saffron House: a restaurant's QR menu ──
  const saffron = (await newProject("blank", "Saffron House")).id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed responses vary per endpoint
  const H = (m: string, p: string, d?: unknown) => api<Record<string, any>>(m, `projects/${saffron}/horeca/${p}`, d);
  await H("PUT", "venue", { name: "Saffron House", kind: "restaurant", taxBps: 500, serviceChargeBps: 0, settings: { qr: { accent: "#b4532a", theme: "warm", cover: U("1517248135467-4c7edcad34c4", 900), welcome: "Namaste! Order from your table — we'll bring it fresh from the tandoor." } } });
  const main = (await H("POST", "areas", { name: "Main dining", sort: 0 })).area.id;
  const terrace = (await H("POST", "areas", { name: "Terrace", sort: 1 })).area.id;
  await H("POST", "tables/bulk", { areaId: main, prefix: "T", from: 1, count: 10, seats: 4 });
  await H("POST", "tables/bulk", { areaId: terrace, prefix: "P", from: 1, count: 6, seats: 2 });
  const cat = async (name: string, station: string, sort: number) => (await H("POST", "categories", { name, station, sort })).category.id;
  const C = { small: await cat("Small plates", "tandoor", 0), mains: await cat("Mains", "kitchen", 1), rice: await cat("Biryani & rice", "kitchen", 2), breads: await cat("Breads", "tandoor", 3), dessert: await cat("Desserts", "desserts", 4) };
  const item = (c: keyof typeof C, name: string, price: number, o: Record<string, unknown> & { image?: string } = {}) => H("POST", "menu-items", { categoryId: C[c], name, price, diet: "veg", ...o, image: o.image ? U(o.image, 900) : "" });
  await item("small", "Butter pav bhaji", 22000, { image: "1606491956689-2ea866880c84", description: "Mumbai-style mashed vegetable curry with buttered buns.", spice: 1, prepMinutes: 12, sort: 0 });
  await item("small", "Mutton seekh kebab", 42000, { image: "1599487488170-d11ec9c172f0", description: "Minced lamb with mint and spices, cooked on skewers in the tandoor.", diet: "nonveg", spice: 2, prepMinutes: 20, sort: 1 });
  await item("small", "Paneer tikka sizzler", 38000, { image: "1567188040759-fb8a883dc6d8", description: "Charred cottage cheese, peppers and onions on a smoking hot plate.", spice: 2, prepMinutes: 18, tags: ["Bestseller"], sort: 2 });
  await item("small", "Punjabi samosa (2 pcs)", 18000, { image: "1601050690597-df0568f70950", description: "Crisp pastry, spiced potato and peas, mint and tamarind chutney.", spice: 1, prepMinutes: 10, sort: 3 });
  await item("mains", "Butter chicken", 49000, { image: "1565557623262-b51c2513a641", description: "Tandoori chicken in a silky tomato, butter and fenugreek gravy.", diet: "nonveg", spice: 1, prepMinutes: 20, tags: ["Signature"] });
  await item("mains", "Dal makhani", 32000, { image: "1585937421612-70a008356fbe", description: "Black lentils slow-cooked overnight with butter and cream.", prepMinutes: 12, tags: ["Bestseller"] });
  await item("mains", "Kerala fish curry", 52000, { image: "1574484284002-952d92456975", description: "Seer fish in coconut milk with kokum and curry leaves.", diet: "nonveg", spice: 2, prepMinutes: 22 });
  await item("rice", "Hyderabadi chicken biryani", 46000, { image: "1589302168068-964664d93dc0", description: "Dum-cooked basmati and chicken, saffron and fried onions, with raita.", diet: "nonveg", spice: 2, prepMinutes: 25, tags: ["Bestseller"] });
  await item("rice", "Subz pulao", 32000, { image: "1563379091339-03b21ab4a4f8", description: "Fragrant basmati with seasonal vegetables and whole spices.", prepMinutes: 15 });
  await item("breads", "Butter naan", 7000, { prepMinutes: 6 });
  await item("breads", "Garlic naan", 8000, { prepMinutes: 6 });
  await item("dessert", "Gulab jamun with rabri", 16000, { description: "Warm, syrupy dumplings over chilled rabri.", prepMinutes: 5 });
  const tables = (await H("GET", "tables")).tables as { name: string; url: string }[];
  const p6 = tables.find((t) => t.name === "P6")!.url;

  // ── Atelier Nine Interiors: a finance book with a year of invoices ──
  const [book] = await db.insert(schema.financeBooks).values({ orgId, name: "Atelier Nine Interiors" } as typeof schema.financeBooks.$inferInsert).returning();
  await db.insert(schema.invoiceOwners).values({ id: book!.id, bookId: book!.id });
  const clients = ["Lodha Developers", "Taj West End", "Blue Tokai Coffee", "Prestige Estates", "Soho House Mumbai", "The Leela Palace", "Godrej Properties", "Third Wave Café"];
  const docs = [];
  for (let i = 0; i < 30; i++) {
    const age = Math.round((i / 30) * 190) + (i % 3) * 3;
    const total = (40 + ((i * 37) % 90)) * 1_000_00 + (i % 4) * 2_500_00;
    const paid = i % 6 === 1 ? 0 : i % 8 === 5 ? Math.round(total / 2) : total;
    docs.push({ projectId: book!.id, type: "invoice", number: `AN/26-27/${String(101 + i).padStart(4, "0")}`, status: paid >= total ? "paid" : "sent", client: { name: pick(clients, i) }, issueDate: isoDay(-age), dueDate: isoDay(-age + 15), currency: "INR", lines: [], adjustments: [], taxMode: "none", total, amountPaid: paid, shareToken: `an-${T}-${i}` });
  }
  const inserted = await db.insert(schema.invoiceDocuments).values(docs as never).returning();
  await db.insert(schema.invoicePayments).values(inserted.filter((d) => Number(d.amountPaid) > 0).map((d) => ({ projectId: book!.id, documentId: d.id, amount: Number(d.amountPaid), method: "upi", paidOn: new Date(Date.parse(String(d.issueDate)) + 9 * 86_400_000).toISOString().slice(0, 10) })) as never);

  // ── Where the live spa site is ──
  const orgs = await (await req.get("/api/v1/orgs")).json().catch(() => ({}));
  const slugOrg = orgSlug || (orgs.organizations ?? orgs.orgs ?? []).find((o: { id: string }) => o.id === orgId)?.slug;
  const spaInfo = await api<{ project: { slug: string } }>("GET", `projects/${spa}`);
  const live = `/s/${slugOrg}/${spaInfo.project.slug}`;

  // ── Captures ──
  const go = async (path: string, settle = 1500) => {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(settle);
  };
  const snap = async (name: string, settle?: number) => {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await shoot(page, "phones", name, { settle });
  };

  // Launch: naming a new store and choosing what it sells.
  await go("/launch?kind=store", 2000);
  await page.getByPlaceholder("Saanjh Studio").fill("Kora Ceramics");
  await page.getByPlaceholder(/Handwoven/).fill("Small-batch stoneware from Pondicherry.");
  await page.getByRole("button", { name: /Kiln ceramics studio/ }).first().click().catch(() => {});
  await page.locator(":focus").evaluate((el) => (el as HTMLElement).blur()).catch(() => {});
  await snap("launch");

  // The spa site, and booking a massage on a Saturday.
  await go(`${live}/`, 2500);
  await expect(page.getByText("Still Waters Spa").first()).toBeVisible();
  await snap("website-builder");
  // The next open day (closed Mondays), so it's selected near the start of the day strip.
  let open = 1;
  while (new Date(Date.now() + open * 86_400_000).getDay() === 1) open++;
  await go(`${live}/book/${svcIds[0]}?date=${isoDay(open)}`, 2000);
  await snap("bookings");

  // Storefront and till.
  await go(`/sites/${noirDep.id}/`, 2500);
  await snap("online-store");
  await go(`/projects/${bread}/pos`, 2500);
  await expect(page.getByText("Country sourdough loaf").first()).toBeVisible();
  await snap("point-of-sale");

  // The guest QR menu at table P6.
  await go(p6, 1500);
  await expect(page.getByText("Butter pav bhaji").first()).toBeVisible();
  await snap("horeca");

  // Finance overview.
  await go(`/finance/${book!.id}`, 2500);
  await expect(page.getByText("Atelier Nine Interiors").first()).toBeVisible();
  await snap("invoicing");

  // The bakery's sign-up pop-up.
  await go(`/sites/${breadDep.id}/`, 1000);
  await expect(page.locator(".ccp-pop")).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(800);
  await shoot(page, "phones", "promotions", { settle: 600 });

  // Growth, deployments, IDE, automations, chatbot, data.
  await go(`/projects/${spa}/growth`, 2000);
  await expect(page.getByText("Find your treatment").first()).toBeVisible();
  await snap("growth");
  await go(`/projects/${spa}/deployments`, 2000);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) if (el.children.length < 6 && el.textContent?.startsWith("Platform DNS target not configured")) { (el.closest("div.mt-3") ?? el).remove(); break; }
  });
  await snap("domains");
  await go(`/projects/${spa}/ide`, 3000);
  await page.getByText("site.json", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await snap("ai-ide");
  await go(`/projects/${spa}/automations`, 2000);
  await snap("automations");
  await go(`/projects/${spa}/chatbot`, 2000);
  await snap("chatbot");
  await go(`/projects/${spa}/data`, 2000);
  await expect(page.getByText("Kabir Sethi").first()).toBeVisible();
  await snap("data");

  // The client review link.
  await go(new URL(review.url).pathname, 2500);
  await snap("collaboration");

  console.log("page errors:", errors);
  await ctx.close();
});
