import { describe, expect, it } from "vitest";
import { bannedIn, brandIssues, lockViolations, voicePrompt, type BrandRules } from "@/lib/site/brand-rules";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

const base: BrandRules = { lockPalette: false, palette: null, lockFonts: false, font: null, headingFont: null, lockLogo: false, logo: null, voice: "", bannedWords: [], preferredTerms: [] };
const doc = () => storeSiteDoc(STORE_TEMPLATES[0]);

describe("brand rules", () => {
  it("matches whole words and phrases, case-insensitively, in any script", () => {
    expect(bannedIn("Our CHEAP deals", ["cheap"])).toEqual(["cheap"]);
    expect(bannedIn("Cheapest prices", ["cheap"])).toEqual([]);
    expect(bannedIn("A world-class team", ["world-class"])).toEqual(["world-class"]);
    expect(bannedIn("best in class service", ["best in class"])).toEqual(["best in class"]);
    expect(bannedIn("सस्ता सामान", ["सस्ता"])).toEqual(["सस्ता"]);
    expect(bannedIn("price (cheap)", ["cheap"])).toEqual(["cheap"]);
  });

  it("refuses changes to locked colours and fonts, but allows keeping or restoring them", () => {
    const before = doc();
    const rules = { ...base, lockPalette: true, palette: before.theme.palette, lockFonts: true, font: before.theme.font, headingFont: before.theme.headingFont };
    const recolor = doc();
    recolor.theme.palette = { ...recolor.theme.palette, accent: "#ff0000" };
    expect(lockViolations(before, recolor, rules, { ai: false })).toEqual(["The brand colours are locked."]);
    const copy = doc();
    copy.pages[0].sections[1].props.brand = "New name";
    expect(lockViolations(before, copy, rules, { ai: false })).toEqual([]);
    // A site that drifted before the lock may keep its state, and may be restored.
    expect(lockViolations(recolor, recolor, rules, { ai: false })).toEqual([]);
    expect(lockViolations(recolor, before, rules, { ai: false })).toEqual([]);
    const refont = doc();
    refont.theme.font = refont.theme.font === "serif" ? "sans" : "serif";
    expect(lockViolations(before, refont, rules, { ai: false })).toEqual(["The brand fonts are locked."]);
  });

  it("refuses AI changes that add banned words, while people only get warnings", () => {
    const rules = { ...base, bannedWords: ["cheap"], preferredTerms: [{ avoid: "customers", use: "guests" }] };
    const before = doc();
    const after = doc();
    after.pages[0].sections.find((s) => s.type === "hero")!.props.heading = "Cheap clothes for customers";
    expect(lockViolations(before, after, rules, { ai: true })[0]).toContain("“cheap”");
    expect(lockViolations(before, after, rules, { ai: false })).toEqual([]);
    const issues = brandIssues(after, rules);
    expect(issues.map((i) => i.kind).sort()).toEqual(["banned", "preferred"]);
    expect(issues[0].field).toContain("Hero");
  });

  it("checks A/B test copy too, and describes the voice for the AI", () => {
    const d = doc();
    const hero = d.pages[0].sections.find((s) => s.type === "hero")!;
    hero.ab = { variant: "", running: true, props: { heading: "Cheap stuff" } };
    expect(brandIssues(d, { ...base, bannedWords: ["cheap"] })).toHaveLength(1);
    const p = voicePrompt({ ...base, voice: "Warm and plain.", bannedWords: ["cheap"], lockPalette: true, palette: d.theme.palette });
    expect(p).toContain("Warm and plain.");
    expect(p).toContain('"cheap"');
    expect(p).toContain("the colour palette");
    expect(voicePrompt(base)).toBe("");
  });
});
