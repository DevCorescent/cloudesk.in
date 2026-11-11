import { describe, expect, it } from "vitest";
import { CATEGORIES, DOC_KINDS, FORMS, generateSchema, kindById, planSchema } from "@/lib/documents/studio";

// The studio's catalogue holds together: unique kinds in known categories and
// layouts, every kind asks something, agreements carry the boilerplate a
// professional contract needs, and the request checks behave.
describe("the document studio catalogue", () => {
  it("has unique kinds, each in a known category and layout, with questions", () => {
    const ids = DOC_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DOC_KINDS.length).toBeGreaterThanOrEqual(80);
    for (const k of DOC_KINDS) {
      expect(CATEGORIES.some((c) => c.id === k.category), k.id).toBe(true);
      expect(FORMS, k.id).toContain(k.form);
      expect(k.questions.length, k.id).toBeGreaterThan(0);
      expect(new Set(k.questions.map((q) => q.key)).size, `${k.id} question keys`).toBe(k.questions.length);
      for (const q of k.questions) if (q.type === "select") expect(q.options?.length, `${k.id}.${q.key}`).toBeGreaterThan(1);
    }
    for (const c of CATEGORIES) expect(DOC_KINDS.some((k) => k.category === c.id), c.id).toBe(true);
  });

  it("holds agreements to the contract standard", () => {
    const contracts = DOC_KINDS.filter((k) => k.category === "legal" && k.form === "contract");
    expect(contracts.length).toBeGreaterThan(15);
    for (const k of contracts) {
      expect(k.clauses.some((c) => /Governing law|governing/i.test(c)), `${k.id} governing law`).toBe(true);
      expect(k.clauses.some((c) => /signature|Execution/i.test(c)), `${k.id} signatures`).toBe(true);
      expect(k.laws, k.id).toContain("Indian Contract Act, 1872");
    }
    expect(kindById("nda-mutual")?.clauses).toContain("Remedies including injunctive relief (Specific Relief Act)");
    expect(kindById("posh-policy")?.laws.join(" ")).toMatch(/Sexual Harassment of Women at Workplace/);
    expect(kindById("nope")).toBeUndefined();
  });

  it("checks requests: a plan needs words or a kind; a draft gets sensible defaults", () => {
    expect(planSchema.safeParse({}).success).toBe(false);
    expect(planSchema.safeParse({ prompt: "An NDA" }).success).toBe(true);
    const g = generateSchema.parse({ kindId: "nda-mutual" });
    expect(g).toMatchObject({ root: "mine", folderId: null, options: { language: "English", tone: "Formal", detail: "Standard", favour: "Favour us", state: "" } });
    expect(generateSchema.safeParse({ kindId: "nda-mutual", options: { language: "Klingon" } }).success).toBe(false);
  });
});
