// Written documents in and out of other formats: HTML, Markdown, plain text,
// Word (.docx) and PDF. Everything works on the editor's JSON (ProseMirror /
// Tiptap) with no DOM and no editor, so exports run on the server and imports
// land as content the editor's schema accepts (every import goes through
// `finish`, which fits it to the schema and checks it).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import fontkit from "@pdf-lib/fontkit";
import { getSchema } from "@tiptap/core";
import { PDFDocument, PDFString, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { docExtensions } from "@/lib/documents/extensions";
import { fontCss, outlineOf, pageMm, textOf, type PageSetup, type PMMark, type PMNode } from "@/lib/documents/write";
import { zip } from "../export/zip";

/** Fetches an image a document refers to (an `asset:<id>` or a web address) for embedding. */
export type ImageLoader = (src: string) => Promise<{ data: Buffer; mime: string; width?: number; height?: number } | null>;

// ── Shared ─────────────────────────────────────────────────────────────────

let schemaCache: ReturnType<typeof getSchema> | null = null;
const schema = () => (schemaCache ??= getSchema(docExtensions()));

const kids = (n: PMNode) => n.content ?? [];
const markOf = (n: PMNode, type: string) => n.marks?.find((m) => m.type === type);
const has = (n: PMNode, type: string) => !!markOf(n, type);
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const para = (content: PMNode[] = [], attrs?: Record<string, unknown>): PMNode => ({ type: "paragraph", ...(attrs && Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) });
const textNode = (text: string, marks: PMMark[] = []): PMNode => ({ type: "text", text, ...(marks.length ? { marks } : {}) });
const orEmpty = (b: PMNode[]) => (b.length ? b : [para()]);
const itemBody = (b: PMNode[]) => (b[0]?.type === "paragraph" ? b : [para(), ...b]);
const TONES = ["info", "success", "warning", "danger"] as const;
const toneOf = (v: unknown) => (TONES.includes(v as (typeof TONES)[number]) ? (v as (typeof TONES)[number]) : "info");

/** Links people can follow: web, mail, in-page and relative — never javascript:, data: and the like. */
export function safeHref(raw: unknown): string | null {
  const s = str(raw).trim();
  if (!s || s.length > 2048) return null;
  const probe = s.replace(/[\u0000- \u007f]+/g, "").toLowerCase();
  if (/^(https?:|mailto:)/.test(probe)) return s;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return null;
  return s;
}
/** Image sources: web, inline PNG/JPEG/GIF/WebP data, workspace assets and same-site paths. */
function safeSrc(raw: unknown, assetUrl?: (id: string) => string): string | null {
  let s = str(raw).trim();
  const asset = /^asset:([\w-]{1,80})$/i.exec(s);
  if (asset && assetUrl) s = assetUrl(asset[1]);
  else if (asset) return s;
  if (/^https?:\/\//i.test(s) || /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", bull: "•", middot: "·", deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", laquo: "«", raquo: "»", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", ensp: " ", emsp: " ", thinsp: " ", zwj: "‍", zwnj: "‌", shy: "­", iexcl: "¡", iquest: "¿", micro: "µ", sup2: "²", sup3: "³", prime: "′", Prime: "″", minus: "−", le: "≤", ge: "≥", ne: "≠", infin: "∞", check: "✓", hearts: "♥", star: "☆",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", auml: "ä", Auml: "Ä", atilde: "ã", aring: "å", aelig: "æ", ccedil: "ç", Ccedil: "Ç", eacute: "é", Eacute: "É", egrave: "è", Egrave: "È", ecirc: "ê", euml: "ë", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ", Ntilde: "Ñ", oacute: "ó", Oacute: "Ó", ograve: "ò", ocirc: "ô", ouml: "ö", Ouml: "Ö", otilde: "õ", oslash: "ø", uacute: "ú", Uacute: "Ú", ugrave: "ù", ucirc: "û", uuml: "ü", Uuml: "Ü", szlig: "ß", yacute: "ý", yuml: "ÿ",
};
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (all, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? all;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}

/** Colours as [r, g, b] (0–255) from #rgb, #rrggbb, rgb() or a few names. */
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ef4444", green: "#22c55e", blue: "#3b82f6", yellow: "#facc15", orange: "#f97316", purple: "#8b5cf6", pink: "#ec4899", gray: "#6b7280", grey: "#6b7280", teal: "#14b8a6", brown: "#92400e" };
function rgbOf(v: unknown): [number, number, number] | null {
  let s = str(v).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  const r = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (r) return [1, 2, 3].map((i) => clamp(Number(r[i]), 0, 255)) as [number, number, number];
  return null;
}
const hex6 = (c: [number, number, number]) => c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
/** Font sizes like "14pt", "18px" or "1.2em", in points. */
function ptOf(v: unknown, base: number): number | null {
  const m = /^(\d{1,3}(?:\.\d+)?)(pt|px|em|rem)?$/.exec(str(v).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return clamp(m[2] === "px" ? n * 0.75 : m[2] === "em" || m[2] === "rem" ? n * base : n, 4, 96);
}

/** Heading → its index among the document's headings (the `h-<index>` anchors and TOC links). */
function headingIndex(doc: PMNode) {
  const m = new Map<PMNode, number>();
  const walk = (n: PMNode) => (n.type === "heading" ? m.set(n, m.size) : kids(n).forEach(walk));
  walk(doc);
  return m;
}

/** Imported JSON fitted to the schema: unknown nodes dropped, marks ordered and compatible, text merged, structure filled — then checked. */
function finish(doc: PMNode): PMNode {
  const s = schema();
  type M = ReturnType<typeof s.mark>;
  const markSet = (marks: PMMark[] | undefined) => {
    let set: readonly M[] = [];
    for (const m of marks ?? []) {
      if (!s.marks[m.type] || m.type === "comment") continue;
      try {
        set = s.mark(m.type, m.attrs).addToSet(set);
      } catch {
        // A mark with attributes the schema rejects is left off.
      }
    }
    return set.map((m) => m.toJSON() as PMMark);
  };
  const fix = (n: PMNode, depth: number): PMNode | null => {
    const type = s.nodes[n.type];
    if (!type || depth > 60) return null;
    if (n.type === "text") return n.text ? textNode(n.text, markSet(n.marks)) : null;
    if (type.isLeaf) return { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), ...(n.marks?.length ? { marks: markSet(n.marks) } : {}) };
    if (n.type === "codeBlock" || n.type === "detailsSummary") {
      const t = (n.content ?? []).map((c) => (c.type === "hardBreak" ? "\n" : textOf(c))).join("");
      return { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), ...(t ? { content: [textNode(t)] } : {}) };
    }
    let content: PMNode[] = [];
    for (const c of kids(n)) {
      const f = fix(c, depth + 1);
      if (!f) continue;
      const prev = content[content.length - 1];
      if (f.type === "text" && prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(f.marks ?? [])) content[content.length - 1] = { ...prev, text: prev.text! + f.text! };
      else content.push(f);
    }
    if (type.inlineContent) content = content.filter((c) => s.nodes[c.type]!.isInline);
    else {
      // Inline content where blocks belong goes into paragraphs.
      const out: PMNode[] = [];
      const made = new Set<PMNode>();
      for (const c of content) {
        const last = out[out.length - 1];
        if (!s.nodes[c.type]!.isInline) out.push(c);
        else if (last && made.has(last)) last.content!.push(c);
        else {
          const wrapper = para([c]);
          made.add(wrapper);
          out.push(wrapper);
        }
      }
      content = out;
    }
    const spec = String(type.spec.content ?? "");
    if (["bulletList", "orderedList", "taskList", "table"].includes(n.type) && !content.length) return null;
    if (n.type === "listItem" || n.type === "taskItem") content = itemBody(content);
    else if (n.type === "details") {
      const summary = content.find((c) => c.type === "detailsSummary") ?? { type: "detailsSummary" };
      const body = content.find((c) => c.type === "detailsContent") ?? { type: "detailsContent", content: [para()] };
      content = [summary, body];
    } else if (/block\+/.test(spec) && !content.length) content = [para()];
    return { type: n.type, ...(n.attrs ? { attrs: n.attrs } : {}), ...(content.length ? { content } : {}) };
  };
  const fixed = fix(doc, 0) ?? { type: "doc", content: [para()] };
  try {
    const node = s.nodeFromJSON(fixed);
    node.check();
    return node.toJSON() as PMNode;
  } catch {
    // Something still doesn't fit: keep the words, lose the structure.
    return fromTextRaw(textOf(fixed));
  }
}

// ── HTML out ───────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
const cssColor = (v: unknown) => (CSS_COLOR.test(str(v).trim()) ? str(v).trim() : null);

/** The document as semantic HTML — a fragment, or with `standalone` a whole page styled like the document's page setup. */
export function toHtml(doc: PMNode, o: { title: string; page: PageSetup; assetUrl?: (id: string) => string; standalone?: boolean }): string {
  const heads = headingIndex(doc);
  const outline = outlineOf(doc);
  const inline = (ns: PMNode[]) => ns.map(inl).join("");
  const wrap = (m: PMMark, h: string): string => {
    switch (m.type) {
      case "code": return `<code>${h}</code>`;
      case "bold": return `<strong>${h}</strong>`;
      case "italic": return `<em>${h}</em>`;
      case "underline": return `<u>${h}</u>`;
      case "strike": return `<s>${h}</s>`;
      case "subscript": return `<sub>${h}</sub>`;
      case "superscript": return `<sup>${h}</sup>`;
      case "highlight": {
        const c = cssColor(m.attrs?.color);
        return `<mark${c ? ` style="background-color:${esc(c)}"` : ""}>${h}</mark>`;
      }
      case "textStyle": {
        const a = m.attrs ?? {};
        const st: string[] = [];
        if (cssColor(a.color)) st.push(`color:${cssColor(a.color)}`);
        if (cssColor(a.backgroundColor)) st.push(`background-color:${cssColor(a.backgroundColor)}`);
        if (/^\d{1,3}(\.\d+)?(pt|px|em|rem|%)$/.test(str(a.fontSize))) st.push(`font-size:${a.fontSize}`);
        if (/^[\d.]{1,5}(px|pt|em|%)?$/.test(str(a.lineHeight))) st.push(`line-height:${a.lineHeight}`);
        if (/^[\w\s,'"-]{1,80}$/.test(str(a.fontFamily))) st.push(`font-family:${a.fontFamily}`);
        return st.length ? `<span style="${esc(st.join(";"))}">${h}</span>` : h;
      }
      case "link": {
        const href = safeHref(m.attrs?.href);
        return href ? `<a href="${esc(href)}"${href.startsWith("#") ? "" : ` rel="noopener noreferrer nofollow"`}>${h}</a>` : h;
      }
      default: return h;
    }
  };
  const ORDER = ["code", "bold", "italic", "underline", "strike", "subscript", "superscript", "highlight", "textStyle", "link"];
  function inl(n: PMNode): string {
    if (n.type === "hardBreak") return "<br>";
    if (n.type === "mention") {
      const label = esc(`${n.attrs?.kind === "record" ? "" : "@"}${str(n.attrs?.label ?? n.attrs?.id)}`);
      const href = safeHref(n.attrs?.href);
      return href ? `<a class="mention" href="${esc(href)}">${label}</a>` : `<span class="mention">${label}</span>`;
    }
    if (n.type !== "text") return esc(textOf(n));
    let h = esc(n.text ?? "");
    for (const type of ORDER) {
      const m = markOf(n, type);
      if (m) h = wrap(m, h);
    }
    return h;
  }
  const blockStyle = (n: PMNode) => {
    const st: string[] = [];
    const a = str(n.attrs?.textAlign);
    if (["center", "right", "justify"].includes(a)) st.push(`text-align:${a}`);
    const ind = clamp(Number(n.attrs?.indent ?? 0) || 0, 0, 8);
    if (ind) st.push(`margin-left:${ind * 2}em`);
    return st.length ? ` style="${st.join(";")}"` : "";
  };
  const blocks = (ns: PMNode[]) => ns.map(block).join("\n");
  function block(n: PMNode): string {
    switch (n.type) {
      case "paragraph": return `<p${blockStyle(n)}>${inline(kids(n)) || "<br>"}</p>`;
      case "heading": {
        const l = clamp(Number(n.attrs?.level ?? 1) || 1, 1, 4);
        return `<h${l} id="h-${heads.get(n) ?? 0}"${blockStyle(n)}>${inline(kids(n))}</h${l}>`;
      }
      case "blockquote": return `<blockquote>\n${blocks(kids(n))}\n</blockquote>`;
      case "bulletList": return `<ul>\n${blocks(kids(n))}\n</ul>`;
      case "orderedList": {
        const start = Number(n.attrs?.start ?? 1) || 1;
        return `<ol${start !== 1 ? ` start="${start}"` : ""}>\n${blocks(kids(n))}\n</ol>`;
      }
      case "listItem": return `<li>${blocks(kids(n))}</li>`;
      case "taskList": return `<ul class="tasks" data-type="taskList">\n${blocks(kids(n))}\n</ul>`;
      case "taskItem": {
        const c = !!n.attrs?.checked;
        return `<li data-type="taskItem" data-checked="${c}"><input type="checkbox" disabled${c ? " checked" : ""}><div>${blocks(kids(n))}</div></li>`;
      }
      case "codeBlock": {
        const lang = /^[\w+#.-]{1,30}$/.test(str(n.attrs?.language)) ? str(n.attrs?.language) : "";
        return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(textOf(n).replace(/\n$/, ""))}</code></pre>`;
      }
      case "horizontalRule": return "<hr>";
      case "pageBreak": return `<div class="page-break" data-page-break></div>`;
      case "image": {
        const src = safeSrc(n.attrs?.src, o.assetUrl);
        if (!src) return "";
        const w = clamp(Number(n.attrs?.width ?? 100) || 100, 5, 100);
        const align = ["left", "center", "right"].includes(str(n.attrs?.align)) ? str(n.attrs?.align) : "center";
        const cap = str(n.attrs?.caption);
        return `<figure class="image align-${align}"><img src="${esc(src)}" alt="${esc(str(n.attrs?.alt))}"${n.attrs?.title ? ` title="${esc(str(n.attrs.title))}"` : ""} style="width:${w}%">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
      }
      case "table": return `<table>\n<tbody>\n${blocks(kids(n))}\n</tbody>\n</table>`;
      case "tableRow": return `<tr>${blocks(kids(n))}</tr>`;
      case "tableCell":
      case "tableHeader": {
        const tag = n.type === "tableHeader" ? "th" : "td";
        const cs = Number(n.attrs?.colspan ?? 1) || 1, rs = Number(n.attrs?.rowspan ?? 1) || 1;
        const cw = Array.isArray(n.attrs?.colwidth) ? (n.attrs.colwidth as unknown[]).map(Number).filter((x) => x > 0) : [];
        return `<${tag}${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}${cw.length ? ` style="width:${cw.reduce((a, b) => a + b, 0)}px"` : ""}>${blocks(kids(n))}</${tag}>`;
      }
      case "details": {
        const summary = kids(n).find((c) => c.type === "detailsSummary");
        const body = kids(n).find((c) => c.type === "detailsContent");
        return `<details open>\n<summary>${inline(summary ? kids(summary) : [])}</summary>\n${blocks(body ? kids(body) : [])}\n</details>`;
      }
      case "callout": {
        const tone = toneOf(n.attrs?.tone);
        return `<div class="callout callout-${tone}" data-callout data-tone="${tone}" role="note">\n${blocks(kids(n))}\n</div>`;
      }
      case "tableOfContents":
        return `<nav class="toc" data-toc>${outline.length ? `<ul>${outline.map((h) => `<li class="toc-${h.level}"><a href="#h-${h.index}">${esc(h.text)}</a></li>`).join("")}</ul>` : ""}</nav>`;
      default: return n.content ? blocks(kids(n)) : "";
    }
  }
  const body = blocks(kids(doc));
  if (!o.standalone) return body;
  const pg = o.page;
  const { w, h } = pageMm(pg);
  const m = pg.margins;
  const css = `@page { size: ${w}mm ${h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 32px 16px; max-width: ${(w - m.left - m.right).toFixed(1)}mm; font-family: ${fontCss(pg.font)}; font-size: ${pg.fontSize}pt; line-height: ${pg.lineHeight}; color: #1f2328; background: #fff; overflow-wrap: break-word; }
@media print { body { padding: 0; max-width: none; } }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.1em 0 .45em; }
h1 { font-size: 2em; } h2 { font-size: 1.6em; } h3 { font-size: 1.3em; } h4 { font-size: 1.15em; }
p { margin: 0 0 .6em; }
a { color: #0969da; }
blockquote { margin: 0 0 .8em; padding: .1em 1em; border-left: 3px solid #d0d7de; color: #57606a; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace; font-size: .9em; background: #f2f3f5; padding: .1em .3em; border-radius: 4px; }
pre { background: #f6f8fa; padding: .8em 1em; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; margin: 0 0 .8em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
th, td { border: 1px solid #d0d7de; padding: .35em .6em; vertical-align: top; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
th > :last-child, td > :last-child, li > :last-child, .callout > :last-child { margin-bottom: 0; }
li > p { margin: 0 0 .25em; }
ul.tasks { list-style: none; padding-left: .2em; }
ul.tasks li { display: flex; gap: .5em; align-items: baseline; }
ul.tasks li > div { flex: 1; }
.callout { margin: 0 0 1em; padding: .6em 1em; border-left: 4px solid; border-radius: 6px; }
.callout-info { background: #eff6ff; border-color: #3b82f6; }
.callout-success { background: #f0fdf4; border-color: #22c55e; }
.callout-warning { background: #fffbeb; border-color: #f59e0b; }
.callout-danger { background: #fef2f2; border-color: #ef4444; }
figure { margin: 0 0 1em; }
figure.align-center { text-align: center; } figure.align-right { text-align: right; }
img { max-width: 100%; height: auto; }
figcaption { font-size: .85em; color: #57606a; margin-top: .3em; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.2em 0; }
.page-break { break-after: page; page-break-after: always; height: 0; }
@media screen { .page-break { border-top: 1px dashed #d0d7de; margin: 1.5em 0; } }
.toc { margin: 0 0 1em; } .toc ul { list-style: none; padding-left: 0; }
.toc-2 { padding-left: 1.2em; } .toc-3 { padding-left: 2.4em; } .toc-4 { padding-left: 3.6em; }
.mention { color: #6d4fd8; font-weight: 500; text-decoration: none; }
details summary { font-weight: 600; cursor: pointer; margin-bottom: .4em; }
mark { background: #fef08a; }`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title || "Untitled document")}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// ── Markdown out ───────────────────────────────────────────────────────────

const CALLOUT_LABEL = { info: "Note", success: "Tip", warning: "Warning", danger: "Caution" } as const;
const mdUrl = (u: string) => u.replace(/[\s()<>]/g, (c) => ({ " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" })[c] ?? encodeURIComponent(c));
function mdEscape(s: string): string {
  return s
    .replace(/[\\`*~[\]<]/g, "\\$&")
    .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&")
    .replace(/_/g, (u, i: number, all: string) => (/[\p{L}\p{N}]/u.test(all[i - 1] ?? "") && /[\p{L}\p{N}]/u.test(all[i + 1] ?? "") ? u : "\\_"));
}
function codeSpan(t: string) {
  const n = Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length)) + 1;
  const f = "`".repeat(n);
  const pad = n > 1 || /^`|`$/.test(t) || (/^ /.test(t) && / $/.test(t) && t.trim()) ? " " : "";
  return f + pad + t + pad + f;
}

type MdMark = { key: string; open: string; close: string };
function mdMarks(n: PMNode): MdMark[] {
  const out: MdMark[] = [];
  for (const m of n.marks ?? []) {
    if (m.type === "bold") out.push({ key: "b", open: "**", close: "**" });
    else if (m.type === "italic") out.push({ key: "i", open: "_", close: "_" });
    else if (m.type === "strike") out.push({ key: "s", open: "~~", close: "~~" });
    else if (m.type === "underline") out.push({ key: "u", open: "<u>", close: "</u>" });
    else if (m.type === "subscript") out.push({ key: "sub", open: "<sub>", close: "</sub>" });
    else if (m.type === "superscript") out.push({ key: "sup", open: "<sup>", close: "</sup>" });
    else if (m.type === "highlight") out.push({ key: "mark", open: "<mark>", close: "</mark>" });
    else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href) out.push({ key: `a:${href}`, open: "[", close: `](${mdUrl(href)})` });
    }
  }
  return out;
}

function mdInlineOut(nodes: PMNode[], table = false): string {
  // Whitespace at the edges of marked text moves outside the delimiters ("**bold** " not "**bold **").
  type El = { kind: "text" | "code" | "br" | "mention"; text: string; marks: MdMark[] };
  const raw: El[] = nodes.map((n) =>
    n.type === "hardBreak" ? { kind: "br", text: "", marks: [] } : n.type === "mention" ? { kind: "mention", text: `${n.attrs?.kind === "record" ? "" : "@"}${str(n.attrs?.label ?? n.attrs?.id)}`, marks: [] } : has(n, "code") ? { kind: "code", text: n.text ?? "", marks: mdMarks(n).filter((m) => m.key.startsWith("a:")) } : { kind: "text", text: n.text ?? textOf(n), marks: mdMarks(n) },
  );
  const els: El[] = [];
  raw.forEach((e, i) => {
    if (e.kind !== "text" || !e.marks.length) return els.push(e);
    const keys = (x?: El) => new Set((x?.marks ?? []).map((m) => m.key));
    const lead = /^\s+/.exec(e.text)?.[0] ?? "", trail = lead.length === e.text.length ? "" : (/\s+$/.exec(e.text)?.[0] ?? "");
    const prev = keys(raw[i - 1]), next = keys(raw[i + 1]);
    if (lead) els.push({ kind: "text", text: lead, marks: e.marks.filter((m) => prev.has(m.key)) });
    const mid = e.text.slice(lead.length, e.text.length - trail.length);
    if (mid) els.push({ kind: "text", text: mid, marks: e.marks });
    if (trail) els.push({ kind: "text", text: trail, marks: e.marks.filter((m) => next.has(m.key)) });
  });
  let out = "";
  const stack: MdMark[] = [];
  const span = (key: string, from: number) => {
    let j = from;
    while (j < els.length && els[j]!.marks.some((m) => m.key === key)) j++;
    return j - from;
  };
  els.forEach((e, i) => {
    const keys = new Set(e.marks.map((m) => m.key));
    let keep = 0;
    while (keep < stack.length && keys.has(stack[keep]!.key)) keep++;
    while (stack.length > keep) out += stack.pop()!.close;
    const fresh = e.marks.filter((m) => !stack.some((s) => s.key === m.key)).sort((a, b) => span(b.key, i) - span(a.key, i) || Number(b.key.startsWith("a:")) - Number(a.key.startsWith("a:")));
    for (const m of fresh) {
      out += m.open;
      stack.push(m);
    }
    if (e.kind === "br") out += table ? "<br>" : "\\\n";
    else if (e.kind === "code") out += codeSpan(e.text);
    else out += mdEscape(e.text).replace(/\n/g, " ");
  });
  while (stack.length) out += stack.pop()!.close;
  return out;
}
/** Text that would read as Markdown syntax at the start of a line is escaped. */
const mdLineStart = (s: string) => s.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2").replace(/^(#{1,6}(?=\s|$)|>|[-+](?=\s|$)|={2,}\s*$|-{2,}\s*$)/, "\\$1");
const indentRest = (s: string, w: number) => s.split("\n").map((l, i) => (i && l ? " ".repeat(w) + l : l)).join("\n");
const quoteLines = (s: string) => s.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");

/** The document as GitHub-flavoured Markdown. */
export function toMarkdown(doc: PMNode, title?: string): string {
  const outline = outlineOf(doc);
  const blocks = (ns: PMNode[]): string => ns.map(block).filter((s) => s !== "").join("\n\n");
  const item = (n: PMNode): string => {
    const [first, ...rest] = kids(n);
    let s = first?.type === "paragraph" ? mdLineStart(mdInlineOut(kids(first))) : first ? block(first) : "";
    for (const c of rest) {
      const b = block(c);
      if (b) s += (["bulletList", "orderedList", "taskList"].includes(c.type) ? "\n" : "\n\n") + b;
    }
    return s;
  };
  const cell = (n: PMNode) =>
    kids(n)
      .map((c) => (c.type === "paragraph" || c.type === "heading" ? mdInlineOut(kids(c), true) : mdEscape(textOf(c).trim()).replace(/\n/g, "<br>")))
      .join("<br>")
      .replace(/\|/g, "\\|") || " ";
  function block(n: PMNode): string {
    switch (n.type) {
      case "paragraph": return mdLineStart(mdInlineOut(kids(n))).replace(/(?:\\\n| )+$/, "");
      case "heading": return `${"#".repeat(clamp(Number(n.attrs?.level ?? 1) || 1, 1, 4))} ${mdInlineOut(kids(n))}`;
      case "blockquote": return quoteLines(blocks(kids(n)));
      case "callout": {
        const label = `**${CALLOUT_LABEL[toneOf(n.attrs?.tone)]}:**`;
        const [first, ...rest] = kids(n);
        const head = first?.type === "paragraph" ? `${label} ${mdInlineOut(kids(first))}`.trimEnd() : [label, first ? block(first) : ""].filter(Boolean).join("\n\n");
        return quoteLines([head, blocks(rest)].filter(Boolean).join("\n\n"));
      }
      case "bulletList": return kids(n).map((c) => indentRest(`- ${item(c)}`, 2)).join("\n");
      case "taskList": return kids(n).map((c) => indentRest(`- [${c.attrs?.checked ? "x" : " "}] ${item(c)}`.trimEnd(), 2)).join("\n");
      case "orderedList": {
        const start = Number(n.attrs?.start ?? 1) || 1;
        return kids(n)
          .map((c, i) => {
            const m = `${start + i}. `;
            return indentRest(`${m}${item(c)}`, m.length);
          })
          .join("\n");
      }
      case "codeBlock": {
        const t = textOf(n).replace(/\n$/, "");
        const fence = "`".repeat(Math.max(3, ...(t.match(/`{3,}/g) ?? []).map((r) => r.length + 1)));
        const lang = /^[\w+#.-]{1,30}$/.test(str(n.attrs?.language)) ? str(n.attrs?.language) : "";
        return `${fence}${lang}\n${t}\n${fence}`;
      }
      case "horizontalRule":
      case "pageBreak": return "---";
      case "image": {
        const src = safeSrc(n.attrs?.src);
        if (!src) return "";
        const title = str(n.attrs?.title || n.attrs?.caption).replace(/"/g, "'");
        return `![${mdEscape(str(n.attrs?.alt))}](${mdUrl(src)}${title ? ` "${title}"` : ""})`;
      }
      case "table": {
        const rows = kids(n).filter((r) => r.type === "tableRow").map((r) => kids(r).map(cell));
        if (!rows.length) return "";
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? " ").join(" | ")} |`;
        return [line(rows[0]!), `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
      }
      case "details": {
        const summary = kids(n).find((c) => c.type === "detailsSummary");
        const body = kids(n).find((c) => c.type === "detailsContent");
        return `<details>\n<summary>${esc(summary ? textOf(summary).trim() : "")}</summary>\n\n${body ? blocks(kids(body)) : ""}\n\n</details>`;
      }
      case "tableOfContents": return outline.map((h) => `${"  ".repeat(h.level - 1)}- ${mdEscape(h.text)}`).join("\n");
      default: return n.content ? blocks(kids(n)) : "";
    }
  }
  let md = blocks(kids(doc));
  const first = kids(doc)[0];
  if (title && !(first?.type === "heading" && textOf(first).trim() === title.trim())) md = `# ${mdEscape(title)}\n\n${md}`;
  return `${md.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

// ── Markdown in ────────────────────────────────────────────────────────────

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const HTML_BLOCK = /^ {0,3}<(div|table|p|ul|ol|h[1-6]|blockquote|pre|section|figure|hr|img|article)\b/i;
const indentOf = (l: string) => /^ */.exec(l)![0].length;
const blank = (l: string | undefined) => l === undefined || !l.trim();

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i]! + s[i + 1]!;
      i++;
    } else if (s[i] === "|") {
      cells.push(cur);
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/\\\|/g, "|"));
}
const isTableStart = (lines: string[], i: number) => {
  const l = lines[i], sep = lines[i + 1];
  if (!l?.includes("|") || sep === undefined || !TABLE_SEP.test(sep) || !(sep.includes("|") || l.trim().startsWith("|"))) return false;
  return splitRow(l).length === splitRow(sep).length;
};
const startsBlock = (lines: string[], i: number) => {
  const l = lines[i]!;
  if (indentOf(l) > 3) return false;
  return ATX.test(l) || FENCE.test(l) || HR.test(l) || QUOTE.test(l) || /^ {0,3}([-*+]|1[.)])[ \t]+\S/.test(l) || HTML_BLOCK.test(l) || /^ {0,3}<details\b/i.test(l) || isTableStart(lines, i);
};

/** Paragraph inline content, with images lifted out as blocks of their own. */
function inlineBlocks(text: string, attrs?: Record<string, unknown>): PMNode[] {
  const out: PMNode[] = [];
  let run: PMNode[] = [];
  const flush = () => {
    while (run[0]?.type === "hardBreak") run.shift();
    if (run.some((n) => n.type !== "hardBreak" && (n.type !== "text" || n.text!.trim()))) out.push(para(run, attrs));
    run = [];
  };
  for (const n of mdInline(text, [], 0)) {
    if (n.type === "image") {
      flush();
      out.push(n);
    } else run.push(n);
  }
  flush();
  return out;
}

function mdBlocks(lines: string[], depth: number): PMNode[] {
  const out: PMNode[] = [];
  if (depth > 30) return lines.some((l) => l.trim()) ? [para([textNode(lines.join(" ").trim())])] : [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    // Fenced code.
    if ((m = FENCE.exec(line))) {
      const [, ind, fence, lang] = m;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence![0] === "`" ? "`" : "~"}{${fence!.length},}[ \\t]*$`).test(lines[i]!)) body.push(lines[i++]!.replace(new RegExp(`^ {0,${ind!.length}}`), ""));
      i++;
      const t = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language: lang || null }, ...(t ? { content: [textNode(t)] } : {}) });
      continue;
    }
    // Indented code.
    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (indentOf(lines[i]!) >= 4 || (blank(lines[i]) && i + 1 < lines.length && indentOf(lines[i + 1]!) >= 4))) body.push(lines[i++]!.slice(4));
      out.push({ type: "codeBlock", attrs: { language: null }, content: [textNode(body.join("\n"))] });
      continue;
    }
    if ((m = ATX.exec(line))) {
      out.push({ type: "heading", attrs: { level: Math.min(4, m[1]!.length) }, content: mdInline(m[2] ?? "", [], 0).filter((n) => n.type !== "image") });
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i]!);
        if (q) body.push(q[1]!);
        else if (body.length && !blank(body[body.length - 1]) && !startsBlock(lines, i)) body.push(lines[i]!);
        else break;
        i++;
      }
      out.push(quoteOrCallout(mdBlocks(body, depth + 1)));
      continue;
    }
    if (/^ {0,3}<details\b[^>]*>/i.test(line)) {
      const body: string[] = [];
      let nest = 0;
      let rest = line.replace(/^ {0,3}<details\b[^>]*>/i, "");
      for (;;) {
        nest += (rest.match(/<details\b/gi) ?? []).length - (rest.match(/<\/details>/gi) ?? []).length;
        if (nest < 0) {
          body.push(rest.replace(/<\/details>\s*$/i, ""));
          break;
        }
        body.push(rest);
        if (++i >= lines.length) break;
        rest = lines[i]!;
      }
      i++;
      let summary = "";
      const all = body.join("\n").replace(/^\s*<summary>([\s\S]*?)<\/summary>/i, (_, s: string) => ((summary = decodeEntities(s.replace(/<[^>]*>/g, "")).trim()), ""));
      out.push({ type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", ...(summary ? { content: [textNode(summary)] } : {}) }, { type: "detailsContent", content: orEmpty(mdBlocks(all.split("\n"), depth + 1)) }] });
      continue;
    }
    if (HTML_BLOCK.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i])) body.push(lines[i++]!);
      out.push(...htmlBlocks(body.join("\n")));
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i]!.includes("|")) rows.push(splitRow(lines[i++]!));
      const cell = (type: string, t: string): PMNode => ({ type, content: orEmpty(inlineBlocks(t)) });
      out.push({ type: "table", content: [{ type: "tableRow", content: head.map((c) => cell("tableHeader", c)) }, ...rows.map((r) => ({ type: "tableRow", content: head.map((_, j) => cell("tableCell", r[j] ?? "")) }))] });
      continue;
    }
    if ((m = LIST.exec(line)) && (m[3] !== undefined || m[4] === undefined)) {
      const r = mdList(lines, i, depth);
      out.push(...r.nodes);
      i = r.next;
      continue;
    }
    // A paragraph (or a setext heading).
    const body: string[] = [line.trim()];
    i++;
    let level = 0;
    while (i < lines.length && !blank(lines[i])) {
      if (/^ {0,3}=+[ \t]*$/.test(lines[i]!)) level = 1;
      else if (/^ {0,3}-+[ \t]*$/.test(lines[i]!)) level = 2;
      if (level) {
        i++;
        break;
      }
      if (startsBlock(lines, i)) break;
      body.push(lines[i++]!.replace(/^ +/, ""));
    }
    const text = body.join("\n");
    if (level) out.push({ type: "heading", attrs: { level }, content: mdInline(text, [], 0).filter((n) => n.type !== "image") });
    else out.push(...inlineBlocks(text));
  }
  return out;
}

