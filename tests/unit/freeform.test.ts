import { describe, expect, it } from "vitest";
import { freeformItems, readingOrder } from "@/lib/site/freeform";
import { collectTexts } from "@/lib/site/translate";
import { createSection, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

const pub = { kind: "publish" as const, basePath: "", formAction: () => "#" };

function withFreeform(props?: Record<string, unknown>): SiteDoc {
  const doc = storeSiteDoc(STORE_TEMPLATES[0]);
  const s = createSection("freeform");
  if (props) s.props = { ...s.props, ...props };
  doc.pages[0].sections.splice(1, 0, s);
  return siteDocSchema.parse(doc);
}

describe("free-form sections", () => {
  it("places each element on the grid with CSS only, in reading order", () => {
    const doc = withFreeform();
    const html = renderPage(doc, doc.pages[0], pub);
    expect(html).toContain('<div class="ff ff-m-stack">');
    expect(html).toMatch(/\.ff-i1\{grid-column:2\/span 6;grid-row:2\/span 3;z-index:2\}/);
    expect(html).toContain(".ff{grid-template-rows:repeat(10,minmax(var(--ff-row),auto))}");
    expect(html).not.toMatch(/<div class="ff-el[^>]*style=/);
    expect(html).not.toContain("<script");
    // The DOM follows reading order: the heading (row 1) before the image (row 2).
    expect(html.indexOf("Make it yours")).toBeLessThan(html.indexOf('class="ff-el ff-i4 ff-image'));
  });

  it("keeps elements inside the grid and escapes text", () => {
    const doc = withFreeform({ rows: 4, items: [{ kind: "heading", text: "<img src=x onerror=alert(1)>", x: 20, y: 9, w: 40, h: 9 }, { kind: "button", text: "Go", href: "javascript:alert(1)", x: 0, y: 0, w: 2, h: 1 }] });
    const items = freeformItems(doc.pages[0].sections[1].props);
    expect(items[0].desktop).toEqual({ x: 11, y: 3, w: 1, h: 1 });
    const html = renderPage(doc, doc.pages[0], pub);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("javascript:");
  });

  it("supports a custom phone layout (unplaced elements hidden); otherwise stacks and hides shapes", () => {
    const stack = renderPage(withFreeform(), withFreeform().pages[0], pub);
    expect(stack).toContain(".ff-m-stack{display:flex;flex-direction:column;gap:16px}.ff-m-stack .ff-shape{display:none}");
    const doc = withFreeform({ mobile: "custom", items: [{ kind: "text", text: "A", x: 0, y: 0, w: 6, h: 2, mx: 1, my: 2, mw: 3, mh: 2 }, { kind: "text", text: "B", x: 6, y: 0, w: 6, h: 2 }] });
    const html = renderPage(doc, doc.pages[0], pub);
    expect(html).toMatch(/@media \(max-width:767px\)\{\.[\w-]+ \.ff\{grid-template-rows:repeat\(4,[^}]+\}\.[\w-]+ \.ff-i0\{grid-column:2\/span 3;grid-row:3\/span 2\}\.[\w-]+ \.ff-i1\{display:none\}\}/);
  });

  it("orders by row then column, and its text is translatable", () => {
    const items = freeformItems({ items: [{ text: "c", x: 6, y: 2 }, { text: "a", x: 0, y: 0 }, { text: "b", x: 4, y: 0 }] });
    expect(readingOrder(items).map((i) => i.text)).toEqual(["a", "b", "c"]);
    const texts = collectTexts(withFreeform(), "en");
    expect(texts.map((t) => t.text)).toContain("Make it yours");
  });
});
