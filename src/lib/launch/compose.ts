// Builds the site for the launch journey from what the owner told us: the
// same function draws the live previews and produces the document that is
// published, so what they approve is exactly what goes live.
import { applyBrand } from "../site/brand";
import { applyPersonality } from "../site/design";
import { photoUrl } from "../site/media";
import { serializeSiteDoc, type Section, type SiteDoc } from "../site/model";
import { composeSite, planFromBrief } from "../site/planner";
import type { DraftProduct } from "../store/import";
import { formatMoney } from "../store/money";
import type { Catalog, SfProduct } from "../store/storefront";
import { storeSiteDoc, storeTemplate, slugifyTitle, STORE_TEMPLATES } from "../store/templates";

export type LaunchKind = "store" | "website";
export type Brand = {
  kind: LaunchKind;
  name: string;
  tagline: string;
  /** Store template id, or a website category label. */
  category: string;
  currency: string;
  country: string;
  colors: string[];
  logo?: string;
  personality: string;
  /** Optional accent override. */
  accent?: string;
  cod: boolean;
};

export const WEBSITE_CATEGORIES = [
  { id: "restaurant", label: "Restaurant or café", brief: "restaurant cafe with menu, reservations and reviews" },
  { id: "salon", label: "Salon or spa", brief: "beauty salon spa with services, pricing and booking" },
  { id: "clinic", label: "Clinic or doctor", brief: "medical clinic with doctors, services and appointments" },
  { id: "consulting", label: "Agency or consultant", brief: "consulting agency with services, case studies and contact" },
  { id: "portfolio", label: "Portfolio", brief: "creative portfolio with gallery, about and enquiry form" },
  { id: "fitness", label: "Gym or studio", brief: "fitness studio with classes, trainers and memberships" },
  { id: "hotel", label: "Hotel or stay", brief: "boutique hotel with rooms, gallery and booking" },
  { id: "education", label: "Coaching or classes", brief: "coaching institute with courses, results and enquiry" },
  { id: "realestate", label: "Real estate", brief: "real estate agency with listings and enquiries" },
  { id: "nonprofit", label: "Non-profit", brief: "non-profit organisation with mission, programmes and donations" },
  { id: "app", label: "App or startup", brief: "software startup landing page with features, pricing and FAQ" },
  { id: "other", label: "Something else", brief: "small business website" },
];

/** Looks offered for each kind; the first is the best match. */
export function looksFor(b: Pick<Brand, "kind" | "category">) {
  if (b.kind === "store") {
    const t = storeTemplate(b.category);
    const first = t?.personality ?? "modern";
    return [first, ...["glass", "luxury", "minimal", "bold", "editorial", "organic", "playful", "modern", "dark-tech"].filter((x) => x !== first)].slice(0, 6);
  }
  const map: Record<string, string> = { restaurant: "organic", salon: "luxury", clinic: "corporate", consulting: "corporate", portfolio: "editorial", fitness: "bold", hotel: "luxury", education: "friendly", realestate: "modern", nonprofit: "friendly", app: "dark-tech", other: "modern" };
  const first = map[b.category] ?? "modern";
  return [first, ...["glass", "minimal", "luxury", "bold", "editorial", "modern", "playful"].filter((x) => x !== first)].slice(0, 6);
}

const set = (doc: SiteDoc, type: string, fn: (s: Section) => void) => doc.pages.forEach((p) => p.sections.filter((s) => s.type === type).forEach(fn));

/** Turns draft products into the storefront catalogue used by the previews. */
export function previewCatalog(products: DraftProduct[], currency: string): Catalog {
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const collections = cats.map((c, i) => ({ id: `c${i}`, slug: slugifyTitle(c), title: c, description: "", image: products.find((p) => p.category === c && p.images[0])?.images[0] ?? "", productCount: products.filter((p) => p.category === c).length }));
  const list: SfProduct[] = products
    .filter((p) => p.title && p.variants.every((v) => v.price && v.price > 0))
    .slice(0, 48)
    .map((p, i) => ({
      id: `p${i}`,
      slug: slugifyTitle(p.title),
      title: p.title,
      description: p.description,
      images: p.images,
      vendor: p.vendor,
      tags: p.tags,
      featured: i < 8,
      createdAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString(),
      collectionIds: p.category ? [`c${cats.indexOf(p.category)}`] : [],
      options: p.options,
      variants: p.variants.map((v, j) => ({ id: `p${i}v${j}`, title: Object.values(v.options).join(" / ") || "Default", price: v.price ?? 0, compareAt: v.compareAt, available: v.stock ?? 10, options: v.options })),
      rating: undefined,
    })) as SfProduct[];
  return { currency, products: list, collections };
}

