import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as mailApi from "@/app/api/v1/orgs/[orgId]/mail/[[...slug]]/route";
import { dayOf } from "@/lib/mail/schedule";
import { drain } from "@/server/jobs/queue";
import { mailScheduleTick } from "@/server/mail/schedules";
import { syncAccount } from "@/server/mail/sync";
import { setMailTransport, type MailTransport } from "@/server/mail/transport";
import { call, cookieFrom, resetDb } from "../helpers";

// Recurring emails against a pretend mail server (nothing here talks to a
// real provider): sends on schedule, once each, meetings into the calendar.
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
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const MAIL = (method: string, path: string, body?: unknown, who = "owner") => call((mailApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/mail/${path}`, params: { orgId, slug: seg(path) } });
const H = 3_600_000;
const TZ = "Asia/Kolkata";
const tomorrow = () => dayOf(Date.now() + 24 * H, TZ);
const parsed = async (i: number) => simpleParser(server.sent[i]!.raw);
const base = (over: Record<string, unknown> = {}) => ({ accountId, to: ["team@client.in"], subject: "Daily update", body: "Hello", startDate: tomorrow(), times: ["09:00"], tz: TZ, repeat: { freq: "daily", interval: 1, byDay: [], until: null, count: null }, ...over });
const runs = async (id: string) => (await MAIL("GET", `schedules/${id}`)).json.runs as { status: string; note: string; n: number | null; manual: boolean }[];
const tickAt = async (iso: string, extra = 60_000) => {
  const n = await mailScheduleTick(Date.parse(iso) + extra);
  await drain();
  return n;
};

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
});
afterAll(async () => {
  await closeDb();
});

describe("recurring emails", () => {
  it("checks what it's given", async () => {
    expect((await MAIL("POST", "schedules", base({ to: [] }))).status).toBe(422);
    expect((await MAIL("POST", "schedules", base({ times: ["9am"] }))).status).toBe(422);
    expect((await MAIL("POST", "schedules", base({ times: ["09:00", "09:00"] }))).status).toBe(422);
    expect((await MAIL("POST", "schedules", base({ repeat: { freq: "daily", interval: 1, byDay: [], until: dayOf(Date.now() - 3 * 24 * H, TZ), count: null } }))).status).toBe(422);
  });

  let daily = "";
  let first = "";
  it("sends at several times a day, each once, filling in the date and its number; a meeting link puts it in the calendar", async () => {
    const r = await MAIL("POST", "schedules", base({ name: "Standup", times: ["17:30", "09:00"], limit: 3, body: "Standup for {{day}}, {{date}} — #{{n}}. Join https://meet.google.com/abc-defg-hij" }));
    expect(r.status).toBe(200);
    const s = r.json.schedule;
    daily = s.id;
    expect(s.times).toEqual(["09:00", "17:30"]);
    expect(s.describe).toBe("Every day at 9:00 am and 5:30 pm · 3 emails in all");
    expect(s.upcoming).toHaveLength(3);
    expect(dayOf(Date.parse(s.upcoming[0]), TZ)).toBe(tomorrow());
    expect(new Date(s.upcoming[0]).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })).toBe("09:00");
    // The link in the email makes it a meeting, kept as one repeating event that ends with the 3rd email's day.
    expect(s.meeting).toMatchObject({ link: "https://meet.google.com/abc-defg-hij", addToCalendar: true, at: "09:00" });
    const [e] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.id, s.eventId));
    expect(e).toMatchObject({ meetingUrl: "https://meet.google.com/abc-defg-hij", meetingProvider: "meet", ownerId: U.owner, tz: TZ });
    expect((e!.repeat as { freq: string; until: string }).until).toBe(dayOf(Date.parse(s.upcoming[2]), TZ));
    first = s.upcoming[0];

    // Due: sent once, even if two workers look at the same moment.
    const [a, b] = await Promise.all([mailScheduleTick(Date.parse(first) + 60_000), mailScheduleTick(Date.parse(first) + 60_000)]);
    await drain();
    expect(a + b).toBe(1);
    expect(server.sent).toHaveLength(1);
    const m = await parsed(0);
    expect(m.subject).toBe("Daily update");
    expect(m.text).toContain("— #1.");
    expect(m.text).toContain(new Date(first).toLocaleString("en-IN", { weekday: "long", timeZone: TZ }));
    expect((await MAIL("GET", `schedules/${daily}`)).json.schedule).toMatchObject({ sentCount: 1, status: "active" });
    expect((await MAIL("GET", `schedules/${daily}`)).json.schedule.nextRunAt).toBe(s.upcoming[1]);
  });

  it("skips the next one, sends one now on request, and finishes at its limit", async () => {
    const skip = await MAIL("POST", `schedules/${daily}/skip`);
    expect(skip.status).toBe(200);
    expect((await runs(daily))[0]).toMatchObject({ status: "skipped", manual: true });
    const now = await MAIL("POST", `schedules/${daily}/send-now`);
    expect(now.json.schedule.sentCount).toBe(2);
    await drain();
    expect(server.sent).toHaveLength(2);
    expect((await parsed(1)).text).toContain("#2.");
    const s = (await MAIL("GET", `schedules/${daily}`)).json.schedule;
    await tickAt(s.nextRunAt);
    const done = (await MAIL("GET", `schedules/${daily}`)).json.schedule;
    expect(done).toMatchObject({ status: "ended", statusNote: "All 3 emails sent", sentCount: 3, nextRunAt: null });
    expect((await MAIL("POST", `schedules/${daily}/resume`)).json.error.message).toMatch(/All 3 have been sent/);
    const ended = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner!), eq(schema.notifications.kind, "mail.recurring")));
    expect(ended.some((x) => x.title === "Finished: Standup")).toBe(true);
  });

  let meet = "";
  it("makes a video room, attaches each day's invite, and pauses and resumes its calendar event", async () => {
    server.sent = [];
    const r = await MAIL("POST", "schedules", base({ name: "Review", subject: "Weekly review", body: "Agenda in the doc.", to: ["asha@client.in"], cc: ["ravi@client.in"], repeat: { freq: "weekly", interval: 1, byDay: [1, 3, 5], until: null, count: null }, startDate: tomorrow(), meeting: { title: "Review call", at: "10:00", durationMin: 45, makeLink: true, invite: true, details: true } }));
    const s = r.json.schedule;
    meet = s.id;
    expect(s.meeting.link).toMatch(/^https:\/\/meet\.jit\.si\/Cloudesk-[0-9a-f]{24}$/);
    expect(s.upcoming.every((x: string) => [1, 3, 5].includes(new Date(new Date(x).toLocaleString("en-US", { timeZone: TZ })).getDay()))).toBe(true);
    await tickAt(s.upcoming[0]);
    const m = await parsed(0);
    expect(m.text).toContain("Review call");
    expect(m.text).toContain(`Join: ${s.meeting.link}`);
    const cal = m.attachments.find((a) => a.contentType.startsWith("text/calendar"))?.content.toString() ?? (await simpleParser(server.sent[0]!.raw)).text ?? "";
    const ics = cal || server.sent[0]!.raw;
    expect(ics).toMatch(/METHOD:REQUEST/);
    expect(ics.replace(/\r?\n /g, "")).toContain(`UID:${s.id}.${dayOf(Date.parse(s.upcoming[0]), TZ)}@cloudesk`);
    expect(ics.replace(/\r?\n /g, "")).toMatch(/ATTENDEE[^\r\n]*asha@client\.in/);
    // Paused: the meetings leave the calendar; resumed: they're back.
    const p = await MAIL("POST", `schedules/${meet}/pause`);
    expect(p.json.schedule).toMatchObject({ status: "paused", eventId: null, upcoming: [] });
    expect(await db.select().from(schema.calEvents).where(eq(schema.calEvents.uid, `${meet}@cloudesk`))).toHaveLength(0);
    const back = await MAIL("POST", `schedules/${meet}/resume`);
    expect(back.json.schedule.status).toBe("active");
    const [e] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.uid, `${meet}@cloudesk`));
    expect(e).toMatchObject({ title: "Review call", meetingUrl: s.meeting.link });
    expect(e!.endsAt.getTime() - e!.startsAt.getTime()).toBe(45 * 60_000);
  });

  it("stays in one conversation and stops when someone replies", async () => {
    server.sent = [];
    const r = await MAIL("POST", "schedules", base({ name: "Chaser", subject: "Invoice reminder", body: "Gentle reminder #{{n}}", thread: "same", stopOnReply: true }));
    const s = r.json.schedule;
    await tickAt(s.upcoming[0]);
    const firstMsg = await parsed(0);
    await tickAt(s.upcoming[1]);
    const second = await parsed(1);
    expect(second.inReplyTo).toBe(firstMsg.messageId);
    const rs = await runs(s.id);
    expect(rs.filter((x) => x.status === "sent")).toHaveLength(2);
    // Their reply comes in…
    await server.deliver({ from: "Client Team <team@client.in>", to: "meera@saffron.in", subject: "Re: Invoice reminder", text: "Paid yesterday!", inReplyTo: second.messageId, references: [firstMsg.messageId!, second.messageId!] });
    await syncAccount(accountId);
    await tickAt(s.upcoming[2]);
    const after = (await MAIL("GET", `schedules/${s.id}`)).json.schedule;
    expect(after).toMatchObject({ status: "ended", statusNote: "Stopped: Client Team replied", sentCount: 2 });
    expect(server.sent).toHaveLength(2);
  });

  it("skips a send it missed, if asked to", async () => {
    server.sent = [];
    const r = await MAIL("POST", "schedules", base({ subject: "Ops digest", missed: "skip" }));
    const s = r.json.schedule;
    await tickAt(s.upcoming[0], 2 * H);
    expect((await runs(s.id))[0]).toMatchObject({ status: "skipped", note: "Missed while Cloudesk was offline" });
    expect(server.sent).toHaveLength(0);
    expect((await MAIL("GET", `schedules/${s.id}`)).json.schedule.nextRunAt).toBe(s.upcoming[1]);
  });

  it("is only for people who can use the mailbox; edits recompute; delete takes its event", async () => {
    expect((await MAIL("GET", `schedules/${meet}`, undefined, "other")).status).toBe(404);
    expect((await MAIL("GET", "schedules", undefined, "other")).json.schedules).toHaveLength(0);
    const list = (await MAIL("GET", "schedules")).json.schedules;
    expect(list.length).toBeGreaterThanOrEqual(4);
    const cur = list.find((x: { id: string }) => x.id === meet);
    const edited = await MAIL("PUT", `schedules/${meet}`, { ...cur, times: ["08:15"], meeting: { ...cur.meeting, at: "08:30" } });
    expect(edited.status).toBe(200);
    expect(new Date(edited.json.schedule.nextRunAt).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })).toBe("08:15");
    expect(edited.json.schedule.meeting.link).toBe(cur.meeting.link);
    const dup = await MAIL("POST", `schedules/${meet}/duplicate`);
    expect(dup.json.schedule).toMatchObject({ name: "Review (copy)", status: "active" });
    expect(dup.json.schedule.meeting.link).not.toBe(cur.meeting.link);
    expect((await MAIL("DELETE", `schedules/${meet}`)).status).toBe(200);
    expect(await db.select().from(schema.calEvents).where(eq(schema.calEvents.uid, `${meet}@cloudesk`))).toHaveLength(0);
  });
});
