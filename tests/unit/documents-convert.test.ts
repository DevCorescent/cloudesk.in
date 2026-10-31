import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSchema } from "@tiptap/core";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { docExtensions } from "@/lib/documents/extensions";
import { DOC_TEMPLATES, pageOf, textOf, type PMNode } from "@/lib/documents/write";
import { fromDocx, fromHtml, fromMarkdown, fromText, toDocx, toHtml, toMarkdown, toPdf } from "@/server/documents/convert";
import { zip } from "@/server/export/zip";

const schema = getSchema(docExtensions());
const valid = (doc: PMNode) => {
  const node = schema.nodeFromJSON(doc);
  node.check();
  return node;
};
const page = pageOf({ header: "Acme Ltd", footer: "Confidential" });
const t = (text: string, ...marks: string[]): PMNode => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: PMNode[]): PMNode => ({ type: "paragraph", content });
const li = (...content: PMNode[]): PMNode => ({ type: "listItem", content });
const find = (n: PMNode, type: string): PMNode[] => [...(n.type === type ? [n] : []), ...(n.content ?? []).flatMap((c) => find(c, type))];

const rich: PMNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [t("Quarterly plan")] },
    p(t("Some "), t("bold", "bold"), t(" and "), t("italic", "italic"), t(" and "), t("struck", "strike"), t(" text with "), t("code()", "code"), t(" and a "), { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com/a?b=1" } }] }, t(".")),
    { type: "heading", attrs: { level: 2 }, content: [t("Lists")] },
    { type: "bulletList", content: [li(p(t("One")), { type: "bulletList", content: [li(p(t("One point one"))), li(p(t("One point two")))] }), li(p(t("Two")))] },
    { type: "orderedList", attrs: { start: 1 }, content: [li(p(t("First"))), li(p(t("Second")))] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Done thing"))] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("Open thing"))] }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Name"))] }, { type: "tableHeader", content: [p(t("Amount"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(t("Rent"))] }, { type: "tableCell", content: [p(t("₹ 40,000"))] }] },
      ],
    },
    { type: "codeBlock", attrs: { language: "ts" }, content: [t("const x = 1;\nconsole.log(x * 2);")] },
    { type: "blockquote", content: [p(t("Quoted words"))] },
    { type: "callout", attrs: { tone: "warning" }, content: [p(t("Mind the gap"))] },
    { type: "horizontalRule" },
    p(t("snake_case stays, *stars* escape")),
  ],
};