/** The site for this brand and look. Deterministic for the same inputs. */
export function composeLaunchSite(b: Brand, products: DraftProduct[] = []): SiteDoc {
  const name = b.name.trim() || "My brand";
  let doc: SiteDoc;
  if (b.kind === "store") {
    const t = storeTemplate(b.category) ?? STORE_TEMPLATES[0];
    doc = storeSiteDoc(t, name);
    applyPersonality(doc, b.personality, 0);
    const india = b.country.toUpperCase() === "IN";
    const freeOver = formatMoney(india ? 99900 : 7500, b.currency).replace(/[.,]00(?!\d)/, "");
    const heroImage = products.find((p) => p.images[0])?.images[0];
    const storyImage = products.filter((p) => p.images[0])[1]?.images[0];
    set(doc, "banner", (s) => (s.props.text = `Free delivery on orders over ${freeOver}${b.cod ? " · Cash on delivery available" : ""}`));
    set(doc, "hero", (s) => {
      if (b.tagline.trim()) s.props.subheading = b.tagline.trim();
      if (heroImage) {
        s.props.image = heroImage;
        s.props.imageAlt = `${name} — ${products.find((p) => p.images[0])!.title}`;
      }
    });
    // The template's story uses placeholder copy; write a real one from what we know.
    set(doc, "split", (s) => {
      s.props.eyebrow = "About us";
      s.props.heading = `Why ${name}`;
      s.props.body = b.tagline.trim() ? `${b.tagline.trim()}\n\nEvery order is packed with care and shipped with tracking, so you know exactly when it will arrive.` : `${name} brings together pieces we love and stand behind. Every order is packed with care and shipped with tracking.`;
      if (storyImage) s.props.image = storyImage;
    });
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
    if (cats.length) set(doc, "navbar", (s) => (s.props.links = [{ label: "Shop all", href: "/shop" }, ...cats.slice(0, 3).map((c) => ({ label: c, href: `/shop/${slugifyTitle(c)}` })), { label: "Track order", href: "/track" }]));
    set(doc, "faq", (s) => {
      s.props.items = [
        { question: "How long does delivery take?", answer: `Most orders arrive in ${india ? "3–6" : "3–5"} business days, and express delivery takes 1–2. You'll get a tracking link by email as soon as your parcel ships.` },
        { question: "How much is delivery?", answer: `Delivery is free on orders over ${freeOver}.` },
        b.cod ? { question: "Do you offer cash on delivery?", answer: "Yes — choose cash on delivery at checkout." } : { question: "How can I pay?", answer: "You can pay securely at checkout with the options shown there." },
        { question: "How do I track my order?", answer: "Use the Track order page with your order number and email address, or follow the link in your shipping email." },
      ];
    });
  } else {
    const cat = WEBSITE_CATEGORIES.find((c) => c.id === b.category) ?? WEBSITE_CATEGORIES.at(-1)!;
    doc = composeSite(planFromBrief(`${name}: ${b.tagline || cat.brief}. ${cat.brief}`, { name }), { personality: b.personality, seed: 0 });
    if (b.tagline.trim()) set(doc, "hero", (s) => (s.props.subheading = b.tagline.trim()));
  }
  doc.name = name;
  if (b.colors.length) doc.theme = applyBrand(doc.theme, { colors: b.colors });
  if (b.accent) doc.theme.palette.accent = b.accent;
  if (b.logo) {
    set(doc, "navbar", (s) => (s.props.logo = b.logo));
  }
  // A premium default: sticky glass header and soft button glow.
  doc.theme.ui = { ...(doc.theme.ui ?? {}), header: "glass", buttonShadow: true };
  doc.theme.motion = doc.theme.motion === "none" ? "subtle" : doc.theme.motion;
  return doc;
}

/** The document sent to the server (logo data stays out; it's uploaded separately). */
export function launchDocJson(b: Brand, products: DraftProduct[]) {
  return serializeSiteDoc(composeLaunchSite({ ...b, logo: undefined }, products));
}

export { photoUrl, STORE_TEMPLATES };
