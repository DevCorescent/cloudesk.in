import { describe, expect, it } from "vitest";
import { BUSINESSES } from "@/components/marketing/businesses";
import { TEMPLATES } from "@/lib/site/templates";
import { STORE_TEMPLATES } from "@/lib/store/templates";
import { collectionForIndustry, sampleFor, TEMPLATE_COLLECTIONS } from "@/lib/templates/collections";
import { INDUSTRIES } from "@/lib/workspace/modules";

describe("template collections", () => {
  it("has five real, distinct templates for every business page", () => {
    expect(TEMPLATE_COLLECTIONS.map((c) => c.id).sort()).toEqual(BUSINESSES.map((b) => b.slug).sort());
    for (const c of TEMPLATE_COLLECTIONS) {
      expect(c.items, c.id).toHaveLength(5);
      expect(new Set(c.items.map((i) => `${i.kind}:${i.id}`)).size, c.id).toBe(5);
      for (const i of c.items) {
        const found = i.kind === "site" ? TEMPLATES.some((t) => t.id === i.id) : STORE_TEMPLATES.some((t) => t.id === i.id);
        expect(found, `${c.id} → ${i.kind}:${i.id}`).toBe(true);
      }
      expect(STORE_TEMPLATES.some((t) => t.id === c.sample), `${c.id} sample`).toBe(true);
    }
  });

  it("maps each onboarding industry to at most one collection", () => {
    for (const ind of INDUSTRIES) expect(TEMPLATE_COLLECTIONS.filter((c) => c.industries.includes(ind.id)).length, ind.id).toBeLessThanOrEqual(1);
    expect(collectionForIndustry("restaurant")?.id).toBe("restaurants-hotels");
    expect(sampleFor("salon")).toBe("beauty");
    expect(sampleFor(null)).toBe("gifts");
  });
});
