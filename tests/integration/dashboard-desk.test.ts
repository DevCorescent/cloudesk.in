import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as chatApi from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as api from "@/app/api/v1/orgs/[orgId]/dashboard/[[...slug]]/route";
import { calendarsOf } from "@/server/calendar/access";
import { closeChatBus } from "@/server/chat/bus";
import { call, cookieFrom, resetDb } from "../helpers";

// Home's "Your desk": a tile per feature with at least one thing in it, each
// through that feature's own access rules.
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
type H = Parameters<typeof call>[0];
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const desk = async (who = "owner") => (await call((api as unknown as Record<string, H>).GET, { method: "GET", cookie: C[who], path: `/api/v1/orgs/${orgId}/dashboard/desk`, params: { orgId, slug: ["desk"] } })).json;
const CHAT = (method: string, path: string, body?: unknown, who = "owner") => call((chatApi as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/chat/${path}`, params: { orgId, slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["owner", "Meera Iyer", "meera.desk@saffron.in"], ["other", "Ravi Kumar", "ravi.desk@saffron.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId, userId: U.other!, role: "editor" });
});
afterAll(async () => {
  await closeChatBus();
  await closeDb();
});

describe("your desk on Home", () => {
  it("starts with nothing to show for mail, notes, the calculator and copilot", async () => {
    const d = await desk();
    expect(d.mail).toBeNull();
    expect(d.notes).toBeNull();
    expect(d.calculator).toBeNull();
    expect(d.copilot).toBeNull();
    expect(d.calendar).toBeNull();
  });

  it("shows each feature once it has something in it", async () => {
    const owner = U.owner!;
    // Mail: a mailbox with one unread conversation and one read.
    const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: owner, name: "Work", address: "meera.desk@saffron.in", provider: "custom", imapHost: "imap.saffron.in", imapPort: 993, smtpHost: "smtp.saffron.in", smtpPort: 465, username: "m", secretEnc: "x", status: "active" } as never).returning();
    await db.insert(schema.mailThreads).values([
      { orgId, accountId: acc!.id, subject: "Launch plan", normSubject: "launch plan", participants: [{ name: "Asha Verma", address: "asha@client.in" }], snippet: "Here's what we agreed", messageCount: 1, unread: 1, lastMessageAt: new Date() },
      { orgId, accountId: acc!.id, subject: "Old news", normSubject: "old news", participants: [{ name: "Dev", address: "dev@client.in" }], snippet: "Done", messageCount: 1, unread: 0, lastMessageAt: new Date(Date.now() - 86_400_000) },
    ] as never);
    // Calendar: a meeting tomorrow.
    const [cal] = await calendarsOf(orgId, owner);
    await db.insert(schema.calEvents).values({ orgId, ownerId: owner, calendarId: cal!.id, uid: "desk-1@test", title: "Design review", startsAt: new Date(Date.now() + 26 * 3_600_000), endsAt: new Date(Date.now() + 27 * 3_600_000), meetingUrl: "https://meet.google.com/abc-defg-hij" } as never);
    // Chat: Ravi mentions Meera in #general.
    const general = (await CHAT("GET", "meta")).json.channels.find((c: { name: string }) => c.name === "general").id;
    await CHAT("GET", "meta", undefined, "other");
    expect((await CHAT("POST", `channels/${general}/messages`, { body: `@[Meera Iyer](u:${owner}) can you look?` }, "other")).status).toBe(200);
    // Notes, the calculator and copilot.
    await db.insert(schema.notes).values({ orgId, ownerId: owner, title: "Launch checklist", text: "Book the venue", pinned: true } as never);
    await db.insert(schema.calcHistory).values({ orgId, userId: owner, kind: "expr", input: "1200*18%", result: "216" } as never);
    await db.insert(schema.copilotThreads).values({ orgId, userId: owner, title: "Who owes us most?", messages: [] } as never);

    const d = await desk();
    expect(d.mail.unread).toBe(1);
    expect(d.mail.threads.map((t: { subject: string; unread: boolean }) => [t.subject, t.unread])).toEqual([["Launch plan", true], ["Old news", false]]);
    expect(d.mail.threads[0].from).toBe("Asha Verma");
    expect(d.calendar.events[0]).toMatchObject({ title: "Design review", meetingUrl: "https://meet.google.com/abc-defg-hij" });
    expect(d.chat.mentions).toBe(1);
    expect(d.chat.channels[0]).toMatchObject({ name: "general", mentions: 1 });
    expect(d.notes.items[0]).toMatchObject({ title: "Launch checklist", pinned: true });
    expect(d.notes.pinned).toBe(1);
    expect(d.calculator.entries[0]).toMatchObject({ input: "1200*18%", result: "216" });
    expect(d.copilot.threads[0].title).toBe("Who owes us most?");
  });

  it("keeps someone else's mail, notes, calculator and copilot private", async () => {
    const d = await desk("other");
    expect(d.mail).toBeNull();
    expect(d.notes).toBeNull();
    expect(d.calculator).toBeNull();
    expect(d.copilot).toBeNull();
    expect(d.calendar).toBeNull();
  });

  it("leaves out features the workspace has switched off", async () => {
    const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
    await db.update(schema.organizations).set({ modules: ["calendar"] } as never).where(eq(schema.organizations.id, orgId));
    const d = await desk();
    expect(d.mail).toBeNull();
    expect(d.chat).toBeNull();
    expect(d.calendar).not.toBeNull();
    expect(d.notes).not.toBeNull();
    await db.update(schema.organizations).set({ modules: org!.modules } as never).where(eq(schema.organizations.id, orgId));
  });
});
