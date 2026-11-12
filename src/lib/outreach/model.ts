// Outreach: the platform's own email marketing for Cloudesk (platform admins
// only). Contacts are imported from any spreadsheet or pasted text; funnels
// are steps of emails, waits and branches that people move through on their
// own; broadcasts are one-off sends. The engine picks the subject line and
// template that convert best (overall and per industry), sends at each
// person's best hour within the sending window, warms up volume, rests and
// stops on people who don't respond, pauses a funnel that hurts
// deliverability, and follows each person from email to sign-up, trial and
// paying. Shared by the server (engine, tracking) and the console.
import { z } from "zod";

// ── Contacts ────────────────────────────────────────────────────────────────

export const STAGES = ["new", "engaged", "hot", "signed_up", "trial", "paying", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { new: "New", engaged: "Engaged", hot: "Hot", signed_up: "Signed up", trial: "On trial", paying: "Paying", lost: "Lost" };
export const STATUSES = ["active", "unsubscribed", "bounced", "complained", "suppressed"] as const;
export type ContactStatus = (typeof STATUSES)[number];
export const CONSENT = ["opt_in", "legitimate_interest", "customer"] as const;
export const CONSENT_LABEL: Record<(typeof CONSENT)[number], string> = { opt_in: "Opted in", legitimate_interest: "Legitimate business interest", customer: "Existing customer" };

export const contactInput = z.object({
  email: z.email().max(200).transform((x) => x.trim().toLowerCase()),
  name: z.string().trim().max(160).default(""),
  company: z.string().trim().max(160).default(""),
  title: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  city: z.string().trim().max(80).default(""),
  state: z.string().trim().max(80).default(""),
  industry: z.string().trim().max(80).default(""),
  size: z.string().trim().max(40).default(""),
  website: z.string().trim().max(200).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: z.string().trim().max(2000).default(""),
});
export type ContactInput = z.infer<typeof contactInput>;
export const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
  source: z.string().trim().min(1).max(120).default("Import"),
  consent: z.enum(CONSENT).default("legitimate_interest"),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** Anything else in the row is kept on the contact for merge fields. */
  update: z.boolean().default(true),
});

/** Industries Cloudesk speaks to (contacts' industry is matched to these loosely). */
export const INDUSTRIES = ["retail", "restaurant", "clinic", "school", "services", "manufacturing", "construction", "wholesale", "salon", "real-estate", "travel", "logistics", "other"] as const;
const INDUSTRY_WORDS: Record<(typeof INDUSTRIES)[number], RegExp> = {
  retail: /retail|shop|store|boutique|fashion|apparel|jewel|garment|kirana|electronics|footwear/i,
  restaurant: /restaurant|cafe|café|hotel|food|bakery|catering|bar|qsr|cloud kitchen|hospitality|horeca/i,
  clinic: /clinic|hospital|doctor|dental|health|pharma|diagnostic|physio|medical/i,
  school: /school|education|coaching|academy|institute|college|tuition|edtech|training/i,
  services: /agency|consult|services|marketing|design|studio|ca firm|chartered|legal|law|it services|software|accounting/i,
  manufacturing: /manufactur|factory|industr|plant|fabricat|machin|textile|chemical/i,
  construction: /construct|builder|contractor|infra|civil|interior|architect/i,
  wholesale: /wholesale|distribut|trading|trader|import|export|supplier/i,
  salon: /salon|spa|beauty|parlour|parlor|wellness|gym|fitness/i,
  "real-estate": /real estate|realty|property|brokers?|housing/i,
  travel: /travel|tour|holiday|trip|ticket/i,
  logistics: /logistic|courier|transport|freight|shipping|warehouse/i,
  other: /$^/,
};
export const industryOf = (text: string): (typeof INDUSTRIES)[number] => (INDUSTRIES.find((i) => i !== "other" && INDUSTRY_WORDS[i].test(text)) ?? "other");

/** "Asha Rao <asha@x.in>", "asha@x.in, Asha Rao, Rao Traders" lines — or any text: the emails in it, with a name when there's one. */
export function parsePasted(text: string): ContactInput[] {
  const out = new Map<string, ContactInput>();
  for (const line of text.split(/\r?\n|;/)) {
    const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const e of emails) {
      const email = e.toLowerCase();
      if (out.has(email)) continue;
      const rest = line.replace(e, " ").replace(/[<>"()]/g, " ").split(/[,\t|]/).map((x) => x.trim()).filter(Boolean);
      const name = emails.length === 1 ? (rest[0] ?? "") : "";
      const company = emails.length === 1 ? (rest[1] ?? "") : "";
      const v = contactInput.safeParse({ email, name: name.slice(0, 160), company: company.slice(0, 160) });
      if (v.success) out.set(email, v.data);
    }
  }
  return [...out.values()];
}

// ── Templates ───────────────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = ["intro", "feature", "industry", "offer", "followup", "festive", "reengage", "onboarding", "upgrade", "partner"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<TemplateCategory, string> = { intro: "Introduction", feature: "Feature spotlight", industry: "For an industry", offer: "Offer", followup: "Personal follow-up", festive: "Festive", reengage: "Re-engagement", onboarding: "Onboarding", upgrade: "Upgrade to paid", partner: "Partner program" };

export const templateInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  industries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length).default([]),
  subjects: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
  preheader: z.string().trim().max(200).default(""),
  body: z.string().trim().min(1).max(20_000),
  ctaLabel: z.string().trim().max(60).default(""),
  ctaUrl: z.string().trim().max(500).default(""),
});
export type TemplateInput = z.infer<typeof templateInput>;

