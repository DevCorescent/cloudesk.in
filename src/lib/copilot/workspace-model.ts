// What the copilot may suggest and read beyond reports (email, calendar,
// invoices, contacts and deals, business details, invitations): the checks on
// each suggestion's input, and how the tools are described to the model. The
// server side (reading and carrying out) is server/copilot/workspace.ts.
import { z } from "zod";
import { companySchema } from "@/lib/org/model";
import { GST_RATES, UNITS } from "@/lib/inventory/model";
import { DOC_KINDS as ADVISOR_DOC_KINDS } from "./advisors";
import { DOC_KINDS } from "@/lib/documents/studio";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const iso = z.iso.datetime({ offset: true, message: "Use an ISO time with offset, like 2026-11-03T15:00:00+05:30" });
const email = z.email().max(200);
const rupees = z.number().min(0).max(1_000_000_000);
const INVITE_ROLES = ["admin", "billing", "developer", "designer", "editor", "viewer", "employee"] as const;

// ── What it may suggest ─────────────────────────────────────────────────────

export const WORKSPACE_ACTIONS = ["send_email", "calendar_event", "crm_contact", "crm_deal", "invoice_draft", "business_profile", "invite_member", "record_bill", "inventory_items", "save_document", "mail_tidy", "reminder", "note", "business_document"] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];
export const WORKSPACE_LABEL: Record<WorkspaceAction, string> = {
  send_email: "Email",
  calendar_event: "Calendar event",
  crm_contact: "New contact",
  crm_deal: "New deal",
  invoice_draft: "Draft invoice",
  business_profile: "Business details",
  invite_member: "Invite to the team",
  record_bill: "Bill for Accounts",
  inventory_items: "Inventory items",
  save_document: "Save to Documents",
  mail_tidy: "Tidy email",
  reminder: "Reminder",
  note: "Note",
  business_document: "Business document",
};

export const MAIL_TIDY = ["archive", "read", "star", "trash", "snooze", "label", "followup"] as const;

