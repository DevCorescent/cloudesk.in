import { describe, expect, it } from "vitest";
import { FEATURES } from "@/components/marketing/features";
import { MENU_FEATURE, MENU_SECTIONS, PRODUCT_GROUPS, searchSite, shortName } from "@/components/marketing/nav";

describe("marketing navigation", () => {
  it("puts every feature page in exactly one menu category", () => {
    const slugs = PRODUCT_GROUPS.flatMap((g) => g.slugs);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual(FEATURES.map((f) => f.slug).sort());
  });

  it("splits each menu category into sections without losing or repeating a feature", () => {
    for (const g of PRODUCT_GROUPS) {
      const slugs = (MENU_SECTIONS[g.id] ?? []).flatMap((s) => s.slugs);
      expect([...slugs].sort(), g.id).toEqual([...g.slugs].sort());
      expect(MENU_FEATURE[g.id], g.id).toBeDefined();
    }
  });

  it("drops the brand prefix for compact menus", () => {
    expect(shortName("Cloudesk CRM")).toBe("CRM");
    expect(shortName("Cloudesk for Horeca")).toBe("Horeca");
    expect(shortName("Online store")).toBe("Online store");
  });

  it("finds features, industries and pages, best match first", () => {
    expect(searchSite("invoic")[0]?.href).toBe("/features/invoicing");
    expect(searchSite("restaurant").some((e) => e.kind === "Industry")).toBe(true);
    expect(searchSite("sign up")[0]?.href).toBe("/start");
    expect(searchSite("zzzz")).toEqual([]);
    expect(searchSite("  ")).toEqual([]);
  });
});