/** A blockquote, or a callout when it starts with **Note:** (or a GitHub `[!NOTE]` alert). */
function quoteOrCallout(blocks: PMNode[]): PMNode {
  const LABELS: Record<string, (typeof TONES)[number]> = { note: "info", info: "info", important: "info", tip: "success", success: "success", warning: "warning", caution: "danger", danger: "danger" };
  const first = blocks[0];
  const lead = first?.type === "paragraph" ? kids(first)[0] : undefined;
  if (lead?.type === "text") {
    const bold = has(lead, "bold") && /^(\w+):?$/.exec(lead.text!.trim());
    const alert = !lead.marks?.length && /^\[!(\w+)\]\s*/.exec(lead.text!);
    const word = (bold && bold[1]) || (alert && alert[1]);
    const tone = word ? LABELS[word.toLowerCase()] : undefined;
    if (tone && (bold || alert)) {
      let rest = kids(first!).slice(1);
      if (alert) rest = [textNode(lead.text!.slice(alert[0].length)), ...rest];
      while (rest[0]?.type === "hardBreak" || (rest[0]?.type === "text" && !rest[0].text!.trim())) rest = rest.slice(1);
      if (rest[0]?.type === "text") rest = [{ ...rest[0], text: rest[0].text!.replace(/^\s+/, "") }, ...rest.slice(1)];
      const body = rest.length || blocks.length === 1 ? [para(rest), ...blocks.slice(1)] : blocks.slice(1);
      return { type: "callout", attrs: { tone }, content: orEmpty(body) };
    }
  }
  return { type: "blockquote", content: orEmpty(blocks) };
}

