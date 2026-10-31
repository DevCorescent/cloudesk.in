import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as workApi from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { closeChatBus } from "@/server/chat/bus";
import { chatTick } from "@/server/chat/tick";
import { call, cookieFrom, resetDb } from "../helpers";

// Team chat between three people in one workspace (and one outsider in another).
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
let general = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const T = (method: string, path: string, body?: unknown, who = "meera") => call((chatApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/chat/${path}`, params: { orgId, slug: seg(path) } });
const W = (method: string, path: string, body?: unknown) => call((workApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C.meera, body, path: `/api/v1/orgs/${orgId}/work/${path}`, params: { orgId, slug: seg(path) } });
const notes = async (who: string, kind?: string) => db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U[who]!), ...(kind ? [eq(schema.notifications.kind, kind)] : [])));
const meta = async (who = "meera") => (await T("GET", "meta", undefined, who)).json;
const chan = async (name: string, who = "meera") => (await meta(who)).channels.find((c: { name: string }) => c.name === name);
const say = async (ch: string, body: unknown, who = "meera") => T("POST", `channels/${ch}/messages`, typeof body === "string" ? { body } : body, who);
const ai = (json: unknown) =>
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } }) }) } } }) as never);

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["meera", "Meera Iyer", "meera@saffron.in"], ["ravi", "Ravi Kumar", "ravi@saffron.in"], ["anika", "Anika Bose", "anika@saffron.in"], ["out", "Outsider", "x@elsewhere.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.meera })).json.organizations[0].id;
  await db.insert(schema.memberships).values([{ orgId, userId: U.ravi!, role: "editor" }, { orgId, userId: U.anika!, role: "viewer" }]);
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("channels and people", () => {
  it("starts with #general and #announcements for everyone; outsiders see nothing", async () => {
    const m = await meta();
    expect(m.channels.map((c: { name: string }) => c.name).sort()).toEqual(["announcements", "general"]);
    general = m.channels.find((c: { name: string }) => c.name === "general").id;
    expect(m.people.map((p: { name: string }) => p.name)).toEqual(["Anika Bose", "Meera Iyer", "Ravi Kumar"]);
    // People who join later are added to the everyone-channels on their first visit.
    expect((await chan("general", "ravi")).member).toBe(true);
    expect((await T("GET", `channels/${general}/messages`, undefined, "out")).status).toBe(404);
  });

  it("makes public and private channels; private ones stay invisible to others", async () => {
    expect((await T("POST", "channels", { name: "Sales Team", topic: "Deals and pipeline", members: [U.ravi] })).status).toBe(200);
    expect((await T("POST", "channels", { name: "sales-team" })).json.error.message).toMatch(/already/);
    await T("POST", "channels", { name: "leadership", visibility: "private" });
    const sales = await chan("sales-team", "anika");
    expect(sales).toMatchObject({ member: false, visibility: "public" });
    expect(await chan("leadership", "anika")).toBeUndefined();
    const lead = await chan("leadership");
    expect((await T("GET", `channels/${lead.id}/messages`, undefined, "anika")).status).toBe(404);
    // Anyone can join a public channel.
    expect((await T("POST", `channels/${sales.id}/join`, undefined, "anika")).status).toBe(200);
    expect((await chan("sales-team", "anika")).member).toBe(true);
  });

  it("opens one DM per pair, and group chats", async () => {
    const a = (await T("POST", `dm/${U.ravi}`)).json.channel.id;
    const b = (await T("POST", `dm/${U.meera}`, undefined, "ravi")).json.channel.id;
    expect(a).toBe(b);
    expect((await T("POST", `dm/${U.out}`)).status).toBe(404);
    const g = (await T("POST", "groups", { users: [U.ravi, U.anika], name: "Launch crew" })).json.channel.id;
    expect((await meta("anika")).channels.find((c: { id: string }) => c.id === g)).toMatchObject({ kind: "group", name: "Launch crew" });
  });

  it("only admins post in #announcements", async () => {
    const ann = await chan("announcements");
    expect((await say(ann.id, "Office closed Friday", "ravi")).status).toBe(403);
    expect((await say(ann.id, "Office closed Friday")).status).toBe(200);
  });
});

describe("messages", () => {
  it("posts, mentions people and records, tags topics, and counts unread", async () => {
    const r = await say(general, { body: `Hi @[Ravi Kumar](u:${U.ravi}), can you check #[INV/0042](r:invoices/abc-1) today? #pricing`, records: [{ kind: "invoices", id: "abc-1", label: "INV/0042", link: "/finance/x/invoices/abc-1" }, { kind: "evil", id: "x", label: "x", link: "https://evil.example" }] });
    expect(r.status).toBe(200);
    const m = r.json.message;
    expect(m.mentions).toEqual({ users: [U.ravi], everyone: false, records: [{ kind: "invoices", id: "abc-1", label: "INV/0042", link: "/finance/x/invoices/abc-1" }] });
    expect(m.tags).toEqual(["pricing"]);
    const g = await chan("general", "ravi");
    expect(g.unread).toBeGreaterThanOrEqual(1);
    expect(g.mentions).toBe(1);
    expect((await notes("ravi", "chat.mention")).at(-1)).toMatchObject({ title: "Meera Iyer mentioned you in #general" });
    await T("POST", `channels/${general}/read`, {}, "ravi");
    expect((await chan("general", "ravi")).unread).toBe(0);
  });

  it("threads replies, tells the people in the thread, and can mark unread", async () => {
    const root = (await say(general, "Who's handling the Taj order?")).json.message;
    const rep = (await say(general, { body: "I am", parentId: root.id }, "ravi")).json.message;
    expect(rep.parentId).toBe(root.id);
    const page = (await T("GET", `channels/${general}/messages`)).json.messages;
    expect(page.find((x: { id: string }) => x.id === root.id)).toMatchObject({ replyCount: 1, replyPeople: [U.ravi] });
    expect(page.some((x: { id: string }) => x.id === rep.id)).toBe(false);
    const thread = (await T("GET", `channels/${general}/messages?thread=${root.id}`)).json.messages;
    expect(thread.map((x: { id: string }) => x.id)).toEqual([root.id, rep.id]);
    expect((await notes("meera", "chat.reply")).at(-1)).toMatchObject({ title: "Ravi Kumar replied in #general" });
    // Mark unread from someone else's message (your own never count as unread).
    const theirs = (await say(general, "On it", "ravi")).json.message;
    await T("POST", `channels/${general}/read`, {});
    expect((await chan("general")).unread).toBe(0);
    await T("POST", `channels/${general}/read`, { unreadFrom: theirs.seq });
    expect((await chan("general")).unread).toBe(1);
  });

  it("edits, reacts, pins, saves with a reminder, forwards and deletes", async () => {
    const m = (await say(general, "Price list v1 attached")).json.message;
    expect((await T("PATCH", `messages/${m.id}`, { body: "Price list v2 attached" }, "ravi")).status).toBe(403);
    expect((await T("PATCH", `messages/${m.id}`, { body: "Price list v2 attached" })).json.message).toMatchObject({ body: "Price list v2 attached", editedAt: expect.any(String) });
    await T("POST", `messages/${m.id}/react`, { emoji: "👍" }, "ravi");
    await T("POST", `messages/${m.id}/react`, { emoji: "👍" }, "anika");
    await T("POST", `messages/${m.id}/pin`, {}, "ravi");
    const pinned = (await T("GET", `channels/${general}/pinned`)).json.messages;
    expect(pinned[0]).toMatchObject({ id: m.id, reactions: [{ emoji: "👍", users: [U.ravi, U.anika] }] });
    const soon = new Date(Date.now() + 60_000).toISOString();
    await T("POST", `messages/${m.id}/save`, { remindAt: soon }, "anika");
    expect((await T("GET", "saved", undefined, "anika")).json.saved[0]).toMatchObject({ message: { id: m.id, saved: true } });
    await chatTick(new Date(Date.now() + 2 * 60_000));
    expect((await notes("anika", "chat.reminder")).length).toBe(1);
    const sales = await chan("sales-team");
    const f = (await T("POST", `messages/${m.id}/forward`, { to: sales.id, comment: "FYI" })).json.message;
    const fw = (await T("GET", `messages/${f.id}`)).json.message;
    expect(fw).toMatchObject({ body: "FYI\n\n> Price list v2 attached", forwardedFrom: { channel: "#general" } });
    expect((await T("DELETE", `messages/${m.id}`, undefined, "anika")).status).toBe(403);
    expect((await T("DELETE", `messages/${m.id}`)).status).toBe(200);
    expect((await T("GET", `messages/${m.id}`)).json.message).toMatchObject({ deleted: true, body: "", kind: "deleted" });
  });

  it("schedules a message for later; only its author sees it until it posts", async () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const m = (await say(general, { body: "Standup in 5", scheduledFor: at })).json.message;
    expect(m.scheduledFor).toBe(at);
    expect((await T("GET", `messages/${m.id}`, undefined, "ravi")).status).toBe(404);
    expect((await chatTick(new Date(Date.now() + 6 * 60_000))).posted).toBe(1);
    const posted = (await T("GET", `messages/${m.id}`, undefined, "ravi")).json.message;
    expect(posted.scheduledFor).toBeNull();
  });

  it("urgent messages get through Do not disturb and nudge until read", async () => {
    await T("POST", "presence", { status: "dnd", note: "Focus time" }, "anika");
    const before = (await notes("anika")).length;
    await say(general, "Server is down?");
    expect((await notes("anika")).length).toBe(before);
    const u = (await say(general, { body: "Customer site is down — need eyes now", priority: "urgent" })).json.message;
    expect((await notes("anika", "chat.urgent")).length).toBe(1);
    const [row] = await db.select({ at: schema.teamMessages.createdAt }).from(schema.teamMessages).where(eq(schema.teamMessages.id, u.id));
    const r = await chatTick(new Date(row!.at.getTime() + 2 * 60_000 + 10_000));
    expect(r.nudged).toBeGreaterThanOrEqual(2);
    expect((await meta()).people.find((p: { id: string }) => p.id === U.anika)).toMatchObject({ status: "dnd", note: "Focus time" });
  });

  it("finds messages with filters", async () => {
    await say(general, "The Oberoi quote is ready #quotes", "ravi");
    const hit = (await T("GET", `search?q=${encodeURIComponent("oberoi from:ravi")}`)).json.messages;
    expect(hit).toHaveLength(1);
    expect((await T("GET", `search?q=${encodeURIComponent("tag:quotes in:general")}`)).json.messages).toHaveLength(1);
    expect((await T("GET", `search?q=${encodeURIComponent("oberoi from:anika")}`)).json.messages).toHaveLength(0);
    // Nothing from a private channel you're not in.
    const lead = await chan("leadership");
    await say(lead.id, "Confidential Oberoi pricing");
    expect((await T("GET", `search?q=confidential`, undefined, "ravi")).json.messages).toHaveLength(0);
  });

  it("shows mentions, replies and DMs in Activity", async () => {
    const dm = (await T("POST", `dm/${U.ravi}`)).json.channel.id;
    await say(dm, "Got a minute?");
    const items = (await T("GET", "activity", undefined, "ravi")).json.items;
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(expect.arrayContaining(["dm", "mention"]));
    expect((await notes("ravi", "chat.dm")).at(-1)).toMatchObject({ title: "Meera Iyer" });
  });
});

