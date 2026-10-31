// Real screenshots for the "build & grow" feature pages: bookings, launch,
// promotions, collaboration, domains, data, chatbot, automations, growth and
// the AI IDE. Each run signs up a fresh demo studio on the local dev server,
// builds its sites through the app's own APIs, sends believable visitors to
// the published sites (bookings, chats, form sends, A/B traffic), and
// captures the screens into public/marketing/<feature>/.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-build
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, request, test, type Locator, type Page } from "@playwright/test";
import { clean, ip, shoot } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const B = "http://localhost:3000";
const ORIGIN = { origin: B };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const UAS = [UA, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0", "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"];

type Api = <R = any>(method: string, path: string, body?: unknown) => Promise<R>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Signs up a demo owner (skipping the welcome flow) and returns a helper for /api/v1. */
async function owner(page: Page, name: string, email: string, orgName: string) {
  // The sign-up limiter counts per client address, so each demo owner gets its own.
  const r = await page.request.post("/api/v1/auth/signup", { data: { name, email, password: PW, orgName }, headers: { ...ORIGIN, "x-forwarded-for": ip() } });
  expect(r.status(), await r.text()).toBe(201);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  await page.request.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: ORIGIN });
  const api: Api = async (method, path, body) => {
    const res = await page.request.fetch(`/api/v1${path}`, { method, data: body === undefined ? undefined : body, headers: ORIGIN });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as never;
  };
  return { api, orgId: me.organizations[0].id as string, orgSlug: me.organizations[0].slug as string, email };
}

/** A published site's path (/s/<org>/<project>). */
async function sitePath(api: Api, orgSlug: string, projectId: string) {
  const { project } = await api<{ project: { slug: string } }>("GET", `/projects/${projectId}`);
  return `/s/${orgSlug}/${project.slug}`;
}

async function deploy(api: Api, projectId: string) {
  const { deployment } = await api<{ deployment: { id: string; status: string; error: string | null } }>("POST", `/projects/${projectId}/deployments`, { environment: "production" });
  expect(deployment.error ?? "", "deploy failed").toBe("");
  await expect.poll(async () => (await api<{ deployments: { id: string; status: string }[] }>("GET", `/projects/${projectId}/deployments`)).deployments.find((d) => d.id === deployment.id)?.status, { timeout: 90_000 }).toBe("ready");
}

async function open(page: Page, path: string, settle = 1500) {
  // A route's first visit compiles it on the dev server, which can take a while.
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await clean(page);
  await page.waitForTimeout(settle);
}

/** Saves one element (a dialog, a card, a form) as a panel image. */
async function panel(loc: Locator, dir: string, name: string) {
  const out = join(process.cwd(), "public", "marketing", dir);
  mkdirSync(out, { recursive: true });
  await loc.page().waitForTimeout(600);
  await clean(loc.page());
  await loc.screenshot({ path: join(out, `${name}.jpg`), type: "jpeg", quality: 85 });
}

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name }).first().click({ timeout: 4000 }).catch(async () => page.getByRole("button", { name, exact: true }).first().click({ timeout: 4000 }).catch(async () => page.getByText(name, { exact: true }).first().click()));
  await page.waitForTimeout(1300);
}

/** Calendar dates in the spa's time zone. */
const istDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const istStart = (ymd: string, hm: string) => new Date(Date.parse(`${ymd}T${hm}:00+05:30`)).toISOString();
/** The next n days the spa is open (closed on Mondays), starting tomorrow. */
function openDays(n: number) {
  const out: string[] = [];
  for (let k = 1; out.length < n; k++) if (weekday(istDay(k)) !== 1) out.push(istDay(k));
  return out;
}