function mdList(lines: string[], start: number, depth: number): { nodes: PMNode[]; next: number } {
  const first = LIST.exec(lines[start]!)!;
  const base = first[1]!.length;
  const bullet = /^[-*+]$/.test(first[2]!);
  const delim = bullet ? first[2]! : first[2]!.slice(-1);
  const items: { lines: string[] }[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]!);
    const same = m && m[1]!.length >= base && m[1]!.length <= base + 1 && (m[3] !== undefined || m[4] === undefined) && (bullet ? m[2] === delim : /^\d/.test(m[2]!) && m[2]!.endsWith(delim)) && !HR.test(lines[i]!);
    if (!same) break;
    const spaces = m[3] ?? " ";
    const offset = m[1]!.length + m[2]!.length + (spaces.length > 4 ? 1 : spaces.length);
    const body = [m[4] ?? ""];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (blank(l)) {
        // A blank line continues the item only if what follows is indented into it.
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]!) >= offset) {
          for (; i < j; i++) body.push("");
          continue;
        }
        break;
      }
      if (indentOf(l) >= offset) body.push(l.slice(offset));
      else if (LIST.test(l) && indentOf(l) > base + 1 && !HR.test(l)) body.push(l.trimStart());
      else if (!blank(body[body.length - 1]) && !startsBlock(lines, i) && !LIST.test(l)) body.push(l.trim());
      else break;
      i++;
    }
    items.push({ lines: body });
    // Blank lines between items keep the list going.
    let j = i;
    while (j < lines.length && blank(lines[j])) j++;
    const nx = j < lines.length ? LIST.exec(lines[j]!) : null;
    if (j > i && nx && nx[1]!.length >= base && nx[1]!.length <= base + 1) i = j;
  }
  const parsed = items.map((it) => {
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(it.lines[0] ?? "");
    if (task) it.lines[0] = it.lines[0]!.slice(task[0].length);
    return { task: task ? task[1] !== " " : null, blocks: itemBody(mdBlocks(it.lines, depth + 1)) };
  });
  // Task items and plain items are different lists in the editor; consecutive runs become one each.
  const nodes: PMNode[] = [];
  let n = Number(/^\d+/.exec(first[2]!)?.[0] ?? 1);
  for (const p of parsed) {
    const kind = p.task !== null ? "taskList" : bullet ? "bulletList" : "orderedList";
    let last = nodes[nodes.length - 1];
    if (last?.type !== kind) {
      last = { type: kind, ...(kind === "orderedList" ? { attrs: { start: n } } : {}), content: [] };
      nodes.push(last);
    }
    last.content!.push(p.task !== null ? { type: "taskItem", attrs: { checked: p.task }, content: p.blocks } : { type: "listItem", content: p.blocks });
    n++;
  }
  return { nodes, next: i };
}

const withMark = (marks: PMMark[], m: PMMark) => [...marks.filter((x) => x.type !== m.type), m];

/** Finds the closing delimiter for an emphasis run, skipping escapes and code spans. */
function findClose(s: string, from: number, d: string): number {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(s.slice(j))![0];
      const end = s.indexOf(run, j + run.length);
      if (end > 0) j = end + run.length - 1;
      else j += run.length - 1;
      continue;
    }
    if (!s.startsWith(d, j) || j === from || /\s/.test(s[j - 1]!)) continue;
    if (d.length === 1 && s[j + 1] === d) {
      // Part of a double run: belongs to strong emphasis, not this one.
      while (s[j + 1] === d) j++;
      continue;
    }
    if (d[0] === "_" && /[\p{L}\p{N}]/u.test(s[j + d.length] ?? "")) continue;
    if (d.length === 2 && s[j + 2] === d[0] && s[j + 3] !== d[0]) j++;
    return j;
  }
  return -1;
}

/** Markdown inline syntax → text nodes with marks (and image nodes, lifted out by the caller). */
function mdInline(s: string, marks: PMMark[], depth: number): PMNode[] {
  const out: PMNode[] = [];
  if (depth > 12) return s ? [textNode(s, marks)] : [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(textNode(buf, marks));
    buf = "";
  };
  const linked = marks.some((m) => m.type === "link");
  // Searches that found nothing are remembered, so text full of unmatched * [ ` or <u> stays linear rather than quadratic.
  const missFrom = new Map<string, number>();
  const missed = (key: string, from: number) => from >= (missFrom.get(key) ?? Infinity);
  const miss = (key: string, from: number) => missFrom.set(key, Math.min(from, missFrom.get(key) ?? Infinity));
  const lower = s.toLowerCase();
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    const rest = s.slice(i, i + 400);
    let m: RegExpExecArray | null;
    if (c === "\\") {
      const nx = s[i + 1];
      if (nx === "\n") {
        flush();
        out.push({ type: "hardBreak" });
        i += 2;
        while (s[i] === " ") i++;
      } else if (nx && /[!-/:-@[-`{-~]/.test(nx)) {
        buf += nx;
        i += 2;
      } else {
        buf += c;
        i++;
      }
      continue;
    }
    if (c === "\n") {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, "");
        flush();
        out.push({ type: "hardBreak" });
      } else buf = `${buf.replace(/ +$/, "")} `;
      i++;
      while (s[i] === " ") i++;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(rest)![0];
      let end = missed(run, i) ? -1 : s.indexOf(run, i + run.length);
      while (end > 0 && s[end + run.length] === "`") end = s.indexOf(run, end + run.length + 1);
      if (end < 0) miss(run, i);
      if (end > 0) {
        flush();
        let code = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (/^ [\s\S]*[^ ][\s\S]* $/.test(code)) code = code.slice(1, -1);
        if (code) out.push(textNode(code, [...marks, { type: "code" }]));
        i = end + run.length;
      } else {
        buf += run;
        i += run.length;
      }
      continue;
    }
    if ((c === "!" && s[i + 1] === "[") || c === "[") {
      const img = c === "!";
      const open = i + (img ? 1 : 0);
      let d = 0, j = open;
      // Link text is short; a bracket with no partner nearby is just a bracket.
      for (const stop = Math.min(s.length, open + 2000); j < stop; j++) {
        if (s[j] === "\\") j++;
        else if (s[j] === "[") d++;
        else if (s[j] === "]" && --d === 0) break;
      }
      const dest = j < s.length && s[j] === "]" && s[j + 1] === "(" ? /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'))?\s*\)/.exec(s.slice(j + 1)) : null;
      if (dest) {
        flush();
        const label = s.slice(open + 1, j);
        const href = decodeEntities(dest[1]!.replace(/^<|>$/g, ""));
        const title = dest[2] ? dest[2].slice(1, -1) : "";
        if (img) {
          const src = /^https?:\/\//i.test(href) || /^asset:[\w-]+$/i.test(href) ? href : null;
          const alt = label.replace(/\\(.)/g, "$1");
          if (src) out.push({ type: "image", attrs: { src, alt, ...(title ? { title } : {}) } });
          else if (alt) out.push(textNode(alt, marks));
        } else {
          const safe = safeHref(href);
          out.push(...mdInline(label, safe && !linked ? withMark(marks, { type: "link", attrs: { href: safe } }) : marks, depth + 1));
        }
        i = j + 1 + dest[0].length;
        continue;
      }
      buf += img ? "![" : "[";
      i += img ? 2 : 1;
      continue;
    }
    if (c === "<") {
      if ((m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest))) {
        flush();
        out.push(textNode(m[1]!, linked ? marks : withMark(marks, { type: "link", attrs: { href: m[1] } })));
        i += m[0].length;
        continue;
      }
      if ((m = /^<!--[\s\S]*?-->/.exec(s.slice(i)))) {
        i += m[0].length;
        continue;
      }
      if ((m = /^<br\s*\/?>/i.exec(rest))) {
        flush();
        out.push({ type: "hardBreak" });
        i += m[0].length;
        continue;
      }
      const TAGS: Record<string, PMMark> = { u: { type: "underline" }, ins: { type: "underline" }, sub: { type: "subscript" }, sup: { type: "superscript" }, mark: { type: "highlight" }, s: { type: "strike" }, del: { type: "strike" }, strike: { type: "strike" }, strong: { type: "bold" }, b: { type: "bold" }, em: { type: "italic" }, i: { type: "italic" }, code: { type: "code" } };
      if ((m = /^<(u|ins|sub|sup|mark|s|del|strike|strong|b|em|i|code)>/i.exec(rest))) {
        const tag = m[1]!.toLowerCase();
        const end = missed(tag, i) ? -1 : lower.indexOf(`</${tag}>`, i + m[0].length);
        if (end < 0) miss(tag, i);
        if (end > 0) {
          flush();
          out.push(...mdInline(s.slice(i + m[0].length, end), withMark(marks, TAGS[tag]!), depth + 1));
          i = end + tag.length + 3;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    if (c === "*" || c === "_" || c === "~") {
      const run = new RegExp(`^\\${c}+`).exec(rest)![0];
      const prevWord = /[\p{L}\p{N}]/u.test(s[i - 1] ?? "");
      const tryDelim = (d: string, mark: string) => {
        if (!s[i + d.length] || /\s/.test(s[i + d.length]!) || (c === "_" && prevWord)) return false;
        const end = missed(d, i) ? -1 : findClose(s, i + d.length, d);
        if (end < 0) {
          miss(d, i);
          return false;
        }
        flush();
        out.push(...mdInline(s.slice(i + d.length, end), withMark(marks, { type: mark }), depth + 1));
        i = end + d.length;
        return true;
      };
      if (c === "~" ? run.length >= 2 && tryDelim("~~", "strike") : (run.length >= 2 && tryDelim(c + c, "bold")) || tryDelim(c, "italic")) continue;
      buf += run;
      i += run.length;
      continue;
    }
    if (c === "&" && (m = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/.exec(rest))) {
      buf += decodeEntities(m[0]);
      i += m[0].length;
      continue;
    }
    if (!linked && (c === "h" || c === "w") && !/[\p{L}\p{N}]/u.test(s[i - 1] ?? "") && (m = /^(?:https?:\/\/|www\.)[^\s<]+/i.exec(rest))) {
      const url = m[0].replace(/[.,:;!?'")\]*_~]+$/, "");
      if (url.length > 4) {
        flush();
        out.push(textNode(url, withMark(marks, { type: "link", attrs: { href: url.startsWith("www.") ? `https://${url}` : url } })));
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Markdown (GitHub-flavoured) → a document. */
export function fromMarkdown(md: string): PMNode {
  const lines = str(md).replace(/\r\n?/g, "\n").replace(/^\t+/gm, (t) => "    ".repeat(t.length)).split("\n");
  return finish({ type: "doc", content: orEmpty(mdBlocks(lines, 0)) });
}

// ── HTML in ────────────────────────────────────────────────────────────────

type HEl = { tag: string; attrs: Record<string, string>; kids: (HEl | string)[] };
const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "col", "source", "wbr", "area", "base", "embed", "param", "track", "keygen"]);
const RAW = new Set(["script", "style", "template", "noscript", "iframe", "object", "svg", "math", "title", "textarea", "select", "head", "canvas", "video", "audio"]);
const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "pre", "hr", "section", "article", "header", "footer", "nav", "aside", "main", "figure", "details", "dl", "form", "fieldset", "address"]);
const isWs = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** A forgiving HTML parser: tags, attributes and text into a tree, closing what's left open the way browsers mostly do. */
function parseHtml(html: string): HEl {
  const root: HEl = { tag: "#root", attrs: {}, kids: [] };
  const stack: HEl[] = [root];
  const top = () => stack[stack.length - 1]!;
  const lower = html.toLowerCase();
  const popTo = (tags: string[], stop: string[]) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stop.includes(stack[k]!.tag)) return;
      if (tags.includes(stack[k]!.tag)) {
        stack.length = k;
        return;
      }
    }
  };
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0 || lt > i) top().kids.push(decodeEntities(html.slice(i, lt < 0 ? n : lt)));
    if (lt < 0) break;
    i = lt;
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const e = html.indexOf(">", i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 80));
    if (!m) {
      top().kids.push("<");
      i++;
      continue;
    }
    let j = i + m[0].length;
    const attrs: Record<string, string> = {};
    let self = false;
    while (j < n) {
      while (j < n && isWs(html[j])) j++;
      if (html[j] === ">") {
        j++;
        break;
      }
      if (html[j] === "/") {
        self = true;
        j++;
        continue;
      }
      let k = j;
      while (k < n && !isWs(html[k]) && html[k] !== "/" && html[k] !== ">" && html[k] !== "=") k++;
      const name = html.slice(j, k).toLowerCase();
      j = k;
      while (j < n && isWs(html[j])) j++;
      let val = "";
      if (html[j] === "=") {
        j++;
        while (j < n && isWs(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const e = html.indexOf(q, j + 1);
          val = html.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          let e = j;
          while (e < n && !isWs(html[e]) && html[e] !== ">") e++;
          val = html.slice(j, e);
          j = e;
        }
      }
      if (name && !(name in attrs)) attrs[name] = decodeEntities(val);
      if (!name && html[j] !== ">") j++;
    }
    i = j;
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      popTo([tag], tag === "li" ? ["ul", "ol"] : tag === "td" || tag === "th" || tag === "tr" ? ["table"] : tag === "p" ? ["td", "th", "li", "table", "blockquote", "div"] : []);
      continue;
    }
    if (RAW.has(tag)) {
      if (!self) {
        const e = lower.indexOf(`</${tag}`, i);
        i = e < 0 ? n : (lower.indexOf(">", e) + 1 || n);
      }
      continue;
    }
    if (BLOCK_TAGS.has(tag) && top().tag === "p") stack.pop();
    if (tag === "li") popTo(["li"], ["ul", "ol", "menu"]);
    if (tag === "tr") popTo(["tr"], ["table", "thead", "tbody", "tfoot"]);
    if (tag === "td" || tag === "th") popTo(["td", "th"], ["tr", "table"]);
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") popTo(["thead", "tbody", "tfoot"], ["table"]);
    const el: HEl = { tag, attrs, kids: [] };
    top().kids.push(el);
    if (!VOID.has(tag) && !self && stack.length < 200) stack.push(el);
  }
  return root;
}