describe("interactive messages", () => {
  it("runs a poll (single choice, then closed)", async () => {
    const p = (await say(general, { poll: { question: "Team lunch?", options: [{ id: "a", label: "Thali" }, { id: "b", label: "Pizza" }] } })).json.message;
    await T("POST", `messages/${p.id}/vote`, { choice: "a" }, "ravi");
    await T("POST", `messages/${p.id}/vote`, { choice: "b" }, "ravi");
    const v = (await T("POST", `messages/${p.id}/vote`, { choice: "b" }, "anika")).json.message.votes;
    expect(v.map((x: { choice: string; userId: string }) => `${x.choice}:${x.userId}`).sort()).toEqual([`b:${U.anika}`, `b:${U.ravi}`].sort());
    expect((await T("POST", `messages/${p.id}/settle`, { state: "closed" }, "ravi")).status).toBe(403);
    await T("POST", `messages/${p.id}/settle`, { state: "closed" });
    expect((await T("POST", `messages/${p.id}/vote`, { choice: "a" }, "anika")).status).toBe(409);
  });

  it("keeps a shared checklist", async () => {
    const c = (await say(general, { checklist: { title: "Launch", items: [{ id: "1", label: "Photos" }, { id: "2", label: "Prices" }] } })).json.message;
    await T("POST", `messages/${c.id}/vote`, { choice: "1" }, "ravi");
    const done = (await T("POST", `messages/${c.id}/vote`, { choice: "1" }, "anika")).json.message.votes;
    expect(done).toEqual([expect.objectContaining({ choice: "1", userId: U.ravi })]);
  });

  it("proposes and settles a decision", async () => {
    const d = (await say(general, { decision: { text: "Move to net-30 terms for hotels" } })).json.message;
    await T("POST", `messages/${d.id}/vote`, { choice: "agree" }, "ravi");
    await T("POST", `messages/${d.id}/vote`, { choice: "object", note: "Cash flow" }, "anika");
    await T("POST", `messages/${d.id}/settle`, { state: "agreed" });
    const list = (await T("GET", `channels/${general}/decisions`)).json.messages;
    expect(list.find((x: { id: string }) => x.id === d.id)).toMatchObject({ data: { state: "agreed" }, votes: expect.arrayContaining([expect.objectContaining({ choice: "object", note: "Cash flow" })]) });
  });

  it("asks for an approval; only the approver decides, and the asker hears back", async () => {
    const a = (await say(general, { approval: { title: "Discount 12% for Taj", approvers: [U.ravi], amount: "₹42,000" } })).json.message;
    expect((await notes("ravi", "chat.approval")).at(-1)).toMatchObject({ title: "Meera Iyer asks you to approve: Discount 12% for Taj" });
    expect((await T("POST", `messages/${a.id}/vote`, { choice: "approve" }, "anika")).status).toBe(403);
    expect((await T("POST", `messages/${a.id}/vote`, { choice: "reject" }, "ravi")).status).toBe(422);
    const r = (await T("POST", `messages/${a.id}/vote`, { choice: "approve", note: "OK this once" }, "ravi")).json.message;
    expect(r.data).toMatchObject({ state: "approved", decidedBy: U.ravi });
    expect((await notes("meera", "chat.approval")).at(-1)).toMatchObject({ title: "Ravi Kumar approved: Discount 12% for Taj" });
  });

  it("shares a record card (links stay inside the app) and starts a call", async () => {
    const r = (await say(general, { record: { kind: "invoices", id: "i1", title: "INV/0042 · Taj Hotels", sub: "₹53,100 · due 30 Oct", link: "//evil.example/x", fields: [{ label: "Status", value: "Sent" }] } })).json.message;
    expect(r.data).toMatchObject({ title: "INV/0042 · Taj Hotels", link: "" });
    const call2 = (await say(general, { call: { title: "Quick sync" } })).json.message;
    expect(call2.data.url).toMatch(/^https:\/\/meet\.jit\.si\/Cloudesk-[0-9a-f]{32}$/);
  });
});

