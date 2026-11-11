// AI copilot: the tools the model may call, the checks on what it sends, and
// how a stored conversation (the exact messages exchanged with the model) is
// shown to people. The model only reads data through these tools, as the
// person asking; anything that changes data is a proposal the person confirms.
import { z } from "zod";
import { AGGS, BUCKETS, OPS, PRESETS } from "@/lib/bi/model";

import { REVIEW_STANDARD } from "./advisors";
import { WORKSPACE_ACTIONS, WORKSPACE_INPUT, WORKSPACE_LABEL, WORKSPACE_PROMPT, WORKSPACE_TOOLS } from "./workspace-model";

export const ACTION_KINDS = ["crm_task", "crm_note", "work_task", ...WORKSPACE_ACTIONS] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_LABEL: Record<ActionKind, string> = { crm_task: "CRM follow-up", crm_note: "CRM note", work_task: "Project task", ...WORKSPACE_LABEL };
export const SEARCH_KINDS = ["contacts", "deals", "suppliers", "items", "employees", "projects", "documents"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuidOrNull = z.uuid().nullable().default(null);

export const runReportInput = z.object({ dataset: z.string().min(1).max(40), spec: z.record(z.string(), z.unknown()) });
export const searchInput = z.object({ query: z.string().trim().min(1).max(100), kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional() });

export const crmTaskInput = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().max(4000).default(""), dueDate: day.nullable().default(null), priority: z.enum(["low", "normal", "high"]).default("normal"), contactId: uuidOrNull, dealId: uuidOrNull, companyId: uuidOrNull });
export const crmNoteInput = z.object({ body: z.string().trim().min(1).max(4000), contactId: uuidOrNull, dealId: uuidOrNull, companyId: uuidOrNull }).refine((x) => x.contactId || x.dealId || x.companyId, "A note belongs on a contact, company or deal");
export const workTaskInput = z.object({ projectId: z.uuid(), title: z.string().trim().min(1).max(300), description: z.string().max(4000).default(""), dueDate: day.nullable().default(null), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal") });
export const ACTION_INPUT = { crm_task: crmTaskInput, crm_note: crmNoteInput, work_task: workTaskInput, ...WORKSPACE_INPUT } as const;
export const proposeInput = z.object({ kind: z.enum(ACTION_KINDS), summary: z.string().trim().min(1).max(300), input: z.record(z.string(), z.unknown()) });

const target = { contactId: { type: ["string", "null"], description: "Contact id from search_records" }, dealId: { type: ["string", "null"], description: "Deal id from search_records" }, companyId: { type: ["string", "null"] } };

/** Tool definitions sent to the model. Ids always come from search_records, never guessed. */
export const TOOLS = [
  {
    name: "list_datasets",
    description: "List the datasets this person may report on, with each field's key, label and type. Call this before run_report to learn the field keys.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_report",
    description: `Run a grouped, filtered report on one dataset, with this person's permissions. Money values come back already formatted in rupees. spec: { dims: [{ field, bucket? (${BUCKETS.join("|")}, for dates) }] (0–3), measures: [{ field? (omit for a row count), agg: ${AGGS.join("|")} }] (1–6), filters: [{ field, op: ${OPS.join("|")}, value }] (money filters in rupees), range: { preset: ${PRESETS.join("|")}, from?, to? (YYYY-MM-DD, with preset "custom"), field? (a date field; defaults to the dataset's) }, sort: { by: "d0" | "m0" ..., dir: asc|desc }, limit (1–1000) }.`,
    input_schema: { type: "object", properties: { dataset: { type: "string" }, spec: { type: "object" } }, required: ["dataset", "spec"], additionalProperties: false },
  },
  {
    name: "search_records",
    description: `Find records by name, email, code or number, to get their ids and links; "documents" also matches words inside written documents and returns a snippet. kinds: any of ${SEARCH_KINDS.join(", ")} (default: all this person may see).`,
    input_schema: { type: "object", properties: { query: { type: "string" }, kinds: { type: "array", items: { type: "string", enum: [...SEARCH_KINDS] } } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "find_anomalies",
    description: "Run the fixed checks on the books: possible duplicate supplier bills, bills far above a supplier's usual, and expense accounts running well ahead of recent months. Returns each finding with its amount and link. Needs access to Accounts.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_action",
    description:
      'Suggest a change for the person to confirm — nothing is saved until they press Confirm, so say that it is waiting for them. kind "crm_task": input { subject, body?, dueDate? (YYYY-MM-DD), priority? (low|normal|high), contactId?, dealId?, companyId? }. kind "crm_note": input { body, contactId?, dealId?, companyId? } (at least one). kind "work_task": input { projectId, title, description?, dueDate?, priority? (low|normal|high|urgent) }. ' +
      WORKSPACE_PROMPT +
      " summary: one line saying what will happen.",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: [...ACTION_KINDS] }, summary: { type: "string" }, input: { type: "object", properties: { ...target } } }, required: ["kind", "summary", "input"], additionalProperties: false },
  },
  ...WORKSPACE_TOOLS,
] as const;
export type ToolName = (typeof TOOLS)[number]["name"];

export const SYSTEM_PROMPT = `You are the Cloudesk copilot, a senior business assistant inside a business's Cloudesk workspace (CRM, sales, inventory, accounts, HR, projects and more). You help one team member at a time, the way an experienced chief of staff, analyst and operations manager would.

Voice:
- Clear, courteous, confident professional English. No slang, emojis or exclamation marks; no filler ("Great question", "I hope this helps", "Certainly!"). Get to the point in the first sentence.
- Use precise business terms (receivables, working capital, gross margin, input tax credit, lead time, conversion rate, run rate) and explain one briefly only if the person seems unfamiliar with it.
- If they write in Hindi or Hinglish, answer in the same language with the same professional register.

You're their personal business assistant: proactive, organised and focused on getting work off their plate.
- Lead with what matters most to them today; be specific (names, amounts, dates, times).
- After answering, offer the one most useful next step you can do for them — a draft, a reminder, a follow-up, an invoice — and prepare it when they agree.
- When something you see is unclear or stale (a deal with no update, a meeting with no notes), ask them a short question to get the update, then record it in the right place.
- Remind them of meetings, deadlines and money owed when it's relevant to what they asked.
- When asked to plan their day or week, look at calendar_upcoming, overdue tasks (run_report or search), mail_search view needsreply and invoices_list, then give a prioritised list with times.

Business problems of any kind (sales, pricing, cash flow, collections, costs, compliance, hiring, people issues, operations, suppliers, customer complaints, negotiations, growth and strategy):
- If the goal is unclear, ask at most two short questions — only when the answer would change your advice.
- Ground it in their own numbers first: pull the relevant figures with your tools before advising.
- For anything beyond a quick fact, structure the answer as **Situation** (what the data shows), **Options** (two or three, with cost, effort and risk), **Recommendation** (one, and why) and **Next steps** (what, who, by when). Then offer to do the first step yourself.
- Quantify the impact in rupees and time wherever you can, and state your assumptions.
- Know the Indian context: GST (returns, ITC, e-invoicing, e-way bills), TDS, the MSME 45-day payment rule, labour codes, PF/ESI, state rules. Flag when a CA or lawyer should confirm before acting.
- When they want a document they'll keep, sign or send — an agreement, NDA, offer or appointment letter, legal notice, policy, resolution, quotation or proposal — call start_document with everything they told you. The studio opens in the chat and guides them step by step (it asks the details itself, so don't ask them first); then say in one line that it's ready below. Use propose_action kind business_document only when they ask you to just make it without the guided steps. For short text in the chat (a clause, a social post, a quick reply), write it in full right there, with [brackets] only for facts you don't have.

Analytics:
- For "how is the business doing", recaps and what needs attention, start with dashboard_overview — it's what the person sees on Home.
- For trends, growth, seasonality and forecasts use trend; for breakdowns and comparisons use run_report. Say what changed, by how much and why it matters, then what to do about it.
- Show it: call show_chart whenever a picture helps (a series over time, a comparison of 3+ items, shares of a whole) — with the real figures you looked up — and keep the words to the takeaway.
- A forecast is a straight-line projection from recent months; say so, and that seasonality or one-offs can move it.
- For email performance (reply times, backlog, who's waiting, noisy senders) use mail_analytics.

What you know:
- The business's knowledge base and what you've learned from this person (below, when there is any) tell you how this business works: prices, policies, terms, preferences. Rely on it, and use knowledge_search when the answer may be in it. If it disagrees with the records, the records win — mention the difference.
- When the person tells you something lasting (a key client, a pricing rule, how they like reports, their sign-off), call remember. When they correct you or change a preference, remember the corrected version. Don't remember one-off details or anything secret.
- You keep their conversations: when they refer to something from before ("like last time", "the quote we made", "what did we decide"), use recall_conversations before answering.
- Below may also be how they've responded to your suggestions before; lean towards what they accept, and ask before proposing kinds they usually dismiss.

How you work:
- Answer from the workspace's data using your tools. Never invent numbers, names or records; if a tool can't answer, say what you could not find.
- To answer a question about figures, call list_datasets once to learn the fields, then run_report. Prefer one well-built report over many small ones.
- Tools run with this person's permissions. If something isn't open to them, tell them so plainly rather than working around it.
- When asked whether anything looks wrong or unusual in the books, call find_anomalies; explain what each finding means and that it's worth checking, not proof of a mistake.
- To change anything, use propose_action. You cannot save changes yourself; the person confirms each proposal. Never claim a change was made.
- Ids come from search_records or report results — never guess an id.
- Amounts are Indian rupees. Write them like ₹1,25,000. Dates in the workspace are in India time.
- Keep answers concise and concrete: the answer first, then the figures that support it. Use a small table when comparing several rows.
- Formatting: short paragraphs, **bold** for key figures and labels (like **Recommendation:**), short lists and small tables — never italics or headings.

Email:
- Find emails with mail_search, then mail_read before summarising or replying — never reply to an email you haven't read.
- To write or reply, draft it with propose_action kind "send_email": the person reviews and edits the draft, then sends it. Write it as them, in their voice: a clear subject, a short greeting, the point in the first two lines, a specific next step, and their first name. For replies, pass threadId and replyTo (the message id you're answering), reply to the sender, and keep the subject.
- Never say an email was sent — say the draft is ready for them to check and send.
- For "what needs my attention" in mail, use mail_briefing or mail_search with view needsreply.
- To clear the inbox, read each email waiting for a reply and draft every reply as its own send_email proposal, so the person can send each with one click.
- To tidy it, find the threads (newsletters, promotions, read notifications) with mail_search and propose one mail_tidy per action (archive, mark read, label, snooze) covering all of them; say how many emails and from whom.
- For "remind me if they don't reply", propose mail_tidy with action followup on that thread.

Reminders and notes: "remind me to…" is a reminder proposal (ask for the time if they didn't give one); "make a note of…", minutes and plans worth keeping are a note proposal.

Finishing an answer: end most answers by calling suggest_next with 2–4 useful follow-ups.

Calendar and invoices: use calendar_upcoming and invoices_list for questions about the schedule, money owed or overdue invoices; suggest events and draft invoices with propose_action. Ask for a missing time, client or price rather than guessing.

Setting up a new workspace (when they ask to get set up, or setup_status shows gaps):
- Call setup_status first. Then ask for the missing details a few at a time, in plain words — legal name, GSTIN (or "not registered"), PAN, address, phone and email for invoices, UPI ID — and repeat back what you understood.
- Save them with one propose_action kind "business_profile" holding everything they gave. Then offer the next steps: invite teammates (invite_member, ask their email and role), add first customers (crm_contact), connect a mailbox (Mail → Add account), open the online store (/launch?kind=store).
- Check GSTIN and PAN formats before proposing; the state comes from the GSTIN's first two digits.

Files they attach (photos, PDFs, Word, Excel, PowerPoint, CSV) appear as [Attachment f1: …]:
- First call identify_document for each file (kind, a short title, key facts), then answer. Read the whole file carefully; quote figures, names and dates exactly as printed. If something is unreadable or missing, say so — never fill gaps with guesses.
- Supplier bills and receipts: call extract_bill (kind "expense" for something already paid, like a receipt) — it reads the bill into Accounts' format with GST and accounts; then tell them what it found and any warnings.
- Business cards and letterheads: propose crm_contact. Purchase orders: propose invoice_draft from their lines. Price lists and catalogues: propose inventory_items. Contracts: renewal and notice dates as calendar_event. Offer save_document to file anything worth keeping.
- Spreadsheets: answer from the actual rows; total and compare them yourself carefully, and show the figures you used.

Photos taken with the camera ("Analyse this photo…"):
- Say in one line what it is, then what you can read in it (amounts, names, dates, codes), exactly as shown.
- Then **Recommended actions**: a short list, each something concrete — record the bill, add the contact, create a follow-up, update stock, schedule the date, save it to Documents — and propose the most useful one straight away with the right tool.
- Products, shelves, sites or equipment: note visible condition, stock, labelling, safety or compliance issues. Whiteboards and handwritten notes: transcribe them neatly, then offer to turn the action items into tasks.

${REVIEW_STANDARD}`;

/** A short title for a conversation, from its first question. */
export function titleFrom(text: string) {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "New conversation";
  return one.length > 60 ? `${one.slice(0, 57).replace(/\s+\S*$/, "")}…` : one;
}

type Block = { type: string; text?: string; name?: string; id?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown; cc_file?: { id: string; name: string; mime: string } };
type Message = { role: "user" | "assistant"; content: string | Block[] };
export type ChartSpec = { title: string; kind: "bar" | "line" | "area" | "pie"; unit: "money" | "number" | "percent"; labels: string[]; series: { name: string; values: number[] }[] };
export type ViewItem =
  | { role: "user"; text: string; files?: { id: string; name: string; mime: string }[] }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; label: string; toolUseId: string; failed: boolean; doc?: { attachmentId: string; kind: string; title: string; facts: string[] } }
  | { role: "chart"; chart: ChartSpec }
  | { role: "next"; prompts: string[] }
  | { role: "docflow"; kindId: string | null; request: string };

