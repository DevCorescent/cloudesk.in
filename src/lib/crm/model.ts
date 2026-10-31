// CRM: the shared vocabulary (lifecycle, activity kinds, settings), input
// schemas and the pure rules — matching people, scoring leads, merge fields in
// emails and the weighted forecast. Used by the server and the dashboard.
import { z } from "zod";

export const LIFECYCLE = ["subscriber", "lead", "qualified", "opportunity", "customer", "evangelist", "other"] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { subscriber: "Subscriber", lead: "Lead", qualified: "Qualified", opportunity: "Opportunity", customer: "Customer", evangelist: "Fan", other: "Other" };
export const LEAD_STATUS = ["new", "contacted", "working", "unqualified"] as const;
export const LEAD_STATUS_LABEL: Record<(typeof LEAD_STATUS)[number], string> = { new: "New", contacted: "Contacted", working: "Working", unqualified: "Unqualified" };

export const ACTIVITY_KINDS = ["note", "call", "email", "meeting", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number] | "event";
export const CALL_OUTCOMES = ["connected", "no_answer", "voicemail", "busy", "wrong_number"] as const;
export const MEETING_OUTCOMES = ["held", "no_show", "rescheduled"] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
export const ENTITIES = ["contact", "company", "deal"] as const;
export type Entity = (typeof ENTITIES)[number];
export const FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "url"] as const;

/** Where a contact came from. Captured ones are set by the system. */
export const SOURCE_LABEL: Record<string, string> = {
  newsletter: "Newsletter sign-up",
  manual: "Added by hand",
  import: "Imported",
  web_form: "Website form",
  web_to_lead: "Lead form",
  store: "Online store",
  pos: "Shop counter",
  booking: "Booking",
  horeca: "Restaurant / hotel",
  invoicing: "Invoicing client",
  referral: "Referral",
  event: "Event",
  ads: "Ads",
  social: "Social media",
  cold: "Outbound",
  partner: "Partner",
};

const text = (max: number) => z.string().trim().max(max).default("");
const tags = z.array(z.string().trim().min(1).max(40)).max(30).default([]);
const custom = z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({});
const uuidOrNull = z.uuid().nullable().default(null);

export const contactSchema = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().max(200).default("").refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email"),
  phone: text(30),
  title: text(120),
  companyId: uuidOrNull,
  /** Typed instead of picked: finds or creates the company. */
  companyName: text(160),
  ownerId: uuidOrNull,
  lifecycle: z.enum(LIFECYCLE).default("lead"),
  leadStatus: z.enum(LEAD_STATUS).default("new"),
  source: z.string().trim().max(40).default("manual"),
  tags,
  custom,
  city: text(80),
  country: text(80),
  marketing: z.boolean().default(false),
  doNotContact: z.boolean().default(false),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const companySchema = z.object({
  name: z.string().trim().min(1, "Add the company name").max(160),
  domain: z.string().trim().toLowerCase().max(120).default("").transform((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")),
  industry: text(80),
  size: text(40),
  phone: text(30),
  website: text(200),
  address: text(300),
  city: text(80),
  country: text(80),
  gstin: text(15),
  ownerId: uuidOrNull,
  tags,
  custom,
  notes: text(4000),
});

export const dealSchema = z.object({
  title: z.string().trim().min(1, "Name the deal").max(160),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  value: z.number().int().min(0).max(1e13).default(0),
  currency: z.string().trim().length(3).default("INR"),
  contactId: uuidOrNull,
  companyId: uuidOrNull,
  ownerId: uuidOrNull,
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  source: text(40),
  priority: z.enum(PRIORITIES).default("normal"),
  tags,
  custom,
});

export const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  subject: text(200),
  body: text(10000),
  contactId: uuidOrNull,
  companyId: uuidOrNull,
  dealId: uuidOrNull,
  ownerId: uuidOrNull,
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  done: z.boolean().default(false),
  outcome: text(40),
  durationMin: z.number().int().min(0).max(1440).nullable().default(null),
  priority: z.enum(PRIORITIES).default("normal"),
});

export const stageSchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(60), probability: z.number().int().min(0).max(100), kind: z.enum(["open", "won", "lost"]).default("open"), rotDays: z.number().int().min(0).max(365).default(0) });
export const pipelineSchema = z.object({ name: z.string().trim().min(1, "Name the pipeline").max(60), stages: z.array(stageSchema).min(2).max(20) });

export const fieldSchema = z.object({
  entity: z.enum(ENTITIES),
  label: z.string().trim().min(1, "Name the field").max(60),
  type: z.enum(FIELD_TYPES).default("text"),
  options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});

export const SEQUENCE_STEP = z.object({
  kind: z.enum(["email", "task"]),
  /** Days after the previous step (the first: after enrolling). */
  delayDays: z.number().int().min(0).max(90),
  subject: z.string().trim().max(200).default(""),
  body: z.string().trim().max(10000).default(""),
});
export const sequenceSchema = z.object({ name: z.string().trim().min(1, "Name the sequence").max(80), steps: z.array(SEQUENCE_STEP).min(1).max(15), active: z.boolean().default(true) });

