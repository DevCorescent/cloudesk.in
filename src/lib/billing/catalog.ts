// Subscription plans and the arithmetic behind them, shared by the server (which
// is the only place a price is decided) and the browser (which shows the same
// numbers before anyone pays). Amounts are integers in the currency's minor unit
// (paise for INR); every rounding happens in one place, here.
import { MODULE_IDS, withRequirements, type ModuleId } from "@/lib/workspace/modules";
import type { Limits } from "@/lib/platform/plans";

export type Interval = "month" | "year";
export const INTERVALS: Interval[] = ["month", "year"];

/** Usage allowances: most reset each month; contacts, storage and chat guests are totals. Missing = unlimited. */
export type QuotaKey = "invoicesPerMonth" | "contacts" | "aiPerMonth" | "aiBudgetUsd" | "campaignEmailsPerMonth" | "signaturesPerMonth" | "storageMb" | "chatGuests";
export type Quotas = Partial<Record<QuotaKey, number>>;
export const QUOTA_KEYS: QuotaKey[] = ["invoicesPerMonth", "contacts", "aiPerMonth", "aiBudgetUsd", "campaignEmailsPerMonth", "signaturesPerMonth", "storageMb", "chatGuests"];
export const QUOTA_LABEL: Record<QuotaKey, { name: string; unit: string; module: ModuleId | null; monthly: boolean }> = {
  invoicesPerMonth: { name: "Invoices", unit: "invoices this month", module: "invoicing", monthly: true },
  contacts: { name: "CRM contacts", unit: "contacts", module: "crm", monthly: false },
  aiPerMonth: { name: "AI requests", unit: "AI requests this month", module: null, monthly: true },
  aiBudgetUsd: { name: "AI spend", unit: "US$ of AI this month", module: null, monthly: true },
  campaignEmailsPerMonth: { name: "Campaign emails", unit: "campaign emails this month", module: "marketing", monthly: true },
  signaturesPerMonth: { name: "E-sign requests", unit: "signature requests this month", module: "documents", monthly: true },
  storageMb: { name: "Storage", unit: "MB of files", module: null, monthly: false },
  chatGuests: { name: "Chat guests", unit: "guests in chats", module: "chat", monthly: false },
};

/**
 * Add-ons: more room bought on top of any paid plan, in packs (e.g. +500
 * invoices a month), each with a monthly price. Seats, web apps and custom
 * domains raise the plan's limits; the rest raise its allowances.
 */
export type PackKey = "seats" | "projects" | "customDomains" | Exclude<QuotaKey, "aiBudgetUsd">;
export const PACK_KEYS: PackKey[] = ["seats", "projects", "customDomains", "invoicesPerMonth", "contacts", "aiPerMonth", "campaignEmailsPerMonth", "signaturesPerMonth", "storageMb", "chatGuests"];
export type Pack = { size: number; price: number };
export const LIMIT_PACKS = ["seats", "projects", "customDomains"] as const;
const isLimitPack = (k: PackKey): k is (typeof LIMIT_PACKS)[number] => (LIMIT_PACKS as readonly string[]).includes(k);

/** How a pack reads: "Team seats", and "+500 invoices a month" for `n` of it. */
export const PACK_LABEL: Record<PackKey, { name: string; amount: (n: number) => string }> = {
  seats: { name: "Team seats", amount: (n) => `${fmtN(n)} seat${n === 1 ? "" : "s"}` },
  projects: { name: "Web apps", amount: (n) => `${fmtN(n)} web app${n === 1 ? "" : "s"}` },
  customDomains: { name: "Custom domains", amount: (n) => `${fmtN(n)} custom domain${n === 1 ? "" : "s"}` },
  invoicesPerMonth: { name: "Invoices", amount: (n) => `${fmtN(n)} invoices a month` },
  contacts: { name: "CRM contacts", amount: (n) => `${fmtN(n)} contacts` },
  aiPerMonth: { name: "AI requests", amount: (n) => `${fmtN(n)} AI requests a month` },
  campaignEmailsPerMonth: { name: "Campaign emails", amount: (n) => `${fmtN(n)} campaign emails a month` },
  signaturesPerMonth: { name: "E-sign requests", amount: (n) => `${fmtN(n)} e-sign requests a month` },
  storageMb: { name: "Storage", amount: (n) => (n >= 1024 ? `${+(n / 1024).toFixed(1)} GB of storage` : `${fmtN(n)} MB of storage`) },
  chatGuests: { name: "Chat guests", amount: (n) => `${fmtN(n)} chat guests` },
};
const fmtN = (n: number) => Math.round(n).toLocaleString("en-IN");

