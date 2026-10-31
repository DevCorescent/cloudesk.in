// A note is a list of blocks. Text blocks hold plain text with light inline
// marks (**bold**, *italic*, ~~strike~~, `code`, ==highlight==, [link](url),
// [[Another note]]), so they stay readable as Markdown and safe to render.
// Shared by the editor, the server (search text, links, exports) and AI.
import { z } from "zod";
import { CalcError, evaluate } from "@/lib/calculator/expr";

export const BLOCK_TYPES = ["p", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "callout", "code", "divider", "toggle", "table", "calc", "image", "link", "record", "date"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type Block = {
  id: string;
  type: BlockType;
  /** The text (for a table, unused; for code, the code; for calc, the expression). */
  text: string;
  /** Nesting for lists and to-dos (0–4). */
  indent?: number;
  checked?: boolean;
  /** callout: info | success | warning | danger | idea */
  tone?: string;
  /** code: language; calc: label */
  lang?: string;
  /** toggle: the hidden part. */
  body?: string;
  open?: boolean;
  /** table: rows of cells (first row is the header). */
  rows?: string[][];
  /** image / link / record */
  url?: string;
  caption?: string;
  /** record: which module, and what to show. */
  module?: string;
  sub?: string;
  /** date: YYYY-MM-DD */
  date?: string;
  /** Text colour / background mark for the whole block. */
  color?: string;
};
export type Doc = { blocks: Block[] };

const s = (n: number) => z.string().max(n);
export const blockSchema: z.ZodType<Block> = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(BLOCK_TYPES),
  text: s(20000).default(""),
  indent: z.number().int().min(0).max(4).optional(),
  checked: z.boolean().optional(),
  tone: s(20).optional(),
  lang: s(40).optional(),
  body: s(20000).optional(),
  open: z.boolean().optional(),
  rows: z.array(z.array(s(2000)).max(20)).max(200).optional(),
  url: z.string().max(2000).refine((u) => !u || /^(https?:\/\/|\/(?!\/))/i.test(u), "Links must start with https:// or /").optional(),
  caption: s(500).optional(),
  module: s(40).optional(),
  sub: s(300).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  color: s(20).optional(),
}) as z.ZodType<Block>;
export const docSchema = z.object({ blocks: z.array(blockSchema).max(2000) });

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const block = (type: BlockType, text = "", extra: Partial<Block> = {}): Block => ({ id: uid(), type, text, ...extra });

// ─── Inline marks ──────────────────────────────────────────────────────────

export type Span = { t: "text" | "b" | "i" | "s" | "code" | "mark" | "link" | "note" | "mention"; text: string; href?: string };

