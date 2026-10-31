// Understanding what someone needs from a sentence and a few answers, then
// turning it into a concrete plan. Deterministic keyword matching, no AI:
// it explains *why* it suggests each thing (the words it matched), and the
// person can change any suggestion.

export type Kind = "store" | "website";
export type Sells = "online" | "shop" | "both" | "none";
export type Stage = "new" | "selling" | "moving";
export type Goal = "sell" | "pos" | "bookings" | "enquiries" | "showcase" | "subscriptions" | "digital" | "whatsapp" | "ship-intl" | "invoicing";
export type Asset = "spreadsheet" | "logo" | "photos" | "domain" | "website";
export type CatalogSize = "1-10" | "10-100" | "100-1000" | "1000+";

export type Answers = {
  name: string;
  brief: string;
  sells: Sells | null;
  stage: Stage | null;
  goals: Goal[];
  assets: Asset[];
  catalogSize: CatalogSize | null;
  domain: string;
  /** Overrides of what was detected. */
  kind?: Kind;
  category?: string;
};

type Rule = { id: string; words: string[] };

// Store templates (ids from lib/store/templates).
// Words match whole words (plurals included); a trailing * marks a stem ("jewel*" → jewellery, jeweller).
const STORE_RULES: Rule[] = [
  { id: "fashion", words: ["cloth*", "apparel", "fashion", "wear", "dress", "kurta", "kurti", "saree", "sari", "tee", "t-shirt", "shirt", "hoodie", "denim", "ethnic wear", "boutique", "streetwear", "lehenga", "dupatta", "kidswear", "footwear", "shoe", "sneaker"] },
  { id: "jewellery", words: ["jewel*", "earring", "necklace", "ring", "bangle", "bracelet", "anklet", "pendant", "gold", "silver", "diamond", "pearl", "kundan", "oxidi*"] },
  { id: "beauty", words: ["skincare", "skin care", "beauty", "cosmetic", "makeup", "serum", "soap", "haircare", "hair oil", "fragrance", "perfume", "attar", "ayurved*", "lipstick", "nail polish"] },
  { id: "home", words: ["home decor", "home décor", "decor", "décor", "furniture", "candle", "ceramic", "pottery", "cushion", "rug", "lamp", "kitchenware", "planter", "plant", "linen", "bedsheet", "handloom"] },
  { id: "bakery", words: ["bake*", "cake", "cookie", "brownie", "bread", "pastry", "pastries", "chocolate", "sweet", "mithai", "snack", "pickle", "spice", "masala", "tea", "coffee", "honey", "dry fruit", "organic food", "homemade food"] },
  { id: "books", words: ["book", "bookstore", "stationery", "notebook", "journal", "planner", "comic", "novel", "pen", "art supplies"] },
  { id: "gadgets", words: ["gadget", "electronic*", "phone case", "charger", "earbud", "headphone", "speaker", "tech accessories", "cable", "smartwatch", "laptop"] },
  { id: "fitness", words: ["gym wear", "protein", "supplement", "yoga mat", "sportswear", "activewear", "dumbbell", "fitness gear", "fitness equipment"] },
  { id: "gifts", words: ["gift*", "hamper", "personali*", "custom mug", "return gift", "festive", "diwali", "rakhi", "wedding favour", "corporate gift"] },
];

// Website categories (ids from lib/launch/compose WEBSITE_CATEGORIES).
const SITE_RULES: Rule[] = [
  { id: "restaurant", words: ["restaurant", "cafe", "café", "bistro", "dhaba", "bar", "pub", "cloud kitchen", "catering", "menu", "dine", "dining", "eatery"] },
  { id: "salon", words: ["salon", "spa", "parlour", "parlor", "barber", "nail studio", "makeup artist", "bridal makeup", "massage"] },
  { id: "clinic", words: ["clinic", "doctor", "dentist", "dental", "hospital", "physio*", "therapist", "dermatolog*", "paediatric*", "pediatric*", "diagnostic*", "vet", "counsell*"] },
  { id: "consulting", words: ["agency", "consult*", "marketing", "accountant", "ca firm", "law firm", "lawyer", "advocate", "architect", "interior designer", "freelance*"] },
  { id: "portfolio", words: ["portfolio", "photographer", "photography", "artist", "designer", "illustrat*", "writer", "musician", "filmmaker", "videograph*"] },
  { id: "fitness", words: ["gym", "fitness studio", "yoga class", "yoga studio", "pilates", "crossfit", "personal trainer", "zumba", "dance class", "martial art"] },
  { id: "hotel", words: ["hotel", "homestay", "resort", "villa", "bnb", "b&b", "hostel", "guest house", "camp"] },
  { id: "education", words: ["coaching", "tuition", "classes", "course", "academy", "school", "institute", "tutor", "training", "workshop"] },
  { id: "realestate", words: ["real estate", "property", "properties", "apartment", "flat", "plot", "realtor", "broker", "rental"] },
  { id: "nonprofit", words: ["ngo", "non-profit", "nonprofit", "charity", "foundation", "trust", "volunteer", "donat*"] },
  { id: "app", words: ["app", "saas", "startup", "software", "platform", "api", "ai tool", "waitlist"] },
];

