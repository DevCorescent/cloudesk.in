// Real screenshots of the newest features for the landing page: the business
// dashboard, smart search, the pro builder (drag-and-drop, devices, connected
// sections), publishing to other hosts, and the guided onboarding. A demo
// café-and-homeware brand is created with a year of believable history.
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { MODULE_IDS } from "../../src/lib/workspace/modules";
import { shoot, phoneShots, asVisitor } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now() % 1_000_000;
const ORIGIN = { origin: "http://localhost:3000" };
const day = (k: number) => new Date(Date.now() + k * 86_400_000).toISOString().slice(0, 10);
const pick = <X,>(xs: X[], i: number) => xs[i % xs.length]!;

async function signUp(page: Page, name: string, email: string) {
  await asVisitor(page);
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/welcome$/);
}

/** A year of history across the modules the dashboard reads. */
async function seed(orgId: string, userId: string) {
  // Everything except bookkeeping (not set up in this demo), and a verified email.
  await db.update(schema.organizations).set({ name: "Saffron & Sage", industry: "retail", modules: MODULE_IDS.filter((m) => m !== "accounting") }).where(eq(schema.organizations.id, orgId));
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId));
  const clients = ["Taj West End", "Blue Tokai Coffee", "Nykaa Retail", "Third Wave Café", "FabIndia Lifestyle", "Good Earth Home", "Chumbak Design", "The Bombay Store"];
  const [book] = await db.insert(schema.financeBooks).values({ orgId, name: "Saffron & Sage Pvt Ltd" } as typeof schema.financeBooks.$inferInsert).returning();
  await db.insert(schema.invoiceOwners).values({ id: book!.id, bookId: book!.id });
  const docs = [];
  for (let i = 0; i < 34; i++) {
    const age = Math.round((i / 34) * 330) + (i % 3) * 4;
    const total = (18 + ((i * 37) % 70)) * 1_000_00 + (i % 5) * 2_500_00;
    const paid = i % 7 === 3 ? 0 : i % 9 === 4 ? Math.round(total / 2) : total;
    docs.push({ projectId: book!.id, type: "invoice", number: `SS-${(2400 + i).toString()}`, status: paid >= total ? "paid" : "sent", client: { name: pick(clients, i) }, issueDate: day(-age), dueDate: day(-age + 15), currency: "INR", lines: [], adjustments: [], taxMode: "none", total, amountPaid: paid, shareToken: `ss-${T}-${i}` });
  }
  const inserted = await db.insert(schema.invoiceDocuments).values(docs as never).returning();
  // Money received against them (what “collected” counts), a few days after issue.
  const pays = inserted.filter((d) => Number(d.amountPaid) > 0).map((d) => ({ projectId: book!.id, documentId: d.id, amount: Number(d.amountPaid), method: "upi", paidOn: new Date(Date.parse(String(d.issueDate)) + 6 * 86_400_000).toISOString().slice(0, 10) }));
  await db.insert(schema.invoicePayments).values(pays as never);
  // The same clients as contacts, so search finds them.
  await db.insert(schema.crmContacts).values(["Anika Bose · Taj West End", "Rahul Menon · Blue Tokai Coffee", "Sana Qureshi · Good Earth Home", "Dev Malhotra · Third Wave Café"].map((x) => { const [name, co] = x.split(" · "); return { orgId, name, email: `${name!.split(" ")[0]!.toLowerCase()}@${co!.toLowerCase().replace(/[^a-z]/g, "")}.in`, title: `Buyer, ${co}` }; }) as never);
  const [pl] = await db.insert(schema.crmPipelines).values({ orgId, name: "Wholesale" } as never).returning();
  const stages = await db.insert(schema.crmStages).values([["Lead", 1], ["Qualified", 2], ["Proposal", 3], ["Negotiation", 4]].map(([name, sort]) => ({ orgId, pipelineId: pl!.id, name, sort, kind: "open", rotDays: 10 })) as never).returning();
  const deals = ["Hotel amenities kit", "Café crockery refresh", "Festive gift hampers", "Corporate Diwali order", "Spa linen supply", "Restaurant chain tableware", "Boutique hotel décor", "Airline lounge cups", "Wedding favours", "Co-working pantry"];
  await db.insert(schema.crmDeals).values(deals.map((title, i) => ({ orgId, pipelineId: pl!.id, stageId: stages[i % stages.length]!.id, title, value: (40 + i * 23) * 1_000_00, status: i === 8 || i === 9 ? "won" : "open", closedAt: i >= 8 ? new Date() : null })) as never);
  const people = ["Aarav Mehta", "Diya Sharma", "Kabir Singh", "Ishita Nair", "Rohan Gupta", "Meher Kapoor", "Vikram Rao", "Tara Joshi"];
  const emps = await db.insert(schema.hrEmployees).values(people.map((name, i) => ({ orgId, empNo: `SS${101 + i}`, name, joinDate: day(-400 + i * 30) })) as never).returning();
  await db.insert(schema.hrAttendance).values(emps.slice(0, 6).map((e) => ({ orgId, employeeId: e.id, date: day(0), status: "present" })) as never);
  const [wh] = await db.insert(schema.invWarehouses).values({ orgId, name: "Indiranagar store" } as never).returning();
  const items = [["Brass diya set", 12, 450], ["Hand-painted mug", 40, 320], ["Linen table runner", 25, 890], ["Terracotta planter", 30, 540], ["Masala chai tin", 60, 260]] as const;
  for (const [name, reorder, cost] of items) {
    const [it] = await db.insert(schema.invItems).values({ orgId, name, reorderLevel: reorder, avgCost: cost * 100 } as never).returning();
    await db.insert(schema.invStock).values({ orgId, itemId: it!.id, warehouseId: wh!.id, qty: name === "Brass diya set" ? 6 : reorder * 3 } as never);
  }
  const [wp] = await db.insert(schema.workProjects).values({ orgId, code: "FEST", name: "Festive collection launch", status: "active" } as never).returning();
  await db.insert(schema.workTime).values([0, -1, -2, -3].map((k) => ({ orgId, projectId: wp!.id, userId, date: day(k), minutes: 150 + k * 10 })) as never);
  await db.insert(schema.hdTickets).values([
    { orgId, number: "T-1042", subject: "Order arrived with a chipped mug", status: "open", firstResponseDue: new Date(Date.now() - 2 * 3_600_000) },
    { orgId, number: "T-1043", subject: "Bulk order for hotel opening", status: "open", firstResponseDue: new Date(Date.now() + 5 * 3_600_000) },
    { orgId, number: "T-1039", subject: "Change delivery address", status: "resolved", resolvedAt: new Date() },
  ] as never);
}

