// Printable price labels. Builds one self-contained HTML document, laid out
// in millimetres for the chosen label stock, that is both the on-screen
// preview and what goes to the printer — so the preview is exactly the print.
import { productQrPayload, qrSvg, renderBarcodeSvg, barcodeKind, normaliseGtin, encodeEan13, encodeCode128 } from "./barcode";
import { formatPrice } from "./money";

/**
 * A label stock. Thermal rolls print one page per row of labels (the page is
 * the label row); A4 sheets place a grid of labels on each page, matching
 * common pre-cut sheets (Avery/Novajet-style layouts).
 */
export type LabelStock = {
  id: string;
  name: string;
  kind: "thermal" | "sheet";
  /** Label size (mm). */
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** Page size (mm). */
  pageW: number;
  pageH: number;
  /** Offset of the first label from the page's top-left corner, and the gaps between labels (mm). */
  left: number;
  top: number;
  gapX: number;
  gapY: number;
  hint: string;
};

const round = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const thermal = (w: number, h: number, cols = 1, gap = 2): LabelStock => {
  const pageW = cols === 1 ? w : cols * w + (cols - 1) * gap + 2;
  return {
    id: cols === 1 ? `t-${w}x${h}` : `t${cols}-${w}x${h}`,
    name: cols === 1 ? `Thermal roll · ${w} × ${h} mm` : `Thermal roll, ${cols} across · ${w} × ${h} mm (${pageW} mm roll)`,
    kind: "thermal",
    w,
    h,
    cols,
    rows: 1,
    pageW,
    pageH: h,
    left: cols === 1 ? 0 : 1,
    top: 0,
    gapX: cols === 1 ? 0 : gap,
    gapY: 0,
    hint: `In the print dialog choose your label printer, set the paper size to ${pageW} × ${h} mm, margins to None and scale to 100%.`,
  };
};

const sheet = (id: string, name: string, w: number, h: number, cols: number, rows: number, gapX: number, gapY: number): LabelStock => ({
  id,
  name,
  kind: "sheet",
  w,
  h,
  cols,
  rows,
  pageW: 210,
  pageH: 297,
  gapX,
  gapY,
  left: round((210 - cols * w - (cols - 1) * gapX) / 2),
  top: round((297 - rows * h - (rows - 1) * gapY) / 2),
  hint: "Load the label sheet, choose A4 paper, margins None (or Minimum) and scale 100% — not “Fit to page”. Print one page on plain paper first and hold it against a sheet to check the alignment.",
});

export const LABEL_STOCKS: LabelStock[] = [
  thermal(50, 25),
  thermal(50, 30),
  thermal(38, 25),
  thermal(58, 40),
  thermal(100, 50),
  thermal(38, 25, 2),
  sheet("a4-24", "A4 sheet · 24 labels, 63.5 × 33.9 mm (3 × 8)", 63.5, 33.9, 3, 8, 2.5, 0),
  sheet("a4-40", "A4 sheet · 40 labels, 48.5 × 25.4 mm (4 × 10)", 48.5, 25.4, 4, 10, 0, 0),
  sheet("a4-65", "A4 sheet · 65 labels, 38.1 × 21.2 mm (5 × 13)", 38.1, 21.2, 5, 13, 2.5, 0),
  sheet("a4-21", "A4 sheet · 21 labels, 63.5 × 38.1 mm (3 × 7)", 63.5, 38.1, 3, 7, 2.5, 0),
];

export type LabelItem = {
  key: string;
  title: string;
  variant: string;
  price: number;
  compareAt: number | null;
  barcode: string;
  slug: string;
  variantId: string;
};

export type LabelFields = { shop: boolean; name: boolean; price: boolean; mrp: boolean; barcode: boolean; qr: boolean };

export type LabelDocOptions = {
  stock: LabelStock;
  items: LabelItem[];
  fields: LabelFields;
  currency: string;
  shopName: string;
  /** Live site URL for QR codes; null when the site isn't published. */
  siteUrl: string | null;
  /** Leave the first N positions of the first sheet empty (for part-used sheets). */
  skip?: number;
  /** Screen-only zoom for previews. Ignored when printing. */
  zoom?: number;
  /** Only render the first N pages (previews). */
  maxPages?: number;
  /** Dashed outlines showing label edges, on screen only. */
  outlines?: boolean;
};

