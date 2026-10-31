import { describe, expect, it } from "vitest";
import { colorsFromCss, fontsFromCss, matchFont, paletteFromColors } from "@/lib/site/brand";
import { contrast } from "@/lib/site/color";
import { createSection, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { composeSite } from "@/lib/site/planner";
import { markdown, renderPage } from "@/lib/site/render";
import { reviewPage } from "@/lib/site/review";
import { TEMPLATES, templateSpec } from "@/lib/site/templates";
import { sniffImage } from "@/server/media/images";
import { isPublicAddress, validateUrl } from "@/server/net/safe-fetch";
import { significance } from "@/server/services/stats";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("image uploads", () => {
  it("detects real image types and dimensions from bytes", () => {
    expect(sniffImage(PNG_1x1)).toEqual({ mime: "image/png", ext: "png", width: 1, height: 1 });
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([3, 0, 2, 0]), Buffer.alloc(10)]);
    expect(sniffImage(gif)).toMatchObject({ mime: "image/gif", width: 3, height: 2 });
  });
  it("rejects SVG, HTML and anything pretending to be an image", () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImage(Buffer.from("not an image at all"))).toBeNull();
  });
});

describe("SSRF protection", () => {
  it("classifies private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("rejects disallowed URLs before any request", () => {
    for (const u of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "ftp://example.com", "http://user:pw@example.com", "http://example.com:8080/", "http://10.0.0.5/", "http://printer.local/"]) {
      expect(() => validateUrl(u), u).toThrow();
    }
    expect(validateUrl("example.com").toString()).toBe("https://example.com/");
  });
});

describe("brand kit", () => {
  it("extracts colours and fonts from CSS", () => {
    const css = `body{color:#111;background:#fff;font-family:"Playfair Display",serif}.btn{background:#e8501f}.btn:hover{background:rgb(232,80,31)}a{color:#e8501f}`;
    const colors = colorsFromCss(css);
    expect(colors.find((c) => c.hex === "#e8501f")?.weight).toBe(3);
    expect(fontsFromCss(css)[0]).toBe("Playfair Display");
    expect(matchFont("Playfair Display")).toBe("playfair");
    expect(matchFont("Roboto")).toBe("inter");
  });
  it("builds an accessible palette with the brand colour as accent", () => {
    const p = paletteFromColors([{ hex: "#e8501f", weight: 10 }, { hex: "#ffffff", weight: 30 }, { hex: "#111111", weight: 20 }]);
    expect(p.background).toBe("#ffffff");
    expect(contrast(p.text, p.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
    const dark = paletteFromColors([{ hex: "#e8501f", weight: 10 }], { dark: true });
    expect(contrast(dark.text, dark.background)).toBeGreaterThanOrEqual(7);
  });
});

describe("design review", () => {
  it("finds problems and every fix keeps the document valid", () => {
    const doc = composeSite(templateSpec(TEMPLATES[1]));
    const page = doc.pages[0];
    const hero = page.sections.find((s) => s.type === "hero")!;
    hero.props.primaryLabel = "";
    hero.variant = "overlay";
    hero.props.image = "";
    page.sections = page.sections.filter((s) => !["cta", "contact", "newsletter", "booking", "pricing", "footer"].includes(s.type));
    page.sections.forEach((s) => s.type !== "navbar" && (s.style.decor = "dots"));
    const findings = reviewPage(doc, page);
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["hero-no-cta", "hero-no-image", "no-closing-cta", "too-much-decor", "no-footer"]));
    for (const f of findings.filter((x) => x.fix)) f.fix!(doc, page.id);
    expect(siteDocSchema.safeParse(doc).success).toBe(true);
    expect(reviewPage(doc, doc.pages[0]).filter((f) => f.fix).length).toBe(0);
  });
});

describe("rendering features", () => {
  const base = composeSite(templateSpec(TEMPLATES[0]));

  it("renders a safe Markdown subset", () => {
    const html = markdown("## Title\n\nHello **bold** and [link](/about) and [bad](javascript:alert(1))\n\n- one\n- two\n\n<script>x</script>", { kind: "preview" });
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain('<a href="/about">link</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).not.toContain("<script>");
  });

  it("emits per-device override CSS", () => {
    const doc = structuredClone(base);
    const s = doc.pages[0].sections[1];
    s.style.overrides = { mobile: { align: "left", textScale: "sm" } };
    const html = renderPage(doc, doc.pages[0], { kind: "preview" });
    expect(html).toMatch(/@media \(max-width:767px\)\{\.s-[\w-]+\{font-size:0\.92em;text-align:left\}/);
  });

  it("renders the B layout only for group B", () => {
    const doc = structuredClone(base);
    const hero = doc.pages[0].sections.find((s) => s.type === "hero")!;
    hero.variant = "centered";
    hero.ab = { variant: "split", running: true };
    const mode = (ab: "A" | "B") => ({ kind: "publish" as const, basePath: "/b", formAction: () => "/f", ab });
    expect(renderPage(doc, doc.pages[0], mode("A"))).toContain("hero-centered");
    expect(renderPage(doc, doc.pages[0], mode("B"))).toContain("hero-split");
    expect(renderPage(doc, doc.pages[0], mode("B"))).toContain('name="_ab" value="B"');
  });

  it("lists blog posts newest first and links translations", () => {
    const doc: SiteDoc = structuredClone(base);
    const posts = createSection("posts");
    doc.pages[0].sections.splice(2, 0, posts);
    doc.pages.push({ id: "p1", path: "/blog/old", title: "Older post", description: "", kind: "post", meta: { date: "2026-01-01" }, sections: [createSection("article")] });
    doc.pages.push({ id: "p2", path: "/blog/new", title: "Newer post", description: "", kind: "post", meta: { date: "2026-06-01" }, sections: [createSection("article")] });
    const home = structuredClone(doc.pages[0]);
    doc.pages.push({ ...home, id: "hi1", path: "/hi", lang: "hi", translationOf: doc.pages[0].id, needsTranslation: true, sections: home.sections.map((s, i) => ({ ...s, id: `hi_${i}` })) });
    expect(siteDocSchema.safeParse(doc).success).toBe(true);
    const html = renderPage(doc, doc.pages[0], { kind: "publish", basePath: "", formAction: () => "/f" });
    expect(html.indexOf("Newer post")).toBeLessThan(html.indexOf("Older post"));
    expect(html).toContain('hreflang="hi"');
    expect(renderPage(doc, doc.pages.find((p) => p.id === "hi1")!, { kind: "preview" })).toContain('<html lang="hi">');
  });

  it("embeds maps only from Google with a sandbox", () => {
    const doc = structuredClone(base);
    const map = createSection("map");
    map.props.address = 'MG Road, Bengaluru"><script>';
    doc.pages[0].sections.splice(1, 0, map);
    const html = renderPage(doc, doc.pages[0], { kind: "preview" });
    expect(html).toContain('src="https://www.google.com/maps?q=MG%20Road%2C%20Bengaluru%22%3E%3Cscript%3E');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups"');
  });
});

describe("A/B significance", () => {
  it("refuses to call small samples and detects clear winners", () => {
    expect(significance({ views: 50, submits: 5 }, { views: 50, submits: 10 }).confidence).toBeNull();
    const r = significance({ views: 2000, submits: 40 }, { views: 2000, submits: 90 });
    expect(r.confidence).toBeGreaterThan(0.99);
    expect(r.verdict).toMatch(/^B is performing better/);
    expect(significance({ views: 1000, submits: 30 }, { views: 1000, submits: 31 }).verdict).toBe("No clear winner yet");
  });
});
