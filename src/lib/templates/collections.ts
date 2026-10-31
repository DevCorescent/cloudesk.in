// Five templates for each kind of business — a mix of websites and online
// stores — plus the sample catalogue used when a store is added to that
// business's existing website. Keys match the business pages (/for/<slug>).
import type { IndustryId } from "../workspace/modules";

export type TemplateRef = { kind: "site" | "store"; id: string };
export type BusinessId = "fashion" | "bakery-cafe" | "restaurants-hotels" | "salon-spa" | "jewellery" | "studios" | "clinics" | "home-decor" | "fitness";

export type TemplateCollection = {
  id: BusinessId;
  label: string;
  /** Onboarding industries that map here. */
  industries: IndustryId[];
  items: TemplateRef[];
  /** Store template whose sample products suit this business. */
  sample: string;
};

const site = (id: string): TemplateRef => ({ kind: "site", id });
const store = (id: string): TemplateRef => ({ kind: "store", id });

export const TEMPLATE_COLLECTIONS: TemplateCollection[] = [
  { id: "fashion", label: "Boutiques & fashion", industries: ["retail"], items: [store("noir"), store("saanjh"), store("fashion"), store("tote"), site("fashion")], sample: "fashion" },
  { id: "bakery-cafe", label: "Bakeries & cafés", industries: ["food", "cafe"], items: [store("crumb"), store("bakery"), store("brewhouse"), site("cafe"), site("patisserie")], sample: "crumb" },
  { id: "restaurants-hotels", label: "Restaurants & hotels", industries: ["restaurant", "bar", "hotel"], items: [site("fine-dining"), site("restaurant"), site("bar-lounge"), site("hotel"), site("resort")], sample: "brewhouse" },
  { id: "salon-spa", label: "Salons & spas", industries: ["salon"], items: [site("spa"), site("hair-salon"), site("makeup-studio"), store("lumen"), store("beauty")], sample: "beauty" },
  { id: "jewellery", label: "Jewellery", industries: [], items: [store("aurum"), store("kundan"), store("jewellery"), store("optica"), site("jewellery")], sample: "jewellery" },
  { id: "studios", label: "Studios & consultants", industries: ["services", "software"], items: [site("design-studio"), site("marketing-agency"), site("consulting"), site("architecture"), site("photography")], sample: "folio" },
  { id: "clinics", label: "Clinics", industries: ["clinic"], items: [site("multispecialty-clinic"), site("dental"), site("skin-clinic"), site("eye-clinic"), site("physio")], sample: "harvest" },
  { id: "home-decor", label: "Home & décor", industries: ["home"], items: [store("casa"), store("kiln"), store("verde"), store("home"), store("gifts")], sample: "home" },
  { id: "fitness", label: "Fitness & wellness", industries: ["fitness"], items: [site("fitness"), site("yoga-studio"), site("boxing-gym"), store("fitness"), store("harvest")], sample: "fitness" },
];

export const collectionById = (id: string | null | undefined) => TEMPLATE_COLLECTIONS.find((c) => c.id === id);
/** The collection for an onboarding industry (fashion & retail goes to boutiques). */
export const collectionForIndustry = (industry: string | null | undefined) => TEMPLATE_COLLECTIONS.find((c) => c.industries.includes(industry as IndustryId));
/** Sample products for a business's store, or a gentle default. */
export const sampleFor = (industry: string | null | undefined) => collectionForIndustry(industry)?.sample ?? "gifts";
