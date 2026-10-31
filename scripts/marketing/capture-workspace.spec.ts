// Real screenshots of the everyday workspace — Home, My work, Mail, Calendar,
// Chat and Copilot — for the homepage and their feature pages. A demo
// business with four people is filled through the app's own APIs (mail
// through the real ingest pipeline; the mailboxes are paused so nothing
// reaches a mail server), then captured into public/marketing/<dir>/.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-workspace
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "../../src/db";
import { buildIcs } from "../../src/lib/calendar/ics";
import { encryptSecret } from "../../src/server/security/secrets";
import { ingest } from "../../src/server/mail/sync";
import { clean, ip, shoot, asVisitor } from "./shoot";

const PW = "correct-horse-42";
const T = Date.now().toString(36);
const O = { origin: "http://localhost:3000" };
const day = (d: number, h = 0, m = 0) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, m, 0, 0);
  return x;
};
const isoDay = (d: number) => {
  const x = day(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

type Api = <R = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<R>;
const apiFor = (req: APIRequestContext, orgId: string): Api => async (method, path, body) => {
  const res = await req.fetch(`/api/v1/orgs/${orgId}/${path}`, { method, data: body, headers: O });
  const text = await res.text();
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as never;
};

async function signup(req: APIRequestContext, name: string, email: string, orgName?: string) {
  const r = await req.post("/api/v1/auth/signup", { data: { name, email, password: PW, ...(orgName ? { orgName } : {}) }, headers: { ...O, "x-forwarded-for": ip() } });
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

test.describe.configure({ mode: "serial" });

test("the everyday workspace — home, my work, mail, calendar, chat, copilot", async ({ page, browser }) => {
  // ── People ──
  await asVisitor(page);
  const meera = await signup(page.request, "Meera Iyer", `meera.${T}@saffronsage-demo.in`, "Saffron & Sage");
  const { orgId } = meera;
  const api = apiFor(page.request, orgId);
  const team: Record<string, { userId: string; api: Api }> = {};
  for (const [k, name] of [["ravi", "Ravi Kumar"], ["anika", "Anika Rao"], ["dev", "Dev Malhotra"], ["sana", "Sana Qureshi"]] as const) {
    const ctx = await browser.newContext({ baseURL: process.env.CAPTURE_URL ?? "http://localhost:3000" });
    const u = await signup(ctx.request, name, `${k}.${T}@saffronsage-demo.in`);
    await db.insert(schema.memberships).values({ orgId, userId: u.userId, role: k === "ravi" ? "admin" : "editor" });
    team[k] = { userId: u.userId, api: apiFor(ctx.request, orgId) };
  }
  const R = team.ravi!, A = team.anika!, D = team.dev!, S = team.sana!;

  // ── CRM and work ──
  await api("GET", "crm/meta");
  const taj = (await api<{ contact?: { id: string }; id?: string }>("POST", "crm/contacts", { name: "Priya Menon", email: "priya.menon@tajhotels.com", title: "Head of purchasing" }));
  const tajId = taj.contact?.id ?? taj.id;
  await api("GET", "work/meta").catch(() => {});
  const p1 = await api<{ project?: { id: string }; id?: string }>("POST", "work/projects", { name: "Taj Hotels — new wing", code: "TAJ", status: "active" });
  const p2 = await api<{ project?: { id: string }; id?: string }>("POST", "work/projects", { name: "Diwali catalogue", code: "DIW", status: "active" });
  const pid1 = p1.project?.id ?? p1.id, pid2 = p2.project?.id ?? p2.id;
  for (const [pid, title, due, who] of [
    [pid1, "Send revised quote for 400 dinner sets", isoDay(-1), meera.userId],
    [pid1, "Confirm kiln slots with Moradabad workshop", isoDay(0), meera.userId],
    [pid1, "Sample box to Priya (Taj)", isoDay(1), meera.userId],
    [pid2, "Approve product photos — brass range", isoDay(2), meera.userId],
    [pid2, "Write catalogue copy for linen", isoDay(4), meera.userId],
    [pid2, "Price sheet for wholesale buyers", isoDay(6), R.userId],
  ] as const) await api("POST", "work/tasks", { projectId: pid, title, dueDate: due, assigneeId: who, priority: due <= isoDay(0) ? "high" : "normal" }).catch(() => {});
  if (tajId) await api("POST", "crm/activities", { kind: "task", subject: "Call Priya about delivery dates", contactId: tajId, dueAt: day(0, 16).toISOString() }).catch(() => {});
  await api("POST", "notifications/reminders", { at: `${isoDay(0)}T17:30:00+05:30`, title: "Send GST filing documents to the CA", note: "October return", link: "/accounts" }).catch(() => {});
  await api("POST", "notifications/reminders", { at: `${isoDay(1)}T10:00:00+05:30`, title: "Follow up on Good Earth payment", note: "₹1,26,000 due", link: "/finance" }).catch(() => {});

  // ── Mail (through the real pipeline) ──
  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: meera.userId, name: "Saffron & Sage", address: "meera@saffronsage.in", displayName: "Meera Iyer", provider: "google_workspace", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "meera@saffronsage.in", secretEnc: encryptSecret("demo"), status: "paused", color: "#6366f1", settings: { syncDays: 30, sendDelaySec: 10 } }).returning();
  let uid = 1;
  const mail = async (m: Record<string, unknown>, minsAgo: number) => ingest(acc!, "INBOX", uid++, await new MailComposer({ to: "meera@saffronsage.in", date: new Date(Date.now() - minsAgo * 60_000), ...m } as never).compile().build(), []);
  const ics = buildIcs({ method: "REQUEST", uid: `taj-review-${T}@tajhotels.com`, summary: "Taj — tableware review", description: "Join with Google Meet: https://meet.google.com/taj-revw-new", start: day(1, 11).getTime(), end: day(1, 12).getTime(), organizer: { name: "Priya Menon", email: "priya.menon@tajhotels.com" }, attendees: [{ name: "Meera Iyer", email: "meera@saffronsage.in" }] });
  await mail({ from: "Priya Menon <priya.menon@tajhotels.com>", subject: "Invitation: Taj — tableware review", text: "Looking forward to seeing the samples.", icalEvent: { method: "REQUEST", content: ics } }, 35);
  await mail({ from: "Priya Menon <priya.menon@tajhotels.com>", subject: "Quote for the new wing — 400 sets", text: "Hi Meera,\n\nCould you send the revised quote for 400 dinner sets with saucers? We'd like delivery by 20 November.\n\nThanks,\nPriya" }, 70);
  await mail({ from: "Rohan Gupta <rohan@goodearth.in>", subject: "PO 5512 — 120 brass diyas", text: "Please confirm stock and the dispatch date for PO 5512." }, 140);
  await mail({ from: "Bright Lights Pvt Ltd <billing@brightlights.in>", subject: "Tax invoice BL-204 for October", text: "Please find attached tax invoice BL-204 for ₹38,400 due on 10 November.", attachments: [{ filename: "BL-204.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }] }, 260);
  await mail({ from: "Razorpay <no-reply@razorpay.com>", subject: "Payment received: ₹12,600 from Good Earth", text: "A payment of ₹12,600 was credited to your account." }, 400);
  await mail({ from: "Dev at Third Wave <dev@thirdwave.cafe>", subject: "Stocking your mugs — call this week?", text: "Hi! We'd love to stock your hand-painted mugs in our café. Could we talk this week? I'm free Thursday at 4pm. Zoom: https://us02web.zoom.us/j/8123456789" }, 600);
  await mail({ from: "Chumbak <news@chumbak.com>", subject: "Diwali sale: 40% off everything", html: "<h1>Diwali sale</h1><p>40% off everything.</p>", headers: { "List-Unsubscribe": "<https://chumbak.com/u/1>" } }, 900);
  await mail({ from: "The Ken <newsletter@the-ken.com>", subject: "The week in Indian retail", text: "This week's stories", headers: { "List-Unsubscribe": "<mailto:u@the-ken.com>" } }, 1800);

  // ── Calendar ──
  const cal = await api<{ calendars: { id: string }[] }>("GET", "calendar/meta");
  const work = cal.calendars[0]!.id, personal = cal.calendars[1]!.id;
  const monday = -((new Date().getDay() + 6) % 7);
  const ev = (b: Record<string, unknown>) => api("POST", "calendar/events", { tz: "Asia/Kolkata", calendarId: work, ...b }).catch(() => {});
  await ev({ title: "Team stand-up", start: day(monday, 9, 30).toISOString(), end: day(monday, 9, 45).toISOString(), meetingUrl: "https://meet.google.com/std-abcd-efg", repeat: { freq: "weekly", byDay: [1, 2, 3, 4, 5] }, attendees: [{ email: `ravi.${T}@saffronsage-demo.in`, name: "Ravi Kumar" }, { email: `anika.${T}@saffronsage-demo.in`, name: "Anika Rao" }] });
  await ev({ title: "Pricing review — wholesale", start: day(0, 11).toISOString(), end: day(0, 12).toISOString(), meetingUrl: "https://meet.google.com/prc-revw-abc", attendees: [{ email: `ravi.${T}@saffronsage-demo.in`, name: "Ravi Kumar" }] });
  await ev({ title: "Call with Good Earth", start: day(0, 15).toISOString(), end: day(0, 15, 30).toISOString(), meetingUrl: "https://us02web.zoom.us/j/8765432100", attendees: [{ email: "rohan@goodearth.in", name: "Rohan Gupta" }] });
  await ev({ title: "Workshop visit — Moradabad", start: day(2, 13).toISOString(), end: day(2, 16, 30).toISOString(), location: "Brass Works, Moradabad" });
  await ev({ title: "Catalogue shoot", start: day(3).toISOString(), end: day(4).toISOString(), allDay: true, color: "#db2777" });
  await ev({ title: "Investor update", start: day(4, 16).toISOString(), end: day(4, 17).toISOString(), meetingUrl: "https://meet.google.com/inv-updt-xyz", attendees: [{ email: "kiran@fundpartners.in", name: "Kiran Rao" }] });
  await ev({ calendarId: personal, title: "Yoga", start: day(1, 7).toISOString(), end: day(1, 8).toISOString(), color: "#16a34a" });
  await ev({ title: "Weekly sales review", start: day(-1, 16).toISOString(), end: day(-1, 17).toISOString(), meetingUrl: "https://meet.google.com/wsr-abcd-efg", attendees: [{ email: `ravi.${T}@saffronsage-demo.in`, name: "Ravi Kumar" }, { email: `sana.${T}@saffronsage-demo.in`, name: "Sana Qureshi" }] });

  // ── Chat ──
  const meta = await api<{ channels: { id: string; name: string }[] }>("GET", "chat/meta");
  const general = meta.channels.find((c) => c.name === "general")!.id;
  const sales = (await api<{ channel: { id: string } }>("POST", "chat/channels", { name: "sales", topic: "Pipeline, quotes and big orders", emoji: "💼", color: "#7c3aed", members: [R.userId, A.userId, D.userId] })).channel.id;
  const launch = (await api<{ channel: { id: string } }>("POST", "chat/channels", { name: "diwali-launch", topic: "Catalogue, photos and launch day", emoji: "🪔", color: "#ea580c", members: [A.userId, S.userId, D.userId] })).channel.id;
  for (const x of [R, A, D, S]) await x.api("POST", `chat/presence`, { status: "available" }).catch(() => {});
  await S.api("POST", "chat/presence", { status: "busy", note: "Shooting the catalogue", emoji: "📸" });
  const say = (who: Api, ch: string, body: unknown) => who("POST", `chat/channels/${ch}/messages`, typeof body === "string" ? { body } : body);
  const u = (id: string, name: string) => `@[${name}](u:${id})`;
  await say(api, general, "Good morning, team ☀️ Big week — Taj review tomorrow and the Diwali catalogue goes live Friday. #launch");
  await say(R.api, general, "On it. Stock for the brass range is counted — 1,240 pieces across both store rooms.");
  const quote = (await say(api, sales, `Taj Hotels wants 400 dinner sets for their new wing. ${u(R.userId, "Ravi Kumar")} can you have the revised quote out by tomorrow noon? #taj`)) as { message: { id: string } };
  await say(R.api, sales, { body: "Draft attached in Invoicing — 12% volume discount, delivery in 6 weeks.", parentId: quote.message.id });
  await say(A.api, sales, { body: "Kiln slots confirmed for weeks 2–4 👍", parentId: quote.message.id });
  await say(api, sales, { record: { kind: "invoices", title: "QT/2026-27/0042 · Taj Hotels", sub: "₹4,72,000 · valid till 15 Nov", link: "/finance", module: "Quotation", fields: [{ label: "Items", value: "400 dinner sets" }, { label: "Discount", value: "12%" }, { label: "Status", value: "Sent" }] } });
  const appr = (await say(R.api, sales, { approval: { title: "12% volume discount for Taj Hotels", amount: "₹56,640", details: "400 sets, delivery in 6 weeks — matches what we gave ITC last year.", approvers: [meera.userId] } })) as { message: { id: string } };
  void appr;
  await say(D.api, sales, { decision: { text: "Move hotel clients to net-30 payment terms from November" } });
  await say(A.api, launch, { poll: { question: "Which cover for the Diwali catalogue?", options: [{ id: "a", label: "Brass diyas at dusk" }, { id: "b", label: "Linen table, top view" }, { id: "c", label: "Hand-painted mugs" }] } });
  const launchMeta = await api<{ channels: { id: string; name: string }[] }>("GET", "chat/meta");
  void launchMeta;
  await say(S.api, launch, { checklist: { title: "Launch day", items: [{ id: "1", label: "Photos retouched" }, { id: "2", label: "Prices final" }, { id: "3", label: "Store banner live" }, { id: "4", label: "Newsletter scheduled" }] } });
  await say(S.api, launch, "Photos are 80% done — sharing the selects by 4pm 📸");
  const dm = (await R.api<{ channel: { id: string } }>("POST", `chat/dm/${meera.userId}`)).channel.id;
  await say(R.api, dm, "Quick one — is the Good Earth payment in? Their PO 5512 is waiting on it.");
  // A few reactions and votes, and unread messages for Meera.
  const page1 = await api<{ messages: { id: string; kind: string }[] }>("GET", `chat/channels/${sales}/messages`);
  const dec = page1.messages.find((m) => m.kind === "decision");
  if (dec) {
    await R.api("POST", `chat/messages/${dec.id}/vote`, { choice: "agree" });
    await A.api("POST", `chat/messages/${dec.id}/vote`, { choice: "agree" });
  }
  const poll = (await api<{ messages: { id: string; kind: string }[] }>("GET", `chat/channels/${launch}/messages`)).messages.find((m) => m.kind === "poll");
  if (poll) for (const [x, c] of [[A, "a"], [S, "a"], [D, "b"]] as const) await x.api("POST", `chat/messages/${poll.id}/vote`, { choice: c });
  const first = page1.messages.find((m) => m.kind === "text");
  if (first) for (const [x, e] of [[R, "👍"], [A, "🔥"], [D, "👍"]] as const) await x.api("POST", `chat/messages/${first.id}/react`, { emoji: e });
  await api("POST", `chat/channels/${sales}/read`, {});
  await api("POST", `chat/channels/${general}/read`, {});
  await say(D.api, general, `${u(meera.userId, "Meera Iyer")} the Third Wave café wants a call Thursday at 4 — shall I set it up?`);

  // ── Captures ──
  await page.goto("/home");
  await page.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first().click({ timeout: 3000 }).catch(() => {});
  await open(page, "/home", 3500);
  await shoot(page, "workspace", "home", { settle: 1200 });
  await open(page, "/inbox", 2500);
  await shoot(page, "workspace", "my-work");
  await open(page, "/mail", 2500);
  await expect(page.getByTestId("mail-thread-row").first()).toBeVisible();
  await shoot(page, "workspace", "mail");
  await page.getByTestId("mail-thread-row").filter({ hasText: "Invitation: Taj" }).first().click();
  await shoot(page, "workspace", "mail-meeting", { settle: 2200 });
  await open(page, "/calendar", 2500);
  await shoot(page, "calendar", "week");
  await page.getByRole("button", { name: /Pricing review/ }).first().click().catch(() => {});
  await shoot(page, "calendar", "event", { settle: 1200 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await shoot(page, "calendar", "month", { settle: 1500 });
  await open(page, `/chat/${sales}`, 2500);
  await shoot(page, "chat", "channel");
  await page.getByRole("button", { name: /2 replies/ }).first().click().catch(() => {});
  await shoot(page, "chat", "thread", { settle: 1500 });
  await open(page, `/chat/${launch}`, 2500);
  await shoot(page, "chat", "interactive");
  await open(page, "/chat", 2500);
  await shoot(page, "chat", "home");
  await open(page, "/copilot", 2500);
  await shoot(page, "workspace", "copilot");

  // The same workspace on a phone: the app's own mobile layout (402×874 at 3×).
  const phone = await browser.newContext({ baseURL: process.env.CAPTURE_URL ?? "http://localhost:3000", viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", storageState: await page.context().storageState() });
  const m = await phone.newPage();
  for (const [path, name, settle] of [["/home", "m-home", 3000], ["/inbox", "m-my-work", 2000], ["/mail", "m-mail", 2500], ["/calendar", "m-calendar", 2500], [`/chat/${sales}`, "m-chat", 2500], ["/copilot", "m-copilot", 2000]] as const) {
    await open(m, path, settle);
    await shoot(m, "workspace", name, { settle: 600 });
  }
  await phone.close();
});
