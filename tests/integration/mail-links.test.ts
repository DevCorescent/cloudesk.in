import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as mailApi from "@/app/api/v1/orgs/[orgId]/mail/[[...slug]]/route";
import * as notesApi from "@/app/api/v1/orgs/[orgId]/notes/[[...slug]]/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as workApi from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import { closeChatBus } from "@/server/chat/bus";
import { drain } from "@/server/jobs/queue";
import { syncAccount } from "@/server/mail/sync";
import { setMailTransport, type MailTransport } from "@/server/mail/transport";
import { call, cookieFrom, resetDb } from "../helpers";

// An email into notes, the calendar, tasks and chat — against a pretend mail
// server (nothing here talks to a real provider).
type Box = { uidValidity: number; next: number; msgs: { uid: number; flags: string[]; source: Buffer }[] };
const server = {
  password: "app-pass-1234",
  boxes: {} as Record<string, Box>,
  sent: [] as { to: string[]; raw: string }[],
  reset() {
    this.boxes = Object.fromEntries(["INBOX", "Sent", "Archive", "Trash", "Junk"].map((k) => [k, { uidValidity: 7, next: 1, msgs: [] }]));
    this.sent = [];
  },
  async deliver(opts: ConstructorParameters<typeof MailComposer>[0]) {
    const b = this.boxes.INBOX!;
    b.msgs.push({ uid: b.next++, flags: [], source: await new MailComposer(opts).compile().build() });
  },
};
const fake: MailTransport = {
  async imap() {
    return {
      async folders() {
        return [{ path: "INBOX", name: "INBOX" }, { path: "Sent", name: "Sent", specialUse: "\\Sent" }, { path: "Archive", name: "Archive", specialUse: "\\Archive" }, { path: "Trash", name: "Trash", specialUse: "\\Trash" }, { path: "Junk", name: "Junk", specialUse: "\\Junk" }];
      },
      async fetchNew(path, { lastUid, limit }) {
        const b = server.boxes[path]!;
        return { uidValidity: b.uidValidity, messages: b.msgs.filter((m) => m.uid > lastUid).slice(-limit) };
      },
      async setFlags() {},
      async move() {},
      async append(path, raw) {
        const b = server.boxes[path]!;
        b.msgs.push({ uid: b.next++, flags: ["\\Seen"], source: raw });
      },
      async close() {},
    };
  },
  async verifySmtp() {},
  async send(_c, envelope, raw) {
    server.sent.push({ to: envelope.to, raw: raw.toString() });
  },
};

const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
let accountId = "";
let threadId = "";
type H = Parameters<typeof call>[0];
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const api = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const MAIL = api(mailApi, "mail");
const NOTES = api(notesApi, "notes");
const CHAT = api(chatApi, "chat");
const WORK = api(workApi, "work");
const conns = async (who = "owner") => (await MAIL("GET", `threads/${threadId}/connections`, undefined, who)).json.items as { id: string | null; kind: string; title: string; href: string }[];

