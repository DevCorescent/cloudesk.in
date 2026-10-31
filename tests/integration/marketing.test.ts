import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/marketing/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as capture from "@/app/api/v1/crm/capture/[token]/route";
import * as link from "@/app/m/[token]/route";
import * as event from "@/app/e/[token]/route";
import { drain } from "@/server/marketing/core";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// A segment of contacts who agreed to marketing, an A/B email sent through
// the outbox with tracked links and unsubscribe, an event's registration page
// and check-in, a lead form tagged with utm_campaign, and a won deal credited
// to the campaigns that touched the contact.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const M = mk(api, "marketing");
const CRM = mk(crmApi, "crm");
const tokenIn = (body: string, n: number) => [...body.matchAll(/\/m\/([A-Za-z0-9_.-]+)/g)].map((x) => x[1])[n];

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Mona Marketer", email: "mona.mkt@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vic Viewer", email: "vic.mkt@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "vic.mkt@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "viewer" });
  for (const [name, email, marketing, tags] of [["Asha Nair", "asha@lumen.example", true, ["vip"]], ["Ravi Rao", "ravi@zen.example", true, ["vip"]], ["Neel Shah", "neel@x.example", false, ["vip"]], ["Ola Bose", "ola@y.example", true, []]] as const) {
    ids[name.split(" ")[0].toLowerCase()] = (await CRM("POST", "contacts", { name, email, marketing, tags })).json.contact.id;
  }
});
afterAll(closeDb);

describe("segments and email", () => {
  it("counts who's in a segment and who may be emailed", async () => {
    const p = (await M("POST", "segments/preview", { tagsAny: ["VIP"] })).json;
    expect(p).toMatchObject({ count: 3, mailable: 2 });
    expect((await M("POST", "segments", { name: "VIPs", rules: { tagsAny: ["vip"] } }, "viewer")).status).toBe(403);
    ids.seg = (await M("POST", "segments", { name: "VIPs", rules: { tagsAny: ["vip"] } })).json.segment.id;
    expect((await M("GET", "segments")).json.segments[0]).toMatchObject({ count: 3, mailable: 2 });
  });

  it("sends an A/B email with tracked links, only to those who agreed, and records clicks and unsubscribes", async () => {
    const c = (await M("POST", "campaigns", { name: "Diwali sale", kind: "email", segmentId: ids.seg, subject: "Diwali offers inside", subjectB: "{{first_name}}, 20% off this week", body: "Hi {{first_name}},\nOur sale is on: https://shop.example/diwali.\nThanks!", budget: 1000000, spend: 500000 })).json.campaign;
    expect(c).toMatchObject({ slug: "diwali-sale", status: "draft" });
    ids.email = c.id;
    expect((await M("GET", `campaigns/${c.id}`)).json.audienceNow).toBe(2);
    const sent = (await M("POST", `campaigns/${c.id}/send`, {})).json;
    expect(sent).toMatchObject({ status: "sending", recipients: 2, emailed: false });
    await drain(c.id);
    const d = (await M("GET", `campaigns/${c.id}`)).json;
    expect(d.campaign.status).toBe("sent");
    expect(d.results.email.all).toMatchObject({ total: 2, sent: 2, failed: 0 });
    expect((await M("POST", `campaigns/${c.id}/send`, {})).status).toBe(409);

    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "asha@lumen.example"));
    expect(mail.body).toMatch(/^Hi Asha,/);
    expect(mail.body).not.toContain("https://shop.example/diwali");
    const clickT = tokenIn(mail.body, 0);
    const res = await call(link.GET as never, { path: `/m/${clickT}`, params: { token: clickT } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://shop.example/diwali");
    await call(link.GET as never, { path: `/m/${clickT}`, params: { token: clickT } });
    // A token that's been tampered with goes nowhere.
    expect((await call(link.GET as never, { path: "/m/x", params: { token: clickT.replace(/.$/, "A") } })).status).toBe(404);
    const after = (await M("GET", `campaigns/${c.id}`)).json;
    expect(after.links).toEqual([{ url: "https://shop.example/diwali", clicks: 2, people: 1 }]);
    expect(after.results.email.all.clicked).toBe(1);

    const unsubT = tokenIn(mail.body, 1);
    expect((await call(link.GET as never, { path: `/m/${unsubT}`, params: { token: unsubT } })).text).toContain("Stop these emails?");
    expect((await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, ids.asha)))[0].doNotContact).toBe(false);
    await call(link.POST as never, { method: "POST", path: `/m/${unsubT}`, params: { token: unsubT } });
    expect((await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, ids.asha)))[0]).toMatchObject({ doNotContact: true, marketing: false });
    expect((await M("GET", "segments")).json.segments[0].mailable).toBe(1);
  });
});

