import { describe, expect, it } from "vitest";
import { dayOf, describeSchedule, fillRun, meetingStart, nextSend, plainTitle, scheduleSchema, upcoming } from "@/lib/mail/schedule";

const daily = { freq: "daily" as const, interval: 1, byDay: [], until: null, count: null };
const local = (ms: number, tz: string) => new Date(ms).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

describe("recurring email schedules", () => {
  // Monday 2 Nov 2026, 08:00 in India.
  const t0 = Date.parse("2026-11-02T02:30:00Z");

  it("sends at each time of day, soonest first", () => {
    const next = upcoming({ startDate: "2026-11-02", times: ["09:00", "17:30"], tz: "Asia/Kolkata", repeat: daily, skipDates: [] }, t0, 4);
    // 09:00 and 17:30 in India are 03:30 and 12:00 UTC.
    expect(next.map((x) => new Date(x).toISOString())).toEqual(["2026-11-02T03:30:00.000Z", "2026-11-02T12:00:00.000Z", "2026-11-03T03:30:00.000Z", "2026-11-03T12:00:00.000Z"]);
  });

  it("follows weekday rules, skips holidays and stops on the last day", () => {
    const weekdays = { freq: "weekly" as const, interval: 1, byDay: [1, 2, 3, 4, 5], until: "2026-11-10", count: null };
    const next = upcoming({ startDate: "2026-11-02", times: ["09:00"], tz: "Asia/Kolkata", repeat: weekdays, skipDates: ["2026-11-04"] }, t0, 20);
    expect(next.map((x) => dayOf(x, "Asia/Kolkata"))).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]);
  });

  it("every 2 weeks on chosen days, and monthly", () => {
    const fortnight = { freq: "weekly" as const, interval: 2, byDay: [2, 4], until: null, count: null };
    expect(upcoming({ startDate: "2026-11-02", times: ["10:00"], tz: "Asia/Kolkata", repeat: fortnight, skipDates: [] }, t0, 4).map((x) => dayOf(x, "Asia/Kolkata"))).toEqual(["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19"]);
    const monthly = { freq: "monthly" as const, interval: 1, byDay: [], until: null, count: null };
    expect(upcoming({ startDate: "2026-11-30", times: ["10:00"], tz: "Asia/Kolkata", repeat: monthly, skipDates: [] }, t0, 3).map((x) => dayOf(x, "Asia/Kolkata"))).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    // London leaves summer time on 25 Oct 2026.
    const next = upcoming({ startDate: "2026-10-23", times: ["09:00"], tz: "Europe/London", repeat: daily, skipDates: [] }, Date.parse("2026-10-22T00:00:00Z"), 5);
    expect(next.map((x) => local(x, "Europe/London").slice(-5))).toEqual(["09:00", "09:00", "09:00", "09:00", "09:00"]);
    expect(new Date(next[0]!).toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(new Date(next[3]!).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("ends at the email limit (sent emails, not skipped days)", () => {
    const t = { startDate: "2026-11-02", times: ["09:00"], tz: "Asia/Kolkata", repeat: daily, skipDates: [] };
    expect(nextSend(t, t0, 2, 3)).not.toBeNull();
    expect(nextSend(t, t0, 3, 3)).toBeNull();
    expect(nextSend({ ...t, repeat: { ...daily, until: "2026-11-01" } }, t0)).toBeNull();
  });

  it("fills its placeholders and leaves contact ones for sending", () => {
    const at = Date.parse("2026-11-02T03:30:00Z");
    const text = fillRun("Hi {{first_name}} — stand-up for {{day}}, {{date}} at {{meeting_time}} (#{{n}}) {{meeting_link}}", { at, tz: "Asia/Kolkata", n: 4, meetingLink: "https://meet.jit.si/x", meetingAt: meetingStart(at, "Asia/Kolkata", { at: "09:30" }) });
    expect(text).toMatch(/^Hi \{\{first_name\}\} — stand-up for Monday, Mon,? 2 Nov,? 2026 at 9:30 am \(#4\) https:\/\/meet\.jit\.si\/x$/);
  });

  it("titles the calendar series without the per-email placeholders", () => {
    expect(plainTitle("Stand-up — {{date}}")).toBe("Stand-up");
    expect(plainTitle("Weekly review ({{date}})")).toBe("Weekly review");
    expect(plainTitle("{{day}} sync: team")).toBe("sync: team");
    expect(plainTitle("{{date}}")).toBe("");
  });

  it("describes itself and checks its input", () => {
    expect(describeSchedule({ times: ["09:00"], repeat: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5], until: null, count: null }, limit: null })).toBe("Every weekday at 9:00 am");
    expect(describeSchedule({ times: ["17:30", "09:00"].sort(), repeat: daily, limit: 10, skipDates: ["2026-12-25"] })).toBe("Every day at 9:00 am and 5:30 pm · 10 emails in all · 1 day skipped");
    const ok = { accountId: "8c0c4d4e-0000-4000-8000-000000000001", to: ["a@b.in"], subject: "Hi", startDate: "2026-11-02", times: ["09:00"], repeat: daily };
    expect(scheduleSchema.safeParse(ok).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...ok, to: [] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...ok, times: ["25:00"] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...ok, meeting: { link: "http://insecure.example" } }).success).toBe(false);
  });
});
