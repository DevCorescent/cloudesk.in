import { describe, expect, it } from "vitest";
import { DEFAULT_SOUNDS, inQuietHours, PURPOSES, TUNES, tuneById } from "@/lib/client/sounds";
import { purposeOf } from "@/components/notify/sounds";

describe("notification sounds", () => {
  it("has a working default tune for every purpose, and distinct tunes", () => {
    for (const p of PURPOSES) expect(tuneById(DEFAULT_SOUNDS.tunes[p.id])).toBeDefined();
    expect(new Set(TUNES.map((t) => t.id)).size).toBe(TUNES.length);
    for (const t of TUNES) expect(t.strikes.every((s) => s.f > 100 && s.f < 4000 && s.at >= 0 && s.at < 1.5)).toBe(true);
  });

  it("knows quiet hours, including across midnight", () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 26, h, m);
    const night = { on: true, from: "21:00", to: "08:00" };
    expect(inQuietHours(night, at(23))).toBe(true);
    expect(inQuietHours(night, at(7, 59))).toBe(true);
    expect(inQuietHours(night, at(8))).toBe(false);
    expect(inQuietHours(night, at(14))).toBe(false);
    const lunch = { on: true, from: "13:00", to: "14:00" };
    expect(inQuietHours(lunch, at(13, 30))).toBe(true);
    expect(inQuietHours(lunch, at(14, 30))).toBe(false);
    expect(inQuietHours({ ...night, on: false }, at(23))).toBe(false);
  });

  it("picks the tune's purpose from the notification", () => {
    expect(purposeOf("calendar.reminder")).toBe("calendar");
    expect(purposeOf("approval.requested")).toBe("approvals");
    expect(purposeOf("work.task_assigned")).toBe("approvals");
    expect(purposeOf("mail.followup")).toBe("mail");
    expect(purposeOf("helpdesk.assigned")).toBe("general");
    // Chat sounds come from the live stream, not the bell (no double sound).
    expect(purposeOf("chat.mention")).toBeNull();
  });
});