const styleOf = (el: HEl) => {
  const out: Record<string, string> = {};
  for (const d of (el.attrs.style ?? "").split(";")) {
    const k = d.indexOf(":");
    if (k > 0) out[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim().toLowerCase();
  }
  return out;
};
const alignOf = (el: HEl, fallback?: string) => {
  const a = styleOf(el)["text-align"] ?? el.attrs.align?.toLowerCase();
  return a && ["left", "center", "right", "justify"].includes(a) ? a : fallback;
};
const isDefaultInk = (c: [number, number, number]) => c[0] < 40 && c[1] < 40 && c[2] < 40;

/** Collects inline content into paragraphs and blocks as the HTML is walked. */
class HtmlOut {
  blocks: PMNode[] = [];
  inl: PMNode[] = [];
  checkbox: boolean | undefined;
  constructor(public align?: string) {}
  text(t: string, marks: PMMark[], pre: boolean) {
    if (!pre) {
      t = t.replace(/[ \t\n\r\f]+/g, " ");
      const last = this.inl[this.inl.length - 1];
      if (!last || last.type === "hardBreak" || (last.type === "text" && last.text!.endsWith(" "))) t = t.replace(/^ /, "");
    }
    if (t) this.inl.push(textNode(t, marks));
  }
  flush() {
    const last = this.inl[this.inl.length - 1];
    if (last?.type === "text") last.text = last.text!.replace(/ +$/, "");
    while (this.inl[this.inl.length - 1]?.type === "hardBreak") this.inl.pop();
    const content = this.inl.filter((x) => x.type !== "text" || x.text);
    if (content.some((x) => x.type !== "text" || x.text!.trim())) this.blocks.push(para(content, this.align && this.align !== "left" ? { textAlign: this.align } : undefined));
    this.inl = [];
  }
  block(n: PMNode) {
    this.flush();
    this.blocks.push(n);
  }
}

function htmlText(el: HEl | string): string {
  if (typeof el === "string") return el;
  if (el.tag === "br") return "\n";
  return el.kids.map(htmlText).join("");
}

function walkHtml(node: HEl | string, marks: PMMark[], out: HtmlOut, depth: number): void {
  if (typeof node === "string") return out.text(node, marks, false);
  if (depth > 80) return;
  const el = node;
  const tag = el.tag;
  const kidsOf = (o: HtmlOut, ms = marks) => el.kids.forEach((k) => walkHtml(k, ms, o, depth + 1));
  const sub = (align?: string) => {
    const o = new HtmlOut(align);
    kidsOf(o);
    o.flush();
    return o;
  };
  const st = styleOf(el);
  const breakBefore = /page/.test(st["page-break-before"] ?? st["break-before"] ?? "");
  const breakAfter = /page|always/.test(st["page-break-after"] ?? st["break-after"] ?? "");
  if (breakBefore) out.block({ type: "pageBreak" });
  switch (tag) {
    case "br":
      out.inl.push({ type: "hardBreak" });
      return;
    case "img": {
      const src = el.attrs.src ?? "";
      if (/^https?:\/\//i.test(src)) {
        const w = Number(el.attrs["data-width"] ?? /^(\d{1,3})%$/.exec(el.attrs.width ?? st.width ?? "")?.[1]);
        out.block({ type: "image", attrs: { src, alt: el.attrs.alt ?? "", ...(el.attrs.title ? { title: el.attrs.title } : {}), ...(w > 0 && w <= 100 ? { width: w } : {}) } });
      }
      return;
    }
    case "hr":
      out.block({ type: "horizontalRule" });
      return;
    case "input":
      if ((el.attrs.type ?? "").toLowerCase() === "checkbox") out.checkbox = "checked" in el.attrs;
      return;
    case "p":
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      out.flush();
      const o = sub(alignOf(el, out.align));
      if (out.checkbox === undefined && o.checkbox !== undefined) out.checkbox = o.checkbox;
      if (tag === "p") {
        // <p><br></p> is how editors write an empty line.
        out.blocks.push(...(o.blocks.length ? o.blocks : el.kids.some((k) => typeof k !== "string" && k.tag === "br") ? [para()] : []));
        break;
      }
      const level = Math.min(4, Number(tag[1]));
      const inline: PMNode[] = [];
      const rest: PMNode[] = [];
      for (const b of o.blocks) {
        if (b.type === "paragraph") {
          if (inline.length) inline.push({ type: "hardBreak" });
          inline.push(...kids(b));
        } else rest.push(b);
      }
      const align = alignOf(el, out.align);
      if (inline.length) out.blocks.push({ type: "heading", attrs: { level, ...(align && align !== "left" ? { textAlign: align } : {}) }, content: inline });
      out.blocks.push(...rest);
      break;
    }
    case "ul":
    case "ol":
    case "menu":
      out.flush();
      out.blocks.push(...htmlList(el, marks, depth));
      break;
    case "blockquote":
      out.block({ type: "blockquote", content: orEmpty(sub().blocks) });
      break;
    case "pre": {
      const code = el.kids.find((k): k is HEl => typeof k !== "string" && k.tag === "code");
      const lang = /language-([\w+#.-]{1,30})/.exec(`${code?.attrs.class ?? ""} ${el.attrs.class ?? ""}`)?.[1] ?? null;
      const t = htmlText(el).replace(/^\n/, "").replace(/\n$/, "");
      out.block({ type: "codeBlock", attrs: { language: lang }, ...(t ? { content: [textNode(t)] } : {}) });
      break;
    }
    case "table": {
      out.flush();
      out.blocks.push(...htmlTable(el, marks, depth));
      break;
    }
    case "details": {
      out.flush();
      const summary = el.kids.find((k): k is HEl => typeof k !== "string" && k.tag === "summary");
      const o = new HtmlOut();
      el.kids.forEach((k) => k !== summary && walkHtml(k, marks, o, depth + 1));
      o.flush();
      const s = summary ? htmlText(summary).replace(/\s+/g, " ").trim() : "";
      out.blocks.push({ type: "details", attrs: { open: true }, content: [{ type: "detailsSummary", ...(s ? { content: [textNode(s)] } : {}) }, { type: "detailsContent", content: orEmpty(o.blocks) }] });
      break;
    }
    case "a": {
      const href = safeHref(el.attrs.href);
      kidsOf(out, href && !href.startsWith("#") ? withMark(marks, { type: "link", attrs: { href } }) : marks);
      break;
    }
    case "li":
    case "dd":
    case "dt":
    case "div":
    case "section":
    case "article":
    case "main":
    case "header":
    case "footer":
    case "nav":
    case "aside":
    case "figure":
    case "figcaption":
    case "form":
    case "fieldset":
    case "address":
    case "body":
    case "html":
    case "center":
    case "dl": {
      out.flush();
      if ("data-page-break" in el.attrs) {
        out.blocks.push({ type: "pageBreak" });
        break;
      }
      if ("data-toc" in el.attrs) {
        out.blocks.push({ type: "tableOfContents" });
        break;
      }
      const o = sub(tag === "center" ? "center" : alignOf(el, out.align));
      if (out.checkbox === undefined && o.checkbox !== undefined) out.checkbox = o.checkbox;
      if ("data-callout" in el.attrs) out.blocks.push({ type: "callout", attrs: { tone: toneOf(el.attrs["data-tone"]) }, content: orEmpty(o.blocks) });
      else out.blocks.push(...o.blocks);
      break;
    }
    default: {
      // Inline formatting, from tags and from inline styles (as pasted from Google Docs or Word).
      let ms = marks;
      const weight = st["font-weight"];
      const plainWeight = weight === "normal" || /^[1-4]00$/.test(weight ?? "");
      if ((tag === "strong" || tag === "b") && !plainWeight) ms = withMark(ms, { type: "bold" });
      else if (weight === "bold" || weight === "bolder" || /^[6-9]00$/.test(weight ?? "")) ms = withMark(ms, { type: "bold" });
      if (["em", "i", "cite", "var", "dfn"].includes(tag) ? st["font-style"] !== "normal" : st["font-style"] === "italic") ms = withMark(ms, { type: "italic" });
      const deco = `${st["text-decoration"] ?? ""} ${st["text-decoration-line"] ?? ""}`;
      if (tag === "u" || tag === "ins" || /underline/.test(deco)) ms = withMark(ms, { type: "underline" });
      if (tag === "s" || tag === "strike" || tag === "del" || /line-through/.test(deco)) ms = withMark(ms, { type: "strike" });
      if (["code", "kbd", "samp", "tt"].includes(tag)) ms = withMark(ms, { type: "code" });
      if (tag === "sub" || st["vertical-align"] === "sub") ms = withMark(ms, { type: "subscript" });
      if (tag === "sup" || st["vertical-align"] === "super") ms = withMark(ms, { type: "superscript" });
      if (tag === "mark") ms = withMark(ms, { type: "highlight" });
      const color = rgbOf(st.color ?? el.attrs.color);
      const bg = rgbOf(st["background-color"]);
      if (color && !isDefaultInk(color)) ms = withMark(ms, { type: "textStyle", attrs: { ...(ms.find((x) => x.type === "textStyle")?.attrs ?? {}), color: `#${hex6(color).toLowerCase()}` } });
      if (bg && !(bg[0] > 250 && bg[1] > 250 && bg[2] > 250) && !/transparent|rgba\([^)]*,\s*0\)/.test(st["background-color"] ?? "")) ms = withMark(ms, { type: "highlight", attrs: { color: `#${hex6(bg).toLowerCase()}` } });
      kidsOf(out, ms);
    }
  }
  if (breakAfter) out.block({ type: "pageBreak" });
}

function htmlList(el: HEl, marks: PMMark[], depth: number): PMNode[] {
  const ordered = el.tag === "ol";
  const items: { task: boolean | null; blocks: PMNode[] }[] = [];
  for (const k of el.kids) {
    if (typeof k === "string") {
      if (k.trim()) {
        if (items.length) items[items.length - 1]!.blocks.push(para([textNode(k.trim(), marks)]));
        else items.push({ task: null, blocks: [para([textNode(k.trim(), marks)])] });
      }
      continue;
    }
    if (k.tag === "ul" || k.tag === "ol") {
      const nested = htmlList(k, marks, depth + 1);
      if (items.length) items[items.length - 1]!.blocks.push(...nested);
      else items.push({ task: null, blocks: nested });
      continue;
    }
    const o = new HtmlOut();
    if (k.tag === "li") k.kids.forEach((c) => walkHtml(c, marks, o, depth + 1));
    else walkHtml(k, marks, o, depth + 1);
    o.flush();
    const flag = k.attrs["data-checked"];
    const task = o.checkbox ?? (flag !== undefined ? flag === "true" : undefined);
    if (k.tag === "li" || !items.length) items.push({ task: task ?? (k.attrs["data-type"] === "taskItem" ? false : null), blocks: o.blocks });
    else items[items.length - 1]!.blocks.push(...o.blocks);
  }
  const out: PMNode[] = [];
  let n = Number(el.attrs.start) || 1;
  for (const it of items) {
    const kind = it.task !== null ? "taskList" : ordered ? "orderedList" : "bulletList";
    let last = out[out.length - 1];
    if (last?.type !== kind) {
      last = { type: kind, ...(kind === "orderedList" ? { attrs: { start: n } } : {}), content: [] };
      out.push(last);
    }
    last.content!.push(it.task !== null ? { type: "taskItem", attrs: { checked: it.task }, content: itemBody(it.blocks) } : { type: "listItem", content: itemBody(it.blocks) });
    n++;
  }
  return out;
}

function htmlTable(el: HEl, marks: PMMark[], depth: number): PMNode[] {
  const rows: HEl[] = [];
  let caption = "";
  const collect = (e: HEl) => {
    for (const k of e.kids) {
      if (typeof k === "string") continue;
      if (k.tag === "tr") rows.push(k);
      else if (k.tag === "caption") caption = htmlText(k).replace(/\s+/g, " ").trim();
      else if (k.tag === "thead" || k.tag === "tbody" || k.tag === "tfoot") collect(k);
    }
  };
  collect(el);
  const span = (v: string | undefined) => clamp(Math.floor(Number(v) || 1), 1, 50);
  const content = rows
    .map((tr) => ({
      type: "tableRow",
      content: tr.kids
        .filter((k): k is HEl => typeof k !== "string" && (k.tag === "td" || k.tag === "th"))
        .map((cell) => {
          const o = new HtmlOut(alignOf(cell));
          cell.kids.forEach((c) => walkHtml(c, marks, o, depth + 1));
          o.flush();
          return { type: cell.tag === "th" ? "tableHeader" : "tableCell", attrs: { colspan: span(cell.attrs.colspan), rowspan: span(cell.attrs.rowspan) }, content: orEmpty(o.blocks) } as PMNode;
        }),
    }))
    .filter((r) => r.content.length);
  if (!content.length) return caption ? [para([textNode(caption, [{ type: "bold" }])])] : [];
  // Short rows are padded so the grid stays rectangular (when nothing spans rows).
  if (!content.some((r) => r.content.some((c) => Number(c.attrs!.rowspan) > 1))) {
    const width = (r: { content: PMNode[] }) => r.content.reduce((a, c) => a + Number(c.attrs!.colspan), 0);
    const cols = Math.max(...content.map(width));
    for (const r of content) for (let w = width(r); w < cols; w++) r.content.push({ type: "tableCell", content: [para()] });
  }
  return [...(caption ? [para([textNode(caption, [{ type: "bold" }])])] : []), { type: "table", content }];
}

function htmlBlocks(html: string): PMNode[] {
  const out = new HtmlOut();
  walkHtml(parseHtml(html), [], out, 0);
  out.flush();
  return out.blocks;
}

/** HTML (a web page, pasted content, an export from elsewhere) → a document. Scripts, styles and anything unsafe are dropped. */
export function fromHtml(html: string): PMNode {
  return finish({ type: "doc", content: orEmpty(htmlBlocks(str(html))) });
}

// ── Plain text in ──────────────────────────────────────────────────────────

function fromTextRaw(text: string): PMNode {
  const paras = str(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim());
  const content = paras.map((p) => para(p.split("\n").flatMap((l, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(l ? [textNode(l)] : [])])));
  return { type: "doc", content: orEmpty(content) };
}
/** Plain text → a document: blank lines separate paragraphs, single newlines are line breaks. */
export function fromText(text: string): PMNode {
  return finish(fromTextRaw(text));
}

// ── Word out ───────────────────────────────────────────────────────────────

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${REL}"`;
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
/** Text for XML: escaped, and without characters XML can't hold at all. */
const xe = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, "")
    .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const twips = (mm: number) => Math.round((mm * 1440) / 25.4);
const WORD_HIGHLIGHTS: [string, [number, number, number]][] = [
  ["yellow", [255, 255, 0]], ["green", [0, 255, 0]], ["cyan", [0, 255, 255]], ["magenta", [255, 0, 255]], ["blue", [0, 0, 255]], ["red", [255, 0, 0]], ["darkBlue", [0, 0, 128]], ["darkCyan", [0, 128, 128]], ["darkGreen", [0, 128, 0]], ["darkMagenta", [128, 0, 128]], ["darkRed", [128, 0, 0]], ["darkYellow", [128, 128, 0]], ["darkGray", [128, 128, 128]], ["lightGray", [192, 192, 192]], ["black", [0, 0, 0]],
];
const TONE_FILL = { info: ["EFF6FF", "3B82F6"], success: ["F0FDF4", "22C55E"], warning: ["FFFBEB", "F59E0B"], danger: ["FEF2F2", "EF4444"] } as const;

/** Pixel size of a PNG or JPEG, read from its header. */
function imageSize(data: Buffer): { type: "png" | "jpeg"; w: number; h: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) return { type: "png", w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i++;
        continue;
      }
      const mk = data[i + 1]!;
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { type: "jpeg", h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
      if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) i += 2;
      else i += 2 + data.readUInt16BE(i + 2);
    }
    return { type: "jpeg", w: 0, h: 0 };
  }
  return null;
}

type Loaded = { data: Buffer; type: "png" | "jpeg"; w: number; h: number };
async function loadImages(doc: PMNode, loader: ImageLoader | undefined): Promise<Map<string, Loaded>> {
  const out = new Map<string, Loaded>();
  if (!loader) return out;
  const srcs = new Set<string>();
  const walk = (n: PMNode) => (n.type === "image" && typeof n.attrs?.src === "string" ? srcs.add(n.attrs.src) : kids(n).forEach(walk));
  walk(doc);
  await Promise.all(
    [...srcs].slice(0, 200).map(async (src) => {
      try {
        const r = await loader(src);
        if (!r?.data?.length) return;
        const sz = imageSize(r.data);
        if (!sz) return;
        out.set(src, { data: r.data, type: sz.type, w: r.width || sz.w || 800, h: r.height || sz.h || 600 });
      } catch {
        // An image that won't load is left out rather than failing the export.
      }
    }),
  );
  return out;
}

