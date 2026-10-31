// Re-shoots the CRM, Finance and Projects screenshots for the marketing site
// (public/marketing/crm|finance|projects/) with the current app shell. One
// demo business — Asha's Studio, a Bengaluru interiors and events studio with
// three people — is signed up fresh on the local dev server and filled with
// believable data through the app's own APIs (memberships and e-mail
// verification go straight into the dev database, as in the other scripts).
//   npx playwright test -c scripts/marketing/pw.config.ts capture-suite-a
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { clean, ip, shoot, phoneShots } from "./shoot";

test.describe.configure({ mode: "serial" });

const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const O = { origin: BASE };
const PW = "correct-horse-42";
const T = Date.now().toString(36);
/** The public address shown instead of the dev server's in share links. */
const PUBLIC_HOST = "https://app.cloudesk.example";

// ── Dates (IST) ──
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const iso = (d: number) => new Date(istNow().getTime() + d * 86_400_000).toISOString().slice(0, 10);
const at = (d: number, h: number, m = 0) => new Date(`${iso(d)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`).toISOString();
/** Monday of the week `w` weeks back (0 = this week). */
const monday = (w: number) => {
  const dow = (istNow().getUTCDay() + 6) % 7;
  return -dow - 7 * w;
};

type Api = <R = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<R>;
const call = (req: APIRequestContext, prefix: string): Api => async (method, path, body) => {
  const res = await req.fetch(`${prefix}${path}`, { method, data: body, headers: O, timeout: 180_000 });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${prefix}${path} → ${res.status()}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as never;
};

async function signup(req: APIRequestContext, name: string, email: string, orgName?: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, ...(orgName ? { orgName } : {}) }, headers: { ...O, "x-forwarded-for": ip() }, timeout: 180_000 });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O, timeout: 180_000 });
  const me = await (await req.get("/api/v1/auth/me", { timeout: 180_000 })).json();
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  return { userId: me.user.id as string, orgId: me.organizations[0].id as string };
}

async function open(page: Page, path: string, ready?: string | RegExp) {
  await page.goto(path, { timeout: 180_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (ready) await expect(page.getByText(ready).first()).toBeVisible({ timeout: 150_000 });
  const skip = page.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
}

/** A JPEG of one element (a panel or dialog), at the page's 2× scale. */
async function snap(page: Page, el: Locator, dir: string, name: string, settle = 900) {
  await clean(page);
  await page.waitForTimeout(settle);
  const out = join(process.cwd(), "public", "marketing", dir);
  mkdirSync(out, { recursive: true });
  await el.screenshot({ path: join(out, `${name}.jpg`), type: "jpeg", quality: 82 });
}

/** Replaces the dev server's address in visible text and form fields with a public-looking one. */
async function hideLocalhost(page: Page) {
  await page.evaluate((host) => {
    const re = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g;
    const has = (s: string) => s.includes("localhost") || s.includes("127.0.0.1");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (has(n.nodeValue ?? "")) n.nodeValue = (n.nodeValue ?? "").replace(re, host);
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) if (has(el.value)) el.value = el.value.replace(re, host);
  }, PUBLIC_HOST);
}

// ── Shared state ──
let page: Page;
let orgId = "";
let api: Api; // Asha (owner)
let fin: Api; // Asha, on the finance book
const team: Record<"asha" | "priya" | "rohan", { userId: string; api: Api }> = {} as never;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }, info) => {
  info.setTimeout(2_400_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", extraHTTPHeaders: { "x-forwarded-for": ip() } });
  page = await ctx.newPage();
  const asha = await signup(page.request, "Asha Mehra", `asha.${T}@ashastudio-demo.in`, "Asha's Studio");
  orgId = asha.orgId;
  api = call(page.request, `/api/v1/orgs/${orgId}/`);
  team.asha = { userId: asha.userId, api };
  for (const [k, name] of [["priya", "Priya Nair"], ["rohan", "Rohan Mehta"]] as const) {
    const c = await (browser as Browser).newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip() } });
    const u = await signup(c.request, name, `${k}.${T}@ashastudio-demo.in`);
    await db.insert(schema.memberships).values({ orgId, userId: u.userId, role: "editor" } as never);
    team[k] = { userId: u.userId, api: call(c.request, `/api/v1/orgs/${orgId}/`) };
  }
  await seedFinance();
  await seedProjects();
  await seedCrm();
});

test.afterAll(async () => {
  await page?.context().close();
});

// ════════════════════════════════════════════════════════════════════════════
// Finance — Atelier Nine Interiors (the studio's interiors business)
// ════════════════════════════════════════════════════════════════════════════

type L = [name: string, hsn: string, unit: string, qty: number, rate: number];
const ITEMS = {
  consult: ["Interior design consultation", "998391", "hr", 3500],
  boards: ["Concept & mood boards", "998391", "room", 18000],
  supervision: ["Site supervision", "998391", "visit", 4500],
  renders: ["3D renders", "998391", "view", 6500],
  wardrobe: ["Wardrobe with sliding shutters", "9403", "pc", 95000],
  kitchen: ["Modular kitchen — L-shaped", "9403", "set", 240000],
  tv: ["TV unit with fluted panels", "9403", "pc", 68000],
  ceiling: ["False ceiling with cove lighting", "995414", "sq ft", 145],
  chairs: ["Upholstered dining chairs", "9401", "pc", 14500],
  desk: ["Reception desk — oak veneer", "9403", "pc", 135000],
  wallpaper: ["Wallpaper supply & fixing", "4814", "roll", 3800],
  styling: ["Lobby styling — art & accessories", "998391", "lot", 36068],
} as const;
const li = (k: keyof typeof ITEMS, qty: number, rate?: number): L => {
  const [n, h, u, r] = ITEMS[k];
  return [n, h, u, qty, rate ?? r];
};

const CLIENTS = {
  vikram: { name: "Vikram Rao", company: "", email: "vikram.rao@mail.example", phone: "+91 98480 22117", gstin: "", city: "Hyderabad", state: "Telangana", line1: "Road No. 36, Jubilee Hills", pin: "500033" },
  greenleaf: { name: "Karthik Shetty", company: "Greenleaf Co-working", email: "karthik@greenleafcowork.example", phone: "+91 99001 44312", gstin: "29AAGCG4821K1Z3", city: "Bengaluru", state: "Karnataka", line1: "80 Feet Road, Koramangala", pin: "560034" },
  verma: { name: "Anil Verma", company: "Verma Residences", email: "anil@vermaresidences.example", phone: "+91 98450 61209", gstin: "", city: "Bengaluru", state: "Karnataka", line1: "Prestige Shantiniketan, Whitefield", pin: "560048" },
  patel: { name: "Nisha Patel", company: "Patel Homes", email: "nisha@patelhomes.example", phone: "+91 98250 33410", gstin: "24AAKFP7712L1Z8", city: "Ahmedabad", state: "Gujarat", line1: "SG Highway", pin: "380054" },
  lotus: { name: "Rohan D'Souza", company: "Lotus Boutique Hotels", email: "rohan@lotushotels.example", phone: "+91 98220 70145", gstin: "30AABCL5618M1Z9", city: "Panaji", state: "Goa", line1: "Dona Paula Road", pin: "403004" },
  nambiar: { name: "Meera Nambiar", company: "Nambiar & Co", email: "meera@nambiar.example", phone: "+91 98470 00000", gstin: "32AAHFN2290Q1Z4", city: "Kochi", state: "Kerala", line1: "MG Road", pin: "682016" },
  bloom: { name: "Sana Sheikh", company: "Bloom Café", email: "sana@bloomcafe.example", phone: "+91 99005 81122", gstin: "29ABCFB9921R1Z6", city: "Bengaluru", state: "Karnataka", line1: "12th Main, Indiranagar", pin: "560038" },
  sharma: { name: "Dr. Kavita Sharma", company: "Sharma Dental Clinic", email: "kavita@sharmadental.example", phone: "+91 98861 22340", gstin: "29AAQPS3381H1Z2", city: "Bengaluru", state: "Karnataka", line1: "100 Feet Road, HAL 2nd Stage", pin: "560008" },
  desai: { name: "Rahul Desai", company: "Desai & Co. Chartered Accountants", email: "rahul@desaiandco.example", phone: "+91 98201 55678", gstin: "27AAFFD4410C1Z1", city: "Mumbai", state: "Maharashtra", line1: "Nariman Point", pin: "400021" },
} as const;
type Ck = keyof typeof CLIENTS;
const clientIds: Partial<Record<Ck, string>> = {};
const party = (k: Ck) => {
  const c = CLIENTS[k];
  return { name: c.company || c.name, company: c.company ? c.company : "", email: c.email, phone: "", gstin: c.gstin, billing: { line1: c.line1, line2: "", city: c.city, state: c.state, postalCode: "", country: "IN" }, shipping: null };
};