export const SCORE_SIGNALS = ["email", "phone", "company", "title", "marketing", "source", "tag", "lifecycle", "recent_activity", "activities", "open_deal", "won_deal"] as const;
export type ScoreSignal = (typeof SCORE_SIGNALS)[number];
export const SIGNAL_LABEL: Record<ScoreSignal, string> = {
  email: "Has an email",
  phone: "Has a phone number",
  company: "Works at a company",
  title: "Has a job title",
  marketing: "Agreed to marketing",
  source: "Came from source…",
  tag: "Has the tag…",
  lifecycle: "Is at stage…",
  recent_activity: "Activity in the last 7 days",
  activities: "Each activity (last 30 days)",
  open_deal: "Has an open deal",
  won_deal: "Has won a deal",
};
export const scoreRuleSchema = z.object({ id: z.string().max(40), signal: z.enum(SCORE_SIGNALS), value: z.string().max(60).default(""), points: z.number().int().min(-100).max(100) });
export type ScoreRule = z.infer<typeof scoreRuleSchema>;

export const templateSchema = z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(80), subject: z.string().trim().max(200), body: z.string().trim().max(10000) });

export const settingsSchema = z.object({
  currency: z.string().trim().length(3).default("INR"),
  visibility: z.enum(["all", "own"]).default("all"),
  assignment: z.enum(["none", "round_robin", "default"]).default("none"),
  defaultOwnerId: uuidOrNull,
  settings: z
    .object({
      capture: z.object({ forms: z.boolean().default(true), orders: z.boolean().default(true), bookings: z.boolean().default(true), horeca: z.boolean().default(true), invoicing: z.boolean().default(true) }).prefault({}),
      scoring: z.array(scoreRuleSchema).max(40).default([]),
      templates: z.array(templateSchema).max(50).default([]),
      lostReasons: z.array(z.string().trim().min(1).max(60)).max(30).default(["Price", "Went with a competitor", "No budget", "No response", "Timing", "Not a fit"]),
      sources: z.array(z.string().trim().min(1).max(40)).max(40).default(["referral", "event", "ads", "social", "cold", "partner"]),
      /** Who receives web-to-lead form submissions' alerts — empty = the assigned owner. */
      notify: z.boolean().default(true),
    })
    .prefault({}),
});
export type CrmSettings = z.infer<typeof settingsSchema>;
export const settingsJsonSchema = settingsSchema.shape.settings;

export const DEFAULT_SCORING: ScoreRule[] = [
  { id: "s1", signal: "email", value: "", points: 10 },
  { id: "s2", signal: "phone", value: "", points: 10 },
  { id: "s3", signal: "company", value: "", points: 10 },
  { id: "s4", signal: "title", value: "", points: 5 },
  { id: "s5", signal: "recent_activity", value: "", points: 15 },
  { id: "s6", signal: "activities", value: "", points: 3 },
  { id: "s7", signal: "open_deal", value: "", points: 20 },
  { id: "s8", signal: "won_deal", value: "", points: 20 },
];

export const DEFAULT_TEMPLATES = [
  { id: "t1", name: "Follow-up after a call", subject: "Great speaking with you, {{first_name}}", body: "Hi {{first_name}},\n\nThanks for your time today. As promised, here's a quick summary of what we discussed — and the next step.\n\nLet me know what works for you.\n\n{{owner_name}}" },
  { id: "t2", name: "Checking in", subject: "Quick check-in", body: "Hi {{first_name}},\n\nJust checking in to see if you had any questions. Happy to help.\n\n{{owner_name}}" },
];

export const DEFAULT_PIPELINE = {
  name: "Sales",
  stages: [
    { name: "New lead", probability: 10, kind: "open" as const, rotDays: 7 },
    { name: "Contacted", probability: 20, kind: "open" as const, rotDays: 7 },
    { name: "Qualified", probability: 40, kind: "open" as const, rotDays: 14 },
    { name: "Proposal sent", probability: 60, kind: "open" as const, rotDays: 14 },
    { name: "Negotiation", probability: 80, kind: "open" as const, rotDays: 10 },
    { name: "Won", probability: 100, kind: "won" as const, rotDays: 0 },
    { name: "Lost", probability: 0, kind: "lost" as const, rotDays: 0 },
  ],
};

/** The last 10 digits of a phone number: how two numbers are compared. */
export function phoneKey(phone: string) {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}
export const emailKey = (email: string) => (email ?? "").trim().toLowerCase();
export const emailDomain = (email: string) => {
  const d = emailKey(email).split("@")[1] ?? "";
  return FREE_MAIL.has(d) ? "" : d;
};
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "rediffmail.com", "protonmail.com", "proton.me", "aol.com", "zoho.com", "gmx.com", "mail.com", "example.com"]);

