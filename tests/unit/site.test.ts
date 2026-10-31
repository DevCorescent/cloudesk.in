import { describe, expect, it } from "vitest";
import { contrast, isDark } from "@/lib/site/color";
import { runCommand } from "@/lib/site/commands";
import { diagnose } from "@/lib/site/diagnostics";
import { createSection, parseSiteDoc, serializeSiteDoc, siteDocSchema } from "@/lib/site/model";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { esc, renderPage, safeImageUrl, safeUrl } from "@/lib/site/render";
import { projectSpecSchema } from "@/lib/site/spec";
import { TEMPLATES, templateSpec } from "@/lib/site/templates";

const RESTAURANT = "Build a premium website for my restaurant called \"Saffron House\" with online reservations, a menu, customer reviews, WhatsApp contact +91 98765 43210, and an admin panel.";

describe("planner", () => {
  it("turns the restaurant brief into a valid, honest spec", () => {
    const spec = planFromBrief(RESTAURANT);
    expect(projectSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.name).toBe("Saffron House");
    expect(spec.industry).toBe("Restaurant");
    const home = spec.pages[0].sections;
    expect(home).toEqual(expect.arrayContaining(["menu", "booking", "testimonials", "contact"]));
    expect(spec.contact.whatsapp).toBe("919876543210");
    expect(spec.dataModels.map((m) => m.name)).toContain("Reservation");
    // Asks for real reviews instead of inventing them.
    expect(spec.questions.some((q) => q.id === "reviews")).toBe(true);
  });

  it("composes a schema-valid site for every template", () => {
    for (const t of TEMPLATES) {
      const doc = composeSite(templateSpec(t));
      expect(siteDocSchema.safeParse(doc).success).toBe(true);
      expect(doc.pages[0].path).toBe("/");
    }
  });

  it("does not fabricate testimonials", () => {
    const doc = composeSite(planFromBrief(RESTAURANT));
    const t = doc.pages[0].sections.find((s) => s.type === "testimonials")!;
    expect(JSON.stringify(t.props)).toContain("[Replace");
    expect(diagnose(doc).some((d) => d.category === "content" && d.sectionId === t.id)).toBe(true);
  });
});

describe("site document", () => {
  it("rejects duplicate paths and a missing home page", () => {
    const doc = composeSite(templateSpec(TEMPLATES[0]));
    const bad = structuredClone(doc);
    bad.pages[1].path = "/";
    expect(parseSiteDoc(JSON.stringify(bad)).ok).toBe(false);
    const noHome = structuredClone(doc);
    noHome.pages = noHome.pages.filter((p) => p.path !== "/");
    expect(parseSiteDoc(JSON.stringify(noHome)).ok).toBe(false);
  });

  it("round-trips through serialize/parse", () => {
    const doc = composeSite(templateSpec(TEMPLATES[1]));
    const r = parseSiteDoc(serializeSiteDoc(doc));
    expect(r.ok && r.doc).toEqual(doc);
  });
});

describe("renderer safety", () => {
  it("escapes HTML in all user text", () => {
    expect(esc(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const doc = composeSite(templateSpec(TEMPLATES[4]));
    doc.pages[0].sections[1].props.heading = `<img src=x onerror=alert(1)>`;
    const html = renderPage(doc, doc.pages[0], { kind: "preview" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script");
  });

  it("blocks dangerous URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,hi")).toBe("");
    expect(safeUrl("//evil.com")).toBe("");
    expect(safeUrl("/about")).toBe("/about");
    expect(safeUrl("#contact")).toBe("#contact");
    expect(safeUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeImageUrl("javascript:x")).toBe("");
    expect(safeImageUrl("https://images.example.com/a.jpg")).toBe("https://images.example.com/a.jpg");
  });

  it("only includes the editor bridge script in editor mode", () => {
    const doc = composeSite(templateSpec(TEMPLATES[0]));
    expect(renderPage(doc, doc.pages[0], { kind: "editor", selectedId: "x" })).toContain("<script>");
    expect(renderPage(doc, doc.pages[0], { kind: "publish", basePath: "/b", formAction: () => "/f" })).not.toContain("<script");
  });

  it("escapes the selected id inside the bridge script", () => {
    const doc = composeSite(templateSpec(TEMPLATES[0]));
    const html = renderPage(doc, doc.pages[0], { kind: "editor", selectedId: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script><script>alert(1)");
  });
});

describe("diagnostics", () => {
  it("flags links to pages that do not exist", () => {
    const doc = composeSite(templateSpec(TEMPLATES[4]));
    doc.pages[0].sections[1].props.primaryHref = "/missing";
    expect(diagnose(doc).some((d) => d.severity === "error" && d.category === "links")).toBe(true);
  });
});

describe("built-in commands", () => {
  const doc = composeSite(templateSpec(TEMPLATES[4]));
  it("adds a section above the footer", () => {
    const r = runCommand(doc, "Add a pricing section")!;
    const types = r.doc.pages[0].sections.map((s) => s.type);
    expect(types.at(-1)).toBe("footer");
    expect(types.at(-2)).toBe("pricing");
  });
  it("switches to a dark palette that still meets contrast", () => {
    const d = runCommand(doc, "Switch to dark mode")!.doc;
    expect(isDark(d.theme.palette.background)).toBe(true);
    expect(contrast(d.theme.palette.text, d.theme.palette.background)).toBeGreaterThanOrEqual(7);
  });
  it("understands design language without a model", () => {
    const d = runCommand(doc, "Make the whole site feel more premium")!;
    expect(d.summary).toMatch(/Make it premium/);
    expect(d.doc.theme.typeScale).toBe("dramatic");
  });
  it("restyles in a named direction", () => {
    expect(runCommand(doc, "Apply the editorial style")!.doc.theme.personality).toBe("editorial");
  });
  it("does not mistake section edits for global styling", () => {
    expect(runCommand(doc, "Remove the premium plan from pricing")).toBeNull();
  });
  it("returns null for anything it does not understand", () => {
    expect(runCommand(doc, "Rewrite the hero copy for young families")).toBeNull();
  });
  it("creates sections with unique ids", () => {
    expect(createSection("faq").id).not.toBe(createSection("faq").id);
  });
});