type RunStyle = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sub?: boolean; sup?: boolean; code?: boolean; link?: boolean; color?: string; size?: number; font?: string; highlight?: string; shd?: string };
function rPr(s: RunStyle): string {
  let x = "";
  if (s.link) x += `<w:rStyle w:val="Hyperlink"/>`;
  else if (s.code) x += `<w:rStyle w:val="CodeChar"/>`;
  const font = s.code ? "Courier New" : s.font;
  if (font) x += `<w:rFonts w:ascii="${xe(font)}" w:hAnsi="${xe(font)}" w:cs="${xe(font)}"/>`;
  if (s.bold) x += "<w:b/><w:bCs/>";
  if (s.italic) x += "<w:i/><w:iCs/>";
  if (s.strike) x += "<w:strike/>";
  if (s.color) x += `<w:color w:val="${s.color}"/>`;
  if (s.size) x += `<w:sz w:val="${s.size}"/><w:szCs w:val="${s.size}"/>`;
  if (s.highlight) x += `<w:highlight w:val="${s.highlight}"/>`;
  if (s.underline) x += `<w:u w:val="single"/>`;
  if (s.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${s.shd}"/>`;
  if (s.sub || s.sup) x += `<w:vertAlign w:val="${s.sup ? "superscript" : "subscript"}"/>`;
  return x ? `<w:rPr>${x}</w:rPr>` : "";
}
const wText = (t: string) =>
  t
    .split(/(\t|\n)/)
    .map((p) => (p === "\t" ? "<w:tab/>" : p === "\n" ? "<w:br/>" : p ? `<w:t xml:space="preserve">${xe(p)}</w:t>` : ""))
    .join("");

type PCtx = { style?: string; ind?: number; hanging?: number; bdr?: string; shd?: string; jc?: string; numPr?: { id: number; lvl: number }; keepNext?: boolean; run?: RunStyle; quote?: boolean; lvl?: number; listBase?: number };
function pPr(c: PCtx): string {
  let x = "";
  if (c.style) x += `<w:pStyle w:val="${c.style}"/>`;
  if (c.keepNext) x += "<w:keepNext/>";
  if (c.numPr) x += `<w:numPr><w:ilvl w:val="${c.numPr.lvl}"/><w:numId w:val="${c.numPr.id}"/></w:numPr>`;
  if (c.bdr) x += `<w:pBdr>${c.bdr}</w:pBdr>`;
  if (c.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${c.shd}"/>`;
  if (c.ind) x += `<w:ind w:left="${Math.round(c.ind)}"${c.hanging ? ` w:hanging="${c.hanging}"` : ""}/>`;
  if (c.jc) x += `<w:jc w:val="${c.jc}"/>`;
  return x ? `<w:pPr>${x}</w:pPr>` : "";
}
const JC: Record<string, string> = { center: "center", right: "right", justify: "both" };

/** The document as a Word file (.docx), built by hand: page setup, styles, lists, tables, links, images, header and footer. */
export async function toDocx(doc: PMNode, o: { title: string; page: PageSetup; images?: ImageLoader }): Promise<Buffer> {
  const pg = o.page;
  const { w: pw, h: ph } = pageMm(pg);
  const m = pg.margins;
  const contentTw = twips(pw - m.left - m.right);
  const contentHTw = twips(ph - m.top - m.bottom);
  const base = pg.fontSize;
  const heads = headingIndex(doc);
  const outline = outlineOf(doc);
  const images = await loadImages(doc, o.images);
  const rels: string[] = [];
  const relId = (type: string, target: string, external = false) => {
    const id = `rId${rels.length + 10}`;
    rels.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${xe(target)}"${external ? ` TargetMode="External"` : ""}/>`);
    return id;
  };
  const media = new Map<string, { id: string; path: string; data: Buffer }>();
  const nums: string[] = [];
  const orderedNum = (start: number, lvl: number) => {
    const id = nums.length + 2;
    nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${lvl}"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`);
    return id;
  };
  let drawingId = 0;

  const runStyle = (n: PMNode, b: RunStyle): RunStyle => {
    const s: RunStyle = { ...b };
    for (const mk of n.marks ?? []) {
      const a = mk.attrs ?? {};
      if (mk.type === "bold") s.bold = true;
      else if (mk.type === "italic") s.italic = true;
      else if (mk.type === "underline") s.underline = true;
      else if (mk.type === "strike") s.strike = true;
      else if (mk.type === "subscript") s.sub = true;
      else if (mk.type === "superscript") s.sup = true;
      else if (mk.type === "code") s.code = true;
      else if (mk.type === "textStyle") {
        const c = rgbOf(a.color);
        if (c) s.color = hex6(c);
        const pt = ptOf(a.fontSize, base);
        if (pt) s.size = Math.round(pt * 2);
        const fam = str(a.fontFamily).split(",")[0]!.replace(/["']/g, "").trim();
        if (fam && /^[\w\s-]{1,40}$/.test(fam)) s.font = fam;
        const bg = rgbOf(a.backgroundColor);
        if (bg) s.shd = hex6(bg);
      } else if (mk.type === "highlight") {
        const c = rgbOf(a.color ?? "#ffff00") ?? [255, 255, 0];
        let best = WORD_HIGHLIGHTS[0]!, dist = Infinity;
        for (const h of WORD_HIGHLIGHTS) {
          const d = Math.hypot(h[1][0] - c[0], h[1][1] - c[1], h[1][2] - c[2]);
          if (d < dist) [best, dist] = [h, d];
        }
        // Word only has a few saturated highlight colours; anything far from all of them becomes shading.
        if (dist < 160) s.highlight = best[0];
        else s.shd = hex6(c);
      }
    }
    return s;
  };
  const run = (n: PMNode, b: RunStyle): string => {
    if (n.type === "hardBreak") return `<w:r>${rPr(b)}<w:br/></w:r>`;
    if (n.type === "mention") return `<w:r>${rPr({ ...b, color: "6D4FD8" })}${wText(`${n.attrs?.kind === "record" ? "" : "@"}${str(n.attrs?.label ?? n.attrs?.id)}`)}</w:r>`;
    if (n.type !== "text" || !n.text) return "";
    return `<w:r>${rPr(runStyle(n, b))}${wText(n.text)}</w:r>`;
  };
  const runs = (ns: PMNode[], b: RunStyle = {}): string => {
    let out = "";
    for (let i = 0; i < ns.length; ) {
      const href = safeHref(markOf(ns[i]!, "link")?.attrs?.href);
      if (!href) {
        out += run(ns[i]!, b);
        i++;
        continue;
      }
      let j = i;
      let inner = "";
      while (j < ns.length && safeHref(markOf(ns[j]!, "link")?.attrs?.href) === href) inner += run(ns[j++]!, { ...b, link: true });
      const anchor = /^#h-(\d+)$/.exec(href);
      if (anchor) out += `<w:hyperlink w:anchor="_h_${anchor[1]}">${inner}</w:hyperlink>`;
      else if (/^(https?:|mailto:)/i.test(href)) out += `<w:hyperlink r:id="${relId("hyperlink", href, true)}" w:history="1">${inner}</w:hyperlink>`;
      else out += inner;
      i = j;
    }
    return out;
  };
  const p = (c: PCtx, inner: string) => `<w:p>${pPr(c)}${inner}</w:p>`;
  const plain = (c: PCtx): PCtx => ({ ind: c.ind, bdr: c.bdr, shd: c.shd, run: c.run, quote: c.quote, lvl: c.lvl, listBase: c.listBase });

  const blocks = (ns: PMNode[], c: PCtx): string => ns.map((n, i) => block(n, c) + (n.type === "table" && (i === ns.length - 1 || ns[i + 1]!.type === "table") ? "<w:p/>" : "")).join("");
  function list(n: PMNode, c: PCtx): string {
    const lvl = Math.min(8, c.lvl ?? 0);
    const base = c.listBase ?? c.ind ?? 0;
    const id = n.type === "bulletList" ? 1 : n.type === "orderedList" ? orderedNum(Number(n.attrs?.start ?? 1) || 1, lvl) : 0;
    return kids(n)
      .map((item) => {
        const [first, ...rest] = kids(item);
        const ind = base + 720 * (lvl + 1);
        let head: string;
        if (n.type === "taskList") {
          const box = item.attrs?.checked ? "☑" : "☐";
          head = p({ ...plain(c), style: "ListParagraph", ind, hanging: 360 }, `<w:r>${rPr(c.run ?? {})}${wText(`${box}\t`)}</w:r>${runs(first ? kids(first) : [], c.run)}`);
        } else head = p({ ...plain(c), style: "ListParagraph", numPr: { id, lvl }, ind, hanging: 360 }, runs(first ? kids(first) : [], c.run));
        return head + blocks(rest, { ...plain(c), ind, lvl: lvl + 1, listBase: base });
      })
      .join("");
  }
  function block(n: PMNode, c: PCtx): string {
    const ind = c.ind ?? 0;
    switch (n.type) {
      case "paragraph": {
        const indent = clamp(Number(n.attrs?.indent ?? 0) || 0, 0, 8);
        return p({ ...plain(c), style: c.quote ? "Quote" : undefined, ind: ind + indent * 720, jc: JC[str(n.attrs?.textAlign)] }, runs(kids(n), c.run));
      }
      case "heading": {
        const l = clamp(Number(n.attrs?.level ?? 1) || 1, 1, 4);
        const idx = heads.get(n) ?? 0;
        const indent = clamp(Number(n.attrs?.indent ?? 0) || 0, 0, 8);
        return p({ ...plain(c), style: `Heading${l}`, keepNext: true, ind: ind + indent * 720, jc: JC[str(n.attrs?.textAlign)] }, `<w:bookmarkStart w:id="${idx}" w:name="_h_${idx}"/>${runs(kids(n), c.run)}<w:bookmarkEnd w:id="${idx}"/>`);
      }
      case "blockquote": return blocks(kids(n), { ...c, quote: true, lvl: 0, listBase: undefined, ind: ind + 360, bdr: `<w:left w:val="single" w:sz="18" w:space="8" w:color="C8CDD3"/>` });
      case "callout": {
        const [fill, accent] = TONE_FILL[toneOf(n.attrs?.tone)];
        return blocks(kids(n), { ...c, quote: false, lvl: 0, listBase: undefined, ind: ind + 180, shd: fill, bdr: `<w:top w:val="single" w:sz="4" w:space="4" w:color="${fill}"/><w:left w:val="single" w:sz="24" w:space="8" w:color="${accent}"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${fill}"/><w:right w:val="single" w:sz="4" w:space="4" w:color="${fill}"/>` });
      }
      case "bulletList":
      case "orderedList":
      case "taskList": return list(n, c);
      case "codeBlock": {
        const t = textOf(n).replace(/\n$/, "");
        return p({ ...plain(c), style: "Code", ind: ind || undefined }, t ? `<w:r>${rPr({ code: true })}${wText(t.replace(/\t/g, "    "))}</w:r>` : "");
      }
      case "horizontalRule": return p({ ind: ind || undefined, bdr: `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/>` }, "");
      case "pageBreak": return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
      case "image": {
        const img = images.get(str(n.attrs?.src));
        if (!img) return "";
        let key = media.get(str(n.attrs?.src));
        if (!key) {
          const path = `media/image${media.size + 1}.${img.type === "png" ? "png" : "jpeg"}`;
          key = { id: relId("image", path), path, data: img.data };
          media.set(str(n.attrs?.src), key);
        }
        const width = clamp(Number(n.attrs?.width ?? 100) || 100, 5, 100) / 100;
        let cx = Math.round((contentTw - ind) * width * 635);
        let cy = Math.round((cx * img.h) / Math.max(1, img.w));
        const maxCy = contentHTw * 635 * 0.9;
        if (cy > maxCy) [cx, cy] = [Math.round((cx * maxCy) / cy), Math.round(maxCy)];
        const did = ++drawingId;
        const alt = xe(str(n.attrs?.alt));
        const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${did}" name="Picture ${did}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${did}" name="${key.path.slice(6)}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${key.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
        const align = str(n.attrs?.align) === "left" ? "left" : str(n.attrs?.align) === "right" ? "right" : "center";
        const cap = str(n.attrs?.caption);
        return p({ ind: ind || undefined, jc: align, keepNext: !!cap }, drawing) + (cap ? p({ style: "Caption", jc: align, ind: ind || undefined }, `<w:r>${wText(cap)}</w:r>`) : "");
      }
      case "table": return table(n, c);
      case "details": {
        const summary = kids(n).find((k) => k.type === "detailsSummary");
        const body = kids(n).find((k) => k.type === "detailsContent");
        return p({ ...plain(c), keepNext: true }, `<w:r>${rPr({ ...c.run, bold: true })}${wText(summary ? textOf(summary).trim() : "Details")}</w:r>`) + blocks(body ? kids(body) : [], { ...c, ind: ind + 360 });
      }
      case "tableOfContents":
        return (
          p({ ...plain(c), keepNext: true }, `<w:r>${rPr({ bold: true, size: Math.round(base * 2.4) })}${wText("Contents")}</w:r>`) +
          outline.map((h) => p({ ind: ind + (h.level - 1) * 360 || undefined }, `<w:hyperlink w:anchor="_h_${h.index}"><w:r>${rPr({ color: "1F2328" })}${wText(h.text)}</w:r></w:hyperlink>`)).join("")
        );
      default: return n.content ? blocks(kids(n), c) : "";
    }
  }
  function table(n: PMNode, c: PCtx): string {
    const rows = kids(n).filter((r) => r.type === "tableRow");
    // Place cells on a grid, so spans line up and merged cells get their continuation cells.
    type Slot = { cell: PMNode; cs: number; rs: number; r: number; c: number };
    const grid: (Slot | null)[][] = rows.map(() => []);
    const origins: Slot[] = [];
    rows.forEach((row, r) => {
      let col = 0;
      for (const cell of kids(row)) {
        while (grid[r]![col]) col++;
        const cs = clamp(Number(cell.attrs?.colspan ?? 1) || 1, 1, 63), rs = clamp(Number(cell.attrs?.rowspan ?? 1) || 1, 1, rows.length - r);
        const slot = { cell, cs, rs, r, c: col };
        origins.push(slot);
        for (let y = r; y < r + rs; y++) for (let x = col; x < col + cs; x++) grid[y]![x] = slot;
        col += cs;
      }
    });
    const ncols = Math.max(1, ...grid.map((g) => g.length));
    const avail = contentTw - (c.ind ?? 0);
    const first = kids(rows[0] ?? { type: "tableRow" });
    const px = first.flatMap((cell) => (Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]).map(Number) : Array(Number(cell.attrs?.colspan ?? 1) || 1).fill(0)));
    const widths = px.length === ncols && px.every((x) => x > 0) ? px.map((x) => Math.round((x / px.reduce((a, b) => a + b, 0)) * avail)) : Array(ncols).fill(Math.floor(avail / ncols));
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${c.ind ? `<w:tblInd w:w="${c.ind}" w:type="dxa"/>` : ""}<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
    x += `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    rows.forEach((row, r) => {
      const header = kids(row).length > 0 && kids(row).every((k) => k.type === "tableHeader");
      x += `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
      for (let col = 0; col < ncols; ) {
        const slot = grid[r]![col];
        const cs = slot ? slot.cs : 1;
        const w = widths.slice(col, col + cs).reduce((a, b) => a + b, 0);
        const isHead = slot?.cell.type === "tableHeader";
        const tcPr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${cs > 1 ? `<w:gridSpan w:val="${cs}"/>` : ""}${slot && slot.rs > 1 ? (slot.r === r ? `<w:vMerge w:val="restart"/>` : "<w:vMerge/>") : ""}${isHead ? `<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>` : ""}</w:tcPr>`;
        let inner = slot && slot.r === r ? blocks(kids(slot.cell), { run: isHead ? { bold: true } : undefined }) : "";
        if (!inner.endsWith("</w:p>") && !inner.endsWith("<w:p/>")) inner += "<w:p/>";
        x += `<w:tc>${tcPr}${inner}</w:tc>`;
        col += cs;
      }
      x += "</w:tr>";
    });
    return `${x}</w:tbl>`;
  }

  const body = blocks(kids(doc), {});
  const font = FONT_WORD[pg.font] ?? pg.font;
  const sz = Math.round(base * 2);
  const line = Math.round(240 * Number(pg.lineHeight));
  const grey = `<w:rPr><w:color w:val="808080"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`;
  const headerId = pg.header ? relId("header", "header1.xml") : null;
  const footerId = pg.footer || pg.pageNumbers ? relId("footer", "footer1.xml") : null;
  const headerXml = `${XML_HEAD}<w:hdr ${W_NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${grey}${wText(pg.header)}</w:r></w:p></w:hdr>`;
  const field = (instr: string) => `<w:fldSimple w:instr=" ${instr} "><w:r>${grey}<w:t>1</w:t></w:r></w:fldSimple>`;
  const footerXml = `${XML_HEAD}<w:ftr ${W_NS}>${pg.footer ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${grey}${wText(pg.footer)}</w:r></w:p>` : ""}${pg.pageNumbers ? `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r>${grey}<w:t xml:space="preserve">Page </w:t></w:r>${field("PAGE")}<w:r>${grey}<w:t xml:space="preserve"> of </w:t></w:r>${field("NUMPAGES")}</w:p>` : ""}</w:ftr>`;
  const W = twips(pw), H = twips(ph);
  const sect = `<w:sectPr>${headerId ? `<w:headerReference w:type="default" r:id="${headerId}"/>` : ""}${footerId ? `<w:footerReference w:type="default" r:id="${footerId}"/>` : ""}<w:pgSz w:w="${W}" w:h="${H}"${pg.landscape ? ` w:orient="landscape"` : ""}/><w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" w:header="${Math.round(twips(m.top) / 2)}" w:footer="${Math.round(twips(m.bottom) / 2)}" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  const documentXml = `${XML_HEAD}<w:document ${W_NS} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sect}</w:body></w:document>`;

  const hs = [2, 1.6, 1.3, 1.15];
  const heading = (l: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${[360, 300, 240, 200][l - 1]}" w:after="120" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="${l - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${Math.round(sz * hs[l - 1]!)}"/><w:szCs w:val="${Math.round(sz * hs[l - 1]!)}"/></w:rPr></w:style>`;
  const stylesXml = `${XML_HEAD}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xe(font)}" w:eastAsia="${xe(font)}" w:hAnsi="${xe(font)}" w:cs="${xe(font)}"/><w:color w:val="1F2328"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="${xe(font)}" w:hAnsi="${xe(font)}" w:cs="${xe(font)}"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz * 2.5}"/><w:szCs w:val="${sz * 2.5}"/></w:rPr></w:style>
${[1, 2, 3, 4].map(heading).join("\n")}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:iCs/><w:color w:val="57606A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F5"/><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="${Math.round(sz * 0.9)}"/><w:szCs w:val="${Math.round(sz * 0.9)}"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:shd w:val="clear" w:color="auto" w:fill="F2F3F5"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:iCs/><w:color w:val="666666"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join("")}</w:tblBorders></w:tblPr></w:style>
</w:styles>`;
  const lvl = (l: number, bullet: boolean) =>
    `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? "bullet" : ["decimal", "lowerLetter", "lowerRoman"][l % 3]}"/><w:lvlText w:val="${bullet ? ["•", "◦", "▪"][l % 3] : `%${l + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  const levels = (bullet: boolean) => Array.from({ length: 9 }, (_, l) => lvl(l, bullet)).join("");
  const numberingXml = `${XML_HEAD}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums.join("")}</w:numbering>`;
  const docRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>${rels.join("")}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const coreXml = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(o.title)}</dc:title><dc:creator>Cloudesk</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const wml = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const types = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="${wml}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${wml}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${wml}.numbering+xml"/>${headerId ? `<Override PartName="/word/header1.xml" ContentType="${wml}.header+xml"/>` : ""}${footerId ? `<Override PartName="/word/footer1.xml" ContentType="${wml}.footer+xml"/>` : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  return zip([
    { path: "[Content_Types].xml", data: types },
    { path: "_rels/.rels", data: rootRels },
    { path: "docProps/core.xml", data: coreXml },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml },
    { path: "word/numbering.xml", data: numberingXml },
    { path: "word/_rels/document.xml.rels", data: docRels },
    ...(headerId ? [{ path: "word/header1.xml", data: headerXml }] : []),
    ...(footerId ? [{ path: "word/footer1.xml", data: footerXml }] : []),
    ...[...media.values()].map((x) => ({ path: `word/${x.path}`, data: x.data })),
  ]);
}
/** Editor fonts Word may not have, mapped to a near equivalent it does. */
const FONT_WORD: Record<string, string> = { Inter: "Arial", Helvetica: "Arial", Garamond: "Garamond", Palatino: "Palatino Linotype" };

// ── Word in ────────────────────────────────────────────────────────────────

const NOT_DOCX = "That file isn't a Word document (.docx). Open it in Word or Google Docs, save it as .docx, and try again.";
const MAX_INFLATE = 50 * 1024 * 1024;
const MAX_ENTRIES = 2000;

/** Reads a ZIP's directory, and inflates entries on request within a total size budget (no zip bombs). */
/** Reads a ZIP (Office files are ZIPs): its entries and each one's text, inflated with a size budget. */
export function openZip(buf: Buffer) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error(NOT_DOCX);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(NOT_DOCX);
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error("That Word file has too many parts to import.");
  const entries = new Map<string, { method: number; flags: number; comp: number; size: number; offset: number }>();
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("That Word file is damaged and can't be read.");
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { flags: buf.readUInt16LE(p + 8), method: buf.readUInt16LE(p + 10), comp: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  let budget = MAX_INFLATE;
  const read = (name: string): string | null => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error("That Word file is password-protected. Remove the password in Word and try again.");
    if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("That Word file is damaged and can't be read.");
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const data = buf.subarray(start, start + e.comp);
    if (e.size > budget) throw new Error("That Word file is too large to import.");
    let out: Buffer;
    if (e.method === 0) out = Buffer.from(data);
    else if (e.method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) });
      } catch (err) {
        throw new Error(err instanceof RangeError || (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? "That Word file is too large to import." : "That Word file is damaged and can't be read.");
      }
    } else throw new Error("That Word file uses a compression we can't read.");
    budget -= out.length;
    return out.toString("utf8");
  };
  return { entries, read };
}

type XEl = { n: string; a: Record<string, string>; c: XEl[]; t?: string };
const xmlDecode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_, e: string) => (e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : decodeEntities(`&${e};`)));
/** A small XML reader: elements (namespace prefixes dropped) and text. */
function parseXml(xml: string): XEl {
  const root: XEl = { n: "#root", a: {}, c: [] };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[6] !== undefined || m[5] !== undefined) {
      if (top.n === "t" || top.n === "instrText" || m[5] !== undefined || m[6]!.trim()) top.c.push({ n: "#text", a: {}, c: [], t: m[5] ?? xmlDecode(m[6]!) });
      continue;
    }
    if (!m[2]) continue;
    const name = m[2].replace(/^[\w.-]+:/, "");
    if (m[1]) {
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k]!.n === name) {
          stack.length = k;
          break;
        }
      continue;
    }
    const a: Record<string, string> = {};
    for (const am of m[3]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[am[1]!.replace(/^[\w.-]+:/, "")] = xmlDecode(am[2] ?? am[3] ?? "");
    const el: XEl = { n: name, a, c: [] };
    top.c.push(el);
    if (!m[4] && stack.length < 300) stack.push(el);
  }
  return root;
}
const xc = (e: XEl | undefined, n: string) => e?.c.find((k) => k.n === n);
const xcs = (e: XEl | undefined, n: string) => e?.c.filter((k) => k.n === n) ?? [];
const on = (e: XEl | undefined) => !!e && !["0", "false", "off", "none"].includes(e.a.val ?? "");
const xText = (e: XEl): string => (e.n === "#text" ? (e.t ?? "") : e.c.map(xText).join(""));