/** Built in, ready to send; edited copies keep their key. Merge fields: {{firstName|there}}, {{company|your business}}, {{industry}}, {{city}}, {{trial}}, any imported column. */
export const BUILT_IN: (TemplateInput & { key: string })[] = [
  {
    key: "intro-one-platform",
    name: "One platform for the whole business",
    category: "intro",
    industries: [],
    subjects: ["{{firstName|Hi}}, run {{company|your business}} from one place", "Stop juggling 6 apps at {{company|work}}"],
    preheader: "Website, store, billing, CRM, HR and AI — set up in minutes.",
    body: "Hi {{firstName|there}},\n\nMost businesses we speak to run on five or six apps that don't talk to each other — one for billing, one for customers, one for staff, a website somewhere else, and WhatsApp holding it together.\n\n**Cloudesk puts all of it in one place:**\n- A website and online store, live in minutes\n- GST invoices, payments and accounts\n- CRM, sales and follow-ups\n- HR, attendance and payroll\n- An AI copilot that answers from your own numbers\n\nIt's built for Indian businesses, priced for them, and free to start.",
    ctaLabel: "Start free",
    ctaUrl: "https://cloudesk.in/start",
  },
  {
    key: "followup-personal",
    name: "Personal note to a warm lead",
    category: "followup",
    industries: [],
    subjects: ["{{firstName|Hi}}, saw you were looking at Cloudesk", "Can I help you get {{company|set up}}?"],
    preheader: "A real person, happy to set it up with you.",
    body: "Hi {{firstName|there}},\n\nI noticed you've been looking at Cloudesk — thank you.\n\nIf it helps, I can set up {{company|your workspace}} with you on a short call: import your customers and products, connect payments and get your first invoice out. Most people are running in under 20 minutes.\n\nJust reply to this email with a time that suits you, or start on your own below.",
    ctaLabel: "Start free",
    ctaUrl: "https://cloudesk.in/start",
  },
  {
    key: "followup-question",
    name: "One question for a warm lead",
    category: "followup",
    industries: [],
    subjects: ["What's holding {{company|you}} back, {{firstName|there}}?", "Quick one, {{firstName|there}}"],
    preheader: "One reply and I'll point you to exactly what fits.",
    body: "Hi {{firstName|there}},\n\nYou clicked through to Cloudesk recently, so I wanted to ask one thing: **what's the most time-consuming part of running {{company|your business}} right now?**\n\n- Billing and getting paid\n- Keeping track of customers and follow-ups\n- Staff, attendance and payroll\n- Getting online — website, store, bookings\n\nReply with a number and I'll send you the two-minute way Cloudesk handles it.",
    ctaLabel: "Or try it yourself",
    ctaUrl: "https://cloudesk.in/start",
  },
  {
    key: "intro-short",
    name: "Short and personal",
    category: "intro",
    industries: [],
    subjects: ["Quick question, {{firstName|there}}", "{{company|Your business}} + Cloudesk?"],
    preheader: "Two minutes to see if it fits.",
    body: "Hi {{firstName|there}},\n\nI'll keep this short. Cloudesk is an all-in-one workspace for Indian businesses — invoices, customers, staff, your website and store, with AI built in.\n\nTeams like yours usually save 8–10 hours a week by moving billing, follow-ups and payroll into one place.\n\nWorth a look? It's free to start and takes about five minutes to set up.",
    ctaLabel: "See how it works",
    ctaUrl: "https://cloudesk.in",
  },
  {
    key: "feature-invoicing",
    name: "GST invoicing and payments",
    category: "feature",
    industries: [],
    subjects: ["GST invoices in 30 seconds, paid by UPI", "Get paid faster, {{firstName|there}}"],
    preheader: "Professional invoices, payment links and automatic reminders.",
    body: "Hi {{firstName|there}},\n\nChasing payments shouldn't be a second job. With Cloudesk:\n\n- **GST-ready invoices** with your logo, HSN codes and e-invoice support\n- **UPI and card payment links** on every invoice\n- **Automatic, polite reminders** before and after the due date\n- **Accounts that update themselves** — receivables, GST and P&L\n\nMost customers get paid a week faster in the first month.",
    ctaLabel: "Send your first invoice free",
    ctaUrl: "https://cloudesk.in/features/invoicing",
  },
  {
    key: "feature-store",
    name: "Website and online store",
    category: "feature",
    industries: ["retail", "restaurant", "salon", "wholesale"],
    subjects: ["Your online store, live today", "{{company|Your shop}} could be selling online by tonight"],
    preheader: "Website, store, payments and delivery — no developer needed.",
    body: "Hi {{firstName|there}},\n\nOpening an online store used to mean an agency, months and a big bill. With Cloudesk it's an afternoon:\n\n- A beautiful **website and store** from a sentence\n- **UPI, cards and COD** checkout\n- **Orders, stock and invoices** in the same place as your shop\n- **WhatsApp and email** order updates for customers\n\nYou own the store and the customer list — no marketplace commission.",
    ctaLabel: "Build my store",
    ctaUrl: "https://cloudesk.in/launch?kind=store",
  },
  {
    key: "feature-crm",
    name: "CRM and follow-ups",
    category: "feature",
    industries: ["services", "real-estate", "wholesale", "manufacturing"],
    subjects: ["Never miss a follow-up again", "Where do your leads go after the first call?"],
    preheader: "Every lead, deal and follow-up in one place.",
    body: "Hi {{firstName|there}},\n\nMost lost deals aren't lost — they're forgotten. Cloudesk's CRM keeps every lead moving:\n\n- **Leads from your website, email and WhatsApp** in one pipeline\n- **Follow-up reminders** so nothing slips\n- **Quotes and invoices** straight from the deal\n- **AI that drafts the next email** for you\n\nSee exactly where every rupee in your pipeline is.",
    ctaLabel: "Try the CRM free",
    ctaUrl: "https://cloudesk.in/features/crm",
  },
  {
    key: "feature-hr",
    name: "HR, attendance and payroll",
    category: "feature",
    industries: ["manufacturing", "construction", "restaurant", "school", "clinic"],
    subjects: ["Payroll in 10 minutes, with PF and ESI", "Attendance, leave and payslips — sorted"],
    preheader: "Run payroll, track attendance and issue payslips in one place.",
    body: "Hi {{firstName|there}},\n\nPayroll day shouldn't take a day. Cloudesk handles:\n\n- **Attendance and leave** from the phone, with geo check-in\n- **Payroll with PF, ESI, PT and TDS** calculated for you\n- **Payslips and bank files** in a click\n- **Offer letters, appraisals and documents** ready to send\n\nYour team gets a self-service app; you get your evenings back.",
    ctaLabel: "Run payroll free",
    ctaUrl: "https://cloudesk.in/features/hr-payroll",
  },
  {
    key: "feature-ai",
    name: "AI copilot and document studio",
    category: "feature",
    industries: [],
    subjects: ["Ask your business a question", "Contracts, offer letters and notices — drafted by AI in minutes"],
    preheader: "An AI that knows your numbers and drafts your documents.",
    body: "Hi {{firstName|there}},\n\nImagine asking *“who owes me money and how much is overdue?”* and getting the answer — with a chart and reminder emails ready to send.\n\nCloudesk's AI copilot works on your own data, and its **document studio** drafts NDAs, agreements, offer letters and legal notices to a professional standard, with the right Indian laws and clauses, in minutes.\n\nNothing changes without your confirmation.",
    ctaLabel: "Meet the copilot",
    ctaUrl: "https://cloudesk.in/intelligence",
  },
  {
    key: "industry-retail",
    name: "For retail and shops",
    category: "industry",
    industries: ["retail", "wholesale"],
    subjects: ["Billing, stock and an online store for {{company|your shop}}", "The POS your shop deserves"],
    preheader: "POS, stock, GST billing and online orders together.",
    body: "Hi {{firstName|there}},\n\nFor shops like {{company|yours}}, Cloudesk brings the counter and the online store together:\n\n- **Fast POS billing** with barcode scanning\n- **Stock that updates** across the shop and the website\n- **GST invoices** and daily sales reports\n- **Customer loyalty** and WhatsApp offers\n\nStart with billing today and switch on the online store whenever you're ready.",
    ctaLabel: "Start free",
    ctaUrl: "https://cloudesk.in/for/retail",
  },
  {
    key: "industry-restaurant",
    name: "For restaurants and cafés",
    category: "industry",
    industries: ["restaurant"],
    subjects: ["QR menus, KOT and billing for {{company|your restaurant}}", "Faster tables, fewer mistakes"],
    preheader: "QR ordering, kitchen tickets, billing and stock costs.",
    body: "Hi {{firstName|there}},\n\nCloudesk's restaurant suite runs the floor and the kitchen:\n\n- **QR menus and table ordering**\n- **Kitchen tickets (KOT)** that go straight to the right station\n- **Fast billing** with GST and split bills\n- **Food cost and stock** so you know your margins\n\nSet up your menu in an evening — guests can order the next day.",
    ctaLabel: "See the restaurant suite",
    ctaUrl: "https://cloudesk.in/for/restaurants-hotels",
  },
  {
    key: "industry-clinic",
    name: "For clinics",
    category: "industry",
    industries: ["clinic"],
    subjects: ["Appointments, records and billing for your clinic", "Less paperwork, more patients"],
    preheader: "Online booking, patient records, prescriptions and billing.",
    body: "Hi {{firstName|there}},\n\nCloudesk helps clinics run smoothly:\n\n- **Online appointment booking** with reminders\n- **Patient records and prescriptions** in one place\n- **Billing and payments** with GST where it applies\n- **Staff rosters and payroll**\n\nYour patients book in seconds; your front desk breathes easier.",
    ctaLabel: "Set up my clinic",
    ctaUrl: "https://cloudesk.in/for/clinics",
  },
  {
    key: "industry-school",
    name: "For schools and coaching",
    category: "industry",
    industries: ["school"],
    subjects: ["Fees, attendance and parents — in one app", "Collect fees on time, every term"],
    preheader: "Admissions, fees, attendance and parent communication.",
    body: "Hi {{firstName|there}},\n\nFor schools and institutes, Cloudesk brings it all together:\n\n- **Admissions and student records**\n- **Fee collection** with UPI links and automatic reminders\n- **Attendance and timetables**\n- **Parent communication** by email and WhatsApp\n\nFewer registers, fewer follow-ups, fees on time.",
    ctaLabel: "See it for schools",
    ctaUrl: "https://cloudesk.in/for/schools",
  },
  {
    key: "industry-services",
    name: "For agencies and service firms",
    category: "industry",
    industries: ["services", "real-estate", "travel"],
    subjects: ["Proposals, projects and invoices for {{company|your firm}}", "From proposal to paid, in one place"],
    preheader: "Win clients, deliver projects, bill for time.",
    body: "Hi {{firstName|there}},\n\nFor service firms, Cloudesk connects the whole client journey:\n\n- **Proposals and contracts** drafted by AI, signed online\n- **Projects, tasks and timesheets**\n- **Invoices from logged time** with GST\n- **A client portal** for files and approvals\n\nKnow which clients and projects actually make you money.",
    ctaLabel: "Start free",
    ctaUrl: "https://cloudesk.in/for/services",
  },
  {
    key: "offer-free-start",
    name: "Free to start",
    category: "offer",
    industries: [],
    subjects: ["{{trial}} free — everything included", "Try every Cloudesk feature free for {{trial}}"],
    preheader: "No card needed. Keep your data either way.",
    body: "Hi {{firstName|there}},\n\nYou can try everything in Cloudesk free for **{{trial}}** — website, store, invoices, CRM, HR and AI. No card, no commitment, and your data stays yours.\n\nMost businesses are fully set up in their first afternoon. If you'd like a hand, just reply to this email and we'll set it up with you.",
    ctaLabel: "Claim my free trial",
    ctaUrl: "https://cloudesk.in/start",
  },
  {
    key: "festive-season",
    name: "Festive season",
    category: "festive",
    industries: ["retail", "restaurant", "wholesale", "salon"],
    subjects: ["Make this festive season your best yet", "{{company|Your business}} is ready for the rush?"],
    preheader: "Online orders, offers and fast billing for the busy season.",
    body: "Hi {{firstName|there}},\n\nThe festive rush is the best time of year to sell — and the worst time for your systems to slow you down.\n\nWith Cloudesk you can open an **online store with festive offers**, **bill faster at the counter**, and **see stock in real time**, so you never run out of your best sellers.\n\nSet it up this week and be ready for the season.",
    ctaLabel: "Get ready now",
    ctaUrl: "https://cloudesk.in/start",
  },
  {
    key: "reengage-still-looking",
    name: "Still looking?",
    category: "reengage",
    industries: [],
    subjects: ["Should I close your file, {{firstName|there}}?", "Still sorting out {{company|your}} billing?"],
    preheader: "One last note from us.",
    body: "Hi {{firstName|there}},\n\nI've written a couple of times about Cloudesk and haven't heard back — which is completely fine.\n\nIf running {{company|the business}} on one platform is still on your list, the link below gets you started in five minutes. If not, I won't fill your inbox; you can also unsubscribe below.",
    ctaLabel: "Take a quick look",
    ctaUrl: "https://cloudesk.in",
  },
  {
    key: "onboard-first-steps",
    name: "Welcome — first three steps",
    category: "onboarding",
    industries: [],
    subjects: ["Welcome to Cloudesk, {{firstName|there}} — 3 steps to get going", "Your workspace is ready"],
    preheader: "The three things that make the biggest difference in week one.",
    body: "Hi {{firstName|there}},\n\nWelcome aboard! The businesses that get the most from Cloudesk do three things in their first week:\n\n1. **Add your business details** — your invoices and website use them\n2. **Bring in your customers** — import a spreadsheet in seconds\n3. **Send your first invoice or open your store**\n\nThe AI copilot can do all three with you — just ask it to *“help me set up”*.",
    ctaLabel: "Open my workspace",
    ctaUrl: "https://cloudesk.in/home",
  },
  {
    key: "upgrade-value",
    name: "Keep everything running",
    category: "upgrade",
    industries: [],
    subjects: ["Keep {{company|your workspace}} running smoothly", "What you've built in Cloudesk so far"],
    preheader: "Choose a plan that fits — pay only for what you use.",
    body: "Hi {{firstName|there}},\n\nYou've set up your workspace — nice work. Choose a plan to keep everything running without interruption: your website, store, invoices, team and AI.\n\nPlans start small and grow with you, and you can add exactly the features you need. Reply to this email if you'd like help picking one.",
    ctaLabel: "Choose a plan",
    ctaUrl: "https://cloudesk.in/settings/billing",
  },
  {
    key: "partner-invite",
    name: "Become a partner",
    category: "partner",
    industries: ["services"],
    subjects: ["Earn recurring income with Cloudesk", "Partner with us, {{firstName|there}}"],
    preheader: "Recurring commission for every business you bring.",
    body: "Hi {{firstName|there}},\n\nIf you advise or serve businesses — as a CA, consultant or agency — you can earn **recurring commission** for every client you bring to Cloudesk, plus tools to manage them all from one place.\n\nIt's free to join and takes five minutes.",
    ctaLabel: "Become a partner",
    ctaUrl: "https://cloudesk.in/partners",
  },
];

