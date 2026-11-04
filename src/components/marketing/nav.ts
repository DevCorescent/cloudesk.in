// How the marketing site groups what the product does — shared by the header
// menus, site search, footer and the homepage's suite section.
import { BUSINESSES } from "./businesses";
import { LEGAL_PAGES } from "@/components/legal/pages";
import { FEATURES, type Feature } from "./features";

export type ProductGroup = { id: string; title: string; line: string; slugs: string[] };

export const PRODUCT_GROUPS: ProductGroup[] = [
  { id: "build", title: "Build & sell", line: "Websites, stores and the counter", slugs: ["launch", "website-builder", "online-store", "point-of-sale", "bookings", "promotions", "domains"] },
  { id: "run", title: "Run your business", line: "Customers, money and people", slugs: ["my-work", "mail", "calendar", "chat", "notes", "crm", "sales", "invoicing", "accounting", "hrms", "projects", "inventory", "helpdesk", "marketing", "documents"] },
  { id: "ops", title: "Operations", line: "Make, check, move and comply", slugs: ["manufacturing", "quality", "maintenance", "logistics", "portals", "compliance"] },
  { id: "industry", title: "Industry suites", line: "Made for how you work", slugs: ["horeca", "clinic", "education", "construction"] },
  { id: "ai", title: "AI, data & automation", line: "Work smarter, not longer", slugs: ["copilot", "automations", "chatbot", "reports", "data", "custom-objects", "ai-ide", "growth", "collaboration"] },
];

/** The Products menu splits each group into smaller sections, with one screen to show. */
export const MENU_SECTIONS: Record<string, { title: string; slugs: string[] }[]> = {
  build: [
    { title: "Websites", slugs: ["launch", "website-builder", "domains"] },
    { title: "Selling", slugs: ["online-store", "point-of-sale", "bookings", "promotions"] },
  ],
  run: [
    { title: "Your workday", slugs: ["my-work", "mail", "calendar", "chat", "notes"] },
    { title: "Customers & sales", slugs: ["crm", "sales", "marketing", "helpdesk"] },
    { title: "Money", slugs: ["invoicing", "accounting"] },
    { title: "People & work", slugs: ["hrms", "projects", "inventory", "documents"] },
  ],
  ops: [
    { title: "Make & check", slugs: ["manufacturing", "quality", "maintenance"] },
    { title: "Move & comply", slugs: ["logistics", "portals", "compliance"] },
  ],
  industry: [{ title: "Suites", slugs: ["horeca", "clinic", "education", "construction"] }],
  ai: [
    { title: "Intelligence", slugs: ["copilot", "chatbot", "growth"] },
    { title: "Data & reports", slugs: ["reports", "data", "custom-objects"] },
    { title: "Build & automate", slugs: ["automations", "ai-ide", "collaboration"] },
  ],
};

export const MENU_FEATURE: Record<string, { title: string; body: string; href: string; img: string }> = {
  build: { title: "Drag, drop and publish anywhere", body: "Edit every element for phones, then publish to your domain, GitHub, Netlify, Vercel or Cloudflare.", href: "/features/website-builder", img: "/marketing/builder/dragdrop.jpg" },
  run: { title: "Your day, the moment you sign in", body: "Meetings, approvals and unread mail and chat on one Home screen.", href: "/features/my-work", img: "/marketing/workspace/home.jpg" },
  ops: { title: "From recipe to work order", body: "Bills of materials, work orders and stock that moves as you make.", href: "/features/manufacturing", img: "/marketing/manufacturing/work-order.jpg" },
  industry: { title: "A till, a kitchen and rooms", body: "Cloudesk for Horeca runs tables, KOTs, QR menus and stays.", href: "/features/horeca", img: "/marketing/horeca/pos.jpg" },
  ai: { title: "Ask your business anything", body: "Answers from your own numbers, with the figures it used.", href: "/features/copilot", img: "/marketing/workspace/copilot.jpg" },
};