/** A Word file (.docx) → a document: headings, paragraphs, formatting, links, lists, tables and page breaks. Images are left out. */
export async function fromDocx(buf: Buffer): Promise<PMNode> {
  const zipped = openZip(buf);
  const relTarget = (relsXml: string | null, type: string) => {
    if (!relsXml) return null;
    for (const r of xcs(xc(parseXml(relsXml), "Relationships"), "Relationship")) if ((r.a.Type ?? "").endsWith(`/${type}`)) return r.a.Target ?? null;
    return null;
  };
  const mainPath = (relTarget(zipped.read("_rels/.rels"), "officeDocument") ?? "word/document.xml").replace(/^\//, "");
  const xml = zipped.read(mainPath);
  if (!xml) throw new Error(NOT_DOCX);
  const dir = mainPath.includes("/") ? mainPath.slice(0, mainPath.lastIndexOf("/") + 1) : "";
  const relsXml = zipped.read(`${dir}_rels/${mainPath.slice(dir.length)}.rels`);
  const rels = new Map<string, { target: string; type: string; external: boolean }>();
  if (relsXml) for (const r of xcs(xc(parseXml(relsXml), "Relationships"), "Relationship")) rels.set(r.a.Id ?? "", { target: r.a.Target ?? "", type: r.a.Type ?? "", external: r.a.TargetMode === "External" });
  const partOf = (type: string) => {
    for (const r of rels.values()) if (r.type.endsWith(`/${type}`)) return zipped.read(r.target.startsWith("/") ? r.target.slice(1) : dir + r.target);
    return null;
  };

  // Styles: what each paragraph style means (heading, quote, code), list numbering it carries, and the default size.
  type StyleInfo = { name: string; based?: string; num?: { id: string; lvl: number }; mono?: boolean };
  const styles = new Map<string, StyleInfo>();
  let defaultSz = 22;
  const stylesXml = partOf("styles");
  if (stylesXml) {
    const root = xc(parseXml(stylesXml), "styles");
    const dsz = xc(xc(xc(xc(root, "docDefaults"), "rPrDefault"), "rPr"), "sz")?.a.val;
    if (dsz) defaultSz = Number(dsz) || 22;
    for (const s of xcs(root, "style")) {
      const ppr = xc(s, "pPr");
      const np = xc(ppr, "numPr");
      const fonts = xc(xc(s, "rPr"), "rFonts")?.a.ascii ?? "";
      styles.set(s.a.styleId ?? "", { name: (xc(s, "name")?.a.val ?? s.a.styleId ?? "").toLowerCase(), based: xc(s, "basedOn")?.a.val, num: np ? { id: xc(np, "numId")?.a.val ?? "0", lvl: Number(xc(np, "ilvl")?.a.val ?? 0) } : undefined, mono: /courier|consolas|mono|menlo/i.test(fonts) });
    }
  }
  const styleKind = (id: string | undefined) => {
    let num: StyleInfo["num"];
    for (let k = 0, cur = id; cur && k < 8; k++) {
      const s = styles.get(cur);
      const name = s?.name ?? cur.toLowerCase();
      num ??= s?.num;
      const h = /^heading ?([1-9])$/.exec(name) ?? /^heading([1-9])$/i.exec(cur);
      if (h) return { kind: "h" as const, level: Math.min(4, Number(h[1])), num };
      if (name === "title") return { kind: "h" as const, level: 1, num };
      if (/quote/.test(name)) return { kind: "quote" as const, level: 0, num };
      if (/^(code|html preformatted|source code|macro text|preformatted text)/.test(name) || s?.mono) return { kind: "code" as const, level: 0, num };
      cur = s?.based;
    }
    return { kind: "p" as const, level: 0, num };
  };

  // Numbering: list format per level, so bullets and numbers come back as the right list.
  const abstracts = new Map<string, Map<number, { fmt: string; start: number }>>();
  const numMap = new Map<string, { abs: string; starts: Map<number, number> }>();
  const numberingXml = partOf("numbering");
  if (numberingXml) {
    const root = xc(parseXml(numberingXml), "numbering");
    for (const an of xcs(root, "abstractNum")) {
      const lv = new Map<number, { fmt: string; start: number }>();
      for (const l of xcs(an, "lvl")) lv.set(Number(l.a.ilvl ?? 0), { fmt: xc(l, "numFmt")?.a.val ?? "decimal", start: Number(xc(l, "start")?.a.val ?? 1) || 1 });
      abstracts.set(an.a.abstractNumId ?? "", lv);
    }
    for (const nm of xcs(root, "num")) {
      const starts = new Map<number, number>();
      for (const ov of xcs(nm, "lvlOverride")) {
        const so = xc(ov, "startOverride")?.a.val;
        if (so) starts.set(Number(ov.a.ilvl ?? 0), Number(so));
      }
      numMap.set(nm.a.numId ?? "", { abs: xc(nm, "abstractNumId")?.a.val ?? "", starts });
    }
  }
  const listFormat = (numId: string, lvl: number) => {
    const nm = numMap.get(numId);
    const l = nm ? abstracts.get(nm.abs)?.get(lvl) : undefined;
    return { bullet: !l || l.fmt === "bullet" || l.fmt === "none", start: nm?.starts.get(lvl) ?? l?.start ?? 1 };
  };

  type Item = { kind: "p" | "h" | "quote" | "code" | "li" | "break" | "hr" | "node"; level?: number; inline?: PMNode[]; attrs?: Record<string, unknown>; list?: { kind: "bulletList" | "orderedList" | "taskList"; lvl: number; start: number; checked?: boolean }; node?: PMNode };
  const PAGE = { type: "#page" } as PMNode;

  const runMarks = (rpr: XEl | undefined, marks: PMMark[]): PMMark[] => {
    if (!rpr) return marks;
    let ms = marks;
    const add = (mk: PMMark) => (ms = withMark(ms, mk));
    if (on(xc(rpr, "b"))) add({ type: "bold" });
    if (on(xc(rpr, "i"))) add({ type: "italic" });
    const u = xc(rpr, "u");
    if (u && u.a.val !== "none" && u.a.val !== "0") add({ type: "underline" });
    if (on(xc(rpr, "strike")) || on(xc(rpr, "dstrike"))) add({ type: "strike" });
    const va = xc(rpr, "vertAlign")?.a.val;
    if (va === "superscript") add({ type: "superscript" });
    else if (va === "subscript") add({ type: "subscript" });
    const ts: Record<string, string> = {};
    const color = xc(rpr, "color")?.a.val;
    if (color && /^[0-9a-f]{6}$/i.test(color) && !/^000000$/.test(color) && color.toUpperCase() !== "1F2328") ts.color = `#${color.toLowerCase()}`;
    const sz = Number(xc(rpr, "sz")?.a.val);
    if (sz && sz !== defaultSz) ts.fontSize = `${sz / 2}pt`;
    if (Object.keys(ts).length) add({ type: "textStyle", attrs: ts });
    const hl = xc(rpr, "highlight")?.a.val;
    const hlRgb = WORD_HIGHLIGHTS.find((h) => h[0] === hl)?.[1];
    const shd = xc(rpr, "shd")?.a.fill;
    if (hlRgb) add({ type: "highlight", attrs: { color: `#${hex6(hlRgb).toLowerCase()}` } });
    else if (shd && /^[0-9a-f]{6}$/i.test(shd) && !/^(ffffff|f2f3f5)$/i.test(shd)) add({ type: "highlight", attrs: { color: `#${shd.toLowerCase()}` } });
    const fonts = xc(rpr, "rFonts")?.a.ascii ?? "";
    const rs = xc(rpr, "rStyle")?.a.val;
    if (/courier|consolas|mono|menlo/i.test(fonts) || (rs && (styles.get(rs)?.mono || /code/i.test(rs)))) add({ type: "code" });
    return ms;
  };
  const inlineOf = (el: XEl, marks: PMMark[], out: PMNode[]) => {
    for (const k of el.c) {
      switch (k.n) {
        case "r": {
          const ms = runMarks(xc(k, "rPr"), marks);
          for (const r of k.c) {
            if (r.n === "t") out.push(textNode(xText(r), ms));
            else if (r.n === "tab" || r.n === "ptab") out.push(textNode("\t", ms));
            else if (r.n === "br") out.push(r.a.type === "page" ? PAGE : { type: "hardBreak" });
            else if (r.n === "cr") out.push({ type: "hardBreak" });
            else if (r.n === "noBreakHyphen") out.push(textNode("-", ms));
          }
          break;
        }
        case "hyperlink": {
          const rel = rels.get(k.a.id ?? "");
          const href = rel?.external ? safeHref(rel.target) : null;
          inlineOf(k, href && !href.startsWith("#") ? withMark(marks, { type: "link", attrs: { href } }) : marks, out);
          break;
        }
        case "fldSimple":
        case "smartTag":
        case "customXml":
        case "ins":
        case "moveTo":
        case "sdt":
        case "sdtContent":
        case "bdo":
        case "dir":
          inlineOf(k, marks, out);
          break;
      }
    }
  };
  const paraItems = (p: XEl): Item[] => {
    const ppr = xc(p, "pPr");
    const sk = styleKind(xc(ppr, "pStyle")?.a.val);
    const np = xc(ppr, "numPr");
    const numId = np ? (xc(np, "numId")?.a.val ?? "0") : sk.num?.id;
    const ilvl = np ? Number(xc(np, "ilvl")?.a.val ?? 0) : (sk.num?.lvl ?? 0);
    const jc = xc(ppr, "jc")?.a.val;
    const align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : undefined;
    const indTw = Number(xc(ppr, "ind")?.a.left ?? xc(ppr, "ind")?.a.start ?? 0) || 0;
    const inline: PMNode[] = [];
    inlineOf(p, [], inline);
    const items: Item[] = [];
    if (on(xc(ppr, "pageBreakBefore"))) items.push({ kind: "break" });
    // Page breaks inside the paragraph split it.
    const segs: PMNode[][] = [[]];
    for (const n of inline) {
      if (n === PAGE) segs.push([]);
      else segs[segs.length - 1]!.push(n);
    }
    segs.forEach((seg, si) => {
      if (si) items.push({ kind: "break" });
      const empty = !seg.some((n) => n.type !== "text" || n.text);
      if (empty && segs.length > 1) return;
      if (empty && xc(xc(ppr, "pBdr"), "bottom")) return items.push({ kind: "hr" });
      const first = seg[0];
      const box = first?.type === "text" ? /^([☐☑☒])\s?/.exec(first.text!) : null;
      if (box) {
        seg[0] = { ...first!, text: first!.text!.slice(box[0].length) };
        return items.push({ kind: "li", inline: seg, list: { kind: "taskList", lvl: numId && numId !== "0" ? ilvl : Math.max(0, Math.round(indTw / 720) - 1), start: 1, checked: box[1] !== "☐" } });
      }
      if (numId && numId !== "0" && sk.kind !== "h") {
        const f = listFormat(numId, ilvl);
        return items.push({ kind: "li", inline: seg, list: { kind: f.bullet ? "bulletList" : "orderedList", lvl: clamp(ilvl, 0, 8), start: f.start } });
      }
      const attrs: Record<string, unknown> = {};
      if (align) attrs.textAlign = align;
      if (sk.kind === "p" && indTw >= 600) attrs.indent = clamp(Math.round(indTw / 720), 0, 8);
      items.push({ kind: sk.kind, level: sk.level, inline: seg, attrs });
    });
    return items;
  };
  const tableNode = (tbl: XEl): PMNode | null => {
    const rows: PMNode[] = [];
    const active = new Map<number, PMNode>();
    for (const tr of xcs(tbl, "tr")) {
      const trPr = xc(tr, "trPr");
      const header = !!xc(trPr, "tblHeader") && on(xc(trPr, "tblHeader"));
      let col = Number(xc(trPr, "gridBefore")?.a.val ?? 0) || 0;
      const cells: PMNode[] = [];
      const tcs = tr.c.flatMap((k) => (k.n === "tc" ? [k] : k.n === "sdt" ? xcs(xc(k, "sdtContent"), "tc") : []));
      for (const tc of tcs) {
        const tcPr = xc(tc, "tcPr");
        const span = clamp(Number(xc(tcPr, "gridSpan")?.a.val ?? 1) || 1, 1, 63);
        const vm = xc(tcPr, "vMerge");
        if (vm && vm.a.val !== "restart") {
          const origin = active.get(col);
          if (origin) origin.attrs!.rowspan = Number(origin.attrs!.rowspan) + 1;
          col += span;
          continue;
        }
        const cell: PMNode = { type: header ? "tableHeader" : "tableCell", attrs: { colspan: span, rowspan: 1 }, content: orEmpty(toBlocks(bodyItems(tc))) };
        if (vm) active.set(col, cell);
        else active.delete(col);
        cells.push(cell);
        col += span;
      }
      if (cells.length) rows.push({ type: "tableRow", content: cells });
    }
    return rows.length ? { type: "table", content: rows } : null;
  };
  const bodyItems = (container: XEl, depth = 0): Item[] => {
    const out: Item[] = [];
    for (const k of container.c) {
      if (k.n === "p") out.push(...paraItems(k));
      else if (k.n === "tbl" && depth < 20) {
        const t = tableNode(k);
        if (t) out.push({ kind: "node", node: t });
      } else if ((k.n === "sdt" || k.n === "customXml") && depth < 20) out.push(...bodyItems(xc(k, "sdtContent") ?? k, depth + 1));
    }
    return out;
  };
  function toBlocks(items: Item[]): PMNode[] {
    const out: PMNode[] = [];
    let stack: { lvl: number; kind: string; list: PMNode }[] = [];
    let quote: PMNode | null = null;
    let code: string[] | null = null;
    const endCode = () => {
      if (code) out.push({ type: "codeBlock", attrs: { language: null }, ...(code.join("\n") ? { content: [textNode(code.join("\n"))] } : {}) });
      code = null;
    };
    for (const it of items) {
      if (it.kind !== "li") stack = [];
      if (it.kind !== "quote") quote = null;
      if (it.kind !== "code") endCode();
      const inline = it.inline ?? [];
      switch (it.kind) {
        case "p":
          out.push(para(inline, it.attrs));
          break;
        case "h":
          out.push({ type: "heading", attrs: { level: it.level ?? 1, ...(it.attrs?.textAlign ? { textAlign: it.attrs.textAlign } : {}) }, content: inline });
          break;
        case "quote":
          if (!quote) out.push((quote = { type: "blockquote", content: [] }));
          quote.content!.push(para(inline, it.attrs));
          break;
        case "code":
          (code ??= []).push(inline.map((n) => (n.type === "hardBreak" ? "\n" : (n.text ?? ""))).join(""));
          break;
        case "break":
          out.push({ type: "pageBreak" });
          break;
        case "hr":
          out.push({ type: "horizontalRule" });
          break;
        case "node":
          out.push(it.node!);
          break;
        case "li": {
          const l = it.list!;
          while (stack.length && stack[stack.length - 1]!.lvl > l.lvl) stack.pop();
          let top = stack[stack.length - 1];
          if (top && top.lvl === l.lvl && top.kind !== l.kind) {
            stack.pop();
            top = stack[stack.length - 1];
          }
          if (!top || top.lvl < l.lvl) {
            const list: PMNode = { type: l.kind, ...(l.kind === "orderedList" ? { attrs: { start: l.start } } : {}), content: [] };
            const parent = top?.list.content![top.list.content!.length - 1];
            if (parent) parent.content!.push(list);
            else out.push(list);
            stack.push({ lvl: l.lvl, kind: l.kind, list });
            top = stack[stack.length - 1]!;
          }
          top.list.content!.push(l.kind === "taskList" ? { type: "taskItem", attrs: { checked: !!l.checked }, content: [para(inline)] } : { type: "listItem", content: [para(inline)] });
          break;
        }
      }
    }
    endCode();
    return out;
  }
  const bodyEl = xc(xc(parseXml(xml), "document"), "body");
  if (!bodyEl) throw new Error(NOT_DOCX);
  return finish({ type: "doc", content: orEmpty(toBlocks(bodyItems(bodyEl))) });
}

// ── PDF out ────────────────────────────────────────────────────────────────

const PT = 72 / 25.4;
const FONT_FILES = { regular: "Geist-Regular.ttf", bold: "Geist-Bold.ttf", italic: "Geist-Italic.ttf", boldItalic: "Geist-BoldItalic.ttf", mono: "GeistMono-Regular.ttf" } as const;
let fontCache: Promise<Record<keyof typeof FONT_FILES, Buffer>> | null = null;
export const fontBytes = () =>
  (fontCache ??= Promise.all(Object.entries(FONT_FILES).map(async ([k, f]) => [k, await readFile(path.join(process.cwd(), "src/server/documents/fonts", f))] as const)).then((e) => Object.fromEntries(e) as Record<keyof typeof FONT_FILES, Buffer>));

const C = { ink: rgb(0.12, 0.14, 0.16), muted: rgb(0.42, 0.45, 0.49), link: rgb(0.04, 0.41, 0.85), rule: rgb(0.8, 0.82, 0.85), codeBg: rgb(0.957, 0.957, 0.961), inlineCode: rgb(0.945, 0.949, 0.957), headBg: rgb(0.953, 0.957, 0.965), quote: rgb(0.78, 0.8, 0.83), mention: rgb(0.43, 0.31, 0.85), check: rgb(0.43, 0.31, 0.85) };
const TONE_PDF = { info: [rgb(0.937, 0.965, 1), rgb(0.231, 0.51, 0.965)], success: [rgb(0.941, 0.992, 0.957), rgb(0.133, 0.773, 0.369)], warning: [rgb(1, 0.984, 0.922), rgb(0.961, 0.62, 0.043)], danger: [rgb(0.996, 0.949, 0.949), rgb(0.937, 0.267, 0.267)] } as const;
const toRgb = (v: unknown): RGB | null => {
  const c = rgbOf(v);
  return c ? rgb(c[0] / 255, c[1] / 255, c[2] / 255) : null;
};
const alpha = (n: number, lvl: number) => (lvl % 3 === 1 ? toAlpha(n) : lvl % 3 === 2 ? toRoman(n) : String(n));
const toAlpha = (n: number): string => (n <= 0 ? String(n) : (n > 26 ? toAlpha(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(97 + ((n - 1) % 26)));
const toRoman = (n: number) => {
  if (n <= 0 || n >= 4000) return String(n);
  let s = "";
  for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) {
      s += r;
      n -= v;
    }
  return s;
};

type Style = { font: PDFFont; size: number; color: RGB; bg?: RGB; underline?: boolean; strike?: boolean; link?: string; rise: number };
type PRun = { text: string; s: Style; w: number; space?: boolean };
type Tok = { kind: "word"; runs: PRun[]; w: number } | { kind: "space"; run: PRun } | { kind: "br" };
type PLine = { runs: PRun[]; w: number; hard: boolean };
type Op = { page: number; layer: number; draw: (pg: PDFPage, pages: PDFPage[]) => void };

/** Where layout is on the page; a "measure" flow has no page breaks and its drawing is thrown away. */
class Flow {
  page = 0;
  maxPage = 0;
  lastGap = 0;
  constructor(public y: number, public top: number, public bottom: number, public ops: Op[], public measure = false, public noBreak = false) {}
  ensure(h: number) {
    if (this.noBreak) return;
    if (this.y - h < this.bottom && this.y < this.top - 0.5) this.newPage();
  }
  newPage() {
    this.page++;
    this.maxPage = Math.max(this.maxPage, this.page);
    this.y = this.top;
    this.lastGap = 0;
  }
  op(layer: number, draw: Op["draw"]) {
    if (!this.measure) this.ops.push({ page: this.page, layer, draw });
  }
  gap(h: number) {
    this.y -= h;
    this.lastGap = h;
  }
  child(y: number) {
    const f = new Flow(y, this.top, this.bottom, this.ops, this.measure, true);
    f.page = this.page;
    return f;
  }
}
type Box = { x: number; w: number };
type Ctx = { level: number; marker?: (f: Flow, baseline: number, size: number) => void; tight?: boolean; bold?: boolean; color?: RGB; depth: number };

/** The document as a PDF, typeset with Geist: page setup, header and footer, page numbers, styles, lists, tables, images and links. */
export async function toPdf(doc: PMNode, o: { title: string; page: PageSetup; images?: ImageLoader }): Promise<Uint8Array> {
  const pg = o.page;
  const { w: pwMm, h: phMm } = pageMm(pg);
  const W = pwMm * PT, H = phMm * PT;
  const mg = { t: pg.margins.top * PT, r: pg.margins.right * PT, b: pg.margins.bottom * PT, l: pg.margins.left * PT };
  const base = pg.fontSize;
  const lh = Number(pg.lineHeight) || 1.5;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = await fontBytes();
  const [regular, bold, italic, boldItalic, mono] = await Promise.all([bytes.regular, bytes.bold, bytes.italic, bytes.boldItalic, bytes.mono].map((b) => pdf.embedFont(b, { subset: true })));
  pdf.setTitle(o.title || "Untitled document");
  pdf.setCreator("Cloudesk");
  pdf.setProducer("Cloudesk");
  const pick = (b: boolean, i: boolean) => (b && i ? boldItalic! : b ? bold! : i ? italic! : regular!);

  // Characters a font can't draw become "?" so odd text never fails the export.
  const glyphs = new Map<PDFFont, Set<number>>();
  const clean = (f: PDFFont, s: string) => {
    let set = glyphs.get(f);
    if (!set) glyphs.set(f, (set = new Set(f.getCharacterSet())));
    let out = "";
    for (const ch of s.replace(/­/g, "")) {
      const cp = ch.codePointAt(0)!;
      out += cp === 9 || cp === 10 || cp === 13 ? " " : set.has(cp) ? ch : "?";
    }
    return out;
  };
  const widths = new Map<PDFFont, Map<string, number>>();
  const width = (f: PDFFont, s: string, size: number) => {
    let m = widths.get(f);
    if (!m) widths.set(f, (m = new Map()));
    let w = m.get(s);
    if (w === undefined) {
      w = f.widthOfTextAtSize(s, 1000);
      if (m.size < 50_000) m.set(s, w);
    }
    return (w * size) / 1000;
  };

  // Images are fetched and embedded up front so layout can run straight through.
  const loaded = await loadImages(doc, o.images);
  const embedded = new Map<string, { img: PDFImage; w: number; h: number }>();
  for (const [src, img] of loaded) {
    try {
      const e = img.type === "png" ? await pdf.embedPng(img.data) : await pdf.embedJpg(img.data);
      embedded.set(src, { img: e, w: e.width, h: e.height });
    } catch {
      // Not a picture pdf-lib can read: left out.
    }
  }

  const heads = headingIndex(doc);
  const outline = outlineOf(doc);
  const headingAt: { page: number; y: number }[] = [];
  const annots: ((pages: PDFPage[]) => void)[] = [];
  const addLink = (f: Flow, rect: [number, number, number, number], target: string | number) => {
    if (f.measure) return;
    const page = f.page;
    annots.push((pages) => {
      const at = typeof target === "number" ? headingAt[target] : undefined;
      if (typeof target === "number" && !at) return;
      const dict = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], ...(typeof target === "string" ? { A: { Type: "Action", S: "URI", URI: PDFString.of(target) } } : { Dest: [pages[at!.page]!.ref, "XYZ", null, at!.y, null] }) });
      pages[page]!.node.addAnnot(pdf.context.register(dict));
    });
  };

  // ── Inline text → tokens → lines ──
  const styleFor = (n: PMNode, b: { size: number; bold: boolean; color: RGB }): Style => {
    let isBold = b.bold, isItalic = false, isMono = false, size = b.size, color = b.color, bg: RGB | undefined, underline = false, strike = false, link: string | undefined, rise = 0;
    for (const mk of n.marks ?? []) {
      const a = mk.attrs ?? {};
      if (mk.type === "bold") isBold = true;
      else if (mk.type === "italic") isItalic = true;
      else if (mk.type === "underline") underline = true;
      else if (mk.type === "strike") strike = true;
      else if (mk.type === "code") isMono = true;
      else if (mk.type === "link") {
        const h = safeHref(a.href);
        if (h && /^(https?:|mailto:)/i.test(h)) link = h;
        color = C.link;
        underline = true;
      } else if (mk.type === "textStyle") {
        size = ptOf(a.fontSize, b.size) ?? size;
        color = toRgb(a.color) ?? color;
        bg = toRgb(a.backgroundColor) ?? bg;
        if (/courier|mono/i.test(str(a.fontFamily))) isMono = true;
      } else if (mk.type === "highlight") bg = toRgb(a.color ?? "#fef08a") ?? rgb(0.996, 0.941, 0.541);
    }
    for (const mk of n.marks ?? []) {
      if (mk.type === "superscript" || mk.type === "subscript") {
        rise = mk.type === "superscript" ? size * 0.33 : -size * 0.12;
        size *= 0.7;
      }
    }
    if (isMono) {
      size *= 0.9;
      bg ??= C.inlineCode;
    }
    return { font: isMono ? mono! : pick(isBold, isItalic), size, color, bg, underline, strike, link, rise };
  };
  const tokens = (nodes: PMNode[], b: { size: number; bold: boolean; color: RGB }): Tok[] => {
    const out: Tok[] = [];
    let word: Extract<Tok, { kind: "word" }> | null = null;
    const endWord = () => {
      if (word) out.push(word);
      word = null;
    };
    for (const n of nodes) {
      if (n.type === "hardBreak") {
        endWord();
        out.push({ kind: "br" });
        continue;
      }
      let text = n.type === "text" ? (n.text ?? "") : n.type === "mention" ? `${n.attrs?.kind === "record" ? "" : "@"}${str(n.attrs?.label ?? n.attrs?.id)}` : textOf(n);
      const s = n.type === "mention" ? { ...styleFor(n, b), color: C.mention } : styleFor(n, b);
      text = clean(s.font, text);
      for (const part of text.split(/( +)/)) {
        if (!part) continue;
        if (part[0] === " ") {
          endWord();
          out.push({ kind: "space", run: { text: part, s, w: width(s.font, part, s.size), space: true } });
        } else {
          const w = width(s.font, part, s.size);
          word ??= { kind: "word", runs: [], w: 0 };
          word.runs.push({ text: part, s, w });
          word.w += w;
        }
      }
    }
    endWord();
    return out;
  };
  const lineUp = (toks: Tok[], maxW: number): PLine[] => {
    const lines: PLine[] = [];
    let cur: PRun[] = [];
    let w = 0;
    const push = (hard: boolean) => {
      while (cur.length && cur[cur.length - 1]!.space) w -= cur.pop()!.w;
      lines.push({ runs: cur, w, hard });
      cur = [];
      w = 0;
    };
    const hasWord = () => cur.some((r) => !r.space);
    for (const t of toks) {
      if (t.kind === "br") push(true);
      else if (t.kind === "space") {
        if (cur.length) {
          cur.push(t.run);
          w += t.run.w;
        }
      } else if (w + t.w <= maxW) {
        cur.push(...t.runs);
        w += t.w;
      } else {
        if (hasWord()) push(false);
        if (t.w <= maxW) {
          cur.push(...t.runs);
          w += t.w;
          continue;
        }
        // A word wider than the line is cut by characters.
        for (const r of t.runs) {
          for (const ch of r.text) {
            const cw = width(r.s.font, ch, r.s.size);
            if (w + cw > maxW && cur.length) push(false);
            const last = cur[cur.length - 1];
            if (last && last.s === r.s && !last.space) {
              last.text += ch;
              last.w += cw;
            } else cur.push({ text: ch, s: r.s, w: cw });
            w += cw;
          }
        }
      }
    }
    push(true);
    return lines;
  };
  /** Lays out and draws inline content as lines in the box. */
  const paragraph = (nodes: PMNode[], f: Flow, box: Box, o2: { size: number; bold?: boolean; align?: string; color?: RGB; lineH?: number; marker?: Ctx["marker"]; onFirst?: (y: number) => void }) => {
    const lines = lineUp(tokens(nodes, { size: o2.size, bold: !!o2.bold, color: o2.color ?? C.ink }), Math.max(10, box.w));
    const factor = o2.lineH ?? lh;
    lines.forEach((line, li) => {
      const size = Math.max(line.runs.length ? 0 : o2.size, ...line.runs.map((r) => r.s.size));
      const h = size * factor;
      f.ensure(h);
      const baseline = f.y - (h - size) / 2 - size * 0.8;
      if (li === 0) o2.onFirst?.(f.y);
      const free = box.w - line.w;
      const spaces = line.runs.filter((r) => r.space).length;
      const justify = o2.align === "justify" && !line.hard && spaces > 0;
      let x = box.x + (o2.align === "center" ? free / 2 : o2.align === "right" ? free : 0);
      for (const r of line.runs) {
        const rw = r.w + (justify && r.space ? free / spaces : 0);
        const rx = x, s = r.s;
        if (s.bg) f.op(5, (p) => p.drawRectangle({ x: rx, y: baseline - s.size * 0.24 + s.rise, width: rw, height: s.size * 1.12, color: s.bg }));
        f.op(10, (p) => {
          if (!r.space) p.drawText(r.text, { x: rx, y: baseline + s.rise, size: s.size, font: s.font, color: s.color });
          if (s.underline) p.drawLine({ start: { x: rx, y: baseline + s.rise - s.size * 0.12 }, end: { x: rx + rw, y: baseline + s.rise - s.size * 0.12 }, thickness: Math.max(0.4, s.size * 0.05), color: s.color });
          if (s.strike) p.drawLine({ start: { x: rx, y: baseline + s.rise + s.size * 0.28 }, end: { x: rx + rw, y: baseline + s.rise + s.size * 0.28 }, thickness: Math.max(0.4, s.size * 0.05), color: s.color });
        });
        if (s.link) addLink(f, [rx, baseline - s.size * 0.25, rx + rw, baseline + s.size * 0.9], s.link);
        x += rw;
      }
      if (li === 0 && o2.marker) o2.marker(f, baseline, size);
      f.y -= h;
    });
  };

  // ── Blocks ──
  const roundRect = (p: PDFPage, x: number, yTop: number, w: number, h: number, r: number, color: RGB) => {
    r = Math.min(r, w / 2, h / 2);
    p.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`, { x, y: yTop, color, borderWidth: 0 });
  };
  /** Draws something behind a block that may run over several pages, once per page it touches. */
  const behind = (f: Flow, start: { page: number; y: number }, layer: number, draw: (p: PDFPage, top: number, bottom: number, whole: boolean) => void) => {
    if (f.measure) return;
    const end = { page: f.page, y: f.y };
    for (let pi = start.page; pi <= end.page; pi++) {
      const top = pi === start.page ? start.y : f.top, bottom = pi === end.page ? end.y : f.bottom;
      f.ops.push({ page: pi, layer: Math.min(4, layer), draw: (p) => draw(p, top, bottom, start.page === end.page) });
    }
  };
  const blocks = (ns: PMNode[], f: Flow, box: Box, c: Ctx) => ns.forEach((n, i) => block(n, f, box, i === 0 ? c : { ...c, marker: undefined }));
  function block(n: PMNode, f: Flow, box: Box, c: Ctx): void {
    const after = c.tight ? base * 0.25 : base * 0.55;
    switch (n.type) {
      case "paragraph": {
        const indent = clamp(Number(n.attrs?.indent ?? 0) || 0, 0, 8) * base * 2;
        paragraph(kids(n), f, { x: box.x + indent, w: box.w - indent }, { size: base, bold: c.bold, align: str(n.attrs?.textAlign), color: c.color, marker: c.marker });
        f.gap(after);
        return;
      }
      case "heading": {
        const l = clamp(Number(n.attrs?.level ?? 1) || 1, 1, 4);
        const size = base * [2, 1.6, 1.3, 1.15][l - 1]!;
        if (f.y < f.top - 1) f.y -= size * 0.45;
        // Keep a heading with the start of what follows it.
        f.ensure(size * 1.25 + base * lh * 2);
        const indent = clamp(Number(n.attrs?.indent ?? 0) || 0, 0, 8) * base * 2;
        const idx = heads.get(n);
        paragraph(kids(n), f, { x: box.x + indent, w: box.w - indent }, { size, bold: true, align: str(n.attrs?.textAlign), color: c.color, lineH: 1.25, marker: c.marker, onFirst: (y) => idx !== undefined && !f.measure && (headingAt[idx] = { page: f.page, y }) });
        f.gap(size * 0.35);
        return;
      }
      case "blockquote": {
        const start = { page: f.page, y: f.y };
        blocks(kids(n), f, { x: box.x + 14, w: box.w - 14 }, { ...c, color: C.muted, depth: c.depth + 1 });
        const endY = f.y + f.lastGap;
        const saved = f.y;
        f.y = endY;
        behind(f, start, c.depth, (p, top, bottom) => p.drawRectangle({ x: box.x + 1, y: bottom, width: 2.5, height: top - bottom, color: C.quote }));
        f.y = saved;
        return;
      }
      case "callout": {
        const [fill, accent] = TONE_PDF[toneOf(n.attrs?.tone)];
        const pad = 8;
        f.ensure(base * lh + pad * 2);
        const start = { page: f.page, y: f.y };
        f.y -= pad;
        blocks(kids(n), f, { x: box.x + 14, w: box.w - 24 }, { ...c, tight: false, marker: undefined, depth: c.depth + 1 });
        f.y += f.lastGap - pad;
        behind(f, start, c.depth, (p, top, bottom, whole) => {
          if (whole) roundRect(p, box.x, top, box.w, top - bottom, 5, fill);
          else p.drawRectangle({ x: box.x, y: bottom, width: box.w, height: top - bottom, color: fill });
          p.drawRectangle({ x: box.x, y: bottom + (whole ? 1.5 : 0), width: 3, height: top - bottom - (whole ? 3 : 0), color: accent });
        });
        f.gap(after);
        return;
      }
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const lvl = c.level;
        const start = Number(n.attrs?.start ?? 1) || 1;
        const ind = 18;
        kids(n).forEach((item, i) => {
          const marker = (mf: Flow, baseline: number, size: number) => {
            const mx = box.x, cy = baseline + size * 0.32;
            if (n.type === "bulletList") {
              const kind = lvl % 3, r = size * 0.15;
              mf.op(10, (p) => (kind === 0 ? p.drawCircle({ x: mx + 7, y: cy, size: r, color: c.color ?? C.ink }) : kind === 1 ? p.drawCircle({ x: mx + 7, y: cy, size: r, borderColor: c.color ?? C.ink, borderWidth: 0.7 }) : p.drawRectangle({ x: mx + 7 - r, y: cy - r, width: r * 2, height: r * 2, color: c.color ?? C.ink })));
            } else if (n.type === "orderedList") {
              const label = clean(regular!, `${alpha(start + i, lvl)}.`);
              const lw = width(regular!, label, size);
              mf.op(10, (p) => p.drawText(label, { x: mx + ind - 4 - lw, y: baseline, size, font: regular!, color: c.color ?? C.ink }));
            } else {
              const s = size * 0.72, bx = mx + 2, by = baseline - size * 0.06, checked = !!item.attrs?.checked;
              mf.op(10, (p) => {
                p.drawRectangle({ x: bx, y: by, width: s, height: s, borderColor: checked ? C.check : C.muted, borderWidth: 0.8, color: checked ? C.check : undefined });
                if (checked) {
                  p.drawLine({ start: { x: bx + s * 0.2, y: by + s * 0.5 }, end: { x: bx + s * 0.42, y: by + s * 0.26 }, thickness: 1.1, color: rgb(1, 1, 1) });
                  p.drawLine({ start: { x: bx + s * 0.42, y: by + s * 0.26 }, end: { x: bx + s * 0.8, y: by + s * 0.74 }, thickness: 1.1, color: rgb(1, 1, 1) });
                }
              });
            }
          };
          blocks(kids(item), f, { x: box.x + ind, w: box.w - ind }, { ...c, level: lvl + 1, tight: true, marker });
        });
        if (!c.tight) f.gap(base * 0.4);
        return;
      }
      case "codeBlock": {
        const size = base * 0.88, pad = 7;
        const cw = width(mono!, "M", size);
        const per = Math.max(8, Math.floor((box.w - pad * 2) / cw));
        const lines = textOf(n)
          .replace(/\n$/, "")
          .split("\n")
          .map((l) => clean(mono!, l.replace(/\t/g, "  ")))
          .flatMap((l) => (l.length <= per ? [l] : (l.match(new RegExp(`.{1,${per}}`, "g")) ?? [""])));
        const lineH = size * 1.4;
        f.ensure(lineH + pad * 2);
        const start = { page: f.page, y: f.y };
        f.y -= pad;
        for (const l of lines) {
          if (!f.noBreak && f.y - lineH < f.bottom) {
            f.newPage();
            f.y -= pad;
          }
          const y = f.y - lineH + size * 0.32;
          f.op(10, (p) => p.drawText(l, { x: box.x + pad, y, size, font: mono!, color: C.ink }));
          f.y -= lineH;
        }
        f.y -= pad;
        behind(f, start, c.depth, (p, top, bottom, whole) => (whole ? roundRect(p, box.x, top, box.w, top - bottom, 4, C.codeBg) : p.drawRectangle({ x: box.x, y: bottom, width: box.w, height: top - bottom, color: C.codeBg })));
        f.gap(after);
        return;
      }
      case "horizontalRule": {
        f.ensure(base);
        const y = f.y - base * 0.5;
        f.op(10, (p) => p.drawLine({ start: { x: box.x, y }, end: { x: box.x + box.w, y }, thickness: 0.7, color: C.rule }));
        f.y -= base;
        f.gap(after);
        return;
      }
      case "pageBreak":
        if (!f.noBreak && f.y < f.top - 0.5) f.newPage();
        return;
      case "image": {
        const img = embedded.get(str(n.attrs?.src));
        if (!img) return;
        let w = (box.w * clamp(Number(n.attrs?.width ?? 100) || 100, 5, 100)) / 100;
        let h = (w * img.h) / Math.max(1, img.w);
        const maxH = (f.top - f.bottom) * 0.9;
        if (h > maxH) [w, h] = [(w * maxH) / h, maxH];
        f.ensure(h);
        const align = str(n.attrs?.align);
        const x = box.x + (align === "left" ? 0 : align === "right" ? box.w - w : (box.w - w) / 2);
        const y = f.y - h;
        f.op(10, (p) => p.drawImage(img.img, { x, y, width: w, height: h }));
        f.y -= h;
        const cap = str(n.attrs?.caption);
        if (cap) {
          f.y -= 3;
          paragraph([textNode(cap, [{ type: "italic" }])], f, box, { size: base * 0.85, align: "center", color: C.muted });
        }
        f.gap(after);
        return;
      }
      case "table":
        table(n, f, box, c);
        f.gap(after);
        return;
      case "details": {
        const summary = kids(n).find((k) => k.type === "detailsSummary");
        const body = kids(n).find((k) => k.type === "detailsContent");
        paragraph(summary ? kids(summary) : [], f, box, { size: base, bold: true, color: c.color, marker: c.marker });
        f.gap(base * 0.3);
        blocks(body ? kids(body) : [], f, { x: box.x + 12, w: box.w - 12 }, { ...c, marker: undefined });
        return;
      }
      case "tableOfContents": {
        paragraph([textNode("Contents")], f, box, { size: base * 1.3, bold: true, color: c.color, lineH: 1.3 });
        f.gap(base * 0.3);
        for (const h of outline) {
          const ind = (h.level - 1) * 14;
          const numW = 30;
          let yBase = 0, firstTop = 0, pageAt = f.page;
          paragraph([textNode(h.text)], f, { x: box.x + ind, w: box.w - ind - numW }, { size: base, color: c.color, onFirst: (y) => (firstTop = y), marker: (mf, b) => ((yBase = b), (pageAt = mf.page)) });
          if (!f.measure) {
            f.ops.push({
              page: pageAt,
              layer: 10,
              draw: (p) => {
                const at = headingAt[h.index];
                if (!at) return;
                const label = String(at.page + 1);
                p.drawText(label, { x: box.x + box.w - width(regular!, label, base), y: yBase, size: base, font: regular!, color: C.muted });
              },
            });
            if (f.page === pageAt) addLink(f, [box.x + ind, f.y, box.x + box.w, firstTop], h.index);
          }
          f.gap(base * 0.15);
        }
        f.gap(after);
        return;
      }
      default:
        if (n.content) blocks(kids(n), f, box, c);
    }
  }
  function table(n: PMNode, f: Flow, box: Box, c: Ctx) {
    const rows = kids(n).filter((r) => r.type === "tableRow");
    if (!rows.length) return;
    // Columns on a grid (rowspans keep their place but don't merge).
    const placed: { cell: PMNode; col: number; cs: number }[][] = [];
    const taken: Set<number>[] = rows.map(() => new Set());
    rows.forEach((row, r) => {
      let col = 0;
      placed.push(
        kids(row).map((cell) => {
          while (taken[r]!.has(col)) col++;
          const cs = clamp(Number(cell.attrs?.colspan ?? 1) || 1, 1, 50), rs = clamp(Number(cell.attrs?.rowspan ?? 1) || 1, 1, rows.length - r);
          for (let y = r + 1; y < r + rs; y++) for (let x = col; x < col + cs; x++) taken[y]!.add(x);
          const p = { cell, col, cs };
          col += cs;
          return p;
        }),
      );
    });
    const ncols = Math.max(1, ...placed.map((r) => Math.max(0, ...r.map((p) => p.col + p.cs))), ...taken.map((t) => Math.max(0, ...[...t].map((x) => x + 1))));
    const px = kids(rows[0]!).flatMap((cell) => (Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]).map(Number) : Array(Number(cell.attrs?.colspan ?? 1) || 1).fill(0)));
    const cols = px.length === ncols && px.every((x) => x > 0) ? px.map((x) => (x / px.reduce((a, b) => a + b, 0)) * box.w) : Array(ncols).fill(box.w / ncols);
    const xs = cols.reduce<number[]>((acc, w, i) => (acc.push(i ? acc[i - 1]! + cols[i - 1]! : box.x), acc), []);
    const pad = 4;
    const cellBox = (p: { col: number; cs: number }) => ({ x: xs[p.col]!, w: cols.slice(p.col, p.col + p.cs).reduce((a, b) => a + b, 0) });
    const cellCtx = (cell: PMNode): Ctx => ({ level: 0, tight: true, bold: cell.type === "tableHeader" || c.bold, color: c.color, depth: c.depth + 1 });
    const measure = (r: number) =>
      Math.max(
        base * lh + pad * 2,
        ...placed[r]!.map((p) => {
          const m = new Flow(1e6, 1e6, -1e9, [], true, true);
          const b = cellBox(p);
          blocks(kids(p.cell), m, { x: b.x + pad, w: b.w - pad * 2 }, cellCtx(p.cell));
          return 1e6 - m.y - m.lastGap + pad * 2;
        }),
      );
    const isHeader = (r: number) => kids(rows[r]!).length > 0 && kids(rows[r]!).every((k) => k.type === "tableHeader");
    const drawRow = (r: number, h: number) => {
      const top = f.y;
      for (const p of placed[r]!) {
        const b = cellBox(p);
        const cf = f.child(top - pad);
        blocks(kids(p.cell), cf, { x: b.x + pad, w: b.w - pad * 2 }, cellCtx(p.cell));
        const head = p.cell.type === "tableHeader";
        f.op(Math.min(4, c.depth), (pgp) => {
          if (head) pgp.drawRectangle({ x: b.x, y: top - h, width: b.w, height: h, color: C.headBg });
        });
        f.op(15, (pgp) => pgp.drawRectangle({ x: b.x, y: top - h, width: b.w, height: h, borderColor: C.rule, borderWidth: 0.6 }));
      }
      // Empty grid slots still get their borders.
      for (let x = 0; x < ncols; x++) {
        if (placed[r]!.some((p) => x >= p.col && x < p.col + p.cs)) continue;
        const bx = xs[x]!, bw = cols[x]!;
        f.op(15, (pgp) => pgp.drawRectangle({ x: bx, y: top - h, width: bw, height: h, borderColor: C.rule, borderWidth: 0.6 }));
      }
      f.y = top - h;
    };
    const headerH = isHeader(0) ? measure(0) : 0;
    const avail = f.top - f.bottom;
    rows.forEach((_, r) => {
      const h = measure(r);
      if (h > avail && !f.noBreak) {
        // Taller than a page: the cells flow one after another instead.
        for (const p of placed[r]!) blocks(kids(p.cell), f, { x: box.x + pad, w: box.w - pad * 2 }, cellCtx(p.cell));
        return;
      }
      const before = f.page;
      f.ensure(h);
      // A table that runs onto a new page repeats its header row.
      if (f.page !== before && r > 0 && headerH && headerH + h <= avail) drawRow(0, headerH);
      drawRow(r, h);
    });
  }

  const flow = new Flow(H - mg.t, H - mg.t, mg.b, []);
  blocks(kids(doc), flow, { x: mg.l, w: W - mg.l - mg.r }, { level: 0, depth: 0 });
  const pages: PDFPage[] = [];
  for (let i = 0; i <= flow.maxPage; i++) pages.push(pdf.addPage([W, H]));
  for (const op of [...flow.ops].sort((a, b) => a.layer - b.layer)) op.draw(pages[op.page]!, pages);
  for (const a of annots) a(pages);

  // Header, footer and page numbers on every page.
  const fit = (s: string, size: number, maxW: number) => {
    let t = clean(regular!, s.replace(/\s+/g, " ").trim());
    if (width(regular!, t, size) <= maxW) return t;
    while (t && width(regular!, `${t}…`, size) > maxW) t = t.slice(0, -1);
    return `${t}…`;
  };
  const small = Math.max(7, base * 0.75);
  pages.forEach((p, i) => {
    const cw = W - mg.l - mg.r;
    const num = pg.pageNumbers ? clean(regular!, `Page ${i + 1} of ${pages.length}`) : "";
    const numW = num ? width(regular!, num, small) : 0;
    if (pg.header) {
      const t = fit(pg.header, small, cw);
      p.drawText(t, { x: W / 2 - width(regular!, t, small) / 2, y: H - mg.t / 2 - small / 2, size: small, font: regular!, color: C.muted });
    }
    const fy = mg.b / 2 - small / 2;
    if (pg.footer) {
      const t = fit(pg.footer, small, cw - 2 * (numW + 10));
      p.drawText(t, { x: W / 2 - width(regular!, t, small) / 2, y: fy, size: small, font: regular!, color: C.muted });
    }
    if (num) p.drawText(num, { x: W - mg.r - numW, y: fy, size: small, font: regular!, color: C.muted });
  });
  return pdf.save();
}
