import { describe, expect, it } from "vitest";
import { isDue, nextDue, orderCost, planSchema, projectMeterDate, reliability, usagePerDay } from "@/lib/maintenance/model";

const plan = { everyDays: 90, everyMeter: 250, startOn: "2026-01-01", startMeter: 0, lastDoneOn: "2026-08-01", lastDoneMeter: 1000, leadDays: 7, leadMeter: 10 };

describe("preventive plans", () => {
  it("is due by date or by meter, whichever comes first", () => {
    expect(nextDue(plan)).toEqual({ date: "2026-10-30", meter: 1250 });
    expect(isDue(plan, "2026-10-22", 1100).due).toBe(false);
    expect(isDue(plan, "2026-10-23", 1100)).toMatchObject({ due: true, byDate: true, byMeter: false });
    expect(isDue(plan, "2026-09-01", 1241)).toMatchObject({ due: true, byDate: false, byMeter: true });
    // Never done: one interval after the start.
    expect(nextDue({ ...plan, lastDoneOn: null, lastDoneMeter: null })).toEqual({ date: "2026-04-01", meter: 250 });
  });

  it("needs a repeat, and projects when a meter comes due", () => {
    expect(planSchema.safeParse({ assetId: "00000000-0000-4000-8000-000000000000", title: "Oil", startOn: "2026-01-01" }).success).toBe(false);
    const perDay = usagePerDay([{ value: 1000, on: "2026-10-01" }, { value: 1100, on: "2026-10-11" }]);
    expect(perDay).toBe(10);
    expect(projectMeterDate(1250, 1100, perDay, "2026-10-11")).toBe("2026-10-26");
    expect(projectMeterDate(1250, 1100, null, "2026-10-11")).toBeNull();
  });
});

describe("costs and reliability", () => {
  it("costs labour, parts and outside work", () => {
    expect(orderCost({ labour: [{ userId: "a", minutes: 90, rate: 400_00 }, { userId: "b", minutes: 30, rate: 300_00 }], partsCost: 1200_00, externalCost: 500_00 })).toEqual({ labour: 750_00, parts: 1200_00, external: 500_00, total: 2450_00 });
  });

  it("works out MTBF, MTTR and availability", () => {
    // 30 days = 720 hours, two breakdowns of 4h and 2h.
    expect(reliability(720, [{ downMinutes: 240 }, { downMinutes: 120 }])).toEqual({ failures: 2, downHours: 6, mtbf: 357, mttr: 3, availability: 0.9917 });
    expect(reliability(720, [])).toMatchObject({ failures: 0, mtbf: null, availability: 1 });
  });
});
