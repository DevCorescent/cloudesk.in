import { describe, expect, it } from "vitest";
import { canAct, fill, matches, policySchema, stepDone, stepsFor, type Step } from "@/lib/approvals/model";

const step = (p: Partial<Step>): Step => ({ name: "S", mode: "any", approvers: [], minAmount: null, slaHours: null, escalateTo: [], ...p });

describe("approval rules", () => {
  it("matches policies by amount and department", () => {
    const c = { minAmount: 1000, maxAmount: 5000, departmentIds: ["d1"] };
    expect(matches(c, { amount: 2000, departmentId: "d1" })).toBe(true);
    expect(matches(c, { amount: 999, departmentId: "d1" })).toBe(false);
    expect(matches(c, { amount: 5001, departmentId: "d1" })).toBe(false);
    expect(matches(c, { amount: 2000, departmentId: "d2" })).toBe(false);
    expect(matches(c, { amount: 2000, departmentId: null })).toBe(false);
    expect(matches({ minAmount: null, maxAmount: null, departmentIds: [] }, { amount: 0, departmentId: null })).toBe(true);
  });

  it("only includes steps whose threshold the amount reaches", () => {
    const steps = [step({ name: "a" }), step({ name: "b", minAmount: 100 })];
    expect(stepsFor(steps, 50).map((s) => s.name)).toEqual(["a"]);
    expect(stepsFor(steps, 100).map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("needs one slot for 'any' and every slot for 'all'", () => {
    const approvers = [{ type: "user" as const, userId: "00000000-0000-4000-8000-000000000001", limit: null }, { type: "role" as const, role: "billing" as const, limit: null }];
    const slots = [["u1"], ["u2", "u3"]];
    expect(stepDone(step({ approvers, mode: "any" }), slots, new Set(["u3"]), 10)).toBe(true);
    expect(stepDone(step({ approvers, mode: "all" }), slots, new Set(["u3"]), 10)).toBe(false);
    expect(stepDone(step({ approvers, mode: "all" }), slots, new Set(["u3", "u1"]), 10)).toBe(true);
  });

  it("caps an approver at their limit", () => {
    const s = step({ approvers: [{ type: "role", role: "admin", limit: 1000 }] });
    expect(canAct(s, [["u1"]], new Set(), 1000, "u1")).toBe(true);
    expect(canAct(s, [["u1"]], new Set(), 1001, "u1")).toBe(false);
    expect(stepDone(s, [["u1"]], new Set(["u1"]), 1001)).toBe(false);
  });

  it("needs different people for each slot of an 'all' step", () => {
    const s = step({ mode: "all", approvers: [{ type: "role", role: "admin", limit: null }, { type: "role", role: "owner", limit: null }] });
    const slots = [["a", "b"], ["o", "a"]];
    // "a" is in both slots but fills only one; the step needs a second person.
    expect(stepDone(s, slots, new Set(["a"]), 1)).toBe(false);
    expect(canAct(s, slots, new Set(["a"]), 1, "a")).toBe(false);
    // "b" counts: "a" moves to the owner slot and "b" takes the admin one.
    expect(canAct(s, slots, new Set(["a"]), 1, "b")).toBe(true);
    expect(canAct(s, slots, new Set(["a"]), 1, "o")).toBe(true);
    expect(stepDone(s, slots, new Set(["a", "b"]), 1)).toBe(true);
    expect(canAct(s, slots, new Set(["a", "b"]), 1, "o")).toBe(false);
  });

  it("validates policies and fills wording", () => {
    expect(policySchema.safeParse({ kind: "acc.bill", name: "x", steps: [] }).success).toBe(false);
    expect(policySchema.safeParse({ kind: "nope", name: "x", steps: [{ name: "a", approvers: [{ type: "manager" }] }] }).success).toBe(false);
    expect(policySchema.parse({ kind: "hr.claim", name: "x", steps: [{ name: "a", approvers: [{ type: "manager" }] }] }).steps[0]).toMatchObject({ mode: "any", minAmount: null });
    expect(fill("Hi {{ name }}, {{missing}}see {{link}}", { name: "Asha", link: "/x" })).toBe("Hi Asha, see /x");
  });
});
