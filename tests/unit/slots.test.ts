import { describe, expect, it } from "vitest";
import { addDays, icsFile, localDate, slotsForDay, weekday, zonedTime } from "@/lib/bookings/slots";

const base = { tz: "Asia/Kolkata", hours: { mon: [["09:00", "12:00"]] as [string, string][] }, stepMin: 30, durationMin: 60, bufferMin: 0, capacity: 1, minNoticeHours: 0, maxDaysAhead: 30, closedDates: [] as string[], busy: [] };

describe("booking slots", () => {
  it("converts wall-clock time in a zone to UTC, across daylight saving changes", () => {
    expect(zonedTime("2026-11-02", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-11-02T03:30:00.000Z");
    expect(zonedTime("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedTime("2026-12-01", "09:00", "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(zonedTime("2026-03-08", "12:00", "America/New_York").toISOString()).toBe("2026-03-08T16:00:00.000Z");
    expect(localDate(new Date("2026-11-01T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-02");
    expect(weekday("2026-11-02")).toBe("mon");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("offers slots inside opening hours that fit the service", () => {
    const s = slotsForDay({ ...base, date: "2026-11-02", now: new Date("2026-11-01T00:00:00Z") });
    expect(s.map((x) => x.time)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
    expect(slotsForDay({ ...base, date: "2026-11-03", now: new Date("2026-11-01T00:00:00Z") })).toEqual([]);
    expect(slotsForDay({ ...base, date: "2026-11-02", closedDates: ["2026-11-02"], now: new Date("2026-11-01T00:00:00Z") })).toEqual([]);
  });

  it("respects notice, horizon, bookings, capacity and buffers", () => {
    const now = new Date("2026-11-02T04:00:00Z"); // 09:30 in India
    expect(slotsForDay({ ...base, date: "2026-11-02", now, minNoticeHours: 1 }).map((x) => x.time)).toEqual(["10:30", "11:00"]);
    expect(slotsForDay({ ...base, date: "2026-12-14", now: new Date("2026-11-01T00:00:00Z") })).toEqual([]);
    const busy = [{ start: zonedTime("2026-11-02", "10:00", "Asia/Kolkata"), end: zonedTime("2026-11-02", "11:00", "Asia/Kolkata") }];
    const early = new Date("2026-11-01T00:00:00Z");
    expect(slotsForDay({ ...base, date: "2026-11-02", now: early, busy }).map((x) => x.time)).toEqual(["09:00", "11:00"]);
    expect(slotsForDay({ ...base, date: "2026-11-02", now: early, busy, bufferMin: 15 }).map((x) => x.time)).toEqual([]);
    const cls = slotsForDay({ ...base, date: "2026-11-02", now: early, busy, capacity: 3 });
    expect(cls.find((x) => x.time === "10:00")!.remaining).toBe(2);
  });

  it("writes a valid calendar file", () => {
    const ics = icsFile({ uid: "b1@x", title: "Haircut, trim", start: new Date("2026-11-02T03:30:00Z"), end: new Date("2026-11-02T04:30:00Z"), description: "Line1\nLine2" });
    expect(ics).toContain("DTSTART:20261102T033000Z");
    expect(ics).toContain("SUMMARY:Haircut\\, trim");
    expect(ics).toContain("DESCRIPTION:Line1\\nLine2");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});
