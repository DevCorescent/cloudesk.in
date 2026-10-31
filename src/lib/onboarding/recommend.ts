// Recommending a workspace from a few answers about the business. Plain rules,
// not AI: every module it suggests carries the reasons it was suggested (the
// answers that led to it), so the person can see why and change anything.
//
// Answers come from three places, in order: the industry's usual answers, what
// the one-line description mentions, and then whatever the person taps.
import { industryById, withRequirements, type IndustryId, type ModuleId } from "@/lib/workspace/modules";

export type Sell = "online" | "counter" | "tables" | "rooms" | "bookings" | "invoices" | "contracts";
export type Team = "solo" | "small" | "medium" | "large";
export type Track = "stock" | "production" | "assets" | "delivery" | "projects" | "documents";
export type Money = "invoices" | "accounts" | "payroll" | "expenses";
export type Cust = "leads" | "support" | "marketing" | "portal" | "chat";

export type Profile = { sell: Sell[]; team: Team | null; track: Track[]; money: Money[]; customers: Cust[] };
export const EMPTY: Profile = { sell: [], team: null, track: [], money: [], customers: [] };

type Opt<T extends string> = { id: T; label: string; hint: string };

/** The questions, in the order they're asked. */
export const QUESTIONS = {
  sell: {
    title: "How do customers buy from you?",
    sub: "Pick all that apply.",
    multi: true,
    options: [
      { id: "online", label: "Online", hint: "A website shop with cart and checkout" },
      { id: "counter", label: "At a counter", hint: "Walk-in customers, billing at a till" },
      { id: "tables", label: "At tables", hint: "Dine-in with QR menus and a kitchen" },
      { id: "rooms", label: "Rooms & stays", hint: "Guests checking in and out" },
      { id: "bookings", label: "By appointment", hint: "Slots, classes or reservations" },
      { id: "invoices", label: "On invoice", hint: "You bill clients for work or goods" },
      { id: "contracts", label: "Projects & contracts", hint: "Long jobs billed in stages" },
    ] as Opt<Sell>[],
  },
  team: {
    title: "How big is your team?",
    sub: "Including you.",
    multi: false,
    options: [
      { id: "solo", label: "Just me", hint: "1 person" },
      { id: "small", label: "Small", hint: "2–10 people" },
      { id: "medium", label: "Growing", hint: "11–50 people" },
      { id: "large", label: "Established", hint: "50+ people" },
    ] as Opt<Team>[],
  },
  track: {
    title: "What do you need to keep track of?",
    sub: "Pick all that apply.",
    multi: true,
    options: [
      { id: "stock", label: "Stock & suppliers", hint: "What's in hand, what to reorder" },
      { id: "production", label: "Making products", hint: "Recipes, work orders, quality checks" },
      { id: "assets", label: "Machines & equipment", hint: "Servicing and breakdowns" },
      { id: "delivery", label: "Deliveries & vehicles", hint: "Shipments, trips, your fleet" },
      { id: "projects", label: "Projects & hours", hint: "Tasks, timesheets, billing time" },
      { id: "documents", label: "Contracts & documents", hint: "Files, renewals, e-signatures" },
    ] as Opt<Track>[],
  },
  money: {
    title: "What should we handle for your money?",
    sub: "Pick all that apply.",
    multi: true,
    options: [
      { id: "invoices", label: "GST invoices & payments", hint: "Quotes, invoices, who owes what" },
      { id: "accounts", label: "Full accounting", hint: "Books, P&L, bank reconciliation, GST returns" },
      { id: "payroll", label: "Salaries & payroll", hint: "Payslips with PF, ESI and TDS" },
      { id: "expenses", label: "Bills & expenses", hint: "What you owe suppliers, staff claims" },
    ] as Opt<Money>[],
  },
  customers: {
    title: "How do you look after customers?",
    sub: "Pick all that apply — or none.",
    multi: true,
    options: [
      { id: "leads", label: "Leads & deals", hint: "A sales pipeline and follow-ups" },
      { id: "support", label: "Support tickets", hint: "Questions and complaints, with response targets" },
      { id: "marketing", label: "Email campaigns", hint: "Newsletters, offers and events" },
      { id: "portal", label: "A customer login", hint: "They see their invoices and orders" },
      { id: "chat", label: "Website chat", hint: "Answers questions from your content" },
    ] as Opt<Cust>[],
  },
} as const;