// ── Funnels and broadcasts ──────────────────────────────────────────────────

export const CONDITIONS = ["opened", "clicked", "not_opened", "not_clicked"] as const;
export const CONDITION_LABEL: Record<(typeof CONDITIONS)[number], string> = { opened: "Opened the last email", clicked: "Clicked the last email", not_opened: "Didn't open the last email", not_clicked: "Didn't click the last email" };

const stepId = z.string().regex(/^[a-z0-9]{1,12}$/);
export const stepSchema = z.discriminatedUnion("kind", [
  /** templateId (a fixed template) or category (the engine picks the best one in it for each person). */
  /** resendAfterDays: anyone who hasn't opened by then gets it again with another subject line (a second chance lifts opens by a quarter). */
  z.object({ id: stepId, kind: z.literal("email"), templateId: z.uuid().nullable().default(null), category: z.enum(TEMPLATE_CATEGORIES).nullable().default(null), resendAfterDays: z.number().min(1).max(14).nullable().optional() }).refine((x) => x.templateId || x.category, "Pick a template or let the engine choose from a category"),
  z.object({ id: stepId, kind: z.literal("wait"), days: z.number().min(0.04).max(60) }),
  z.object({ id: stepId, kind: z.literal("branch"), if: z.enum(CONDITIONS), then: stepId, else: stepId.nullable().default(null) }),
]);
export type Step = z.infer<typeof stepSchema>;

