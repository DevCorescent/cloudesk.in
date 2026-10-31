import { describe, expect, it } from "vitest";
import { block, calcResults, docSchema, fromMarkdown, linkedTitles, outline, spans, toHtml, toMarkdown, toText, wordCount } from "@/lib/notes/blocks";

describe("note blocks", () => {
  it("reads inline marks, and keeps unsafe links as plain text", () => {
    expect(spans("a **b** *c* ~~d~~ `e` ==f== [g](https://x.in) [[Plan]] @ravi")).toEqual([
      { t: "text", text: "a " }, { t: "b", text: "b" }, { t: "text", text: " " }, { t: "i", text: "c" }, { t: "text", text: " " }, { t: "s", text: "d" }, { t: "text", text: " " }, { t: "code", text: "e" }, { t: "text", text: " " }, { t: "mark", text: "f" }, { t: "text", text: " " }, { t: "link", text: "g", href: "https://x.in" }, { t: "text", text: " " }, { t: "note", text: "Plan" }, { t: "text", text: " " }, { t: "mention", text: "ravi" },
    ]);
    expect(spans("[x](javascript:alert(1))").some((p) => p.t === "link")).toBe(false);
  });

  it("turns Markdown into blocks and back", () => {
    const d = fromMarkdown("# Title\n\nSome **text**\n- one\n  - two\n- [x] done\n1. first\n> quoted\n---\n```js\nconst a = 1\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(d.blocks.map((b) => b.type)).toEqual(["h1", "p", "bullet", "bullet", "todo", "number", "quote", "divider", "code", "table"]);
    expect(d.blocks[3]).toMatchObject({ text: "two", indent: 1 });
    expect(d.blocks[4]).toMatchObject({ checked: true });
    expect(d.blocks[9]!.rows).toEqual([["A", "B"], ["1", "2"]]);
    const md = toMarkdown(d);
    expect(md).toContain("- [x] done");
    expect(fromMarkdown(md).blocks.map((b) => b.type)).toEqual(d.blocks.map((b) => b.type));
  });

  it("works out live calculations in order, by name", () => {
    const d = { blocks: [block("calc", "rent = 45000"), block("calc", "staff = 3 * 28000"), block("calc", "rent + staff"), block("calc", "1 / 0 +")] };
    const r = calcResults(d);
    expect(r.get(d.blocks[2]!.id)).toEqual({ value: 129000 });
    expect(r.get(d.blocks[3]!.id)).toHaveProperty("error");
    expect(toText(d)).toContain("rent + staff = 1,29,000");
  });

  it("finds [[links]], headings and words", () => {
    const d = { blocks: [block("h2", "Goals"), block("p", "See [[Q1 Plan]] and [[q1 plan]]"), block("toggle", "More", { body: "and [[Budget]]" })] };
    expect(linkedTitles(d).sort()).toEqual(["budget", "q1 plan"]);
    expect(outline(d)).toEqual([{ id: d.blocks[0]!.id, level: 2, text: "Goals" }]);
    expect(wordCount("Hello, दुनिया 2026!")).toBe(3);
  });

  it("escapes everything in HTML exports", () => {
    const html = toHtml({ blocks: [block("p", "<script>x</script> [a](javascript:x)"), block("image", "", { url: "javascript:x" })] }, "<b>T</b>");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;b&gt;T&lt;/b&gt;");
    expect(html).not.toMatch(/href="javascript/);
  });

  it("only accepts web and in-app links in blocks", () => {
    expect(docSchema.safeParse({ blocks: [{ id: "a", type: "link", text: "", url: "https://x.in" }] }).success).toBe(true);
    expect(docSchema.safeParse({ blocks: [{ id: "a", type: "link", text: "", url: "/crm" }] }).success).toBe(true);
    expect(docSchema.safeParse({ blocks: [{ id: "a", type: "link", text: "", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(docSchema.safeParse({ blocks: [{ id: "a", type: "image", text: "", url: "//evil.example/x.png" }] }).success).toBe(false);
  });
});