export const WORKSPACE_INPUT = {
  send_email: z.object({
    accountId: z.uuid().nullable().default(null),
    mode: z.enum(["new", "reply", "replyAll", "forward"]).default("new"),
    threadId: z.uuid().nullable().default(null),
    replyTo: z.uuid().nullable().default(null),
    to: z.array(email).min(1, "Add at least one recipient").max(50),
    cc: z.array(email).max(50).default([]),
    subject: z.string().trim().min(1, "Add a subject").max(300),
    body: z.string().trim().min(1, "Write the email").max(20_000),
  }),
  calendar_event: z.object({
    title: z.string().trim().min(1).max(200),
    start: iso,
    end: iso,
    location: z.string().trim().max(300).default(""),
    description: z.string().max(4000).default(""),
    attendees: z.array(z.object({ name: z.string().trim().max(120).default(""), email })).max(50).default([]),
    sendInvite: z.boolean().default(false),
  }),
  crm_contact: z.object({ name: z.string().trim().min(1).max(160), email: z.union([email, z.literal("")]).default(""), phone: z.string().trim().max(30).default(""), companyName: z.string().trim().max(160).default(""), title: z.string().trim().max(120).default("") }),
  crm_deal: z.object({ title: z.string().trim().min(1).max(200), value: rupees.default(0), contactId: z.uuid().nullable().default(null), expectedClose: day.nullable().default(null) }),
  invoice_draft: z.object({
    client: z.object({ name: z.string().trim().min(1).max(160), company: z.string().trim().max(160).default(""), email: z.union([email, z.literal("")]).default(""), phone: z.string().trim().max(30).default(""), gstin: z.string().trim().toUpperCase().max(15).default(""), state: z.string().trim().max(80).default("") }),
    lines: z.array(z.object({ name: z.string().trim().min(1).max(300), quantity: z.number().min(0.001).max(1_000_000), rate: rupees, taxPercent: z.number().min(0).max(100).default(18), hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/).default("") })).min(1).max(50),
    dueDate: day.nullable().default(null),
    notes: z.string().max(2000).default(""),
  }),
  business_profile: z
    .object({
      legalName: z.string().trim().max(200).optional(),
      // The company form's own GSTIN check (format and check digit), so a typo is caught before it's proposed.
      gstin: companySchema.shape.gstin.optional(),
      pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, "A PAN looks like ABCDE1234F").optional(),
      address: z.object({ line1: z.string().trim().max(200).default(""), line2: z.string().trim().max(200).default(""), city: z.string().trim().max(80).default(""), state: z.string().trim().max(80).default(""), postalCode: z.string().trim().max(16).default("") }).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.union([email, z.literal("")]).optional(),
      website: z.string().trim().max(200).optional(),
      upiId: z.string().trim().max(80).optional(),
    })
    .refine((x) => Object.values(x).some((v) => v !== undefined), "Include at least one detail"),
  invite_member: z.object({ email, role: z.enum(INVITE_ROLES).default("editor") }),
  /** Made by the extract_bill tool from the file (never typed by the model): the bill form's draft. */
  record_bill: z.object({ attachmentId: z.string().regex(/^f\d+$/), kind: z.enum(["bill", "expense"]).default("bill"), draft: z.record(z.string(), z.unknown()), warnings: z.array(z.string()).default([]), fileName: z.string().default("") }),
  inventory_items: z.object({
    items: z
      .array(z.object({ name: z.string().trim().min(1).max(160), sku: z.string().trim().max(60).default(""), unit: z.enum(UNITS).default("pcs"), category: z.string().trim().max(60).default(""), hsn: z.string().trim().max(10).default(""), gstRate: z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "Use a GST rate of 0, 0.25, 3, 5, 12, 18 or 28").default(18), cost: rupees.default(0) }))
      .min(1)
      .max(200),
  }),
  save_document: z.object({ attachmentId: z.string().regex(/^f\d+$/), title: z.string().trim().min(1).max(200), description: z.string().trim().max(1000).default("") }),
  mail_tidy: z
    .object({ threadIds: z.array(z.uuid()).min(1, "Pick at least one email").max(200), action: z.enum(MAIL_TIDY), value: z.string().trim().max(100).default("") })
    .refine((x) => !["snooze", "followup"].includes(x.action) || !Number.isNaN(Date.parse(x.value)), { message: "Say when — an ISO time like 2026-11-14T10:00:00+05:30", path: ["value"] })
    .refine((x) => x.action !== "label" || x.value.length > 0, { message: "Name the label", path: ["value"] }),
  reminder: z.object({ title: z.string().trim().min(1).max(200), at: iso, details: z.string().max(2000).default("") }),
  note: z.object({ title: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000), tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]) }),
  business_document: z.object({
    kindId: z.enum(DOC_KINDS.map((k) => k.id) as [string, ...string[]]),
    request: z.string().trim().min(3).max(4000),
    title: z.string().trim().max(200).default(""),
    answers: z.record(z.string().max(60), z.string().max(4000)).default({}),
    language: z.enum(["English", "Hindi", "English and Hindi (bilingual)"]).default("English"),
  }),
} as const;

