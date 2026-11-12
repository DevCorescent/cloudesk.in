import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as pixel from "@/app/api/v1/po/o/[token]/route";
import * as click from "@/app/api/v1/po/c/[token]/route";
import * as unsub from "@/app/api/v1/po/u/[token]/route";
import { outreachTick, setMxResolver, syncConversions } from "@/server/outreach/core";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Outreach end to end: contacts from a spreadsheet and pasted text; the
// built-in templates; a funnel that sends the best template at the right time
// within the daily limit, branches on what people did, and stops for
// unsubscribes, sign-ups and people who never open; tracking of opens, clicks
// and unsubscribes; sign-ups credited to the email that won them; a funnel
// that pauses itself on bounces; and who may do what.
const C: Record<string, string> = {};
const PW = "correct-horse-42";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown, who = "owner") => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/admin/outreach/${path}`, params: { slug: ["outreach", ...seg(path)] } });
const reauth = (who = "owner") => call((admin as unknown as Record<string, Parameters<typeof call>[0]>).POST, { method: "POST", cookie: C[who], body: { password: PW }, path: "/api/v1/admin/reauth", params: { slug: ["reauth"] } });
const contact = async (email: string) => (await db.select().from(schema.poContacts).where(eq(schema.poContacts.email, email)))[0]!;
const sendsTo = async (email: string) => db.select().from(schema.poSends).where(eq(schema.poSends.contactId, (await contact(email)).id));

/** A Tuesday 11:00 in India, at least a day from now, inside the default sending window. */
function tuesdayEleven(daysAhead = 1) {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  for (;;) {
    const local = new Date(d.getTime() + 19_800_000);
    if (local.getUTCDay() === 2) return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 11) - 19_800_000);
    d.setTime(d.getTime() + 86_400_000);
  }
}
const at = tuesdayEleven();
let seq = 0;
const rand = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const req = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { "user-agent": UA, ...(init.headers ?? {}) } });

beforeAll(async () => {
  await resetDb();
  setMxResolver(async () => true);
  for (const [k, name, role] of [["owner", "Olga Owner", "owner"], ["analyst", "Ana Analyst", "analyst"], ["member", "Max Member", null]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${k}@outreach.example`, password: PW } }));
    const u = (await call(me.GET, { cookie: C[k] })).json;
    if (role) await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: role }).where(eq(schema.users.id, u.user.id));
  }
});
afterAll(closeDb);

