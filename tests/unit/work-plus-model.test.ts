import { describe, expect, it } from "vitest";
import { allocatedHours, capacityHours, criticalPath, reschedule, riskLevel, wouldLoop } from "@/lib/work/model";

describe("projects+", () => {
  it("refuses links that make a loop", () => {
    const links = [{ fromId: "a", toId: "b" }, { fromId: "b", toId: "c" }];
    expect(wouldLoop(links, { fromId: "c", toId: "a" })).toBe(true);
    expect(wouldLoop(links, { fromId: "a", toId: "c" })).toBe(false);
    expect(wouldLoop([], { fromId: "a", toId: "a" })).toBe(true);
  });

  it("pushes tasks later to respect what they wait on, keeping their length", () => {
    const tasks = [{ id: "design", startDate: "2026-11-02", dueDate: "2026-11-06" }, { id: "build", startDate: "2026-11-04", dueDate: "2026-11-11" }, { id: "test", startDate: "2026-11-05", dueDate: "2026-11-06" }];
    const moved = reschedule(tasks, [{ fromId: "design", toId: "build", type: "FS", lagDays: 0 }, { fromId: "build", toId: "test", type: "FS", lagDays: 2 }]);
    expect(moved.get("build")).toEqual({ startDate: "2026-11-07", dueDate: "2026-11-14" });
    expect(moved.get("test")).toEqual({ startDate: "2026-11-17", dueDate: "2026-11-18" });
  });

  it("finds the critical path", () => {
    const tasks = [{ id: "a", startDate: "2026-11-02", dueDate: "2026-11-04" }, { id: "b", startDate: "2026-11-05", dueDate: "2026-11-10" }, { id: "c", startDate: "2026-11-05", dueDate: "2026-11-06" }];
    const cp = criticalPath(tasks, [{ fromId: "a", toId: "b", type: "FS", lagDays: 0 }, { fromId: "a", toId: "c", type: "FS", lagDays: 0 }]);
    expect(cp).toEqual({ ids: ["a", "b"], finish: "2026-11-10" });
  });

  it("works out capacity less leave, and booked hours", () => {
    // Mon 2 Nov – Sun 8 Nov, Mon–Sat at 8 hours, a day and a half of leave: 36 hours.
    expect(capacityHours("2026-11-02", "2026-11-08", [1, 2, 3, 4, 5, 6], 8, new Map([["2026-11-04", 1], ["2026-11-05", 0.5]]))).toBe(36);
    expect(allocatedHours([{ from: "2026-10-30", to: "2026-11-03", hoursPerDay: 4 }], "2026-11-02", "2026-11-08", [1, 2, 3, 4, 5])).toBe(8);
    expect(riskLevel(5 * 4)).toBe("high");
  });
});