export const firstName = (name: string) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** {{first_name}}, {{name}}, {{company}}, {{title}}, {{owner_name}}, {{email}} — unknown fields are left blank. */
export function renderTemplate(tmpl: string, ctx: { name?: string; email?: string; company?: string; title?: string; ownerName?: string }) {
  const vals: Record<string, string> = { first_name: firstName(ctx.name ?? "") || "there", name: ctx.name || "there", company: ctx.company ?? "", title: ctx.title ?? "", owner_name: ctx.ownerName ?? "", email: ctx.email ?? "" };
  return tmpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vals[k] ?? "");
}

export type ScoreFacts = { email: string; phone: string; companyId: string | null; title: string; marketing: boolean; source: string; tags: string[]; lifecycle: string; activities30: number; recentActivity: boolean; openDeals: number; wonDeals: number };

/** Adds up the rules that apply; the score stays between 0 and 100. */
export function computeScore(rules: ScoreRule[], f: ScoreFacts) {
  let n = 0;
  for (const r of rules) {
    const hit =
      r.signal === "email" ? !!f.email :
      r.signal === "phone" ? !!f.phone :
      r.signal === "company" ? !!f.companyId :
      r.signal === "title" ? !!f.title :
      r.signal === "marketing" ? f.marketing :
      r.signal === "source" ? f.source === r.value :
      r.signal === "tag" ? f.tags.some((t) => t.toLowerCase() === r.value.toLowerCase()) :
      r.signal === "lifecycle" ? f.lifecycle === r.value :
      r.signal === "recent_activity" ? f.recentActivity :
      r.signal === "open_deal" ? f.openDeals > 0 :
      r.signal === "won_deal" ? f.wonDeals > 0 :
      false;
    if (r.signal === "activities") n += r.points * Math.min(f.activities30, 10);
    else if (hit) n += r.points;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Reads a submitted form's fields by what they look like they are. */
export function personFromForm(data: Record<string, unknown>) {
  const out = { name: "", email: "", phone: "", company: "", title: "", message: "" };
  const first: string[] = [];
  for (const [k, raw] of Object.entries(data ?? {})) {
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const v = String(raw).trim();
    if (!v) continue;
    const key = k.toLowerCase().replace(/[^a-z]/g, "");
    if (!out.email && (key.includes("email") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) out.email = v.toLowerCase().slice(0, 200);
    else if (!out.phone && (key.includes("phone") || key.includes("mobile") || key.includes("whatsapp") || key === "tel")) out.phone = v.slice(0, 30);
    else if (key === "firstname" || key === "fname") first.unshift(v);
    else if (key === "lastname" || key === "lname" || key === "surname") first.push(v);
    else if (!out.name && (key === "name" || key === "fullname" || key === "yourname")) out.name = v.slice(0, 120);
    else if (!out.company && (key.includes("company") || key.includes("organisation") || key.includes("organization") || key === "business")) out.company = v.slice(0, 160);
    else if (!out.title && (key === "title" || key.includes("jobtitle") || key.includes("designation") || key === "role")) out.title = v.slice(0, 120);
    else if (!out.message && (key.includes("message") || key.includes("comment") || key.includes("enquiry") || key.includes("inquiry") || key.includes("note") || key.includes("details"))) out.message = v.slice(0, 4000);
  }
  if (!out.name && first.length) out.name = first.join(" ").slice(0, 120);
  return out;
}

/** Expected revenue: each open deal's value times its stage's chance, by month of expected close. */
export function forecast(deals: { value: number; probability: number; expectedClose: string | null; status: string }[]) {
  const months = new Map<string, { month: string; total: number; weighted: number; count: number }>();
  for (const d of deals) {
    if (d.status !== "open") continue;
    const m = d.expectedClose ? d.expectedClose.slice(0, 7) : "none";
    const row = months.get(m) ?? { month: m, total: 0, weighted: 0, count: 0 };
    row.total += d.value;
    row.weighted += Math.round((d.value * d.probability) / 100);
    row.count++;
    months.set(m, row);
  }
  return [...months.values()].sort((a, b) => (a.month === "none" ? 1 : b.month === "none" ? -1 : a.month.localeCompare(b.month)));
}

/** Field keys from labels: "Annual revenue" → annual_revenue. */
export const fieldKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";

/** List filters, as kept in the URL and in saved views. */
export const contactQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  lifecycle: z.string().max(200).default(""),
  leadStatus: z.string().max(200).default(""),
  owner: z.string().max(40).default(""),
  tag: z.string().max(40).default(""),
  source: z.string().max(40).default(""),
  companyId: z.string().max(40).default(""),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  activity: z.enum(["", "7d", "30d", "stale30", "never"]).default(""),
  marketing: z.enum(["", "yes", "no"]).default(""),
  sort: z.enum(["updated", "created", "name", "score", "activity"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  per: z.coerce.number().int().min(10).max(200).default(50),
});
export type ContactQuery = z.infer<typeof contactQuerySchema>;
