// The small part of Markdown the copilot writes — paragraphs, headings, bullet
// and numbered lists, pipe tables, **bold** and `code` — parsed into blocks
// the page renders as React elements (never as HTML).
export type Inline = { text: string; bold?: boolean; code?: boolean };
export type MdBlock = { type: "p"; inline: Inline[] } | { type: "h"; inline: Inline[] } | { type: "ul" | "ol"; items: Inline[][] } | { type: "table"; head: Inline[][]; rows: Inline[][][] };

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim()));
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: "p", inline: inline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ type: "h", inline: inline(h[1]) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      out.push({ type: "table", head, rows });
      continue;
    }
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const type = li[1] ? "ul" : "ol";
      const last = out[out.length - 1];
      if (last && last.type === type) last.items.push(inline(li[3]));
      else out.push({ type, items: [inline(li[3])] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}
