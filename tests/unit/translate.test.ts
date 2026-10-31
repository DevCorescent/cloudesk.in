import { describe, expect, it } from "vitest";
import { applyTexts, checkTranslations, chunkTexts, collectTexts } from "@/lib/site/translate";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

function withHindi() {
  const doc = storeSiteDoc(STORE_TEMPLATES[0]);
  const home = structuredClone(doc.pages[0]);
  const hi = { ...home, id: "p_hi", path: "/hi", lang: "hi", translationOf: home.id, needsTranslation: true, sections: home.sections.map((x) => ({ ...x, id: `${x.id}_hi` })) };
  doc.pages.push(hi);
  return doc;
}

describe("translation by field", () => {
  it("collects only prose from the target language, never names, links or prices", () => {
    const doc = withHindi();
    const items = collectTexts(doc, "hi");
    expect(items.length).toBeGreaterThan(10);
    expect(items.every((i) => i.key.startsWith("p:p_hi|") || i.key.startsWith("s:p_hi:"))).toBe(true);
    const keys = items.map((i) => i.key);
    expect(keys.some((k) => k.endsWith("|heading"))).toBe(true);
    expect(keys.some((k) => /\|items\.\d+\.question$/.test(k))).toBe(true);
    expect(keys.some((k) => k.endsWith("|brand"))).toBe(false);
    expect(items.some((i) => /^https?:/.test(i.text))).toBe(false);
    expect(collectTexts(doc, "fr")).toEqual([]);
  });

  it("writes translations back into the same fields without touching structure", () => {
    const doc = withHindi();
    const before = JSON.stringify(doc.pages[0]);
    const items = collectTexts(doc, "hi");
    const answer = Object.fromEntries(items.map((i) => [i.key, `हिंदी ${i.text}`]));
    const out = structuredClone(doc);
    expect(applyTexts(out, "hi", answer)).toBe(items.length);
    const hi = out.pages.find((p) => p.id === "p_hi")!;
    expect(hi.needsTranslation).toBeUndefined();
    expect(hi.sections.map((s) => s.type)).toEqual(doc.pages[1].sections.map((s) => s.type));
    expect(hi.sections.find((s) => s.type === "hero")!.props.heading).toMatch(/^हिंदी /);
    expect(hi.sections.find((s) => s.type === "hero")!.props.primaryHref).toBe("/shop");
    expect(JSON.stringify(out.pages[0])).toBe(before);
    // Keys that don't exist are ignored.
    expect(applyTexts(structuredClone(doc), "hi", { "s:p_hi:nope|heading": "x", "garbage": "y" })).toBe(0);
  });

  it("rejects incomplete or marked-up answers and chunks long sites", () => {
    const items = [{ key: "a", text: "Hello" }, { key: "b", text: "World" }];
    expect(checkTranslations(items, { a: "नमस्ते", b: "दुनिया" })).toEqual([]);
    expect(checkTranslations(items, { a: "नमस्ते" })[0]).toContain('Missing translation for "b"');
    expect(checkTranslations(items, { a: "x", b: "y", c: "z" })[0]).toContain('Unexpected key "c"');
    expect(checkTranslations(items, { a: "<b>x</b>", b: "y" })[0]).toContain("HTML");
    const many = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, text: "x".repeat(1000) }));
    const chunks = chunkTexts(many, 12_000);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.flat()).toHaveLength(50);
  });
});