const GOAL_RULES: { goal: Goal; words: string[] }[] = [
  { goal: "bookings", words: ["booking", "book a", "book an", "book your", "appointment", "reserv*", "slot", "classes", "session"] },
  { goal: "pos", words: ["my shop", "our shop", "physical store", "physical shop", "showroom", "outlet", "counter", "offline", "walk-in", "in-store", "retail store", "kiosk", "stall"] },
  { goal: "subscriptions", words: ["subscription", "monthly box", "membership", "recurring", "every month"] },
  { goal: "digital", words: ["ebook", "e-book", "download", "template", "preset", "online course", "digital product"] },
  { goal: "whatsapp", words: ["whatsapp", "instagram", "insta", "dm"] },
  { goal: "ship-intl", words: ["worldwide", "international*", "global*", "export*", "usa", "abroad", "overseas"] },
  { goal: "enquiries", words: ["enquir*", "inquir*", "quote", "lead", "get in touch"] },
  { goal: "showcase", words: ["portfolio", "showcase", "gallery"] },
  // Billing clients directly — common for services, B2B and trade.
  { goal: "invoicing", words: ["invoice*", "quotation", "quote", "estimate", "billing", "gst bill", "proforma", "tax invoice", "agency", "consult*", "freelance*", "wholesale*", "b2b", "contractor", "manufactur*", "distributor", "supplier", "retainer"] },
];

const SELL_WORDS = ["sell*", "shop", "store", "product", "brand", "handmade", "manufactur*", "wholesale", "d2c", "ecommerce", "e-commerce"];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = new Map<string, RegExp>();
/** Whole-word match with plurals ("ring" ≠ "spring", "class" ≠ "classic"); "word*" matches as a stem. */
function has(text: string, w: string) {
  let re = matchers.get(w);
  if (!re) {
    re = w.endsWith("*") ? new RegExp(`(^|[^a-z0-9])${esc(w.slice(0, -1))}`) : new RegExp(`(^|[^a-z0-9])${esc(w)}(s|es)?(?![a-z0-9])`);
    matchers.set(w, re);
  }
  return re.test(text);
}

function best(text: string, rules: Rule[]) {
  let top: { id: string; score: number; words: string[] } | null = null;
  for (const r of rules) {
    const words = r.words.filter((w) => has(text, w));
    // Longer, more specific phrases count for more.
    const score = words.reduce((n, w) => n + 1 + (w.includes(" ") ? 1 : 0), 0);
    if (score && (!top || score > top.score)) top = { id: r.id, score, words };
  }
  return top;
}

const clean = (w: string) => w.replace(/\*$/, "");

export type Understanding = {
  kind: Kind;
  storeCategory: string | null;
  websiteCategory: string | null;
  goals: Goal[];
  /** The words that led to each conclusion, shown to the person. */
  signals: { label: string; words: string[] }[];
  confidence: "none" | "some" | "good";
};

