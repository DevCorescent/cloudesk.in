// Written documents: what's stored (the editor's JSON), the page it's laid out
// on, and the sums used everywhere — its plain text for search and previews,
// its word count, its outline, and the fill-in fields a template leaves.
// Nothing here depends on the editor, so the server and exports share it.
import { z } from "zod";

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; marks?: PMMark[]; text?: string };

export const emptyDoc = (): PMNode => ({ type: "doc", content: [{ type: "paragraph" }] });

// ── The page ────────────────────────────────────────────────────────────────

/** Paper sizes, in millimetres (portrait). */
export const PAPER = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A5: [148, 210] } as const;
export type Paper = keyof typeof PAPER;

export const FONTS = [
  { id: "Inter", label: "Inter", css: "Inter, ui-sans-serif, system-ui, sans-serif", kind: "sans" },
  { id: "Arial", label: "Arial", css: "Arial, Helvetica, sans-serif", kind: "sans" },
  { id: "Helvetica", label: "Helvetica", css: "Helvetica, Arial, sans-serif", kind: "sans" },
  { id: "Verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif", kind: "sans" },
  { id: "Georgia", label: "Georgia", css: "Georgia, 'Times New Roman', serif", kind: "serif" },
  { id: "Times New Roman", label: "Times New Roman", css: "'Times New Roman', Times, serif", kind: "serif" },
  { id: "Garamond", label: "Garamond", css: "Garamond, 'EB Garamond', Georgia, serif", kind: "serif" },
  { id: "Palatino", label: "Palatino", css: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif", kind: "serif" },
  { id: "Courier New", label: "Courier New", css: "'Courier New', Courier, monospace", kind: "mono" },
] as const;
export const fontCss = (id: string | null | undefined) => FONTS.find((f) => f.id === id)?.css ?? FONTS[0].css;
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72] as const;
export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2"] as const;

export const pageSchema = z
  .object({
    paper: z.enum(Object.keys(PAPER) as [Paper, ...Paper[]]).default("A4"),
    landscape: z.boolean().default(false),
    /** Margins, mm. */
    margins: z.object({ top: z.number().min(5).max(60), right: z.number().min(5).max(60), bottom: z.number().min(5).max(60), left: z.number().min(5).max(60) }).default({ top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }),
    font: z.string().max(40).default("Inter"),
    fontSize: z.number().min(8).max(24).default(11),
    lineHeight: z.enum(LINE_HEIGHTS).default("1.5"),
    header: z.string().max(200).default(""),
    footer: z.string().max(200).default(""),
    pageNumbers: z.boolean().default(true),
    /** Pageless: one long page that fits the window (no page edges). */
    pageless: z.boolean().default(false),
  })
  .prefault({});
export type PageSetup = z.infer<typeof pageSchema>;
export const pageOf = (raw: unknown): PageSetup => {
  const r = pageSchema.safeParse(raw ?? {});
  return r.success ? r.data : pageSchema.parse({});
};
/** Page width and height in mm, after orientation. */
export const pageMm = (p: PageSetup) => {
  const [w, h] = PAPER[p.paper];
  return p.landscape ? { w: h, h: w } : { w, h };
};

// ── Content checks ─────────────────────────────────────────────────────────

export const MAX_DOC_JSON = 4 * 1024 * 1024;

/** Editor JSON, checked for shape (not schema — the editor drops unknown nodes) and size. */
export const docJsonSchema = z.custom<PMNode>((v) => {
  if (!v || typeof v !== "object" || (v as PMNode).type !== "doc") return false;
  try {
    return JSON.stringify(v).length <= MAX_DOC_JSON && depth(v as PMNode) <= 60;
  } catch {
    return false;
  }
}, "That isn't a document");
function depth(n: PMNode, d = 0): number {
  if (d > 60) return d;
  return Math.max(d, ...(n.content ?? []).map((c) => depth(c, d + 1)));
}

// ── Text, words, outline ───────────────────────────────────────────────────

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "listItem", "taskItem", "tableRow", "detailsSummary", "callout", "horizontalRule", "pageBreak"]);

/** The document as plain text: blocks on their own lines, table cells separated by tabs. */
export function textOf(n: PMNode | null | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return `@${String(n.attrs?.label ?? "")}`;
  if (n.type === "tableCell" || n.type === "tableHeader") return (n.content ?? []).map(textOf).join(" ").trim() + "\t";
  const inner = (n.content ?? []).map(textOf).join("");
  return BLOCKS.has(n.type) ? `${inner.replace(/\t$/, "")}\n` : inner;
}
export const wordsIn = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu) ?? []).length;
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));
export const snippetOf = (text: string, n = 220) => text.replace(/\s+/g, " ").trim().slice(0, n);

