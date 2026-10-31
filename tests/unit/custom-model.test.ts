import { describe, expect, it } from "vitest";
import { brokenRules, checkValues, coerce, evalCond, fieldDefSchema, importTarget, unknownRefs } from "@/lib/custom/model";

const f = (type: string, options: string[] = []) => ({ type, options, label: "F" }) as Parameters<typeof coerce>[0];

describe("custom field values", () => {
  it("cleans each type to how it's stored", () => {
    expect(coerce(f("number"), "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(coerce(f("money"), 129900.4)).toEqual({ ok: true, value: 129900 });
    expect(coerce(f("date"), "2026-02-30").ok).toBe(false);
    expect(coerce(f("date"), "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(coerce(f("checkbox"), "Y")).toEqual({ ok: true, value: true });
    expect(coerce(f("select", ["Red", "Blue"]), "blue")).toEqual({ ok: true, value: "Blue" });
    expect(coerce(f("multiselect", ["Red", "Blue"]), "blue, red, Blue")).toEqual({ ok: true, value: ["Blue", "Red"] });
    expect(coerce(f("multiselect", ["Red"]), "Green").ok).toBe(false);
    expect(coerce(f("url"), "ftp://x.com").ok).toBe(false);
    expect(coerce(f("phone"), "+91 98765-43210")).toEqual({ ok: true, value: "+919876543210" });
    expect(coerce(f("email"), " A@B.co ")).toEqual({ ok: true, value: "a@b.co" });
    expect(coerce(f("text"), "")).toEqual({ ok: true, value: null });
  });

  it("checks required fields, unknown keys and partial saves", () => {
    const defs = [{ key: "a", label: "A", type: "text", options: [], required: true }, { key: "b", label: "B", type: "number", options: [], required: false }] as Parameters<typeof checkValues>[0];
    expect(checkValues(defs, { b: 2 }).errors).toEqual({ a: "A is needed" });
    expect(checkValues(defs, { b: 2 }, { partial: true })).toEqual({ values: { b: 2 }, errors: {} });
    expect(checkValues(defs, { c: 1 }, { partial: true }).errors).toEqual({ c: `There's no field "c"` });
  });

  it("needs choices for a list field and a target for a link", () => {
    expect(fieldDefSchema.safeParse({ key: "k", label: "K", type: "select" }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: "k", label: "K", type: "select", options: ["a", "A"] }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: "k", label: "K", type: "link" }).success).toBe(false);
    expect(fieldDefSchema.safeParse({ key: "1k", label: "K", type: "text" }).success).toBe(false);
  });
});

describe("rules", () => {
  const rec = { grade: "A", months: 6, tags: ["Fragile"], due: "2026-01-01", paid: false, other: 10 };
  it("evaluates conditions", () => {
    expect(evalCond({ field: "grade", op: "eq", value: "a" }, rec)).toBe(true);
    expect(evalCond({ field: "months", op: "gte", value: 12 }, rec)).toBe(false);
    expect(evalCond({ field: "months", op: "lt", value: "@other" }, rec)).toBe(true);
    expect(evalCond({ field: "tags", op: "contains", value: "fragile" }, rec)).toBe(true);
    expect(evalCond({ field: "grade", op: "in", value: ["B", "A"] }, rec)).toBe(true);
    expect(evalCond({ field: "due", op: "lt", value: "today" }, rec)).toBe(true);
    expect(evalCond({ field: "paid", op: "eq", value: true }, rec)).toBe(false);
    expect(evalCond({ field: "missing", op: "empty", value: null }, rec)).toBe(true);
    // Comparing with nothing is never true.
    expect(evalCond({ field: "missing", op: "lt", value: 5 }, rec)).toBe(false);
  });

  it("reports only active rules that apply and fail", () => {
    const rules = [
      { when: [{ field: "grade", op: "eq" as const, value: "A" }], then: [{ field: "months", op: "gte" as const, value: 12 }], message: "A needs 12" },
      { when: [{ field: "grade", op: "eq" as const, value: "B" }], then: [{ field: "months", op: "gte" as const, value: 99 }], message: "B needs 99" },
      { when: [], then: [{ field: "paid", op: "eq" as const, value: true }], message: "Pay first", active: false },
    ];
    expect(brokenRules(rules, rec)).toEqual(["A needs 12"]);
    expect(unknownRefs({ when: [], then: [{ field: "a", op: "lt", value: "@b" }] }, new Set(["a"]))).toEqual(["b"]);
  });

  it("builds an import target with a match column", () => {
    const t = importTarget("x", "Items", "item", [{ key: "grade", label: "Grade", type: "select", options: ["A"], required: true, help: "", linkTo: null, sort: 0 }], { key: "__match", label: "SKU" });
    expect(t.fields.map((x) => [x.key, x.type, x.required])).toEqual([["__match", "text", true], ["grade", "enum", false]]);
  });
});