async function doc(type: "invoice" | "quote" | "proforma", k: Ck, day: number, lines: L[], opts: { issue?: boolean; due?: number; title?: string; reference?: string } = {}) {
  const c = CLIENTS[k];
  const r = await fin<{ document: { id: string; number: string; total: number; shareUrl: string } }>("POST", "documents", {
    issue: opts.issue ?? true,
    document: {
      type,
      clientId: clientIds[k] ?? null,
      client: party(k),
      issueDate: iso(day),
      dueDate: iso(day + (opts.due ?? (type === "quote" ? 30 : 15))),
      currency: "INR",
      lines: lines.map(([name, hsn, unit, quantity, rate], i) => ({ id: `l${i + 1}`, name, hsn, unit, quantity, rate: rate * 100, taxBps: 1800 })),
      taxMode: "gst",
      placeOfSupply: c.state,
      title: opts.title ?? "",
      reference: opts.reference ?? "",
    },
  });
  return r.document;
}
const pay = (id: string, amount: number, day: number, method = "upi", reference = "") => fin("POST", `documents/${id}/payments`, { amount, method, paidOn: iso(day), reference, note: "" });

async function seedFinance() {
  ids.book = (await call(page.request, "")<{ book: { id: string } }>("POST", "/api/v1/finance/books", { orgId, name: "Atelier Nine Interiors" })).book.id;
  fin = call(page.request, `/api/v1/finance/books/${ids.book}/`);
  const boot = await fin<{ settings: Record<string, unknown>; templates: { id: string }[] }>("GET", "");
  // The studio's own letterhead: the elegant serif design, named after the business.
  const tpl = (await fin<{ templates: { id: string }[] }>("GET", "templates")).templates[0]!.id;
  const { PREBUILT_TEMPLATES } = await import("../../src/lib/invoicing/templates");
  const elegant = PREBUILT_TEMPLATES.find((t) => t.id === "elegant")!.config;
  await fin("PUT", `templates/${tpl}`, { name: "Atelier Nine", config: { ...elegant, footerText: "Atelier Nine Interiors · Designing homes that feel like you" } });
  await fin("PUT", "settings", {
    ...boot.settings,
    business: { name: "Atelier Nine Interiors", legalName: "Atelier Nine Interiors LLP", email: "studio@ateliernine.example", phone: "+91 80 4000 0000", website: "ateliernine.example", gstin: "29AAAFA0000A1Z5", pan: "AAAFA0000A", address: { line1: "12, 4th Cross, Indiranagar", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560038", country: "IN" }, logo: "" },
    payment: { upiId: "ateliernine.demo@example", bankName: "Demo Bank", accountName: "Atelier Nine Interiors LLP", accountNumber: "000000000000", ifsc: "DEMO0000001", branch: "Indiranagar", swift: "", instructions: "" },
    defaultTemplateId: tpl,
  });
  for (const k of Object.keys(CLIENTS) as Ck[]) {
    const c = CLIENTS[k];
    clientIds[k] = (await fin<{ client: { id: string } }>("POST", "clients", { name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, billing: { line1: c.line1, line2: "", city: c.city, state: c.state, postalCode: c.pin, country: "IN" }, notes: "" })).client.id;
  }
  for (const k of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) {
    if (k === "styling") continue;
    const [name, hsn, unit, rate] = ITEMS[k];
    await fin("POST", "items", { name, hsn, unit, rate: rate * 100, taxBps: 1800 });
  }

  // A year of invoices, oldest first so the numbers run in date order.
  // [client, days ago, lines, paid after N days (null = unpaid), method]
  const plan: [Ck, number, L[], number | null, string?][] = [
    ["sharma", 356, [li("consult", 12)], 9, "bank"],
    ["lotus", 357, [li("consult", 1, 25000)], 12, "bank"],
    ["bloom", 330, [li("boards", 2), li("renders", 4)], 14, "upi"],
    ["patel", 300, [li("wardrobe", 1), li("supervision", 4)], 20, "bank"],
    ["desai", 290, [li("consult", 10)], 6, "upi"],
    ["greenleaf", 262, [li("desk", 1), li("wallpaper", 18)], 18, "bank"],
    ["lotus", 260, [li("boards", 3), li("renders", 3, 8000)], 15, "bank"],
    ["verma", 232, [li("boards", 4), li("consult", 8)], 10, "upi"],
    ["sharma", 222, [li("ceiling", 900), li("supervision", 6)], 21, "cheque"],
    ["bloom", 196, [li("chairs", 12), li("supervision", 3)], 9, "bank"],
    ["vikram", 188, [li("boards", 3), li("renders", 2)], 7, "upi"],
    ["greenleaf", 174, [li("wallpaper", 30), li("supervision", 5)], 12, "bank"],
    ["lotus", 167, [li("styling", 1)], 11, "bank"],
    ["patel", 160, [li("kitchen", 1), li("supervision", 2)], 14, "bank"],
  ];
  const made: { id: string; total: number }[] = [];
  for (const [k, ago, lines, paidAfter, method] of plan) {
    const d = await doc("invoice", k, -ago, lines);
    made.push(d);
    if (paidAfter !== null) await pay(d.id, d.total, -ago + paidAfter, method);
  }
  // The overdue, half-paid one the doc, share and public shots use.
  const nb = await doc("invoice", "nambiar", -152, [li("boards", 3), li("wardrobe", 2)]);
  await pay(nb.id, Math.round(nb.total / 2), -141, "card", "Card ending 4417");
  ids.overdue = nb.id;
  ids.overdueShare = nb.shareUrl;
  const later: [Ck, number, L[], number | null, string?][] = [
    ["sharma", 138, [li("desk", 2), li("ceiling", 600)], 16, "bank"],
    ["vikram", 131, [li("kitchen", 1), li("tv", 1)], 13, "bank"],
    ["lotus", 107, [li("consult", 1, 35000)], 12, "bank"],
    ["desai", 103, [li("renders", 6), li("consult", 6)], 9, "upi"],
    ["greenleaf", 95, [li("chairs", 20), li("supervision", 6)], 15, "bank"],
    ["bloom", 88, [li("wallpaper", 24), li("ceiling", 420)], 10, "upi"],
    ["patel", 76, [li("tv", 1), li("wardrobe", 1)], 18, "bank"],
    ["sharma", 67, [li("supervision", 10), li("renders", 4)], 12, "bank"],
    ["verma", 60, [li("boards", 3), li("consult", 7)], 9, "upi"],
    ["vikram", 57, [li("boards", 2), li("renders", 2, 7965)], 8, "upi"],
    ["greenleaf", 48, [li("wallpaper", 20), li("supervision", 3)], 11, "bank"],
    ["lotus", 40, [li("consult", 1, 50000)], 9, "bank"],
    ["sharma", 37, [li("wardrobe", 2), li("chairs", 6)], 15, "bank"],
    ["bloom", 32, [li("kitchen", 1)], 13, "bank"],
    ["verma", 30, [li("boards", 2), li("supervision", 3)], 9, "upi"],
    ["desai", 26, [li("desk", 1), li("tv", 1), li("chairs", 4)], 14, "bank"],
    ["nambiar", 21, [li("tv", 1), li("renders", 2, 7000)], null],
    ["lotus", 20, [li("styling", 1, 92500)], null],
    ["vikram", 17, [li("wardrobe", 2), li("kitchen", 1), li("tv", 1)], null],
    ["patel", 15, [li("supervision", 4), li("consult", 4)], 3, "upi"],
    ["verma", 12, [li("consult", 5), li("renders", 1)], null],
  ];
  for (const [k, ago, lines, paidAfter, method] of later) {
    const d = await doc("invoice", k, -ago, lines);
    if (paidAfter !== null) await pay(d.id, d.total, -ago + paidAfter, method);
  }
  // A proforma for Lotus's next phase.
  await doc("proforma", "lotus", -14, [li("consult", 1, 25000)]);

  // Quotations: the 2BHK quote that's out, one accepted and turned into a draft invoice, and one expired.
  const q = await doc("quote", "patel", -12, [li("boards", 3), li("supervision", 6)], { title: "2BHK full interiors" });
  ids.quote = q.id;
  await doc("quote", "desai", -64, [li("desk", 1), li("chairs", 6)], { title: "Reception refresh" });
  await doc("quote", "bloom", -8, [li("ceiling", 380), li("wallpaper", 12)], { title: "Café mezzanine" });
  const vq = await doc("quote", "vikram", -6, [li("consult", 8)], { title: "Guest bedroom consultation" });
  const conv = await fin<{ document: { id: string } }>("POST", `documents/${vq.id}/convert`, { to: "invoice" });
  ids.draft = conv.document.id;
  await doc("invoice", "greenleaf", -5, [li("chairs", 2), li("supervision", 1)], { issue: false });

  // The client opens the overdue invoice on their phone.
  const viewer = await page.context().browser()!.newContext({ baseURL: BASE });
  await viewer.request.get(ids.overdueShare.replace(/^https?:\/\/[^/]+/, ""));
  await viewer.close();
}

// ════════════════════════════════════════════════════════════════════════════
// Projects & time
// ════════════════════════════════════════════════════════════════════════════

const P: Record<string, Record<string, unknown>> = {};
const taskIds: Record<string, string> = {};

async function seedProjects() {
  const W = (p: string) => p;
  await api("GET", "work/meta");
  const { asha, priya, rohan } = team;
  const m = (u: { userId: string }, rate: number | null, cost: number) => ({ userId: u.userId, rate: rate === null ? null : rate * 100, costRate: cost * 100 });
  const defs: [string, Record<string, unknown>][] = [
    ["verma", { name: "Verma Residences — 3BHK interiors", description: "Full interiors for a 3BHK at Prestige Shantiniketan: living, dining, three bedrooms and the kitchen.", ownerId: ids.book, clientId: clientIds.verma, billing: "hourly", rate: 220000, budgetHours: 120, startDate: iso(-40), dueDate: iso(50), leadId: asha.userId, tint: "peach", status: "active", members: [m(asha, null, 1200), m(priya, 1800, 650), m(rohan, 1500, 550)] }],
    ["greenleaf", { name: "Greenleaf Co-working — phase 2 fit-out", description: "Second floor: 60 hot desks, two meeting rooms and a café corner.", ownerId: ids.book, clientId: clientIds.greenleaf, billing: "fixed", fee: 85000000, budgetAmount: 40000000, startDate: iso(-45), dueDate: iso(35), leadId: asha.userId, tint: "mint", status: "active", members: [m(asha, null, 1200), m(rohan, null, 550)] }],
    ["sharma", { name: "Sharma Dental — reception redesign", description: "A calmer reception: new desk, seating, wall graphics and lighting.", ownerId: ids.book, clientId: clientIds.sharma, billing: "hourly", rate: 200000, budgetHours: 30, startDate: iso(-30), dueDate: iso(-4), leadId: asha.userId, tint: "sky", status: "active", members: [m(asha, null, 1200), m(priya, null, 650)] }],
    ["studio", { name: "Studio portfolio refresh", description: "New photos and case studies for the website.", ownerId: null, clientId: null, clientName: "", billing: "none", startDate: iso(-20), dueDate: iso(15), leadId: asha.userId, tint: "lavender", status: "active", members: [m(asha, null, 1200), m(priya, null, 650)] }],
    ["desai", { name: "Desai & Co — year-end party styling", description: "Theme, décor and table styling for 120 guests.", ownerId: ids.book, clientId: clientIds.desai, billing: "fixed", fee: 34000000, startDate: iso(-2), dueDate: iso(55), leadId: rohan.userId, tint: "butter", status: "active", members: [m(rohan, null, 550), m(asha, null, 1200)] }],
  ];
  for (const [k, body] of defs) {
    P[k] = body;
    ids[`p_${k}`] = (await api<{ project: { id: string } }>("POST", "work/projects", body)).project.id;
  }
  const pid = (k: string) => ids[`p_${k}`]!;

  // Milestones.
  const ms = async (k: string, name: string, due: number, amount = 0) => (await api<{ milestone: { id: string } }>("POST", "work/milestones", { projectId: pid(k), name, dueDate: iso(due), amount: amount * 100 })).milestone.id;
  ids.m_concept = await ms("verma", "Concept & layouts", -20);
  ids.m_boards = await ms("verma", "Material boards signed off", 4);
  ids.m_joinery = await ms("verma", "Joinery drawings", 25);
  ids.m_freeze = await ms("greenleaf", "Design freeze", -6, 255000);
  ids.m_site = await ms("greenleaf", "Site work complete", 25, 425000);
  await ms("greenleaf", "Handover & snag list", 35, 170000);

  // Tasks: [key, project, title, status, priority, assignee, due, estimate, milestone, tags, checklist]
  type TaskDef = [string, string, string, string, string, keyof typeof team, number | null, number, string | null, string[], [string, boolean][]?];
  const tasks: TaskDef[] = [
    ["v1", "verma", "Measure-up and site photos", "done", "normal", "rohan", -30, 6, "m_concept", ["site"]],
    ["v2", "verma", "Living room layout options", "done", "high", "priya", -22, 10, "m_concept", ["layout"]],
    ["v3", "verma", "Material board — living & dining", "review", "normal", "priya", 2, 12, "m_boards", ["materials"], [["Flooring samples", true], ["Fabric swatches", true], ["Lighting picks", false]]],
    ["v4", "verma", "Master bedroom wardrobe concept", "doing", "normal", "asha", 4, 8, "m_boards", []],
    ["v5", "verma", "Kitchen joinery drawings", "todo", "normal", "rohan", 25, 16, "m_joinery", ["drawings"]],
    ["v6", "verma", "Lighting plan", "todo", "normal", "priya", 17, 6, "m_joinery", []],
    ["v7", "verma", "Client walkthrough — material boards", "todo", "urgent", "asha", -3, 0, null, []],
    ["v8", "verma", "Order fabric samples from vendor", "doing", "normal", "rohan", 1, 5, null, []],
    ["g1", "greenleaf", "Hot-desk zone plan", "done", "normal", "asha", -12, 14, "m_freeze", []],
    ["g2", "greenleaf", "Meeting room acoustics spec", "done", "normal", "rohan", -8, 10, "m_freeze", []],
    ["g3", "greenleaf", "Café corner joinery", "doing", "normal", "rohan", 10, 20, "m_site", []],
    ["g4", "greenleaf", "Signage and wayfinding", "todo", "normal", "asha", 20, 8, "m_site", []],
    ["g5", "greenleaf", "Furniture delivery schedule", "todo", "normal", "rohan", 22, 4, "m_site", []],
    ["s1", "sharma", "Reception desk drawings", "done", "normal", "priya", -16, 10, null, []],
    ["s2", "sharma", "Seating and lighting picks", "doing", "normal", "priya", -2, 8, null, []],
    ["s3", "sharma", "Wall graphics — final artwork", "doing", "high", "asha", -6, 6, null, []],
    ["st1", "studio", "Shoot list for three projects", "todo", "normal", "priya", 9, 4, null, []],
    ["st2", "studio", "Write case studies", "doing", "normal", "asha", 13, 8, null, []],
    ["d1", "desai", "Theme moodboard", "todo", "normal", "rohan", 12, 6, null, []],
    ["d2", "desai", "Table styling samples", "todo", "normal", "asha", 30, 4, null, []],
  ];
  for (const [key, k, title, status, priority, who, due, est, mile, tags, check] of tasks) {
    taskIds[key] = (
      await api<{ task: { id: string } }>("POST", "work/tasks", {
        projectId: pid(k), title, status, priority, assigneeId: team[who].userId, dueDate: due === null ? null : iso(due), estimateHours: est, milestoneId: mile ? ids[mile] : null, tags,
        checklist: (check ?? []).map(([text, done], i) => ({ id: `c${i + 1}`, text, done })),
      })
    ).task.id;
  }
  await api("POST", "work/tasks", { projectId: pid("verma"), parentId: taskIds.v3, title: "Hero section mood images", status: "done", assigneeId: team.priya.userId, estimateHours: 2 });
  await team.asha.api("POST", `work/tasks/${taskIds.v3}/comments`, { body: "Ananya prefers the warm oak over walnut — swapping the sample before Monday." });
  await team.priya.api("POST", `work/tasks/${taskIds.v3}/comments`, { body: "Lighting picks pending the electrician's load check." }).catch(() => api("POST", `work/tasks/${taskIds.v3}/comments`, { body: "Lighting picks pending the electrician's load check." }));

  // Time: four weeks back plus today. Each person's day is split over what they were on that week.
  // [person, week, [task, hours/day][]]
  const plan: [keyof typeof team, number, [string, number][]][] = [
    ["priya", 4, [["v2", 3.25], ["s1", 3.75]]],
    ["priya", 3, [["v2", 2.5], ["s1", 2], ["v3", 2.25]]],
    ["priya", 2, [["v3", 2.25], ["v2", 1.25], ["s2", 3.25]]],
    ["priya", 1, [["v3", 2.25], ["s2", 2.75], ["st1", 1.75]]],
    ["rohan", 4, [["v1", 1], ["g2", 3.5], ["g3", 2]]],
    ["rohan", 3, [["v1", 0.75], ["g2", 3], ["g3", 3]]],
    ["rohan", 2, [["v1", 0.75], ["v8", 1.25], ["g3", 4.25]]],
    ["rohan", 1, [["v8", 1.5], ["g3", 3.5], ["v5", 1]]],
    ["asha", 4, [["g1", 2.5], ["v4", 1], ["s3", 1]]],
    ["asha", 3, [["g1", 2], ["v4", 1.5], ["s3", 0.75]]],
    ["asha", 2, [["g1", 1.25], ["v4", 1.5], ["s3", 1.25]]],
    ["asha", 1, [["g1", 1.5], ["v4", 1.5], ["s3", 0.75], ["st2", 0.75]]],
  ];
  const projOf = (t: string) => pid(t.startsWith("v") ? "verma" : t.startsWith("g") ? "greenleaf" : t.startsWith("st") ? "studio" : t.startsWith("s") ? "sharma" : "desai");
  // A little day-to-day variation, the same every run.
  let seed = 7;
  const jitter = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 1.5;
  const q = (h: number) => Math.max(0, Math.round(h * 4) / 4);
  for (const [who, w, split] of plan) {
    for (let d = 0; d < 6; d++) {
      const day = monday(w) + d;
      if (day > 0) continue;
      // Asha takes Thursdays light and Rohan has Saturdays off every other week.
      if (who === "rohan" && d === 5 && w % 2 === 0) continue;
      for (const [t, h] of split) {
        const hours = q(h + jitter() * (who === "asha" && d === 3 ? 0.3 : 1) - (who === "asha" && d === 3 ? h * 0.5 : 0));
        if (!hours) continue;
        await api("POST", "work/time", { projectId: projOf(t), taskId: taskIds[t], date: iso(day), minutes: Math.round(hours * 60), userId: team[who].userId, note: "" });
      }
    }
  }
  // Today: Asha has started the week.
  await api("POST", "work/time", { projectId: pid("verma"), taskId: taskIds.v4, date: iso(0), minutes: 90, note: "Wardrobe elevations" });
  await api("POST", "work/time", { projectId: pid("studio"), taskId: taskIds.st2, date: iso(0), minutes: 45, note: "" });

  // Weeks go in for approval; older weeks are approved.
  const weekIso = (w: number) => iso(monday(w));
  for (const w of [4, 3, 2]) {
    for (const who of ["priya", "rohan", "asha"] as const) {
      await team[who].api("POST", "work/timesheet/submit", { week: weekIso(w) });
      await api("POST", "work/approvals", { userId: team[who].userId, week: weekIso(w), approve: true });
    }
    // Bill Verma for the first two weeks once they're approved.
    if (w === 3) {
      ids.vermaBill = (await api<{ document?: { id: string }; invoice?: { id: string }; id?: string }>("POST", `work/billing/${pid("verma")}`, { upTo: iso(monday(3) + 6), groupBy: "task" })) as never;
    }
  }
  await team.rohan.api("POST", "work/timesheet/submit", { week: weekIso(1) });
  await api("POST", "work/approvals", { userId: team.rohan.userId, week: weekIso(1), approve: true });
  await team.priya.api("POST", "work/timesheet/submit", { week: weekIso(1) });

  // Greenleaf's design freeze is reached and invoiced.
  await api("POST", `work/milestones/${ids.m_freeze}/done`, { done: true });
  const gBill = await api<Record<string, unknown>>("POST", `work/billing/${pid("greenleaf")}`, { milestoneIds: [ids.m_freeze], includeTime: false });
  const gDoc = (gBill.document as { id: string } | undefined)?.id ?? (gBill.invoice as { id: string } | undefined)?.id ?? (gBill.id as string | undefined);
  if (gDoc) await fin("POST", `documents/${gDoc}/issue`, {}).catch((e) => console.log("issue milestone invoice:", String(e).slice(0, 200)));

  // Budgets set from what was really logged: Verma close to its budget, Sharma well over.
  const detail = async (k: string) => api<{ stats?: { minutes?: number; totalMinutes?: number } } & Record<string, unknown>>("GET", `work/projects/${pid(k)}`);
  const hoursOf = async (k: string) => {
    const t = await api<{ entries: { minutes: number; projectId: string }[] }>("GET", `work/time?projectId=${pid(k)}&from=${iso(-60)}&to=${iso(0)}`);
    return t.entries.filter((e) => e.projectId === pid(k)).reduce((n, e) => n + e.minutes, 0) / 60;
  };
  void detail;
  void W;
  const vh = await hoursOf("verma");
  const sh = await hoursOf("sharma");
  if (vh) await api("PUT", `work/projects/${pid("verma")}`, { ...P.verma, budgetHours: Math.ceil(vh / 0.97) });
  if (sh) await api("PUT", `work/projects/${pid("sharma")}`, { ...P.sharma, budgetHours: Math.round(sh / 1.58) });
}

// ════════════════════════════════════════════════════════════════════════════
// CRM — the studio's events & catering side (Saffron House)
// ════════════════════════════════════════════════════════════════════════════

async function seedCrm() {
  const meta = await api<{ pipelines: { id: string; stages: { id: string; name: string; kind: string }[] }[] }>("GET", "crm/meta");
  const pl = meta.pipelines[0]!;
  const st = (n: string) => pl.stages.find((s) => s.name.toLowerCase().startsWith(n.toLowerCase()))?.id ?? pl.stages.find((s) => s.kind === n)!.id;
  const { asha, priya, rohan } = team;
  const owner = { asha: asha.userId, priya: priya.userId, rohan: rohan.userId };

  const companies: [string, string, string, string, string][] = [
    ["Lumen Hotels", "lumenhotels.com", "Hospitality", "1,000+", "Mumbai"],
    ["Kestrel Foods", "kestrelfoods.in", "Food & beverage", "201–1,000", "Pune"],
    ["Tealstack", "tealstack.io", "Software", "51–200", "Bengaluru"],
    ["Marigold Events", "marigoldevents.in", "Events", "11–50", "Jaipur"],
    ["Orbit Pharma", "orbitpharma.com", "Pharmaceuticals", "1,000+", "Hyderabad"],
    ["Coastline Travels", "coastline.travel", "Travel", "51–200", "Kochi"],
    ["PeakFit Studios", "peakfit.in", "Fitness", "11–50", "Bengaluru"],
    ["Northwind Logistics", "northwind-logistics.in", "Logistics", "201–1,000", "Chennai"],
    ["Bloom Weddings", "bloomweddings.co", "Weddings", "11–50", "Udaipur"],
  ];
  const co: Record<string, string> = {};
  for (const [name, domain, industry, size, city] of companies) co[name] = (await api<{ company: { id: string } }>("POST", "crm/companies", { name, domain, industry, size, city, country: "India", ownerId: name === "Lumen Hotels" ? owner.asha : null })).company.id;

  // [name, email, phone, title, company, lifecycle, source, owner, tags, city]
  const people: [string, string, string, string, string, string, string, keyof typeof owner, string[], string][] = [
    ["Meher Kapoor", "meher@lumenhotels.com", "+91 99300 87412", "Director of Sales", "Lumen Hotels", "opportunity", "event", "asha", ["VIP"], "Mumbai"],
    ["Vikram Bhatia", "vikram@kestrelfoods.in", "+91 98220 11873", "Head of Admin", "Kestrel Foods", "opportunity", "referral", "priya", [], "Pune"],
    ["Ananya Iyer", "ananya@kestrelfoods.in", "+91 98221 40922", "HR Manager", "Kestrel Foods", "opportunity", "referral", "priya", [], "Pune"],
    ["Sneha Kulkarni", "sneha@tealstack.io", "+91 99860 23310", "Office Manager", "Tealstack", "customer", "cold", "rohan", ["corporate"], "Bengaluru"],
    ["Farhan Qureshi", "farhan@tealstack.io", "+91 99860 77104", "People Ops", "Tealstack", "opportunity", "cold", "rohan", [], "Bengaluru"],
    ["Ishita Banerjee", "ishita@marigoldevents.in", "+91 98290 66218", "Founder", "Marigold Events", "opportunity", "event", "asha", ["wedding"], "Jaipur"],
    ["Nisha Agarwal", "nisha@orbitpharma.com", "+91 98490 33127", "Admin Lead", "Orbit Pharma", "opportunity", "ads", "rohan", [], "Hyderabad"],
    ["Dev Anand Pillai", "dev@coastline.travel", "+91 98950 12007", "Partnerships", "Coastline Travels", "opportunity", "event", "asha", [], "Kochi"],
    ["Karan Malhotra", "karan@peakfit.in", "+91 99000 51623", "Co-founder", "PeakFit Studios", "opportunity", "social", "priya", [], "Bengaluru"],
    ["Arjun Sethi", "arjun.sethi@northwind-logistics.in", "+91 98400 22981", "Facilities Head", "Northwind Logistics", "opportunity", "partner", "rohan", ["corporate"], "Chennai"],
    ["Kavita Rao", "kavita@bloomweddings.co", "+91 98290 90031", "Wedding Planner", "Bloom Weddings", "customer", "referral", "asha", ["wedding", "VIP"], "Udaipur"],
    ["Rahul Desai", "rahul@desaiandco.in", "+91 98201 55678", "Partner", "", "customer", "referral", "priya", [], "Mumbai"],
    ["Tanvi Joshi", "tanvi.joshi@gmail.com", "+91 98190 44210", "", "", "lead", "social", "priya", ["wedding"], "Mumbai"],
    ["Aditya Menon", "aditya.menon@outlook.com", "+91 98450 70321", "", "", "lead", "ads", "rohan", [], "Bengaluru"],
    ["Pooja Reddy", "pooja.reddy@gmail.com", "+91 99490 12844", "", "", "qualified", "event", "asha", ["wedding"], "Hyderabad"],
    ["Siddharth Rao", "sid@brewcraft.in", "+91 98860 33019", "Owner", "", "lead", "cold", "rohan", [], "Bengaluru"],
    ["Neha Kapoor", "neha.kapoor@yahoo.in", "+91 98110 88210", "", "", "subscriber", "social", "priya", [], "Delhi"],
    ["Rajat Khanna", "rajat@khannaandsons.in", "+91 98100 12993", "Director", "", "qualified", "referral", "asha", [], "Delhi"],
    ["Meera Pillai", "meera.pillai@gmail.com", "+91 98470 56120", "", "", "lead", "event", "priya", [], "Kochi"],
    ["Zoya Ahmed", "zoya@studiozoya.in", "+91 98670 44781", "Creative Director", "", "lead", "ads", "rohan", [], "Mumbai"],
  ];
  const c: Record<string, string> = {};
  for (const [name, email, phone, title, company, lifecycle, source, who, tags, city] of people) {
    const body = { name, email, phone, title, companyId: company ? co[company] : null, companyName: company && !co[company] ? company : "", ownerId: owner[who], lifecycle, source, tags, city, country: "India", marketing: !["Neha Kapoor"].includes(name) };
    try {
      c[name] = (await api<{ contact: { id: string } }>("POST", "crm/contacts", body)).contact.id;
    } catch (e) {
      // Already in the CRM from the invoicing books (same person): fill in the rest.
      const existing = /"existingId":"([0-9a-f-]{36})"/.exec(String(e))?.[1];
      if (!existing) throw e;
      const cur = (await api<{ contact: Record<string, unknown> }>("GET", `crm/contacts/${existing}`)).contact;
      await api("PUT", `crm/contacts/${existing}`, { ...body, email: String(cur.email ?? body.email), source: String(cur.source ?? body.source) });
      c[name] = existing;
    }
  }
  ids.meher = c["Meher Kapoor"]!;
  await api("PUT", `crm/contacts/${ids.meher}`, { name: "Meher Kapoor", email: "meher@lumenhotels.com", phone: "+91 99300 87412", title: "Director of Sales", companyId: co["Lumen Hotels"], ownerId: owner.asha, lifecycle: "opportunity", leadStatus: "working", source: "event", tags: ["VIP"], city: "Mumbai", country: "India", marketing: true, custom: {} }).catch(() => {});

  // New enquiries from the website form and an expo list, imported.
  const first = ["Aarav", "Diya", "Kabir", "Myra", "Reyansh", "Anika", "Vihaan", "Saanvi", "Ayaan", "Kiara", "Ishaan", "Navya", "Arnav", "Tara", "Rudra", "Mira", "Dhruv", "Aisha", "Yash", "Riya", "Om", "Pari", "Krish", "Avni", "Shaurya", "Ira", "Laksh", "Siya", "Veer", "Anvi"];
  const last = ["Sharma", "Gupta", "Iyer", "Reddy", "Nair", "Chopra", "Bose", "Shah", "Rao", "Kulkarni", "Patil", "Das", "Menon", "Jain", "Bhat"];
  const cities = ["Bengaluru", "Mumbai", "Pune", "Hyderabad", "Chennai", "Delhi"];
  const rows = first.map((f, i) => {
    const l = last[(i * 7) % last.length]!;
    return { name: `${f} ${l}`, email: `${f.toLowerCase()}.${l.toLowerCase()}${i % 3 ? "" : i}@gmail.com`, phone: `+91 9${String(8000000000 + i * 7919331).slice(0, 9)}`, city: cities[i % cities.length], source: ["web_form", "event", "ads", "social"][i % 4], tags: i % 5 === 0 ? "wedding" : i % 7 === 0 ? "corporate" : "" };
  });
  await api("POST", "crm/contacts/import", { rows, update: true, ownerId: null, tags: [] });

  // Deals: [title, contact, company, stage, value ₹, owner, close in days, priority]
  const deals: [string, string, string, string, number, keyof typeof owner, number, string][] = [
    ["Coastline Travels — client dinners", "Dev Anand Pillai", "Coastline Travels", "New lead", 220000, "asha", 76, "normal"],
    ["PeakFit — healthy meal plans", "Karan Malhotra", "PeakFit Studios", "New lead", 180000, "priya", 55, "normal"],
    ["Northwind — Diwali hampers (400)", "Arjun Sethi", "Northwind Logistics", "Contacted", 640000, "rohan", 10, "normal"],
    ["Orbit Pharma — annual offsite catering", "Nisha Agarwal", "Orbit Pharma", "Qualified", 1300000, "rohan", 86, "normal"],
    ["Tealstack — monthly team lunches", "Farhan Qureshi", "Tealstack", "Qualified", 360000, "rohan", 45, "normal"],
    ["Marigold — wedding season tie-up", "Ishita Banerjee", "Marigold Events", "Proposal", 980000, "asha", 36, "normal"],
    ["Kestrel Foods — staff canteen contract", "Ananya Iyer", "Kestrel Foods", "Proposal", 1900000, "priya", 33, "high"],
    ["Kestrel Foods — festive gifting", "Vikram Bhatia", "Kestrel Foods", "Negotiation", 420000, "priya", 5, "normal"],
    ["Lumen Hotels — banquet partnership", "Meher Kapoor", "Lumen Hotels", "Negotiation", 2400000, "asha", 20, "high"],
    ["Lumen Hotels — New Year gala", "Meher Kapoor", "Lumen Hotels", "Proposal", 1500000, "asha", 60, "normal"],
    ["Pooja Reddy — sangeet dinner", "Pooja Reddy", "", "Contacted", 260000, "asha", 40, "normal"],
    ["Khanna & Sons — anniversary lunch", "Rajat Khanna", "", "Qualified", 150000, "asha", 28, "normal"],
    ["Zoya Ahmed — studio launch", "Zoya Ahmed", "", "New lead", 120000, "rohan", 50, "normal"],
  ];
  const d: Record<string, string> = {};
  for (const [title, who, company, stage, value, own, close, priority] of deals) {
    d[title] = (await api<{ deal: { id: string } }>("POST", "crm/deals", { title, pipelineId: pl.id, stageId: st(stage), value: value * 100, contactId: c[who], companyId: company ? co[company] : null, ownerId: owner[own], expectedClose: iso(close), priority })).deal.id;
  }
  ids.deal = d["Lumen Hotels — banquet partnership"]!;
  // Walk the banquet deal through its stages so the path shows each step done.
  for (const sname of ["Contacted", "Qualified", "Proposal", "Negotiation"]) await api("POST", `crm/deals/${ids.deal}/move`, { stageId: st(sname) });
  // Won this month, and two lost.
  const won: [string, string, string, number, keyof typeof owner][] = [
    ["Bloom Weddings — Udaipur wedding (300 guests)", "Kavita Rao", "Bloom Weddings", 1600000, "asha"],
    ["Tealstack — offsite lunch", "Sneha Kulkarni", "Tealstack", 280000, "rohan"],
    ["Desai & Co — year-end party", "Rahul Desai", "", 340000, "priya"],
  ];
  for (const [title, who, company, value, own] of won) {
    const id = (await api<{ deal: { id: string } }>("POST", "crm/deals", { title, pipelineId: pl.id, stageId: st("Proposal"), value: value * 100, contactId: c[who], companyId: company ? co[company] : null, ownerId: owner[own] })).deal.id;
    await api("POST", `crm/deals/${id}/move`, { stageId: pl.stages.find((s) => s.kind === "won")!.id });
  }
  for (const [title, who, value, reason, own] of [["Neha Kapoor — birthday brunch", "Neha Kapoor", 90000, "Price", "priya"], ["BrewCraft — tasting evening", "Siddharth Rao", 150000, "Went with a competitor", "rohan"]] as const) {
    const id = (await api<{ deal: { id: string } }>("POST", "crm/deals", { title, pipelineId: pl.id, stageId: st("Contacted"), value: value * 100, contactId: c[who], ownerId: owner[own] })).deal.id;
    await api("POST", `crm/deals/${id}/move`, { stageId: pl.stages.find((s) => s.kind === "lost")!.id, lostReason: reason });
  }

  // Activities on the banquet deal and Meher's timeline.
  const act = (b: Record<string, unknown>) => api("POST", "crm/activities", b);
  await act({ kind: "note", body: "Decision by the GM and Meher together. GM prefers vendors who can do live counters — mention the tandoor station.", contactId: ids.meher, companyId: co["Lumen Hotels"], dealId: ids.deal });
  await act({ kind: "call", subject: "Pricing call", body: "They want a 3-year term with a rate review each April. Asked for weekend banquet minimums in writing.", outcome: "connected", durationMin: 25, contactId: ids.meher, companyId: co["Lumen Hotels"], dealId: ids.deal, done: true });
  await act({ kind: "meeting", subject: "Tasting at Saffron House", body: "GM + Meher, 6 dishes, live tandoor.", dueAt: at(2, 13), contactId: ids.meher, companyId: co["Lumen Hotels"], dealId: ids.deal });
  await act({ kind: "task", subject: "Send revised banquet rate card", dueAt: at(-2, 11), priority: "high", contactId: ids.meher, companyId: co["Lumen Hotels"], dealId: ids.deal, ownerId: owner.asha });
  await act({ kind: "task", subject: "Call Ananya about canteen headcount", dueAt: at(1, 11), contactId: c["Ananya Iyer"], dealId: d["Kestrel Foods — staff canteen contract"], ownerId: owner.asha });
  await act({ kind: "task", subject: "Share wedding menu deck", dueAt: at(1, 16), contactId: c["Ishita Banerjee"], dealId: d["Marigold — wedding season tie-up"], ownerId: owner.asha });
  await act({ kind: "task", subject: "Confirm hamper count with Arjun", dueAt: at(3, 12), contactId: c["Arjun Sethi"], dealId: d["Northwind — Diwali hampers (400)"], ownerId: owner.asha });
  await act({ kind: "call", subject: "Intro call", body: "Interested in a Friday lunch buffet for 80 people.", outcome: "connected", durationMin: 12, contactId: c["Farhan Qureshi"], done: true });
  await act({ kind: "email", subject: "Menus for your sangeet", body: "Sharing three menus, as discussed.", contactId: c["Pooja Reddy"], done: true });
  await act({ kind: "call", subject: "Canteen pilot", body: "Wants a two-week pilot in December.", outcome: "connected", durationMin: 18, contactId: c["Ananya Iyer"], dealId: d["Kestrel Foods — staff canteen contract"], done: true });
  await act({ kind: "meeting", subject: "Venue walk-through", body: "Walked the lawns and the banquet hall.", contactId: c["Kavita Rao"], done: true, outcome: "held" });

  // A sequence for new enquiries with four people in it.
  const seq = (
    await api<{ sequence: { id: string } }>("POST", "crm/sequences", {
      name: "New enquiry follow-up",
      active: true,
      steps: [
        { kind: "email", delayDays: 0, subject: "Thanks for your enquiry, {{first_name}}", body: "Hi {{first_name}},\n\nThanks for getting in touch with Saffron House. I'll be your point of contact — tell me a little about the event and I'll send menus that fit.\n\n{{owner_name}}" },
        { kind: "task", delayDays: 2, subject: "Call about their event", body: "" },
        { kind: "email", delayDays: 5, subject: "Menus and a tasting?", body: "Hi {{first_name}},\n\nSharing our menus — would you like to come in for a tasting? Weekday afternoons work best.\n\n{{owner_name}}" },
        { kind: "email", delayDays: 10, subject: "Checking in", body: "Hi {{first_name}}, just checking in on your plans. Happy to help.\n\n{{owner_name}}" },
      ],
    })
  ).sequence.id;
  ids.seq = seq;
  await api("POST", `crm/sequences/${seq}/enroll`, { contactIds: [c["Tanvi Joshi"], c["Aditya Menon"], c["Meera Pillai"], c["Zoya Ahmed"]] });
  await api("POST", "crm/sync", {}).catch(() => {});
  // Find the contact made from the Lotus Boutique Hotels invoicing client.
  const lotus = await api<{ contacts: { id: string; name: string }[] }>("GET", "crm/search?q=lotushotels");
  ids.lotusContact = lotus.contacts[0]?.id ?? "";
}

// ════════════════════════════════════════════════════════════════════════════
// Shots
// ════════════════════════════════════════════════════════════════════════════

// One screen failing doesn't stop the rest; failures are listed at the end.
// CAPTURE_ONLY="crm/deal,finance/share" re-shoots just those.
const failed: string[] = [];
const only = (process.env.CAPTURE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
async function step(name: string, fn: () => Promise<void>) {
  if (only.length && !only.some((o) => name.startsWith(o))) return;
  try {
    await fn().catch(async (e) => {
      // The dev server can be slow under load: one more go.
      console.log(`… retrying ${name}: ${String(e).split("\n")[0]}`);
      await page.keyboard.press("Escape").catch(() => {});
      await fn();
    });
  } catch (e) {
    failed.push(name);
    console.log(`✘ ${name}: ${String(e).split("\n").slice(0, 3).join(" ")}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
}
test.afterAll(() => {
  if (failed.length) console.log(`Not captured: ${failed.join(", ")}`);
  expect(failed, "screens not captured").toEqual([]);
});

test("finance", async () => {
  const F = `/finance/${ids.book}`;
  await step("finance/overview", async () => {
    await open(page, F, "You're owed");
    await shoot(page, "finance", "overview", { settle: 2200 });
    const kpis = page.locator("div").filter({ has: page.getByText("Invoiced", { exact: true }) }).filter({ has: page.getByText("Overdue now", { exact: true }) }).last();
    await snap(page, kpis, "finance", "kpis");
  });
  await step("finance/invoices", async () => {
    await open(page, `${F}/invoices`, /INV\//);
    await shoot(page, "finance", "invoices");
  });
  await step("finance/doc", async () => {
    await open(page, `${F}/invoices/${ids.overdue}`, "Balance due");
    await shoot(page, "finance", "doc", { settle: 2200 });
  });
  await step("finance/editor", async () => {
    await open(page, `${F}/invoices/${ids.draft}/edit`, "Live preview");
    await shoot(page, "finance", "editor", { settle: 2500 });
  });
  await step("finance/quote", async () => {
    await open(page, `${F}/quotes/${ids.quote}`, "Convert to invoice");
    await shoot(page, "finance", "quote", { settle: 2200 });
  });
  await step("finance/reports", async () => {
    await open(page, `${F}/reports`, "Invoice register");
    await page.getByRole("button", { name: "This financial year" }).click().catch(() => {});
    await shoot(page, "finance", "reports", { settle: 2200 });
  });
  await step("finance/templates", async () => {
    await open(page, `${F}/templates`, "Professional designs");
    await shoot(page, "finance", "templates", { settle: 2500 });
  });
  await step("finance/share", async () => {
    // Sharing the overdue invoice on WhatsApp.
    await open(page, `${F}/invoices/${ids.overdue}`, "Balance due");
    await page.locator('button:not([title="Share to chat"])').filter({ hasText: /^\s*Share\s*$/ }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("tab", { name: /WhatsApp/ }).or(dlg.getByRole("button", { name: /WhatsApp/ })).first().click();
    await page.waitForTimeout(800);
    await hideLocalhost(page);
    await shoot(page, "finance", "share", { settle: 900 });
    await dlg.getByLabel("Phone number").fill("98470 00000");
    await page.waitForTimeout(300);
    await hideLocalhost(page);
    await snap(page, dlg, "finance", "share-panel", 400);
    await page.keyboard.press("Escape");
  });
  await step("finance/public", async () => {
    // What the client sees: desktop and phone.
    const path = ids.overdueShare.replace(/^https?:\/\/[^/]+/, "");
    const viewer = await page.context().browser()!.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const pub = await viewer.newPage();
    await open(pub, path, "Pay");
    await shoot(pub, "finance", "public");
    await viewer.close();
    for (const [name, h] of [["phone", 633], ["phone 2", 844]] as const) {
      const m = await page.context().browser()!.newContext({ baseURL: BASE, viewport: { width: 390, height: h }, deviceScaleFactor: 3 });
      const mp = await m.newPage();
      await open(mp, path, "Pay");
      await shoot(mp, "finance", name);
      await m.close();
    }
  });
});

test("projects", async () => {
  await step("projects/home", async () => {
    await open(page, "/work", "On your plate");
    await shoot(page, "projects", "home", { settle: 2000 });
  });
  await step("projects/projects", async () => {
    await open(page, "/work/projects", "Verma Residences");
    await shoot(page, "projects", "projects", { settle: 1600 });
    await page.getByRole("main").getByRole("button", { name: "New project" }).last().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shoot(page, "projects", "new-project", { settle: 1200 });
    await page.keyboard.press("Escape");
  });
  await step("projects/board", async () => {
    await open(page, `/work/projects/${ids.p_verma}`, "Kitchen joinery drawings");
    await shoot(page, "projects", "board", { settle: 1600 });
  });
  await step("projects/billing", async () => {
    await open(page, `/work/projects/${ids.p_verma}/billing`, "Ready to bill");
    await shoot(page, "projects", "billing", { settle: 1600 });
  });
  await step("projects/milestones", async () => {
    await open(page, `/work/projects/${ids.p_greenleaf}/milestones`, "Design freeze");
    await shoot(page, "projects", "milestones", { settle: 1600 });
  });
  await step("projects/task", async () => {
    await open(page, `/work/tasks/${taskIds.v3}`, "Checklist");
    await shoot(page, "projects", "task", { settle: 1600 });
  });
  await step("projects/timesheet", async () => {
    await open(page, `/work/timesheet?week=${iso(monday(1))}`, "Send for approval");
    await shoot(page, "projects", "timesheet", { settle: 1600 });
  });
  await step("projects/approvals", async () => {
    await open(page, "/work/approvals", "Priya Nair");
    await shoot(page, "projects", "approvals");
  });
  await step("projects/profit", async () => {
    await open(page, "/work/profit", "By project");
    await shoot(page, "projects", "profit", { settle: 1600 });
  });
  await step("projects/reports", async () => {
    await open(page, "/work/reports", "Hours per day");
    await shoot(page, "projects", "reports", { settle: 1800 });
  });
  await phoneShots(page, [["/work", "projects"]]);
});

test("crm", async () => {
  await step("crm/home", async () => {
    await open(page, "/crm", "Your day");
    await shoot(page, "crm", "home", { settle: 2000 });
  });
  await step("crm/search", async () => {
    await open(page, "/crm", "Your day");
    const search = page.getByPlaceholder("Search people, companies, deals…");
    await search.click();
    await search.pressSequentially("kes", { delay: 60 });
    await expect(page.getByText("Searching…")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText("Kestrel Foods — staff canteen contract").first()).toBeVisible();
    await shoot(page, "crm", "search", { settle: 900 });
    await search.fill("");
    await page.keyboard.press("Escape");
  });
  await step("crm/contacts", async () => {
    await open(page, "/crm/contacts", "Meher Kapoor");
    await shoot(page, "crm", "contacts", { settle: 1500 });
    const rows = page.locator("tbody tr");
    for (const n of [1, 2, 4]) await rows.nth(n).getByRole("checkbox").check();
    await expect(page.getByText("3 selected")).toBeVisible();
    await shoot(page, "crm", "contacts-bulk", { settle: 900 });
  });
  await step("crm/import-panel", async () => {
    // Importing a spreadsheet: the column-matching step.
    await open(page, "/crm/contacts", "Meher Kapoor");
    await page.getByRole("button", { name: "Import & export" }).click();
    await page.getByRole("menuitem", { name: "Import a spreadsheet" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    const csv = "Full Name,E-mail,Mobile,Company,Designation,City,Tags\nAditi Rao,aditi@greenleaf.in,98200 33445,Greenleaf Organics,Founder,Pune,expo\nManav Shah,manav@urbanbrew.in,98190 22871,Urban Brew,Owner,Mumbai,expo\nLeela Krishnan,leela@kalakriti.in,94440 18120,Kalakriti Crafts,Partner,Chennai,expo\n";
    await dlg.locator('input[type="file"]').setInputFiles({ name: "expo-leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(dlg.getByText("Aditi Rao").first()).toBeVisible({ timeout: 20_000 });
    const tagBox = dlg.getByLabel("Tag everyone with");
    if (await tagBox.isVisible().catch(() => false)) await tagBox.fill("Expo 2026");
    await snap(page, dlg, "crm", "import-panel");
    await page.keyboard.press("Escape");
  });
  await step("crm/contact", async () => {
    await open(page, `/crm/contacts/${ids.meher}`, "Send revised banquet rate card");
    await shoot(page, "crm", "contact", { settle: 1500 });
    // Writing an email from a template.
    const composer = page.getByRole("tablist", { name: "Log an activity" }).first().locator("xpath=..");
    await composer.getByRole("tab", { name: "Email" }).click();
    const tplSel = composer.getByLabel("Use a template");
    if (await tplSel.isVisible().catch(() => false)) await tplSel.selectOption({ index: 1 });
    await snap(page, composer, "crm", "email-panel");
  });
  await step("crm/contact-linked", async () => {
    expect(ids.lotusContact, "Lotus contact from invoicing").toBeTruthy();
    await open(page, `/crm/contacts/${ids.lotusContact}`, "Across Cloudesk");
    await shoot(page, "crm", "contact-linked", { settle: 1500 });
    const linked = page.locator("section").filter({ has: page.getByRole("heading", { name: "Across Cloudesk" }) }).first();
    await linked.scrollIntoViewIfNeeded();
    await snap(page, linked, "crm", "linked-panel");
  });
  await step("crm/company", async () => {
    await open(page, "/crm/companies", "Lumen Hotels");
    await page.getByText("Lumen Hotels", { exact: true }).first().click();
    await expect(page.getByText("Send revised banquet rate card").first()).toBeVisible({ timeout: 30_000 });
    await shoot(page, "crm", "company", { settle: 1500 });
  });
  await step("crm/deals", async () => {
    await open(page, "/crm/deals", "Lumen Hotels — banquet partnership");
    await shoot(page, "crm", "deals", { settle: 1500 });
  });
  await step("crm/deal", async () => {
    await open(page, `/crm/deals/${ids.deal}`, "Send revised banquet rate card");
    await shoot(page, "crm", "deal", { settle: 1500 });
    await page.getByRole("button", { name: "Lost", exact: true }).click();
    const lost = page.getByRole("dialog");
    await lost.getByRole("button", { name: "Went with a competitor" }).click();
    await snap(page, lost, "crm", "lost-panel");
    await lost.getByRole("button", { name: "Back" }).click();
  });
  await step("crm/tasks", async () => {
    await open(page, "/crm/tasks", "Send revised banquet rate card");
    await shoot(page, "crm", "tasks");
  });
  await step("crm/sequence", async () => {
    await open(page, `/crm/sequences/${ids.seq}`, "New enquiry follow-up");
    await shoot(page, "crm", "sequence", { settle: 1500 });
  });
  await step("crm/reports", async () => {
    await open(page, "/crm/reports", "Win rate");
    await shoot(page, "crm", "reports", { settle: 2000 });
  });
  await step("crm/capture", async () => {
    await open(page, "/crm/settings", "CRM settings");
    await page.getByRole("tab", { name: "Lead capture" }).or(page.getByRole("button", { name: "Lead capture" })).first().click();
    await expect(page.getByText("Lead link").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    await hideLocalhost(page);
    await shoot(page, "crm", "capture", { settle: 150 });
    await page.getByRole("tab", { name: "Scoring" }).or(page.getByRole("button", { name: "Scoring" })).first().click();
    await expect(page.getByText("Lead score rules").first()).toBeVisible();
    await shoot(page, "crm", "scoring", { settle: 900 });
  });
  await phoneShots(page, [["/crm", "crm"]]);
});