/** How each suggestion is described to the model (the `input` of propose_action). */
export const WORKSPACE_PROMPT = [
  'kind "send_email": input { to: [emails], cc?: [emails], subject, body (plain text, signed with the person\'s first name), mode?: new|reply|replyAll|forward, threadId? and replyTo? (thread and message ids from mail_read, for replies), accountId? (from mail_accounts; default: their first mailbox) }. The person sees it as an editable draft and sends it themselves.',
  'kind "calendar_event": input { title, start, end (ISO with +05:30), location?, description?, attendees?: [{ name, email }], sendInvite? (true emails invitations) }.',
  'kind "crm_contact": input { name, email?, phone?, companyName?, title? }.',
  'kind "crm_deal": input { title, value? (rupees), contactId? (from search_records), expectedClose? (YYYY-MM-DD) }.',
  'kind "invoice_draft": input { client: { name, company?, email?, phone?, gstin?, state? }, lines: [{ name, quantity, rate (rupees per unit, before tax), taxPercent? (GST %, default 18), hsn? }], dueDate?, notes? } — saved as a draft invoice, not sent.',
  'kind "business_profile": input { legalName?, gstin?, pan?, address?: { line1, line2?, city, state, postalCode }, phone?, email?, website?, upiId? } — only what they told you; saved to the company and to invoices.',
  'kind "invite_member": input { email, role?: ' + INVITE_ROLES.join("|") + " } — emails them an invitation.",
  'kind "inventory_items": input { items: [{ name, sku?, unit? (' + UNITS.join("|") + '), category?, hsn?, gstRate? (' + GST_RATES.join("|") + '), cost? (rupees per unit) }] } — new items in inventory.',
  'kind "save_document": input { attachmentId (f1, f2…), title, description? } — files the upload in Documents.',
  'kind "mail_tidy": input { threadIds: [thread ids from mail_search], action: ' + MAIL_TIDY.join("|") + ', value? (snooze/followup: ISO time with +05:30 — snooze hides it until then, followup reminds them if nobody replies by then; label: the label name) } — one proposal can cover many emails (archive every newsletter, mark a batch read).',
  'kind "reminder": input { title, at (ISO time with +05:30), details? } — a reminder in Notes that notifies them at that time.',
  'kind "note": input { title, body (plain text; blank lines between paragraphs, "- " for list items), tags? } — saves a note, e.g. meeting minutes, a plan or a summary they want to keep.',
  'kind "business_document": input { kindId (one of: ' + DOC_KINDS.map((k) => k.id).join(", ") + '), request (everything they told you: parties, amounts, dates, places, special terms), title?, answers? ({ key: value } for facts you know), language? } — the document studio drafts it to a legal standard (required clauses, Indian law, their letterhead), reviews it and saves it in Documents to edit, sign or send. Use it whenever they want a contract, letter, notice, policy or other business document to keep or send.',
  "Bills and receipts are never typed by you: use the extract_bill tool, which reads the file and prepares them.",
].join(" ");

// ── Reading, as the person ──────────────────────────────────────────────────

