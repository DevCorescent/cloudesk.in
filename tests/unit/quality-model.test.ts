import { describe, expect, it } from "vitest";
import { judge, passes, planFor, sampleCount } from "@/lib/quality/model";

const params = [
  { id: "len", name: "Length", kind: "measure" as const, min: 99.5, max: 100.5, unit: "mm" },
  { id: "finish", name: "Finish", kind: "check" as const, min: null, max: null, unit: "" },
];

describe("quality", () => {
  it("takes samples by count or percentage, never more than the lot", () => {
    expect(sampleCount({ sampleSize: 5, samplePct: 0 }, 100)).toBe(5);
    expect(sampleCount({ sampleSize: 5, samplePct: 2 }, 950)).toBe(19);
    expect(sampleCount({ sampleSize: 5, samplePct: 0 }, 3)).toBe(3);
  });

  it("judges readings against limits and the acceptance number", () => {
    expect(passes(params[0], 100.4)).toBe(true);
    expect(passes(params[0], 100.6)).toBe(false);
    expect(passes(params[1], false)).toBe(false);
    expect(passes(params[0], null)).toBe(false);
    const samples = [{ len: 100, finish: true }, { len: 101, finish: true }, { len: 100.2, finish: false }, { len: 99.9, finish: true }];
    expect(judge(params, samples, 1)).toMatchObject({ defective: 2, passed: false, byParameter: { len: 1, finish: 1 } });
    expect(judge(params, samples, 2).passed).toBe(true);
  });

  it("finds the item's own plan before its category's", () => {
    const plans = [{ id: "cat", itemId: null, category: "Packaging", stage: "receipt", active: true }, { id: "own", itemId: "box", category: "", stage: "receipt", active: true }];
    expect(planFor(plans, { id: "box", category: "Packaging" }, "receipt")?.id).toBe("own");
    expect(planFor(plans, { id: "tape", category: "packaging" }, "receipt")?.id).toBe("cat");
    expect(planFor(plans, { id: "tape", category: "packaging" }, "production")).toBeNull();
  });
});