export type LabelDoc = { html: string; pages: number; labels: number; warnings: string[] };


/** Bars in the code, including quiet zones, so the bar width can be checked against the label. */
function barcodeModules(code: string) {
  const c = normaliseGtin(code);
  return (barcodeKind(c) === "ean13" ? encodeEan13(c) : encodeCode128(c)).length + 20;
}

/**
 * A barcode SVG that exactly fills a box of `w` × `h` mm: the bar height is
 * chosen so the drawing's aspect ratio matches the box, so bars keep their
 * true width (scanners care) and the digits aren't stretched.
 */
function fittedBarcode(code: string, w: number, h: number) {
  const modules = barcodeModules(code);
  const textH = 10; // renderBarcodeSvg's text band at module = 1
  const totalH = (h / w) * modules;
  const barH = Math.max(8, totalH - textH * 1.15);
  return renderBarcodeSvg(code, { module: 1, height: round(barH) });
}

export function buildLabelDocument(o: LabelDocOptions): LabelDoc {
  const { stock: S, fields: F } = o;
  const perPage = S.cols * S.rows;
  const skip = S.kind === "sheet" ? clamp(Math.floor(o.skip ?? 0), 0, perPage - 1) : 0;
  const slots = [...Array<null>(skip).fill(null), ...o.items];
  const pages = Math.max(1, Math.ceil(slots.length / perPage));
  const shown = Math.min(pages, o.maxPages ?? pages);
  const warnings = new Set<string>();

  // Layout inside one label (mm).
  const pad = S.kind === "sheet" ? 2 : 1.5;
  const W = S.w - pad * 2;
  const H = S.h - pad * 2;
  const gap = clamp(H * 0.05, 0.6, 1.5);
  const hasBarcodeRow = F.barcode;
  const bcH = hasBarcodeRow ? round(clamp(H * 0.42, 7, 16)) : 0;
  const topH = round(H - (hasBarcodeRow ? bcH + gap : 0));
  const qrSize = F.qr && o.siteUrl ? round(Math.min(topH, W * (hasBarcodeRow ? 0.4 : 0.45))) : 0;
  const nameFs = round(clamp(topH * 0.2, 2.1, 3.6));
  const priceFs = round(clamp(topH * 0.3, 2.8, 6));
  const smallFs = round(clamp(nameFs * 0.78, 1.7, 2.8));
  if (F.qr && !o.siteUrl) warnings.add("QR codes are left off until the site is published.");
  if (qrSize && qrSize < 10) warnings.add("QR codes on labels this small are hard to scan with a phone. Try a larger label, or turn the QR code off.");

  const label = (it: LabelItem) => {
    let bc = "";
    if (F.barcode && it.barcode) {
      try {
        const mod = W / barcodeModules(it.barcode);
        if (mod < 0.19) warnings.add(`The barcode for “${it.title}” is too long to scan reliably at this label width. Use a wider label, or an EAN-13 code (Create missing barcodes).`);
        bc = fittedBarcode(it.barcode, W, bcH);
      } catch {
        warnings.add(`“${it.title}” has a barcode that can't be drawn.`);
      }
    } else if (F.barcode && !it.barcode) warnings.add("Some items have no barcode yet — use “Create missing barcodes”.");
    const qr = qrSize ? qrSvg(productQrPayload(o.siteUrl!, it.slug, it.variantId), { margin: 1, label: `${it.title} QR code` }) : "";
    const mrp = F.mrp && it.compareAt && it.compareAt > it.price ? it.compareAt : null;
    // Fit the text block to the space: drop the title to one line, then shrink the type (never below 75%).
    const textW = W - (qrSize ? qrSize + gap : 0);
    const titleLines = F.name ? Math.min(2, Math.ceil((it.title.length * nameFs * 0.55) / textW)) : 0;
    const heightFor = (lines: number) => (F.shop && o.shopName ? smallFs * 1.25 : 0) + lines * nameFs * 1.15 + (F.name && it.variant ? smallFs * 1.25 : 0) + (F.price ? priceFs * 1.05 + 0.4 : 0);
    const nameLines = titleLines > 1 && heightFor(2) > topH ? 1 : Math.max(1, titleLines);
    const k = Math.max(0.75, Math.min(1, topH / heightFor(nameLines)));
    const fs = (n: number) => round(n * k);
    const text = [
      F.shop && o.shopName ? `<div class="shop" style="font-size:${fs(smallFs)}mm">${esc(o.shopName)}</div>` : "",
      F.name ? `<div class="name" style="font-size:${fs(nameFs)}mm;-webkit-line-clamp:${nameLines};line-clamp:${nameLines}">${esc(it.title)}</div>` : "",
      F.name && it.variant ? `<div class="var" style="font-size:${fs(smallFs)}mm">${esc(it.variant)}</div>` : "",
      F.price ? `<div class="price" style="font-size:${fs(priceFs)}mm">${esc(formatPrice(it.price, o.currency))}${mrp ? ` <s style="font-size:${fs(smallFs)}mm">MRP ${esc(formatPrice(mrp, o.currency))}</s>` : ""}</div>` : "",
    ].join("");
    return `<div class="top" style="height:${topH}mm;gap:${gap}mm"><div class="text">${text}</div>${qr ? `<div class="qr" style="width:${qrSize}mm;height:${qrSize}mm">${qr}</div>` : ""}</div>${bc ? `<div class="bc" style="height:${bcH}mm;margin-top:${gap}mm">${bc}</div>` : hasBarcodeRow ? `<div class="bc none" style="height:${bcH}mm;margin-top:${gap}mm;font-size:${smallFs}mm">No barcode</div>` : ""}`;
  };

  // Copies of one item are identical: draw each once.
  const drawn = new Map<string, string>();
  const labelOnce = (it: LabelItem) => {
    let h = drawn.get(it.variantId);
    if (h === undefined) drawn.set(it.variantId, (h = label(it)));
    return h;
  };
  // Warnings come from every item, even on pages the preview leaves out.
  for (const it of o.items) labelOnce(it);

  let body = "";
  for (let p = 0; p < shown; p++) {
    let cells = "";
    for (let i = 0; i < perPage; i++) {
      const it = slots[p * perPage + i];
      if (it === undefined) break;
      const c = i % S.cols;
      const r = Math.floor(i / S.cols);
      const x = round(S.left + c * (S.w + S.gapX));
      const y = round(S.top + r * (S.h + S.gapY));
      cells += `<div class="label" style="left:${x}mm;top:${y}mm;width:${S.w}mm;height:${S.h}mm;padding:${pad}mm">${o.outlines !== false ? '<i class="edge"></i>' : ""}${it ? labelOnce(it) : ""}</div>`;
    }
    body += `<section class="page">${cells}</section>`;
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
@page{size:${S.pageW}mm ${S.pageH}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e8e8ed}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:${S.kind === "thermal" ? 4 : 8}mm 0}
@media screen{body{zoom:${o.zoom ?? 1}}}
.page{position:relative;width:${S.pageW}mm;height:${S.pageH}mm;margin:0 auto ${S.kind === "thermal" ? 2 : 8}mm;background:#fff;overflow:hidden;box-shadow:0 0.3mm 1.2mm rgb(0 0 0/.18)${S.kind === "thermal" ? ";border-radius:1mm" : ""}}
.label{position:absolute;display:flex;flex-direction:column;overflow:hidden}
.edge{position:absolute;inset:0;border:0.2mm dashed #c7c7cc;border-radius:1.5mm;pointer-events:none}
.top{display:flex;align-items:stretch;min-height:0}
.text{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:safe center;overflow:hidden}
.shop{text-transform:uppercase;letter-spacing:.06em;line-height:1.25;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.name{font-weight:600;line-height:1.15;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.var{color:#333;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.price{font-weight:800;line-height:1.05;margin-top:.4mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.price s{font-weight:500;color:#333;margin-left:.6mm}
.qr{flex:none;align-self:center}
.qr svg,.bc svg{display:block;width:100%;height:100%}
.bc{flex:none;width:100%}
.bc.none{display:flex;align-items:center;justify-content:center;border:0.2mm dashed #999;color:#666}
@media print{html,body{background:none;padding:0}.page{margin:0;box-shadow:none;border-radius:0;break-after:page}.page:last-child{break-after:auto}.edge{display:none}.bc.none{visibility:hidden}}
</style></head><body>${body}</body></html>`;
  return { html, pages, labels: o.items.length, warnings: [...warnings] };
}