export type Heading = { level: number; text: string; index: number };
/** Headings in order (index counts headings, so the editor can scroll to the n-th one). */
export function outlineOf(doc: PMNode | null | undefined): Heading[] {
  const out: Heading[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "heading") out.push({ level: Number(n.attrs?.level ?? 1), text: textOf(n).trim(), index: out.length });
    else n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out.filter((h) => h.text);
}

/** People mentioned (@name) in the document. */
export function mentionsIn(doc: PMNode | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === "mention" && (n.attrs?.kind ?? "person") === "person" && typeof n.attrs?.id === "string") ids.add(n.attrs.id);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return [...ids];
}

/** Comment ids still anchored in the text (a thread whose text was deleted shows as detached). */
export function commentIdsIn(doc: PMNode | null | undefined): Set<string> {
  const ids = new Set<string>();
  const walk = (n: PMNode) => {
    for (const m of n.marks ?? []) if (m.type === "comment" && typeof m.attrs?.id === "string") ids.add(m.attrs.id);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return ids;
}

// ── Fill-in fields ─────────────────────────────────────────────────────────

/** Templates leave {{Field name}} where something goes; Fill in replaces each everywhere. */
export const FIELD_RE = /\{\{\s*([^{}]{1,60}?)\s*\}\}/g;
export function fieldsIn(doc: PMNode | null | undefined): string[] {
  const t = textOf(doc);
  return [...new Set([...t.matchAll(FIELD_RE)].map((m) => m[1]!.trim()))];
}
export function fillFields(doc: PMNode, values: Record<string, string>): PMNode {
  const fill = (n: PMNode): PMNode => {
    if (n.type === "text" && n.text) return { ...n, text: n.text.replace(FIELD_RE, (all, k: string) => (values[k.trim()] !== undefined && values[k.trim()] !== "" ? values[k.trim()]! : all)) };
    return n.content ? { ...n, content: n.content.map(fill) } : n;
  };
  return fill(doc);
}

// ── Building documents (templates, imports) ────────────────────────────────

export const t = (text: string, marks?: string[]): PMNode => ({ type: "text", text, ...(marks?.length ? { marks: marks.map((m) => ({ type: m })) } : {}) });
export const p = (...parts: (string | PMNode)[]): PMNode => ({ type: "paragraph", ...(parts.length ? { content: parts.map((x) => (typeof x === "string" ? t(x) : x)).filter((x) => x.type !== "text" || x.text) } : {}) });
export const h = (level: 1 | 2 | 3 | 4, text: string): PMNode => ({ type: "heading", attrs: { level }, content: [t(text)] });
export const ul = (...items: string[]): PMNode => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
export const ol = (...items: string[]): PMNode => ({ type: "orderedList", attrs: { start: 1 }, content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
export const tasks = (...items: string[]): PMNode => ({ type: "taskList", content: items.map((i) => ({ type: "taskItem", attrs: { checked: false }, content: [p(i)] })) });
export const table = (head: string[], ...rows: string[][]): PMNode => ({
  type: "table",
  content: [{ type: "tableRow", content: head.map((c) => ({ type: "tableHeader", content: [p(c)] })) }, ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => ({ type: "tableCell", content: [p(c)] })) }))],
});
export const callout = (tone: "info" | "success" | "warning" | "danger", ...parts: (string | PMNode)[]): PMNode => ({ type: "callout", attrs: { tone }, content: [p(...parts)] });
export const hr = (): PMNode => ({ type: "horizontalRule" });
export const center = (n: PMNode): PMNode => ({ ...n, attrs: { ...n.attrs, textAlign: "center" } });
const doc = (...content: PMNode[]): PMNode => ({ type: "doc", content });

// ── Templates ──────────────────────────────────────────────────────────────

export type DocTemplate = { id: string; name: string; group: "Start" | "Business" | "Legal" | "People" | "Projects"; line: string; icon: string; page?: Partial<PageSetup>; build: () => PMNode };