describe("markdown", () => {
  it("writes GFM and reads it back to the same Markdown", () => {
    const md = toMarkdown(rich);
    expect(md).toContain("# Quarterly plan");
    expect(md).toContain("**bold**");
    expect(md).toContain("_italic_");
    expect(md).toContain("~~struck~~");
    expect(md).toContain("`code()`");
    expect(md).toContain("[link](https://example.com/a?b=1)");
    expect(md).toContain("- One\n  - One point one\n  - One point two\n- Two");
    expect(md).toContain("1. First\n2. Second");
    expect(md).toContain("- [x] Done thing\n- [ ] Open thing");
    expect(md).toContain("| Name | Amount |\n| --- | --- |\n| Rent | ₹ 40,000 |");
    expect(md).toContain("```ts\nconst x = 1;");
    expect(md).toContain("> **Warning:** Mind the gap");
    expect(md).toContain("snake_case stays, \\*stars\\* escape");
    const back = fromMarkdown(md);
    valid(back);
    expect(toMarkdown(back)).toBe(md);
    expect(find(back, "callout")[0]?.attrs?.tone).toBe("warning");
    expect(find(back, "taskItem").map((x) => x.attrs?.checked)).toEqual([true, false]);
    expect(find(back, "bulletList")).toHaveLength(2);
    expect(find(back, "tableHeader")).toHaveLength(2);
  });
  it("reads common Markdown from elsewhere", () => {
    const doc = fromMarkdown("Title\n=====\n\n* a\n* b\n    1. nested\n\nPara with ***both*** and <u>under</u>\nand a soft break  \nand a hard one https://x.dev.\n\n![pic](https://x.dev/p.png)\n\n> [!TIP]\n> Do it\n\n~~~\ncode\n~~~");
    valid(doc);
    expect(doc.content![0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(find(doc, "orderedList")).toHaveLength(1);
    expect(find(doc, "image")[0]?.attrs?.src).toBe("https://x.dev/p.png");
    expect(find(doc, "callout")[0]?.attrs?.tone).toBe("success");
    expect(find(doc, "hardBreak")).toHaveLength(1);
    const both = find(doc, "text").find((x) => x.text === "both")!;
    expect(both.marks?.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
    expect(find(doc, "text").find((x) => x.text === "https://x.dev")?.marks?.[0]).toMatchObject({ type: "link" });
    expect(find(doc, "codeBlock")[0]?.content?.[0]?.text).toBe("code");
  });
  it("stays fast on hostile input", () => {
    const started = Date.now();
    for (const bad of ["*a ".repeat(30_000), "[".repeat(60_000), "`a ".repeat(30_000), "<u>".repeat(30_000), "_x ".repeat(30_000), "> ".repeat(5_000) + "x", "- ".repeat(3_000) + "x"]) valid(fromMarkdown(bad));
    valid(fromHtml("<div>".repeat(5_000) + "deep" + "<b>".repeat(5_000)));
    expect(Date.now() - started).toBeLessThan(8_000);
  });
  it("doesn't turn javascript: links into links", () => {
    const doc = fromMarkdown("[click](javascript:alert(1)) and ![x](javascript:1)");
    valid(doc);
    expect(JSON.stringify(doc)).not.toContain("javascript");
  });
});

describe("html", () => {
  it("reads nested lists, tables, entities and formatting, and drops scripts", () => {
    const doc = fromHtml(`<!doctype html><html><head><title>x</title><style>p{color:red}</style></head><body>
      <h1 style="text-align:center">Caf&eacute; &amp; co &#8377; &#x1F600;</h1>
      <script>alert("hi")</script>
      <p>Hello <b>bold <i>both</i></b> <a href="https://a.dev">link</a> <a href="javascript:alert(1)">bad</a><br>next line</p>
      <ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul>
      <ul data-type="taskList"><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Todo</li></ul>
      <ol start="3"><li>Three</ol>
      <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</tr></tbody></table>
      <blockquote>Quote</blockquote><pre><code class="language-js">let a = 1;
a++;</code></pre><hr><img src="https://x.dev/i.png" alt="i"><img src="data:image/png;base64,AAAA"><h6>Small</h6>
      <div data-callout data-tone="danger"><p>Careful</p></div>
    </body></html>`);
    valid(doc);
    const json = JSON.stringify(doc);
    expect(json).not.toContain("alert");
    expect(json).not.toContain("color:red");
    expect(json).not.toContain("javascript");
    expect(doc.content![0]).toMatchObject({ type: "heading", attrs: { level: 1, textAlign: "center" } });
    expect(textOf(doc.content![0])).toContain("Café & co ₹ 😀");
    const lists = find(doc, "bulletList");
    expect(lists).toHaveLength(2);
    expect(textOf(lists[1])).toContain("Inner");
    expect(find(doc, "taskItem").map((x) => x.attrs?.checked)).toEqual([true, false]);
    expect(find(doc, "orderedList")[0]?.attrs?.start).toBe(3);
    expect(find(doc, "tableHeader")).toHaveLength(2);
    expect(find(doc, "tableCell").map((c) => textOf(c).trim())).toEqual(["1", "2"]);
    expect(find(doc, "codeBlock")[0]).toMatchObject({ attrs: { language: "js" }, content: [{ text: "let a = 1;\na++;" }] });
    expect(find(doc, "image")).toHaveLength(1);
    expect(find(doc, "heading").map((h) => h.attrs?.level)).toEqual([1, 4]);
    expect(find(doc, "callout")[0]?.attrs?.tone).toBe("danger");
    expect(find(doc, "hardBreak")).toHaveLength(1);
    const both = find(doc, "text").find((x) => x.text === "both")!;
    expect(both.marks?.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
  });
  it("survives junk", () => {
    for (const junk of ["", "<", "<<>>", "<p", "<div><span>unclosed", "</b></i>text", "<table><td>x", "<ul><li><li>", "a & b < c"]) valid(fromHtml(junk));
  });
  it("writes escaped HTML with safe links, and a whole page when asked", () => {
    const doc: PMNode = { type: "doc", content: [p(t("<script>alert(1)</script>")), p({ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }, { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://ok.dev" } }] }), { type: "image", attrs: { src: "asset:abc-123", alt: '"x"' } }, { type: "image", attrs: { src: "javascript:x" } }, { type: "tableOfContents" }, { type: "heading", attrs: { level: 2 }, content: [t("Part")] }] };
    const html = toHtml(doc, { title: "T <x>", page, assetUrl: (id) => `/api/assets/${id}` });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://ok.dev"');
    expect(html).toContain('src="/api/assets/abc-123"');
    expect(html).toContain('<h2 id="h-0">Part</h2>');
    expect(html).toContain('href="#h-0"');
    const full = toHtml(rich, { title: "T <x>", page, standalone: true });
    expect(full.startsWith("<!doctype html>")).toBe(true);
    expect(full).toContain("<title>T &lt;x&gt;</title>");
    expect(full).toContain("@page { size: 210mm 297mm");
    expect(full).toContain('<input type="checkbox" disabled checked>');
    // And it reads back.
    expect(textOf(fromHtml(full))).toContain("Mind the gap");
  });
});

describe("plain text", () => {
  it("splits paragraphs on blank lines and keeps line breaks", () => {
    const doc = fromText("one\ntwo\n\n\nthree\r\n");
    valid(doc);
    expect(doc.content).toHaveLength(2);
    expect(find(doc, "hardBreak")).toHaveLength(1);
  });
});

/** Every tag opened is closed, in order. */
function balanced(xml: string) {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]!);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

describe("docx", () => {
  it("makes a valid Word file that reads back", async () => {
    const doc: PMNode = { ...rich, content: [...rich.content!, { type: "pageBreak" }, p(t("After the break & <stuff>"))] };
    const buf = await toDocx(doc, { title: "Plan & <co>", page });
    const dir = mkdtempSync(join(tmpdir(), "cc-docx-"));
    const file = join(dir, "plan.docx");
    writeFileSync(file, buf);
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    for (const part of ["word/document.xml", "word/styles.xml", "word/numbering.xml", "[Content_Types].xml", "word/_rels/document.xml.rels", "word/header1.xml", "word/footer1.xml", "docProps/core.xml"]) {
      // unzip reads names as patterns, so brackets are escaped.
      const xml = execFileSync("unzip", ["-p", file, part.replace(/[[\]]/g, "\\$&")]).toString();
      expect(xml.startsWith("<?xml")).toBe(true);
      expect(balanced(xml), part).toBe(true);
    }
    const back = await fromDocx(buf);
    valid(back);
    expect(find(back, "heading").map((h) => [h.attrs?.level, textOf(h).trim()])).toEqual([[1, "Quarterly plan"], [2, "Lists"]]);
    expect(find(back, "text").find((x) => x.text === "bold")?.marks?.map((m) => m.type)).toEqual(["bold"]);
    expect(find(back, "text").find((x) => x.text === "link")?.marks?.[0]).toMatchObject({ type: "link", attrs: { href: "https://example.com/a?b=1" } });
    expect(find(back, "bulletList").map((l) => l.content!.length)).toEqual([2, 2]);
    expect(find(back, "orderedList")).toHaveLength(1);
    expect(find(back, "taskItem").map((x) => x.attrs?.checked)).toEqual([true, false]);
    expect(find(back, "tableHeader").map((c) => textOf(c).trim())).toEqual(["Name", "Amount"]);
    expect(find(back, "tableCell").map((c) => textOf(c).trim())).toEqual(["Rent", "₹ 40,000"]);
    expect(find(back, "pageBreak")).toHaveLength(1);
    expect(find(back, "codeBlock")[0]?.content?.[0]?.text).toBe("const x = 1;\nconsole.log(x * 2);");
    expect(find(back, "blockquote")).toHaveLength(1);
    expect(textOf(back)).toContain("After the break & <stuff>");
  });
  it("embeds PNG images", async () => {
    // A 1×1 PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const doc: PMNode = { type: "doc", content: [{ type: "image", attrs: { src: "asset:1", width: 50, caption: "Tiny" } }] };
    const buf = await toDocx(doc, { title: "x", page, images: async () => ({ data: png, mime: "image/png" }) });
    const dir = mkdtempSync(join(tmpdir(), "cc-docx-"));
    writeFileSync(join(dir, "i.docx"), buf);
    expect(execFileSync("unzip", ["-l", join(dir, "i.docx")]).toString()).toContain("word/media/image1.png");
    const pdf = await toPdf(doc, { title: "x", page, images: async () => ({ data: png, mime: "image/png" }) });
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe("%PDF");
  });
  it("rejects files that aren't Word documents", async () => {
    await expect(fromDocx(Buffer.from("hello, not a zip at all"))).rejects.toThrow(/isn't a Word document/);
    await expect(fromDocx(zip([{ path: "readme.txt", data: "hi" }]))).rejects.toThrow(/isn't a Word document/);
    await expect(fromDocx(Buffer.alloc(0))).rejects.toThrow(Error);
  });
  it("refuses archives that inflate past the size cap", async () => {
    const bomb = zip([{ path: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024, 32) }]);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(fromDocx(bomb)).rejects.toThrow(/too large/);
  });
  it("refuses archives with too many entries", async () => {
    const many = zip(Array.from({ length: 2001 }, (_, i) => ({ path: `f${i}.txt`, data: "" })));
    await expect(fromDocx(many)).rejects.toThrow(/too many/);
  });
});

describe("pdf", () => {
  it("typesets a long document over several pages", async () => {
    const long: PMNode = { type: "doc", content: [{ type: "tableOfContents" }, ...Array.from({ length: 12 }, (_, i) => [{ type: "heading", attrs: { level: 2 }, content: [t(`Section ${i + 1}`)] }, ...rich.content!]).flat()] };
    const bytes = await toPdf(long, { title: "Long", page });
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(loaded.getTitle()).toBe("Long");
  });
  it("copes with unbreakable words, tables, scripts the font lacks and landscape pages", async () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        p(t("x".repeat(2000))),
        p(t("नमस्ते दुनिया — ₹ 1,00,000 · emoji 😀 · tab\tand nbsp")),
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [p(t("Wide header"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("y".repeat(500)))] }, { type: "tableCell", content: [p(t("z"))] }] }] },
        p({ type: "text", text: "sup", marks: [{ type: "superscript" }] }, { type: "text", text: "styled", marks: [{ type: "textStyle", attrs: { color: "#ff0000", fontSize: "18px" } }, { type: "highlight", attrs: { color: "#fef08a" } }] }, { type: "mention", attrs: { id: "u1", label: "Asha" } }),
        { type: "details", content: [{ type: "detailsSummary", content: [t("More")] }, { type: "detailsContent", content: [p(t("Hidden"))] }] },
      ],
    };
    const bytes = await toPdf(doc, { title: "Edge", page: pageOf({ landscape: true, paper: "Letter", pageNumbers: true, lineHeight: "2" }) });
    const loaded = await PDFDocument.load(bytes);
    const { width, height } = loaded.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});

describe("templates", () => {
  it("convert to every format", async () => {
    for (const tpl of DOC_TEMPLATES) {
      const doc = tpl.build();
      const pg = pageOf(tpl.page ?? {});
      expect(toHtml(doc, { title: tpl.name, page: pg, standalone: true })).toContain("<body>");
      const md = toMarkdown(doc, tpl.name);
      valid(fromMarkdown(md));
      expect(toMarkdown(fromMarkdown(md))).toBe(md);
      valid(fromHtml(toHtml(doc, { title: tpl.name, page: pg })));
      const back = await fromDocx(await toDocx(doc, { title: tpl.name, page: pg }));
      valid(back);
      expect(textOf(back).replace(/\s+/g, "")).toBe(textOf(doc).replace(/\s+/g, ""));
      const pdf = await toPdf(doc, { title: tpl.name, page: pg });
      expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe("%PDF");
    }
  });
});