/** What's added on top of a plan: features (each at its monthly price) and how many of each pack. */
export type Addons = { modules?: ModuleId[]; packs?: Partial<Record<PackKey, number>> };

/** A plan in the catalogue (Admin → Plans). modules null = every feature. */
export type CatalogPlan = {
  id: string;
  name: string;
  tagline: string;
  /** preset: a full plan; basic: a small plan for one area (e.g. Mail, Calendar and Chat); free: what a workspace has without paying. */
  kind: "preset" | "basic" | "free";
  modules: ModuleId[] | null;
  limits: Limits;
  /** Monthly allowances (unlimited when not set). */
  quotas?: Quotas;
  monthly: number;
  yearly: number;
  currency: string;
  highlight: boolean;
  active: boolean;
  sort: number;
};

/** Prices for building your own plan, and the rules every plan follows (Admin → Plans → Pricing). */
export type Pricing = {
  /** Off: every workspace is unrestricted (as before subscriptions existed). */
  enforce: boolean;
  /** After the trial (or a lapsed subscription) a workspace falls back to the Free plan instead of becoming read-only. */
  freePlan: boolean;
  /** Fair-use allowances during the trial (so it's generous, not unlimited). */
  trialQuotas: Quotas;
  currency: string;
  trialDays: number;
  /** Tax added to every invoice, in basis points (1800 = 18%). */
  taxBps: number;
  taxLabel: string;
  /** A yearly plan costs this many months (10 = two months free). Used for built plans. */
  yearlyMonths: number;
  /** Days after a missed renewal before the workspace becomes read-only. */
  graceDays: number;
  /** Renewal invoices are raised this many days before a period ends. */
  renewalNoticeDays: number;
  /** Build your own: the base (Mail, Calendar and Chat with the seats below) and each feature's monthly price. */
  customBase: number;
  customBaseModules: ModuleId[];
  customSeatsIncluded: number;
  seatPrice: number;
  customLimits: Omit<Limits, "seats">;
  modulePrices: Partial<Record<ModuleId, number>>;
  /** Build your own: allowances for every built plan; its AI budget comes from aiCostShareBps instead. */
  customQuotas: Quotas;
  /** The most of a plan's price (in basis points) its AI may cost — what keeps every plan in profit. */
  aiCostShareBps: number;
  /** Rupees per US dollar, for comparing AI spend (billed in dollars) with what a plan earns. */
  usdInr: number;
  /** Add-ons on top of any paid plan: each pack's size and monthly price. */
  packs: Record<PackKey, Pack>;
};

export const WORKDAY_MODULES: ModuleId[] = ["mail", "calendar", "chat"];

const rupees = (n: number) => Math.round(n * 100);

/** The catalogue a new platform starts with; every value is editable in the console. */
export const FREE_MODULES: ModuleId[] = ["mail", "calendar", "chat", "invoicing", "crm"];

// Each plan's allowances keep its running costs (AI, email, storage) well under
// its price: AI spend within DEFAULT_PRICING.aiCostShareBps (20%) of the price,
// campaign email and storage a few percent more — so no plan, used to its
// limits, costs more than it earns (tests/unit/subscription-pricing.test.ts).
const STARTER: ModuleId[] = ["store", "pos", "bookings", "promotions", "invoicing", "crm", "chatbot", "helpdesk", "portal", ...WORKDAY_MODULES];
const GROWTH: ModuleId[] = [...STARTER, "sales", "accounting", "hr", "inventory", "work", "marketing", "documents", "automations", "bi", "copilot", "growth", "data", "objects", "logistics"];
const BUSINESS: ModuleId[] = [...GROWTH, "horeca", "clinic", "education", "construction", "manufacturing", "quality", "maintenance", "grc"];