/** A chart the model asked to show, checked and trimmed so a bad one is dropped rather than drawn wrong. */
export function chartOf(input: unknown): ChartSpec | null {
  const i = (input ?? {}) as Record<string, unknown>;
  const labels = Array.isArray(i.labels) ? i.labels.slice(0, 60).map((x) => String(x).slice(0, 40)) : [];
  const series = Array.isArray(i.series)
    ? (i.series as { name?: unknown; values?: unknown }[]).slice(0, 4).map((x) => ({ name: String(x?.name ?? "").slice(0, 40) || "Value", values: Array.isArray(x?.values) ? x.values.slice(0, labels.length).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [] }))
    : [];
  if (!labels.length || !series.length || series.some((x) => x.values.length !== labels.length)) return null;
  const kind = ["bar", "line", "area", "pie"].includes(String(i.kind)) ? (i.kind as ChartSpec["kind"]) : "bar";
  const unit = ["money", "number", "percent"].includes(String(i.unit)) ? (i.unit as ChartSpec["unit"]) : "number";
  return { title: String(i.title ?? "").slice(0, 120), kind, unit, labels, series };
}

/** Follow-ups the model offered, tidied. */
export const nextOf = (input: unknown) => (Array.isArray((input as { prompts?: unknown })?.prompts) ? ((input as { prompts: unknown[] }).prompts.map((p) => String(p).trim().slice(0, 80)).filter(Boolean).slice(0, 4)) : []);

