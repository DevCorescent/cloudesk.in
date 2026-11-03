import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as profile from "@/app/api/v1/auth/profile/route";
import * as myInvites from "@/app/api/v1/auth/invitations/route";
import * as people from "@/app/api/v1/orgs/[orgId]/people/route";
import * as invitations from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as cardsApi from "@/app/api/v1/orgs/[orgId]/cards/[[...slug]]/route";
import * as exchangeApi from "@/app/api/v1/cards/[slug]/route";
import * as vcf from "@/app/id/[slug]/vcf/route";
import { closeChatBus } from "@/server/chat/bus";
import { call, cookieFrom, resetDb } from "../helpers";

// Finding people by username, email or phone to invite them to a workspace or
// a conversation (without ever seeing their email), and business IDs.
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const O: Record<string, string> = {};
type H = Parameters<typeof call>[0];
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const find = async (q: string, who = "meera") => (await call(people.GET, { cookie: C[who], path: `/api/v1/orgs/${O[who]}/people?q=${encodeURIComponent(q)}`, params: { orgId: O[who]! } })).json.results;
const chat = (method: string, path: string, body?: unknown, who = "meera") => call((chatApi as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${O.meera}/chat/${path}`, params: { orgId: O.meera!, slug: seg(path) } });
const cards = (method: string, path: string, body?: unknown, who = "meera") => call((cardsApi as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${O.meera}/cards/${path}`, params: { orgId: O.meera!, slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["meera", "Meera Iyer", "meera@saffron.in"], ["kabir", "Kabir Shah", "kabir@studionorth.in"], ["priya", "Priya Nair", "priya@kaya.clinic"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    const m = (await call(me.GET, { cookie: C[k] })).json;
    U[k] = m.user.id;
    O[k] = m.organizations[0].id;
  }
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("usernames", () => {
  it("everyone has one, made from their name, and can change it", async () => {
    const p = (await call(profile.GET, { cookie: C.kabir })).json.profile;
    expect(p.username).toBe("kabir.shah");
    expect((await call(profile.GET, { cookie: C.meera, path: "/api/v1/auth/profile?username=kabir.shah" })).json).toMatchObject({ ok: false });
    expect((await call(profile.PATCH, { method: "PATCH", cookie: C.meera, body: { username: "Kabir.Shah" } })).status).toBe(422);
    const r = await call(profile.PATCH, { method: "PATCH", cookie: C.kabir, body: { username: "@kabir", phone: "+91 98220 41736" } });
    expect(r.json.profile).toMatchObject({ username: "kabir", phone: "+91 98220 41736" });
    expect((await call(profile.PATCH, { method: "PATCH", cookie: C.priya, body: { discoverable: false } })).json.profile.discoverable).toBe(false);
  });
});

describe("finding people", () => {
  it("by username as you type, never sending back their email or phone", async () => {
    const hits = await find("@kab");
    expect(hits).toEqual([{ kind: "account", id: U.kabir, name: "Kabir Shah", username: "kabir", member: false, invited: false }]);
    expect(JSON.stringify(hits)).not.toContain("studionorth");
    expect(JSON.stringify(hits)).not.toContain("98220");
  });
  it("by an exact email or phone number only", async () => {
    expect((await find("kabir@studionorth.in"))[0]).toMatchObject({ kind: "account", id: U.kabir });
    expect((await find("098220 41736"))[0]).toMatchObject({ kind: "account", id: U.kabir });
    expect(await find("studionorth")).toEqual([]);
    // An email nobody has: offered to invite as typed.
    expect(await find("new.person@example.com")).toEqual([{ kind: "email", email: "new.person@example.com" }]);
  });
  it("not when they've switched discovery off — unless they're in your workspace", async () => {
    expect((await find("priya")).some((h: { kind: string }) => h.kind === "account")).toBe(false);
    expect((await find("priya@kaya.clinic")).some((h: { kind: string }) => h.kind === "account")).toBe(false);
    await db.insert(schema.memberships).values({ orgId: O.meera!, userId: U.priya!, role: "editor" });
    expect((await find("priya"))[0]).toMatchObject({ kind: "account", id: U.priya, member: true });
  });
  it("and the workspace's own contacts with an email", async () => {
    await db.insert(schema.mailContacts).values({ orgId: O.meera!, name: "Asha Kulkarni", email: "asha@lumen.studio" });
    expect(await find("asha")).toContainEqual({ kind: "contact", key: "Mail:asha@lumen.studio", name: "Asha Kulkarni", email: "asha@lumen.studio", source: "Mail" });
  });
  it("only for members of the workspace", async () => {
    expect((await call(people.GET, { cookie: C.kabir, path: `/api/v1/orgs/${O.meera}/people?q=meera`, params: { orgId: O.meera! } })).status).toBe(404);
  });
});

describe("inviting to a workspace by username", () => {
  it("hides the invitee's email from the inviter, and waits for them in Cloudesk", async () => {
    const r = await call(invitations.POST, { method: "POST", cookie: C.meera, body: { userId: U.kabir, role: "editor" }, params: { orgId: O.meera! } });
    expect(r.status).toBe(201);
    expect(r.json.invitation).toMatchObject({ email: "", label: "Kabir Shah · @kabir", role: "editor" });
    const list = (await call(invitations.GET, { cookie: C.meera, params: { orgId: O.meera! } })).json.invitations;
    expect(list[0]).toMatchObject({ email: "", label: "Kabir Shah · @kabir" });
    expect((await find("@kab"))[0]).toMatchObject({ invited: true });
    // The email still goes to them.
    const [mail] = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "kabir@studionorth.in"), like(schema.outboundEmails.subject, "%invited you%")));
    expect(mail?.subject).toBe("Meera Iyer invited you to " + (await db.select({ n: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, O.meera!)))[0]!.n);

    const waiting = (await call(myInvites.GET, { cookie: C.kabir })).json.invitations;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ inviter: "Meera Iyer", role: "editor" });
    expect((await call(myInvites.POST, { method: "POST", cookie: C.priya, body: { id: waiting[0].id, accept: true } })).status).toBe(400);
    const joined = await call(myInvites.POST, { method: "POST", cookie: C.kabir, body: { id: waiting[0].id, accept: true } });
    expect(joined.json).toMatchObject({ orgId: O.meera, joined: true });
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, O.meera!), eq(schema.memberships.userId, U.kabir!)));
    expect(m?.role).toBe("editor");
    expect((await call(myInvites.GET, { cookie: C.kabir })).json.invitations).toEqual([]);
  });
});