export const DOC_TEMPLATES: DocTemplate[] = [
  { id: "blank", name: "Blank document", group: "Start", line: "Start from a clean page", icon: "📄", build: emptyDoc },
  {
    id: "meeting",
    name: "Meeting notes",
    group: "Business",
    line: "Agenda, decisions and actions",
    icon: "🗓️",
    build: () => doc(h(1, "{{Meeting}} — notes"), p(t("Date: ", ["bold"]), "{{Date}}   ", t("Attendees: ", ["bold"]), "{{Attendees}}"), h(2, "Agenda"), ol("", ""), h(2, "Discussion"), p(""), h(2, "Decisions"), ul(""), h(2, "Actions"), table(["Action", "Owner", "Due"], ["", "", ""], ["", "", ""])),
  },
  {
    id: "proposal",
    name: "Proposal",
    group: "Business",
    line: "Win the work: scope, plan and price",
    icon: "💼",
    build: () =>
      doc(
        center(h(1, "Proposal for {{Client name}}")),
        center(p("Prepared by {{Your company}} · {{Date}}")),
        hr(),
        h(2, "Summary"),
        p("What {{Client name}} needs, and how we'll deliver it."),
        h(2, "Scope of work"),
        ul("", "", ""),
        h(2, "Timeline"),
        table(["Phase", "What happens", "When"], ["Discovery", "", ""], ["Delivery", "", ""], ["Handover", "", ""]),
        h(2, "Investment"),
        table(["Item", "Qty", "Price"], ["", "", ""], ["Total", "", "{{Total}}"]),
        callout("info", "This proposal is valid for 30 days from {{Date}}."),
        h(2, "Next steps"),
        p("Reply to accept, and we'll send the agreement for signature."),
      ),
  },
  {
    id: "nda",
    name: "Non-disclosure agreement",
    group: "Legal",
    line: "Mutual NDA, ready to fill and sign",
    icon: "🔒",
    page: { font: "Georgia" },
    build: () =>
      doc(
        center(h(1, "Mutual Non-Disclosure Agreement")),
        p("This Agreement is made on {{Date}} between ", t("{{Your company}}", ["bold"]), " (“First Party”) and ", t("{{Other party}}", ["bold"]), " (“Second Party”)."),
        h(2, "1. Purpose"),
        p("The parties wish to explore {{Purpose}} and may share confidential information for that purpose."),
        h(2, "2. Confidential information"),
        p("Confidential information means any information disclosed by one party to the other that is marked confidential or would reasonably be understood to be confidential."),
        h(2, "3. Obligations"),
        ol("Use the information only for the Purpose.", "Not disclose it to anyone except employees and advisers who need to know it.", "Protect it with at least reasonable care."),
        h(2, "4. Term"),
        p("This Agreement lasts {{Term}} from the date above. The obligations survive for two years after it ends."),
        h(2, "5. Governing law"),
        p("This Agreement is governed by the laws of India, and the courts at {{City}} have jurisdiction."),
        p(""),
        table(["For {{Your company}}", "For {{Other party}}"], ["Name:", "Name:"], ["Signature:", "Signature:"], ["Date:", "Date:"]),
      ),
  },
  {
    id: "service-agreement",
    name: "Service agreement",
    group: "Legal",
    line: "Scope, fees, payment and termination",
    icon: "📜",
    page: { font: "Georgia" },
    build: () =>
      doc(
        center(h(1, "Service Agreement")),
        p("Between ", t("{{Your company}}", ["bold"]), " (the “Provider”) and ", t("{{Client name}}", ["bold"]), " (the “Client”), dated {{Date}}."),
        h(2, "1. Services"),
        p("The Provider will deliver: {{Services}}."),
        h(2, "2. Fees and payment"),
        p("The Client will pay {{Fee}} plus applicable GST. Invoices are due within {{Payment days}} days."),
        h(2, "3. Term and termination"),
        p("This Agreement starts on {{Start date}} and continues until either party gives {{Notice}} written notice."),
        h(2, "4. Confidentiality"),
        p("Each party keeps the other's confidential information private."),
        h(2, "5. Liability"),
        p("Neither party is liable for indirect losses. Total liability is capped at the fees paid in the previous 12 months."),
        table(["For the Provider", "For the Client"], ["Name:", "Name:"], ["Signature:", "Signature:"]),
      ),
  },
  {
    id: "offer",
    name: "Offer letter",
    group: "People",
    line: "Role, pay and start date",
    icon: "🤝",
    build: () =>
      doc(
        p("{{Date}}"),
        p("Dear {{Candidate name}},"),
        p("We're delighted to offer you the role of ", t("{{Role}}", ["bold"]), " at {{Your company}}."),
        table(["", ""], ["Start date", "{{Start date}}"], ["Annual CTC", "{{CTC}}"], ["Reports to", "{{Manager}}"], ["Location", "{{Location}}"]),
        p("Please sign and return this letter by {{Reply by}} to accept."),
        p("Warm regards,"),
        p("{{Your name}}"),
      ),
  },
  {
    id: "sop",
    name: "Standard operating procedure",
    group: "Projects",
    line: "Steps anyone can follow",
    icon: "🧭",
    build: () => doc(h(1, "SOP: {{Process}}"), table(["Owner", "Last reviewed", "Applies to"], ["{{Owner}}", "{{Date}}", "{{Team}}"]), h(2, "Purpose"), p(""), h(2, "Before you start"), tasks("", ""), h(2, "Steps"), ol("", "", ""), callout("warning", "Stop and ask {{Owner}} if anything looks different."), h(2, "Records to keep"), ul("")),
  },
  {
    id: "brief",
    name: "Project brief",
    group: "Projects",
    line: "Goals, scope, people and dates",
    icon: "🎯",
    build: () => doc(h(1, "{{Project}} — brief"), callout("info", "One page everyone agrees on before work starts."), h(2, "Goal"), p(""), h(2, "In scope"), ul(""), h(2, "Out of scope"), ul(""), h(2, "People"), table(["Role", "Name"], ["Owner", ""], ["Team", ""]), h(2, "Milestones"), table(["Milestone", "Date"], ["", ""], ["", ""]), h(2, "Risks"), ul("")),
  },
  {
    id: "report",
    name: "Weekly report",
    group: "Business",
    line: "Wins, numbers, blockers and next week",
    icon: "📈",
    build: () => doc(h(1, "Week of {{Week}}"), h(2, "Highlights"), ul("", ""), h(2, "Numbers"), table(["Metric", "This week", "Last week"], ["", "", ""], ["", "", ""]), h(2, "Blockers"), ul(""), h(2, "Next week"), tasks("", "")),
  },
  {
    id: "policy",
    name: "Company policy",
    group: "People",
    line: "A policy people can read and follow",
    icon: "🏛️",
    build: () => doc(h(1, "{{Policy name}} policy"), table(["Effective from", "Owner", "Version"], ["{{Date}}", "{{Owner}}", "1.0"]), h(2, "1. Purpose"), p(""), h(2, "2. Who it applies to"), p(""), h(2, "3. The policy"), ol("", ""), h(2, "4. Breaches"), p(""), h(2, "5. Questions"), p("Ask {{Owner}}.")),
  },
];
export const templateById = (id: string) => DOC_TEMPLATES.find((x) => x.id === id);

