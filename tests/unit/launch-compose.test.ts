import { describe, expect, it } from "vitest";
import { composeLaunchSite, looksFor, previewCatalog, WEBSITE_CATEGORIES, type Brand } from "@/lib/launch/compose";
import { diagnose } from "@/lib/site/diagnostics";
import { parseSiteDoc, serializeSiteDoc } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { analyse, parseDelimited } from "@/lib/store/import";
import { STORE_TEMPLATES } from "@/lib/store/templates";

const base: Brand = { kind: "store", name: "Saanjh Studio", tagline: "Handwoven everyday wear from Jaipur.", category: "fashion", currency: "INR", country: "IN", colors: [], personality: "editorial", cod: true };
const products = analyse(parseDelimited(`Name,Category,Price,Image\nLinen Kurta,Kurtas,1899,https://images.example.com/k.jpg\nIndigo Dupatta,Dupattas,899,https://images.example.com/d.jpg`)).products;

describe("launch site composer", () => {
  it("builds a publishable store for every category and look, with no placeholder copy", () => {
    for (const t of STORE_TEMPLATES) {
      for (const look of looksFor({ kind: "store", category: t.id }).slice(0, 3)) {
        const doc = composeLaunchSite({ ...base, category: t.id, personality: look }, products);
        expect(parseSiteDoc(serializeSiteDoc(doc)).ok).toBe(true);
        const errors = diagnose(doc).filter((d) => d.severity === "error");
        expect(errors, `${t.id}/${look}`).toEqual([]);
        expect(serializeSiteDoc(doc)).not.toMatch(/\[(Replace|Edit to match)/);
      }
    }
  });

  it("uses the brand's products, tagline, colours and payment choices", () => {
    const doc = composeLaunchSite({ ...base, colors: ["#7c2d12", "#fef3c7"], accent: "#9a3412", cod: false }, products);
    const html = renderPage(doc, doc.pages[0], { kind: "preview" }, { catalog: previewCatalog(products, "INR") });
    expect(html).toContain("Handwoven everyday wear from Jaipur.");
    expect(html).toContain("Linen Kurta");
    expect(html).toContain("https://images.example.com/k.jpg");
    expect(doc.theme.palette.accent).toBe("#9a3412");
    expect(html).toContain("Free delivery on orders over ₹999");
    expect(html).not.toContain("Cash on delivery available");
    expect(doc.pages[0].sections.find((s) => s.type === "navbar")!.props.links).toEqual([{ label: "Shop all", href: "/shop" }, { label: "Kurtas", href: "/shop/kurtas" }, { label: "Dupattas", href: "/shop/dupattas" }, { label: "Track order", href: "/track" }]);
  });

  it("builds websites for every category", () => {
    for (const c of WEBSITE_CATEGORIES) {
      const doc = composeLaunchSite({ ...base, kind: "website", category: c.id, personality: looksFor({ kind: "website", category: c.id })[0] });
      expect(parseSiteDoc(serializeSiteDoc(doc)).ok, c.id).toBe(true);
    }
  });
});