export const INDUSTRY_GROUPS: { title: string; slugs: string[] }[] = [
  { title: "Retail", slugs: ["fashion", "jewellery", "home-decor"] },
  { title: "Food & hospitality", slugs: ["bakery-cafe", "restaurants-hotels"] },
  { title: "Services & wellness", slugs: ["salon-spa", "clinics", "fitness", "studios"] },
];

export const featureOf = (slug: string) => FEATURES.find((f) => f.slug === slug);
export const groupFeatures = (g: ProductGroup) => g.slugs.map(featureOf).filter((f): f is Feature => !!f);
export const businessOf = (slug: string) => BUSINESSES.find((b) => b.slug === slug);

/** Everything the site search can find. */
export type SearchEntry = { kind: "Feature" | "Industry" | "Page" | "Detail" | "Answer"; title: string; line: string; href: string; group?: string; words: string; answer?: string };
export function searchIndex(): SearchEntry[] {
  const groupOf = new Map(PRODUCT_GROUPS.flatMap((g) => g.slugs.map((s) => [s, g.title] as const)));
  return [
    ...FEATURES.map((f) => ({ kind: "Feature" as const, title: f.name, line: f.short, href: `/features/${f.slug}`, group: groupOf.get(f.slug), words: [f.name, f.short, f.title, f.lede, ...f.highlights.map((h) => h.title)].join(" ").toLowerCase() })),
    ...BUSINESSES.map((b) => ({ kind: "Industry" as const, title: b.name, line: b.line, href: `/for/${b.slug}`, words: [b.name, b.slug, b.industry, b.line].join(" ").toLowerCase() })),
    { kind: "Page", title: "All features", line: "Everything Cloudesk does, by category", href: "/features", words: "features modules all products" },
    { kind: "Page", title: "Cloudesk AI", line: "Every AI power in one place", href: "/intelligence", words: "ai artificial intelligence copilot assistant gpt claude gemini smart automation" },
    { kind: "Page", title: "Pricing", line: "Plans, the free trial and building your own", href: "/pricing", words: "pricing price plans cost trial subscription billing" },
    { kind: "Page", title: "Become a partner", line: "Earn a recurring share of what the customers you bring pay", href: "/partners", words: "partner partners affiliate referral reseller agency freelancer influencer commission earn program" },
    { kind: "Page", title: "All industries", line: "Set up for your kind of business", href: "/for", words: "industries businesses solutions" },
    { kind: "Page", title: "Start free", line: "Create your account — no card needed", href: "/start", words: "sign up signup register start free trial account create" },
    { kind: "Page", title: "Sign in", line: "Open your workspace", href: "/login", words: "sign in login log in" },
    { kind: "Page", title: "Contact us", line: "Talk to the team, sales or support", href: "/contact", words: "contact support help sales email phone talk" },
    ...LEGAL_PAGES.map((l) => ({ kind: "Page" as const, title: l.title, line: l.line, href: l.href, words: `${l.title} ${l.short} ${l.line} legal policy`.toLowerCase() })),
    // What each feature can do, so “GST returns” or “UPI” finds the page that does it.
    ...FEATURES.flatMap((f) => f.highlights.map((h) => ({ kind: "Detail" as const, title: h.title, line: `${shortName(f.name)} — ${h.body}`, href: `/features/${f.slug}`, group: shortName(f.name), words: `${h.title} ${h.body} ${f.name}`.toLowerCase() }))),
    // Questions about the service itself (answers as on the pricing, security and legal pages).
    ...GENERAL_FAQ.map((x) => ({ kind: "Answer" as const, title: x.q, line: x.a, answer: x.a, href: x.href, group: x.group, words: `${x.q} ${x.a} ${x.words}`.toLowerCase() })),
    // Questions people ask, answered on the feature pages.
    ...FEATURES.flatMap((f) => f.faqs.map((x) => ({ kind: "Answer" as const, title: x.q, line: x.a, answer: x.a, href: `/features/${f.slug}`, group: shortName(f.name), words: `${x.q} ${x.a} ${f.name}`.toLowerCase() }))),
  ];
}