const INLINE = /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(==[^=\n]+==)|(`[^`\n]+`)|(\[\[[^\]\n]{1,200}\]\])|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^\s)]+\))|(\*[^*\n]+\*)|(@[A-Za-z][\w.-]{1,40})/g;

/** Splits text into styled spans. Unsafe links (javascript: etc.) stay plain text. */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", text: text.slice(last, i) });
    const x = m[0];
    if (m[1]) out.push({ t: "b", text: x.slice(2, -2) });
    else if (m[2]) out.push({ t: "s", text: x.slice(2, -2) });
    else if (m[3]) out.push({ t: "mark", text: x.slice(2, -2) });
    else if (m[4]) out.push({ t: "code", text: x.slice(1, -1) });
    else if (m[5]) out.push({ t: "note", text: x.slice(2, -2).trim() });
    else if (m[6]) {
      const k = x.indexOf("](");
      out.push({ t: "link", text: x.slice(1, k), href: x.slice(k + 2, -1) });
    } else if (m[7]) out.push({ t: "i", text: x.slice(1, -1) });
    else out.push({ t: "mention", text: x.slice(1) });
    last = i + x.length;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

/** Text without the marks. */
export const plainOf = (text: string) => spans(text).map((p) => p.text).join("");

/** The titles a note links to with [[…]]. */
export function linkedTitles(doc: Doc) {
  const out = new Set<string>();
  for (const b of doc.blocks) for (const t of [b.text, b.body ?? ""]) for (const p of spans(t)) if (p.t === "note" && p.text) out.add(p.text.toLowerCase());
  return [...out];
}

// ─── Live calculations ─────────────────────────────────────────────────────

/** Works out every calc block in order; earlier results can be used by name ("total = 1200 * 3"). */
export function calcResults(doc: Doc) {
  const env = { vars: {} as Record<string, number>, ans: 0, angle: "deg" as const };
  const out = new Map<string, { value: number } | { error: string }>();
  for (const b of doc.blocks) {
    if (b.type !== "calc" || !b.text.trim()) continue;
    try {
      const r = evaluate(b.text, env);
      env.ans = r.value;
      if (r.assign) env.vars[r.assign] = r.value;
      out.set(b.id, { value: r.value });
    } catch (e) {
      out.set(b.id, { error: e instanceof CalcError ? e.message : "Can't work this out" });
    }
  }
  return out;
}

// ─── Plain text, Markdown and back ─────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 6 });

export function toText(doc: Doc) {
  const calc = calcResults(doc);
  return doc.blocks
    .map((b) => {
      const pad = "  ".repeat(b.indent ?? 0);
      const t = plainOf(b.text);
      switch (b.type) {
        case "todo": return `${pad}[${b.checked ? "x" : " "}] ${t}`;
        case "bullet": return `${pad}• ${t}`;
        case "number": return `${pad}- ${t}`;
        case "divider": return "———";
        case "table": return (b.rows ?? []).map((r) => r.join(" | ")).join("\n");
        case "toggle": return `${t}\n${plainOf(b.body ?? "")}`;
        case "calc": { const r = calc.get(b.id); return `${b.text}${r && "value" in r ? ` = ${fmt(r.value)}` : ""}`; }
        case "image": return b.caption ? `[Image: ${b.caption}]` : "[Image]";
        case "link": case "record": return `${b.text || b.url}${b.url ? ` (${b.url})` : ""}`;
        case "date": return b.date ? `📅 ${b.date}${t ? ` ${t}` : ""}` : t;
        default: return t;
      }
    })
    .filter((x) => x !== "")
    .join("\n");
}

export function toMarkdown(doc: Doc, title = "") {
  const calc = calcResults(doc);
  let n = 0;
  const lines = doc.blocks.map((b) => {
    const pad = "  ".repeat(b.indent ?? 0);
    if (b.type !== "number") n = 0;
    switch (b.type) {
      case "h1": return `# ${b.text}`;
      case "h2": return `## ${b.text}`;
      case "h3": return `### ${b.text}`;
      case "todo": return `${pad}- [${b.checked ? "x" : " "}] ${b.text}`;
      case "bullet": return `${pad}- ${b.text}`;
      case "number": return `${pad}${++n}. ${b.text}`;
      case "quote": return b.text.split("\n").map((l) => `> ${l}`).join("\n");
      case "callout": return `> **${(b.tone ?? "info").toUpperCase()}** ${b.text}`;
      case "code": return `\`\`\`${b.lang ?? ""}\n${b.text}\n\`\`\``;
      case "divider": return "---";
      case "toggle": return `<details><summary>${b.text}</summary>\n\n${b.body ?? ""}\n\n</details>`;
      case "table": {
        const [head = [], ...rest] = b.rows ?? [];
        return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rest.map((r) => `| ${r.join(" | ")} |`)].join("\n");
      }
      case "calc": { const r = calc.get(b.id); return `\`${b.text}\`${r && "value" in r ? ` = **${fmt(r.value)}**` : ""}`; }
      case "image": return `![${b.caption ?? ""}](${b.url ?? ""})`;
      case "link": case "record": return `[${b.text || b.url}](${b.url ?? ""})${b.sub ? ` — ${b.sub}` : ""}`;
      case "date": return `📅 ${b.date ?? ""} ${b.text}`.trim();
      default: return b.text;
    }
  });
  return `${title ? `# ${title}\n\n` : ""}${lines.join("\n\n")}\n`;
}

/** Markdown (or plain text) into blocks — for importing files and pasting. */
export function fromMarkdown(md: string): Doc {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const indent = Math.min(4, Math.floor((raw.match(/^ */)![0].length) / 2));
    let m: RegExpMatchArray | null;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i]!);
      blocks.push(block("code", code.join("\n"), lang ? { lang } : {}));
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) blocks.push(block(`h${m[1]!.length}` as BlockType, m[2]!));
    else if ((m = line.trim().match(/^[-*]\s+\[([ xX])\]\s*(.*)$/))) blocks.push(block("todo", m[2]!, { checked: m[1] !== " ", indent }));
    else if ((m = line.trim().match(/^[-*•]\s+(.*)$/))) blocks.push(block("bullet", m[1]!, { indent }));
    else if ((m = line.trim().match(/^\d+[.)]\s+(.*)$/))) blocks.push(block("number", m[1]!, { indent }));
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) blocks.push(block("divider"));
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push(block("quote", m[1]!));
    else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)) && /^https?:\/\//.test(m[2]!)) blocks.push(block("image", "", { url: m[2]!, caption: m[1]! }));
    else if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|?\s*:?-{3,}/)) {
      const rows: string[][] = [];
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      rows.push(cells(line));
      i++;
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith("|")) rows.push(cells(lines[++i]!));
      blocks.push(block("table", "", { rows }));
    } else blocks.push(block("p", line.trim()));
  }
  return { blocks: blocks.length ? blocks : [block("p")] };
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? []).length;

