// Real frames of Mail for the Mail product film (video/public/mail/): the same
// demo mailbox as capture-mail (filled through the real ingest pipeline, the
// mailbox paused so nothing reaches a mail server), then the moments the film
// needs — search, a view, a thread, the reply-tone menu, the compose window at
// each step (nothing is sent), the schedule menu, the screener, the phishing
// warning, analytics and the sender clean-up.
//   npx playwright test -c scripts/marketing/pw.config.ts capture-mail-film
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "../../src/db";
import { encryptSecret } from "../../src/server/security/secrets";
import { ingest } from "../../src/server/mail/sync";
import { asVisitor, clean, ip } from "./shoot";

const OUT = join(process.cwd(), "video", "public", "mail");
// 3× so the film's close-ups stay sharp in a 4K master.
test.use({ deviceScaleFactor: 3 });
const O = { origin: "http://localhost:3000" };

async function frame(page: Page, name: string, settle = 900) {
  await clean(page);
  await page.waitForTimeout(settle);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 92 });
}

test("mail film frames", async ({ page }) => {
  const T = Date.now().toString(36);
  await asVisitor(page);
  const r = await page.request.post("/api/v1/auth/signup", { data: { name: "Meera Iyer", email: `meera.film.${T}@saffron-demo.in`, password: "correct-horse-42", orgName: "Saffron & Sage" }, headers: { ...O, "x-forwarded-for": ip() } });
  expect(r.status(), await r.text()).toBe(201);
  await page.request.put("/api/v1/auth/onboarding", { data: { complete: true, tourDone: true }, headers: O });
  const who = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = who.organizations[0].id as string;
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, who.user.id));

  const box = { imapHost: "imap.zoho.in", imapPort: 993, imapSecure: true, smtpHost: "smtp.zoho.in", smtpPort: 465, smtpSecure: true, secretEnc: encryptSecret("demo"), status: "paused", provider: "zoho", settings: { syncDays: 30, sendDelaySec: 10 } } as const;
  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: who.user.id, name: "Saffron & Sage", address: "meera@saffronsage.in", displayName: "Meera Iyer", username: "meera@saffronsage.in", color: "#6366f1", ...box } as never).returning();
  const [team] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: who.user.id, shared: true, name: "Orders", address: "orders@saffronsage.in", displayName: "Saffron & Sage Orders", username: "orders@saffronsage.in", color: "#f97316", ...box } as never).returning();
  await db.insert(schema.crmContacts).values({ orgId, name: "Anika Bose", email: "anika@tajhotels.com", title: "Purchase manager" } as never);
  const at = (mins: number) => new Date(Date.now() - mins * 60_000);
  const inbox: [typeof acc, Record<string, unknown>, number][] = [
    [acc, { from: "Anika Bose <anika@tajhotels.com>", subject: "Tableware for the new wing?", text: "Hi Meera,\n\nCan you quote 400 dinner plates and 400 quarter plates for our new wing? We'd need delivery by 20 November.\n\nThanks,\nAnika", messageId: "<q1@tajhotels.com>" }, 180],
    [acc, { from: "Anika Bose <anika@tajhotels.com>", subject: "Re: Tableware for the new wing?", text: "Also, could you add 200 saucers? We need the quote today if possible.", inReplyTo: "<q1@tajhotels.com>", references: "<q1@tajhotels.com>" }, 40],
    [acc, { from: "Bright Lights Pvt Ltd <billing@brightlights.in>", subject: "Tax invoice BL-204 for October", text: "Dear customer, please find attached tax invoice BL-204 for ₹38,400 due on 10 November.", attachments: [{ filename: "BL-204.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }] }, 260],
    [acc, { from: "Razorpay <no-reply@razorpay.com>", subject: "Payment received: ₹12,600 from Good Earth", text: "A payment of ₹12,600 was credited to your account." }, 400],
    [acc, { from: "Dev Malhotra <dev@thirdwave.cafe>", subject: "Stocking your mugs at Third Wave", text: "Hi! We'd love to stock your hand-painted mugs in our Indiranagar café. Could we talk this week?" }, 520],
    [acc, { from: "Chumbak <news@chumbak.com>", subject: "Diwali sale: 40% off everything", html: "<h1>Diwali sale</h1><p>40% off everything. Shop now!</p>", headers: { "List-Unsubscribe": "<https://chumbak.com/u/1>" } }, 700],
    [acc, { from: "LinkedIn <messages-noreply@linkedin.com>", subject: "You appeared in 12 searches this week", text: "See who's looking" }, 1300],
    [acc, { from: "\"service@paypal.com\" <alerts@paypa1-secure.co>", subject: "Your account has been limited", text: "Verify your account now", headers: { "Authentication-Results": "mx; spf=fail; dmarc=fail" } }, 1600],
    [acc, { from: "The Ken <newsletter@the-ken.com>", subject: "The week in Indian retail", text: "This week's stories", headers: { "List-Unsubscribe": "<mailto:u@the-ken.com>" } }, 2400],
    [team, { from: "Rohan Gupta <rohan@goodearth.in>", subject: "PO 5512 — 120 brass diyas", text: "Please confirm stock and dispatch date for PO 5512." }, 90],
    [team, { from: "Sana Qureshi <sana@fabindia.com>", subject: "Restock: linen runners", text: "Can we get 60 more linen runners before Diwali?" }, 300],
  ];
  let uid = 1;
  for (const [a, m, mins] of inbox) {
    const raw = await new MailComposer({ to: a!.address, date: at(mins), ...m } as never).compile().build();
    await ingest(a!, "INBOX", uid++, raw, []);
  }

  // The inbox.
  await page.goto("/mail");
  await expect(page.getByTestId("mail-thread-row").first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await frame(page, "inbox", 1800);

  // A category tab.
  await page.getByRole("button", { name: /^People/ }).first().click().catch(async () => { await page.getByText("People", { exact: true }).first().click(); });
  await page.waitForTimeout(1300);
  await frame(page, "people", 700);
  await page.getByRole("button", { name: /^Everything/ }).first().click().catch(async () => { await page.getByText("Everything", { exact: true }).first().click(); });
  await page.waitForTimeout(1000);

  // Search: the operators, then a query.
  await page.getByLabel("Search mail").click();
  await frame(page, "search-ops", 700);
  await page.getByLabel("Search mail").fill("tableware");
  await page.waitForTimeout(1500);
  await frame(page, "search", 800);
  await page.getByLabel("Clear search").click().catch(() => {});
  await page.keyboard.press("Escape");

  // A view: Needs reply.
  await page.getByRole("button", { name: /^Needs reply/ }).first().click().catch(async () => { await page.getByText("Needs reply", { exact: true }).first().click(); });
  await page.waitForTimeout(1500);
  await frame(page, "needs-reply", 800);
  await page.getByRole("button", { name: /^Inbox/ }).first().click().catch(async () => { await page.getByText("Inbox", { exact: true }).first().click(); });
  await page.waitForTimeout(1200);

  // A thread, and the reply-tone menu (opened, not run).
  await page.getByTestId("mail-thread-row").filter({ hasText: "Tableware" }).first().click();
  await page.waitForTimeout(1800);
  await frame(page, "thread", 900);
  await page.getByRole("button", { name: /Suggest a reply/ }).first().click();
  await frame(page, "suggest", 700);
  await page.keyboard.press("Escape");

  // The screener and the phishing warning.
  await page.getByTestId("mail-thread-row").filter({ hasText: "Stocking" }).first().click();
  await frame(page, "screener", 1600);
  await page.getByTestId("mail-thread-row").filter({ hasText: "limited" }).first().click();
  await frame(page, "phishing", 1600);

  // Compose — every step; it is discarded at the end, never sent.
  await page.getByRole("button", { name: /^Compose$/ }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await frame(page, "compose-empty", 900);
  const to = dlg.getByLabel("To");
  await to.fill("anika@tajhotels.com");
  await to.press("Enter");
  await dlg.getByRole("button", { name: "Cc Bcc" }).click().catch(() => {});
  await dlg.getByLabel("Cc").fill("ravi@saffronsage.in").catch(() => {});
  await dlg.getByLabel("Cc").press("Enter").catch(() => {});
  await dlg.getByLabel("Subject").fill("Quote — 400 dinner sets for the new wing");
  await frame(page, "compose-1", 700);
  const body = dlg.getByLabel("Message");
  const lines = ["Hi Anika,", "", "Thank you for the details. Our quote for 400 dinner plates, 400 quarter plates and 200 saucers is attached, with delivery before 20 November.", "", "Warm regards,", "Meera"];
  await body.fill(lines.slice(0, 3).join("\n"));
  await frame(page, "compose-2", 600);
  await body.fill(lines.join("\n"));
  await frame(page, "compose-3", 700);
  await dlg.getByLabel("Schedule send").click();
  await frame(page, "compose-schedule", 700);
  await page.getByRole("menuitem", { name: /tomorrow/i }).first().click().catch(async () => { await page.getByText(/Send tomorrow/).first().click(); });
  await frame(page, "compose-scheduled", 800);
  await dlg.getByRole("button", { name: "Discard" }).click().catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(800);

  // Insights.
  await page.getByText("Analytics", { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await frame(page, "analytics", 1200);
  await page.getByText("Clean up senders", { exact: true }).first().click();
  await page.waitForTimeout(2200);
  await frame(page, "cleanup", 1000);
});
