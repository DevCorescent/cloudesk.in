import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as calApi from "@/app/api/v1/orgs/[orgId]/calendar/[[...slug]]/route";
import * as mailApi from "@/app/api/v1/orgs/[orgId]/mail/[[...slug]]/route";
import { buildIcs } from "@/lib/calendar/ics";
import { scanAccountMeetings } from "@/server/calendar/scan";
import { calendarTick } from "@/server/calendar/tick";
import { drain } from "@/server/jobs/queue";
import { syncAccount } from "@/server/mail/sync";
import { setMailTransport, type MailTransport } from "@/server/mail/transport";
import { call, cookieFrom, resetDb } from "../helpers";

// Calendar with meetings from mail, against a pretend mail server (nothing
// here talks to a real provider): invites in, answers and minutes out.
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
const CAL = (method: string, path: string, body?: unknown, who = "owner") => call((calApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/calendar/${path}`, params: { orgId, slug: seg(path) } });
const MAIL = (method: string, path: string, body?: unknown) => call((mailApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C.owner, body, path: `/api/v1/orgs/${orgId}/mail/${path}`, params: { orgId, slug: seg(path) } });
const H = 3_600_000;
const notes = async (kind: string) => db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner!), eq(schema.notifications.kind, kind)));

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
  // These tests add invites by hand; automatic adding is tested on its own below.
  await MAIL("PATCH", `accounts/${accountId}`, { sendDelaySec: 0, autoAddMeetings: false });
  await syncAccount(accountId);
});
afterAll(async () => {
  setMailTransport(null);
  await closeDb();
});

describe("calendar", () => {
  let work = "";
  it("starts with Work and Personal calendars; events repeat and can change one occurrence", async () => {
    const m = (await CAL("GET", "meta")).json;
    expect(m.calendars.map((c: { name: string }) => c.name)).toEqual(["Work", "Personal"]);
    work = m.calendars[0].id;
    const start = Date.parse("2026-11-02T04:00:00Z"); // Monday 9:30 IST
    const r = await CAL("POST", "events", { calendarId: work, title: "Stand-up", start: new Date(start).toISOString(), end: new Date(start + 0.25 * H).toISOString(), tz: "Asia/Kolkata", repeat: { freq: "weekly", byDay: [1, 2, 3, 4, 5] } });
    expect(r.status).toBe(200);
    const id = r.json.event.id;
    const week = (await CAL("GET", `events?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z`)).json.events;
    expect(week.filter((e: { id: string }) => e.id === id)).toHaveLength(5);
    // Move just Wednesday's.
    const wed = new Date(start + 2 * 24 * H).toISOString();
    const moved = await CAL("PATCH", `events/${id}`, { scope: "this", occurrence: wed, start: new Date(start + 2 * 24 * H + H).toISOString(), end: new Date(start + 2 * 24 * H + 1.25 * H).toISOString() });
    expect(moved.json.event.repeat).toBeNull();
    const after = (await CAL("GET", `events?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z`)).json.events as { id: string; title: string; start: string }[];
    expect(after.filter((e) => e.title === "Stand-up")).toHaveLength(5);
    expect(after.some((e) => e.id === id && e.start === wed)).toBe(false);
    expect((await CAL("POST", "events", { calendarId: work, title: "Bad", start: wed, end: wed })).status).toBe(422);
    // Someone else can't see or touch it.
    expect((await CAL("GET", `events/${id}`, undefined, "other")).status).toBe(404);
    expect((await CAL("DELETE", `events/${id}`, undefined, "other")).status).toBe(404);
  });

  let eventId = "";
  const meetStart = Math.floor((Date.now() + 26 * H) / 1000) * 1000; // invites carry whole seconds
  const invite = (seq: number, start: number, method: "REQUEST" | "CANCEL" = "REQUEST") =>
    buildIcs({ method, uid: "q4-review@google.com", sequence: seq, summary: "Q4 review", description: "Join with Google Meet: https://meet.google.com/abc-defg-hij", start, end: start + H, organizer: { name: "Anika Bose", email: "anika@tajhotels.com" }, attendees: [{ name: "Meera Iyer", email: "meera@saffron.in" }, { name: "Dev", email: "dev@thirdwave.cafe" }] });

  it("finds the invite in mail, lists it under Meetings, and adds it to the calendar on a click", async () => {
    await server.deliver({ from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Invitation: Q4 review", text: "You have been invited.", icalEvent: { method: "REQUEST", content: invite(0, meetStart) }, messageId: "<inv1@google.com>" });
    await syncAccount(accountId);
    const meetings = (await MAIL("GET", "threads?account=all&view=meetings")).json.threads as { id: string; subject: string; meetingAt: string | null; meetingEventId: string | null }[];
    const t = meetings.find((x) => x.subject === "Invitation: Q4 review")!;
    expect(t.meetingAt).toBe(new Date(meetStart).toISOString());
    expect(t.meetingEventId).toBeNull();
    const msg = (await MAIL("GET", `threads/${t.id}`)).json.messages[0];
    expect(msg.meeting).toMatchObject({ title: "Q4 review", provider: "meet", url: "https://meet.google.com/abc-defg-hij", source: "ics", rsvp: true });
    expect(msg.attachments).toHaveLength(1); // the invite file, kept but not counted as an attachment
    expect((await MAIL("GET", "meta")).json.counts.all.meetings).toBe(1);

    const cal = (await CAL("GET", "meta")).json;
    expect(cal.invites[0]).toMatchObject({ title: "Q4 review", start: new Date(meetStart).toISOString(), organizer: { address: "anika@tajhotels.com" } });
    const added = (await CAL("POST", "events/from-mail", { messageId: msg.id })).json;
    eventId = added.event.id;
    expect(added.event).toMatchObject({ title: "Q4 review", meetingUrl: "https://meet.google.com/abc-defg-hij", provider: "meet", organizer: { email: "anika@tajhotels.com" }, source: "mail", organising: false });
    expect(added.event.attendees).toHaveLength(2);
    expect((await CAL("GET", "meta")).json.invites).toHaveLength(0);
    expect((await MAIL("GET", `threads/${t.id}`)).json.thread.meetingEventId).toBe(eventId);
    // Adding again finds the same event.
    expect((await CAL("POST", "events/from-mail", { messageId: msg.id })).json).toMatchObject({ already: true, event: { id: eventId } });
  });

  it("answers the organiser with a real calendar reply", async () => {
    server.sent = [];
    const r = await CAL("POST", `events/${eventId}/rsvp`, { response: "accepted" });
    expect(r.json.event.response).toBe("accepted");
    await drain();
    expect(server.sent[0]!.to).toEqual(["anika@tajhotels.com"]);
    const p = await simpleParser(server.sent[0]!.raw);
    expect(p.subject).toMatch(/^Accepted: Q4 review/);
    expect(server.sent[0]!.raw).toMatch(/Content-Type: text\/calendar; (charset=utf-8; )?method=REPLY/i);
    expect(server.sent[0]!.raw).toMatch(/PARTSTAT=ACCEPTED/);
  });

  it("follows the organiser's update and cancellation", async () => {
    const newStart = meetStart + 2 * H;
    await server.deliver({ from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Updated invitation: Q4 review", text: "Moved.", icalEvent: { method: "REQUEST", content: invite(1, newStart) } });
    await syncAccount(accountId);
    expect((await CAL("GET", `events/${eventId}`)).json.start).toBe(new Date(newStart).toISOString());
    expect((await notes("calendar.changed"))[0]!.title).toBe("Moved: Q4 review");
    // An older copy of the invite doesn't move it back.
    await server.deliver({ from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Invitation: Q4 review (again)", text: "Old.", icalEvent: { method: "REQUEST", content: invite(0, meetStart) } });
    await syncAccount(accountId);
    expect((await CAL("GET", `events/${eventId}`)).json.start).toBe(new Date(newStart).toISOString());
    await server.deliver({ from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Cancelled: Q4 review", text: "Cancelled.", icalEvent: { method: "CANCEL", content: invite(2, newStart, "CANCEL") } });
    await syncAccount(accountId);
    expect((await CAL("GET", `events/${eventId}`)).json.status).toBe("cancelled");
  });

  it("reads a link and a written time from an ordinary email", async () => {
    await server.deliver({ from: "Dev Malhotra <dev@thirdwave.cafe>", to: "meera@saffron.in", subject: "Quick call about mugs", text: "Hi Meera, can we talk tomorrow at 3pm? https://us02web.zoom.us/j/8123456789", messageId: "<zoom1@thirdwave.cafe>" });
    await syncAccount(accountId);
    const inv = ((await CAL("GET", "meta")).json.invites as { title: string; start: string; provider: string; source: string; messageId: string; confidence: string }[]).find((i) => i.title === "Quick call about mugs")!;
    expect(inv).toMatchObject({ provider: "zoom", source: "text", confidence: "high" });
    expect(new Date(inv.start).getUTCMinutes()).toBe(30); // 3:00 pm IST = 9:30 UTC
    const e = (await CAL("POST", "events/from-mail", { messageId: inv.messageId, title: "Mugs call with Dev" })).json.event;
    expect(e).toMatchObject({ title: "Mugs call with Dev", provider: "zoom", organizer: { email: "dev@thirdwave.cafe" } });
    expect(Date.parse(e.end) - Date.parse(e.start)).toBe(30 * 60_000);
  });

  it("sends our own invites as real calendar invites", async () => {
    server.sent = [];
    const start = Date.now() + 50 * H;
    const r = await CAL("POST", "events", { calendarId: work, title: "Supplier sync", start: new Date(start).toISOString(), end: new Date(start + H).toISOString(), meetingUrl: "https://meet.google.com/xyz-abcd-efg", attendees: [{ email: "Sana@LinenLoft.in", name: "Sana" }], sendInvite: true, accountId });
    expect(r.json.event).toMatchObject({ organising: true, organizer: { email: "meera@saffron.in" } });
    await drain();
    expect(server.sent[0]!.to).toEqual(["sana@linenloft.in"]);
    expect(server.sent[0]!.raw).toMatch(/method=REQUEST/i);
    expect(server.sent[0]!.raw).toMatch(/ORGANIZER;CN="Meera Iyer":mailto:meera@saffron\.in/);
    expect((await CAL("GET", `events/${r.json.event.id}`)).json.organizer).toMatchObject({ email: "meera@saffron.in" });
  });

  it("reminds through the day before a meeting, once each, and then asks for the minutes", async () => {
    const start = Date.parse("2026-12-01T09:00:00Z");
    const e = (await CAL("POST", "events", { calendarId: work, title: "Design review", start: new Date(start).toISOString(), end: new Date(start + H).toISOString(), meetingUrl: "https://meet.google.com/aaa-bbbb-ccc", attendees: [{ email: "anika@tajhotels.com", name: "Anika Bose" }], reminders: [1440, 180, 60, 10, 0] })).json.event;
    for (const t of [start - 1440 * 60_000, start - 180 * 60_000 + 60_000, start - 60 * 60_000, start - 60 * 60_000 + 30_000, start - 10 * 60_000, start + 60_000]) await calendarTick(t);
    const rem = (await notes("calendar.reminder")).filter((n) => n.title.includes("Design review"));
    expect(rem).toHaveLength(5);
    expect(rem.map((n) => n.title)).toContain("Starting now: Design review");
    expect(rem.some((n) => n.body.includes("https://meet.google.com/aaa-bbbb-ccc"))).toBe(true);
    // A reminder that's hours late isn't sent.
    const late = (await CAL("POST", "events", { calendarId: work, title: "Missed one", start: new Date(start + 5 * H).toISOString(), end: new Date(start + 6 * H).toISOString(), reminders: [180] })).json.event;
    await calendarTick(start + 4.9 * H);
    expect((await notes("calendar.reminder")).some((n) => n.title.includes("Missed one"))).toBe(false);
    void late;
    // After it ends: one nudge for the minutes.
    await calendarTick(start + H + 5 * 60_000);
    await calendarTick(start + H + 10 * 60_000);
    const ask = (await notes("calendar.notes")).filter((n) => n.title.includes("Design review"));
    expect(ask).toHaveLength(1);
    expect(ask[0]!.link).toContain(`event=${e.id}`);
  });

  it("saves the minutes and shares them with the organiser and others, as a reply in the invite's conversation", async () => {
    const inv = await server.deliver({ from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Invitation: Pricing chat", text: "Invite", icalEvent: { method: "REQUEST", content: buildIcs({ method: "REQUEST", uid: "pricing@google.com", summary: "Pricing chat", start: Date.now() - 2 * H, end: Date.now() - H, organizer: { name: "Anika Bose", email: "anika@tajhotels.com" }, attendees: [{ name: "Meera Iyer", email: "meera@saffron.in" }], description: "https://meet.google.com/ppp-qqqq-rrr" }) }, messageId: "<pricing@google.com>" });
    void inv;
    await syncAccount(accountId);
    const invite = ((await CAL("GET", "meta")).json.invites as { title: string; messageId: string }[]).find((i) => i.title === "Pricing chat");
    // Already over: it's still offered (a meeting from the last day), and once added the minutes are due.
    const e = (await CAL("POST", "events/from-mail", { messageId: invite!.messageId })).json.event;
    const occurrence = e.start;
    expect((await CAL("GET", "meta")).json.notesDue.map((d: { eventId: string }) => d.eventId)).toContain(e.id);
    const fresh = (await CAL("GET", `notes?event=${e.id}&occurrence=${encodeURIComponent(occurrence)}`)).json;
    expect(fresh.fields.present).toEqual(expect.arrayContaining(["Meera Iyer", "Anika Bose"]));
    const fields = { ...fresh.fields, summary: "Agreed new wholesale prices.", decisions: ["10% off over 500 units"], actions: [{ text: "Send the revised price list", owner: "Meera", due: "2026-10-30" }] };
    expect((await CAL("PUT", "notes", { event: e.id, occurrence, fields })).status).toBe(200);
    server.sent = [];
    const r = await CAL("POST", "notes/share", { event: e.id, occurrence, accountId, to: ["anika@tajhotels.com"], cc: ["dev@thirdwave.cafe"] });
    expect(r.json.sharedTo).toEqual(["anika@tajhotels.com", "dev@thirdwave.cafe"]);
    await drain();
    const p = await simpleParser(server.sent[0]!.raw);
    expect(p.subject).toMatch(/^Minutes: Pricing chat — /);
    expect(p.inReplyTo).toBe("<pricing@google.com>");
    expect(p.text).toContain("- Send the revised price list — Meera (by 2026-10-30)");
    expect(String(p.html)).toContain("Action items");
    expect((await CAL("GET", "meta")).json.notesDue.map((d: { eventId: string }) => d.eventId)).not.toContain(e.id);
    expect((await CAL("POST", "notes/share", { event: e.id, occurrence, accountId, to: [] })).status).toBe(422);
  });

  it("adds invites automatically when the mailbox is set to", async () => {
    await MAIL("PATCH", `accounts/${accountId}`, { autoAddMeetings: true });
    const start = Date.now() + 72 * H;
    await server.deliver({ from: "Kiran Rao <kiran@client.in>", to: "meera@saffron.in", subject: "Invitation: Contract walkthrough", text: "Invite", icalEvent: { method: "REQUEST", content: buildIcs({ method: "REQUEST", uid: "contract@client.in", summary: "Contract walkthrough", start, end: start + H, organizer: { name: "Kiran Rao", email: "kiran@client.in" }, attendees: [] }) } });
    await syncAccount(accountId);
    const [e] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.uid, "contract@client.in"));
    expect(e).toMatchObject({ title: "Contract walkthrough", ownerId: U.owner, source: "mail" });
    expect((await notes("calendar.added"))[0]!.title).toBe("Added to your calendar: Contract walkthrough");
  });

  it("tells you about a meeting link with a time read from the text, to confirm", async () => {
    // A date a few days ahead, so the written time is never already past on the day the tests run.
    const day = new Date(Date.now() + 4 * 24 * H).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    await server.deliver({ from: "Ishaan Mehta <ishaan@studiomehta.in>", to: "meera@saffron.in", subject: "Catalogue photos", text: `Hi! Shall we review the shots on ${day} at 11:30 am? https://meeting.zoho.in/meeting/join?key=123456789` });
    await syncAccount(accountId);
    const n = (await notes("calendar.found")).find((x) => x.title.includes("Catalogue photos"))!;
    expect(n.body).toMatch(/check the time/);
    const inv = ((await CAL("GET", "meta")).json.invites as { title: string; provider: string }[]).find((i) => i.title === "Catalogue photos");
    expect(inv?.provider).toBe("zoho");
  });

  it("finds meetings in mail that arrived before — the invite's own link, wrapped links, even in newsletters", async () => {
    await MAIL("PATCH", `accounts/${accountId}`, { autoAddMeetings: true });
    const start = Math.floor((Date.now() + 5 * 24 * H) / 1000) * 1000;
    // A Google invite (with X-GOOGLE-CONFERENCE) sent by a mailing tool, with an unsubscribe link.
    const ics = buildIcs({ method: "REQUEST", uid: "webinar@events.example", summary: "Partner webinar", start, end: start + H, organizer: { name: "Events", email: "events@partner.example" }, attendees: [] }).replace("BEGIN:VEVENT\r\n", "BEGIN:VEVENT\r\nX-GOOGLE-CONFERENCE:https://meet.google.com/web-inar-abc\r\n");
    await server.deliver({ from: "Events <events@partner.example>", to: "meera@saffron.in", subject: "You're registered: Partner webinar", text: "See you there", headers: { "List-Unsubscribe": "<https://partner.example/u>" }, icalEvent: { method: "REQUEST", content: ics } });
    // An Outlook mail with the Teams link wrapped in Safe Links, and a written time.
    await server.deliver({ from: "Kiran Rao <kiran@client.in>", to: "meera@saffron.in", subject: "Quick sync on the contract", html: `<p>Can we talk tomorrow at 5pm IST?</p><p><a href="https://apc01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253ameeting_xyz%2540thread.v2%2F0&amp;data=05%7C01">Join the meeting now</a></p>` });
    await syncAccount(accountId);
    // As if they'd arrived before meetings were looked for: forget what was found.
    const T = schema.mailThreads;
    await db.update(schema.mailMessages).set({ meeting: null });
    await db.update(T).set({ meetingAt: null, meetingEventId: null });
    await db.delete(schema.calEvents).where(eq(schema.calEvents.uid, "webinar@events.example"));

    const r = await scanAccountMeetings(accountId);
    expect(r.found).toBeGreaterThanOrEqual(2);
    expect(r.added).toBeGreaterThanOrEqual(1);
    const [webinar] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.uid, "webinar@events.example"));
    expect(webinar).toMatchObject({ title: "Partner webinar", meetingUrl: "https://meet.google.com/web-inar-abc", meetingProvider: "meet", startsAt: new Date(start) });
    const sync = ((await CAL("GET", "meta")).json.invites as { title: string; url: string; provider: string }[]).find((i) => i.title === "Quick sync on the contract")!;
    expect(sync).toMatchObject({ provider: "teams" });
    expect(sync.url).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
    expect((await notes("calendar.added")).some((n) => /meetings? from your email added/.test(n.title))).toBe(true);
    // Scanning again doesn't add twice.
    expect((await scanAccountMeetings(accountId)).added).toBe(0);
    expect((await CAL("POST", "meetings/scan")).json).toMatchObject({ mailboxes: 1 });
    // A reply that quotes the same link is that meeting, not a new one.
    await server.deliver({ from: "Events <events@partner.example>", to: "meera@saffron.in", subject: "Re: Partner webinar — slides", text: `Slides attached. Link again: https://meet.google.com/web-inar-abc on ${new Date(start).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} at ${new Date(start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}` });
    await syncAccount(accountId);
    const again = ((await MAIL("GET", "threads?account=all&view=meetings")).json.threads as { subject: string; meetingEventId: string | null }[]).find((t) => t.subject.startsWith("Re: Partner webinar"))!;
    expect(again.meetingEventId).toBe(webinar!.id);
  });
});