const TOOL_LABEL: Record<string, (input: Record<string, unknown>) => string> = {
  list_datasets: () => "Looked at the available data",
  run_report: (i) => `Ran a report on ${String(i.dataset ?? "data")}`,
  search_records: (i) => `Searched for “${String(i.query ?? "")}”`,
  find_anomalies: () => "Checked the books for anything unusual",
  propose_action: (i) => `Suggested: ${String(i.summary ?? "a change")}`,
  mail_accounts: () => "Checked your mailboxes",
  mail_search: (i) => (i.query ? `Searched email for “${String(i.query)}”` : `Looked through your ${String(i.view ?? "inbox")}`),
  mail_read: () => "Read the email thread",
  mail_briefing: () => "Read what's new in your inbox",
  calendar_upcoming: (i) => `Checked your calendar (next ${Number(i.days) || 7} days)`,
  invoices_list: (i) => (i.status ? `Looked at ${String(i.status)} invoices` : "Looked at your invoices"),
  setup_status: () => "Checked what's set up",
  identify_document: (i) => `Read ${String(i.title ?? "the file")}`,
  extract_bill: () => "Read the bill into Accounts' format",
  knowledge_search: (i) => `Checked the knowledge base for “${String(i.query ?? "")}”`,
  remember: (i) => `Remembered: ${String(i.fact ?? "")}`,
  dashboard_overview: () => "Looked at your dashboard",
  trend: (i) => `Worked out the trend in ${String(i.dataset ?? "the data")}`,
  mail_analytics: (i) => `Analysed your email (${Number(i.days) || 30} days)`,
  recall_conversations: (i) => `Looked back at earlier conversations about “${String(i.query ?? "")}”`,
  show_chart: (i) => `Drew a chart: ${String(i.title ?? "")}`,
  suggest_next: () => "Suggested next steps",
  start_document: () => "Opened the document studio",
};

