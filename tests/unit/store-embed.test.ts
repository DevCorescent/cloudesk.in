import { describe, expect, it } from "vitest";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { craftedDoc, TEMPLATES } from "@/lib/site/templates";
import { embedStoreInSite, hasStorefront } from "@/lib/store/embed";
import type { SiteDoc } from "@/lib/site/model";

const site = (brief: string, personality?: string): SiteDoc => {
  const spec = planFromBrief(brief, { name: "Still Waters" });
  if (personality) spec.personality = personality;
  return composeSite(spec);
};
const home = (d: SiteDoc) => d.pages.find((p) => p.path === "/") ?? d.pages[0];
const types = (d: SiteDoc) => home(d).sections.map((s) => s.type);

describe("adding a store to a website", () => {
  it("adds shop sections after the hero, a cart and Shop link, and footer links — and keeps everything else", () => {
    const before = site("A luxury day spa with treatments, booking and a gallery", "luxury");
    const { doc, added } = embedStoreInSite(before);
    const t = types(doc);
    const hero = t.indexOf("hero");
    expect(t.slice(hero + 1).find((x) => x === "productGrid" || x === "collectionList")).toBe("productGrid");
    expect(t).toContain("collectionList");
    // Every section that was there is still there, in order.
    expect(t.filter((x) => x !== "productGrid" && x !== "collectionList")).toEqual(types(before));
    for (const page of doc.pages)
      for (const s of page.sections) {
        if (s.type === "navbar") {
          expect(s.props.showCart).toBe(true);
          expect((s.props.links as { href: string }[]).some((l) => l.href === "/shop")).toBe(true);
        }
        if (s.type === "footer") expect((s.props.links as { href: string }[]).map((l) => l.href)).toEqual(expect.arrayContaining(["/shop", "/track", "/policies/shipping", "/policies/refund"]));
      }
    expect(added).toEqual(expect.arrayContaining(["A cart in your menu", "A Shop link in your menu", "Store links in your footer"]));
    // The original is untouched.
    expect(hasStorefront(before)).toBe(false);
    expect(hasStorefront(doc)).toBe(true);
  });

  it("matches the site's design direction and keeps the page's background rhythm", () => {
    const lux = embedStoreInSite(site("A fine dining restaurant with a tasting menu", "luxury")).doc;
    expect(home(lux).sections.find((s) => s.type === "productGrid")?.variant).toBe("editorial");
    const bold = embedStoreInSite(site("A boxing gym with programmes and coaches", "bold")).doc;
    expect(home(bold).sections.find((s) => s.type === "productGrid")?.variant).toBe("carousel");
    const min = embedStoreInSite(site("A dermatology clinic with treatments", "minimal")).doc;
    expect(home(min).sections.find((s) => s.type === "collectionList")?.variant).toBe("minimal");
    for (const d of [lux, bold, min]) {
      const secs = home(d).sections;
      const i = secs.findIndex((s) => s.type === "productGrid");
      // A new band never repeats the background of the section before it.
      // The shop block contrasts with what's around it.
      const last = secs[i + 1].type === "collectionList" ? i + 1 : i;
      expect(secs[i].style.background).not.toBe(secs[i - 1].style.background);
      expect(secs[last].style.background).not.toBe(secs[last + 1].style.background);
      expect(secs[i].style.adv?.anchor).toBe("shop");
    }
  });

  it("can go near the end and skip categories", () => {
    const { doc } = embedStoreInSite(site("A yoga studio with classes"), { placement: "before-footer", categories: false });
    const t = types(doc);
    expect(t).not.toContain("collectionList");
    const grid = t.indexOf("productGrid");
    expect(t.slice(grid + 1).every((x) => ["newsletter", "footer"].includes(x))).toBe(true);
  });

  it("works on crafted multi-page sites, menus on every page", () => {
    const crafted = craftedDoc(TEMPLATES.find((t) => t.id === "design-studio")!, "Folio Studio")!;
    const { doc } = embedStoreInSite(crafted);
    const navbars = doc.pages.flatMap((p) => p.sections.filter((s) => s.type === "navbar"));
    expect(navbars.length).toBeGreaterThan(1);
    for (const n of navbars) expect(n.props.showCart).toBe(true);
  });

  it("is idempotent", () => {
    const once = embedStoreInSite(site("A bakery and café")).doc;
    const twice = embedStoreInSite(once);
    expect(types(twice.doc)).toEqual(types(once));
    expect(JSON.stringify(twice.doc)).toBe(JSON.stringify(once));
    expect(twice.added).toEqual(["Shop, product, cart and checkout pages in your design"]);
  });

  it("doesn't overfill a full menu", () => {
    const d = site("A consulting firm");
    const nav = home(d).sections.find((s) => s.type === "navbar")!;
    nav.props.links = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, href: `/l${i}` }));
    const out = embedStoreInSite(d).doc;
    const links = home(out).sections.find((s) => s.type === "navbar")!.props.links as unknown[];
    expect(links).toHaveLength(8);
  });
});
