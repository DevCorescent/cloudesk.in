import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as pixel from "@/app/api/v1/po/o/[token]/route";
import * as click from "@/app/api/v1/po/c/[token]/route";
import { evolveSubjects, getSettings, outreachTick, setMxResolver, setSubjectWriter, signLink } from "@/server/outreach/core";
import { setMailTransport, type MailTransport } from "@/server/mail/transport";
import { encryptSecret } from "@/server/security/secrets";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// The engine's judgement: people's opens and clicks told apart from privacy
// proxies and scanners; links that only go where the email said; sign-ups
// credited exactly through the click; control groups; hot leads taken over
// by a higher-priority funnel; second tries for people who didn't open; the
// weekly cap; list hygiene; replies; and subject lines retired and rewritten.
const PW = "correct-horse-42";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
let cookie = "";
let orgId = "";
let accountId = "";
const sent: { to: string[]; raw: string }[] = [];
const fake: MailTransport = {
  async imap() {
    throw new Error("not used");
  },
  async verifySmtp() {},
  async send(_c, envelope, raw) {
    sent.push({ to: envelope.to, raw: raw.toString("utf8") });
  },
};
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown) => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/admin/outreach/${path}`, params: { slug: ["outreach", ...seg(path)] } });
const reauth = () => call((admin as unknown as Record<string, Parameters<typeof call>[0]>).POST, { method: "POST", cookie, body: { password: PW }, path: "/api/v1/admin/reauth", params: { slug: ["reauth"] } });
const contact = async (email: string) => (await db.select().from(schema.poContacts).where(eq(schema.poContacts.email, email)))[0]!;
const sendsTo = async (email: string) => db.select().from(schema.poSends).where(eq(schema.poSends.contactId, (await contact(email)).id));
const hit = (route: typeof pixel | typeof click, path: string, token: string, headers: Record<string, string> = {}, method = "GET") => (route as typeof click)[method === "HEAD" ? "HEAD" : "GET"](new Request(`${ORIGIN}${path}`, { method, headers }), { params: Promise.resolve({ token }) });
const days = (n: number) => n * 86_400_000;
/** Tuesday 11:00 India time, a day or more ahead. */
const at = (() => {
  const d = new Date(Date.now() + days(1));
  for (;;) {
    const l = new Date(d.getTime() + 19_800_000);
    if (l.getUTCDay() === 2) return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 11) - 19_800_000);
    d.setTime(d.getTime() + days(1));
  }
})();
const settings = async (extra: Record<string, unknown> = {}) => {
  await reauth();
  const r = await A("PUT", "settings", { sending: true, postalAddress: "12 MG Road, Pune", warmup: false, dailyLimit: 1000, minGapHours: 1, maxPerWeek: 5, sunsetAfter: 6, via: "mailbox", accountId, ...extra });
  expect(r.status).toBe(200);
};
const funnel = async (body: Record<string, unknown>) => {
  const f = await A("POST", "funnels", body);
  expect(f.status).toBe(200);
  await A("POST", `funnels/${f.json.funnel.id}/start`);
  return f.json.funnel.id as string;
};
const reset = async () => {
  for (const t of [schema.poEvents, schema.poSends, schema.poEnrollments, schema.poContacts, schema.poFunnels]) await db.delete(t);
  sent.length = 0;
};

beforeAll(async () => {
  await resetDb();
  setMailTransport(fake);
  setMxResolver(async (d) => d !== "nomail.example");
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Olga Owner", email: "olga@cloudesk.in", password: PW } }));
  const m = (await call(me.GET, { cookie })).json;
  orgId = m.organizations[0].id;
  await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "owner" }).where(eq(schema.users.id, m.user.id));
  const [a] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: m.user.id, name: "Cloudesk", address: "hello@cloudesk.in", displayName: "Cloudesk", provider: "custom", imapHost: "imap.example", imapPort: 993, smtpHost: "smtp.example", smtpPort: 465, username: "hello@cloudesk.in", secretEnc: encryptSecret("x"), status: "ok" }).returning();
  accountId = a!.id;
  await settings();
});
beforeEach(reset);
afterAll(async () => {
  setMailTransport(null);
  setMxResolver(null);
  setSubjectWriter(null);
  await closeDb();
});

describe("tracking that tells people from machines", () => {
  it("ignores privacy proxies and scanners, and learns the reader's mail app", async () => {
    await A("POST", "contacts/paste", { text: "asha@raotraders.in", source: "T" });
    await funnel({ name: "T", audience: { sources: ["T"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    await outreachTick({ now: at });
    const [s] = await sendsTo("asha@raotraders.in");
    const tok = s!.token;
    // Apple Mail Privacy Protection prefetches on delivery; a scanner follows the link straight away.
    await hit(pixel, `/api/v1/po/o/${tok}`, tok, { "user-agent": "Mozilla/5.0", "x-forwarded-for": "17.58.100.12" });
    const target = "https://cloudesk.in/start";
    const link = `/api/v1/po/c/${tok}?u=${Buffer.from(target).toString("base64url")}&s=${signLink(tok, target)}`;
    await hit(click, link, tok, { "user-agent": "Mozilla/5.0 (compatible; Barracuda Sentinel)" });
    await hit(click, link, tok, { "user-agent": CHROME }, "HEAD");
    let row = (await sendsTo("asha@raotraders.in"))[0]!;
    expect(row).toMatchObject({ opens: 0, clicks: 0, machineOpens: 1, machineClicks: 2 });
    expect((await contact("asha@raotraders.in")).score).toBe(0);
    // A click seconds after delivery is a scanner's too.
    await hit(click, link, tok, { "user-agent": CHROME });
    expect((await sendsTo("asha@raotraders.in"))[0]!.clicks).toBe(0);
    // An hour later, a person on Gmail.
    await db.update(schema.poSends).set({ sentAt: new Date(Date.now() - 3_600_000) });
    await db.update(schema.poEvents).set({ createdAt: new Date(Date.now() - 3_000_000) });
    await hit(pixel, `/api/v1/po/o/${tok}`, tok, { "user-agent": "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)" });
    const res = await hit(click, link, tok, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    expect(res.headers.get("location")).toBe(target);
    expect(res.headers.get("set-cookie")).toContain(`cc_po=${tok}`);
    row = (await sendsTo("asha@raotraders.in"))[0]!;
    expect(row).toMatchObject({ opens: 1, clicks: 1, machineOpens: 1 });
    const c = await contact("asha@raotraders.in");
    expect(c.client).toBe("Webmail · mobile");
    expect(c.score).toBeGreaterThan(0);
    const o = await A("GET", "overview");
    expect(o.json.tracking).toMatchObject({ machineOpens: 1, machineClicks: 3 });
  });

  it("only redirects where the email pointed", async () => {
    await A("POST", "contacts/paste", { text: "dev@thirdwave.cafe", source: "T" });
    await funnel({ name: "T", audience: { sources: ["T"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    await outreachTick({ now: at });
    const tok = (await sendsTo("dev@thirdwave.cafe"))[0]!.token;
    const evil = Buffer.from("https://evil.example/login").toString("base64url");
    const forged = await hit(click, `/api/v1/po/c/${tok}?u=${evil}&s=forged`, tok, { "user-agent": CHROME });
    expect(forged.headers.get("location")).toBe(`${ORIGIN}/`);
    const signed = await hit(click, `/api/v1/po/c/${tok}?u=${evil}&s=${signLink(tok, "https://evil.example/login")}`, tok, { "user-agent": CHROME });
    expect(signed.headers.get("location")).toBe("https://evil.example/login");
  });
});

describe("attribution", () => {
  it("credits a sign-up to the email clicked, even under another address", async () => {
    await A("POST", "contacts/paste", { text: "priya@smileclinic.in", source: "T" });
    await funnel({ name: "T", audience: { sources: ["T"] }, steps: [{ id: "a", kind: "email", category: "intro" }, { id: "b", kind: "wait", days: 3 }, { id: "c", kind: "email", category: "offer" }] });
    await outreachTick({ now: at });
    const [s] = await sendsTo("priya@smileclinic.in");
    const r = await call(signup.POST, { method: "POST", body: { name: "Priya Nair", email: "priya.personal@gmail.com", password: PW }, headers: { cookie: `cc_po=${s!.token}` } });
    expect(r.status).toBe(201);
    const c = await contact("priya@smileclinic.in");
    expect(c).toMatchObject({ attribution: "exact", stage: "signed_up", convertedBy: s!.id });
    expect(c.userId).not.toBeNull();
    const [e] = await db.select().from(schema.poEnrollments).where(eq(schema.poEnrollments.contactId, c.id));
    expect(e).toMatchObject({ status: "converted" });
    expect((await A("GET", "overview")).json.attribution).toMatchObject({ exact: 1 });
  });
});

describe("automation", () => {
  it("holds back a control group that's never emailed", async () => {
    await A("POST", "contacts/paste", { text: Array.from({ length: 60 }, (_, i) => `p${i}@shop${i}.in`).join("\n"), source: "H" });
    const id = await funnel({ name: "H", holdoutPct: 30, audience: { sources: ["H"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    await outreachTick({ now: at });
    const enr = await db.select().from(schema.poEnrollments).where(eq(schema.poEnrollments.funnelId, id));
    const held = enr.filter((e) => e.holdout);
    expect(held.length).toBeGreaterThan(5);
    expect(held.length).toBeLessThan(35);
    const mailed = new Set((await db.select().from(schema.poSends)).map((s) => s.contactId));
    for (const e of held) expect(mailed.has(e.contactId)).toBe(false);
    expect(mailed.size).toBe(60 - held.length);
  });

  it("moves a hot lead into the higher-priority funnel", async () => {
    await A("POST", "contacts/paste", { text: "kiran@kiranhardware.in", source: "P" });
    await funnel({ name: "Nurture", audience: { sources: ["P"] }, steps: [{ id: "a", kind: "email", category: "intro" }, { id: "b", kind: "wait", days: 10 }, { id: "c", kind: "email", category: "feature" }] });
    const hotId = await funnel({ name: "Hot", priority: 50, audience: { stages: ["hot"] }, steps: [{ id: "a", kind: "email", category: "followup" }] });
    await outreachTick({ now: at });
    await db.update(schema.poContacts).set({ stage: "hot", score: 40 }).where(eq(schema.poContacts.email, "kiran@kiranhardware.in"));
    await outreachTick({ now: new Date(at.getTime() + days(1)) });
    const enr = await db.select({ e: schema.poEnrollments, f: schema.poFunnels }).from(schema.poEnrollments).innerJoin(schema.poFunnels, eq(schema.poFunnels.id, schema.poEnrollments.funnelId)).where(eq(schema.poEnrollments.contactId, (await contact("kiran@kiranhardware.in")).id));
    expect(enr.find((x) => x.f.name === "Nurture")!.e).toMatchObject({ status: "exited", exitReason: "moved to Hot" });
    expect(enr.find((x) => x.f.id === hotId)!.e.status).not.toBe("exited");
    const cats = await db.select({ c: schema.poTemplates.category }).from(schema.poSends).innerJoin(schema.poTemplates, eq(schema.poTemplates.id, schema.poSends.templateId)).where(eq(schema.poSends.contactId, (await contact("kiran@kiranhardware.in")).id));
    expect(cats.map((x) => x.c)).toEqual(["intro", "followup"]);
  });

  it("gives people who didn't open a second try with another subject line", async () => {
    await A("POST", "contacts/paste", { text: "meena@meenasalon.in\nravi@menon.in", source: "R" });
    await funnel({ name: "R", audience: { sources: ["R"] }, steps: [{ id: "a", kind: "email", category: "intro", resendAfterDays: 2 }, { id: "b", kind: "wait", days: 5 }, { id: "c", kind: "email", category: "feature" }] });
    await outreachTick({ now: at });
    // Ravi opened; Meena didn't.
    const ravi = (await sendsTo("ravi@menon.in"))[0]!;
    await db.update(schema.poSends).set({ opens: 1, openedAt: new Date() }).where(eq(schema.poSends.id, ravi.id));
    await outreachTick({ now: new Date(at.getTime() + days(2) + 3_600_000) });
    const meena = await sendsTo("meena@meenasalon.in");
    expect(meena).toHaveLength(2);
    const [first, again] = meena.sort((a, b) => Number(a.resend) - Number(b.resend));
    expect(again).toMatchObject({ resend: true, templateId: first!.templateId });
    expect(again!.variant).not.toBe(first!.variant);
    expect(await sendsTo("ravi@menon.in")).toHaveLength(1);
  });

  it("never sends anyone more than the weekly cap", async () => {
    await settings({ maxPerWeek: 1 });
    await A("POST", "contacts/paste", { text: "zoya@zoyaboutique.in", source: "W" });
    await funnel({ name: "W", audience: { sources: ["W"] }, steps: [{ id: "a", kind: "email", category: "intro" }, { id: "b", kind: "wait", days: 1 }, { id: "c", kind: "email", category: "feature" }] });
    await outreachTick({ now: at });
    await outreachTick({ now: new Date(at.getTime() + days(1) + 3_600_000) });
    expect(await sendsTo("zoya@zoyaboutique.in")).toHaveLength(1);
    const [e] = await db.select().from(schema.poEnrollments).where(eq(schema.poEnrollments.contactId, (await contact("zoya@zoyaboutique.in")).id));
    const [first] = await sendsTo("zoya@zoyaboutique.in");
    expect(e!.nextAt!.getTime()).toBeGreaterThanOrEqual(first!.sentAt.getTime() + days(7));
    await settings();
  });

  it("cleans the list: fixes typos, flags shared inboxes, skips dead domains", async () => {
    const r = await A("POST", "contacts/import", { source: "L", rows: [{ email: "nikhil@gmial.com" }, { email: "info@acme.in" }, { email: "x@mailinator.com" }, { email: "y@nomail.example" }, { email: "z@realshop.in" }] });
    expect(r.json.created).toBe(5);
    expect(await contact("nikhil@gmail.com")).toMatchObject({ verify: "unknown", verifyNote: "Corrected from gmial.com" });
    expect((await contact("info@acme.in")).verify).toBe("risky");
    expect((await contact("x@mailinator.com")).verify).toBe("invalid");
    await funnel({ name: "L", audience: { sources: ["L"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    await outreachTick({ now: at });
    expect((await contact("y@nomail.example")).verify).toBe("invalid");
    const to = new Set(sent.flatMap((s) => s.to));
    expect(to).toEqual(new Set(["nikhil@gmail.com", "info@acme.in", "z@realshop.in"]));
  });

  it("takes someone who replies out of the funnel and makes them hot", async () => {
    await A("POST", "contacts/paste", { text: "Arjun <arjun@arjunlogistics.in>", source: "Y" });
    await funnel({ name: "Y", audience: { sources: ["Y"] }, steps: [{ id: "a", kind: "email", category: "intro" }, { id: "b", kind: "wait", days: 3 }, { id: "c", kind: "email", category: "feature" }] });
    await outreachTick({ now: at });
    const [thread] = await db.insert(schema.mailThreads).values({ orgId, accountId }).returning();
    await db.insert(schema.mailMessages).values({ orgId, accountId, threadId: thread!.id, fromAddress: "Arjun@ArjunLogistics.in", fromName: "Arjun", subject: "Re: Hello", direction: "in", date: new Date(Date.now() + 60_000) });
    await outreachTick({ now: new Date(at.getTime() + days(3) + 3_600_000) });
    const c = await contact("arjun@arjunlogistics.in");
    expect(c.repliedAt).not.toBeNull();
    expect(c.stage).toBe("hot");
    expect(await sendsTo("arjun@arjunlogistics.in")).toHaveLength(1);
    const [e] = await db.select().from(schema.poEnrollments).where(eq(schema.poEnrollments.contactId, c.id));
    expect(e).toMatchObject({ status: "exited", exitReason: "replied" });
    const o = await A("GET", "overview");
    expect(o.json.hotLeads[0]).toMatchObject({ email: "arjun@arjunlogistics.in", why: "Replied to an email" });
  });

  it("retires a losing subject line and writes a new challenger", async () => {
    const [t] = await db.select().from(schema.poTemplates).where(eq(schema.poTemplates.key, "intro-one-platform"));
    await A("POST", "contacts/paste", { text: "s@stats.in", source: "S" });
    const c = await contact("s@stats.in");
    // 200 sends each: the first subject gets 30 clicks, the second 4.
    await db.insert(schema.poSends).values(Array.from({ length: 400 }, (_, i) => ({ token: `stat${i}`.padEnd(20, "x"), contactId: c.id, templateId: t!.id, variant: i < 200 ? 0 : 1, subject: "s", sentAt: new Date(Date.now() - days(30)), clicks: (i < 200 && i < 30) || (i >= 200 && i < 204) ? 1 : 0 })));
    setSubjectWriter(async ({ winner }) => `A fresh angle on: ${winner.slice(0, 20)}`);
    const r = await evolveSubjects(await getSettings(), () => 0.5);
    expect(r).toMatchObject({ retired: 1, written: 1 });
    const [after] = await db.select().from(schema.poTemplates).where(eq(schema.poTemplates.id, t!.id));
    expect(after!.retired).toEqual([1]);
    expect(after!.subjects).toHaveLength(3);
    expect(after!.subjects[2]).toMatch(/^A fresh angle on/);
    const decisions = await db.select().from(schema.poEvents).where(and(eq(schema.poEvents.kind, "engine")));
    expect(decisions.some((d) => /retired/.test(String(d.detail.text)))).toBe(true);
    // The retired line is never sent again.
    await funnel({ name: "S", audience: { sources: ["S"] }, steps: [{ id: "a", kind: "email", templateId: t!.id }] });
    await outreachTick({ now: at });
    const mine = (await sendsTo("s@stats.in")).filter((s) => !s.token.startsWith("stat"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.variant).not.toBe(1);
  });
});