describe("inviting to a conversation", () => {
  let launch = "";
  beforeAll(async () => {
    await chat("POST", "channels", { name: "launch", visibility: "private" });
    launch = (await chat("GET", "meta")).json.channels.find((c: { name: string }) => c.name === "launch").id;
  });
  it("adds a member of the workspace straight away", async () => {
    const r = await chat("POST", `channels/${launch}/invite-person`, { userId: U.kabir });
    expect(r.json).toMatchObject({ added: 1, sent: 0 });
    const members = (await chat("GET", `channels/${launch}/members`)).json.members.map((m: { userId: string }) => m.userId);
    expect(members).toContain(U.kabir);
  });
  it("emails anyone else a guest link, without showing their address", async () => {
    await db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, O.meera!), eq(schema.memberships.userId, U.priya!)));
    const r = await chat("POST", `channels/${launch}/invite-person`, { userId: U.priya });
    expect(r.json).toMatchObject({ added: 0, sent: 1, label: "@priya.nair" });
    const [mail] = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "priya@kaya.clinic"), like(schema.outboundEmails.subject, "%invited you to chat%")));
    expect(mail?.body).toMatch(/\/j\/[\w-]+/);
    const e = await chat("POST", `channels/${launch}/invite-person`, { email: "asha@lumen.studio" });
    expect(e.json).toMatchObject({ sent: 1, label: "asha@lumen.studio" });
    // One link for everyone invited by name, letting them in without approval.
    const invites = (await chat("GET", `channels/${launch}/invites`)).json.invites.filter((i: { label: string }) => i.label === "Invited by name");
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ approval: false });
  });
  it("only the conversation's admins invite people from outside", async () => {
    expect((await chat("POST", `channels/${launch}/invite-person`, { email: "someone@example.com" }, "kabir")).status).toBe(403);
  });
});