async function seedOrders(projectId: string) {
  const rows = [];
  for (let i = 0; i < 46; i++) {
    const age = (i * 7) % 30;
    const total = (650 + ((i * 131) % 3200)) * 100;
    rows.push({ projectId, number: 1000 + i, accessKeyHash: `k${T}${i}`, email: `guest${i}@example.com`, shippingAddress: {}, currency: "INR", subtotal: total, total, taxIncluded: true, paymentMethod: i % 3 ? "upi" : "card", paidAt: new Date(Date.now() - age * 86_400_000 - i * 3_600_000), createdAt: new Date(Date.now() - age * 86_400_000 - i * 3_600_000), channel: i % 4 === 0 ? "pos" : "online", financialStatus: "paid", fulfillmentStatus: i < 3 ? "unfulfilled" : "delivered" });
  }
  await db.insert(schema.storeOrders).values(rows as never);
}

test("capture the newest features", async ({ page, browser }) => {
  // ── Onboarding (a fresh account, before anything is set up) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await signUp(p, "Meera Iyer", `meera.${T}@saffron-demo.in`);
    await p.getByRole("button", { name: "Let's begin" }).click();
    await p.getByLabel("Business name").fill("Saffron & Sage");
    await p.getByLabel(/What do you do/).fill("Handmade homeware and a café in Bengaluru — a shop, online orders, wholesale to hotels, 8 staff");
    await p.getByRole("radio", { name: /Home & décor/ }).click();
    await shoot(p, "onboarding", "industry");
    await p.getByRole("button", { name: "Continue" }).click();
    await p.getByRole("button", { name: "See my plan" }).click();
    await expect(p.getByRole("img", { name: "Preview of your dashboard" })).toBeVisible();
    await shoot(p, "onboarding", "plan", { settle: 1800 });
    await ctx.close();
  }

  // ── The demo business ──
  await signUp(page, "Meera Iyer", `meera.iyer.${T}@saffron-demo.in`);
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL(/\/home$/);
  const who = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = who.organizations[0].id as string;
  await seed(orgId, who.user.id);
  const created = await (await page.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "store", name: "Saffron & Sage" }, headers: ORIGIN })).json();
  const pid = created.project.id as string;
  await page.request.post(`/api/v1/projects/${pid}/deployments`, { data: { environment: "production" }, headers: ORIGIN });
  await seedOrders(pid);

  // Home: the business dashboard.
  await page.goto("/home");
  await expect(page.getByText("Saffron & Sage").first()).toBeVisible();
  await shoot(page, "home", "dashboard", { settle: 3000 });
  await page.getByRole("heading", { name: "Invoiced and collected" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 330);
  await shoot(page, "home", "charts", { settle: 1500 });
  await page.evaluate(() => window.scrollTo(0, 0));

  // Smart search.
  await page.getByRole("button", { name: "Search or run a command" }).click();
  const dlg = page.getByRole("dialog", { name: "Search" });
  await dlg.getByLabel("Search", { exact: true }).fill("ta");
  await shoot(page, "search", "palette", { settle: 1200 });
  await page.keyboard.press("Escape");

  // Builder: connected sections, drag from the gallery, phone styles.
  await page.goto(`/projects/${pid}/builder`);
  await expect(page.locator('iframe[title^="Canvas"]')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await shoot(page, "builder", "connect", { settle: 1800 });
  // Move a section with its handle, held mid-way so the "Move here" line shows.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("list", { name: /Sections on/ }).locator(":scope > li").nth(4).click();
  const handle = page.getByRole("button", { name: "Drag to move" });
  await expect(handle).toBeVisible();
  await page.waitForTimeout(1500);
  const hb = (await handle.boundingBox())!;
  const main = page.locator("main").last();
  const mb = (await main.boundingBox())!;
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width / 2, Math.max(mb.y + 260, hb.y - 300), { steps: 14 });
  await shoot(page, "builder", "dragdrop", { settle: 500 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  // Phone view with an element selected.
  await page.getByRole("radio", { name: /Mobile/ }).click();
  await page.waitForTimeout(1500);
  const h1 = page.frameLocator('iframe[title^="Canvas"]').locator("h1").first();
  await h1.click();
  await page.waitForTimeout(800);
  await h1.click();
  await shoot(page, "builder", "phone-styles", { settle: 1500 });
  await page.getByRole("radio", { name: /Desktop/ }).click();

  // Hosting & publishing: connect another host with a guided setup.
  await page.goto(`/projects/${pid}/deployments`);
  await expect(page.getByRole("heading", { name: "Hosting & publishing" })).toBeVisible();
  // Frame the hosting card at the top of the screen.
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent === "Hosting & publishing");
    window.scrollBy(0, (h?.getBoundingClientRect().top ?? 0) - 110);
  });
  await shoot(page, "builder", "publish", { settle: 1200 });
  // A close-up of just the hosting card.
  const cardBox = await page.getByRole("heading", { name: "Hosting & publishing" }).evaluate((h) => {
    const r = (h.closest("[class*='p-5']") ?? h.parentElement!).getBoundingClientRect();
    return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 };
  });
  await shoot(page, "builder", "publish-card", { clip: cardBox, settle: 300 });
  await page.getByTestId("host-cloudflare").getByRole("button", { name: /Connect/ }).click();
  await page.getByRole("button", { name: "I'm ready" }).click();
  await shoot(page, "builder", "publish-wizard", { settle: 800 });
  await phoneShots(page, [["/accounts", "accounting"]]);
});