beforeAll(async () => {
  await resetDb();
  server.reset();
  setMailTransport(fake);
  for (const [k, name, email] of [["owner", "Meera Iyer", "meera@saffron.in"], ["other", "Ravi Kumar", "ravi@saffron.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId, userId: U.other!, role: "editor" });
  const r = await MAIL("POST", "accounts", { provider: "custom", address: "meera@saffron.in", displayName: "Meera Iyer", password: server.password, imapHost: "mail.saffron.in", imapPort: 993, imapSecure: true, smtpHost: "mail.saffron.in", smtpPort: 465, smtpSecure: true, name: "Saffron" });
  accountId = r.json.account.id;
  await MAIL("PATCH", `accounts/${accountId}`, { sendDelaySec: 0, autoAddMeetings: false });
  await server.deliver({
    from: "Asha Verma <asha@client.in>", to: "meera@saffron.in", subject: "Launch plan for Diwali",
    text: "Hi Meera,\n\nHere's what we agreed:\n- Final designs by Friday\n- Ads go live on the 5th\n\nCan we meet Thursday at 4pm to sign off?\n\nThanks,\nAsha\n-- \nAsha Verma | Studio Verma\n\nOn Mon, 26 Oct 2026 at 10:02, Meera Iyer <meera@saffron.in> wrote:\n> Sharing the brief.\n> Old quoted line",
    attachments: [{ filename: "plan.pdf", content: Buffer.from("%PDF-1.4 plan"), contentType: "application/pdf" }],
  });
  await syncAccount(accountId);
  threadId = (await db.select().from(schema.mailThreads).where(eq(schema.mailThreads.subject, "Launch plan for Diwali")))[0]!.id;
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("an email into the rest of Cloudesk", () => {
  let noteId = "";
  it("says what it can be turned into", async () => {
    const t = (await MAIL("GET", "link-targets")).json;
    expect(t.calendars.length).toBeGreaterThan(0);
    expect(t.chat).toBe(true);
    expect(t.ai).toBe(false);
  });

  it("becomes a note: what was written, not the quoted history or the signature, with its attachment and a card back", async () => {
    const r = await MAIL("POST", `threads/${threadId}/note`, { comment: "For the Diwali launch", tags: ["launch"] });
    expect(r.status).toBe(200);
    noteId = r.json.note.id;
    const n = (await NOTES("GET", noteId)).json.note;
    expect(n.title).toBe("Launch plan for Diwali");
    expect(n.attached).toEqual({ module: "mail", href: `/mail/t/${threadId}`, label: "Launch plan for Diwali" });
    expect(n.tags).toEqual(["launch"]);
    const blocks = n.content.blocks as { type: string; text: string; url?: string }[];
    expect(blocks[0]).toMatchObject({ type: "p", text: "For the Diwali launch" });
    expect(blocks[1]).toMatchObject({ type: "record", text: "Launch plan for Diwali", url: `/mail/t/${threadId}` });
    expect(blocks.filter((b) => b.type === "bullet").map((b) => b.text)).toEqual(expect.arrayContaining(["Final designs by Friday", "Ads go live on the 5th"]));
    const all = blocks.map((b) => b.text).join("\n");
    expect(all).not.toMatch(/Old quoted line|Studio Verma|wrote:/);
    expect(blocks.some((b) => b.type === "bullet" && /^\[plan\.pdf\]\(\/api\/v1\/orgs\/.+\/mail\/attachments\/[0-9a-f-]+\)$/.test(b.text))).toBe(true);
    expect(await conns()).toEqual([expect.objectContaining({ kind: "note", title: "Launch plan for Diwali", href: `/notes/${noteId}` })]);
  });

  it("adds to a note you already have, and an AI summary needs AI", async () => {
    const before = ((await NOTES("GET", noteId)).json.note.content.blocks as unknown[]).length;
    const r = await MAIL("POST", `threads/${threadId}/note`, { mode: "append", noteId, what: "latest", attachments: false });
    expect(r.status).toBe(200);
    const after = (await NOTES("GET", noteId)).json.note.content.blocks as { type: string }[];
    expect(after.length).toBeGreaterThan(before + 2);
    expect(after[before]!.type).toBe("divider");
    expect((await conns()).filter((c) => c.kind === "note")).toHaveLength(1);
    expect((await MAIL("POST", `threads/${threadId}/note`, { mode: "append" })).status).toBe(422);
    const ai = await MAIL("POST", `threads/${threadId}/note`, { what: "summary" });
    expect(ai.status).toBeGreaterThanOrEqual(400);
  });

  let eventId = "";
  it("becomes a meeting with its people (invite emailed), or time to deal with it", async () => {
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCHours(10, 30, 0, 0);
    const r = await MAIL("POST", `threads/${threadId}/event`, { kind: "meeting", title: "Diwali launch sign-off", start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), attendees: [{ name: "Asha Verma", email: "asha@client.in" }], meetingUrl: "https://meet.google.com/abc-defg-hij", invite: true });
    expect(r.status).toBe(200);
    eventId = r.json.event.id;
    const [e] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.id, eventId));
    expect(e).toMatchObject({ mailThreadId: threadId, mailAccountId: accountId, meetingUrl: "https://meet.google.com/abc-defg-hij" });
    expect(e!.description).toContain("From the email “Launch plan for Diwali” — Asha Verma.");
    await drain();
    expect(server.sent.some((x) => x.to.includes("asha@client.in") && /METHOD:REQUEST/.test(x.raw))).toBe(true);
    const focus = await MAIL("POST", `threads/${threadId}/event`, { kind: "focus", title: "Reply to Asha", start: start.toISOString(), end: new Date(start.getTime() + 1_800_000).toISOString(), attendees: [{ name: "Asha", email: "asha@client.in" }] });
    const [f] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.id, focus.json.event.id));
    expect(f!.attendees).toEqual([]);
    expect(f!.description).toMatch(/^Time set aside to deal with this email\./);
    expect((await conns()).filter((c) => c.kind === "event")).toHaveLength(2);
    expect((await MAIL("POST", `threads/${threadId}/event`, { title: "Bad", start: start.toISOString(), end: start.toISOString() })).status).toBe(422);
  });

  it("becomes a task in a project, with the email in it", async () => {
    const p = (await WORK("POST", "projects", { name: "Diwali launch", code: "DWL" })).json.project;
    expect((await MAIL("GET", "link-targets")).json.projects.map((x: { id: string }) => x.id)).toContain(p.id);
    const r = await MAIL("POST", `threads/${threadId}/task`, { projectId: p.id, title: "Send final designs", dueDate: "2026-11-06", priority: "high" });
    expect(r.status).toBe(200);
    const [t] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.id, r.json.task.id));
    expect(t!.description).toContain(`Open it: /mail/t/${threadId}`);
    expect(t!.description).toContain("> Hi Meera,");
    expect((await conns()).find((c) => c.kind === "task")?.title).toBe(`#${r.json.task.number} Send final designs`);
  });

  it("records where it was shared in chat — only your own message", async () => {
    const meta = (await CHAT("GET", "meta")).json;
    const general = meta.channels.find((c: { name: string }) => c.name === "general").id;
    const posted = (await CHAT("POST", `channels/${general}/messages`, { body: "Can someone take this?", record: { kind: "mail", id: threadId, title: "Launch plan for Diwali", sub: "Asha Verma", link: `/mail/t/${threadId}`, module: "Mail", fields: [] } })).json.message;
    expect((await MAIL("POST", `threads/${threadId}/chat`, { messageId: posted.id, channelId: general, where: "#general" })).status).toBe(200);
    expect((await conns()).find((c) => c.kind === "chat")).toMatchObject({ title: "Shared in #general", href: `/chat/${general}?m=${posted.id}` });
    const theirs = (await CHAT("POST", `channels/${general}/messages`, { body: "mine" }, "other")).json.message;
    expect((await MAIL("POST", `threads/${threadId}/chat`, { messageId: theirs.id, channelId: general }, "owner")).status).toBe(404);
  });

  it("shows notes attached from the page too, drops what's gone, and unlinks on request; others see nothing", async () => {
    const pageNote = (await NOTES("POST", "", { title: "Call notes", attached: { module: "mail", href: `/mail/t/${threadId}`, label: "Launch plan" } })).json.note;
    expect((await conns()).find((c) => c.title === "Call notes")).toMatchObject({ id: null, kind: "note" });
    await NOTES("DELETE", noteId);
    const now = await conns();
    expect(now.some((c) => c.href === `/notes/${noteId}`)).toBe(false);
    expect((await db.select().from(schema.mailLinks).where(eq(schema.mailLinks.targetId, noteId)))).toHaveLength(0);
    const task = now.find((c) => c.kind === "task")!;
    expect((await MAIL("DELETE", `threads/${threadId}/links/${task.id}`)).status).toBe(200);
    expect((await conns()).some((c) => c.kind === "task")).toBe(false);
    expect((await MAIL("GET", `threads/${threadId}/connections`, undefined, "other")).status).toBe(404);
    void pageNote;
    void simpleParser;
  });
});
