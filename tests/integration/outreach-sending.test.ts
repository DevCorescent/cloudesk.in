import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as events from "@/app/api/v1/po/events/route";
import { outreachTick, setMxResolver } from "@/server/outreach/core";
import { setDnsLookup } from "@/server/outreach/deliverability";
import { setMailTransport, type MailTransport } from "@/server/mail/transport";
import { encryptSecret } from "@/server/security/secrets";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// How outreach leaves: through a Cloudesk Mail mailbox (against a pretend
// SMTP server) with the logo, unsubscribe and feedback headers; a refused
// sign-in stops the run instead of failing everyone; what "Run now" reports;
// spam complaints from the email service; and the live DNS check.
const PW = "correct-horse-42";
let cookie = "";
let userId = "";
let accountId = "";
const sent: { from: string; to: string[]; raw: string }[] = [];
let refuse = false;
const fake: MailTransport = {
  async imap() {
    throw new Error("not used");
  },
  async verifySmtp() {},
  async send(_c, envelope, raw) {
    if (refuse) throw Object.assign(new Error("Invalid login: 535 Authentication failed"), { responseCode: 535 });
    sent.push({ ...envelope, raw: raw.toString("utf8") });
  },
};
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown) => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/admin/outreach/${path}`, params: { slug: ["outreach", ...seg(path)] } });
const reauth = () => call((admin as unknown as Record<string, Parameters<typeof call>[0]>).POST, { method: "POST", cookie, body: { password: PW }, path: "/api/v1/admin/reauth", params: { slug: ["reauth"] } });
/** Tuesday 11:00 India time, a day or more ahead: inside the default window. */
const at = (() => {
  const d = new Date(Date.now() + 86_400_000);
  for (;;) {
    const l = new Date(d.getTime() + 19_800_000);
    if (l.getUTCDay() === 2) return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 11) - 19_800_000);
    d.setTime(d.getTime() + 86_400_000);
  }
})();

beforeAll(async () => {
  await resetDb();
  setMailTransport(fake);
  setMxResolver(async () => true);
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Olga Owner", email: "olga@cloudesk.in", password: PW } }));
  const m = (await call(me.GET, { cookie })).json;
  userId = m.user.id;
  await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "owner" }).where(eq(schema.users.id, userId));
  const [a] = await db.insert(schema.mailAccounts).values({ orgId: m.organizations[0].id, ownerId: userId, name: "Cloudesk", address: "hello@cloudesk.in", displayName: "Cloudesk", provider: "custom", imapHost: "imap.secureserver.net", imapPort: 993, smtpHost: "smtpout.secureserver.net", smtpPort: 465, username: "hello@cloudesk.in", secretEnc: encryptSecret("app-pass"), status: "ok" }).returning();
  accountId = a!.id;
});
afterAll(async () => {
  setMailTransport(null);
  setDnsLookup(null);
  delete process.env.OUTREACH_WEBHOOK_KEY;
  await closeDb();
});

describe("outreach sending", () => {
  it("says why nothing went out", async () => {
    const r = await A("POST", "run");
    expect(r.json).toMatchObject({ sent: 0, reason: "sending is off", funnels: 0, queued: 0 });
  });

  it("only sends from an address on the verified domain, and only from your own mailbox", async () => {
    await reauth();
    process.env.MAIL_FROM = "noreply@cloudesk.in";
    const bad = await A("PUT", "settings", { sending: true, postalAddress: "12 MG Road, Pune", fromEmail: "hi@gmail.com" });
    expect(bad.status).toBe(422);
    expect(bad.json.error.message).toMatch(/cloudesk\.in/);
    delete process.env.MAIL_FROM;
    expect((await A("PUT", "settings", { via: "mailbox", accountId: "00000000-0000-4000-8000-000000000000", postalAddress: "12 MG Road, Pune" })).status).toBe(422);
    const s = await A("GET", "settings");
    expect(s.json.mailboxes.map((m: { address: string }) => m.address)).toEqual(["hello@cloudesk.in"]);
  });

  it("sends through the Cloudesk Mail mailbox with the logo, unsubscribe and feedback headers", async () => {
    await reauth();
    expect((await A("PUT", "settings", { sending: true, via: "mailbox", accountId, fromName: "Cloudesk", postalAddress: "12 MG Road, Pune", warmup: false, dailyLimit: 1000 })).status).toBe(200);
    await A("POST", "contacts/paste", { text: "Asha Rao <asha@raotraders.in>, Rao Traders\ndev@thirdwave.cafe", source: "Fair" });
    const f = await A("POST", "funnels", { name: "Hello", audience: { sources: ["Fair"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    await A("POST", `funnels/${f.json.funnel.id}/start`);
    const r = await outreachTick({ now: at });
    expect(r).toMatchObject({ sent: 2, failed: 0, funnels: 1 });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.from).toBe("hello@cloudesk.in");
    const raw = sent.find((x) => x.to[0] === "asha@raotraders.in")!.raw;
    expect(raw).toMatch(/^From: Cloudesk <hello@cloudesk\.in>/m);
    expect(raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    expect(raw).toMatch(/^Feedback-ID: .*:hello:outreach:cloudesk/m);
    expect(raw.replace(/=\r?\n/g, "")).toContain("brand/cloudesk-email.png");
    // Nothing goes through the platform outbox.
    expect(await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "asha@raotraders.in"))).toHaveLength(0);
  });

  it("stops the run when the mailbox refuses, and tries the same step again later", async () => {
    await A("POST", "contacts/paste", { text: "kiran@kiranhardware.in\nmeena@meenasalon.in", source: "Fair" });
    refuse = true;
    const r = await outreachTick({ now: new Date(at.getTime() + 3 * 86_400_000) });
    refuse = false;
    expect(r.sent).toBe(0);
    expect(r.reason).toMatch(/^sending failed — The server didn't accept the sign-in/);
    const kiran = (await db.select().from(schema.poContacts).where(eq(schema.poContacts.email, "kiran@kiranhardware.in")))[0]!;
    expect(kiran).toMatchObject({ sends: 0, status: "active" });
    expect(await db.select().from(schema.poSends).where(eq(schema.poSends.contactId, kiran.id))).toHaveLength(0);
    const later = await outreachTick({ now: new Date(at.getTime() + 3 * 86_400_000 + 2 * 3_600_000) });
    expect(later.sent).toBe(2);
  });

  it("never emails someone who marked it as spam", async () => {
    process.env.OUTREACH_WEBHOOK_KEY = "hook-key-123";
    const post = (key: string, body: unknown) => events.POST(new Request(`${ORIGIN}/api/v1/po/events?key=${key}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    expect((await post("wrong", {})).status).toBe(404);
    const r = await post("hook-key-123", { type: "email.complained", data: { to: ["asha@raotraders.in"] } });
    expect(await r.json()).toMatchObject({ changed: 1 });
    await post("hook-key-123", [{ event: "bounce", email: "dev@thirdwave.cafe", reason: "550 5.1.1 user unknown" }]);
    const rows = await db.select().from(schema.poContacts);
    expect(rows.find((c) => c.email === "asha@raotraders.in")!.status).toBe("complained");
    expect(rows.find((c) => c.email === "dev@thirdwave.cafe")!.status).toBe("bounced");
  });

  it("checks the domain's DNS and says what to add", async () => {
    const records: Record<string, string[]> = {
      "cloudesk.in": ["v=spf1 include:secureserver.net -all"],
      "_dmarc.cloudesk.in": [],
    };
    setDnsLookup({ txt: async (n) => records[n] ?? [], mx: async (n) => (n === "cloudesk.in" ? ["smtp.secureserver.net"] : []), cname: async () => [] });
    const d = await A("GET", "deliverability");
    expect(d.status).toBe(200);
    expect(d.json.domain).toBe("cloudesk.in");
    const by = (id: string) => d.json.checks.find((c: { id: string }) => c.id === id);
    expect(by("spf").status).toBe("pass");
    expect(by("dmarc")).toMatchObject({ status: "fail", fix: { type: "TXT", host: "_dmarc" } });
    expect(by("dmarc").fix.value).toMatch(/^v=DMARC1; p=none; rua=mailto:dmarc@cloudesk\.in/);
    expect(by("dkim").status).toBe("fail");
    expect(by("bimi").fix.value).toContain("/brand/bimi.svg");
    records["_dmarc.cloudesk.in"] = ["v=DMARC1; p=quarantine; rua=mailto:d@cloudesk.in"];
    records["default._domainkey.cloudesk.in"] = ["v=DKIM1; k=rsa; p=MIGf"];
    const again = await A("GET", "deliverability");
    expect(again.json.checks.find((c: { id: string }) => c.id === "dmarc").status).toBe("pass");
    expect(again.json.checks.find((c: { id: string }) => c.id === "dkim").status).toBe("pass");
    expect(again.json.score).toBeGreaterThan(d.json.score);
  });
});
