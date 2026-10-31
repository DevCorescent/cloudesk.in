import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as guestApi from "@/app/api/v1/guest/chat/[[...slug]]/route";
import { closeChatBus } from "@/server/chat/bus";
import { guestCookieName } from "@/server/chat/guests";
import { GUEST_DOMAIN } from "@/lib/chat/guests";
import { call, cookieFrom, resetDb } from "../helpers";

// People outside the workspace join one conversation with an invite link and
// just a name; an admin lets them in; they see that conversation and nothing else.
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
let general = "";
let project = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
type H = Parameters<typeof call>[0];
const T = (method: string, path: string, body?: unknown, who = "meera") => call((chatApi as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/chat/${path}`, params: { orgId, slug: seg(path) } });
const Gx = (method: string, path: string, body?: unknown, cookie?: string, headers?: Record<string, string>) => call((guestApi as unknown as Record<string, H>)[method], { method, cookie, body, path: `/api/v1/guest/chat/${path}`, params: { slug: seg(path) }, headers });
const join = async (code: string, name: string, extra: Record<string, string> = {}, ip = "203.0.113.7") => {
  const r = await Gx("POST", `invite/${code}/join`, { name, ...extra }, undefined, { "x-forwarded-for": ip });
  return { ...r, cookie: cookieFrom(r) };
};
const invite = async (ch: string, body: Record<string, unknown> = {}, who = "meera") => (await T("POST", `channels/${ch}/invites`, body, who)).json.invite;

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["meera", "Meera Iyer", "meera@saffron.in"], ["ravi", "Ravi Kumar", "ravi@saffron.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.meera })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId, userId: U.ravi!, role: "editor" });
  const m = (await T("GET", "meta")).json;
  general = m.channels.find((c: { name: string }) => c.name === "general").id;
  await T("POST", "channels", { name: "client-project", visibility: "private", members: [U.ravi] });
  project = (await T("GET", "meta")).json.channels.find((c: { name: string }) => c.name === "client-project").id;
  await T("POST", `channels/${project}/messages`, { body: "Internal: budget is 4 lakh, don't share" });
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("invite links", () => {
  it("only the conversation's admins make them, never for a DM", async () => {
    expect((await T("POST", `channels/${project}/invites`, {}, "ravi")).status).toBe(403);
    const dm = (await T("POST", `dm/${U.ravi}`)).json.channel.id;
    expect((await T("POST", `channels/${dm}/invites`, {})).status).toBe(409);
    const i = await invite(project, { label: "Client team" });
    expect(i).toMatchObject({ label: "Client team", approval: true, history: false, files: true, uses: 0, problem: null });
    expect(i.url).toMatch(new RegExp(`/j/${i.code}$`));
    expect(new Date(i.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it("shows what it's for to anyone with the link, and nothing for a wrong one", async () => {
    const i = await invite(project);
    const r = await Gx("GET", `invite/${i.code}`);
    expect(r.json.invite).toMatchObject({ where: "#client-project", inviter: "Meera Iyer", approval: true, problem: null, channelId: project });
    expect((await Gx("GET", "invite/not-a-real-code-123")).status).toBe(404);
  });
});

describe("joining with just a name", () => {
  let code = "";
  let asha = "";
  let ashaId = "";

  it("asks to join, waits, and can't read anything yet", async () => {
    code = (await invite(project)).code;
    expect((await join(code, "A")).status).toBe(422);
    const r = await join(code, "Asha Verma", { contact: "asha@studio.in", note: "From the design studio" });
    expect(r.status).toBe(200);
    expect(r.cookie.startsWith(`${guestCookieName(project)}=`)).toBe(true);
    expect(r.headers.get("set-cookie")).toMatch(new RegExp(`Path=/api/v1/guest/chat/c/${project}; HttpOnly`));
    asha = r.cookie;
    const st = (await Gx("GET", `c/${project}`, undefined, asha)).json;
    expect(st.guest).toMatchObject({ name: "Asha Verma", status: "pending" });
    expect(st.channel).toBeNull();
    expect((await Gx("GET", `c/${project}/messages`, undefined, asha)).status).toBe(403);
    ashaId = st.guest.userId;
    // A hidden identity: no password, an address that can't receive mail, no workspace membership.
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, ashaId));
    expect(u!.passwordHash).toBeNull();
    expect(u!.email.endsWith(`@${GUEST_DOMAIN}`)).toBe(true);
    expect(await db.select().from(schema.memberships).where(eq(schema.memberships.userId, ashaId))).toHaveLength(0);
  });

  it("tells the conversation's admins, who see the request", async () => {
    const n = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.meera!), eq(schema.notifications.kind, "chat.guest")));
    expect(n[0]!.title).toBe("Asha Verma asks to join #client-project as a guest");
    expect(n[0]!.link).toBe(`/chat/${project}?guests=1`);
    const m = (await T("GET", "meta")).json;
    expect(m.channels.find((c: { id: string }) => c.id === project).requests).toBe(1);
    expect(m.counts.requests).toBe(1);
    // Ravi isn't an admin of the channel: no badge for him.
    expect((await T("GET", "meta", undefined, "ravi")).json.channels.find((c: { id: string }) => c.id === project).requests).toBe(0);
    const g = (await T("GET", `channels/${project}/guests`)).json.guests;
    expect(g[0]).toMatchObject({ name: "Asha Verma", contact: "asha@studio.in", note: "From the design studio", status: "pending" });
    expect((await T("GET", `channels/${project}/guests`, undefined, "ravi")).status).toBe(403);
  });

  it("once let in, sees only what's said from then on, and chats", async () => {
    const g = (await T("GET", `channels/${project}/guests`)).json.guests[0];
    expect((await T("POST", `guests/${g.id}/decide`, { approve: true }, "ravi")).status).toBe(403);
    expect((await T("POST", `guests/${g.id}/decide`, { approve: true })).status).toBe(200);
    expect((await T("POST", `guests/${g.id}/decide`, { approve: true })).status).toBe(409);
    const st = (await Gx("GET", `c/${project}`, undefined, asha)).json;
    expect(st.guest.status).toBe("approved");
    expect(st.channel).toMatchObject({ id: project, member: true, role: null, ai: false });
    // Members' emails stay private.
    expect(st.people.every((p: { email: string }) => p.email === "")).toBe(true);
    const page = (await Gx("GET", `c/${project}/messages`, undefined, asha)).json.messages;
    expect(page.map((m: { body: string }) => m.body).join(" ")).not.toMatch(/budget/);
    expect(page.at(-1).body).toBe("Asha Verma joined as a guest — let in by Meera Iyer");

    const sent = await Gx("POST", `c/${project}/messages`, { body: "Hello team! Sharing the mockups soon @everyone" }, asha);
    expect(sent.status).toBe(200);
    expect(sent.json.message.mentions.everyone).toBe(false);
    // Members see it, with the guest's name.
    const mm = (await T("GET", `channels/${project}/messages`)).json.messages;
    expect(mm.at(-1)).toMatchObject({ authorId: ashaId, body: "Hello team! Sharing the mockups soon @everyone" });
    const meta = (await T("GET", "meta")).json;
    expect(meta.guests).toEqual([expect.objectContaining({ id: ashaId, name: "Asha Verma", guest: true })]);
    expect(meta.people.some((p: { id: string }) => p.id === ashaId)).toBe(false);
    expect(meta.channels.find((c: { id: string }) => c.id === project).guests).toBe(1);
  });

  it("reacts, replies in threads, edits and deletes their own — but only text", async () => {
    const top = (await T("POST", `channels/${project}/messages`, { body: "Asha, can you send the PDF?" })).json.message;
    expect((await Gx("POST", `c/${project}/messages/${top.id}/react`, { emoji: "👍" }, asha)).status).toBe(200);
    const reply = await Gx("POST", `c/${project}/messages`, { body: "Sure, sending now", parentId: top.id }, asha);
    expect(reply.json.message.parentId).toBe(top.id);
    expect((await T("GET", `messages/${top.id}`)).json.message).toMatchObject({ replyCount: 1, reactions: [{ emoji: "👍", users: [ashaId] }] });
    expect((await Gx("PATCH", `c/${project}/messages/${reply.json.message.id}`, { body: "Sure — sending now" }, asha)).json.message.body).toBe("Sure — sending now");
    expect((await Gx("PATCH", `c/${project}/messages/${top.id}`, { body: "hijack" }, asha)).status).toBe(403);
    expect((await Gx("DELETE", `c/${project}/messages/${top.id}`, undefined, asha)).status).toBe(403);
    // Polls and the like are stripped: an empty text message is refused.
    expect((await Gx("POST", `c/${project}/messages`, { poll: { question: "Q?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } }, asha)).status).toBe(422);
  });

  it("votes in polls members start", async () => {
    const poll = (await T("POST", `channels/${project}/messages`, { poll: { question: "Review call?", options: [{ id: "mon", label: "Monday" }, { id: "tue", label: "Tuesday" }] } })).json.message;
    expect((await Gx("POST", `c/${project}/messages/${poll.id}/vote`, { choice: "tue" }, asha)).json.message.votes).toEqual([expect.objectContaining({ choice: "tue", userId: ashaId })]);
  });

  it("shares files when the invite allows, and gets them back", async () => {
    const up = await call((guestApi as unknown as Record<string, H>).POST, { method: "POST", cookie: asha, path: `/api/v1/guest/chat/c/${project}/files?name=mock.txt`, params: { slug: ["c", project, "files"] }, headers: { "content-type": "text/plain" } });
    // The helper sends no body: an empty file is refused, the route is reachable.
    expect(up.status).toBe(422);
    const req = new Request(`http://localhost:3000/api/v1/guest/chat/c/${project}/files?name=mock.txt`, { method: "POST", headers: { cookie: asha, origin: "http://localhost:3000", "content-type": "text/plain" }, body: "hello" });
    const res = await guestApi.POST(req, { params: Promise.resolve({ slug: ["c", project, "files"] }) });
    const file = (await res.json()).file;
    expect(file).toMatchObject({ filename: "mock.txt", size: 5 });
    const msg = (await Gx("POST", `c/${project}/messages`, { body: "", files: [file.id] }, asha)).json.message;
    expect(msg.files).toHaveLength(1);
    const dl = await Gx("GET", `c/${project}/files/${file.id}`, undefined, asha);
    expect(dl.text).toBe("hello");
  });

  it("never reaches any other conversation, or members' Chat", async () => {
    const [name, value] = asha.split("=");
    expect(name).toBe(guestCookieName(project));
    // The same secret under another conversation's cookie name is refused.
    expect((await Gx("GET", `c/${general}/messages`, undefined, `${guestCookieName(general)}=${value}`)).status).toBe(401);
    expect((await Gx("GET", `c/${general}`, undefined, `${guestCookieName(general)}=${value}`)).json.guest).toBeNull();
    // No session, so the members' API turns them away.
    expect((await call((chatApi as unknown as Record<string, H>).GET, { cookie: asha, path: `/api/v1/orgs/${orgId}/chat/meta`, params: { orgId, slug: ["meta"] } })).status).toBe(401);
    // A message id from #general is not found.
    const g = (await T("POST", `channels/${general}/messages`, { body: "company only" })).json.message;
    expect((await Gx("GET", `c/${project}/messages/${g.id}`, undefined, asha)).status).toBe(404);
  });

  it("is never notified (no inbox, no email), even when mentioned", async () => {
    await T("POST", `channels/${project}/messages`, { body: `@[Asha Verma](u:${ashaId}) thanks!`, priority: "urgent" });
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.userId, ashaId))).toHaveLength(0);
    expect((await db.select().from(schema.outboundEmails)).some((e) => e.to.endsWith(GUEST_DOMAIN))).toBe(false);
  });

  it("can be removed, and then gets nothing", async () => {
    const g = (await T("GET", `channels/${project}/guests`)).json.guests.find((x: { name: string }) => x.name === "Asha Verma");
    expect((await T("DELETE", `guests/${g.id}`)).status).toBe(200);
    expect((await Gx("GET", `c/${project}/messages`, undefined, asha)).status).toBe(403);
    expect((await Gx("GET", `c/${project}`, undefined, asha)).json.guest.status).toBe("removed");
    const after = (await T("GET", `channels/${project}/messages`)).json.messages.at(-1);
    expect(after.body).toBe("Meera Iyer removed Asha Verma (guest)");
    // Their old messages still show their name to members.
    expect((await T("GET", "meta")).json.guests.find((p: { id: string }) => p.id === ashaId).name).toBe("Asha Verma");
  });
});