export const DEFAULT_PLANS: CatalogPlan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Mail, Calendar, Chat, invoices and a CRM to get going",
    kind: "free",
    modules: FREE_MODULES,
    limits: { projects: 1, seats: 2, customDomains: 0, automationsPerProject: 0 },
    quotas: { invoicesPerMonth: 10, contacts: 100, aiPerMonth: 25, aiBudgetUsd: 0.25, campaignEmailsPerMonth: 0, signaturesPerMonth: 3, storageMb: 500, chatGuests: 5 },
    monthly: 0,
    yearly: 0,
    currency: "INR",
    highlight: false,
    active: true,
    sort: -1,
  },
  {
    id: "workday",
    name: "Workday",
    tagline: "Mail, Calendar and Chat for the whole team",
    kind: "basic",
    modules: WORKDAY_MODULES,
    limits: { projects: 0, seats: 10, customDomains: 0, automationsPerProject: 0 },
    quotas: { aiPerMonth: 100, aiBudgetUsd: 0.45, storageMb: 2048, chatGuests: 25 },
    monthly: rupees(199),
    yearly: rupees(1990),
    currency: "INR",
    highlight: false,
    active: true,
    sort: 0,
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Your website, store and counter, with customers, invoices and support",
    kind: "preset",
    modules: STARTER,
    limits: { projects: 3, seats: 5, customDomains: 1, automationsPerProject: 10 },
    quotas: { invoicesPerMonth: 500, contacts: 2_000, aiPerMonth: 300, aiBudgetUsd: 2.25, campaignEmailsPerMonth: 1_000, signaturesPerMonth: 10, storageMb: 10_240, chatGuests: 50 },
    monthly: rupees(999),
    yearly: rupees(9990),
    currency: "INR",
    highlight: false,
    active: true,
    sort: 1,
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "Run sales, money, people and stock in one place",
    kind: "preset",
    modules: GROWTH,
    limits: { projects: 10, seats: 25, customDomains: 5, automationsPerProject: 25 },
    quotas: { invoicesPerMonth: 3_000, contacts: 20_000, aiPerMonth: 1_500, aiBudgetUsd: 7, campaignEmailsPerMonth: 10_000, signaturesPerMonth: 100, storageMb: 51_200, chatGuests: 250 },
    monthly: rupees(2999),
    yearly: rupees(29990),
    currency: "INR",
    highlight: true,
    active: true,
    sort: 2,
  },
  {
    id: "business",
    name: "Business",
    tagline: "Growth plus your industry suite, production and compliance",
    kind: "preset",
    modules: BUSINESS,
    limits: { projects: 25, seats: 50, customDomains: 10, automationsPerProject: 50 },
    quotas: { invoicesPerMonth: 10_000, contacts: 100_000, aiPerMonth: 4_000, aiBudgetUsd: 11.5, campaignEmailsPerMonth: 30_000, signaturesPerMonth: 500, storageMb: 153_600, chatGuests: 1_000 },
    monthly: rupees(4999),
    yearly: rupees(49990),
    currency: "INR",
    highlight: false,
    active: true,
    sort: 3,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Every feature, for larger teams and many sites",
    kind: "preset",
    modules: null,
    limits: { projects: 50, seats: 100, customDomains: 25, automationsPerProject: 100 },
    quotas: { aiPerMonth: 8_000, aiBudgetUsd: 18.5, campaignEmailsPerMonth: 75_000, signaturesPerMonth: 2_000, storageMb: 512_000 },
    monthly: rupees(7999),
    yearly: rupees(79990),
    currency: "INR",
    highlight: false,
    active: true,
    sort: 4,
  },
];

const HEAVY: ModuleId[] = ["accounting", "hr", "inventory", "manufacturing", "horeca", "education", "clinic", "construction", "logistics", "sales"];
const LIGHT: ModuleId[] = ["bookings", "promotions", "chatbot", "growth", "data", "objects", "portal"];

