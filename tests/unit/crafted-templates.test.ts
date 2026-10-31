import { describe, expect, it } from "vitest";
import { ICON_NODES } from "@/lib/site/icons";
import { craftedDoc, TEMPLATES } from "@/lib/site/templates";

const crafted = TEMPLATES.filter((t) => t.crafted);

describe("crafted website templates", () => {
  it("cover technology, marketing and portfolio", () => {
    expect(new Set(crafted.map((t) => t.category))).toEqual(new Set(["Technology", "Marketing", "Portfolio"]));
  });

  it.each(crafted.map((t) => [t.id, t] as const))("%s builds every page it promises, with working links", (_, t) => {
    const doc = craftedDoc(t, "Acme")!;
    expect(doc.pages.map((p) => p.title.replace("Acme", "Home"))).toEqual(t.pages);
    const paths = new Set(doc.pages.map((p) => p.path));
    for (const page of doc.pages) {
      const nav = page.sections.find((s) => s.type === "navbar")!;
      expect(nav.props.brand).toBe("Acme");
      for (const l of nav.props.links as { href: string }[]) expect(paths.has(l.href.split("#")[0] || "/")).toBe(true);
      for (const s of page.sections) {
        if (s.props.buttonHref) expect(paths.has(String(s.props.buttonHref).split("#")[0] || "/")).toBe(true);
        for (const it of (s.props.items as { icon?: string }[] | undefined) ?? []) if (it.icon) expect(ICON_NODES).toHaveProperty(it.icon);
        // Numbers only the owner knows stay as placeholders, never invented.
        if (s.type === "stats") for (const it of s.props.items as { value: string }[]) expect(it.value).toMatch(/\[/);
        if (s.type === "testimonials") for (const it of s.props.items as { quote: string }[]) expect(it.quote).toMatch(/^\[/);
      }
    }
  });
});
