import { describe, expect, it } from "vitest";
import { conversionCost, load, mrp, plan, variances } from "@/lib/manufacturing/model";

const table = { outputQty: 1, lines: [{ itemId: "top", qty: 1, scrapPct: 0 }, { itemId: "leg", qty: 4, scrapPct: 0 }, { itemId: "screw", qty: 16, scrapPct: 12.5 }], operations: [{ id: "cut", workCentreId: "saw", name: "Cut", minutes: 10, setupMinutes: 30 }, { id: "fit", workCentreId: "bench", name: "Assemble", minutes: 20, setupMinutes: 0 }] };

describe("manufacturing", () => {
  it("plans materials with scrap and operations with setup", () => {
    const p = plan(table, 10);
    expect(p.materials).toEqual([{ itemId: "top", required: 10, issued: 0 }, { itemId: "leg", required: 40, issued: 0 }, { itemId: "screw", required: 180, issued: 0 }]);
    expect(p.operations.map((o) => o.plannedMinutes)).toEqual([130, 200]);
    // ₹600/hour saw, ₹300/hour bench: 130 min + 200 min.
    expect(conversionCost(p.operations, new Map([["saw", 60000], ["bench", 30000]]))).toBe(130000 + 100000);
  });

  it("works out variances against the recipe for what was made", () => {
    const v = variances([{ itemId: "leg", required: 40, issued: 38 }], 10, 9, new Map([["leg", 5000]]), [{ plannedMinutes: 100, actualMinutes: 120 }]);
    expect(v.materials[0]).toMatchObject({ standard: 36, qty: 2, value: 10000 });
    expect(v.minutes).toBe(120 - 90);
    expect(v.yieldPct).toBe(90);
  });

  it("explodes demand level by level into what to make and what to buy", () => {
    const leg = { outputQty: 1, lines: [{ itemId: "timber", qty: 0.5, scrapPct: 0 }] };
    const r = mrp({
      demand: new Map([["table", 12]]),
      available: new Map([["table", 2], ["leg", 8], ["top", 3], ["timber", 1]]),
      incoming: new Map([["screw", 50]]),
      safety: new Map([["table", 1]]),
      boms: new Map([["table", table], ["leg", leg]]),
      reorderQty: new Map([["top", 10]]),
    });
    // Tables: 12 + 1 safety − 2 = 11 to make. Legs: 44 − 8 = 36 to make. Timber: 18 − 1 = 17 to buy.
    expect(r.make).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: "table", net: 11 }), expect.objectContaining({ itemId: "leg", net: 36 })]));
    expect(r.buy).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: "top", net: 10 }), expect.objectContaining({ itemId: "screw", net: 198 - 50 }), expect.objectContaining({ itemId: "timber", net: 17 })]));
    expect(r.cyclic).toBe(false);
  });

  it("loads work centres against their capacity", () => {
    const l = load([{ operations: [{ workCentreId: "saw", plannedMinutes: 600, actualMinutes: 120, done: false }] }], [{ id: "saw", hoursPerDay: 8 }], 5);
    expect(l[0]).toMatchObject({ minutes: 480, capacity: 2400, pct: 20 });
  });
});