export const DEFAULT_PRICING: Pricing = {
  enforce: true,
  freePlan: true,
  trialQuotas: { invoicesPerMonth: 100, contacts: 1000, aiPerMonth: 200, aiBudgetUsd: 2, campaignEmailsPerMonth: 500, signaturesPerMonth: 10, storageMb: 5_120, chatGuests: 25 },
  currency: "INR",
  trialDays: 30,
  taxBps: 1800,
  taxLabel: "GST",
  yearlyMonths: 10,
  graceDays: 7,
  renewalNoticeDays: 7,
  customBase: rupees(199),
  customBaseModules: WORKDAY_MODULES,
  customSeatsIncluded: 3,
  seatPrice: rupees(99),
  customLimits: { projects: 3, customDomains: 1, automationsPerProject: 25 },
  modulePrices: Object.fromEntries(
    MODULE_IDS.filter((m) => !WORKDAY_MODULES.includes(m)).map((m) => [m, rupees(HEAVY.includes(m) ? 499 : LIGHT.includes(m) ? 149 : 299)]),
  ) as Partial<Record<ModuleId, number>>,
  customQuotas: { invoicesPerMonth: 1_000, contacts: 5_000, aiPerMonth: 500, campaignEmailsPerMonth: 2_000, signaturesPerMonth: 25, storageMb: 20_480, chatGuests: 100 },
  aiCostShareBps: 2000,
  usdInr: 85,
  // Each pack's running cost (AI, email, storage) stays well under its price, like the plans'.
  packs: {
    seats: { size: 1, price: rupees(99) },
    projects: { size: 1, price: rupees(299) },
    customDomains: { size: 1, price: rupees(149) },
    invoicesPerMonth: { size: 500, price: rupees(99) },
    contacts: { size: 5_000, price: rupees(199) },
    aiPerMonth: { size: 500, price: rupees(299) },
    campaignEmailsPerMonth: { size: 5_000, price: rupees(399) },
    signaturesPerMonth: { size: 25, price: rupees(199) },
    storageMb: { size: 10_240, price: rupees(99) },
    chatGuests: { size: 50, price: rupees(99) },
  },
};

/** The most a plan earning `monthly` (minor units, before tax) may spend on AI each month, in US dollars. */
export const aiBudgetFor = (monthly: number, p: Pick<Pricing, "aiCostShareBps" | "usdInr">) => Math.floor(((monthly / 100) * p.aiCostShareBps) / 10000 / Math.max(1, p.usdInr) * 100) / 100;

/** What someone chooses: a plan from the catalogue, or features of their own — either with add-ons. */
export type Choice = { kind: "plan"; planId: string; interval: Interval; addons?: Addons } | { kind: "custom"; modules: ModuleId[]; seats: number; interval: Interval; addons?: Addons };

/** One priced line. Add-on lines say which (`addon`), and packs how many (`qty`). */
export type QuoteLine = { label: string; amount: number; module?: ModuleId; addon?: "module" | PackKey; qty?: number };

/** A priced choice: what it includes and what one period costs before tax. */
export type Quote = {
  planId: string;
  name: string;
  modules: ModuleId[] | null;
  limits: Limits;
  quotas: Quotas;
  seats: number;
  interval: Interval;
  currency: string;
  lines: QuoteLine[];
  /** One period, before tax. */
  amount: number;
  /** The same, per month (for comparing and for MRR). */
  monthly: number;
};

export class QuoteError extends Error {}

/** Prices a choice. Throws QuoteError for anything that can't be sold. */
export function quote(choice: Choice, plans: CatalogPlan[], pricing: Pricing): Quote {
  const base = choice.kind === "plan" ? planBase(choice, plans) : customBase(choice, pricing);
  return withAddons(base, choice.kind === "plan" ? choice.addons : { packs: choice.addons?.packs }, choice.interval, pricing);
}

type Base = Omit<Quote, "monthly">;

function planBase(choice: Extract<Choice, { kind: "plan" }>, plans: CatalogPlan[]): Base {
  const p = plans.find((x) => x.id === choice.planId && x.active);
  if (!p) throw new QuoteError("That plan isn't available.");
  if (p.kind === "free") throw new QuoteError("Free is what you're on without a paid plan — cancel the current plan to move to it at the end of the period.");
  const amount = choice.interval === "year" ? p.yearly : p.monthly;
  return {
    planId: p.id,
    name: p.name,
    modules: p.modules ? [...p.modules] : null,
    limits: { ...p.limits },
    quotas: { ...(p.quotas ?? {}) },
    seats: p.limits.seats,
    interval: choice.interval,
    currency: p.currency,
    lines: [{ label: `${p.name} plan, ${choice.interval === "year" ? "yearly" : "monthly"}`, amount }],
    amount,
  };
}

