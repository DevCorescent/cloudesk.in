import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/site/color";
import { DESIGN_ACTIONS, harmonize, PALETTES, PERSONALITIES, themeFor } from "@/lib/site/design";
import { diagnose } from "@/lib/site/diagnostics";
import { FONT_PAIRS, FONTS } from "@/lib/site/fonts";
import { ICON_NAMES } from "@/lib/site/icons";
import { createSection, parseSiteDoc, SECTION_DEFS, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { renderPage } from "@/lib/site/render";
import { TEMPLATES, templateSpec } from "@/lib/site/templates";

const AA = 4.5;

describe("palettes", () => {
  it("every curated palette meets WCAG AA once harmonized", () => {
    for (const p of PALETTES) {
      const h = harmonize(p);
      expect(contrast(h.text, h.background), p.id).toBeGreaterThanOrEqual(7);
      expect(contrast(h.muted, h.background), p.id).toBeGreaterThanOrEqual(AA);
      expect(contrast(h.muted, h.surface), p.id).toBeGreaterThanOrEqual(AA);
      expect(contrast(h.accentText, h.accent), p.id).toBeGreaterThanOrEqual(AA);
    }
  });

  it("fixes an unreadable palette", () => {
    const bad = { background: "#ffffff", surface: "#f5f5f5", text: "#cccccc", muted: "#dddddd", accent: "#ffee00", accentText: "#ffffff" };
    const h = harmonize(bad);
    expect(contrast(h.text, h.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(h.accentText, h.accent)).toBeGreaterThanOrEqual(AA);
  });

  it("every personality references real palettes and font pairings", () => {
    for (const p of PERSONALITIES) {
      for (const id of p.palettes) expect(PALETTES.some((x) => x.id === id), `${p.id}:${id}`).toBe(true);
      for (const id of p.fontPairs) expect(FONT_PAIRS.some((x) => x.id === id), `${p.id}:${id}`).toBe(true);
    }
    for (const f of FONT_PAIRS) {
      expect(FONTS[f.heading]).toBeDefined();
      expect(FONTS[f.body]).toBeDefined();
    }
  });
});

describe("composition", () => {
  it("every template in every direction produces a valid, renderable site", () => {
    for (const t of TEMPLATES) {
      for (const p of PERSONALITIES) {
        const doc = composeSite(templateSpec(t), { personality: p.id });
        expect(siteDocSchema.safeParse(doc).success, `${t.id}/${p.id}`).toBe(true);
        for (const page of doc.pages) {
          const html = renderPage(doc, page, { kind: "publish", basePath: "/b", formAction: () => "/f" });
          expect(html).not.toContain("<script");
          expect(html).toContain("<h1");
        }
        const errors = diagnose(doc).filter((d) => d.severity === "error" && d.category !== "content");
        expect(errors, `${t.id}/${p.id}`).toEqual([]);
      }
    }
  });

  it("chooses a fitting direction from the brief", () => {
    expect(planFromBrief("A luxury day spa with treatments").personality).toBe("luxury");
    expect(planFromBrief("A developer API platform for AI agents").personality).toBe("dark-tech");
    expect(planFromBrief("A bold gym for athletes").personality).toBe("bold");
    expect(planFromBrief("A minimal brand store for ceramics").industry).toBe("Retail");
  });

  it("loads web fonts only from the pinned CDN", () => {
    const doc = composeSite(templateSpec(TEMPLATES[0]), { personality: "luxury" });
    const html = renderPage(doc, doc.pages[0], { kind: "preview" });
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource(-variable)?\/[a-z-]+@5\.3\.0\/index\.css$/);
  });

  it("marks example figures so they block production until edited", () => {
    const doc = composeSite(templateSpec(TEMPLATES.find((t) => t.id === "fitness")!));
    const stats = doc.pages[0].sections.find((s) => s.type === "stats")!;
    expect(stats.props._example).toBe(true);
    expect(diagnose(doc).some((d) => d.severity === "error" && d.sectionId === stats.id)).toBe(true);
  });
});

describe("variants", () => {
  it("every section type renders every variant safely", () => {
    const base = composeSite(templateSpec(TEMPLATES[0]));
    for (const def of SECTION_DEFS) {
      for (const v of def.variants ?? []) {
        const s = createSection(def.type);
        s.variant = v.value;
        // Inject markup into every string prop to prove escaping.
        for (const k of Object.keys(s.props)) if (typeof s.props[k] === "string") s.props[k] = `<img src=x onerror=alert(1)>${k}`;
        const doc: SiteDoc = { ...base, pages: [{ ...base.pages[0], sections: [s] }] };
        const html = renderPage(doc, doc.pages[0], { kind: "preview" });
        expect(html, `${def.type}/${v.value}`).not.toContain("<img src=x");
      }
    }
  });

  it("only uses icons that exist", () => {
    for (const t of TEMPLATES) {
      const doc = composeSite(templateSpec(t));
      for (const s of doc.pages.flatMap((p) => p.sections)) {
        for (const it of (s.props.items as { icon?: string }[] | undefined) ?? []) if (it.icon) expect(ICON_NAMES, it.icon).toContain(it.icon);
      }
    }
  });
});

describe("design actions", () => {
  it("every action keeps the document valid and readable", () => {
    for (const p of PERSONALITIES) {
      for (const a of DESIGN_ACTIONS) {
        const doc = composeSite(templateSpec(TEMPLATES[1]), { personality: p.id });
        a.apply(doc);
        expect(siteDocSchema.safeParse(doc).success, `${p.id}/${a.id}`).toBe(true);
        expect(contrast(doc.theme.palette.text, doc.theme.palette.background), `${p.id}/${a.id}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

describe("compatibility", () => {
  it("still opens documents saved before design tokens existed", () => {
    const legacy = {
      version: 1,
      name: "Old site",
      theme: { palette: { background: "#ffffff", surface: "#f5f5f4", text: "#1c1917", muted: "#57534e", accent: "#1c1917", accentText: "#ffffff" }, font: "sans", headingFont: "serif", radius: "md", density: "comfortable" },
      pages: [{ id: "p1", path: "/", title: "Home", sections: [{ id: "s1", type: "hero", props: { heading: "Hi" }, style: { background: "default", align: "center", paddingY: "md", hideOn: [] } }] }],
    };
    const r = parseSiteDoc(JSON.stringify(legacy));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.theme.buttonStyle).toBe("solid");
      expect(r.doc.pages[0].sections[0].style.decor).toBe("none");
    }
  });

  it("themeFor is deterministic per seed", () => {
    expect(themeFor("modern", { seed: 1 })).toEqual(themeFor("modern", { seed: 1 }));
    expect(themeFor("modern", { seed: 1 }).palette).not.toEqual(themeFor("modern", { seed: 2 }).palette);
  });
});
