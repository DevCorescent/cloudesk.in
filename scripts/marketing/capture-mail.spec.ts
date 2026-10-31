// Real screenshots of Mail for its feature page. A demo mailbox is filled
// through the real ingest pipeline (parsing, threading, sorting, phishing
// checks) — the mailbox is paused, so nothing tries to reach a mail server.
import { expect, test } from "@playwright/test";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "../../src/db";
import { encryptSecret } from "../../src/server/security/secrets";
import { ingest } from "../../src/server/mail/sync";
import { shoot, asVisitor } from "./shoot";

test("capture mail", async ({ page }) => {
  const T = Date.now() % 1_000_000;
  await asVisitor(page);
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Meera Iyer");
  await page.getByLabel("Work email").fill(`meera.${T}@saffron-demo.in`);
  await page.getByLabel("Password").fill("correct-horse-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/welcome$/);
  await page.getByRole("button", { name: "Skip setup" }).click();
  await page.waitForURL(/\/home$/);
  const who = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = who.organizations[0].id as string;
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where((await import("drizzle-orm")).eq(schema.users.id, who.user.id));

  // The guided connect wizard (before any mailbox exists).
  await page.goto("/mail");
  await page.getByRole("button", { name: /Connect your first mailbox/i }).first().click();
  await page.getByTestId("mail-connect-wizard").getByRole("textbox").first().fill("meera@saffronsage.in");
  await page.getByRole("button", { name: "Zoho Mail" }).click().catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole("dialog").getByRole("button", { name: /Continue/ }).click();
  await shoot(page, "mail", "connect", { settle: 1200 });
  await page.keyboard.press("Escape");

  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: who.user.id, name: "Saffron & Sage", address: "meera@saffronsage.in", displayName: "Meera Iyer", provider: "zoho", imapHost: "imap.zoho.in", imapPort: 993, imapSecure: true, smtpHost: "smtp.zoho.in", smtpPort: 465, smtpSecure: true, username: "meera@saffronsage.in", secretEnc: encryptSecret("demo"), status: "paused", color: "#6366f1", settings: { syncDays: 30, sendDelaySec: 10 } }).returning();
  const [team] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: who.user.id, shared: true, name: "Orders", address: "orders@saffronsage.in", displayName: "Saffron & Sage Orders", provider: "zoho", imapHost: "imap.zoho.in", imapPort: 993, imapSecure: true, smtpHost: "smtp.zoho.in", smtpPort: 465, smtpSecure: true, username: "orders@saffronsage.in", secretEnc: encryptSecret("demo"), status: "paused", color: "#f97316", settings: { syncDays: 30, sendDelaySec: 10 } }).returning();
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
    const to = a!.address;
    const raw = await new MailComposer({ to, date: at(mins), ...m } as never).compile().build();
    await ingest(a!, "INBOX", uid++, raw, []);
  }

  await page.goto("/mail");
  await expect(page.getByTestId("mail-thread-row").first()).toBeVisible();
  await shoot(page, "mail", "inbox", { settle: 1800 });
  await page.getByTestId("mail-thread-row").filter({ hasText: "Tableware" }).first().click();
  await shoot(page, "mail", "thread", { settle: 2200 });
  await page.getByTestId("mail-thread-row").filter({ hasText: "limited" }).first().click();
  await shoot(page, "mail", "phishing", { settle: 1800 });
  await page.getByTestId("mail-thread-row").filter({ hasText: "Stocking" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Reply", exact: true }).last().click().catch(() => {});
  await shoot(page, "mail", "reply", { settle: 1500 });
});
