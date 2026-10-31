import { describe, expect, it } from "vitest";
import { gratuity, isLate, overtimeMinutes, overtimePay, serviceYears, settlementLines, shiftMinutes } from "@/lib/hr/model";

describe("shifts and overtime", () => {
  it("measures shifts, night shifts included, and lateness against their start", () => {
    expect(shiftMinutes({ start: "09:30", end: "18:30", breakMinutes: 60 })).toBe(480);
    expect(shiftMinutes({ start: "22:00", end: "06:00", breakMinutes: 30 })).toBe(450);
    expect(isLate(9 * 60 + 40, { start: "09:30", graceMin: 15 })).toBe(false);
    expect(isLate(9 * 60 + 50, { start: "09:30", graceMin: 15 })).toBe(true);
    // Checking in at 21:55 for a 22:00 shift isn't "late by 23 hours".
    expect(isLate(21 * 60 + 55, { start: "22:00", graceMin: 10 })).toBe(false);
    expect(isLate(22 * 60 + 20, { start: "22:00", graceMin: 10 })).toBe(true);
  });

  it("counts overtime past the shift once it reaches the minimum, and all of a day off", () => {
    expect(overtimeMinutes(500, 480, 30)).toBe(0);
    expect(overtimeMinutes(540, 480, 30)).toBe(60);
    expect(overtimeMinutes(300, null, 30)).toBe(300);
    // ₹26,000 basic: ₹1,000 a day, ₹125 an hour at 8 hours; 90 minutes at double = ₹375.
    expect(overtimePay(90, 26000_00, 8, 2)).toBe(375_00);
  });
});

describe("full and final settlement", () => {
  it("counts service years with six months or more as a year", () => {
    expect(serviceYears("2019-04-01", "2026-03-31")).toMatchObject({ years: 6, months: 11, counted: 7 });
    expect(serviceYears("2021-07-15", "2026-10-31")).toMatchObject({ years: 5, months: 3, counted: 5 });
  });

  it("pays gratuity at 15 days' basic per year after five years, capped at ₹20 lakh", () => {
    expect(gratuity(26000_00, "2021-07-15", "2026-10-31", 5)).toEqual({ eligible: true, years: 5, amount: 75000_00 });
    expect(gratuity(26000_00, "2022-07-15", "2026-10-31", 5).eligible).toBe(false);
    expect(gratuity(20_00_000_00, "1990-01-01", "2026-01-01", 5).amount).toBe(20_00_000_00);
  });

  it("adds leave encashment and recovers notice not served", () => {
    const lines = settlementLines({ monthlyBasic: 26000_00, monthlyGross: 60000_00, joinDate: "2021-07-15", lastDay: "2026-10-31", noticeFrom: "2026-10-12", noticeDays: 30, encashDays: 10, gratuityYears: 5 });
    expect(lines).toEqual([
      expect.objectContaining({ code: "LEAVE", kind: "earning", amount: 10000_00 }),
      expect.objectContaining({ code: "GRATUITY", amount: 75000_00 }),
      expect.objectContaining({ code: "NOTICE", kind: "recovery", amount: 20000_00 }),
    ]);
  });
});
