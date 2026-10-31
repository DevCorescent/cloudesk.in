// A small, dependency-free PDF writer for text documents (a signing
// certificate): A4 pages, Helvetica, lines wrapped to the page and carried
// onto new pages. Text is kept to Latin-1 so the standard fonts can show it.

type Line = { text: string; size?: number; bold?: boolean; gap?: number };

const W = 595.28;
const H = 841.89;
const MARGIN = 56;

const latin1 = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/₹/g, "Rs ").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Wrap text to a width, roughly (Helvetica averages ~0.5em a character). */
function wrap(text: string, size: number) {
  const max = Math.max(10, Math.floor((W - 2 * MARGIN) / (size * 0.5)));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (word.length > max) {
        if (cur) out.push(cur);
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
        cur = "";
        continue;
      }
      if ((cur ? cur.length + 1 : 0) + word.length > max) {
        out.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    out.push(cur);
  }
  return out;
}

export function textPdf(lines: Line[], meta: { title: string }) {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - MARGIN;
  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = H - MARGIN;
  };
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= l.gap ?? 0;
    for (const part of wrap(latin1(l.text), size)) {
      if (y - size < MARGIN) flush();
      y -= size * 1.35;
      ops.push(`BT /${l.bold ? "F2" : "F1"} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${esc(part)}) Tj ET`);
    }
  }
  flush();
  const objects: string[] = [];
  const add = (s: string) => objects.push(s) && objects.length;
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(latin1(meta.title))}) /Producer (Cloudesk) >>`);
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