export type QuestionId = keyof typeof QUESTIONS;
export const QUESTION_IDS = Object.keys(QUESTIONS) as QuestionId[];

/** What businesses in each industry usually answer. */
const USUAL: Record<IndustryId, Partial<Profile>> = {
  retail: { sell: ["online", "counter"], team: "small", track: ["stock"], money: ["invoices", "accounts", "payroll"], customers: ["leads"] },
  food: { sell: ["online", "counter"], team: "small", track: ["stock", "production"], money: ["invoices"] },
  home: { sell: ["online"], team: "small", track: ["stock"], money: ["invoices"], customers: ["leads"] },
  restaurant: { sell: ["tables"], team: "small", track: ["stock"], money: ["invoices", "payroll"] },
  cafe: { sell: ["tables", "counter"], team: "small", money: ["invoices", "payroll"] },
  bar: { sell: ["tables"], team: "small", track: ["stock"], money: ["invoices"] },
  hotel: { sell: ["rooms", "tables", "bookings"], team: "medium", money: ["invoices", "payroll"], customers: ["leads"] },
  salon: { sell: ["bookings", "counter"], team: "small", money: ["invoices", "payroll"], customers: ["leads", "marketing"] },
  clinic: { sell: ["bookings"], team: "small", money: ["invoices", "accounts", "payroll"], customers: ["leads", "chat"] },
  fitness: { sell: ["bookings"], team: "small", money: ["invoices", "payroll"], customers: ["leads", "marketing"] },
  services: { sell: ["invoices"], team: "small", track: ["projects"], money: ["invoices", "accounts", "payroll"], customers: ["leads"] },
  education: { sell: ["invoices"], team: "medium", money: ["invoices", "accounts", "payroll"], customers: ["leads", "support"] },
  construction: { sell: ["contracts"], team: "medium", track: ["stock", "assets", "documents"], money: ["invoices", "accounts", "payroll", "expenses"] },
  software: { sell: ["online", "invoices"], team: "small", track: ["projects"], money: ["invoices", "payroll"], customers: ["leads", "support", "chat"] },
  other: { money: ["invoices"] },
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Merges answers: lists are combined, the team size from `b` wins when given. */
export function merge(a: Profile, b: Partial<Profile>): Profile {
  return {
    sell: uniq([...a.sell, ...(b.sell ?? [])]),
    team: b.team ?? a.team,
    track: uniq([...a.track, ...(b.track ?? [])]),
    money: uniq([...a.money, ...(b.money ?? [])]),
    customers: uniq([...a.customers, ...(b.customers ?? [])]),
  };
}

export const usualFor = (industry: IndustryId | null): Profile => merge(EMPTY, industry ? USUAL[industry] : {});

// ─── Reading the one-line description ────────────────────────────────────────

const has = (t: string, words: string[]) => words.some((w) => (w.endsWith("*") ? new RegExp(`\\b${w.slice(0, -1)}`).test(t) : new RegExp(`\\b${w}s?\\b`).test(t)));

/** What a sentence about the business says, as answers (and the words that said it). */
export function fromBrief(raw: string): { profile: Partial<Profile>; heard: string[] } {
  const t = raw.toLowerCase();
  const p: Required<Omit<Profile, "team">> & { team: Team | null } = { sell: [], team: null, track: [], money: [], customers: [] };
  const heard: string[] = [];
  const hit = <K extends "sell" | "track" | "money" | "customers">(key: K, value: Profile[K][number], words: string[], say: string) => {
    if (has(t, words)) {
      (p[key] as string[]).push(value);
      heard.push(say);
    }
  };
  hit("sell", "online", ["online", "website", "ecommerce", "e-commerce", "instagram", "deliver* across", "ship*", "d2c", "amazon", "flipkart"], "sells online");
  hit("sell", "counter", ["shop", "store", "showroom", "outlet", "counter", "walk-in", "kiosk", "stall", "retail"], "has a counter");
  hit("sell", "tables", ["restaurant", "cafe", "café", "dine", "dining", "bar", "pub", "bistro", "dhaba", "eatery"], "serves tables");
  hit("sell", "rooms", ["hotel", "resort", "homestay", "rooms", "guest house", "villa", "hostel"], "has rooms");
  hit("sell", "bookings", ["appointment", "booking", "slot", "class", "session", "salon", "spa", "clinic", "studio", "reserv*"], "takes bookings");
  hit("sell", "invoices", ["client", "b2b", "wholesale", "distribut*", "consult*", "agency", "service", "retainer"], "bills clients");
  hit("sell", "contracts", ["contract*", "construction", "civil", "interior", "builder", "infrastructure", "epc", "turnkey"], "works on contracts");
  hit("track", "stock", ["stock", "inventory", "warehouse", "godown", "supplier", "wholesale", "distribut*", "retail", "spare"], "keeps stock");
  hit("track", "production", ["manufactur*", "factory", "production", "make our own", "handmade", "bakery", "brew*", "fabricat*", "assembl*"], "makes products");
  hit("track", "assets", ["machine*", "equipment", "plant", "maintenance", "servic* equipment"], "runs equipment");
  hit("track", "delivery", ["deliver*", "logistic*", "transport*", "fleet", "truck*", "courier", "dispatch*"], "delivers");
  hit("track", "projects", ["project", "agency", "studio", "consult*", "software", "freelanc*", "timesheet", "billable"], "works in projects");
  hit("track", "documents", ["contract*", "legal", "compliance", "e-sign*", "agreement"], "handles contracts");
  hit("money", "accounts", ["accounting", "books", "gst return", "ledger", "audit", "ca "], "keeps books");
  hit("money", "payroll", ["staff", "employee", "team of", "payroll", "salar*", "workers"], "pays staff");
  hit("money", "expenses", ["expense*", "vendor bill", "purchase*"], "pays bills");
  hit("customers", "leads", ["lead*", "sales team", "pipeline", "b2b", "enquir*", "clients"], "follows up leads");
  hit("customers", "support", ["support", "complaint*", "ticket*", "helpdesk", "after-sales", "warranty"], "supports customers");
  hit("customers", "marketing", ["newsletter", "campaign*", "marketing", "email list", "events"], "markets by email");
  hit("customers", "chat", ["chat", "faq", "whatsapp"], "answers questions");
  const n = /\b(\d{1,5})\s*(?:\+\s*)?(?:people|staff|employees|members|workers|person team|-person)\b/.exec(t) ?? /\bteam of (\d{1,5})\b/.exec(t);
  if (n) {
    const k = Number(n[1]);
    p.team = k <= 1 ? "solo" : k <= 10 ? "small" : k <= 50 ? "medium" : "large";
    heard.push(`${k} people`);
  } else if (/\b(just me|solo|on my own|by myself|freelancer)\b/.test(t)) {
    p.team = "solo";
    heard.push("works alone");
  }
  return { profile: { ...p, team: p.team ?? undefined }, heard: uniq(heard) };
}

// ─── From answers to modules ─────────────────────────────────────────────────

export type Recommendation = { modules: ModuleId[]; why: Partial<Record<ModuleId, string[]>> };

/** The modules a profile points to, each with the reasons why. */
export function recommend(profile: Profile, industry: IndustryId | null): Recommendation {
  const why: Partial<Record<ModuleId, string[]>> = {};
  const add = (m: ModuleId, reason: string) => {
    const list = (why[m] ??= []);
    if (!list.includes(reason)) list.push(reason);
  };
  const s = new Set(profile.sell);
  const k = new Set(profile.track);
  const $ = new Set(profile.money);
  const c = new Set(profile.customers);

  if (s.has("online")) {
    add("store", "You sell online");
    add("promotions", "Offers and cart recovery for your online shop");
    add("growth", "See who visits your shop and what they buy");
  }
  if (s.has("counter")) {
    add("pos", "You bill customers at a counter");
    add("store", "The counter till shares your product list");
  }
  if (s.has("tables") || s.has("rooms")) add("horeca", s.has("rooms") ? "You run rooms and dining" : "You serve customers at tables");
  if (s.has("bookings")) {
    add("bookings", "Customers book appointments with you");
    add("automations", "Reminders before every booking");
  }
  if (s.has("invoices") || s.has("contracts") || $.has("invoices")) add("invoicing", s.has("invoices") ? "You bill clients on invoice" : "GST invoices and who owes you what");
  if (s.has("contracts")) {
    add("work", "Track each project's tasks, hours and stages");
    add("documents", "Keep contracts and signed documents together");
  }
  if (industry === "clinic") add("clinic", "Patients, queue, prescriptions and clinic bills");
  if (industry === "education") add("education", "Students, fees, attendance and report cards");
  if (industry === "construction") add("construction", "BOQ, measurements and RA bills for your contracts");

  if (k.has("stock")) add("inventory", "You keep stock and buy from suppliers");
  if (k.has("production")) {
    add("manufacturing", "You make your own products");
    add("quality", "Check what you make before it ships");
  }
  if (k.has("assets")) add("maintenance", "Servicing and breakdowns for your equipment");
  if (k.has("delivery")) add("logistics", "Shipments, trips and your vehicles");
  if (k.has("projects")) add("work", "You work in projects and track hours");
  if (k.has("documents")) add("documents", "Contracts with renewals and e-signatures");
  if (k.has("stock") && (s.has("invoices") || c.has("leads")) && !(s.size === 1 && s.has("online"))) add("sales", "Orders from business customers, with price lists and credit limits");

  if ($.has("accounts")) add("accounting", "Books, P&L, bank reconciliation and GST returns");
  if ($.has("expenses")) add("accounting", "Supplier bills, expenses and TDS");
  if ($.has("payroll")) add("hr", "Salaries with PF, ESI and payslips");
  if (profile.team && profile.team !== "solo") add("hr", "Attendance and leave for your team");

  if (c.has("leads")) add("crm", "Track leads and follow up on deals");
  if (c.has("support")) add("helpdesk", "Support tickets with response targets");
  // Every business has email: one inbox for all its mailboxes.
  add("mail", "All your business email in one smart inbox");
  add("calendar", "Meetings from your email, with reminders and minutes");
  add("chat", "Team chat with channels, threads and AI catch-up");
  if (c.has("marketing")) add("marketing", "Email campaigns to your contacts");
  if (c.has("portal")) add("portal", "Customers see their invoices and orders themselves");
  if (c.has("chat")) add("chatbot", "Answers visitors' questions from your content");

  const count = Object.keys(why).length;
  if (profile.team === "medium" || profile.team === "large" || count >= 7) add("bi", "Reports and dashboards across everything you run");
  if (profile.team === "large") add("grc", "Compliance calendar, policies and risk register");
  if (count >= 8) add("copilot", "Ask questions across all your data in plain words");

  // Every business gets paid: invoices come with anything that sells.
  if (!why.invoicing && (s.size || industry)) add("invoicing", "GST invoices and payments");

  const chosen = Object.keys(why) as ModuleId[];
  const modules = withRequirements(chosen);
  for (const m of modules) if (!why[m]) why[m] = ["Needed by another feature you're getting"];
  return { modules, why };
}

/** The usual answers for an industry plus what the description says. */
export function profileFor(industry: IndustryId | null, brief: string): { profile: Profile; heard: string[] } {
  const b = fromBrief(brief);
  return { profile: merge(usualFor(industry), b.profile), heard: b.heard };
}

export const industryLabel = (id: IndustryId | null) => industryById(id)?.label ?? "business";