describe("files, export and import", () => {
  it("uploads a file, attaches it, and keeps it to the conversation's members", async () => {
    const lead = await chan("leadership");
    const up = await call(chatApi.POST, { method: "POST", cookie: C.meera, path: `/api/v1/orgs/${orgId}/chat/channels/${lead.id}/files?name=plan.txt`, params: { orgId, slug: ["channels", lead.id, "files"] }, body: "Q4 plan", headers: { "content-type": "text/plain" } });
    expect(up.json.file).toMatchObject({ filename: "plan.txt", size: expect.any(Number) });
    const m = (await say(lead.id, { body: "", files: [up.json.file.id] })).json.message;
    expect(m.files[0].filename).toBe("plan.txt");
    expect((await T("GET", `files/${up.json.file.id}`)).status).toBe(200);
    expect((await T("GET", `files/${up.json.file.id}`, undefined, "ravi")).status).toBe(404);
  });

  it("exports a channel as CSV and imports channels from a sheet", async () => {
    const r = await T("GET", `channels/${general}/export`);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.text).toContain("Who's handling the Taj order?");
    const imp = (await T("POST", "channels/import", { rows: [{ name: "Design", topic: "Briefs", members: "ravi@saffron.in, anika@saffron.in" }, { name: "Ops", visibility: "private" }], mode: "update" })).json;
    expect(imp).toMatchObject({ created: 2 });
    expect((await chan("design", "anika")).member).toBe(true);
    expect((await T("POST", "channels/import", { rows: [{ name: "x" }] }, "ravi")).status).toBe(403);
  });
});