describe("invite settings", () => {
  it("lets people straight in when approval is off, with history if allowed", async () => {
    const i = await invite(project, { approval: false, history: true });
    const r = await join(i.code, "Dev Patel", {}, "203.0.113.8");
    const st = (await Gx("GET", `c/${project}`, undefined, r.cookie)).json;
    expect(st.guest.status).toBe("approved");
    const bodies = (await Gx("GET", `c/${project}/messages?limit=100`, undefined, r.cookie)).json.messages.map((m: { body: string }) => m.body);
    expect(bodies.at(-1)).toBe("Dev Patel joined as a guest with an invite link");
    expect(bodies.join(" ")).toMatch(/Asha, can you send the PDF/);
  });

  it("stops at its use limit, when turned off, and when the conversation is archived", async () => {
    const one = await invite(project, { maxUses: 1 });
    expect((await join(one.code, "First Person", {}, "203.0.113.9")).status).toBe(200);
    const second = await join(one.code, "Second Person", {}, "203.0.113.10");
    expect(second.status).toBe(409);
    expect(second.json.error.message).toMatch(/used as many times/);
    const off = await invite(project);
    await T("PATCH", `invites/${off.id}`, { revoked: true });
    expect((await join(off.code, "Late Person", {}, "203.0.113.11")).json.error.message).toMatch(/turned off/);
    expect((await Gx("GET", `invite/${off.code}`)).json.invite.problem).toMatch(/turned off/);
    const arch = await invite(project);
    await T("PATCH", `channels/${project}`, { archived: true });
    expect((await join(arch.code, "Archive Person", {}, "203.0.113.12")).status).toBe(409);
    await T("PATCH", `channels/${project}`, { archived: false });
  });

  it("can be declined with a reason the person sees", async () => {
    const i = await invite(project);
    const r = await join(i.code, "Random Stranger", {}, "203.0.113.13");
    const g = (await T("GET", `channels/${project}/guests`)).json.guests.find((x: { name: string }) => x.name === "Random Stranger");
    await T("POST", `guests/${g.id}/decide`, { approve: false, reason: "We don't know you" });
    expect((await Gx("GET", `c/${project}`, undefined, r.cookie)).json.guest).toMatchObject({ status: "rejected", reason: "We don't know you" });
  });

  it("lets a waiting person withdraw, which clears their cookie", async () => {
    const i = await invite(project);
    const r = await join(i.code, "Changed Mind", {}, "203.0.113.14");
    const out = await Gx("DELETE", `c/${project}`, undefined, r.cookie);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await Gx("GET", `c/${project}`, undefined, r.cookie)).json.guest.status).toBe("left");
  });

  it("emails the invite from Cloudesk, one message each, and records it", async () => {
    const i = await invite(project);
    const r = await T("POST", `invites/${i.id}/email`, { to: ["a@client.in", "b@client.in", "a@client.in"], message: "Join us here" });
    expect(r.json.sent).toBe(2);
    const mails = await db.select().from(schema.outboundEmails);
    const ours = mails.filter((m) => m.to === "a@client.in" || m.to === "b@client.in");
    expect(ours).toHaveLength(2);
    expect(ours[0]!.subject).toBe("Meera Iyer invited you to chat in #client-project");
    expect(ours[0]!.body).toContain(`/j/${i.code}`);
    expect(ours[0]!.body).toContain("Join us here");
    expect((await T("GET", `channels/${project}/invites`)).json.invites.find((x: { id: string }) => x.id === i.id).sent).toHaveLength(2);
    expect((await T("POST", `invites/${i.id}/email`, { to: ["not-an-email"] })).status).toBe(422);
  });

  it("limits how often one address can ask to join", async () => {
    const i = await invite(project, { approval: true });
    let last = 200;
    for (let n = 0; n < 16; n++) last = (await join(i.code, `Spammer ${n}`, {}, "198.51.100.99")).status;
    expect(last).toBe(429);
  });
});