const GENERAL_FAQ = [
  { q: "Can I export my data?", a: "Yes. Export any list as CSV or Excel, or the whole workspace, whenever you like — it's yours.", href: "/security", group: "Your data", words: "export download backup csv excel data leave move" },
  { q: "Is there a free trial?", a: "Every new workspace gets every feature free for the trial. No card is needed to start.", href: "/pricing", group: "Pricing", words: "trial free test try card" },
  { q: "What happens when the trial ends?", a: "You carry on with the plan you chose. If you haven't chosen one, you move to the Free plan — Mail, Calendar, Chat, invoicing and a CRM with monthly allowances. Nothing is deleted.", href: "/pricing", group: "Pricing", words: "trial ends after expire free plan downgrade" },
  { q: "Can I cancel any time?", a: "Yes. You keep your plan until the end of the period you've paid for.", href: "/refunds", group: "Pricing", words: "cancel stop subscription refund" },
  { q: "Is GST included in the price?", a: "Prices are shown before tax; GST is added on each invoice and shown on it.", href: "/pricing", group: "Pricing", words: "gst tax price invoice" },
  { q: "Is my data safe?", a: "Two-step sign-in, roles and an audit log, encrypted secrets, a web application firewall, and payments through Razorpay and Stripe — we never store card details.", href: "/security", group: "Security", words: "safe secure security privacy encryption hack protect" },
  { q: "Can I change my plan later?", a: "Yes. An upgrade starts as soon as it's paid, charged for the time left less what's unused; a downgrade starts when your current period ends.", href: "/pricing", group: "Pricing", words: "upgrade downgrade change plan switch" },
];

const STOP = new Set("a an the and or of to in on for with is are do does can i my we our you your it this that how what which who when where why will be there any".split(" "));

/** Ranks entries for a query: whole-word and prefix matches in the title first. */
export function searchSite(q: string, index = searchIndex()): SearchEntry[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  // Questions work too: little words ("can", "my") don't have to match.
  const all = t.split(/[^\p{L}\p{N}&-]+/u).filter(Boolean);
  const terms = all.filter((w) => !STOP.has(w)).length ? all.filter((w) => !STOP.has(w)) : all;
  const score = (e: SearchEntry) => {
    const title = e.title.toLowerCase();
    let s = 0;
    let missed = 0;
    for (const w of terms) {
      if (title.startsWith(w)) s += 30;
      else if (title.split(/[\s&/-]+/).some((x) => x.startsWith(w))) s += 20;
      else if (title.includes(w)) s += 10;
      else if (e.line.toLowerCase().includes(w)) s += 6;
      else if (e.words.includes(w)) s += 3;
      else missed++;
    }
    // Every word for one or two words; most of them for longer searches.
    if (missed > (terms.length > 2 ? Math.floor(terms.length / 3) : 0)) return 0;
    // The whole phrase among an entry's keywords ("sign up") beats scattered words.
    if (terms.length > 1 && (title.includes(t) || e.words.includes(t))) s += 25;
    return s + (e.kind === "Feature" ? 3 : e.kind === "Page" || e.kind === "Industry" ? 2 : 0);
  };
  return index.map((e) => [e, score(e)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([e]) => e).slice(0, 24);
}


/** For a question, the closest answer from the feature pages' FAQs — matched on the words that matter. */
export function bestAnswer(q: string, index = searchIndex()): SearchEntry | null {
  const t = q.trim().toLowerCase();
  if (t.length < 6) return null;
  const words = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length < 2 && !t.endsWith("?")) return null;
  let best: SearchEntry | null = null;
  let top = 0;
  for (const e of index) {
    if (e.kind !== "Answer") continue;
    const title = e.title.toLowerCase();
    const s = words.reduce((n, w) => n + (title.includes(w) ? 3 : e.words.includes(w) ? 1 : 0), 0);
    if (s > top) [best, top] = [e, s];
  }
  return top >= Math.max(4, Math.ceil(words.length * 1.5)) ? best : null;
}

/** A feature's name without the brand prefix, for compact menus ("Cloudesk CRM" → "CRM"). */
export const shortName = (name: string) => {
  const n = name.replace(/^Cloudesk (for )?/i, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
};