describe("outreach", () => {
  it("is only for platform admins, and analysts can look but not change", async () => {
    expect((await A("GET", "overview", undefined, "member")).status).toBe(404);
    expect((await A("GET", "overview", undefined, "analyst")).status).toBe(200);
    expect((await A("POST", "contacts paste", { text: "a@b.co" }, "analyst")).status).toBe(403);
  });

  it("imports a spreadsheet and pasted text: deduplicated, industries recognised, extra columns kept", async () => {
    const r = await A("POST", "contacts/import", {
      source: "Trade fair 2026",
      consent: "legitimate_interest",
      rows: [
        { email: "Asha@RaoTraders.in", first_name: "Asha", last_name: "Rao", company: "Rao Traders", industry: "Garment retail", city: "Pune", gst_turnover: "2 Cr" },
        { email: "dev@thirdwave.cafe", name: "Dev Malhotra", company: "Third Wave Cafe" },
        { email: "priya@smileclinic.in", name: "Priya Nair", company: "Smile Dental Clinic" },
        { email: "kiran@kiranhardware.in", name: "Kiran", company: "Kiran Hardware Store" },
        { email: "not-an-email", name: "Nobody" },
        { email: "asha@raotraders.in", name: "Asha again" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ created: 4, skipped: 1 });
    const asha = await contact("asha@raotraders.in");
    expect(asha).toMatchObject({ name: "Asha Rao", industry: "retail", city: "Pune", source: "Trade fair 2026", stage: "new", status: "active" });
    expect(asha.data).toEqual({ gst_turnover: "2 Cr" });
    expect((await contact("dev@thirdwave.cafe")).industry).toBe("restaurant");
    expect((await contact("priya@smileclinic.in")).industry).toBe("clinic");

    const p = await A("POST", "contacts/paste", { text: "Ravi Menon <ravi@menon.in>, Menon Traders\nmeena@meenasalon.in\nasha@raotraders.in", source: "Pasted", tags: ["warm"] });
    expect(p.json).toMatchObject({ created: 2, updated: 1 });
    expect(await contact("ravi@menon.in")).toMatchObject({ name: "Ravi Menon", company: "Menon Traders", tags: ["warm"] });
    // An import only fills blanks and adds tags.
    expect(await contact("asha@raotraders.in")).toMatchObject({ name: "Asha Rao", tags: ["warm"] });
  });

  it("comes with the template library, and previews merge each person's details", async () => {
    const t = await A("GET", "templates");
    expect(t.json.templates.length).toBeGreaterThanOrEqual(18);
    const intro = t.json.templates.find((x: { key: string }) => x.key === "intro-one-platform");
    const asha = await contact("asha@raotraders.in");
    const pv = await A("POST", "templates/preview", { template: intro, contactId: asha.id });
    expect(pv.json.subject).toBe("Asha, run Rao Traders from one place");
    expect(pv.json.html).toContain("Hi Asha,");
    expect(pv.json.html).toContain("Unsubscribe");
    const anon = await A("POST", "templates/preview", { template: { ...intro, subjects: ["Hello {{firstName|there}} from {{city|India}}"] } });
    expect(anon.json.subject).toBe("Hello Asha from Pune");
  });

  it("won't send without a postal address", async () => {
    await reauth();
    expect((await A("PUT", "settings", { sending: true })).status).toBe(422);
    const ok = await A("PUT", "settings", { sending: true, postalAddress: "12 MG Road, Pune 411001", dailyLimit: 3, warmup: false, minGapHours: 24 });
    expect(ok.status).toBe(200);
    expect(ok.json.settings).toMatchObject({ sending: true, dailyLimit: 3 });
  });

  let funnelId = "";
  it("runs a funnel: the most promising first, within the daily limit, with tracked links and unsubscribe", async () => {
    const f = await A("POST", "funnels", {
      name: "Test intro",
      audience: { sources: ["Trade fair 2026", "Pasted"] },
      goal: "signed_up",
      steps: [
        { id: "s1", kind: "email", category: "intro" },
        { id: "s2", kind: "wait", days: 2 },
        { id: "s3", kind: "branch", if: "clicked", then: "s4", else: "s5" },
        { id: "s4", kind: "email", category: "offer" },
        { id: "s5", kind: "email", category: "reengage" },
      ],
    });
    expect(f.status).toBe(200);
    funnelId = f.json.funnel.id;
    expect((await A("POST", "funnels", { name: "Bad", steps: [{ id: "a", kind: "branch", if: "opened", then: "zz" }] })).status).toBe(422);
    // A warmer lead goes first when the limit is tight.
    await db.update(schema.poContacts).set({ score: 40 }).where(eq(schema.poContacts.email, "dev@thirdwave.cafe"));
    const s = await A("POST", `funnels/${funnelId}/start`);
    expect(s.json.enrolled).toBe(6);

    const r = await outreachTick({ now: at, rand });
    expect(r.sent).toBe(3);
    expect((await sendsTo("dev@thirdwave.cafe")).length).toBe(1);
    const [devSend] = await sendsTo("dev@thirdwave.cafe");
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "dev@thirdwave.cafe"));
    expect(mail!.subject).toBe(devSend!.subject);
    expect(mail!.body).toContain(`/po/u/${devSend!.token}`);
    expect(mail!.body).toContain("12 MG Road, Pune 411001");
    // The daily limit holds for the rest of the day.
    expect((await outreachTick({ now: at, rand })).sent).toBe(0);
  });

  it("tracks opens, clicks and unsubscribes", async () => {
    // Read an hour after it arrived (a hit within seconds of delivery is a scanner's).
    await db.update(schema.poSends).set({ sentAt: new Date(Date.now() - 3_600_000) });
    const [devSend] = await sendsTo("dev@thirdwave.cafe");
    const tok = devSend!.token;
    const px = await pixel.GET(req(`${ORIGIN}/api/v1/po/o/${tok}`), { params: Promise.resolve({ token: tok }) });
    expect(px.headers.get("content-type")).toBe("image/gif");
    const target = Buffer.from("https://cloudesk.in/start?utm_source=outreach&po=" + tok).toString("base64url");
    const cl = await click.GET(req(`${ORIGIN}/api/v1/po/c/${tok}?u=${target}`), { params: Promise.resolve({ token: tok }) });
    expect(cl.status).toBe(302);
    expect(cl.headers.get("location")).toBe(`https://cloudesk.in/start?utm_source=outreach&po=${tok}`);
    const dev = await contact("dev@thirdwave.cafe");
    expect(dev).toMatchObject({ opens: 1, clicks: 1, unopenedRun: 0, score: 15, stage: "engaged" });
    expect(dev.bestHour).not.toBeNull();
    // A link that isn't a web address goes home instead.
    const bad = await click.GET(req(`${ORIGIN}/api/v1/po/c/${tok}?u=${Buffer.from("javascript:alert(1)").toString("base64url")}`), { params: Promise.resolve({ token: tok }) });
    expect(bad.headers.get("location")).not.toContain("javascript");

    const sent = await db.select().from(schema.poSends).where(eq(schema.poSends.funnelId, funnelId));
    const other = sent.find((x) => x.contactId !== dev.id)!;
    const u = await unsub.POST(new Request(`${ORIGIN}/api/v1/po/u/${other.token}`, { method: "POST" }), { params: Promise.resolve({ token: other.token }) });
    expect(u.status).toBe(200);
    const gone = (await db.select().from(schema.poContacts).where(eq(schema.poContacts.id, other.contactId)))[0]!;
    expect(gone.status).toBe("unsubscribed");
    const [enr] = await db.select().from(schema.poEnrollments).where(and(eq(schema.poEnrollments.contactId, other.contactId), eq(schema.poEnrollments.funnelId, funnelId)));
    expect(enr).toMatchObject({ status: "exited", exitReason: "unsubscribed" });
  });

  it("branches on what they did: the clicker gets the offer, the rest a re-engagement", async () => {
    await reauth();
    await A("PUT", "settings", { sending: true, postalAddress: "12 MG Road, Pune 411001", dailyLimit: 50, warmup: false, minGapHours: 24 });
    // 18:30, so whatever hour the engine learned for them today has come.
    const later = new Date(at.getTime() + 2 * 86_400_000 + 7.5 * 3_600_000);
    await outreachTick({ now: later, rand });
    const devSends = await db.select({ s: schema.poSends, t: schema.poTemplates }).from(schema.poSends).innerJoin(schema.poTemplates, eq(schema.poTemplates.id, schema.poSends.templateId)).where(eq(schema.poSends.contactId, (await contact("dev@thirdwave.cafe")).id));
    expect(devSends.map((x) => x.t.category)).toEqual(["intro", "offer"]);
    const unsubbed = await db.select().from(schema.poContacts).where(eq(schema.poContacts.status, "unsubscribed"));
    for (const c of unsubbed) expect((await db.select().from(schema.poSends).where(eq(schema.poSends.contactId, c.id))).length).toBe(1);
  });

  it("credits a sign-up to the email they clicked, and stops their funnel", async () => {
    await call(signup.POST, { method: "POST", body: { name: "Dev Malhotra", email: "dev@thirdwave.cafe", password: PW } });
    const r = await syncConversions();
    expect(r.signedUp).toBe(1);
    const dev = await contact("dev@thirdwave.cafe");
    // Signing up starts a workspace trial, so they land a stage further on.
    expect(dev.stage).toBe("trial");
    const [first] = (await sendsTo("dev@thirdwave.cafe")).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    expect(dev.convertedBy).toBe(first!.id);
    expect(first!.convertedAt).not.toBeNull();
    await outreachTick({ now: new Date(at.getTime() + 20 * 86_400_000), rand });
    const [enr] = await db.select().from(schema.poEnrollments).where(and(eq(schema.poEnrollments.contactId, dev.id), eq(schema.poEnrollments.funnelId, funnelId)));
    expect(enr!.status).toBe("converted");
  });

  it("stops emailing people who never open", async () => {
    const f = await A("POST", "funnels", { name: "Sunset test", audience: { sources: ["Sunset"] }, steps: [{ id: "a", kind: "email", category: "feature" }] });
    await A("POST", "contacts/paste", { text: "quiet@nowhere.in", source: "Sunset" });
    await db.update(schema.poContacts).set({ unopenedRun: 9 }).where(eq(schema.poContacts.email, "quiet@nowhere.in"));
    await A("POST", `funnels/${f.json.funnel.id}/start`);
    await outreachTick({ now: new Date(at.getTime() + 30 * 86_400_000), rand });
    const q = await contact("quiet@nowhere.in");
    expect(q.stage).toBe("lost");
    expect((await sendsTo("quiet@nowhere.in")).length).toBe(0);
  });

  it("pauses a funnel whose sends bounce too much", async () => {
    const f = await A("POST", "funnels", { name: "Risky", audience: { sources: ["Nobody"] }, steps: [{ id: "a", kind: "email", category: "intro" }] });
    const id = f.json.funnel.id;
    await A("POST", `funnels/${id}/start`);
    const someone = await contact("meena@meenasalon.in");
    await db.insert(schema.poSends).values(Array.from({ length: 60 }, (_, i) => ({ token: `risk${i}xxxxxxxxxxxxxx`, contactId: someone.id, funnelId: id, subject: "x", status: i < 6 ? "bounced" : "sent" })));
    await outreachTick({ now: new Date(at.getTime() + 31 * 86_400_000), rand });
    const [row] = await db.select().from(schema.poFunnels).where(eq(schema.poFunnels.id, id));
    expect(row).toMatchObject({ status: "paused" });
    expect(row!.pausedReason).toMatch(/bounce rate 10\.0%/);
    const o = await A("GET", "overview");
    expect(o.json.decisions.some((d: { text: string }) => /Paused Risky/.test(d.text))).toBe(true);
    expect(o.json.funnel.map((x: { key: string }) => x.key)).toEqual(["contacts", "emailed", "opened", "clicked", "signed_up", "trial", "paying"]);
    await db.delete(schema.poSends).where(inArray(schema.poSends.token, Array.from({ length: 60 }, (_, i) => `risk${i}xxxxxxxxxxxxxx`)));
  });

  it("sends nothing while the switch is off", async () => {
    await reauth();
    await A("PUT", "settings", { sending: false, postalAddress: "12 MG Road, Pune 411001" });
    expect(await outreachTick({ now: new Date(at.getTime() + 40 * 86_400_000), rand })).toMatchObject({ sent: 0, reason: "sending is off" });
  });
});
