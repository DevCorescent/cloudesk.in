import { describe, expect, it } from "vitest";
import { ICON_NODES } from "@/lib/site/icons";
import { STORE_TEMPLATES, STORE_TEMPLATES_SHOWN, storeSiteDoc } from "@/lib/store/templates";

const signature = STORE_TEMPLATES.filter((t) => t.look);

describe("signature store templates", () => {
  it("are listed first", () => {
    expect(signature.length).toBeGreaterThanOrEqual(5);
    expect(STORE_TEMPLATES_SHOWN.slice(0, signature.length).every((t) => t.look)).toBe(true);
  });

  it.each(signature.map((t) => [t.id, t] as const))("%s builds its own look", (_, t) => {
    const doc = storeSiteDoc(t);
    const s = doc.pages[0].sections;
    const of = (type: string) => s.filter((x) => x.type === type);
    expect(of("hero")[0].variant).toBe(t.look!.hero);
    expect(of("marquee")[0].props.items).toEqual(t.look!.ticker.items);
    expect(of("productGrid").map((x) => x.variant)).toEqual(["editorial", "carousel"]);
    expect(of("gallery")[0].variant).toBe("masonry");
    expect(of("gallery")[0].style.adv?.anchor).toBe("lookbook");
    expect(of("split")[0].style.background).toBe(t.look!.darkStory ? "inverse" : "surface");
    // Every promise icon exists, and every sample product points at a real collection.
    for (const p of t.promises) expect(ICON_NODES).toHaveProperty(p.icon);
    for (const p of t.products) expect(t.collections[p.collection]).toBeTruthy();
  });
});