// ── The drive ──────────────────────────────────────────────────────────────

export const FOLDER_COLORS = ["", "red", "orange", "amber", "green", "teal", "sky", "violet", "pink", "slate"] as const;
export const FOLDER_SWATCH: Record<string, string> = { "": "#8e8e93", red: "#ef4444", orange: "#f97316", amber: "#f59e0b", green: "#22c55e", teal: "#14b8a6", sky: "#0ea5e9", violet: "#8b5cf6", pink: "#ec4899", slate: "#64748b" };
export const SHARE_ROLES = ["view", "comment", "edit"] as const;
export const SHARE_ROLE_LABEL: Record<(typeof SHARE_ROLES)[number], string> = { view: "Can view", comment: "Can comment", edit: "Can edit" };
export const TRASH_DAYS = 30;

/** A file's kind, for icons and filters. */
export function kindOf(f: { kind: string; mime?: string | null; filename?: string | null }): "doc" | "pdf" | "image" | "sheet" | "slides" | "word" | "text" | "archive" | "other" {
  if (f.kind === "doc") return "doc";
  const m = f.mime ?? "";
  const ext = (f.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (/sheet|excel|csv/.test(m) || ["xlsx", "xls", "csv"].includes(ext)) return "sheet";
  if (/presentation|powerpoint/.test(m) || ["pptx", "ppt"].includes(ext)) return "slides";
  if (/word/.test(m) || ["docx", "doc"].includes(ext)) return "word";
  if (m.startsWith("text/") || ["txt", "md"].includes(ext)) return "text";
  if (/zip/.test(m)) return "archive";
  return "other";
}
export const KIND_LABEL: Record<ReturnType<typeof kindOf>, string> = { doc: "Document", pdf: "PDF", image: "Image", sheet: "Spreadsheet", slides: "Presentation", word: "Word file", text: "Text", archive: "ZIP", other: "File" };

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