export const audienceSchema = z.object({
  stages: z.array(z.enum(STAGES)).max(STAGES.length).default([]),
  industries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sources: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  minScore: z.number().int().min(0).max(10_000).nullable().default(null),
});
export type Audience = z.infer<typeof audienceSchema>;

export const GOALS = ["signed_up", "trial", "paying"] as const;
export const funnelInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["funnel", "broadcast"]).default("funnel"),
  audience: audienceSchema.prefault({}),
  steps: z.array(stepSchema).min(1).max(30),
  goal: z.enum(GOALS).default("signed_up"),
  /** New contacts who match the audience join on their own. */
  autoEnroll: z.boolean().default(true),
  /** Learn the best subject line, template and send time, and shift sends to them. */
  autoOptimize: z.boolean().default(true),
  /** 0–100; someone who matches a higher-priority funnel is moved into it. */
  priority: z.number().int().min(0).max(100).optional(),
  /** Percent held back as a control group (never emailed), to measure real lift. */
  holdoutPct: z.number().int().min(0).max(30).optional(),
  startAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type FunnelInput = z.infer<typeof funnelInput>;

/** Built-in funnels (created paused, ready to switch on). Template steps choose by category, so the engine optimises them. */
export const BUILT_IN_FUNNELS: (FunnelInput & { key: string })[] = [
  {
    key: "hot-leads",
    name: "Hot leads — personal follow-up",
    kind: "funnel",
    audience: { stages: ["hot"], industries: [], tags: [], sources: [], minScore: null },
    goal: "signed_up",
    autoEnroll: true,
    autoOptimize: true,
    priority: 50,
    startAt: null,
    steps: [
      { id: "s1", kind: "email", templateId: null, category: "followup" },
      { id: "s2", kind: "wait", days: 2 },
      { id: "s3", kind: "branch", if: "not_opened", then: "s4", else: "s5" },
      { id: "s4", kind: "email", templateId: null, category: "offer" },
      { id: "s5", kind: "wait", days: 3 },
      { id: "s6", kind: "email", templateId: null, category: "followup" },
    ],
  },
  {
    key: "new-leads",
    name: "New leads — 4-touch introduction",
    kind: "funnel",
    audience: { stages: ["new", "engaged"], industries: [], tags: [], sources: [], minScore: null },
    goal: "signed_up",
    autoEnroll: true,
    autoOptimize: true,
    holdoutPct: 5,
    startAt: null,
    steps: [
      { id: "s1", kind: "email", templateId: null, category: "intro", resendAfterDays: 3 },
      { id: "s2", kind: "wait", days: 3 },
      { id: "s3", kind: "branch", if: "clicked", then: "s7", else: null },
      { id: "s4", kind: "email", templateId: null, category: "industry" },
      { id: "s5", kind: "wait", days: 4 },
      { id: "s6", kind: "email", templateId: null, category: "feature" },
      { id: "s7", kind: "wait", days: 3 },
      { id: "s8", kind: "email", templateId: null, category: "offer" },
      { id: "s9", kind: "wait", days: 7 },
      { id: "s10", kind: "branch", if: "not_opened", then: "s11", else: null },
      { id: "s11", kind: "email", templateId: null, category: "reengage" },
    ],
  },
  {
    key: "reengage",
    name: "Win back quiet leads",
    kind: "funnel",
    audience: { stages: ["lost"], industries: [], tags: [], sources: [], minScore: null },
    goal: "signed_up",
    autoEnroll: true,
    autoOptimize: true,
    startAt: null,
    steps: [
      { id: "s1", kind: "email", templateId: null, category: "festive" },
      { id: "s2", kind: "wait", days: 5 },
      { id: "s3", kind: "email", templateId: null, category: "reengage" },
    ],
  },
  {
    key: "onboarding",
    name: "Welcome and activate new sign-ups",
    kind: "funnel",
    audience: { stages: ["signed_up"], industries: [], tags: [], sources: [], minScore: null },
    goal: "trial",
    autoEnroll: true,
    autoOptimize: true,
    startAt: null,
    steps: [
      { id: "s1", kind: "email", templateId: null, category: "onboarding" },
      { id: "s2", kind: "wait", days: 2 },
      { id: "s3", kind: "email", templateId: null, category: "feature" },
    ],
  },
  {
    key: "upgrade",
    name: "Trial to paid",
    kind: "funnel",
    audience: { stages: ["trial"], industries: [], tags: [], sources: [], minScore: null },
    goal: "paying",
    autoEnroll: true,
    autoOptimize: true,
    startAt: null,
    steps: [
      { id: "s1", kind: "email", templateId: null, category: "upgrade" },
      { id: "s2", kind: "wait", days: 5 },
      { id: "s3", kind: "email", templateId: null, category: "offer" },
    ],
  },
];