/** How a tool's use reads to people ("Ran a report on sales"). */
export const toolLabel = (name: string, input: unknown) => (TOOL_LABEL[name] ?? (() => `Used ${name}`))((input ?? {}) as Record<string, unknown>);

/** What people see of a conversation: their questions, the answers, and which tools were used (tool results stay hidden). */
export function toView(messages: unknown[]): ViewItem[] {
  const out: ViewItem[] = [];
  const failed = new Set<string>();
  for (const m of messages as Message[]) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result" && b.is_error && b.tool_use_id) failed.add(b.tool_use_id);
  for (const m of messages as Message[]) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    // Files show as chips on the question they came with, not as their text.
    const files = m.role === "user" ? [...new Map(blocks.filter((b) => b.cc_file).map((b) => [b.cc_file!.id, b.cc_file!])).values()] : [];
    let asked = false;
    for (const b of blocks) {
      if (b.cc_file) continue;
      if (b.type === "text" && b.text?.trim()) {
        if (m.role === "user" && files.length && !asked) {
          out.push({ role: "user", text: b.text, files });
          asked = true;
        } else out.push({ role: m.role, text: b.text } as ViewItem);
      }
      else if (b.type === "tool_use" && m.role === "assistant" && b.name === "show_chart") {
        const chart = chartOf(b.input);
        if (chart) out.push({ role: "chart", chart });
      } else if (b.type === "tool_use" && m.role === "assistant" && b.name === "start_document") {
        const i = (b.input ?? {}) as { kindId?: unknown; request?: unknown };
        out.push({ role: "docflow", kindId: typeof i.kindId === "string" ? i.kindId.slice(0, 40) : null, request: String(i.request ?? "").slice(0, 4000) });
      } else if (b.type === "tool_use" && m.role === "assistant" && b.name === "suggest_next") {
        const prompts = nextOf(b.input);
        if (prompts.length) out.push({ role: "next", prompts });
      } else if (b.type === "tool_use" && m.role === "assistant") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        const doc = b.name === "identify_document" ? { attachmentId: String(input.attachmentId ?? ""), kind: String(input.kind ?? "other"), title: String(input.title ?? ""), facts: Array.isArray(input.facts) ? (input.facts as unknown[]).map(String).slice(0, 6) : [] } : undefined;
        out.push({ role: "tool", name: b.name ?? "", label: (TOOL_LABEL[b.name ?? ""] ?? (() => `Used ${b.name}`))(input), toolUseId: b.id ?? "", failed: failed.has(b.id ?? ""), ...(doc ? { doc } : {}) });
      }
    }
  }
  return out;
}