describe("AI and tasks", () => {
  it("catches you up and answers questions (with the model stubbed)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    ai({ summary: "Ravi is handling the Taj order.", decisions: ["Net-30 for hotels"], actions: [{ text: "Send Oberoi quote", owner: "Ravi Kumar", due: "" }], questions: [], mood: "" });
    const c = (await T("POST", `channels/${general}/ai/catch-up`, { scope: "all" })).json;
    expect(c).toMatchObject({ summary: "Ravi is handling the Taj order.", actions: [{ text: "Send Oberoi quote", owner: "Ravi Kumar" }], count: expect.any(Number) });
    ai({ answer: "Ravi is.", sources: [1, 999], found: true });
    const a = (await T("POST", `channels/${general}/ai/ask`, { question: "Who handles Taj?" })).json;
    expect(a.sources).toEqual([{ id: expect.any(String), n: 1 }]);
    ai({ text: "Could you please review this today?" });
    expect((await T("POST", "ai/rewrite", { text: "review this today pls", how: "polish" })).json.text).toBe("Could you please review this today?");
  });

  it("says plainly when AI isn't set up", async () => {
    expect((await T("POST", `channels/${general}/ai/catch-up`, { scope: "all" })).status).toBe(424);
    // Nothing unread: no AI needed to say so.
    await T("POST", `channels/${general}/read`, {});
    expect((await T("POST", `channels/${general}/ai/catch-up`, {})).json).toMatchObject({ count: 0, summary: "You're all caught up — nothing new here." });
  });

  it("turns a message into tasks in a project, and says so in the thread", async () => {
    const p = (await W("POST", "projects", { name: "Taj rollout", code: "TAJ" })).json;
    const projectId = p.project?.id ?? p.id;
    const m = (await say(general, "Need the Oberoi quote by Friday")).json.message;
    const targets = (await T("GET", "tasks/targets")).json;
    expect(targets.projects.map((x: { id: string }) => x.id)).toContain(projectId);
    const r = (await T("POST", "tasks", { projectId, messageId: m.id, items: [{ title: "Send Oberoi quote", assigneeId: U.ravi }] })).json;
    expect(r.tasks).toHaveLength(1);
    const thread = (await T("GET", `channels/${general}/messages?thread=${m.id}`)).json.messages;
    expect(thread.at(-1)).toMatchObject({ kind: "system", body: expect.stringMatching(/^Made a task: \[Send Oberoi quote\]\(\/work\/tasks\//) });
    expect((await notes("ravi", "work.task_assigned")).length).toBe(1);
  });
});