export function understandBrief(raw: string): Understanding {
  const text = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  const store = best(text, STORE_RULES);
  const site = best(text, SITE_RULES);
  const sellWords = SELL_WORDS.filter((w) => has(text, w));
  // A service business ("salon", "clinic") is a website even if it "sells" a little.
  const kind: Kind = store && (!site || store.score + sellWords.length > site.score) ? "store" : site ? "website" : sellWords.length ? "store" : "website";
  const goals = GOAL_RULES.filter((g) => g.words.some((w) => has(text, w))).map((g) => g.goal);
  if (kind === "store" && !goals.includes("sell")) goals.unshift("sell");
  const signals: Understanding["signals"] = [];
  if (store) signals.push({ label: `Sells ${STORE_LABEL[store.id] ?? store.id}`, words: store.words.map(clean) });
  if (site) signals.push({ label: SITE_LABEL[site.id] ?? site.id, words: site.words.map(clean) });
  for (const g of goals) {
    if (g === "sell") continue;
    const words = GOAL_RULES.find((r) => r.goal === g)!.words.filter((w) => has(text, w));
    signals.push({ label: GOAL_LABEL[g], words: words.map(clean) });
  }
  const confidence = !raw.trim() ? "none" : (store?.score ?? 0) + (site?.score ?? 0) >= 2 ? "good" : store || site ? "some" : "none";
  return { kind, storeCategory: store?.id ?? null, websiteCategory: site?.id ?? null, goals, signals, confidence };
}

export const STORE_LABEL: Record<string, string> = { fashion: "fashion & apparel", jewellery: "jewellery", beauty: "beauty & skincare", home: "home & décor", bakery: "food & bakery", books: "books & stationery", gadgets: "gadgets & tech", fitness: "fitness gear", gifts: "gifts & hampers" };
export const SITE_LABEL: Record<string, string> = { restaurant: "Restaurant or café", salon: "Salon or spa", clinic: "Clinic or practice", consulting: "Agency or consultant", portfolio: "Portfolio", fitness: "Gym or studio", hotel: "Hotel or stay", education: "Coaching or classes", realestate: "Real estate", nonprofit: "Non-profit", app: "App or startup" };
export const GOAL_LABEL: Record<Goal, string> = {
  sell: "Sell products online",
  pos: "Sell in my shop (POS)",
  bookings: "Take bookings",
  enquiries: "Get enquiries",
  showcase: "Show my work",
  subscriptions: "Subscriptions",
  digital: "Digital downloads",
  whatsapp: "WhatsApp & Instagram",
  "ship-intl": "Ship internationally",
  invoicing: "Invoices & quotations",
};

export type PlanFeature = { id: string; title: string; detail: string; where: string };
export type PlanStep = { id: string; title: string; detail: string; minutes: number };
export type Plan = {
  kind: Kind;
  category: string;
  categoryLabel: string;
  /** Pages the site starts with. */
  pages: string[];
  features: PlanFeature[];
  steps: PlanStep[];
  minutes: number;
  /** Honest notes: things this plan leaves for later. */
  later: string[];
};

