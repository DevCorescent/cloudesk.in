import { describe, expect, it } from "vitest";
import { findMeetingLink, findMeetingTime } from "@/lib/calendar/detect";
import { buildIcs, parseIcs } from "@/lib/calendar/ics";
import { layoutDay } from "@/lib/calendar/layout";
import { minutesHtml, minutesText, notesSchema } from "@/lib/calendar/model";
import { describeRepeat, fromRrule, occurrences, toRrule } from "@/lib/calendar/recur";
import { zonedToUtc } from "@/lib/calendar/tz";

const IST = "Asia/Kolkata";
const iso = (ms: number) => new Date(ms).toISOString();

describe("calendar invites (.ics)", () => {
  it("reads a Google-style invite in UTC with organizer, attendees and Meet link", () => {
    const ics = [
      "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
      "DTSTART:20261028T093000Z", "DTEND:20261028T103000Z", "UID:abc123@google.com", "SEQUENCE:0",
      "ORGANIZER;CN=Anika Bose:mailto:anika@tajhotels.com",
      "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=meera@saffron.in;X-NUM-GUESTS=0:mailto:meera@saffron.in",
      "SUMMARY:Tableware review", "DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nAgenda:\\, plates",
      "LOCATION:", "STATUS:CONFIRMED", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const c = parseIcs(ics);
    expect(c.method).toBe("REQUEST");
    expect(c.events).toHaveLength(1);
    const e = c.events[0]!;
    expect(iso(e.start)).toBe("2026-10-28T09:30:00.000Z");
    expect(iso(e.end)).toBe("2026-10-28T10:30:00.000Z");
    expect(e).toMatchObject({ uid: "abc123@google.com", summary: "Tableware review", organizer: { email: "anika@tajhotels.com", name: "Anika Bose" } });
    expect(e.attendees[0]).toMatchObject({ email: "meera@saffron.in", partstat: "NEEDS-ACTION" });
    expect(e.description).toContain("Agenda:, plates");
    expect(findMeetingLink(e.description)).toEqual({ url: "https://meet.google.com/abc-defg-hij", provider: "meet" });
    expect(parseIcs(ics.replace("SUMMARY:", "X-GOOGLE-CONFERENCE:https://meet.google.com/xyz-abcd-efg\r\nSUMMARY:")).events[0]!.conference).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("reads an Outlook invite with a Windows zone name and folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VTIMEZONE", "TZID:India Standard Time", "BEGIN:STANDARD", "DTSTART:16010101T000000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "END:STANDARD", "END:VTIMEZONE",
      "BEGIN:VEVENT", "ORGANIZER;CN=\"Rao, Kiran\":mailto:kiran@client.in", "SUMMARY;LANGUAGE=en-US:Quarterly review with the", " client team",
      "DTSTART;TZID=India Standard Time:20261030T150000", "DTEND;TZID=India Standard Time:20261030T160000", "UID:040000008200E00074C5B7101A82E008", "LOCATION:Microsoft Teams Meeting",
      "DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const e = parseIcs(ics).events[0]!;
    expect(e.summary).toBe("Quarterly review with theclient team");
    expect(iso(e.start)).toBe("2026-10-30T09:30:00.000Z");
    expect(e.tz).toBe(IST);
    expect(e.organizer).toMatchObject({ name: "Rao, Kiran" });
    expect(findMeetingLink(e.description)?.provider).toBe("teams");
  });

  it("uses a VTIMEZONE's offset for zones it can't name, and reads all-day and cancellations", () => {
    const ics = ["BEGIN:VCALENDAR", "METHOD:CANCEL", "BEGIN:VTIMEZONE", "TZID:Custom Zone", "BEGIN:STANDARD", "TZOFFSETTO:+0400", "END:STANDARD", "END:VTIMEZONE",
      "BEGIN:VEVENT", "UID:x1", "DTSTART;TZID=Custom Zone:20261101T100000", "DURATION:PT45M", "SUMMARY:Sync", "STATUS:CANCELLED", "END:VEVENT",
      "BEGIN:VEVENT", "UID:x2", "DTSTART;VALUE=DATE:20261225", "SUMMARY:Holiday", "END:VEVENT", "END:VCALENDAR"].join("\n");
    const c = parseIcs(ics);
    expect(c.method).toBe("CANCEL");
    expect(iso(c.events[0]!.start)).toBe("2026-11-01T06:00:00.000Z");
    expect(c.events[0]!.end - c.events[0]!.start).toBe(45 * 60_000);
    expect(c.events[0]!.status).toBe("CANCELLED");
    expect(c.events[1]).toMatchObject({ allDay: true, summary: "Holiday" });
    expect(c.events[1]!.end - c.events[1]!.start).toBe(86_400_000);
  });

  it("writes invites and replies that read back the same", () => {
    const start = Date.parse("2026-10-28T09:30:00Z");
    const text = buildIcs({ method: "REQUEST", uid: "u-1@cloudesk", summary: "Review; plates, cups", description: "Line one\nLine two", start, end: start + 3_600_000, organizer: { name: "Meera", email: "meera@saffron.in" }, attendees: [{ name: "Anika", email: "anika@tajhotels.com" }], url: "https://meet.google.com/abc-defg-hij", rrule: "FREQ=WEEKLY;BYDAY=WE" });
    expect(text).toMatch(/\r\n/);
    expect(text.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const back = parseIcs(text).events[0]!;
    expect(back).toMatchObject({ uid: "u-1@cloudesk", summary: "Review; plates, cups", description: "Line one\nLine two", start, rrule: "FREQ=WEEKLY;BYDAY=WE" });
    const reply = buildIcs({ method: "REPLY", uid: "u-1@cloudesk", summary: "Review", start, end: start + 3_600_000, organizer: { name: "", email: "anika@tajhotels.com" }, attendees: [], reply: { email: "meera@saffron.in", partstat: "ACCEPTED" } });
    expect(parseIcs(reply)).toMatchObject({ method: "REPLY", events: [{ attendees: [{ email: "meera@saffron.in", partstat: "ACCEPTED" }] }] });
  });
});

describe("meeting links and times in email text", () => {
  it("finds Meet, Zoom, Teams, Webex and Jitsi links (and not look-alikes)", () => {
    expect(findMeetingLink("Join: https://us02web.zoom.us/j/8123456789?pwd=abc.")).toEqual({ url: "https://us02web.zoom.us/j/8123456789?pwd=abc", provider: "zoom" });
    expect(findMeetingLink("https://acme.webex.com/meet/kiran")?.provider).toBe("webex");
    expect(findMeetingLink("at https://meet.jit.si/SaffronStandup")?.provider).toBe("jitsi");
    expect(findMeetingLink("https://meet.google.com.evil.example/abc-defg-hij")).toBeNull();
    expect(findMeetingLink("no link here")).toBeNull();
  });

  it("unwraps Safe Links, Google redirects and HTML, and knows more services", () => {
    expect(findMeetingLink(`<a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fus06web.zoom.us%2Fj%2F8812345678%3Fpwd%3Dabc&amp;data=05">Join</a>`)).toEqual({ url: "https://us06web.zoom.us/j/8812345678?pwd=abc", provider: "zoom" });
    expect(findMeetingLink("https://www.google.com/url?q=https://meet.google.com/abc-defg-hij&sa=D&ust=1")?.url).toBe("https://meet.google.com/abc-defg-hij");
    expect(findMeetingLink("https://urldefense.com/v3/__https://acme.webex.com/meet/kiran__;!!abc")?.provider).toBe("webex");
    expect(findMeetingLink("Join: https://meeting.zoho.in/meeting/join?key=1234")?.provider).toBe("zoho");
    expect(findMeetingLink("https://teams.microsoft.com/meet/2847?p=abc")?.provider).toBe("teams");
    expect(findMeetingLink("https://chime.aws/1234567890")?.provider).toBe("chime");
  });

  const sent = zonedToUtc({ y: 2026, m: 10, d: 26, h: 10, mi: 0, s: 0 }, IST); // Monday 26 Oct 2026, 10:00 IST
  const at = (y: number, m: number, d: number, h: number, mi = 0) => iso(zonedToUtc({ y, m, d, h, mi, s: 0 }, IST));

  it("reads written dates and times relative to when the email was sent", () => {
    expect(findMeetingTime("Can we meet tomorrow at 3pm?", sent)).toMatchObject({ start: Date.parse(at(2026, 10, 27, 15)), confidence: "high" });
    expect(iso(findMeetingTime("Call on 28 Oct, 11:30 AM IST", sent)!.start)).toBe(at(2026, 10, 28, 11, 30));
    expect(iso(findMeetingTime("Let's sync on October 29th 4-5pm", sent)!.end!)).toBe(at(2026, 10, 29, 17));
    expect(iso(findMeetingTime("Demo on Thursday at 14:00", sent)!.start)).toBe(at(2026, 10, 29, 14));
    expect(iso(findMeetingTime("Interview 30/10/2026 at 10 a.m.", sent)!.start)).toBe(at(2026, 10, 30, 10));
    // A named zone wins over the reader's.
    expect(iso(findMeetingTime("Call tomorrow 9:00 AM PST", sent)!.start)).toBe("2026-10-27T17:00:00.000Z");
    // A date in January read in October is next year.
    expect(iso(findMeetingTime("Review meeting 5 Jan at 3 pm", sent)!.start)).toBe(at(2027, 1, 5, 15));
  });

  it("doesn't take plain numbers for times, and says when it's only a guess", () => {
    expect(findMeetingTime("Order 400 plates by 28 Oct", sent)).toBeNull();
    expect(findMeetingTime("Room 12 on floor 3", sent)).toBeNull();
    const guess = findMeetingTime("ping me at 4pm", sent)!;
    expect(guess.confidence).toBe("low");
    expect(iso(guess.start)).toBe(at(2026, 10, 26, 16));
  });
});

describe("repeats", () => {
  const start = zonedToUtc({ y: 2026, m: 10, d: 26, h: 9, mi: 30, s: 0 }, IST); // Monday
  const H = 3_600_000;
  it("expands weekdays, weekly on chosen days, monthly and counts", () => {
    const weekdays = occurrences(start, H, IST, { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null }, start, start + 14 * 86_400_000);
    expect(weekdays).toHaveLength(10);
    const tueThu = occurrences(start, H, IST, { freq: "weekly", interval: 1, byDay: [2, 4], until: null, count: 3 }, start, start + 60 * 86_400_000);
    expect(tueThu.map((m) => new Date(m + 5.5 * H).getUTCDay())).toEqual([2, 4, 2]);
    const monthly = occurrences(Date.parse("2026-01-31T04:00:00Z"), H, IST, { freq: "monthly", interval: 1, byDay: [], until: "2026-05-31", count: null }, 0, Date.parse("2027-01-01"));
    expect(monthly.map((m) => new Date(m).getUTCMonth() + 1)).toEqual([1, 3, 5]); // no 31 Feb / 31 Apr
    expect(occurrences(start, H, IST, null, start - H, start + H)).toEqual([start]);
    const skipped = occurrences(start, H, IST, { freq: "daily", interval: 1, byDay: [], until: null, count: 3 }, start, start + 10 * 86_400_000, [start + 86_400_000]);
    expect(skipped).toHaveLength(2);
  });

  it("keeps the wall-clock time across a DST change", () => {
    const ny = zonedToUtc({ y: 2026, m: 10, d: 30, h: 9, mi: 0, s: 0 }, "America/New_York");
    const two = occurrences(ny, H, "America/New_York", { freq: "weekly", interval: 1, byDay: [], until: null, count: 2 }, ny, ny + 30 * 86_400_000);
    expect(new Date(two[0]!).getUTCHours()).toBe(13);
    expect(new Date(two[1]!).getUTCHours()).toBe(14); // after clocks go back
  });

  it("converts to and from RRULE and describes itself", () => {
    const r = fromRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231T235959Z")!;
    expect(r).toMatchObject({ freq: "weekly", interval: 2, byDay: [1, 4], until: "2026-12-31" });
    expect(toRrule(r)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231T235959Z");
    expect(describeRepeat({ freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null })).toBe("Every weekday");
  });
});

describe("day layout and minutes", () => {
  it("puts overlapping events side by side", () => {
    const placed = layoutDay([{ s: 0, e: 60 }, { s: 30, e: 90 }, { s: 60, e: 120 }, { s: 200, e: 230 }], (x) => x.s, (x) => x.e);
    const at = (s: number) => placed.find((p) => p.item.s === s)!;
    expect([at(0).col, at(30).col, at(60).col]).toEqual([0, 1, 0]);
    expect(at(0).cols).toBe(2);
    expect(at(200)).toMatchObject({ col: 0, cols: 1 });
  });

  it("writes minutes as text and email-safe HTML", () => {
    const n = notesSchema.parse({ present: ["Meera", "Anika"], summary: "Agreed the order.", decisions: ["400 plates"], actions: [{ text: "Send quote", owner: "Meera", due: "2026-10-30" }] });
    const meta = { title: "Tableware <review>", when: "28 Oct 2026, 3:00 pm", organizer: "Anika Bose", where: "Google Meet" };
    expect(minutesText(meta, n)).toContain("- Send quote — Meera (by 2026-10-30)");
    const html = minutesHtml(meta, n);
    expect(html).toContain("Tableware &lt;review&gt;");
    expect(html).not.toMatch(/<script|<style/);
  });
});