function customBase(choice: Extract<Choice, { kind: "custom" }>, pricing: Pricing): Base {
  const seats = Math.floor(choice.seats);
  if (!Number.isFinite(seats) || seats < pricing.customSeatsIncluded || seats > 10000) throw new QuoteError(`Choose between ${pricing.customSeatsIncluded} and 10,000 seats.`);
  if (choice.addons?.packs?.seats) throw new QuoteError("Choose a built plan's seats with its seat count.");
  const unknown = [...choice.modules, ...(choice.addons?.modules ?? [])].filter((m) => !MODULE_IDS.includes(m));
  if (unknown.length) throw new QuoteError(`Unknown feature: ${unknown[0]}`);
  // Features another one needs come along with it, and the base is always included.
  const picked = withRequirements([...new Set([...pricing.customBaseModules, ...choice.modules, ...(choice.addons?.modules ?? [])])]);
  const extra = picked.filter((m) => !pricing.customBaseModules.includes(m)).sort((a, b) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(b));
  const missing = extra.filter((m) => typeof pricing.modulePrices[m] !== "number");
  if (missing.length) throw new QuoteError(`${missing[0]} can't be added to a plan yet.`);
  const perMonth: QuoteLine[] = [
    { label: "Base: Mail, Calendar and Chat", amount: pricing.customBase },
    ...extra.map((m) => ({ label: m, amount: pricing.modulePrices[m]!, module: m })),
  ];
  const extraSeats = seats - pricing.customSeatsIncluded;
  if (extraSeats > 0) perMonth.push({ label: `${extraSeats} extra seat${extraSeats === 1 ? "" : "s"}`, amount: extraSeats * pricing.seatPrice });
  const monthly = perMonth.reduce((s, l) => s + l.amount, 0);
  const months = choice.interval === "year" ? pricing.yearlyMonths : 1;
  return {
    planId: "custom",
    name: "Your plan",
    modules: picked,
    limits: { ...pricing.customLimits, seats },
    // A built plan's AI budget grows with what it costs, so it never spends more on AI than it earns.
    quotas: { ...(pricing.customQuotas ?? {}), aiBudgetUsd: aiBudgetFor(monthly, pricing) },
    seats,
    interval: choice.interval,
    currency: pricing.currency,
    lines: perMonth.map((l) => ({ ...l, amount: l.amount * months })),
    amount: monthly * months,
  };
}

/**
 * Adds features and packs to a priced plan. Each add-on costs its monthly price
 * a month (a yearly plan: yearlyMonths of them, the same saving as a built
 * plan). Features the plan already has, and packs for what it has without
 * limit, are left out, so add-ons carry over when the plan changes.
 */
function withAddons(b: Base, addons: Addons | undefined, interval: Interval, pricing: Pricing): Quote {
  const months = interval === "year" ? pricing.yearlyMonths : 1;
  const packs = pricing.packs ?? DEFAULT_PRICING.packs;
  const lines = [...b.lines];
  const out = { modules: b.modules, limits: { ...b.limits }, quotas: { ...b.quotas }, seats: b.seats };
  let perMonth = 0;
  const add = (l: QuoteLine) => {
    perMonth += l.amount;
    lines.push({ ...l, amount: l.amount * months });
  };
  const wanted = addons?.modules ?? [];
  if (wanted.length && out.modules) {
    const unknown = wanted.filter((m) => !MODULE_IDS.includes(m));
    if (unknown.length) throw new QuoteError(`Unknown feature: ${unknown[0]}`);
    const all = withRequirements([...new Set([...out.modules, ...wanted])]);
    const extra = all.filter((m) => !out.modules!.includes(m)).sort((a, z) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(z));
    const missing = extra.filter((m) => typeof pricing.modulePrices[m] !== "number");
    if (missing.length) throw new QuoteError(`${missing[0]} can't be added to a plan yet.`);
    for (const m of extra) add({ label: m, amount: pricing.modulePrices[m]!, module: m, addon: "module" });
    out.modules = all;
  }
  for (const k of PACK_KEYS) {
    const n = addons?.packs?.[k] ?? 0;
    if (!n) continue;
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new QuoteError("Choose between 0 and 1,000 of each add-on.");
    const pk = packs[k];
    if (!pk || pk.size <= 0) throw new QuoteError(`${PACK_LABEL[k].name} can't be added yet.`);
    const more = n * pk.size;
    if (isLimitPack(k)) {
      if (!Number.isFinite(out.limits[k])) continue;
      out.limits[k] += more;
      if (k === "seats") out.seats += more;
    } else {
      if (out.quotas[k] === undefined) continue;
      out.quotas[k] = out.quotas[k]! + more;
      // More AI requests bring the AI budget their price pays for.
      if (k === "aiPerMonth" && out.quotas.aiBudgetUsd !== undefined) out.quotas.aiBudgetUsd = Math.round((out.quotas.aiBudgetUsd + aiBudgetFor(n * pk.price, pricing)) * 100) / 100;
    }
    add({ label: `+${PACK_LABEL[k].amount(more)}`, amount: n * pk.price, addon: k, qty: n });
  }
  const amount = b.amount + perMonth * months;
  return { planId: b.planId, name: b.name, interval, currency: b.currency, ...out, lines, amount, monthly: interval === "year" ? Math.round(amount / 12) : amount };
}

