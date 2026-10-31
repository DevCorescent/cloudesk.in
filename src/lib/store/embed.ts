// Adds an online store to an existing website without redesigning it: a Shop
// link and cart in every menu, store links in every footer, and shop sections
// on the home page — styled in the site's own design direction so they read
// as part of it. Pure: the server writes the result, and the dashboard renders
// it as a before/after preview. Running it twice changes nothing.
import { personality } from "../site/design";
import { createSection, type Section, type SiteDoc } from "../site/model";

export type EmbedOptions = {
  /** Where the shop sections go on the home page. */
  placement: "after-hero" | "before-footer";
  /** Also add "Shop by category" tiles. */
  categories: boolean;
};

export type EmbedResult = { doc: SiteDoc; added: string[] };

const SHOP_HREF = "/shop";
const isShopLink = (href: unknown) => typeof href === "string" && /^\/(shop|cart|track)(\/|$|\?)/.test(href);
type Link = { label: string; href: string };

/** Variants that suit each design direction. */
function looks(direction: string) {
  const grid = ["luxury", "editorial"].includes(direction) ? "editorial" : ["bold", "playful", "friendly"].includes(direction) ? "carousel" : "grid";
  const tiles = ["minimal", "corporate"].includes(direction) ? "minimal" : "tiles";
  return { grid, tiles };
}

/** Whether the site already sells from its pages. */
export function hasStorefront(doc: SiteDoc) {
  return doc.pages.some((p) => p.sections.some((s) => s.type === "productGrid" || s.type === "collectionList"));
}

export function embedStoreInSite(input: SiteDoc, o: EmbedOptions = { placement: "after-hero", categories: true }): EmbedResult {
  const doc = structuredClone(input);
  const added = new Set<string>();
  const direction = doc.theme.personality ?? "modern";
  const p = personality(direction);

  for (const page of doc.pages) {
    for (const s of page.sections) {
      if (s.type === "navbar") {
        if (!s.props.showCart) {
          s.props.showCart = true;
          added.add("A cart in your menu");
        }
        const links = (Array.isArray(s.props.links) ? s.props.links : []) as Link[];
        if (!links.some((l) => isShopLink(l.href)) && links.length < 8) {
          // Right after Home, where people look first.
          const at = links.findIndex((l) => l.href === "/") + 1;
          links.splice(at, 0, { label: "Shop", href: SHOP_HREF });
          s.props.links = links;
          added.add("A Shop link in your menu");
        }
      }
      if (s.type === "footer") {
        const links = (Array.isArray(s.props.links) ? s.props.links : []) as Link[];
        const want: Link[] = [
          { label: "Shop", href: SHOP_HREF },
          { label: "Track order", href: "/track" },
          { label: "Shipping", href: "/policies/shipping" },
          { label: "Refunds", href: "/policies/refund" },
        ];
        let n = 0;
        for (const w of want) {
          if (links.length >= 10 || links.some((l) => l.href === w.href)) continue;
          links.push(w);
          n++;
        }
        if (n) {
          s.props.links = links;
          added.add("Store links in your footer");
        }
      }
    }
  }

  const home = doc.pages.find((pg) => pg.path === "/" && !pg.lang) ?? doc.pages[0];
  if (home && !home.sections.some((s) => s.type === "productGrid" || s.type === "collectionList")) {
    const { grid, tiles } = looks(direction);
    const shop = createSection("productGrid");
    Object.assign(shop.props, { heading: `Shop ${doc.name}`, subheading: "Our most-loved pieces, ready to order.", collection: "", sort: "featured", limit: 8, buttonLabel: "Shop all" });
    shop.variant = grid;
    const cats = createSection("collectionList");
    Object.assign(cats.props, { heading: "Shop by category", limit: 6 });
    cats.variant = tiles;
    const fresh = [shop, ...(o.categories ? [cats] : [])];

    const sections = home.sections;
    const hero = sections.findIndex((s) => s.type === "hero");
    let at: number;
    if (o.placement === "after-hero" && hero >= 0) {
      at = hero + 1;
      // Keep a ticker, logos or stats strip glued to the hero.
      while (at < sections.length && ["marquee", "logos", "stats"].includes(sections[at].type)) at++;
    } else {
      at = sections.findIndex((s) => s.type === "footer" || s.type === "newsletter");
      if (at < 0) at = sections.length;
    }
    // Blend in: the direction's spacing and motion, and backgrounds that keep the page's rhythm.
    const neighbour = sections.slice(0, at).reverse().find((s) => !["navbar", "banner", "hero", "footer"].includes(s.type)) ?? sections[at];
    // Light bands alternate; dark (inverse/accent) neighbours contrast with either.
    const light = (bg: string | undefined) => (bg === "surface" ? "surface" : bg === "inverse" || bg === "accent" ? null : "default");
    const alt = (bg: string | null) => (bg === "surface" ? "default" : "surface");
    const prev = at > 0 ? light(sections[at - 1].style.background) : null;
    const next = at < sections.length ? light(sections[at].style.background) : null;
    // Two new sections between neighbours that differ: alternate, each contrasting with the side it touches.
    // Otherwise they share one band — a single "shop" block — in the colour that contrasts with both.
    const bands = fresh.length === 2 && prev && next && prev !== next ? [alt(prev), alt(next)] : fresh.map(() => alt(prev ?? next));
    for (const [i, s] of fresh.entries()) {
      s.style = {
        ...s.style,
        background: bands[i] as Section["style"]["background"],
        paddingY: neighbour?.style.paddingY ?? (p.density === "airy" ? "lg" : "md"),
        ...(neighbour?.style.motion ? { motion: neighbour.style.motion } : {}),
        adv: { ...(s.style.adv ?? {}), ...(i === 0 ? { anchor: "shop" } : {}) },
      };
    }
    sections.splice(at, 0, ...fresh);
    added.add(o.categories ? "Bestsellers and categories on your home page" : "Bestsellers on your home page");
  }

  added.add("Shop, product, cart and checkout pages in your design");
  return { doc, added: [...added] };
}