/** Append a question to a history; a history left ending on tool results gets the question in the same turn. */
export function withQuestion(messages: unknown[], text: string): unknown[] {
  const last = messages[messages.length - 1] as Message | undefined;
  if (last?.role === "user") {
    const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    return [...messages.slice(0, -1), { role: "user", content: [...content, { type: "text", text }] }];
  }
  return [...messages, { role: "user", content: text }];
}

/** A report result as compact text for the model: header, up to `max` rows, money in rupees. */
export function resultText(r: { columns: { label: string; type: string }[]; rows: unknown[][]; totals: (number | null)[]; range: { from: string | null; to: string | null }; truncated: boolean }, max = 60) {
  const fmt = (v: unknown, type: string) => (v === null || v === undefined ? "—" : type === "money" ? `₹${(Number(v) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : type === "bool" ? (v ? "yes" : "no") : String(v));
  const lines = [r.columns.map((c) => c.label).join(" | "), ...r.rows.slice(0, max).map((row) => row.map((v, i) => fmt(v, r.columns[i].type)).join(" | "))];
  if (r.rows.length > max) lines.push(`…${r.rows.length - max} more rows not shown`);
  if (r.rows.length > 1 && r.totals.some((t) => t !== null)) lines.push(r.totals.map((t, i) => (i === 0 ? "Total" : t === null ? "" : fmt(t, r.columns[i].type))).join(" | "));
  const range = r.range.from || r.range.to ? `Dates: ${r.range.from ?? "start"} to ${r.range.to ?? "today"}` : "Dates: all time";
  return [range, ...lines, r.truncated ? "(More rows exist than the limit.)" : ""].filter(Boolean).join("\n");
}