/** Where a funnel's steps go next: the step after, or a branch's target. Validates that branch targets exist. */
export function checkSteps(steps: Step[]): string | null {
  const ids = new Set(steps.map((s) => s.id));
  if (ids.size !== steps.length) return "Each step needs its own id";
  for (const s of steps) if (s.kind === "branch" && (!ids.has(s.then) || (s.else && !ids.has(s.else)))) return "A branch points to a step that isn't there";
  if (!steps.some((s) => s.kind === "email")) return "Add at least one email";
  return null;
}

// ── Settings ────────────────────────────────────────────────────────────────

export const settingsInput = z.object({
  /** The master switch: nothing is sent while it's off. */
  sending: z.boolean().default(false),
  fromName: z.string().trim().min(1).max(60).default("Cloudesk"),
  /**
   * How mail leaves: the platform's email service (built for volume; From is
   * any address on its verified domain) or one of the admin's own Cloudesk
   * Mail mailboxes (From is that mailbox; capped, as mailboxes aren't made for bulk).
   */
  via: z.enum(["platform", "mailbox"]).default("platform"),
  /** With the platform service: the From address ("" = the platform's own). Must be on the same domain. */
  fromEmail: z.union([z.email().max(200), z.literal("")]).default(""),
  /** With a mailbox: which Cloudesk Mail account sends. */
  accountId: z.uuid().nullable().default(null),
  replyTo: z.union([z.email(), z.literal("")]).default(""),
  /** Required in every promotional email's footer. */
  postalAddress: z.string().trim().max(300).default(""),
  dailyLimit: z.number().int().min(1).max(100_000).default(500),
  /** Start low and grow by `warmupGrowth` a day, up to the daily limit. */
  warmup: z.boolean().default(true),
  warmupStart: z.number().int().min(10).max(10_000).default(50),
  warmupGrowth: z.number().min(1).max(2).default(1.25),
  windowStart: z.number().int().min(0).max(23).default(9),
  windowEnd: z.number().int().min(1).max(24).default(19),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5, 6]),
  /** Never email the same person more often than this. */
  minGapHours: z.number().int().min(1).max(720).default(48),
  /** Across every funnel, nobody gets more than this many emails in 7 days. */
  maxPerWeek: z.number().int().min(1).max(14).default(3),
  /** The engine writes new subject lines with AI to challenge the leaders, and retires the losers. */
  aiEvolve: z.boolean().default(true),
  /** Email the admin the moment someone replies or signs up from outreach. */
  alerts: z.boolean().default(true),
  alertEmail: z.union([z.email(), z.literal("")]).default(""),
  /** Stop emailing someone after this many emails in a row go unopened. */
  sunsetAfter: z.number().int().min(2).max(20).default(4),
  /** A funnel pauses itself above these rates (of its last 200 sends). */
  maxBounceRate: z.number().min(0.5).max(50).default(5),
  maxUnsubRate: z.number().min(0.1).max(50).default(2),
});
export type OutreachSettings = z.infer<typeof settingsInput>;
/** Mailboxes (Google Workspace, Microsoft 365, GoDaddy…) start flagging accounts that send more than a few hundred a day. */
export const MAILBOX_DAILY_CAP = 300;

// ── Merge fields and rendering ──────────────────────────────────────────────

