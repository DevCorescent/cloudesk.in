// A real PDF of an invoice, quotation, proforma or credit note, for attaching
// to emails. It follows the document's own wording (labels), accent colour,
// columns and paper size, and carries the same numbers as the printed page —
// both come from computeDocTotals. The designed HTML page stays the client's
// view; this is the clean, file-shaped copy of it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { titleFor, type RenderOptions } from "@/lib/invoicing/render";
import { computeDocTotals, isIntraState } from "@/lib/invoicing/totals";
import { amountInWords } from "@/lib/invoicing/words";
import { formatMoney } from "@/lib/store/money";

const PAPER = { A4: [595.28, 841.89], Letter: [612, 792], A5: [419.53, 595.28] } as const;
let fontBytes: Promise<Buffer> | null = null;
const font = () => (fontBytes ??= readFile(path.join(process.cwd(), "src/server/invoicing/fonts/Geist-Regular.ttf")));

const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  const n = m ? parseInt(m[1]!, 16) : 0x111111;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, ""));
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** Characters the font can't draw (emoji, rare scripts) become "?" rather than failing the whole file. */
function clean(f: PDFFont, s: string) {
  const glyphs = new Set(f.getCharacterSet());
  return [...s.replace(/\r/g, "").replace(/\t/g, " ")].map((c) => (c === "\n" || glyphs.has(c.codePointAt(0)!) ? c : "?")).join("");
}