export const WORKSPACE_TOOLS = [
  {
    name: "mail_accounts",
    description: "List the mailboxes this person can send from (id, address, name). Needed before drafting from a particular mailbox.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "mail_search",
    description:
      "Search this person's email (all their mailboxes). query supports from:, to:, subject:, is:unread, is:starred, has:attachment, before:/after:YYYY-MM-DD and free words (bodies too). view: inbox (default), needsreply, important, starred, sent, archive, followups, waiting. Returns thread ids, subjects, senders, dates and snippets.",
    input_schema: { type: "object", properties: { query: { type: "string" }, view: { type: "string", enum: ["inbox", "needsreply", "important", "starred", "sent", "archive", "followups", "waiting"] }, limit: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "mail_read",
    description: "Read one email thread in full (each message's sender, recipients, date, message id and text), with the CRM contact behind it. Opening it marks it read, as in the inbox.",
    input_schema: { type: "object", properties: { threadId: { type: "string" } }, required: ["threadId"], additionalProperties: false },
  },
  {
    name: "mail_briefing",
    description: "A summary of the last day and a half of this person's inbox, with what needs action.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "calendar_upcoming",
    description: "This person's calendar events from now for the next `days` (1–60, default 7), with times in India time.",
    input_schema: { type: "object", properties: { days: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "invoices_list",
    description: "Invoices across the workspace's books, newest first: number, client, total, balance, due date, status. status filter: draft, sent, viewed, partial, overdue, paid. Needs invoicing access.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["draft", "sent", "viewed", "partial", "overdue", "paid"] }, query: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "identify_document",
    description: `Say what an attached file is, as soon as you've looked at it — the person sees it labelled with quick actions. kind: ${ADVISOR_DOC_KINDS.join(", ")}. title: a short name (e.g. "Menon Traders bill MT/1182"). facts: up to 6 key facts (amounts, dates, parties).`,
    input_schema: { type: "object", properties: { attachmentId: { type: "string" }, kind: { type: "string", enum: [...ADVISOR_DOC_KINDS] }, title: { type: "string" }, facts: { type: "array", items: { type: "string" } } }, required: ["attachmentId", "kind", "title"], additionalProperties: false },
  },
  {
    name: "extract_bill",
    description: "Read an attached supplier bill or receipt with the accounts reader (supplier, GSTIN, bill number, dates, lines mapped to expense accounts, GST, warnings) and prepare it for the person to confirm into Accounts. kind: bill (a supplier's bill to pay) or expense (already paid, e.g. a receipt).",
    input_schema: { type: "object", properties: { attachmentId: { type: "string" }, kind: { type: "string", enum: ["bill", "expense"] } }, required: ["attachmentId"], additionalProperties: false },
  },
  {
    name: "setup_status",
    description: "What this workspace has set up and what's missing: business details (legal name, GSTIN, address), invoice details, mailboxes, team, customers, products. Call this when the person is new or asks to get set up.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "knowledge_search",
    description: "Search the business's knowledge base (its own policies, price lists, FAQs, processes, product details) for passages matching a question. Use it before answering anything about how this business works that the records don't hold.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "dashboard_overview",
    description: "The person's Home dashboard as they see it right now: headline figures with change against the previous period (sales, money owed, cash, stock, pipeline, team…), the alerts it raises, what's waiting on them (approvals, overdue tasks), and recent activity. Start here for \"how is the business doing\", recaps and \"what needs my attention\".",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "trend",
    description: "A month-by-month series for one measure of a dataset (from list_datasets), with growth, the average month, the best and worst months, the current run rate and a simple 3-month projection. Use it for trends, growth, seasonality and forecasts. measure: { field? (omit to count rows), agg: sum|count|avg|min|max|distinct }. months: 3–24 (default 12). filters: as in run_report.",
    input_schema: { type: "object", properties: { dataset: { type: "string" }, measure: { type: "object" }, months: { type: "integer" }, filters: { type: "array", items: { type: "object" } } }, required: ["dataset", "measure"], additionalProperties: false },
  },
  {
    name: "mail_analytics",
    description: "Email analytics for the person's mailboxes over 7, 30 or 90 days: mail received and sent, typical reply time and the slowest 10%, reply rate, how much is answered within the reply target, who's waiting longest, top senders and domains, categories, the busiest hours, and per-mailbox and per-teammate figures — each compared with the period before.",
    input_schema: { type: "object", properties: { days: { type: "integer", enum: [7, 30, 90] } }, additionalProperties: false },
  },
  {
    name: "recall_conversations",
    description: "Search this person's earlier conversations with you, newest first, for what was asked, answered or decided (\"what did we decide about Sharma's discount\", \"the quote I made last week\"). Returns each conversation's title, date and the matching passages.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "show_chart",
    description: "Draw a chart inside your answer from figures you've already looked up (never invented). kind: bar (comparisons, rankings), line or area (over time), pie (shares of a whole, 2–6 parts). unit: money (values in rupees), number or percent. labels: the x-axis or slice names. series: 1–4 named series, each with one value per label. Use it whenever a trend, comparison or breakdown is clearer as a picture, then explain the takeaway in words.",
    input_schema: { type: "object", properties: { title: { type: "string" }, kind: { type: "string", enum: ["bar", "line", "area", "pie"] }, unit: { type: "string", enum: ["money", "number", "percent"] }, labels: { type: "array", items: { type: "string" } }, series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } } }, required: ["title", "kind", "unit", "labels", "series"], additionalProperties: false },
  },
  {
    name: "suggest_next",
    description: "At the end of an answer, offer 2–4 short follow-ups the person can tap (each a complete request in their voice, under 60 characters, e.g. \"Draft reminders for the overdue ones\", \"Show this as a chart by month\"). Use it after most answers.",
    input_schema: { type: "object", properties: { prompts: { type: "array", items: { type: "string" } } }, required: ["prompts"], additionalProperties: false },
  },
  {
    name: "remember",
    description: "Keep one lasting fact or preference this person told you, for future conversations: about their business (key clients, pricing rules, payment terms, suppliers), their role, or how they like things done (tone, sign-off, report format). One short self-contained sentence. Not for one-off details, things already in the records, or anything secret (passwords, codes, card or bank numbers). Saved straight away; say briefly that you'll remember it.",
    input_schema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"], additionalProperties: false },
  },
] as const;