/** The add-ons in a subscription's lines (what was bought on top of its plan). */
export function addonsOf(lines: { module?: string; addon?: string; qty?: number }[] | null | undefined): Required<Addons> {
  const modules: ModuleId[] = [];
  const packs: Partial<Record<PackKey, number>> = {};
  for (const l of lines ?? []) {
    if (l.addon === "module" && l.module) modules.push(l.module as ModuleId);
    else if (l.qty && PACK_KEYS.includes(l.addon as PackKey)) packs[l.addon as PackKey] = (packs[l.addon as PackKey] ?? 0) + l.qty;
  }
  return { modules, packs };
}

/**
 * Top-ups: monthly allowances bought once, paid at once, on any plan (Free
 * too). They're used only after the plan's own allowance runs out, and what's
 * left carries over to later months — so nobody pays for what they don't use.
 */
export type TopupKey = "aiPerMonth" | "invoicesPerMonth" | "campaignEmailsPerMonth" | "signaturesPerMonth";
export const TOPUP_KEYS: TopupKey[] = ["aiPerMonth", "invoicesPerMonth", "campaignEmailsPerMonth", "signaturesPerMonth"];
export const isTopupKey = (k: string): k is TopupKey => (TOPUP_KEYS as string[]).includes(k);

export type TopupQuote = { lines: (QuoteLine & { addon: TopupKey; qty: number })[]; amount: number; units: Partial<Record<TopupKey | "aiBudgetUsd", number>> };

/** Prices top-ups (packs of each allowance, bought once). Throws QuoteError for anything that can't be sold. */
export function topupQuote(packs: Partial<Record<TopupKey, number>>, pricing: Pick<Pricing, "packs" | "aiCostShareBps" | "usdInr">): TopupQuote {
  const all = pricing.packs ?? DEFAULT_PRICING.packs;
  const lines: TopupQuote["lines"] = [];
  const units: TopupQuote["units"] = {};
  for (const k of TOPUP_KEYS) {
    const n = packs[k] ?? 0;
    if (!n) continue;
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new QuoteError("Choose between 1 and 100 packs at a time.");
    const pk = all[k];
    if (!pk || pk.size <= 0 || pk.price <= 0) throw new QuoteError(`${PACK_LABEL[k].name} can't be topped up yet.`);
    // Bought once, so no "a month".
    lines.push({ label: `+${PACK_LABEL[k].amount(n * pk.size).replace(/ a month$/, "")} (top-up)`, amount: n * pk.price, addon: k, qty: n });
    units[k] = n * pk.size;
    // AI requests bring the AI spend their price pays for, like a plan's.
    if (k === "aiPerMonth") units.aiBudgetUsd = aiBudgetFor(n * pk.price, pricing);
  }
  if (!lines.length) throw new QuoteError("Choose what to top up.");
  return { lines, amount: lines.reduce((s, l) => s + l.amount, 0), units };
}

/**
 * The most a pack can cost the platform to run, in minor units: its AI spend,
 * campaign email and storage (per month), plus the payment fee. Used to keep
 * every price above its cost (tests/unit/subscription-pricing.test.ts).
 */
export const RUN_COST = { emailUsd: 0.0004, storageGbUsd: 0.023, paymentFeeBps: 236 };
export function packCost(k: PackKey, pack: Pack, p: Pick<Pricing, "aiCostShareBps" | "usdInr">) {
  const usd = k === "campaignEmailsPerMonth" ? pack.size * RUN_COST.emailUsd : k === "storageMb" ? (pack.size / 1024) * RUN_COST.storageGbUsd : 0;
  const ai = k === "aiPerMonth" ? aiBudgetFor(pack.price, p) * p.usdInr * 100 : 0;
  return Math.round(usd * p.usdInr * 100 + ai + (pack.price * RUN_COST.paymentFeeBps) / 10000);
}

/** Whether a line is an add-on (not the plan itself). */
export const isAddonLine = (l: Pick<QuoteLine, "addon">) => !!l.addon;

