// AI copilot: the tools the model may call, the checks on what it sends, and
// how a stored conversation (the exact messages exchanged with the model) is
// shown to people. The model only reads data through these tools, as the
// person asking; anything that changes data is a proposal the person confirms.
import { z } from "zod";
import { AGGS, BUCKETS, OPS, PRESETS } from "@/lib/bi/model";

export const ACTION_KINDS = ["crm_task", "crm_note", "work_task"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_LABEL: Record<ActionKind, string> = { crm_task: "CRM follow-up", crm_note: "CRM note", work_task: "Project task" };
export const SEARCH_KINDS = ["contacts", "deals", "suppliers", "items", "employees", "projects", "documents"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuidOrNull = z.uuid().nullable().default(null);

export const runReportInput = z.object({ dataset: z.string().min(1).max(40), spec: z.record(z.string(), z.unknown()) });
export const searchInput = z.object({ query: z.string().trim().min(1).max(100), kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional() });

export const crmTaskInput = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().max(4000).default(""), dueDate: day.nullable().default(null), priority: z.enum(["low", "normal", "high"]).default("normal"), contactId: uuidOrNull, dealId: uuidOrNull, companyId: uuidOrNull });
export const crmNoteInput = z.object({ body: z.string().trim().min(1).max(4000), contactId: uuidOrNull, dealId: uuidOrNull, companyId: uuidOrNull }).refine((x) => x.contactId || x.dealId || x.companyId, "A note belongs on a contact, company or deal");
export const workTaskInput = z.object({ projectId: z.uuid(), title: z.string().trim().min(1).max(300), description: z.string().max(4000).default(""), dueDate: day.nullable().default(null), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal") });
export const ACTION_INPUT = { crm_task: crmTaskInput, crm_note: crmNoteInput, work_task: workTaskInput } as const;
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
      'Suggest a change for the person to confirm — nothing is saved until they press Confirm, so say that it is waiting for them. kind "crm_task": input { subject, body?, dueDate? (YYYY-MM-DD), priority? (low|normal|high), contactId?, dealId?, companyId? }. kind "crm_note": input { body, contactId?, dealId?, companyId? } (at least one). kind "work_task": input { projectId, title, description?, dueDate?, priority? (low|normal|high|urgent) }. summary: one line saying what will happen.',
    input_schema: { type: "object", properties: { kind: { type: "string", enum: [...ACTION_KINDS] }, summary: { type: "string" }, input: { type: "object", properties: { ...target } } }, required: ["kind", "summary", "input"], additionalProperties: false },
  },
] as const;
export type ToolName = (typeof TOOLS)[number]["name"];

export const SYSTEM_PROMPT = `You are the Cloudesk copilot, an assistant inside a business's Cloudesk workspace (CRM, sales, inventory, accounts, HR, projects and more). You help one team member at a time.

How you work:
- Answer from the workspace's data using your tools. Never invent numbers, names or records; if a tool can't answer, say what you could not find.
- To answer a question about figures, call list_datasets once to learn the fields, then run_report. Prefer one well-built report over many small ones.
- Tools run with this person's permissions. If something isn't open to them, tell them so plainly rather than working around it.
- When asked whether anything looks wrong or unusual in the books, call find_anomalies; explain what each finding means and that it's worth checking, not proof of a mistake.
- To change anything, use propose_action. You cannot save changes yourself; the person confirms each proposal. Never claim a change was made.
- Ids come from search_records or report results — never guess an id.
- Amounts are Indian rupees. Write them like ₹1,25,000. Dates in the workspace are in India time.
- Keep answers short and concrete: the answer first, then the figures that support it. Use a small table when comparing several rows.`;

/** A short title for a conversation, from its first question. */
export function titleFrom(text: string) {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "New conversation";
  return one.length > 60 ? `${one.slice(0, 57).replace(/\s+\S*$/, "")}…` : one;
}

type Block = { type: string; text?: string; name?: string; id?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown };
type Message = { role: "user" | "assistant"; content: string | Block[] };
export type ViewItem = { role: "user"; text: string } | { role: "assistant"; text: string } | { role: "tool"; name: string; label: string; toolUseId: string; failed: boolean };

const TOOL_LABEL: Record<string, (input: Record<string, unknown>) => string> = {
  list_datasets: () => "Looked at the available data",
  run_report: (i) => `Ran a report on ${String(i.dataset ?? "data")}`,
  search_records: (i) => `Searched for “${String(i.query ?? "")}”`,
  find_anomalies: () => "Checked the books for anything unusual",
  propose_action: (i) => `Suggested: ${String(i.summary ?? "a change")}`,
};

/** What people see of a conversation: their questions, the answers, and which tools were used (tool results stay hidden). */
export function toView(messages: unknown[]): ViewItem[] {
  const out: ViewItem[] = [];
  const failed = new Set<string>();
  for (const m of messages as Message[]) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result" && b.is_error && b.tool_use_id) failed.add(b.tool_use_id);
  for (const m of messages as Message[]) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === "text" && b.text?.trim()) out.push({ role: m.role, text: b.text });
      else if (b.type === "tool_use" && m.role === "assistant") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        out.push({ role: "tool", name: b.name ?? "", label: (TOOL_LABEL[b.name ?? ""] ?? (() => `Used ${b.name}`))(input), toolUseId: b.id ?? "", failed: failed.has(b.id ?? "") });
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
