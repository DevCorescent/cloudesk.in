import { describe, expect, it } from "vitest";
import { siteDocSchema } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

const pub = { kind: "publish" as const, basePath: "", formAction: () => "#" };

describe("section motion", () => {
  it("renders entrance, stagger, hover and parallax as CSS, wrapped for reduced motion", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    const hero = doc.pages[0].sections.find((s) => s.type === "hero")!;
    hero.style.motion = { entrance: "zoom", speed: "slow", stagger: true, hover: "lift", parallax: true };
    const valid = siteDocSchema.parse(doc);
    const html = renderPage(valid, valid.pages[0], pub);
    expect(html).toContain("@keyframes cc-zoom");
    expect(html).toContain("entry 0% entry 90%");
    expect(html).toContain("@keyframes cc-parallax");
    expect(html).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{@supports \(animation-timeline:view\(\)\)/);
    expect(html).toContain(":hover{transform:translateY(-4px)");
    expect(html).not.toContain("<script");
  });

  it("can switch animation off for one section, and leaves the editor still", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    const grid = doc.pages[0].sections.find((s) => s.type === "productGrid")!;
    grid.style.motion = { entrance: "none", speed: "normal", stagger: true, hover: "glow", parallax: false };
    const html = renderPage(doc, doc.pages[0], pub);
    const off = "animation:none!important;opacity:1!important;transform:none!important;filter:none!important";
    expect(html).toContain(off);
    const editor = renderPage(doc, doc.pages[0], { kind: "editor", selectedId: null });
    expect(editor).not.toContain(off);
    expect(editor).not.toContain("cc-glow");
  });
});