/** Adds a period (calendar months, so 31 Jan + 1 month = 28/29 Feb). */
export function addInterval(from: Date, interval: Interval, n = 1): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (interval === "year" ? 12 * n : n));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const taxOf = (amount: number, bps: number) => Math.round((amount * bps) / 10000);

/**
 * Moving to a new choice in the middle of a paid period. The unused share of
 * what was paid becomes credit; the new choice is charged for the time left
 * (same interval) or for a fresh period starting now (interval changes).
 * Shares are measured to the second.
 */
export function prorate(input: { current: { amount: number; interval: Interval }; periodStart: Date; periodEnd: Date; now: Date; next: { amount: number; interval: Interval } }) {
  const total = input.periodEnd.getTime() - input.periodStart.getTime();
  const left = Math.max(0, Math.min(total, input.periodEnd.getTime() - input.now.getTime()));
  const share = total > 0 ? left / total : 0;
  const credit = Math.round(input.current.amount * share);
  if (input.next.interval === input.current.interval) {
    const charge = Math.round(input.next.amount * share);
    return { credit, charge, periodStart: input.periodStart, periodEnd: input.periodEnd, share };
  }
  return { credit, charge: input.next.amount, periodStart: input.now, periodEnd: addInterval(input.now, input.next.interval), share };
}

/** A change is an upgrade (applied now, after paying the difference) unless it costs less per month. */
export const isDowngrade = (from: { monthly: number; modules: readonly string[] | null; limits: Limits }, to: { monthly: number; modules: readonly string[] | null; limits: Limits }) =>
  to.monthly < from.monthly || (from.modules === null && to.modules !== null) || (!!from.modules && !!to.modules && from.modules.some((m) => !to.modules!.includes(m)));

// ── What a workspace may use right now ──────────────────────────────────────

export type SubState = "trial" | "active" | "grace" | "canceling" | "free" | "expired" | "unrestricted";

export type SubscriptionLike = {
  status: string;
  modules: string[] | null;
  limits: Limits;
  quotas?: Quotas | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  complimentary: boolean;
  compUntil: Date | null;
};

export type Entitlement = { state: SubState; modules: string[] | null; limits: Limits; quotas: Quotas; until: Date | null };

/** What a workspace without a paid plan gets (the Free plan), when the platform offers one. */
export type FreeTier = { modules: string[] | null; limits: Limits; quotas: Quotas } | null;

const NONE: Limits = { projects: 0, seats: 0, customDomains: 0, automationsPerProject: 0 };

/** Decided from dates (not the status column), so it's right even between scheduler runs. */
export function entitlement(sub: SubscriptionLike | null, trialLimits: Limits, now = new Date(), enforce = true, extra: { free?: FreeTier; trialQuotas?: Quotas } = {}): Entitlement {
  const all = { projects: Infinity, seats: Infinity, customDomains: Infinity, automationsPerProject: Infinity };
  if (!enforce || !sub) return { state: "unrestricted", modules: null, limits: all, quotas: {}, until: null };
  const q = sub.quotas ?? {};
  if (sub.complimentary && (!sub.compUntil || sub.compUntil > now)) return { state: "active", modules: sub.modules, limits: sub.limits, quotas: q, until: sub.compUntil };
  if (sub.trialEndsAt && sub.trialEndsAt > now && sub.status === "trialing") return { state: "trial", modules: null, limits: trialLimits, quotas: extra.trialQuotas ?? {}, until: sub.trialEndsAt };
  if (sub.currentPeriodEnd && sub.currentPeriodEnd > now) return { state: sub.cancelAtPeriodEnd ? "canceling" : "active", modules: sub.modules, limits: sub.limits, quotas: q, until: sub.currentPeriodEnd };
  if (sub.graceEndsAt && sub.graceEndsAt > now) return { state: "grace", modules: sub.modules, limits: sub.limits, quotas: q, until: sub.graceEndsAt };
  // No paid plan in force: the Free plan if there is one, else read-only.
  if (extra.free) return { state: "free", modules: extra.free.modules, limits: extra.free.limits, quotas: extra.free.quotas, until: null };
  return { state: "expired", modules: [], limits: NONE, quotas: {}, until: null };
}

/** Whether a feature is included (null = every feature). */
export const entitledTo = (modules: readonly string[] | null | undefined, id: string) => modules === undefined || modules === null || modules.includes(id);

export function money(amount: number, currency = "INR") {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(amount / 100);
}
