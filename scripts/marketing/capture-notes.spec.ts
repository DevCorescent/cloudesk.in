// Real screenshots of Notes for its feature page: a demo café's notes made
// through the app's own API (folders, a meeting note with a table, live
// calculations and to-dos, a daily note with the day's meeting and task, a
// note on a CRM page), then captured into public/marketing/notes/ and
// public/marketing/phones/notes.jpg.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-notes
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { block } from "../../src/lib/notes/blocks";
import { asVisitor, clean, ip, phoneShots, shoot } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const O = { origin: "http://localhost:3000" };

async function signup(req: APIRequestContext, name: string, email: string, orgName: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, orgName }, headers: { ...O, "x-forwarded-for": ip() } });
  expect(r.status(), await r.text()).toBe(201);
  await req.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O });
  const me = await (await req.get("/api/v1/auth/me")).json();
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, me.user.id));
  return { userId: me.user.id as string, orgId: me.organizations[0].id as string };
}

async function open(page: Page, path: string, settle = 1800) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await clean(page);
  await page.waitForTimeout(settle);
}

test("notes — the editor, a daily note, notes on a page, sharing", async ({ page }) => {
  await asVisitor(page);
  const { userId, orgId } = await signup(page.request, "Meera Iyer", `meera.notes.${T}@saffronsage-demo.in`, "Saffron & Sage");
  const api = async <R,>(method: string, path: string, body?: unknown): Promise<R> => {
    const res = await page.request.fetch(`/api/v1/orgs/${orgId}/notes${path}`, { method, data: body, headers: O });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} notes${path} → ${res.status()}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as R;
  };
  type Made = { note: { id: string } };
  const folder = async (name: string, color: string, icon = "") => (await api<{ folder: { id: string } }>("POST", "/folders", { name, color, icon })).folder.id;

  // ── Folders and notes ──
  const ops = await folder("Operations", "amber", "🍳");
  const clients = await folder("Catering clients", "green", "🤝");
  const team = await folder("Team", "violet", "👥");
  await api("POST", "/folders", { name: "Suppliers", color: "sky", parentId: ops });

  const menu = (await api<Made>("POST", "", { title: "Diwali catering menu", icon: "🪔", folderId: clients, tags: ["catering", "diwali"], content: { blocks: [
    block("callout", "For **Kiran Textiles** — 120 guests, Sat 8 Nov, 7 pm", { tone: "info" }),
    block("h2", "Starters"), block("bullet", "Paneer tikka with mint chutney"), block("bullet", "Dahi ke kebab"), block("bullet", "Masala corn chaat"),
    block("h2", "Mains"), block("bullet", "Dal makhani"), block("bullet", "Veg biryani with raita"), block("bullet", "Butter naan and jeera rice"),
    block("h2", "Sweets"), block("bullet", "Gulab jamun"), block("bullet", "Kesar phirni"),
  ] } })).note.id;

  const meeting = (await api<Made>("POST", "", { title: "Weekly ops meeting", icon: "🤝", folderId: ops, tags: ["meeting", "ops"], content: { blocks: [
    block("callout", "Mon 3 Nov · Meera, Ravi, Anika · kitchen and catering for Diwali week", { tone: "info" }),
    block("h2", "Agenda"), block("number", "Diwali orders — see [[Diwali catering menu]]"), block("number", "Supplier prices for the week"), block("number", "Weekend rota"),
    block("h2", "Supplier prices"),
    block("table", "", { rows: [["Item", "Supplier", "Price / kg", "Change"], ["Paneer", "Gokul Dairy", "₹380", "+5%"], ["Basmati rice", "Shree Traders", "₹110", "—"], ["Ghee", "Gokul Dairy", "₹640", "+8%"], ["Saffron (per g)", "Kashmir Kesar", "₹290", "−3%"]] }),
    block("h2", "Diwali order maths"),
    block("calc", "guests = 120", { lang: "Guests" }),
    block("calc", "per_plate = 650", { lang: "Per plate (₹)" }),
    block("calc", "food = guests * per_plate", { lang: "Food" }),
    block("calc", "total = food + 18% of food", { lang: "With GST" }),
    block("h2", "Decisions"), block("bullet", "Order **paneer** for Diwali week on Wednesday, before prices rise again"), block("bullet", "Keep the ==Saturday brunch== menu as it is"),
    block("h2", "Action items"),
    block("todo", "Ravi: confirm 120 plates with Kiran Textiles by Thursday"),
    block("todo", "Anika: book two extra servers for Saturday", { checked: true }),
    block("todo", "Meera: send the updated quote"),
  ] } })).note.id;

  for (const [title, f, icon, tags, text] of [
    ["SOP: closing the café", ops, "🧭", ["sop"], ["Switch off the tandoor and grill", "Count the till and record it in Point of sale", "Wipe down and sanitise the prep tables"]],
    ["Hiring a line cook", team, "👩‍🍳", ["hiring"], ["2+ years in a busy kitchen", "Tandoor experience preferred", "Trial shift on a Saturday"]],
    ["Ideas for the winter menu", null, "💡", ["menu"], ["Gajar halwa tart", "Masala chai crème brûlée", "Sarson da saag pizza"]],
  ] as const) {
    await api("POST", "", { title, icon, folderId: f, tags, content: { blocks: [block("h2", title.startsWith("SOP") ? "Steps" : "Notes"), ...text.map((t) => block(title.startsWith("SOP") ? "number" : "bullet", t))] } });
  }
  await api("POST", "", { title: "Call with Kiran Textiles", icon: "📞", tags: ["client"], attached: { module: "crm", href: "/crm", label: "CRM" }, content: { blocks: [block("p", "Wants **live counters** for chaat and jalebi. Budget about ₹1 lakh."), block("todo", "Send two menu options by Friday")] } });
  await api("PATCH", `/${meeting}`, { pinned: true, visibility: "view" });

  // The day: a meeting this afternoon and a task due today, for the daily note.
  const [cal] = await db.insert(schema.calCalendars).values({ orgId, ownerId: userId, name: "Work", isDefault: true }).returning();
  const at = (h: number, m = 0) => { const x = new Date(); x.setHours(h, m, 0, 0); return x; };
  await db.insert(schema.calEvents).values([
    { orgId, ownerId: userId, calendarId: cal!.id, uid: `n1-${T}`, title: "Tasting with Kiran Textiles", startsAt: at(15), endsAt: at(16) },
    { orgId, ownerId: userId, calendarId: cal!.id, uid: `n2-${T}`, title: "Supplier call — Gokul Dairy", startsAt: at(11, 30), endsAt: at(12) },
  ]);
  const [proj] = await db.insert(schema.workProjects).values({ orgId, code: `DIW-${T.slice(-3)}`, name: "Diwali catering" } as never).returning();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  await db.insert(schema.workTasks).values({ orgId, projectId: proj!.id, number: 1, title: "Finalise the Diwali menu with the chef", assigneeId: userId, dueDate: today });
  const daily = (await api<Made>("GET", `/daily/${today}`)).note.id;
  void menu;

  // ── Shots ──
  await open(page, `/notes/${meeting}`, 2500);
  await page.getByRole("button", { name: /Elements/ }).click();
  await shoot(page, "notes", "editor", { settle: 1200 });
  await page.getByRole("button", { name: /Elements/ }).click();

  await open(page, `/notes/${daily}`, 2500);
  await shoot(page, "notes", "daily");

  await open(page, `/notes/${meeting}`, 2500);
  // The "/" menu, in an empty line under the decisions.
  const last = page.locator("[role=textbox]").last();
  await last.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await shoot(page, "notes", "slash", { settle: 600 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");

  await page.getByRole("button", { name: /^Share$/ }).click();
  await shoot(page, "notes", "share", { settle: 800 });
  await page.keyboard.press("Escape");

  await open(page, "/crm", 2500);
  await page.getByRole("button", { name: "Notes on this page" }).click();
  await page.getByLabel("Note", { exact: true }).fill("Kiran Textiles: confirm the tasting time for Friday\n- [ ] Ask about the jalebi counter");
  await shoot(page, "notes", "page", { settle: 1200 });

  await phoneShots(page, [[`/notes/${meeting}`, "notes"]]);
});