describe("events and forms", () => {
  it("takes registrations to capacity, confirms them, and checks people in", async () => {
    const ev = (await M("POST", "campaigns", { name: "Product webinar", kind: "event", eventAt: "2099-01-15T10:30:00+05:30", onlineUrl: "https://meet.example/abc", capacity: 2 })).json.campaign;
    ids.event = ev.id;
    const token = ev.regUrl.split("/e/")[1];
    const page = await call(event.GET as never, { path: `/e/${token}`, params: { token } });
    expect(page.text).toContain("2 places left");
    const post = async (form: Record<string, string>) => {
      const req = new Request(`${ORIGIN}/e/${token}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
      const r = await event.POST(req, { params: Promise.resolve({ token }) });
      return { status: r.status, text: await r.text() };
    };
    expect((await post({ name: "Ravi Rao", email: "ravi@zen.example" })).text).toContain("You're registered");
    expect((await post({ name: "Ravi Rao", email: "RAVI@zen.example" })).text).toContain("already registered");
    expect((await post({ name: "Kiran", email: "kiran@new.example", consent: "yes" })).text).toContain("You're registered");
    const full = await post({ name: "Late", email: "late@x.example" });
    expect(full.text).toContain("Registration is closed");
    const [kiran] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.email, "kiran@new.example")));
    expect(kiran).toMatchObject({ source: "event", marketing: true });
    const regs = (await M("GET", `campaigns/${ev.id}/registrations`)).json.registrations;
    expect(regs).toHaveLength(2);
    await M("POST", `campaigns/${ev.id}/attend`, { registrationId: regs[0].id, attended: true });
    expect((await M("GET", `campaigns/${ev.id}`)).json.results).toMatchObject({ registered: 2, attended: 1 });
    const [conf] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "kiran@new.example"));
    expect(conf.subject).toBe("You're registered: Product webinar");
  });

  it("credits a campaign from a tagged lead form, and attributes won deals to the campaigns that touched them", async () => {
    const tagged = (await M("POST", `campaigns/${ids.email}/utm`, { url: "https://shop.example/landing", medium: "instagram" })).json.url;
    expect(tagged).toBe("https://shop.example/landing?utm_source=cloudesk&utm_medium=instagram&utm_campaign=diwali-sale");
    const token = (await CRM("GET", "meta")).json.settings.captureUrl.split("/").pop();
    await call(capture.POST, { method: "POST", origin: "https://anywhere.example", params: { token }, body: { name: "Form Person", email: "form@p.example", utm_campaign: "diwali-sale" } });
    const [fp] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.email, "form@p.example"));
    expect((await db.select().from(schema.mktTouches).where(eq(schema.mktTouches.contactId, fp.id)))[0]).toMatchObject({ campaignId: ids.email, kind: "form" });

    // Ravi got the email, then registered for the webinar, then won a deal.
    const stages = (await CRM("GET", "meta")).json.pipelines[0].stages;
    const deal = (await CRM("POST", "deals", { title: "Zen — annual", value: 30000000, contactId: ids.ravi })).json.deal;
    await CRM("POST", `deals/${deal.id}/move`, { stageId: stages.find((s: { kind: string }) => s.kind === "won").id });
    const list = (await M("GET", "campaigns")).json.campaigns;
    const email = list.find((c: { id: string }) => c.id === ids.email).results;
    const webinar = list.find((c: { id: string }) => c.id === ids.event).results;
    expect(email).toMatchObject({ deals: 1, firstValue: 30000000, lastValue: 0, linearValue: 15000000 });
    expect(webinar).toMatchObject({ deals: 1, firstValue: 0, lastValue: 30000000, linearValue: 15000000 });
    // ₹1,50,000 credited against ₹5,000 spent.
    expect(email.roi).toBe((15000000 - 500000) / 500000);
    expect((await M("GET", "home")).json.influenced).toEqual({ deals: 2, value: 30000000 });
  });
});