/** The note's outline: its headings. */
export const outline = (doc: Doc) => doc.blocks.filter((b) => b.type === "h1" || b.type === "h2" || b.type === "h3").map((b) => ({ id: b.id, level: Number(b.type[1]), text: plainOf(b.text) }));

// ─── Templates ─────────────────────────────────────────────────────────────

export type Template = { id: string; name: string; icon: string; line: string; title: string; blocks: () => Block[] };

export const TEMPLATES: Template[] = [
  { id: "blank", name: "Blank", icon: "📄", line: "Start from nothing", title: "", blocks: () => [block("p")] },
  { id: "meeting", name: "Meeting notes", icon: "🤝", line: "Agenda, notes, decisions and action items", title: "Meeting notes", blocks: () => [block("callout", "Date, people and purpose", { tone: "info" }), block("h2", "Agenda"), block("bullet"), block("h2", "Notes"), block("p"), block("h2", "Decisions"), block("bullet"), block("h2", "Action items"), block("todo", "Owner — what — by when")] },
  { id: "one-on-one", name: "1:1", icon: "💬", line: "Wins, blockers, feedback and next steps", title: "1:1", blocks: () => [block("h2", "Wins since last time"), block("bullet"), block("h2", "Blockers"), block("bullet"), block("h2", "Feedback"), block("p"), block("h2", "Next steps"), block("todo")] },
  { id: "call", name: "Client call", icon: "📞", line: "Who, needs, budget, objections, follow-up", title: "Call with ", blocks: () => [block("table", "", { rows: [["", ""], ["Company", ""], ["Contact", ""], ["Budget", ""], ["Timeline", ""]] }), block("h2", "What they need"), block("bullet"), block("h2", "Objections"), block("bullet"), block("h2", "Follow-up"), block("todo", "Send proposal")] },
  { id: "project", name: "Project brief", icon: "🎯", line: "Goal, scope, milestones, risks", title: "Project brief", blocks: () => [block("callout", "One sentence: what success looks like", { tone: "idea" }), block("h2", "Goal"), block("p"), block("h2", "Scope"), block("bullet", "In:"), block("bullet", "Out:"), block("h2", "Milestones"), block("table", "", { rows: [["Milestone", "Owner", "Due"], ["", "", ""]] }), block("h2", "Risks"), block("bullet")] },
  { id: "sop", name: "How-to / SOP", icon: "🧭", line: "A step-by-step procedure your team can follow", title: "How to ", blocks: () => [block("callout", "When to use this, and who it's for", { tone: "info" }), block("h2", "Steps"), block("number"), block("number"), block("number"), block("h2", "Checks"), block("todo")] },
  { id: "budget", name: "Quick budget", icon: "🧮", line: "Live calculations that add up as you type", title: "Budget", blocks: () => [block("calc", "rent = 45000", { lang: "Rent" }), block("calc", "salaries = 3 * 28000", { lang: "Salaries" }), block("calc", "marketing = 15000", { lang: "Marketing" }), block("calc", "total = rent + salaries + marketing", { lang: "Total a month" }), block("calc", "total * 12", { lang: "A year" })] },
  { id: "checklist", name: "Checklist", icon: "✅", line: "Things to tick off", title: "Checklist", blocks: () => [block("todo"), block("todo"), block("todo")] },
];

/** A daily note: today's date, and room for the day (the server adds your meetings and tasks). */
export function dailyBlocks(day: string, agenda: { time: string; title: string; href?: string }[], tasks: { title: string; href?: string; due?: string | null }[]): Block[] {
  const d = new Date(`${day}T00:00:00Z`);
  const label = d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return [
    block("callout", `${label} — what matters most today?`, { tone: "idea" }),
    block("h2", "Today's meetings"),
    ...(agenda.length ? agenda.map((a) => block("bullet", `${a.time} — ${a.href ? `[${a.title.replace(/[[\]]/g, "")}](${a.href})` : a.title}`)) : [block("p", "No meetings today.")]),
    block("h2", "Tasks due"),
    ...(tasks.length ? tasks.map((t) => block("todo", t.href ? `[${t.title.replace(/[[\]]/g, "")}](${t.href})` : t.title)) : [block("todo", "")]),
    block("h2", "Notes"),
    block("p"),
    block("h2", "End of day"),
    block("bullet", "Done:"),
    block("bullet", "Tomorrow:"),
  ];
}