function wrap(f: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(f, text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (f.widthOfTextAtSize(next, size) <= width || !line.trim()) {
        // A single word wider than the column is cut by characters.
        if (f.widthOfTextAtSize(next, size) > width) {
          let piece = "";
          for (const ch of next) {
            if (f.widthOfTextAtSize(piece + ch, size) > width && piece) {
              out.push(piece);
              piece = "";
            }
            piece += ch;
          }
          line = piece;
        } else line = next;
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export async function renderPdf(o: Pick<RenderOptions, "doc" | "settings" | "template">): Promise<Uint8Array> {
  const { doc: d, template: t, settings: s } = o;
  const b = s.business;
  const money = (n: number) => formatMoney(n, d.currency);
  const totals = computeDocTotals({ lines: d.lines, adjustments: d.adjustments, taxMode: d.taxMode, inclusive: d.inclusive, intraState: isIntraState(b.address.state, d.placeOfSupply || d.client.billing.state), currency: d.currency, taxLabel: s.taxLabel });
  const balance = Math.max(0, totals.total - d.amountPaid);
  const L = t.labels;
  const isQuote = d.type === "quote";

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const F = await pdf.embedFont(await font(), { subset: true });
  pdf.setTitle(`${titleFor(d, t)} ${d.number}`.trim());
  pdf.setAuthor(b.name || b.legalName || "");
  pdf.setCreator("Cloudesk");

  const [W, H] = PAPER[t.paper];
  const M = t.paper === "A5" ? 32 : 44;
  const ink = hex(t.colors.ink), muted = hex(t.colors.muted), accent = hex(t.colors.accent), head = hex(t.colors.tableHeader), line = rgb(0.86, 0.86, 0.86);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
  };
  newPage();

  /** Draws text at x (or right-aligned to x) and returns its width. */
  const text = (str: string, x: number, size: number, color = ink, align: "left" | "right" = "left") => {
    const v = clean(F, str);
    const w = F.widthOfTextAtSize(v, size);
    page.drawText(v, { x: align === "right" ? x - w : x, y, size, font: F, color });
    return w;
  };
  const lines = (str: string, x: number, size: number, width: number, color = ink, gap = 1.35) => {
    for (const l of wrap(F, size, str, width)) {
      ensure(size * gap);
      text(l, x, size, color);
      y -= size * gap;
    }
  };
  const ensure = (need: number, onBreak?: () => void) => {
    if (y - need < M + 24) {
      newPage();
      onBreak?.();
    }
  };

  // ── Header: business on the left, title and numbers on the right ──
  const top = y;
  const right = W - M;
  y -= 2;
  text(b.name || b.legalName || "Your business", M, 15, ink);
  y -= 18;
  const bizLines = [
    b.legalName && b.legalName !== b.name ? b.legalName : "",
    [b.address.line1, b.address.line2].filter(Boolean).join(", "),
    [b.address.city, b.address.state, b.address.postalCode].filter(Boolean).join(", "),
    [b.phone, b.email, b.website].filter(Boolean).join(" · "),
    t.show.businessGstin && b.gstin ? `GSTIN ${b.gstin}${b.pan ? ` · PAN ${b.pan}` : ""}` : "",
  ].filter(Boolean);
  for (const l of bizLines) lines(l, M, 8.5, W / 2 - M, muted);
  const leftEnd = y;

  y = top - 4;
  text(titleFor(d, t).toUpperCase(), right, 18, accent, "right");
  y -= 22;
  const meta: [string, string][] = [
    [L.number, d.number || "Draft"],
    [L.date, fmtDate(d.issueDate)],
    ...(d.dueDate ? ([[isQuote ? L.validUntil : L.dueDate, fmtDate(d.dueDate)]] as [string, string][]) : []),
    ...(d.reference ? ([["Reference", d.reference]] as [string, string][]) : []),
  ];
  for (const [k, v] of meta) {
    text(v, right, 9, ink, "right");
    text(k, right - 120, 9, muted, "right");
    y -= 13;
  }
  y = Math.min(y, leftEnd) - 10;
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1.2, color: accent });
  y -= 20;

  // ── Bill to / ship to / extra fields ──
  const c = d.client;
  const colW = (right - M - 24) / 3;
  const party = (label: string, x: number, addr: typeof c.billing) => {
    const start = y;
    text(label.toUpperCase(), x, 7.5, muted);
    y -= 13;
    lines(c.company || c.name, x, 10, colW, ink);
    if (c.company && c.name) lines(c.name, x, 8.5, colW, ink);
    const a = [[addr.line1, addr.line2].filter(Boolean).join(", "), [addr.city, addr.state, addr.postalCode].filter(Boolean).join(", ")].filter(Boolean);
    for (const l of a) lines(l, x, 8.5, colW, muted);
    if (t.show.clientContact) for (const l of [c.phone, c.email].filter(Boolean)) lines(l, x, 8.5, colW, muted);
    if (t.show.clientGstin && c.gstin) lines(`GSTIN ${c.gstin}`, x, 8.5, colW, muted);
    const end = y;
    y = start;
    return end;
  };
  const ends = [party(L.billTo, M, c.billing)];
  let col = 1;
  if (t.show.shipTo && c.shipping && (c.shipping.line1 || c.shipping.city)) ends.push(party(L.shipTo, M + (colW + 12) * col++, c.shipping));
  const extra: [string, string][] = [
    ...(t.show.placeOfSupply && d.taxMode === "gst" && (d.placeOfSupply || c.billing.state) ? ([["Place of supply", d.placeOfSupply || c.billing.state]] as [string, string][]) : []),
    ...d.customFields.filter((f) => f.value).map((f) => [f.label, f.value] as [string, string]),
  ];
  if (extra.length) {
    const x = M + (colW + 12) * col;
    const start = y;
    for (const [k, v] of extra) {
      text(k.toUpperCase(), x, 7.5, muted);
      y -= 12;
      lines(v, x, 9, colW, ink);
      y -= 3;
    }
    ends.push(y);
    y = start;
  }
  y = Math.min(...ends) - 14;

  // ── Items ──
  const cols = { ...t.table.columns, hsn: t.table.columns.hsn && d.taxMode === "gst", tax: t.table.columns.tax && d.taxMode !== "none", discount: t.table.columns.discount && d.lines.some((l) => l.discount) };
  type Col = { key: string; label: string; w: number; num?: boolean };
  const spec: Col[] = [
    ...(cols.sn ? [{ key: "sn", label: "#", w: 20 }] : []),
    { key: "item", label: L.item, w: 0 },
    ...(cols.hsn ? [{ key: "hsn", label: L.hsn, w: 52 }] : []),
    ...(cols.quantity ? [{ key: "qty", label: L.quantity, w: 44, num: true }] : []),
    ...(cols.unit ? [{ key: "unit", label: "Unit", w: 36 }] : []),
    ...(cols.rate ? [{ key: "rate", label: L.rate, w: 70, num: true }] : []),
    ...(cols.discount ? [{ key: "disc", label: L.discount, w: 52, num: true }] : []),
    ...(cols.tax ? [{ key: "tax", label: L.tax, w: 40, num: true }] : []),
    ...(cols.amount ? [{ key: "amt", label: L.amount, w: 80, num: true }] : []),
  ];
  const fixed = spec.reduce((n, x) => n + x.w, 0);
  spec.find((x) => x.key === "item")!.w = Math.max(120, right - M - fixed);
  const xs: number[] = [];
  spec.reduce((x, cl) => (xs.push(x), x + cl.w), M);
  const PAD = 5;
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: right - M, height: 18, color: head });
    spec.forEach((cl, i) => text(cl.label, cl.num ? xs[i]! + cl.w - PAD : xs[i]! + PAD, 8, ink, cl.num ? "right" : "left"));
    y -= 22;
  };
  tableHead();
  d.lines.forEach((l, i) => {
    const lt = totals.lines[i]!;
    const disc = l.discount ? (l.discount.kind === "percent" ? `${l.discount.value}%` : money(Math.round(l.discount.value))) : "";
    const itemW = spec.find((x) => x.key === "item")!.w - PAD * 2;
    const nameL = wrap(F, 9, l.name, itemW);
    const descL = l.description ? wrap(F, 7.5, l.description, itemW) : [];
    const h = nameL.length * 12 + descL.length * 10 + 6;
    ensure(h, tableHead);
    const rowTop = y;
    const cell: Record<string, string> = { sn: String(i + 1), hsn: l.hsn, qty: `${qty(l.quantity)}${!cols.unit && l.unit ? ` ${l.unit}` : ""}`, unit: l.unit, rate: money(l.rate), disc, tax: l.taxBps ? pct(l.taxBps) : "—", amt: money(d.inclusive ? lt.amount : lt.taxable) };
    spec.forEach((cl, j) => {
      y = rowTop;
      if (cl.key === "item") {
        for (const n of nameL) {
          text(n, xs[j]! + PAD, 9, ink);
          y -= 12;
        }
        for (const n of descL) {
          text(n, xs[j]! + PAD, 7.5, muted);
          y -= 10;
        }
      } else text(cell[cl.key] ?? "", cl.num ? xs[j]! + cl.w - PAD : xs[j]! + PAD, 9, ink, cl.num ? "right" : "left");
    });
    y = rowTop - h;
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: line });
  });
  y -= 6;

  // ── Totals (right) ──
  const sums: [string, string, "grand" | "balance" | ""][] = [
    [L.subtotal, money(totals.subtotal), ""],
    ...(totals.discount ? ([["Discount", `− ${money(totals.discount)}`, ""]] as [string, string, ""][]) : []),
    ...d.adjustments.charges.map((ch) => [ch.label, money(ch.amount), ""] as [string, string, ""]),
    ...(d.inclusive ? [] : totals.taxes.map((x) => [x.label, money(x.amount), ""] as [string, string, ""])),
    ...(totals.roundOff ? ([["Round off", `${totals.roundOff > 0 ? "+" : "−"} ${money(Math.abs(totals.roundOff))}`, ""]] as [string, string, ""][]) : []),
    [L.total, money(totals.total), "grand"],
    ...(d.amountPaid && !isQuote ? ([["Paid", `− ${money(d.amountPaid)}`, ""], [L.balance, money(balance), "balance"]] as [string, string, "" | "balance"][]) : []),
  ];
  ensure(sums.length * 16 + 20);
  const sx = right - 220;
  for (const [k, v, kind] of sums) {
    if (kind === "grand") {
      page.drawLine({ start: { x: sx, y: y + 11 }, end: { x: right, y: y + 11 }, thickness: 0.8, color: ink });
      y -= 3;
    }
    const size = kind ? 11 : 9;
    text(k, sx, size, kind ? ink : muted);
    text(v, right, size, kind === "grand" ? accent : ink, "right");
    y -= kind ? 18 : 14;
  }
  if (d.inclusive && totals.tax) lines(`Includes ${totals.taxes.map((x) => `${x.label} ${money(x.amount)}`).join(", ")}`, sx, 7.5, 220, muted);
  y -= 8;

  // ── Words, tax summary, payment, notes, terms ──
  const block = (label: string, body: string, color = ink) => {
    ensure(30);
    text(label.toUpperCase(), M, 7.5, muted);
    y -= 12;
    lines(body, M, 8.5, right - M, color);
    y -= 8;
  };
  if (t.show.amountInWords) block("Amount in words", amountInWords(totals.total, d.currency));
  if (t.show.taxSummary && d.taxMode === "gst" && totals.tax > 0) {
    const intra = totals.taxes.some((x) => x.label.startsWith("CGST"));
    const rows = totals.hsn.filter((h) => h.rateBps > 0).map((h) => `${h.hsn || "—"}: taxable ${money(h.taxable)} · ${intra ? `CGST ${pct(h.rateBps / 2)} ${money(Math.floor(h.tax / 2))} · SGST ${pct(h.rateBps / 2)} ${money(h.tax - Math.floor(h.tax / 2))}` : `IGST ${pct(h.rateBps)} ${money(h.tax)}`} · tax ${money(h.tax)}`);
    if (rows.length) block("Tax summary (HSN/SAC)", rows.join("\n"));
  }
  const p = s.payment;
  if (t.show.bankDetails && !isQuote && d.type !== "credit_note" && (p.accountNumber || p.instructions || p.upiId)) {
    const pay = [p.accountName && `A/c name: ${p.accountName}`, p.bankName && `Bank: ${p.bankName}`, p.accountNumber && `A/c no.: ${p.accountNumber}`, p.ifsc && `IFSC: ${p.ifsc}`, p.branch && `Branch: ${p.branch}`, p.swift && `SWIFT: ${p.swift}`, p.upiId && d.currency === "INR" && `UPI: ${p.upiId}`, p.instructions].filter(Boolean).join("\n");
    block("Payment details", pay, muted);
  }
  if (t.show.notes && d.notes) block(L.notes, d.notes);
  if (t.show.terms && d.terms) block(L.terms, d.terms, muted);
  if (t.show.signature) {
    ensure(50);
    y -= 26;
    page.drawLine({ start: { x: right - 160, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 0.6, color: muted });
    text(t.signature.name || `For ${b.name || "the business"}`, right, 8.5, ink, "right");
    y -= 12;
    text(L.signatory, right, 7.5, muted, "right");
    y -= 10;
  }

  // Footer, page numbers and the draft / void mark on every page.
  const foot = [d.footer, t.footerText].filter(Boolean).join("  ·  ").replace(/\n/g, " ");
  const mark = d.status === "void" ? "VOID" : d.status === "draft" ? "DRAFT" : "";
  pages.forEach((pg, i) => {
    if (foot) {
      const v = wrap(F, 7, foot, right - M - 60)[0] ?? "";
      pg.drawText(v, { x: M, y: M - 14, size: 7, font: F, color: muted });
    }
    if (pages.length > 1) {
      const n = `${i + 1} / ${pages.length}`;
      pg.drawText(n, { x: right - F.widthOfTextAtSize(n, 7), y: M - 14, size: 7, font: F, color: muted });
    }
    if (mark) pg.drawText(mark, { x: W / 2 - F.widthOfTextAtSize(mark, 90) / 2, y: H / 2 - 30, size: 90, font: F, color: rgb(0.85, 0.85, 0.85), opacity: 0.35 });
  });
  return pdf.save();
}
