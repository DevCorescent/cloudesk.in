import { describe, expect, it } from "vitest";
import { bucketLabel, change, nextRun, previous, rangeFor, specSchema } from "@/lib/bi/model";

describe("date ranges", () => {
  const r = (preset: Parameters<typeof rangeFor>[0]["preset"]) => rangeFor({ preset, from: null, to: null }, "2026-10-24");
  it("works out presets from today in India", () => {
    // 24 Oct 2026 is a Saturday.
    expect(r("this_week")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(r("last_7")).toEqual({ from: "2026-10-18", to: "2026-10-24" });
    expect(r("this_month")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(r("last_month")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(r("this_quarter")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(r("last_quarter")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(r("this_fy")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(r("last_fy")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(rangeFor({ preset: "this_fy", from: null, to: null }, "2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(r("all")).toEqual({ from: null, to: null });
    expect(rangeFor({ preset: "last_month", from: null, to: null }, "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("finds the period before, and the change", () => {
    expect(previous({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previous({ from: null, to: null })).toBeNull();
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
  });
});

describe("schedules and labels", () => {
  it("sends at the hour in India on the right day", () => {
    // Saturday 24 Oct 2026, 10:00 IST.
    const now = new Date("2026-10-24T04:30:00Z");
    expect(nextRun({ frequency: "daily", hour: 9, weekday: 1, monthday: 1 }, now).toISOString()).toBe("2026-10-25T03:30:00.000Z");
    expect(nextRun({ frequency: "daily", hour: 11, weekday: 1, monthday: 1 }, now).toISOString()).toBe("2026-10-24T05:30:00.000Z");
    expect(nextRun({ frequency: "weekly", hour: 9, weekday: 1, monthday: 1 }, now).toISOString()).toBe("2026-10-26T03:30:00.000Z");
    expect(nextRun({ frequency: "monthly", hour: 8, weekday: 1, monthday: 1 }, now).toISOString()).toBe("2026-11-01T02:30:00.000Z");
  });

  it("labels buckets, and needs something to measure", () => {
    expect(bucketLabel("2026-07-01", "quarter")).toBe("Q3 2026");
    expect(bucketLabel("2026-10-01", "month")).toBe("Oct 2026");
    expect(bucketLabel("2026-01-01", "year")).toBe("2026");
    expect(specSchema.safeParse({ measures: [] }).success).toBe(false);
    expect(specSchema.parse({ measures: [{ agg: "count" }] }).range.preset).toBe("last_30");
  });
});