export const COLORS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "violet", "pink"] as const;
export const SWATCH: Record<string, string> = { slate: "#64748b", red: "#ef4444", orange: "#f97316", amber: "#f59e0b", green: "#22c55e", teal: "#14b8a6", sky: "#0ea5e9", violet: "#8b5cf6", pink: "#ec4899" };

// ─── HTML (printing, saving as PDF, downloads) ─────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safe = (h?: string) => (h && /^(https?:\/\/|\/(?!\/))/i.test(h) ? esc(h) : "#");

function inlineHtml(text: string) {
  return spans(text).map((p) => {
    const t = esc(p.text);
    switch (p.t) {
      case "b": return `<strong>${t}</strong>`;
      case "i": return `<em>${t}</em>`;
      case "s": return `<s>${t}</s>`;
      case "code": return `<code>${t}</code>`;
      case "mark": return `<mark>${t}</mark>`;
      case "link": return `<a href="${safe(p.href)}">${t}</a>`;
      case "note": return `<span class="ref">${t}</span>`;
      case "mention": return `<b>@${t}</b>`;
      default: return t;
    }
  }).join("");
}

/** A standalone page for the note. All text is escaped; only http(s) and in-app links are kept. */
export function toHtml(doc: Doc, title: string, meta = "") {
  const calc = calcResults(doc);
  let n = 0;
  const body = doc.blocks.map((b) => {
    if (b.type !== "number") n = 0;
    const pad = b.indent ? ` style="margin-left:${b.indent * 1.5}rem"` : "";
    const t = inlineHtml(b.text);
    switch (b.type) {
      case "h1": return `<h2>${t}</h2>`;
      case "h2": return `<h3>${t}</h3>`;
      case "h3": return `<h4>${t}</h4>`;
      case "todo": return `<p${pad}>${b.checked ? "☑" : "☐"} ${b.checked ? `<s>${t}</s>` : t}</p>`;
      case "bullet": return `<p${pad}>• ${t}</p>`;
      case "number": return `<p${pad}>${++n}. ${t}</p>`;
      case "quote": return `<blockquote>${t}</blockquote>`;
      case "callout": return `<div class="callout">${t}</div>`;
      case "code": return `<pre><code>${esc(b.text)}</code></pre>`;
      case "divider": return "<hr>";
      case "toggle": return `<details open><summary>${t}</summary><p>${inlineHtml(b.body ?? "")}</p></details>`;
      case "table": { const [h = [], ...r] = b.rows ?? []; return `<table><thead><tr>${h.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${r.map((row) => `<tr>${row.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`; }
      case "calc": { const r = calc.get(b.id); return `<p class="calc">${esc(b.lang ? `${b.lang}: ` : "")}<code>${esc(b.text)}</code>${r && "value" in r ? ` = <b>${fmt(r.value)}</b>` : ""}</p>`; }
      case "image": return b.url && /^https?:\/\//.test(b.url) ? `<figure><img src="${safe(b.url)}" alt="${esc(b.caption ?? "")}"><figcaption>${esc(b.caption ?? "")}</figcaption></figure>` : "";
      case "link": case "record": return `<p><a href="${safe(b.url)}">${esc(b.text || b.url || "")}</a>${b.sub ? ` — ${esc(b.sub)}` : ""}</p>`;
      case "date": return `<p>📅 ${esc(b.date ?? "")} ${t}</p>`;
      default: return `<p>${t || "&nbsp;"}</p>`;
    }
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title || "Note")}</title><style>body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#111;max-width:720px;margin:40px auto;padding:0 20px}h1{font-size:30px;margin:0 0 4px}.meta{color:#777;font-size:13px;margin-bottom:28px}h2,h3,h4{margin:1.4em 0 .4em}p{margin:.35em 0}blockquote{border-left:3px solid #ccc;margin:.6em 0;padding-left:14px;color:#444;font-style:italic}.callout{background:#f4f1ff;border-radius:10px;padding:10px 14px;margin:.6em 0}pre{background:#f5f5f5;border-radius:10px;padding:12px;overflow:auto}code{background:#f2f2f2;border-radius:4px;padding:1px 4px}table{border-collapse:collapse;width:100%;margin:.6em 0}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#fafafa}mark{background:#fde68a}img{max-width:100%;border-radius:10px}hr{border:0;border-top:1px solid #ddd;margin:1.2em 0}.ref{background:#eef;border-radius:4px;padding:0 4px}@media print{body{margin:0}}</style></head><body><h1>${esc(title || "Untitled")}</h1>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}${body}</body></html>`;
}
