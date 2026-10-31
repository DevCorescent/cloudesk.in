// The partner program: who can join, what each kind of partner does, and the
// maths of what they earn. Shared by the server, the public page and the
// dashboards. Rates live in platform settings (Admin → Partners); these are
// the defaults until an admin changes them.

export const PARTNER_TYPES = ["organisation", "freelancer", "sales", "marketing", "influencer"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export type TypeTerms = {
  /** Share of what a customer pays (before tax), in basis points. */
  commissionBps: number;
  /** For how many months after the customer signs up (0 = for as long as they pay). */
  commissionMonths: number;
  /** The customer's discount with this partner's code, on their first `discountPayments` payments. */
  discountBps: number;
  discountPayments: number;
  /** The most a partner may give away on a coupon they make. */
  maxDiscountBps: number;
};
export type Tier = { name: string; minActive: number; bonusBps: number };
export type Program = {
  open: boolean;
  cookieDays: number;
  holdDays: number;
  minPayout: number;
  tdsBps: number;
  leadDays: number;
  maxCoupons: number;
  types: Record<PartnerType, TypeTerms>;
  tiers: Tier[];
};

export const DEFAULT_PROGRAM: Program = {
  open: true,
  cookieDays: 90,
  holdDays: 30,
  minPayout: 100000,
  tdsBps: 0,
  leadDays: 90,
  maxCoupons: 10,
  types: {
    organisation: { commissionBps: 3000, commissionMonths: 24, discountBps: 1000, discountPayments: 2, maxDiscountBps: 2000 },
    freelancer: { commissionBps: 2000, commissionMonths: 12, discountBps: 1000, discountPayments: 1, maxDiscountBps: 1500 },
    sales: { commissionBps: 2500, commissionMonths: 12, discountBps: 1000, discountPayments: 1, maxDiscountBps: 1500 },
    marketing: { commissionBps: 2000, commissionMonths: 12, discountBps: 1000, discountPayments: 2, maxDiscountBps: 2000 },
    influencer: { commissionBps: 2000, commissionMonths: 12, discountBps: 1500, discountPayments: 3, maxDiscountBps: 2500 },
  },
  tiers: [
    { name: "Partner", minActive: 0, bonusBps: 0 },
    { name: "Gold", minActive: 10, bonusBps: 500 },
    { name: "Platinum", minActive: 25, bonusBps: 1000 },
  ],
};

type Field = { id: string; label: string; kind?: "text" | "textarea" | "number" | "url" | "select"; options?: string[]; placeholder?: string; required?: boolean; hint?: string };

export type TypeInfo = {
  id: PartnerType;
  name: string;
  short: string;
  who: string;
  /** What the partner does: the scope of work. */
  scope: string[];
  /** What their dashboard gives them. */
  tools: string[];
  /** The application's questions for this kind of partner. */
  fields: Field[];
  /** The organisation's name is asked for (not just the person's). */
  company: boolean;
};

export const TYPE_INFO: Record<PartnerType, TypeInfo> = {
  organisation: {
    id: "organisation",
    name: "Partner organisation",
    short: "Agencies, IT firms, CA & consulting firms, resellers",
    who: "Companies that set up software for their clients — digital agencies, IT and implementation firms, chartered accountants, consultants and resellers.",
    scope: [
      "Recommend Cloudesk to your clients and sign them up with your code",
      "Set up workspaces, import data and train your clients' teams",
      "Offer your own services on top — websites, stores, bookkeeping, support",
      "Register deals before the client signs up so they're protected as yours",
      "Be the first line of support for the clients you bring",
    ],
    tools: ["Clients table with each workspace's plan and what it pays", "Deal registration with a protected window", "Codes and links for your team and campaigns", "Earnings, tier progress and payouts"],
    fields: [
      { id: "orgType", label: "What kind of firm are you?", kind: "select", options: ["Digital / web agency", "IT / implementation firm", "CA / accounting firm", "Business consultant", "Reseller / distributor", "Other"], required: true },
      { id: "teamSize", label: "Team size", kind: "select", options: ["1–5", "6–20", "21–50", "51–200", "200+"], required: true },
      { id: "gstin", label: "GSTIN", placeholder: "Optional", hint: "Needed for invoices from you to us, if you're registered." },
      { id: "services", label: "What do you offer your clients?", kind: "textarea", required: true, placeholder: "Websites and stores for retailers, GST filing, ERP rollouts…" },
      { id: "clients", label: "How many clients could move to Cloudesk in a year?", kind: "select", options: ["1–5", "6–20", "21–50", "50+"], required: true },
    ],
    company: true,
  },
  freelancer: {
    id: "freelancer",
    name: "Freelancer",
    short: "Independent developers, designers, consultants",
    who: "Individuals who build websites, stores or set up business tools for clients — on their own, part-time or full-time.",
    scope: [
      "Build your clients' websites, stores and booking pages on Cloudesk",
      "Set up their invoicing, CRM, inventory or HR and show them how it works",
      "Share your link or code; clients who sign up are yours",
      "Charge clients your own fees for the work — the commission is on top",
    ],
    tools: ["Your link and code", "Clients you brought and what they pay", "Earnings and payouts"],
    fields: [
      { id: "skills", label: "What do you do?", kind: "textarea", required: true, placeholder: "Shopify and WordPress sites, Tally to cloud migrations…" },
      { id: "portfolio", label: "Portfolio or profile link", kind: "url", placeholder: "https://" },
      { id: "experience", label: "Years of experience", kind: "select", options: ["Less than 1", "1–3", "3–5", "5+"], required: true },
    ],
    company: false,
  },
  sales: {
    id: "sales",
    name: "Sales partner",
    short: "Sales professionals and business developers",
    who: "People with a network of business owners who can introduce and sell Cloudesk — on commission, in your own time and territory.",
    scope: [
      "Find businesses that need a website, billing, CRM or an ERP",
      "Register each lead in your dashboard so it's protected as yours",
      "Show a demo, answer questions and help them pick a plan",
      "Move leads through your pipeline: contacted → demo → signed up → won",
    ],
    tools: ["Lead registration and a pipeline", "Protected leads for the program's window", "Customers and earnings", "Payouts"],
    fields: [
      { id: "experience", label: "Sales experience", kind: "select", options: ["Less than 1 year", "1–3 years", "3–5 years", "5+ years"], required: true },
      { id: "regions", label: "Where do you sell?", placeholder: "Pune, Mumbai, all of Maharashtra…", required: true },
      { id: "industries", label: "Industries you know", placeholder: "Retail, restaurants, clinics, manufacturing…", required: true },
      { id: "linkedin", label: "LinkedIn profile", kind: "url", placeholder: "https://linkedin.com/in/…" },
    ],
    company: false,
  },
  marketing: {
    id: "marketing",
    name: "Marketing partner",
    short: "Content creators, bloggers, performance marketers, communities",
    who: "People and teams who reach business owners online — blogs, newsletters, YouTube, communities, ads and comparison sites.",
    scope: [
      "Write, film or post about Cloudesk for your audience",
      "Make a tracked link for each campaign and see what it brings",
      "Run ads or newsletters to your links (no bidding on the Cloudesk name)",
      "Use the marketing kit: wording, screenshots and the logo",
    ],
    tools: ["Campaign links with clicks, sign-ups and paying customers", "Coupon codes for your audience", "Earnings and payouts"],
    fields: [
      { id: "channels", label: "Your channels", kind: "textarea", required: true, placeholder: "Blog (link), newsletter with 12k readers, YouTube…" },
      { id: "reach", label: "Monthly reach", kind: "select", options: ["Under 5,000", "5,000–25,000", "25,000–100,000", "100,000+"], required: true },
      { id: "plan", label: "How will you promote Cloudesk?", kind: "textarea", required: true },
    ],
    company: false,
  },
  influencer: {
    id: "influencer",
    name: "Influencer",
    short: "Creators on Instagram, YouTube, LinkedIn, X",
    who: "Creators whose followers run or are starting a business — finance, entrepreneurship, tech, small-business and creator-economy niches.",
    scope: [
      "Share your own coupon code with your followers",
      "Your followers get a discount; you earn on what they pay",
      "Make a separate code for each campaign or platform",
      "Mark posts as sponsored where the platform or law asks (ASCI guidelines in India)",
    ],
    tools: ["Your coupon codes, how often each was used, and what they earned", "Customers and earnings", "Payouts"],
    fields: [
      { id: "platform", label: "Main platform", kind: "select", options: ["Instagram", "YouTube", "LinkedIn", "X (Twitter)", "Podcast", "Other"], required: true },
      { id: "handle", label: "Profile link", kind: "url", required: true, placeholder: "https://instagram.com/…" },
      { id: "followers", label: "Followers", kind: "select", options: ["1k–10k", "10k–50k", "50k–250k", "250k–1M", "1M+"], required: true },
      { id: "niche", label: "What's your content about?", required: true, placeholder: "Small business finance, D2C brands…" },
    ],
    company: false,
  },
};

export const TYPE_LIST = PARTNER_TYPES.map((t) => TYPE_INFO[t]);

/** The tier for this many paying customers (the highest one reached). */
export function tierFor(active: number, tiers: Tier[]) {
  const sorted = [...tiers].sort((a, b) => a.minActive - b.minActive);
  let cur = sorted[0] ?? { name: "Partner", minActive: 0, bonusBps: 0 };
  for (const t of sorted) if (active >= t.minActive) cur = t;
  const next = sorted.find((t) => t.minActive > active) ?? null;
  return { tier: cur, next, toNext: next ? next.minActive - active : 0 };
}

/** A partner's commission rate now: their override or their type's rate, plus the tier bonus. */
export function rateFor(p: { type: PartnerType; commissionBps: number | null }, program: Program, active: number) {
  const base = p.commissionBps ?? program.types[p.type].commissionBps;
  const { tier, next, toNext } = tierFor(active, program.tiers);
  return { base, bonus: tier.bonusBps, rate: Math.min(10000, base + tier.bonusBps), tier, next, toNext };
}

export const shareOf = (amount: number, bps: number) => Math.round((amount * bps) / 10000);
export const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
export const months = (n: number) => (n === 0 ? "for as long as they pay" : `for ${n} months`);
export const discountText = (bps: number, payments: number) => (bps <= 0 ? "" : `${pct(bps)} off ${payments === 1 ? "the first payment" : `the first ${payments} payments`}`);

/** What's withdrawn after tax withheld at source. */
export function payoutSplit(amount: number, tdsBps: number) {
  const tds = shareOf(amount, tdsBps);
  return { amount, tds, net: amount - tds };
}

/** Codes are 4–20 letters/digits, upper case. */
export const CODE_RE = /^[A-Z0-9]{4,20}$/;
export const cleanCode = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
