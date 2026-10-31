import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/site/color";
import { harmonize, PALETTES, PERSONALITIES, themeFor } from "@/lib/site/design";
import { PHOTOS } from "@/lib/site/media";
import { siteDocSchema } from "@/lib/site/model";
import { composeSite, industryFor, planFromBrief } from "@/lib/site/planner";
import { renderPage } from "@/lib/site/render";
import { TEMPLATES, templateSpec } from "@/lib/site/templates";

const pub = { kind: "publish" as const, basePath: "", formAction: () => "#" };

const EXPECTED: Record<string, [string, string]> = {
  app: ["Mobile app", "glass"],
  dental: ["Medical clinic", "minimal"],
  law: ["Law firm", "corporate"],
  accounting: ["Accounting & finance", "corporate"],
  photography: ["Photography", "editorial"],
  wedding: ["Weddings & events", "editorial"],
  hotel: ["Hotel", "luxury"],
  travel: ["Travel", "organic"],
  jewellery: ["Jewellery", "luxury"],
  fashion: ["Fashion", "minimal"],
  architecture: ["Architecture & interiors", "editorial"],
  music: ["Music & entertainment", "dark-tech"],
  automotive: ["Automotive", "bold"],
  homeservices: ["Home services", "bold"],
  petcare: ["Pet care", "friendly"],
  nonprofit: ["Nonprofit", "friendly"],
};

describe("industry templates", () => {
  it("every template builds a valid site in its intended industry and look", () => {
    for (const t of TEMPLATES) {
      const spec = templateSpec(t);
      const doc = composeSite(spec);
      expect(siteDocSchema.safeParse(doc).success, t.id).toBe(true);
      if (EXPECTED[t.id]) expect([spec.industry, spec.personality], t.id).toEqual(EXPECTED[t.id]);
      // Headings never get doubled punctuation from names like "Waggle & Co.".
      expect(JSON.stringify(doc), t.id).not.toMatch(/\.\. /);
    }
  });

  it("uses only on-topic placeholder photos", () => {
    for (const id of Object.keys(EXPECTED)) {
      const spec = templateSpec(TEMPLATES.find((t) => t.id === id)!);
      const tags = industryFor(spec.industry).photoTags;
      const used = JSON.stringify(composeSite(spec)).match(/photo-[\w-]+/g) ?? [];
      expect(used.length, id).toBeGreaterThan(0);
      for (const u of used) expect(PHOTOS.find((p) => u === `photo-${p.id}`)!.tags.some((t) => tags.includes(t)), `${id} ${u}`).toBe(true);
    }
  });

  it("puts a booking form wherever the main button asks for a booking, with fitting words", () => {
    const hotel = composeSite(templateSpec(TEMPLATES.find((t) => t.id === "hotel")!));
    const booking = hotel.pages[0].sections.find((s) => s.type === "booking")!;
    expect(booking.props).toMatchObject({ heading: "Check availability", buttonLabel: "Request dates" });
    const garage = composeSite(templateSpec(TEMPLATES.find((t) => t.id === "automotive")!));
    expect(garage.pages[0].sections.some((s) => s.type === "menu")).toBe(false);
    expect(garage.pages[0].sections.find((s) => s.type === "pricing")!.props.heading).toBe("Service menu");
  });

  it("routes specific briefs before general ones", () => {
    expect(planFromBrief("A wedding photographer in Goa").industry).toBe("Photography");
    expect(planFromBrief("A boutique hotel by the sea").industry).toBe("Hotel");
    expect(planFromBrief("An automation platform for finance teams").industry).not.toBe("Automotive");
    expect(planFromBrief("A record label for indie artists").industry).toBe("Music & entertainment");
    expect(planFromBrief("Bride and groom wedding planning").industry).toBe("Weddings & events");
  });

  it("lets the person choose another look, and ignores unknown ones", () => {
    const t = TEMPLATES.find((x) => x.id === "restaurant")!;
    expect(templateSpec(t, undefined, "glass").personality).toBe("glass");
    expect(templateSpec(t, undefined, "not-a-look").personality).toBe(templateSpec(t).personality);
  });
});

describe("themes", () => {
  it("every palette meets AA contrast once harmonised", () => {
    for (const p of PALETTES) {
      const h = harmonize(p);
      expect(contrast(h.text, h.background), p.id).toBeGreaterThanOrEqual(7);
      expect(contrast(h.muted, h.background), p.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(h.accentText, h.accent), p.id).toBeGreaterThanOrEqual(4.5);
    }
    for (const d of PERSONALITIES) for (const id of d.palettes) expect(PALETTES.some((p) => p.id === id), `${d.id} → ${id}`).toBe(true);
  });

  it("the glass look renders frosted surfaces with CSS only, and solid themes don't", () => {
    const doc = composeSite(templateSpec(TEMPLATES.find((x) => x.id === "app")!));
    expect(doc.theme.surface).toBe("glass");
    const html = renderPage(doc, doc.pages[0], pub);
    expect(html).toContain("backdrop-filter:blur(24px) saturate(1.8)");
    expect(html).not.toContain("<script");
    expect(themeFor("modern").surface).toBeUndefined();
    const solid = composeSite(templateSpec(TEMPLATES.find((x) => x.id === "saas")!));
    expect(renderPage(solid, solid.pages[0], pub)).not.toContain("backdrop-filter:blur(24px)");
  });
});