/** An anonymous visitor on the public site (own IP, own cookies). */
async function visitor(i: number, ua = UA) {
  return request.newContext({ baseURL: B, extraHTTPHeaders: { "x-forwarded-for": `10.${150 + (i % 60)}.${Math.floor(i / 200) % 250}.${(i * 37) % 250 + 2}`, "user-agent": ua } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Still Waters Spa: bookings, collaboration, domains, data, chatbot,
// automations, growth and the AI IDE.
// ─────────────────────────────────────────────────────────────────────────────
test("Still Waters Spa — bookings, chatbot, automations, data, growth, domains, collaboration, IDE", async ({ page, browser }) => {
  const { api, orgId, orgSlug, email } = await owner(page, "Asha Mehra", `asha.${T}@stillwaters-demo.in`, "Asha's Studio");
  const { project } = await api<{ project: { id: string } }>("POST", `/orgs/${orgId}/projects`, { templateId: "spa", name: "Still Waters Spa" });
  const id = project.id;
  const P = `/projects/${id}`;
  const SITE = await sitePath(api, orgSlug, id);

  // ── Bookings: store, hours, services ──
  await api("POST", `${P}/store/setup`, { name: "Still Waters Spa", currency: "INR", country: "IN", email: "hello@stillwaters.example" });
  await api("PUT", `${P}/store/booking-settings`, { timezone: "Asia/Kolkata", hours: { tue: [["10:00", "19:00"]], wed: [["10:00", "19:00"]], thu: [["10:00", "19:00"]], fri: [["10:00", "20:00"]], sat: [["09:00", "20:00"]], sun: [["09:00", "17:00"]] }, slotStepMin: 30, minNoticeHours: 2, maxDaysAhead: 45, closedDates: [istDay(13)], cancelHours: 24 });
  const svcs = [
    { key: "deep", name: "Signature deep-tissue massage", description: "Slow, firm pressure for tight shoulders and back. Includes a warm towel ritual.", durationMin: 60, price: 350000 },
    { key: "facial", name: "Aromatherapy facial", description: "A calming facial with essential oils, steam and a hydrating mask.", durationMin: 45, price: 280000 },
    { key: "stone", name: "Hot stone therapy", description: "Heated basalt stones melt away tension. Bring nothing — we have robes.", durationMin: 90, price: 520000 },
    { key: "couples", name: "Couples retreat", description: "Side-by-side massages in our garden suite, with herbal tea after.", durationMin: 90, price: 980000, capacity: 2 },
    { key: "foot", name: "Express foot ritual", description: "A quick reflexology reset between meetings.", durationMin: 30, price: 120000 },
  ];
  const S: Record<string, string> = {};
  for (const [i, { key, ...s }] of svcs.entries()) {
    const r = await api<{ service?: { id: string }; id?: string }>("POST", `${P}/store/booking-services`, { capacity: 1, bufferMin: 15, payment: "none", active: true, sort: i, ...s });
    S[key] = (r.service?.id ?? r.id)!;
  }
  expect(Object.values(S).every(Boolean), JSON.stringify(S)).toBe(true);

  // ── Automations (before the bookings and enquiries that set them off) ──
  const flows = [
    { name: "Booking confirmed → welcome note", trigger: { type: "booking_confirmed", config: {} }, steps: [
      { id: "s1", type: "send_email", config: { to: "{{trigger.email}}", subject: "See you soon, {{trigger.name}}", body: "Your {{trigger.service}} is booked. Arrive 10 minutes early — robes, slippers and herbal tea are on us." } },
      { id: "s2", type: "delay", config: { amount: 1, unit: "days" } },
      { id: "s3", type: "send_email", config: { to: "{{trigger.email}}", subject: "Tomorrow at Still Waters", body: "A gentle reminder of your {{trigger.service}}. Reply to this email if you need to move it." } } ] },
    { name: "New enquiry → reply within the hour", trigger: { type: "form_submitted", config: { formId: "" } }, steps: [
      { id: "s1", type: "condition", config: { left: "{{trigger.data.email}}", op: "exists", right: "" } },
      { id: "s2", type: "send_email", config: { to: "{{trigger.data.email}}", subject: "Thanks for getting in touch", body: "Hi {{trigger.data.name}}, we've got your message and will reply within the hour during opening times." } },
      { id: "s3", type: "send_email", config: { to: email, subject: "New enquiry from {{trigger.data.name}}", body: "{{trigger.data.message}}" } } ] },
    { name: "Monday morning — week ahead", trigger: { type: "schedule", config: { cron: "0 9 * * 1", timezone: "Asia/Kolkata" } }, steps: [
      { id: "s1", type: "send_email", config: { to: email, subject: "This week at Still Waters", body: "Check the bookings calendar and confirm therapist rotas for the week." } } ] },
    { name: "VIP follow-up after a couples retreat", trigger: { type: "booking_confirmed", config: {} }, steps: [
      { id: "s1", type: "condition", config: { left: "{{trigger.service}}", op: "contains", right: "Couples" } },
      { id: "s2", type: "delay", config: { amount: 2, unit: "days" } },
      { id: "s3", type: "send_email", config: { to: "{{trigger.email}}", subject: "How was your retreat?", body: "We'd love to hear how it went — reply to this email any time." } } ] },
  ];
  for (const f of flows) {
    const r = await api<{ workflow?: { id: string }; id?: string }>("POST", `${P}/automations`, f);
    await api("POST", `${P}/automations/${r.workflow?.id ?? r.id}/enable`);
  }

  // ── Chatbot ──
  await api("PUT", `${P}/chatbot`, { enabled: true, name: "Mira", greeting: "Hi, I'm Mira 🌿 Ask me about treatments, prices or opening hours.", instructions: "Be warm and brief. Suggest booking online when someone asks about availability.", handoffEmail: "frontdesk@stillwaters.example", showLauncher: true });
  await api("POST", `${P}/chatbot/sources`, { kind: "text", title: "Spa FAQ", content: `Opening hours: Tuesday to Thursday 10am–7pm, Friday 10am–8pm, Saturday 9am–8pm, Sunday 9am–5pm. Closed on Mondays.
Parking: free parking for guests in the basement — tell the attendant you're visiting the spa.
What to bring: nothing. We provide robes, slippers, towels and lockers.
Arrive 10 minutes before your treatment so you can change and relax.
Cancellations: cancel online up to 24 hours before your booking at no charge.
Gift cards: available at the front desk in any amount, valid for 12 months.
Pregnancy: we offer a gentle pregnancy massage after the first trimester. Please mention it when booking.
Couples retreat: side-by-side massages in the garden suite, 90 minutes, followed by herbal tea.` });
  await api("POST", `${P}/chatbot/sources`, { kind: "text", title: "Treatment guide", content: `Signature deep-tissue massage (60 min, ₹3,500): firm pressure for tight shoulders and back.
Aromatherapy facial (45 min, ₹2,800): steam, essential oils and a hydrating mask. Good for sensitive skin.
Hot stone therapy (90 min, ₹5,200): heated basalt stones and long, slow strokes.
Express foot ritual (30 min, ₹1,200): quick reflexology between meetings.` });

  // ── Data ──
  await api("POST", `${P}/data/tables`, { name: "Memberships", slug: "memberships", description: "Monthly wellness members and their plans", fields: [
    { key: "full_name", name: "Full name", type: "text", required: true },
    { key: "email", name: "Email", type: "email" },
    { key: "plan", name: "Plan", type: "select", options: ["Calm", "Restore", "Ritual"] },
    { key: "visits_left", name: "Visits left", type: "number" },
    { key: "renews_on", name: "Renews on", type: "date" },
    { key: "auto_renew", name: "Auto-renew", type: "boolean" } ] });
  const members: [string, string, number, number, boolean][] = [["Ananya Iyer", "Ritual", 4, 8, true], ["Rohan Kapoor", "Restore", 2, 15, true], ["Meera Pillai", "Calm", 1, 3, false], ["Kabir Sethi", "Ritual", 6, 23, true], ["Tara Menon", "Restore", 3, 6, true], ["Vikram Rao", "Calm", 0, 1, false], ["Isha Banerjee", "Ritual", 5, 27, true], ["Dev Malhotra", "Restore", 2, 12, false], ["Nisha Verma", "Calm", 1, 19, true]];
  await api("POST", `${P}/data/api/memberships`, { rows: members.map(([n, plan, v, d, a]) => ({ full_name: n, email: `${n.toLowerCase().replace(" ", ".")}@example.com`, plan, visits_left: v, renews_on: istDay(d), auto_renew: a })) });
  await api("POST", `${P}/data/tables`, { name: "Gift cards", slug: "gift-cards", description: "Gift cards sold at the front desk", fields: [
    { key: "code", name: "Code", type: "text", required: true }, { key: "amount", name: "Amount (₹)", type: "number" }, { key: "buyer", name: "Bought by", type: "text" }, { key: "redeemed", name: "Redeemed", type: "boolean" } ] });
  await api("POST", `${P}/data/api/gift-cards`, { rows: [{ code: "SW-4821", amount: 5000, buyer: "Priya S.", redeemed: false }, { code: "SW-4822", amount: 3500, buyer: "Arjun M.", redeemed: true }, { code: "SW-4823", amount: 10000, buyer: "Leela K.", redeemed: false }] });

  // ── AI IDE: a small script in the project's files ──
  await api("POST", `${P}/files`, { path: "scripts/gift-cards.js", content: `// Gift card codes for the front desk: SW- plus four digits, never reused.
const used = new Set(["SW-4821", "SW-4822", "SW-4823"]);

function nextCode(last) {
  let n = Number(last.slice(3)) + 1;
  while (used.has(\`SW-\${n}\`)) n++;
  return \`SW-\${n}\`;
}

function balance(amount, redeemed) {
  return Math.max(0, amount - redeemed);
}

console.log("Next code:", nextCode("SW-4823"));
console.log("Balance on SW-4821:", balance(5000, 1800));
` });

  // First production deploy: the site, booking page and chat go live.
  await deploy(api, id);

  // ── Customers book through the booking page ──
  const days = openDays(6);
  const bookings: [string, number, string, string, string][] = [
    ["deep", 0, "11:00", "Ananya Iyer", "Slight lower back pain, please go easy there."],
    ["facial", 0, "15:30", "Meera Pillai", ""],
    ["couples", 1, "10:00", "Rohan & Tara Kapoor", "It's our anniversary!"],
    ["stone", 1, "14:00", "Kabir Sethi", ""],
    ["foot", 1, "17:30", "Nisha Verma", ""],
    ["deep", 2, "10:30", "Vikram Rao", "First visit."],
    ["facial", 2, "12:00", "Isha Banerjee", "Sensitive skin."],
    ["stone", 4, "16:00", "Dev Malhotra", ""],
    ["deep", 5, "15:00", "Zoya Khan", ""],
  ];
  for (const [i, [svc, d, t, name, notes]] of bookings.entries()) {
    const rc = await visitor(900 + i);
    const r = await rc.post(`/api/v1/store/${id}/book`, { headers: ORIGIN, form: { _base: SITE, serviceId: S[svc]!, start: istStart(days[d]!, t), name, email: `${name.split(" ")[0]!.toLowerCase()}@example.com`, phone: `+91 98100 ${String(10000 + i * 7919).slice(0, 5)}`, notes, payment: "none" }, maxRedirects: 0 });
    const loc = r.headers().location ?? "";
    if (!/booked=1/.test(loc)) console.log("booking", name, r.status(), decodeURIComponent(loc).slice(0, 200));
    await rc.dispose();
  }

  // ── Visitors chat with the bot ──
  const chats: (string | { email: string; note: string })[][] = [
    ["What are your opening hours on Sunday?", "Is parking free?"],
    ["Do you do pregnancy massage?"],
    ["How much is the hot stone therapy?", "Can I cancel if something comes up?"],
    [{ email: "leela.k@example.com", note: "Hi! Can we book the garden suite for a bridal group of 6 next month?" }],
  ];
  for (const [i, c] of chats.entries()) {
    const rc = await visitor(950 + i);
    for (const m of c) {
      const form: Record<string, string> = typeof m === "string" ? { _base: SITE, message: m } : { _base: SITE, action: "handoff", email: m.email, note: m.note };
      const r = await rc.post(`/api/v1/store/${id}/chat`, { headers: ORIGIN, form, maxRedirects: 0 });
      if (r.status() >= 400) console.log("chat", r.status(), (await r.text()).slice(0, 200));
    }
    await rc.dispose();
  }

  // ── Growth: an A/B test on the main button, then real visits ──
  const file = await api<{ content?: string; file?: { content: string } }>("GET", `${P}/file?path=site/site.json`);
  const doc = JSON.parse(file.content ?? file.file?.content ?? "{}") as { pages: { id: string; path?: string; sections: { id: string; type: string }[] }[] };
  const home = doc.pages[0]!;
  const sec = (...types: string[]) => types.map((t) => home.sections.find((s) => s.type === t)?.id).find(Boolean) ?? "";
  await api("POST", `${P}/growth/tests`, { path: "/", sectionId: sec("hero"), title: "Main button: “Book an appointment” vs “Find your treatment”", hypothesis: "Inviting people to explore treatments first gets more first-time visitors to start a booking.", metric: "submit", change: { props: { primaryLabel: "Find your treatment" } }, publish: true });
  const enquiries = ["Do you have anything for a stiff neck? I sit at a desk all day.", "Is the couples retreat available on a Sunday?", "Can I buy a gift card online for my mother?", "Do you do pregnancy massage? I'm in my second trimester.", "Is there parking near you?", "Could we book the garden suite for a small bridal group?"];
  const names = ["Aarav", "Diya", "Kiran", "Sana", "Neel", "Ira", "Zoya", "Arjun", "Maya", "Rhea", "Kabir", "Tanvi", "Yash", "Anika", "Veer", "Pooja", "Reyansh", "Aditi", "Farhan", "Nandini"];
  const counts = { A: [0, 0], B: [0, 0] } as Record<string, number[]>;
  for (let i = 0; i < 240; i++) {
    const rc = await visitor(i, UAS[i % 4]);
    const html = await (await rc.get(`${SITE}/`)).text();
    const ab = html.match(/name="_ab" value="(A|B)"/)?.[1];
    if (ab) counts[ab]![0]!++;
    if (i % 3 === 0) await rc.get(`${SITE}/about`);
    const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    // About one visitor in thirteen sends an enquiry.
    if (action && (i * 7919) % 13 === 0) {
      const n = names[i % names.length]!;
      const r = await rc.post(action, { headers: { ...ORIGIN, referer: `${B}${SITE}/` }, form: { ...(ab ? { _ab: ab } : {}), name: n, email: `${n.toLowerCase()}${i}@example.com`, message: enquiries[i % enquiries.length]! }, maxRedirects: 0 });
      if (r.status() < 400) counts[ab ?? "A"]![1]!++;
    }
    await rc.dispose();
  }
  console.log("A/B traffic", JSON.stringify(counts));

  // ── Collaboration: comments, a review link, a branch, invitations ──
  const c1 = await api<{ comment: { id: string } }>("POST", `${P}/collab/comments`, { pageId: home.id, sectionId: sec("hero"), body: "Can we try a warmer photo here? This one feels a bit cold for an evening visit." });
  await api("POST", `${P}/collab/comments`, { pageId: home.id, sectionId: sec("hero"), body: "Good call — swapping in the garden suite shot from last week's shoot.", parentId: c1.comment.id });
  await api("POST", `${P}/collab/comments`, { pageId: home.id, sectionId: sec("features", "split", "services"), body: "Prices on the treatments list need the new Diwali rates before Friday." });
  const c3 = await api<{ comment: { id: string } }>("POST", `${P}/collab/comments`, { pageId: home.id, sectionId: sec("faq", "contact", "cta"), body: "Add a line about free basement parking — guests keep asking." });
  await api("POST", `${P}/collab/comments/${c3.comment.id}/resolve`, { resolved: true });
  await api("POST", `${P}/branches`, { name: "Diwali offers", description: "Festive packages and gift cards, ready to merge on 1 Nov" });
  for (const [mail, role] of [["ravi.designs@example.com", "designer"], ["frontdesk@stillwaters.example", "editor"], ["accounts@stillwaters.example", "billing"]]) await api("POST", `/orgs/${orgId}/invitations`, { email: mail, role });
  // A release with the review comments in (the deploy history shows each one).
  await deploy(api, id);

  // ── Domains: a custom domain that's waiting for its DNS records ──
  let hostname = "";
  for (const h of ["www.stillwaters-spa.in", "www.stillwatersspa.co.in", "www.stillwatersdayspa.in", "www.stillwaterswellness.in", `www.stillwaters${T}.in`]) {
    try {
      await api("POST", `${P}/domains`, { hostname: h });
      hostname = h;
      break;
    } catch (e) {
      console.log("domain", h, String(e).slice(0, 160));
    }
  }
  expect(hostname).not.toBe("");
  // A last deploy so the history shows a few releases.
  await deploy(api, id);
  // The review link shows the latest deployment.
  const review = await api<{ url: string }>("POST", `${P}/collab/review-links`, { label: "Owner review — Diwali update", days: 14 });

  // ════════ Screens ════════
  // Bookings (admin)
  await open(page, `${P}/store/bookings`, 2000);
  await expect(page.getByText("Signature deep-tissue massage").first()).toBeVisible();
  await shoot(page, "bookings", "upcoming");
  await tab(page, "Services");
  await shoot(page, "bookings", "services");
  await tab(page, "Opening hours");
  await shoot(page, "bookings", "hours");

  // Bookings (the public booking page)
  const slotDay = days[3]!;
  await open(page, `${SITE}/book/${S.stone}?date=${slotDay}`, 2000);
  // Frame the day and time pickers, as before.
  await page.evaluate(() => window.scrollTo(0, 95));
  await page.mouse.move(1430, 420);
  await shoot(page, "bookings", "slots");
  await open(page, `${SITE}/book/${S.stone}?date=${slotDay}&time=15:00`, 1500);
  const form = page.locator("form").filter({ hasText: "Confirm booking" }).first();
  await form.scrollIntoViewIfNeeded();
  await page.locator("input[name=name]").fill("Leela Kurian");
  await page.locator("input[name=phone]").fill("+91 98201 44512");
  await page.locator("input[name=email]").fill("leela.k@example.com");
  await page.locator("textarea[name=notes]").fill("Could we have the garden-facing room?");
  await page.locator("textarea[name=notes]").blur();
  await panel(form, "bookings", "form-panel");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UAS[1] });
    const m = await ctx.newPage();
    await open(m, `${B}${SITE}/book/${S.deep}?date=${days[1]}`, 2000);
    await shoot(m, "bookings", "phone-slots");
    await open(m, `${B}${SITE}/book`, 2000);
    await shoot(m, "bookings", "phone-services");
    await ctx.close();
  }

  // Growth
  await open(page, `${P}/growth`, 2500);
  await expect(page.getByText("Find your treatment").first()).toBeVisible();
  await shoot(page, "growth", "overview");
  await page.mouse.move(900, 600);
  await page.mouse.wheel(0, 370);
  await shoot(page, "growth", "ideas", { settle: 1200 });

  // Domains
  await open(page, `${P}/deployments`, 2000);
  // This dev server has no public DNS target set, so the card adds a note for
  // operators; on a configured server it isn't shown. The domain itself is
  // genuinely waiting for DNS.
  await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.children.length < 6 && el.textContent?.startsWith("Platform DNS target not configured")) { el.closest("div.mt-3")?.remove(); break; } });
  await expect(page.getByText(hostname).first()).toBeVisible();
  // The custom domain above the deploy history (production first, older ones can be promoted back).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await shoot(page, "domains", "deployments");
  await page.evaluate(() => window.scrollTo(0, 0));
  const domainCard = page.getByText("Custom domains", { exact: true }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
  await panel(domainCard, "domains", "domain-card");
  await page.getByRole("button", { name: "Log", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByText(/Promoted to production/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await panel(page.getByRole("dialog"), "domains", "log-panel");
  await page.keyboard.press("Escape");

  // Data
  await open(page, `${P}/data`, 2000);
  await expect(page.getByText("Kabir Sethi").first()).toBeVisible();
  await shoot(page, "data", "rows");
  await tab(page, "Fields & access");
  await shoot(page, "data", "fields");
  await tab(page, "API");
  await shoot(page, "data", "api");

  // Chatbot
  await open(page, `${P}/chatbot`, 2000);
  const q = page.getByPlaceholder(/Ask what a visitor/);
  await q.fill("Is there parking near you?");
  await q.press("Enter");
  await page.waitForTimeout(4000);
  await shoot(page, "chatbot", "setup");
  await tab(page, "Knowledge");
  await shoot(page, "chatbot", "knowledge");
  await tab(page, "Conversations");
  await page.getByText(/hot stone/i).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shoot(page, "chatbot", "inbox");

  // Automations
  await open(page, `${P}/automations`, 2000);
  await shoot(page, "automations", "list");
  await page.getByText("Booking confirmed → welcome note").first().click();
  await page.waitForTimeout(1800);
  await shoot(page, "automations", "open");
  await open(page, `${P}/automations`, 1500);
  await page.getByText("Booking confirmed → welcome note").first().locator("xpath=ancestor::*[.//button[normalize-space()='Edit']][1]").getByRole("button", { name: "Edit" }).first().click();
  await page.waitForTimeout(1500);
  await panel(page.getByRole("dialog"), "automations", "editor-panel");
  await page.keyboard.press("Escape");

  // AI IDE
  await open(page, `${P}/ide`, 2500);
  await page.getByText("scripts", { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByText("gift-cards.js", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await tab(page, "Terminal");
  const term = page.getByLabel("Terminal command");
  for (const c of ["ls scripts", "run scripts/gift-cards.js", "validate"]) {
    await term.fill(c);
    await term.press("Enter");
    await page.waitForTimeout(1800);
  }
  // Put the cursor back at the top of the file.
  await page.getByText("// Gift card codes", { exact: false }).first().click();
  await page.keyboard.press("End");
  await shoot(page, "ai-ide", "editor");
  await page.getByRole("button", { name: "Hide assistant" }).click().catch(() => {});
  await page.waitForTimeout(800);
  await shoot(page, "ai-ide", "wide");

  // Collaboration
  await open(page, `${P}/builder`, 3500);
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 4000 }).catch(() => {});
  await page.getByRole("button", { name: /^Comments/ }).first().click();
  await page.waitForTimeout(1800);
  await shoot(page, "collaboration", "comments");
  await page.getByRole("button", { name: "More" }).click();
  await page.waitForTimeout(400);
  await page.getByText("Branches…").click();
  await page.waitForTimeout(1500);
  await shoot(page, "collaboration", "branches");
  await panel(page.getByRole("dialog"), "collaboration", "branches-panel");
  await page.keyboard.press("Escape");
  await open(page, review.url.replace(/^https?:\/\/[^/]+/, ""), 3000);
  await shoot(page, "collaboration", "review");
  await open(page, "/team", 1500);
  await shoot(page, "collaboration", "team");

  // Hostnames are unique across the platform: release this demo's so the next run can use it again.
  const { domains } = await api<{ domains: { id: string; hostname: string }[] }>("GET", `${P}/domains`);
  for (const d of domains) await api("DELETE", `${P}/domains/${d.id}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// The Bread Room: promotions on a bakery's store.
// ─────────────────────────────────────────────────────────────────────────────
test("The Bread Room — promotions", async ({ page, browser }) => {
  const { api, orgId, orgSlug } = await owner(page, "Asha Mehra", `asha.bread.${T}@breadroom-demo.in`, "Asha's Studio");
  const { project } = await api<{ project: { id: string } }>("POST", `/orgs/${orgId}/projects`, { templateId: "store", name: "The Bread Room" });
  const id = project.id;
  const P = `/projects/${id}`;
  await api("POST", `${P}/store/setup`, { name: "The Bread Room", currency: "INR", country: "IN", email: "hello@breadroom.example", template: "bakery", replaceDesign: true });
  const SITE = await sitePath(api, orgSlug, id);

  // Real products (sample products can't be bought), so the cart and its upsells work.
  const img = (p: string) => `https://images.unsplash.com/photo-${p}?auto=format&fit=crop&w=1200&q=80`;
  for (const [title, description, price, photo] of [
    ["Filter coffee powder, 250 g", "South Indian filter blend, 80:20 coffee and chicory, ground fresh.", 32000, "1495474472287-4d71bcdd2085"],
    ["Iced latte", "Double shot over ice with cold milk. Ready with your morning order.", 19000, "1509042239860-f550ce710b93"],
    ["Cappuccino", "Classic cappuccino with velvety foam.", 16000, "1495474472287-4d71bcdd2085"],
    ["House espresso beans", "Chocolatey, low-acid medium roast. Whole bean.", 59900, "1587734195503-904fca47e0e9"],
  ] as const) await api("POST", `${P}/store/products`, { title, description, status: "active", images: [img(photo)], tags: ["coffee"], variants: [{ options: {}, price, trackInventory: false, weightGrams: 250 }] });

  // Promotions: a welcome pop-up, a Diwali bar, free delivery, upsells, a floating button.
  await api("POST", `${P}/store/discounts`, { code: "WELCOME10", kind: "percent", value: 10, oncePerCustomer: true, active: true });
  // Each starts from the app's own preset, then gets the bakery's wording.
  type Promo = { id: string; kind: string; name: string; config: Record<string, unknown>; endsAt?: string | null };
  const fromPreset = async (preset: string, patch: { name?: string; enabled?: boolean; config?: Record<string, unknown>; endsAt?: string | null }) => {
    const { promotion } = await api<{ promotion: Promo }>("POST", `${P}/promotions`, { preset });
    await api("PUT", `${P}/promotions/${promotion.id}`, { kind: promotion.kind, name: patch.name ?? promotion.name, enabled: patch.enabled ?? true, config: { ...promotion.config, ...(patch.config ?? {}) }, startsAt: null, endsAt: patch.endsAt === undefined ? (promotion.endsAt ?? null) : patch.endsAt });
    return promotion.id;
  };
  const welcome = await fromPreset("welcome", { config: { heading: "10% off your first loaf box", body: "Join our list for the weekly bake schedule and members-only treats.", trigger: { type: "delay", delay: 3 } }, endsAt: null });
  await fromPreset("flash", { name: "Diwali hampers", config: { messages: ["Diwali hampers are here — pre-orders close in"], linkLabel: "See hampers", linkHref: "/shop" }, endsAt: new Date(Date.now() + 12 * 86_400_000).toISOString() });
  await fromPreset("festive", { name: "Festive sale", enabled: false, config: { heading: "Up to 30% off festive hampers" } });
  await fromPreset("goal", { name: "Free delivery goal" });
  await fromPreset("upsell", { name: "Pairs well with", config: { heading: "Pairs well with your bake" } });
  await fromPreset("tab", { name: "10% off button", config: { opens: welcome } });
  await deploy(api, id);

  // Visitors see the promotions; some sign up for the welcome offer.
  for (let i = 0; i < 24; i++) {
    const ctx = await browser.newContext({ userAgent: UAS[i % 4], extraHTTPHeaders: { "x-forwarded-for": `10.61.${i}.9` }, viewport: i % 3 ? { width: 1280, height: 800 } : { width: 390, height: 844 } });
    const v = await ctx.newPage();
    await v.goto(`${B}${SITE}/`, { waitUntil: "load" });
    await v.waitForTimeout(4200);
    if (i % 3 === 1) {
      const em = v.locator(".ccp-pop input[type=email]").first();
      if (await em.count()) {
        await em.fill(`reader${i}@example.com`);
        await em.press("Enter", { noWaitAfter: true, timeout: 5000 }).catch(() => {});
        await v.waitForTimeout(1500);
      }
    } else if (i % 5 === 2) {
      await v.locator(".ccp-bar a").first().click({ timeout: 3000 }).catch(() => {});
      await v.waitForTimeout(1200);
    }
    await ctx.close();
  }

  // Admin screens
  await open(page, `${P}/promotions`, 2000);
  await shoot(page, "promotions", "list");
  await page.getByText("Welcome offer", { exact: true }).first().locator("xpath=ancestor::*[.//button[contains(normalize-space(),'Edit')]][1]").getByRole("button", { name: /Edit/ }).first().click();
  await page.waitForTimeout(3500);
  await shoot(page, "promotions", "editor");
  await page.keyboard.press("Escape");
  await open(page, `${P}/store/products`, 2000);
  await page.getByRole("button", { name: "From a photo" }).click({ timeout: 180_000 });
  await page.waitForTimeout(900);
  await panel(page.getByRole("dialog"), "promotions", "photo-panel");

  // The storefront, as a new visitor
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, userAgent: UA });
  // The visitor's address goes only to our own server: an extra header on cross-origin
  // requests (the storefront's web fonts) makes the browser refuse them.
  await ctx.route(`${B}/**`, (r) => r.continue({ headers: { ...r.request().headers(), "x-forwarded-for": "10.62.1.20" } }));
  const v = await ctx.newPage();
  await open(v, `${B}${SITE}/`, 5000);
  await expect(v.locator(".ccp-pop").first()).toBeVisible();
  await shoot(v, "promotions", "popup", { settle: 800 });
  await v.keyboard.press("Escape");
  await v.locator(".ccp-pop [aria-label=Close], .ccp-close").first().click({ timeout: 3000 }).catch(() => {});
  await open(v, `${B}${SITE}/shop`, 1500);
  const href = await v.getByRole("link", { name: /Filter coffee powder/ }).first().getAttribute("href");
  await open(v, `${B}${href}`, 1200);
  await v.getByRole("button", { name: /Add to (cart|bag)/i }).first().click();
  await v.waitForLoadState("networkidle").catch(() => {});
  await open(v, `${B}${SITE}/cart`, 2000);
  await shoot(v, "promotions", "cart");
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Launch: the guided store setup, step by step (nothing is launched).
// ─────────────────────────────────────────────────────────────────────────────
test("Launch — Kora Ceramics", async ({ page }) => {
  await owner(page, "Kavya Raman", `kavya.${T}@kora-demo.in`, "Kora Ceramics");
  const next = async () => {
    await page.getByRole("button", { name: /^(Continue|Skip for now)/ }).last().click();
    await page.waitForTimeout(1800);
  };
  await open(page, "/launch", 2000);
  await shoot(page, "launch", "start");
  await page.getByText("An online store").first().click();
  await page.waitForTimeout(1500);
  await page.getByPlaceholder("Saanjh Studio").fill("Kora Ceramics");
  await page.getByPlaceholder(/Handwoven/).fill("Small-batch stoneware, thrown and glazed by hand in Pondicherry.");
  await page.getByRole("button", { name: /Kiln ceramics/ }).first().click().catch(() => page.locator("button[aria-pressed]").filter({ hasText: /ceramic/i }).first().click());
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.mouse.move(5, 400);
  await shoot(page, "launch", "brand");
  await next();
  await shoot(page, "launch", "products");
  await next();
  await page.waitForTimeout(2500);
  await shoot(page, "launch", "look");
  await next();
  await page.getByLabel("UPI ID").fill("koraceramics@okhdfc").catch(() => {});
  await page.getByLabel("UPI ID").blur().catch(() => {});
  await page.mouse.move(5, 400);
  await shoot(page, "launch", "payments");
  await next(); // your address (the free one)
  await next();
  await expect(page.getByText(/Ready to launch Kora Ceramics/)).toBeVisible();
  await shoot(page, "launch", "ready");
});