describe("business IDs", () => {
  let slug = "";
  it("are made the first time you open yours, from what Cloudesk already knows", async () => {
    const r = (await cards("GET", "me")).json;
    slug = r.card.slug;
    expect(slug).toBe("meera-iyer");
    expect(r.card.data).toMatchObject({ name: "Meera Iyer", email: "meera@saffron.in" });
    expect(r.card.qr).toContain("<svg");
    expect(r.card.url).toBe(`http://localhost:3000/id/${slug}`);
  });
  it("follow the company's template where it fixes things", async () => {
    expect((await cards("PUT", "template", { data: { company: "Saffron House", website: "saffron.in" }, lockCompany: true }, "kabir")).status).toBe(403);
    await cards("PUT", "template", { data: { company: "Saffron House", website: "saffron.in" }, style: { design: "night", accent: "#1f7a55" }, lockCompany: true, lockStyle: true });
    const r = (await cards("PATCH", "me", { data: { title: "Founder", company: "Something else" } })).json.card;
    expect(r.effective.data).toMatchObject({ title: "Founder", company: "Saffron House", website: "https://saffron.in" });
    expect(r.effective.style).toMatchObject({ design: "night", accent: "#1f7a55" });
    expect((await cards("PATCH", "me", { style: { design: "bold" } })).status).toBe(403);
  });
  it("can be saved to contacts, and people can send their details back", async () => {
    const v = await call(vcf.GET as H, { path: `/id/${slug}/vcf`, params: { slug } });
    expect(v.status).toBe(200);
    expect(v.headers.get("content-type")).toContain("text/vcard");
    expect(v.text).toContain("FN:Meera Iyer");
    expect(v.text).toContain("ORG:Saffron House");
    expect((await call(exchangeApi.POST, { method: "POST", body: { name: "Rohan" }, params: { slug } })).status).toBe(422);
    const x = await call(exchangeApi.POST, { method: "POST", body: { name: "Rohan Mehta", email: "rohan@mehta.co", company: "Mehta Traders", note: "Met at the expo" }, params: { slug } });
    expect(x.status).toBe(200);
    const mine = (await cards("GET", "me")).json;
    expect(mine.exchanges[0]).toMatchObject({ name: "Rohan Mehta", email: "rohan@mehta.co", company: "Mehta Traders" });
    expect(mine.card).toMatchObject({ saves: 1 });
    const [lead] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, O.meera!), eq(schema.crmContacts.email, "rohan@mehta.co")));
    expect(lead?.source).toBe("business_card");
    const [n] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.meera!), eq(schema.notifications.kind, "card.exchange")));
    expect(n?.title).toBe("Rohan Mehta sent you their details");
  });
  it("show nothing once switched off, and keep their address unique", async () => {
    await cards("PATCH", "me", { published: false });
    expect((await call(vcf.GET as H, { path: `/id/${slug}/vcf`, params: { slug } })).status).toBe(404);
    const k = (await cards("GET", "me", undefined, "kabir")).json.card;
    expect((await cards("PATCH", "me", { slug: k.slug })).status).toBe(422);
  });
  it("can be made for the whole team at once", async () => {
    const before = (await cards("GET", "all")).json.members;
    expect(before.every((m: { card: unknown }) => m.card)).toBe(true);
    expect((await cards("POST", "generate")).json).toEqual({ made: 0 });
  });
});