/** Turns answers into the setup we'll build, with the reasons. */
export function buildPlan(a: Answers): Plan {
  const u = understandBrief(`${a.name} ${a.brief}`);
  const goals = new Set<Goal>([...u.goals, ...a.goals]);
  if (a.sells === "shop" || a.sells === "both") goals.add("pos");
  if (a.sells === "online" || a.sells === "both") goals.add("sell");
  const kind: Kind = a.kind ?? (a.sells && a.sells !== "none" ? "store" : goals.has("sell") ? "store" : u.kind);
  const category = a.category ?? (kind === "store" ? (u.storeCategory ?? "gifts") : (u.websiteCategory ?? "other"));
  const categoryLabel = kind === "store" ? (STORE_LABEL[category] ?? category) : (SITE_LABEL[category] ?? "Small business");

  const features: PlanFeature[] = [];
  const add = (id: string, title: string, detail: string, where: string) => features.push({ id, title, detail, where });
  if (kind === "store") {
    add("checkout", "Checkout & payments", "Cart, checkout, cash on delivery and UPI from day one; cards when you connect Razorpay, Stripe or PayPal.", "Online store → Payments");
    add("orders", "Orders, invoices & delivery", "GST invoices, delivery rates, tracking links and returns.", "Online store → Orders");
  }
  if (goals.has("pos")) add("pos", "Point of sale for your shop", "Scan barcodes at the counter, take cash, UPI or card, print receipts. Stock stays in sync with online.", "Online store → Point of sale");
  if (goals.has("pos") || (kind === "store" && a.catalogSize && a.catalogSize !== "1-10")) add("labels", "Barcodes & price labels", "In-store EAN-13 codes and printable labels for every item.", "Online store → Labels & barcodes");
  if (goals.has("bookings")) add("bookings", "Online bookings", "We add your services during launch; set prices and opening hours, then customers book at /book with reminders.", "Online store → Bookings");
  if (goals.has("enquiries") || kind === "website") add("forms", "Enquiry forms", "Every message lands in your inbox and your project's submissions.", "Project → Form submissions");
  if (goals.has("subscriptions")) add("subscriptions", "Subscriptions", "Products that renew every week or month through Stripe or Razorpay.", "Online store → Subscriptions");
  if (goals.has("digital")) add("digital", "Digital downloads", "Sell files with limited, private download links.", "Online store → Products");
  if (goals.has("whatsapp")) add("whatsapp", "WhatsApp chat & order updates", "Click-to-chat buttons now; order updates when you connect the WhatsApp Cloud API.", "Online store → WhatsApp");
  if (goals.has("invoicing")) add("invoicing", "Invoices, quotations & billing", "GST invoices and quotes in your own format, shared by link, email, WhatsApp or PDF, with payments, reminders and reports.", "Finance (or Invoices & quotes in your project)");
  if (goals.has("ship-intl")) add("currencies", "Prices in other currencies", "Show prices in your shoppers' currency with rounding rules.", "Online store → Store settings");
  add("domain", a.domain ? `Your domain ${a.domain}` : "Your own domain", a.domain ? "We'll add it during launch and show the two DNS records to set at your registrar." : "Start on your free address and connect a domain whenever you like.", "Deployments → Custom domains");

  const pages = kind === "store" ? ["Home", "Shop", "Product pages", "Cart & checkout", "Track order", "Policies"] : websitePages(category, goals);

  const steps: PlanStep[] = [{ id: "brand", title: "Your brand", detail: "Name, line, logo and colours", minutes: 1 }];
  if (kind === "store") {
    const fromFile = a.assets.includes("spreadsheet") || a.stage === "moving";
    steps.push({ id: "products", title: fromFile ? "Import your products" : "Add your products", detail: fromFile ? "Drop your Excel/CSV (Shopify & WooCommerce exports work)" : a.catalogSize === "1-10" || !a.catalogSize ? "Add a few now, or skip and add later" : "A spreadsheet is fastest — we'll show you what to fill", minutes: fromFile ? 1 : 2 });
  }
  steps.push({ id: "look", title: "Pick your look", detail: "Live previews with your own name and products", minutes: 1 });
  if (kind === "store") steps.push({ id: "payments", title: "Getting paid", detail: "Cash on delivery and UPI now, cards later", minutes: 1 });
  steps.push({ id: "domain", title: "Your address", detail: a.domain ? `Connect ${a.domain}` : "Free address now, your domain any time", minutes: a.domain ? 1 : 0 });
  steps.push({ id: "launch", title: "Go live", detail: "We publish and hand you the link", minutes: 1 });

  const later: string[] = [];
  if (kind === "store" && !a.assets.includes("photos")) later.push("Product photos — add them from your phone in Products whenever they're ready.");
  if (a.assets.includes("website")) later.push("Your old site keeps running until you point your domain here.");
  if (a.catalogSize === "1000+") later.push("Large catalogues import in one go; check the drafts list afterwards for anything missing.");

  return { kind, category, categoryLabel, pages, features, steps, minutes: Math.max(3, steps.reduce((n, s) => n + s.minutes, 0)), later };
}

function websitePages(category: string, goals: Set<Goal>) {
  const base: Record<string, string[]> = {
    restaurant: ["Home", "Menu", "Gallery", "Reservations", "Contact"],
    salon: ["Home", "Services & prices", "Gallery", "Book", "Contact"],
    clinic: ["Home", "Doctors", "Services", "Appointments", "Contact"],
    consulting: ["Home", "Services", "Case studies", "About", "Contact"],
    portfolio: ["Home", "Work", "About", "Enquire"],
    fitness: ["Home", "Classes", "Trainers", "Memberships", "Contact"],
    hotel: ["Home", "Rooms", "Gallery", "Book", "Contact"],
    education: ["Home", "Courses", "Results", "Enquire"],
    realestate: ["Home", "Listings", "About", "Enquire"],
    nonprofit: ["Home", "Our work", "Get involved", "Donate"],
    app: ["Home", "Features", "Pricing", "FAQ"],
  };
  const pages = [...(base[category] ?? ["Home", "About", "Services", "Contact"])];
  if (goals.has("bookings") && !pages.some((p) => /book|appoint|reserv/i.test(p))) pages.splice(pages.length - 1, 0, "Book");
  return pages;
}

/** A hostname typed by a person, cleaned up; null when it isn't a domain. */
export function cleanDomain(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!h) return null;
  return /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/.test(h) ? h : null;
}
