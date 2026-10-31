// Re-shoots the HR & payroll and Inventory feature-page screenshots with the
// current sidebar (Mail, Calendar and Chat with their badges). Two demo
// workspaces are signed up and filled through the app's own APIs:
//   • Saffron House — a Mumbai restaurant-and-events business with 14 people
//     (their October attendance before today is inserted as demo data; leave,
//     claims, payroll, hiring, reviews and assets go through the API).
//   • Kiln & Co — a ceramics studio whose online-store products are brought
//     into Inventory with one click, with suppliers, purchase orders,
//     deliveries, transfers and a count made through the API.
// A little mail (through the real ingest pipeline, mailbox paused) and chat
// from teammates give the sidebar its unread badges.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-suite-b
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "../../src/db";
import { buildIcs } from "../../src/lib/calendar/ics";
import { ingest } from "../../src/server/mail/sync";
import { encryptSecret } from "../../src/server/security/secrets";
import { clean, ip, shoot, phoneShots, asVisitor } from "./shoot";

const BASE = process.env.CAPTURE_URL ?? "http://localhost:3000";
const PW = "correct-horse-42";
const T = Date.now().toString(36);
const O = { origin: BASE };

/** Today's date in India, and days around it. */
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const isoDay = (offset = 0) => new Date(istNow().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = isoDay(0);
const MONTH = TODAY.slice(0, 7);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const prevMonth = (() => {
  const [y, m] = MONTH.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

type Api = <R = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<R>;
const apiFor = (req: APIRequestContext, orgId: string): Api => async (method, path, body) => {
  const res = await req.fetch(`/api/v1/orgs/${orgId}/${path}`, { method, data: body, headers: O, timeout: 180_000 });
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

/** A teammate with their own sign-in, added to the workspace. */
async function teammate(browser: Browser, orgId: string, name: string, email: string, role: "admin" | "editor" | "employee") {
  const ctx = await browser.newContext({ baseURL: BASE });
  const u = await signup(ctx.request, name, email);
  await db.insert(schema.memberships).values({ orgId, userId: u.userId, role });
  return { userId: u.userId, api: apiFor(ctx.request, orgId), ctx };
}

async function open(page: Page, path: string, ready?: string | RegExp, settle = 1500) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (ready) {
    // The shared dev server is sometimes busy compiling; try a reload before giving up.
    const ok = await expect(page.getByText(ready).first()).toBeVisible({ timeout: 45_000 }).then(() => true, () => false);
    if (!ok) {
      await page.reload();
      await expect(page.getByText(ready).first()).toBeVisible({ timeout: 90_000 });
    }
  }
  await clean(page);
  await page.waitForTimeout(settle);
}

/** Unread mail and a meeting invite, through the real ingest pipeline (the mailbox is paused). */
async function seedMail(api: Api, orgId: string, ownerId: string, address: string, display: string, mails: { from: string; subject: string; text: string; ago: number; invite?: { title: string; dayOffset: number; hour: number } }[]) {
  await api("GET", "calendar/meta").catch(() => {});
  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId, name: display, address, displayName: display, provider: "google_workspace", imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: address, secretEnc: encryptSecret("demo"), status: "paused", color: "#6366f1", settings: { syncDays: 30, sendDelaySec: 10 } } as never).returning();
  let uid = 1;
  for (const m of mails) {
    const extra: Record<string, unknown> = {};
    if (m.invite) {
      const start = at(isoDay(m.invite.dayOffset), `${String(m.invite.hour).padStart(2, "0")}:00`).getTime();
      const fromEmail = m.from.match(/<(.+)>/)?.[1] ?? m.from;
      const fromName = m.from.split(" <")[0]!;
      extra.icalEvent = { method: "REQUEST", content: buildIcs({ method: "REQUEST", uid: `${T}-${uid}@demo.in`, summary: m.invite.title, description: "Join with Google Meet: https://meet.google.com/abc-defg-hij", start, end: start + 3_600_000, organizer: { name: fromName, email: fromEmail }, attendees: [{ name: display, email: address }] }) };
    }
    await ingest(acc as never, "INBOX", uid++, await new MailComposer({ to: address, from: m.from, subject: m.subject, text: m.text, date: new Date(Date.now() - m.ago * 60_000), ...extra } as never).compile().build(), []);
  }
}

test.describe.configure({ mode: "serial" });

// ─────────────────────────────────────────────────────────────────────────────
// HR & payroll
// ─────────────────────────────────────────────────────────────────────────────
test("hrms — Saffron House", async ({ page, browser }) => {
  await asVisitor(page);
  const ownerEmail = `asha.${T}@saffronhouse-demo.in`;
  const owner = await signup(page.request, "Asha Mehra", ownerEmail, "Saffron House");
  const { orgId } = owner;
  const api = apiFor(page.request, orgId);
  await api("PUT", "modules", { modules: ["hr", "crm", "invoicing", "mail", "calendar", "chat"] });

  // Two people who sign in themselves (they ask for leave, claim expenses and write self reviews).
  const priyaEmail = `priya.${T}@saffronhouse-demo.in`;
  const rohanEmail = `rohan.${T}@saffronhouse-demo.in`;
  const P = await teammate(browser, orgId, "Priya Nair", priyaEmail, "employee");
  const R = await teammate(browser, orgId, "Rohan Mehta", rohanEmail, "editor");

  // ── Set-up ──
  const meta = await api<{ leaveTypes: { id: string; code: string }[] }>("GET", "hr/meta");
  const lt = Object.fromEntries(meta.leaveTypes.map((t) => [t.code, t.id]));
  await api("PUT", "hr/settings", { company: { legalName: "Saffron House Hospitality Pvt Ltd", address: "14 Linking Road, Bandra West, Mumbai 400050", pan: "AAKCS4821M", tan: "MUMS21458C", pfCode: "MHBAN0045821000", esiCode: "31000458210001002", signatory: "Asha Mehra", signatoryTitle: "Director" } });
  const dept: Record<string, string> = {};
  for (const name of ["Operations", "Sales", "Kitchen", "Service", "Front office"]) dept[name] = (await api<{ department: { id: string } }>("POST", "hr/departments", { name })).department.id;
  const loc: Record<string, string> = {};
  loc.bandra = (await api<{ location: { id: string } }>("POST", "hr/locations", { name: "Mumbai — Bandra", address: "14 Linking Road, Bandra West, Mumbai 400050", state: "MH" })).location.id;
  loc.pune = (await api<{ location: { id: string } }>("POST", "hr/locations", { name: "Pune — Koregaon Park", address: "Lane 6, Koregaon Park, Pune 411001", state: "MH" })).location.id;
  const year = TODAY.slice(0, 4);
  for (const [date, name] of [[`${year}-01-26`, "Republic Day"], [`${year}-03-04`, "Holi"], [`${year}-05-01`, "Maharashtra Day"], [`${year}-08-15`, "Independence Day"], [`${year}-09-14`, "Ganesh Chaturthi"], [`${year}-10-02`, "Gandhi Jayanti"], [`${year}-10-20`, "Dussehra"], [`${year}-11-09`, "Diwali"], [`${year}-12-25`, "Christmas"]] as const) await api("POST", "hr/holidays", { date, name }).catch(() => {});

  // ── People ──
  type Person = [key: string, name: string, designation: string, dept: string, loc: "bandra" | "pune", managerKey: string | null, ctcLakh: number, join: string, dob: string, gender: "female" | "male", email?: string];
  const people: Person[] = [
    ["asha", "Asha Mehra", "Founder & Director", "Operations", "bandra", null, 36, "2019-04-01", "1985-10-28", "female", ownerEmail],
    ["vikram", "Vikram Shah", "General Manager", "Operations", "bandra", "asha", 18, "2020-02-03", "1982-03-11", "male"],
    ["rohan", "Rohan Mehta", "Sales Manager", "Sales", "bandra", "asha", 14.4, "2021-06-14", "1990-10-29", "male", rohanEmail],
    ["priya", "Priya Nair", "Account Executive", "Sales", "bandra", "rohan", 7.2, "2023-07-10", "1996-05-21", "female", priyaEmail],
    ["kunal", "Kunal Desai", "Head Chef", "Kitchen", "bandra", "vikram", 12, "2020-09-01", "1987-12-04", "male"],
    ["imran", "Imran Khan", "Sous Chef", "Kitchen", "bandra", "kunal", 6, "2022-01-17", "1993-07-19", "male"],
    ["meena", "Meena Pillai", "Line Cook", "Kitchen", "bandra", "kunal", 2.6, "2024-03-04", "1999-02-08", "female"],
    ["rohit", "Rohit Verma", "Floor Captain", "Service", "bandra", "vikram", 4.2, "2022-08-01", "1994-10-31", "male"],
    ["neha", "Neha Kulkarni", "Cashier", "Service", "bandra", "rohit", 3, "2023-11-06", "1998-06-25", "female"],
    ["arjun", "Arjun Rao", "Steward", "Service", "bandra", "rohit", 2.4, "2024-07-15", "2000-01-30", "male"],
    ["sana", "Sana Qureshi", "Front Office Executive", "Front office", "pune", "vikram", 4.8, "2023-04-03", "1997-09-14", "female"],
    ["dev", "Dev Patel", "HR & Admin Executive", "Operations", "bandra", "asha", 5.4, "2022-05-02", "1995-04-22", "male"],
    ["kavya", "Kavya Iyer", "Marketing Associate", "Sales", "pune", "rohan", 4.8, isoDay(-14), "1998-08-30", "female"],
    ["farhan", "Farhan Ali", "Bartender", "Service", "bandra", "rohit", 3.6, "2023-02-13", "1996-11-18", "male"],
  ];
  const E: Record<string, string> = {};
  const banks = ["HDFC0000123", "ICIC0001842", "KKBK0000654", "SBIN0004512", "UTIB0000221"];
  for (const [i, [key, name, designation, d, l, mgr, lakh, join, dob, gender, email]] of people.entries()) {
    const first = name.split(" ")[0]!.toLowerCase();
    const emp = await api<{ employee: { id: string } }>("POST", "hr/people", {
      name, designation, departmentId: dept[d], locationId: loc[l], managerId: mgr ? E[mgr] : null, joinDate: join, dob, gender,
      email: email ?? `${first}@saffronhouse.in`, phone: `+91 98${String(20000000 + i * 1234567).slice(0, 8)}`,
      ctc: Math.round(lakh * 100_000 * 100),
      probationEnd: key === "kavya" ? isoDay(78) : null,
      bank: { name, account: `5010${String(1031678924 + i * 7919).slice(0, 10)}`, ifsc: banks[i % banks.length] },
      ids: { pan: `ABC${"DEFGHJKLMNPQRS"[i]}E${String(1148 + i * 37).slice(0, 4)}F`, uan: `1009000${String(6868 + i * 113).padStart(5, "0")}`, aadhaarLast4: String(1452 + i * 311).slice(-4) },
    });
    E[key] = emp.employee.id;
  }
  // Their work addresses (the sign-in stays linked by account, not email).
  for (const k of ["asha", "priya", "rohan"]) await api("PUT", `hr/people/${E[k]}`, { email: `${k}@saffronhouse.in` });
  // Farhan has resigned; Kavya's joining is part done.
  await api("POST", `hr/people/${E.farhan}/exit`, { lastDay: isoDay(30), reason: "Moving to Goa to start his own bar" });
  for (const item of ["o0", "o1", "o2"]) await api("POST", `hr/people/${E.kavya}/checklist`, { kind: "onboarding", itemId: item, done: true });

  // ── Assets ──
  const assets: [string, string, string, string, number, string | null][] = [
    ["MacBook Air 13\" M3", "LAP-001", "C02XK1M3Q6L4", "laptop", 114900, "asha"],
    ["MacBook Air 13\" M2", "LAP-002", "C02WJ8M2P1L9", "laptop", 89900, "rohan"],
    ["Dell Latitude 5440", "LAP-003", "7HKD2X3", "laptop", 72000, "priya"],
    ["iPhone 15", "PHN-001", "F2LXK9QW1P", "phone", 69900, "vikram"],
    ["Samsung Galaxy A35 (till)", "PHN-002", "R58W31ABCD", "phone", 30999, "neha"],
    ["Dell 24\" monitor", "MON-001", "CN0P2422H", "monitor", 14500, null],
    ["Staff ID card", "ID-014", "", "id_card", 0, "farhan"],
  ];
  for (const [name, tag, serial, category, value, who] of assets) {
    const a = await api<{ asset: { id: string } }>("POST", "hr/assets", { name, tag, serial, category, value: value * 100 });
    if (who) await api("POST", `hr/assets/${a.asset.id}/assign`, { employeeId: E[who] });
  }

  // ── Attendance: this month before today (demo data), and today ──
  const hol = new Set([`${year}-10-02`, `${year}-10-20`, `${year}-11-09`, `${year}-09-14`]);
  const leaveDays = new Map<string, Set<string>>([["imran", new Set([isoDay(-11), isoDay(-10)])], ["neha", new Set([isoDay(-17)])], ["arjun", new Set([isoDay(-23)])]]);
  const absent = new Map<string, string>([["meena", isoDay(-13)]]);
  const rows: (typeof schema.hrAttendance.$inferInsert)[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const [key, , , , , , , join] of people) {
    for (let d = Number(TODAY.slice(8, 10)) - 1; d >= 1; d--) {
      const date = `${MONTH}-${String(d).padStart(2, "0")}`;
      if (date < join || hol.has(date) || new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
      if (leaveDays.get(key)?.has(date)) continue;
      if (absent.get(key) === date) {
        rows.push({ orgId, employeeId: E[key]!, date, status: "absent", minutes: 0, source: "manual" });
        continue;
      }
      const late = rnd() < 0.12;
      const inMin = late ? 9 * 60 + 47 + Math.floor(rnd() * 25) : 9 * 60 + 5 + Math.floor(rnd() * 22);
      const outMin = 18 * 60 + 30 + Math.floor(rnd() * 50);
      const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      rows.push({ orgId, employeeId: E[key]!, date, checkIn: at(date, hm(inMin)), checkOut: at(date, hm(outMin)), minutes: outMin - inMin, status: "present", late, source: "web" });
    }
  }
  const todayIn: [string, string, boolean][] = [["asha", "09:18", false], ["vikram", "09:18", false], ["dev", "09:21", false], ["imran", "09:32", false], ["kavya", "09:08", false], ["kunal", "09:23", false], ["meena", "09:56", true], ["neha", "09:39", false], ["priya", "09:26", false], ["rohan", "10:04", true], ["rohit", "09:14", false]];
  for (const [key, hhmm, late] of todayIn) rows.push({ orgId, employeeId: E[key]!, date: TODAY, checkIn: at(TODAY, hhmm), status: "present", late, source: "web" });
  await db.insert(schema.hrAttendance).values(rows);

  // ── Leave ──
  await api("POST", "hr/leave", { employeeId: E.imran, leaveTypeId: lt.CL, fromDate: isoDay(-11), toDate: isoDay(-10), reason: "Family function in Lucknow" });
  await api("POST", "hr/leave", { employeeId: E.neha, leaveTypeId: lt.SL, fromDate: isoDay(-17), toDate: isoDay(-17), reason: "Viral fever" });
  await api("POST", "hr/leave", { employeeId: E.arjun, leaveTypeId: lt.LOP, fromDate: isoDay(-23), toDate: isoDay(-23), reason: "Personal" });
  await api("POST", "hr/leave", { employeeId: E.sana, leaveTypeId: lt.CL, fromDate: TODAY, toDate: TODAY, reason: "Visa appointment" });
  await api("POST", "hr/leave", { employeeId: E.kunal, leaveTypeId: lt.EL, fromDate: isoDay(2), toDate: isoDay(4), reason: "Diwali at home in Surat" });
  // Asked for by the people themselves — these wait for approval.
  await R.api("POST", "hr/leave", { leaveTypeId: lt.CL, fromDate: isoDay(4), toDate: isoDay(4), reason: "Bank work" });
  await P.api("POST", "hr/leave", { leaveTypeId: lt.EL, fromDate: isoDay(7), toDate: isoDay(11), reason: "Sister's wedding in Kochi" });

  // ── Claims ──
  await P.api("POST", "hr/claims", { category: "Client entertainment", amount: 286000, date: isoDay(-5), description: "Lunch with Kestrel Foods procurement" });
  const rc = await R.api<{ claim: { id: string } }>("POST", "hr/claims", { category: "Travel", amount: 345000, date: isoDay(-12), description: "Cab to Thane for the Mehta wedding site visit" });
  await api("POST", `hr/claims/${rc.claim.id}/decide`, { action: "approve" });

  // ── Payroll: last month paid, this month a draft ──
  const sep = await api<{ run: { id: string } }>("POST", "hr/payroll", { month: prevMonth });
  await api("POST", `hr/payroll/${sep.run.id}/finalise`, {});
  await api("POST", `hr/payroll/${sep.run.id}/paid`, {}).catch((e) => console.log(String(e).slice(0, 200)));
  const oct = await api<{ run: { id: string } }>("POST", "hr/payroll", { month: MONTH });
  await api("PUT", `hr/payroll/${oct.run.id}/slips/${E.kunal}`, { adjustments: [{ label: "Diwali bonus", amount: 1_500_000, kind: "earning" }] });
  for (const k of ["imran", "rohit", "neha", "arjun", "meena"]) await api("PUT", `hr/payroll/${oct.run.id}/slips/${E[k]}`, { adjustments: [{ label: "Diwali bonus", amount: 500_000, kind: "earning" }] });
  const run = await api<{ slips: { id: string; employeeId: string }[] }>("GET", `hr/payroll/${oct.run.id}`);
  const kunalSlip = run.slips.find((x) => x.employeeId === E.kunal)!.id;

  // ── Hiring ──
  const chef = (await api<{ job: { id: string } }>("POST", "hr/jobs", { title: "Commis Chef", departmentId: dept.Kitchen, locationId: loc.bandra, openings: 2, salaryRange: "₹2.4–3 lakh a year", description: "Join a busy North-Indian kitchen in Bandra. You'll prep, cook on the line and learn the tandoor from our head chef.\n\nTwo years in a professional kitchen; FSSAI food-safety basics." })).job.id;
  const gre = (await api<{ job: { id: string } }>("POST", "hr/jobs", { title: "Guest Relations Executive", departmentId: dept["Front office"], locationId: loc.pune, salaryRange: "₹3.6–4.2 lakh a year", description: "Welcome guests at our Koregaon Park venue, manage reservations and look after events on the day." })).job.id;
  await api("POST", "hr/jobs", { title: "Sales Executive — Events", departmentId: dept.Sales, locationId: loc.bandra, salaryRange: "₹4.8–6 lakh a year", description: "Sell weddings, corporate dinners and private events across Mumbai." });
  const cand: [string, string, string, string, number, string][] = [
    [chef, "Pooja Sawant", "pooja.sawant@gmail.com", "careers", 0, "applied"],
    [chef, "Akash Jadhav", "akash.j@gmail.com", "walk-in", 3, "screening"],
    [chef, "Sameer Shaikh", "sameer.shaikh@outlook.com", "referral", 4, "interview"],
    [chef, "Ritu Bhosale", "ritu.bhosale@gmail.com", "Naukri", 5, "offer"],
    [chef, "Vivek Gaikwad", "vivek.g@yahoo.in", "Naukri", 2, "screening"],
    [gre, "Tanvi Joshi", "tanvi.joshi@gmail.com", "LinkedIn", 4, "interview"],
    [gre, "Aditi More", "aditi.more@gmail.com", "careers", 3, "applied"],
  ];
  for (const [jobId, name, email, source, rating, stage] of cand) {
    const c = await api<{ candidate: { id: string } }>("POST", "hr/candidates", { jobId, name, email, phone: "+91 98200 1" + String(name.length * 7919).slice(0, 4), source, rating, expectedCtc: 28_000_000 });
    if (stage !== "applied") await api("POST", `hr/candidates/${c.candidate.id}/move`, { stage });
  }

  // ── Performance ──
  for (const [k, title, progress, due, status] of [
    ["imran", "Cut food waste below 4% of purchases", 80, isoDay(35), "on_track"],
    ["rohit", "Average table turn under 70 minutes on weekends", 45, isoDay(50), "behind"],
    ["priya", "Win back 10 lapsed corporate clients", 30, isoDay(66), "at_risk"],
    ["priya", "Close ₹40 lakh of new catering contracts", 55, isoDay(66), "on_track"],
    ["rohan", "Grow events revenue 25% over last year", 62, isoDay(156), "on_track"],
    ["kunal", "Launch the winter tasting menu", 70, isoDay(20), "on_track"],
  ] as const) await api("POST", "hr/goals", { employeeId: E[k], title, progress, dueDate: due, status });
  await api("POST", "hr/reviews", { cycle: `${year} H2` });
  const revs = await R.api<{ reviews: { id: string; employeeId: string }[] }>("GET", "hr/reviews");
  await R.api("POST", `hr/reviews/${revs.reviews.find((r) => r.employeeId === E.rohan)!.id}/submit`, { rating: 4, note: "Events revenue up 22% so far; two new corporate accounts." });
  await api("POST", `hr/reviews/${revs.reviews.find((r) => r.employeeId === E.rohan)!.id}/submit`, { rating: 5, note: "Outstanding half — the Diwali corporate season is fully booked." });
  const prevs = await P.api<{ reviews: { id: string; employeeId: string }[] }>("GET", "hr/reviews");
  await P.api("POST", `hr/reviews/${prevs.reviews.find((r) => r.employeeId === E.priya)!.id}/submit`, { rating: 4, note: "Closed Kestrel Foods and the Bandra Gymkhana annual dinner." });

  // ── Sidebar badges: chat from teammates, unread mail and an invite ──
  const chatMeta = await api<{ channels: { id: string; name: string }[] }>("GET", "chat/meta");
  const general = chatMeta.channels.find((c) => c.name === "general")?.id;
  if (general) {
    await R.api("POST", `chat/channels/${general}/messages`, { body: "Diwali corporate dinners: 6 of 8 Saturdays booked 🎉" }).catch((e) => console.log(String(e).slice(0, 200)));
    await P.api("POST", `chat/channels/${general}/messages`, { body: `@[Asha Mehra](u:${owner.userId}) Kestrel Foods signed the annual catering contract!` }).catch((e) => console.log(String(e).slice(0, 200)));
  }
  await seedMail(api, orgId, owner.userId, "asha@saffronhouse.in", "Asha Mehra", [
    { from: "Nikhil Rao <nikhil@kestrelfoods.in>", subject: "Invitation: Annual catering review", text: "Looking forward to it.", ago: 40, invite: { title: "Kestrel Foods — catering review", dayOffset: 1, hour: 11 } },
    { from: "Anjali Kapoor <anjali@bandragym.in>", subject: "Annual dinner — final headcount 240", text: "Hi Asha, confirming 240 guests for the 14th. Menu B, please." },
    { from: "CA Suresh Iyer <suresh@iyerassociates.in>", subject: "PF and ESI challans for October", text: "Please share the October payroll register so we can file the challans.", ago: 180 },
    { from: "Naukri <alerts@naukri.com>", subject: "12 new applicants for Commis Chef", text: "New applicants are waiting.", ago: 300 },
  ].map((m) => ({ ago: 90, ...m })));

  // ── Captures ──
  const dir = "hrms";
  await open(page, "/hr", "Waiting for you");
  await shoot(page, dir, "home");
  await open(page, "/hr/me", "Attendance");
  await shoot(page, dir, "me");
  await open(page, "/hr/people", "Vikram Shah");
  await shoot(page, dir, "people");
  await open(page, `/hr/people/${E.priya}`, "Joining checklist");
  await shoot(page, dir, "person");
  await open(page, `/hr/people/${E.priya}/pay`, "Cost to company");
  await shoot(page, dir, "person-pay");
  await open(page, `/hr/people/${E.kavya}`, "Joining checklist");
  await shoot(page, dir, "person-new");
  await open(page, "/hr/chart", "Vikram Shah");
  await shoot(page, dir, "chart");
  await open(page, "/hr/attendance", "Meena Pillai");
  await shoot(page, dir, "attendance");
  await page.getByRole("tab", { name: "Month" }).or(page.getByRole("button", { name: "Month", exact: true })).first().click();
  await expect(page.getByText("CSV").first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, dir, "attendance-month", { settle: 1800 });
  await open(page, "/hr/leave", "Sister's wedding");
  await shoot(page, dir, "leave");
  await page.getByRole("tab", { name: "Who's off" }).or(page.getByRole("button", { name: "Who's off", exact: true })).first().click();
  await page.waitForTimeout(1500);
  await shoot(page, dir, "leave-calendar", { settle: 1500 });
  await open(page, "/hr/payroll", prevMonth === MONTH ? "Payroll" : /Paid|Draft/);
  await shoot(page, dir, "payroll");
  await open(page, `/hr/payroll/${oct.run.id}`, "Kunal Desai");
  await shoot(page, dir, "run");
  await open(page, `/hr/payslips/${kunalSlip}`, "Diwali bonus");
  await shoot(page, dir, "payslip");
  await open(page, "/hr/claims", "Kestrel Foods");
  await shoot(page, dir, "claims");
  await open(page, "/hr/hiring", "Commis Chef");
  await shoot(page, dir, "hiring");
  await open(page, `/hr/hiring/${chef}`, "Ritu Bhosale");
  await shoot(page, dir, "job");
  await open(page, "/hr/performance", "Cut food waste");
  await shoot(page, dir, "goals");
  await page.getByRole("tab", { name: "Reviews" }).or(page.getByRole("button", { name: "Reviews", exact: true })).first().click();
  await page.waitForTimeout(1500);
  await shoot(page, dir, "reviews", { settle: 1500 });
  await open(page, "/hr/assets", "Dell Latitude 5440");
  await shoot(page, dir, "assets");
  await open(page, "/hr/reports", "Headcount");
  await shoot(page, dir, "reports", { settle: 2500 });
  await open(page, "/hr/settings/leave", "Casual leave");
  await shoot(page, dir, "settings-leave");
  await open(page, "/hr/settings/payroll", "Provident fund");
  await shoot(page, dir, "settings-payroll");
  // The public careers page.
  const careersUrl = (await api<{ careersUrl: string }>("GET", "hr/jobs")).careersUrl;
  await open(page, new URL(careersUrl).pathname, "Commis Chef");
  await page.getByText("Commis Chef").first().click();
  await expect(page.getByText("Your name").first()).toBeVisible({ timeout: 30_000 });
  await shoot(page, dir, "careers");
  await P.ctx.close();
  await R.ctx.close();
  await phoneShots(page, [["/hr", "hrms"]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventory & purchasing
// ─────────────────────────────────────────────────────────────────────────────
test("inventory — Kiln & Co", async ({ page, browser }) => {
  await asVisitor(page);
  const owner = await signup(page.request, "Ira Sen", `ira.${T}@kilnandco-demo.in`, "Kiln & Co");
  const { orgId } = owner;
  const api = apiFor(page.request, orgId);
  await api("PUT", "modules", { modules: ["inventory", "store", "invoicing", "mail", "calendar", "chat"] });
  const team = await teammate(browser, orgId, "Kabir Malhotra", `kabir.${T}@kilnandco-demo.in`, "editor");

  // ── The online store and its products ──
  const created = await (await page.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "store", name: "Kiln & Co" }, headers: O })).json();
  const pid = created.project.id as string;
  const S = async <R = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<R> => {
    const r = await page.request.fetch(`/api/v1/projects/${pid}/store/${path}`, { method, data: body, headers: O, timeout: 180_000 });
    const t = await r.text();
    if (!r.ok()) throw new Error(`${method} store/${path} → ${r.status()}: ${t.slice(0, 300)}`);
    return (t ? JSON.parse(t) : {}) as R;
  };
  await S("POST", "setup", { name: "Kiln & Co", currency: "INR", country: "IN", region: "Maharashtra", email: "" });
  // Clear any sample products, then add the studio's own.
  const sample = await S<{ products: { id: string }[] }>("GET", "products").catch(() => ({ products: [] }));
  for (const p of sample.products) await S("DELETE", `products/${p.id}`).catch(() => {});
  const products: [string, number, number, number][] = [
    ["Charcoal bottle vases", 950, 300, 5],
    ["Everyday dinner set", 5400, 2100, 6],
    ["Reactive-glaze plate stack", 2600, 950, 7],
    ["Speckled stoneware cup set", 2200, 880, 10],
    ["Twin bud vases", 1100, 360, 8],
  ];
  for (const [title, price, cost, stock] of products) await S("POST", "products", { title, status: "active", vendor: "Ceramics", hsn: "6912", taxBps: 1800, kind: "physical", variants: [{ options: {}, price: price * 100, cost: cost * 100, trackInventory: true, stock }] });

  // ── Locations ──
  await api("GET", "inventory/meta");
  const wh = (await api<{ warehouses: { id: string }[] }>("GET", "inventory/warehouses")).warehouses[0]!.id;
  await api("PUT", `inventory/warehouses/${wh}`, { name: "Bhiwandi warehouse", code: "BHW", address: "Unit 14, Rahnal, Bhiwandi 421302", state: "MH", isDefault: true });
  const linked = await api<{ warehouseId: string }>("POST", "inventory/link-store", { projectId: pid });
  const shop = linked.warehouseId;
  await api("PUT", `inventory/warehouses/${shop}`, { name: "Kiln & Co — Bandra shop", code: "BND", address: "The store's own shelf — its stock is what the shop sells", state: "MH", projectId: pid });
  const popup = (await api<{ warehouse: { id: string } }>("POST", "inventory/warehouses", { name: "Pune pop-up", code: "PUN", address: "Koregaon Park Lane 6", state: "MH" })).warehouse.id;

  // ── Items ──
  const items: Record<string, string> = {};
  const all = await api<{ items: { id: string; name: string }[] }>("GET", "inventory/items");
  for (const it of all.items) items[it.name] = it.id;
  const reorderFor: Record<string, [number, number]> = { "Charcoal bottle vases": [6, 24], "Everyday dinner set": [4, 24], "Reactive-glaze plate stack": [4, 24], "Speckled stoneware cup set": [6, 18], "Twin bud vases": [6, 18] };
  for (const [name, [level, qty]] of Object.entries(reorderFor)) {
    const cur = await api<{ item: Record<string, unknown> }>("GET", `inventory/items/${items[name]}`);
    await api("PUT", `inventory/items/${items[name]}`, { ...(cur.item as object), category: "Ceramics", reorderLevel: level, reorderQty: qty }).catch((e) => console.log(String(e).slice(0, 200)));
  }

  // ── Suppliers ──
  const glaze = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Bengaluru Glaze Supplies", contactName: "Divya Rao", phone: "+91 99001 77821", email: "orders@blrglaze.example", gstin: "29AAGCB8812R1Z9", state: "KA", address: "Peenya Industrial Area, Bengaluru", paymentTermsDays: 45, leadTimeDays: 7 })).supplier.id;
  const clay = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Khurja Clay Works", contactName: "Irfan Qureshi", phone: "+91 98370 11245", email: "orders@khurjaclay.example", gstin: "09AAKFK4471M1Z2", state: "UP", address: "GT Road, Khurja, Bulandshahr", paymentTermsDays: 30, leadTimeDays: 10 })).supplier.id;
  const pack = (await api<{ supplier: { id: string } }>("POST", "inventory/suppliers", { name: "Sharma Packaging", contactName: "Neeraj Sharma", phone: "+91 98201 33410", email: "sales@sharmapack.example", gstin: "27AAJFS2290K1ZQ", state: "MH", address: "Bhiwandi–Kalyan Road, Thane", paymentTermsDays: 15, leadTimeDays: 3 })).supplier.id;

  const raw: [string, string, string, string, string, boolean, number, number, string][] = [
    ["Matte sage glaze", "RM-GLZ-SAGE", "kg", "Raw materials", "3207", true, 8, 20, glaze],
    ["Satin white glaze", "RM-GLZ-WHT", "kg", "Raw materials", "3207", true, 8, 20, glaze],
    ["Stoneware clay (25 kg bag)", "RM-CLAY-25", "pcs", "Raw materials", "2508", false, 12, 30, clay],
    ["Bubble wrap roll (50 m)", "PK-BUB-50", "pcs", "Packaging", "3920", false, 4, 10, pack],
    ["Kraft tissue sheets", "PK-TIS", "pack", "Packaging", "4823", false, 4, 10, pack],
    ["Shipping box — medium", "PK-BOX-M", "pcs", "Packaging", "4819", false, 100, 300, pack],
  ];
  for (const [name, sku, unit, category, hsn, trackBatches, reorderLevel, reorderQty, supplierId] of raw) items[name] = (await api<{ item: { id: string } }>("POST", "inventory/items", { name, sku, unit, category, hsn, gstRate: 18, trackBatches, reorderLevel, reorderQty, supplierId })).item.id;
  for (const name of Object.keys(reorderFor)) await api("PUT", `inventory/items/${items[name]}`, { ...((await api<{ item: object }>("GET", `inventory/items/${items[name]}`)).item), supplierId: clay }).catch(() => {});

  // ── Purchase orders and deliveries ──
  const po = async (supplierId: string, orderDate: string, expectedDate: string, lines: [string, number, number][], notes = "") =>
    (await api<{ order: { id: string } }>("POST", "inventory/orders", { supplierId, warehouseId: wh, orderDate, expectedDate, notes, lines: lines.map(([n, qty, rate]) => ({ itemId: items[n], qty, rate: rate * 100, gstRate: 18 })) })).order.id;
  const send = (id: string) => api("POST", `inventory/orders/${id}/send`, { email: false });
  // PO-0001: packaging, all in.
  const po1 = await po(pack, isoDay(-24), isoDay(-21), [["Shipping box — medium", 600, 24], ["Bubble wrap roll (50 m)", 12, 680], ["Kraft tissue sheets", 12, 340]]);
  await send(po1);
  await api("POST", "inventory/receipts", { poId: po1, warehouseId: wh, date: isoDay(-21), supplierInvoice: "SP/2026/1182", lines: [["Shipping box — medium", 600, 24], ["Bubble wrap roll (50 m)", 12, 680], ["Kraft tissue sheets", 12, 340]].map(([n, qty, rate]) => ({ itemId: items[n as string], qty, rate: (rate as number) * 100, gstRate: 18 })) });
  // PO-0002: clay and vases from Khurja, part received, late.
  const po2 = await po(clay, isoDay(-20), isoDay(-8), [["Stoneware clay (25 kg bag)", 30, 1680], ["Charcoal bottle vases", 24, 300], ["Twin bud vases", 18, 360], ["Speckled stoneware cup set", 18, 880]]);
  await send(po2);
  await api("POST", "inventory/receipts", { poId: po2, warehouseId: wh, date: isoDay(-10), supplierInvoice: "KCW-7731", lines: [{ itemId: items["Stoneware clay (25 kg bag)"], qty: 15, rate: 168000, gstRate: 18 }, { itemId: items["Charcoal bottle vases"], qty: 24, rate: 30000, gstRate: 18 }] });
  // PO-0003: glazes from Bengaluru (IGST), part received with batches, late.
  const po3 = await po(glaze, isoDay(-18), isoDay(-11), [["Matte sage glaze", 20, 920], ["Satin white glaze", 20, 780]]);
  await send(po3);
  await api("POST", "inventory/receipts", { poId: po3, warehouseId: wh, date: isoDay(-12), supplierInvoice: "BGS-0412", lines: [
    { itemId: items["Matte sage glaze"], qty: 12, rate: 92000, gstRate: 18, batch: "SG-2608", expiry: isoDay(17) },
    { itemId: items["Matte sage glaze"], qty: 8, rate: 92000, gstRate: 18, batch: "SG-2610", expiry: isoDay(186) },
    { itemId: items["Satin white glaze"], qty: 6, rate: 78000, gstRate: 18, batch: "SW-2609", expiry: isoDay(240) },
  ] });
  // PO-0004: more boxes, sent. PO-0005: restock for the shop, a draft.
  const po4 = await po(pack, isoDay(-6), isoDay(1), [["Shipping box — medium", 300, 24], ["Kraft tissue sheets", 6, 340]]);
  await send(po4);
  await po(clay, isoDay(-2), isoDay(9), [["Everyday dinner set", 24, 2100], ["Reactive-glaze plate stack", 24, 950]], "Pack each set in double-wall cartons, please.");

  // ── Stock moves: adjustments, transfers and a count ──
  await api("POST", "inventory/adjust", { itemId: items["Satin white glaze"], warehouseId: wh, batch: "SW-2609", qty: -2.5, reason: "used", note: "Test tiles for the winter range" });
  await api("POST", "inventory/adjust", { itemId: items["Stoneware clay (25 kg bag)"], warehouseId: wh, qty: -4, reason: "used", note: "Studio throwing sessions" });
  await api("POST", "inventory/adjust", { itemId: items["Charcoal bottle vases"], warehouseId: wh, qty: -2, reason: "damaged", note: "Chipped in transit" });
  const tr = async (fromId: string, toId: string, lines: [string, number, string?][], state: "received" | "sent") => {
    const t = await api<{ transfer: { id: string } }>("POST", "inventory/transfers", { fromId, toId, lines: lines.map(([n, qty, batch]) => ({ itemId: items[n], qty, batch: batch ?? "" })) });
    await api("POST", `inventory/transfers/${t.transfer.id}/send`, {});
    if (state === "received") await api("POST", `inventory/transfers/${t.transfer.id}/receive`, {});
  };
  await tr(wh, shop, [["Charcoal bottle vases", 12], ["Shipping box — medium", 120]], "received");
  await tr(wh, popup, [["Shipping box — medium", 60], ["Kraft tissue sheets", 2], ["Charcoal bottle vases", 6]], "received");
  await tr(wh, popup, [["Bubble wrap roll (50 m)", 2], ["Matte sage glaze", 3, "SG-2608"]], "sent");
  await api("POST", "inventory/counts", { warehouseId: popup, lines: [{ itemId: items["Shipping box — medium"], counted: 57 }, { itemId: items["Kraft tissue sheets"], counted: 2 }], note: "Weekend stock-take" });

  // ── Sidebar badges ──
  const chatMeta = await api<{ channels: { id: string; name: string }[] }>("GET", "chat/meta");
  const general = chatMeta.channels.find((c) => c.name === "general")?.id;
  if (general) {
    await team.api("POST", `chat/channels/${general}/messages`, { body: "Glaze from Bengaluru is still 14 kg short — chasing Divya today." }).catch((e) => console.log(String(e).slice(0, 200)));
    await team.api("POST", `chat/channels/${general}/messages`, { body: "Pune pop-up counted: 57 boxes on the shelf 📦" }).catch(() => {});
  }
  await seedMail(api, orgId, owner.userId, "ira@kilnandco.in", "Ira Sen", [
    { from: "Divya Rao <divya@blrglaze.example>", subject: "Satin white glaze — balance 14 kg dispatching Thursday", text: "Hi Ira, the balance of PO-0003 leaves Peenya on Thursday.", ago: 35 },
    { from: "Irfan Qureshi <irfan@khurjaclay.example>", subject: "Invitation: Winter range sampling call", text: "Let's go over the new samples.", ago: 120, invite: { title: "Khurja Clay — winter range samples", dayOffset: 1, hour: 15 } },
    { from: "Neeraj Sharma <neeraj@sharmapack.example>", subject: "PO-0004 — boxes ready for pickup", text: "Your 300 boxes are packed and ready.", ago: 240 },
  ]);

  // ── Captures ──
  const dir = "inventory";
  const [po3Num] = [po3];
  await open(page, "/inventory", "Running low");
  await shoot(page, dir, "home");
  await open(page, "/inventory/items", "Matte sage glaze");
  await shoot(page, dir, "items");
  await open(page, `/inventory/items/${items["Charcoal bottle vases"]}`, "Where it is");
  await shoot(page, dir, "item-store");
  await open(page, `/inventory/items/${items["Matte sage glaze"]}`, "SG-2608");
  await shoot(page, dir, "item-batch");
  await open(page, "/inventory/orders", "Khurja Clay Works");
  await shoot(page, dir, "orders");
  await open(page, `/inventory/orders/${po3Num}`, "Bengaluru Glaze Supplies");
  await shoot(page, dir, "order");
  await page.getByRole("button", { name: /Receive goods/ }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByPlaceholder(/Supplier's invoice|invoice/i).fill("BGS-0447").catch(() => {});
  await dlg.getByPlaceholder("Batch").first().fill("SW-2611").catch(() => {});
  await dlg.locator('input[type="date"]').last().fill(isoDay(210)).catch(() => {});
  await shoot(page, dir, "receive", { settle: 900 });
  await page.keyboard.press("Escape");
  await open(page, `/inventory/orders/${po3Num}/print`, "PURCHASE ORDER");
  await shoot(page, dir, "order-print");
  await open(page, "/inventory/orders/new", "New purchase order");
  await shoot(page, dir, "order-new");
  await open(page, "/inventory/receipts", "GRN-");
  await shoot(page, dir, "receipts");
  await open(page, "/inventory/reorder", "Stoneware clay");
  await shoot(page, dir, "reorder");
  await open(page, "/inventory/transfers", "Pune pop-up");
  await shoot(page, dir, "transfers");
  await open(page, "/inventory/counts", "Bubble wrap");
  await shoot(page, dir, "counts");
  await open(page, "/inventory/reports", "Value by category");
  await shoot(page, dir, "reports", { settle: 2500 });
  await open(page, "/inventory/suppliers", "Khurja Clay Works");
  await shoot(page, dir, "suppliers");
  await open(page, "/inventory/settings", "Bhiwandi warehouse");
  await shoot(page, dir, "settings");
  await team.ctx.close();
  await phoneShots(page, [["/inventory", "inventory"]]);
});