export type Mergeable = { email: string; name: string; company: string; city: string; industry: string; title: string; data?: Record<string, unknown> };
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** {{field|fallback}} from the contact; unknown fields fall back (or vanish). */
export function merge(text: string, c: Mergeable, extra: Record<string, string> = {}) {
  const values: Record<string, string> = { firstName: firstName(c.name), name: c.name, company: c.company, city: c.city, industry: c.industry, title: c.title, email: c.email, ...extra };
  for (const [k, v] of Object.entries(c.data ?? {})) if (!(k in values) && (typeof v === "string" || typeof v === "number")) values[k] = String(v);
  return text.replace(/\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g, (_, k: string, fb?: string) => (values[k]?.trim() ? values[k]! : (fb ?? "").trim()));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string, link: (u: string) => string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t: string, u: string) => `<a href="${esc(link(u.replace(/&amp;/g, "&")))}" style="color:#4f46e5">${t}</a>`);

/** The email as HTML (a clean single-column layout) and plain text, with tracked links, the open pixel and the unsubscribe footer. */
export function renderEmail(o: { body: string; preheader: string; ctaLabel: string; ctaUrl: string; link: (url: string) => string; pixel: string; unsubscribe: string; fromName: string; postalAddress: string; reason: string; logo?: { src: string; href: string } }) {
  const blocks = o.body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html: string[] = [];
  const text: string[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    if (lines.every((l) => /^(-|\d+\.)\s/.test(l))) {
      const ordered = /^\d+\./.test(lines[0]!);
      html.push(`<${ordered ? "ol" : "ul"} style="margin:0 0 16px;padding-left:22px">${lines.map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^(-|\d+\.)\s/, ""), o.link)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      text.push(lines.join("\n"));
    } else {
      html.push(`<p style="margin:0 0 16px">${lines.map((l) => inline(l, o.link)).join("<br>")}</p>`);
      text.push(b.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"));
    }
  }
  if (o.ctaLabel && o.ctaUrl) {
    html.push(`<p style="margin:24px 0"><a href="${esc(o.link(o.ctaUrl))}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(o.ctaLabel)}</a></p>`);
    text.push(`${o.ctaLabel}: ${o.link(o.ctaUrl)}`);
  }
  const footer = `${esc(o.reason)}<br>${o.postalAddress ? `${esc(o.fromName)} · ${esc(o.postalAddress)}<br>` : ""}<a href="${esc(o.unsubscribe)}" style="color:#6b7280">Unsubscribe</a>`;
  const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f4"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;border:1px solid #e7e5e4">${o.logo ? `<tr><td style="padding:24px 28px 0"><a href="${esc(o.logo.href)}"><img src="${esc(o.logo.src)}" width="132" height="44" alt="${esc(o.fromName)}" style="display:block;border:0;width:132px;height:auto"></a></td></tr>` : ""}<tr><td style="padding:${o.logo ? 20 : 28}px 28px 8px;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917">${html.join("")}</td></tr></table><p style="max-width:580px;margin:16px auto 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#78716c">${footer}</p></td></tr></table>${o.pixel ? `<img src="${esc(o.pixel)}" width="1" height="1" alt="" style="display:block;border:0">` : ""}</body></html>`;
  const plain = `${text.join("\n\n")}\n\n—\n${o.reason}\n${o.postalAddress ? `${o.fromName}, ${o.postalAddress}\n` : ""}Unsubscribe: ${o.unsubscribe}`;
  return { html: htmlDoc, text: plain };
}

// ── The engine's choices ────────────────────────────────────────────────────

/** A random draw from Beta(a, b) (Marsaglia–Tsang gamma draws), for Thompson sampling. */
export function betaSample(a: number, b: number, rand: () => number = Math.random) {
  const gamma = (k: number): number => {
    if (k < 1) return gamma(k + 1) * Math.pow(rand(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        // Box–Muller for a standard normal.
        x = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  const x = gamma(a);
  const y = gamma(b);
  return x / (x + y);
}

/**
 * Pick an arm by Thompson sampling on its record. The reward is a click, with
 * opens counting for a fifth (they're noisier); untried arms get a fair start.
 */
export function pickArm<T extends { sends: number; opens: number; clicks: number; conversions?: number }>(arms: T[], rand: () => number = Math.random): number {
  if (arms.length <= 1) return 0;
  let best = 0;
  let bestScore = -1;
  arms.forEach((a, i) => {
    const wins = a.clicks + (a.conversions ?? 0) * 3 + a.opens * 0.2;
    const score = betaSample(1 + wins, 1 + Math.max(0, a.sends - wins), rand);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * When to send, at or after `from` (India time): now if it's inside the
 * window on a sending day and the person's best hour has come; else their
 * best hour (or the window's start) on the next sending day that has room.
 */
export function nextSlot(from: Date, s: Pick<OutreachSettings, "windowStart" | "windowEnd" | "days">, hour?: number | null): Date {
  const IST = 19_800_000;
  const HOUR = 3_600_000;
  const pref = hour !== null && hour !== undefined && hour >= s.windowStart && hour < s.windowEnd ? hour : null;
  const local = new Date(from.getTime() + IST);
  const h = local.getUTCHours();
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST;
  for (let d = 0; d < 8; d++) {
    if (!s.days.includes((local.getUTCDay() + d) % 7)) continue;
    const day = midnight + d * 86_400_000;
    if (d === 0) {
      if (h >= s.windowEnd) continue;
      if (pref !== null && pref > h) return new Date(day + pref * HOUR);
      return h >= s.windowStart ? from : new Date(day + s.windowStart * HOUR);
    }
    return new Date(day + (pref ?? s.windowStart) * HOUR);
  }
  return new Date(from.getTime() + 86_400_000);
}

/** Engagement score: clicks count most, opens a little, conversions a lot; it fades for people who've gone quiet. */
export function scoreOf(c: { opens: number; clicks: number; lastEventAt: Date | null; stage: Stage }, now = Date.now()) {
  const base = c.opens * 3 + c.clicks * 12 + (c.stage === "signed_up" ? 40 : c.stage === "trial" ? 60 : c.stage === "paying" ? 100 : 0);
  const weeks = c.lastEventAt ? (now - c.lastEventAt.getTime()) / (7 * 86_400_000) : 8;
  return Math.round(base * Math.pow(0.9, Math.max(0, weeks)));
}

export const stageFromScore = (score: number, current: Stage): Stage => (["signed_up", "trial", "paying"].includes(current) ? current : score >= 30 ? "hot" : score >= 6 ? "engaged" : current === "lost" ? "lost" : "new");

/** Warm-up: how many may go out today, `days` days after sending began. */
export const warmupCap = (s: Pick<OutreachSettings, "warmup" | "warmupStart" | "warmupGrowth" | "dailyLimit">, days: number) => (s.warmup ? Math.min(s.dailyLimit, Math.round(s.warmupStart * Math.pow(s.warmupGrowth, Math.max(0, days)))) : s.dailyLimit);

/** The import target for the smart importer: any spreadsheet's columns matched to these. */
export const IMPORT_FIELDS = [
  { key: "email", label: "Email", type: "email" as const, required: true, aliases: ["email id", "e mail", "mail", "email address"] },
  { key: "name", label: "Name", type: "text" as const, aliases: ["full name", "contact", "contact name", "person", "owner"] },
  { key: "first_name", label: "First name", type: "text" as const, aliases: ["first", "given name", "fname"] },
  { key: "last_name", label: "Last name", type: "text" as const, aliases: ["last", "surname", "lname"] },
  { key: "company", label: "Company", type: "text" as const, aliases: ["organisation", "organization", "business", "firm", "account", "company name", "brand"] },
  { key: "title", label: "Job title", type: "text" as const, aliases: ["designation", "role", "position"] },
  { key: "phone", label: "Phone", type: "phone" as const, aliases: ["mobile", "contact no", "whatsapp", "phone number"] },
  { key: "city", label: "City", type: "text" as const, aliases: ["town", "location"] },
  { key: "state", label: "State", type: "text" as const, aliases: ["region", "province"] },
  { key: "industry", label: "Industry", type: "text" as const, aliases: ["sector", "category", "business type", "vertical"] },
  { key: "size", label: "Company size", type: "text" as const, aliases: ["employees", "team size", "headcount"] },
  { key: "website", label: "Website", type: "url" as const, aliases: ["site", "url", "domain"] },
  { key: "tags", label: "Tags", type: "text" as const, aliases: ["labels", "segments", "list"] },
  { key: "notes", label: "Notes", type: "text" as const, aliases: ["remarks", "comments", "description"] },
];

// ── Spam check ──────────────────────────────────────────────────────────────

const TRIGGERS = ["100% free", "act now", "apply now", "as seen on", "buy now", "cash bonus", "click here", "click below", "congratulations", "dear friend", "double your", "earn money", "extra income", "for only", "get paid", "guaranteed", "incredible deal", "limited time", "lowest price", "make money", "miracle", "no catch", "no cost", "no fees", "once in a lifetime", "order now", "risk-free", "risk free", "special promotion", "this isn't spam", "urgent", "while supplies last", "winner", "you have been selected", "you've won", "work from home", "100% satisfied", "best price", "call now", "don't delete", "free gift", "free money", "free offer", "get it now", "instant access", "meet singles", "save big", "what are you waiting for"];
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)\//i;

export type SpamIssue = { level: "bad" | "warn" | "tip"; text: string };

/** What in a template is likely to send it to spam, worst first. Heuristic: mailbox filters weigh the sender's reputation far more. */
export function spamCheck(t: { subjects: string[]; preheader: string; body: string; ctaUrl: string; ctaLabel: string }): SpamIssue[] {
  const out: SpamIssue[] = [];
  const all = `${t.subjects.join(" ")}\n${t.preheader}\n${t.body}\n${t.ctaLabel}`.toLowerCase();
  const hits = TRIGGERS.filter((w) => all.includes(w));
  if (hits.length) out.push({ level: hits.length > 2 ? "bad" : "warn", text: `Phrases filters associate with spam: ${hits.map((h) => `“${h}”`).join(", ")}` });
  for (const s of t.subjects) {
    const caps = s.match(/\b[A-Z]{4,}\b/g)?.filter((w) => !["GST", "UPI", "HSN", "CRM", "INVOICE"].includes(w)) ?? [];
    if (caps.length) out.push({ level: "warn", text: `Shouting in the subject: ${caps.join(", ")}` });
    if ((s.match(/!/g)?.length ?? 0) > 1) out.push({ level: "warn", text: `More than one “!” in “${s}”` });
    if (/[$₹€]{2,}|\bfree\b.*\bfree\b/i.test(s)) out.push({ level: "bad", text: `Money signs or “free” repeated in “${s}”` });
    if (/^\s*(re|fwd?):/i.test(s)) out.push({ level: "bad", text: `“${s}” pretends to be a reply or forward` });
    const emoji = s.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
    if (emoji > 1) out.push({ level: "warn", text: `${emoji} emoji in “${s}” — one at most` });
    const plain = s.replace(/\{\{[^}]*\}\}/g, "Name");
    if (plain.length > 70) out.push({ level: "tip", text: `“${s}” is long; phones cut subjects at about 40–50 characters` });
  }
  if (SHORTENERS.test(`${t.body} ${t.ctaUrl}`)) out.push({ level: "bad", text: "A link shortener (bit.ly and the like) — filters distrust them. Link to the real address." });
  const links = (t.body.match(/\]\(https?:\/\//g)?.length ?? 0) + (t.ctaUrl ? 1 : 0);
  if (links > 4) out.push({ level: "warn", text: `${links} links — two or three keep it looking personal` });
  if (t.ctaUrl && !/^https:\/\//i.test(t.ctaUrl)) out.push({ level: "warn", text: "The button link isn't https" });
  const words = t.body.replace(/\{\{[^}]*\}\}/g, "x").split(/\s+/).filter(Boolean).length;
  if (words < 40) out.push({ level: "warn", text: `Only ${words} words — very short promotional mail looks like spam` });
  if (words > 400) out.push({ level: "tip", text: `${words} words — shorter emails get more clicks` });
  if (!t.preheader.trim()) out.push({ level: "tip", text: "Add preview text — otherwise inboxes show the first line of the body" });
  if (!/\{\{\s*(firstName|name|company)/.test(`${t.subjects.join(" ")} ${t.body}`)) out.push({ level: "tip", text: "Use {{firstName|there}} or {{company}} — personal mail is opened more and flagged less" });
  const rank = { bad: 0, warn: 1, tip: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ── Telling people from machines ────────────────────────────────────────────

/** Security scanners and link checkers that open and click mail before (or instead of) a person. */
const SCANNERS = /(bot\b|crawler|spider|scanner|barracuda|proofpoint|mimecast|forcepoint|symantec|messagelabs|trendmicro|sophos|fortinet|fireeye|cisco|ironport|zscaler|safelinks|safebrowsing|urldefense|headlesschrome|phantomjs|python-requests|python-urllib|go-http-client|curl\/|wget|java\/|okhttp|axios|node-fetch|libwww|microsoft office existence|skypeuripreview|slackbot|facebookexternalhit|whatsapp|linkedinbot|twitterbot|discordbot|telegrambot)/i;
/** Apple's Mail Privacy Protection fetches every image through Apple's servers when mail arrives, opened or not. */
const APPLE_PROXY_IP = /^17\./;

export type Hit = { kind: "open" | "click"; ua: string; ip: string; method?: string; secondsSinceSend: number; priorClicksSecondsAgo?: number[] };
export type HitVerdict = { machine: boolean; reason: string; client: string };

/** Mail client and device from a real open's user agent. */
export function clientOf(ua: string): string {
  const u = ua.toLowerCase();
  const app = /googleimageproxy|ggpht/.test(u) ? "Gmail" : /yahoomailproxy/.test(u) ? "Yahoo Mail" : /outlook|microsoft office|ms-office|msoffice/.test(u) ? "Outlook" : /thunderbird/.test(u) ? "Thunderbird" : /(iphone|ipad|macintosh).*applewebkit(?!.*(safari|chrome))/.test(u) ? "Apple Mail" : /android/.test(u) ? "Android mail" : /chrome|firefox|safari|edg\//.test(u) ? "Webmail" : "";
  const device = /iphone|android.*mobile|mobile/.test(u) ? "mobile" : /ipad|tablet/.test(u) ? "tablet" : /windows|macintosh|linux|x11/.test(u) ? "desktop" : "";
  return [app, device].filter(Boolean).join(" · ");
}

/**
 * Whether an open or a click came from a person. Machine hits: privacy proxies
 * (Apple MPP), security scanners and link checkers (by name, HEAD requests,
 * clicks within seconds of delivery, or several links clicked in the same second).
 */
export function classifyHit(h: Hit): HitVerdict {
  const ua = h.ua || "";
  if (h.method === "HEAD") return { machine: true, reason: "link check (HEAD)", client: "" };
  if (SCANNERS.test(ua)) return { machine: true, reason: "security scanner", client: "" };
  if (!ua.trim()) return { machine: true, reason: "no browser", client: "" };
  if (h.kind === "open") {
    // Apple's proxy: an Apple IP with a bare "Mozilla/5.0" agent (real Apple Mail opens carry the full one).
    if (APPLE_PROXY_IP.test(h.ip) && !/applewebkit/i.test(ua)) return { machine: true, reason: "Apple Mail Privacy Protection", client: "Apple Mail" };
    if (h.secondsSinceSend < 2) return { machine: true, reason: "opened on delivery", client: "" };
    return { machine: false, reason: "", client: clientOf(ua) };
  }
  if (h.secondsSinceSend < 10) return { machine: true, reason: "clicked seconds after delivery", client: "" };
  if ((h.priorClicksSecondsAgo ?? []).filter((s) => s < 2).length >= 2) return { machine: true, reason: "every link clicked at once", client: "" };
  return { machine: false, reason: "", client: clientOf(ua) };
}

// ── List hygiene ────────────────────────────────────────────────────────────

const TYPOS: Record<string, string> = { "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gamil.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gnail.com": "gmail.com", "gmail.in": "gmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yahoo.co": "yahoo.co.in", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com", "rediffmail.con": "rediffmail.com", "redifmail.com": "rediffmail.com", "iclod.com": "icloud.com", "icloud.con": "icloud.com" };
const ROLE = /^(info|admin|administrator|support|sales|contact|contactus|hello|hi|office|accounts?|billing|finance|hr|careers|jobs|enquir(y|ies)|inquir(y|ies)|help|team|marketing|webmaster|postmaster|hostmaster|abuse|noreply|no-reply|donotreply|do-not-reply|mail|reception|service|services|customercare|care)$/i;
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "throwawaymail.com", "maildrop.cc", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempinbox.com", "spamgourmet.com", "mailnesia.com", "moakt.com"]);

/** An address tidied (common domain typos fixed) and judged before anything is sent to it. */
export function checkAddress(raw: string): { email: string; verify: "unknown" | "risky" | "invalid"; note: string } {
  const email = raw.trim().toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  const fixed = TYPOS[domain];
  const out = fixed ? `${local}@${fixed}` : email;
  const d = fixed ?? domain;
  if (DISPOSABLE.has(d)) return { email: out, verify: "invalid", note: "Disposable address" };
  if (!/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(out) || local.length > 64) return { email: out, verify: "invalid", note: "Not a valid address" };
  if (ROLE.test(local)) return { email: out, verify: "risky", note: `A shared inbox (${local}@) — more likely to mark promotions as spam` };
  return { email: out, verify: "unknown", note: fixed ? `Corrected from ${domain}` : "" };
}

/**
 * The chance each arm is truly the best, by sampling (Thompson). Used to
 * retire a subject line only when it's almost surely losing.
 */
export function probBest(arms: { sends: number; wins: number }[], draws = 2000, rand: () => number = Math.random): number[] {
  const best = arms.map(() => 0);
  for (let d = 0; d < draws; d++) {
    let top = -1;
    let at = 0;
    arms.forEach((a, i) => {
      const x = betaSample(1 + a.wins, 1 + Math.max(0, a.sends - a.wins), rand);
      if (x > top) {
        top = x;
        at = i;
      }
    });
    best[at]!++;
  }
  return best.map((n) => n / draws);
}
