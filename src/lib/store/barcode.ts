import QRCode from "qrcode";

// Barcodes for products: EAN-13 (the retail standard, scanned by every POS
// scanner) and Code 128 (for SKUs and any other text). Encoders produce bar
// patterns; renderBarcodeSvg draws them as crisp SVG for screens and labels.

// ── EAN-13 ──
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** UPC-A (12 digits) is EAN-13 with a leading zero. */
export function normaliseGtin(code: string): string {
  const c = code.replace(/\s+/g, "");
  return /^\d{12}$/.test(c) && isValidEan13(`0${c}`) ? `0${c}` : c;
}

/** 95 modules: "1" = bar, "0" = space. */
export function encodeEan13(code: string): string {
  if (!isValidEan13(code)) throw new Error("Not a valid EAN-13 code");
  const parity = PARITY[Number(code[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[Number(code[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
  return bits + "101";
}

/**
 * In-store EAN-13 numbers. The "2" prefix (20–29) is reserved by GS1 for
 * restricted, in-store use, so these never collide with manufacturers' codes.
 * Layout: 20 · 4-digit store number · 6-digit item number · check digit.
 */
export function storeEan13(storeNumber: number, itemNumber: number): string {
  const first12 = `20${String(Math.abs(storeNumber) % 10000).padStart(4, "0")}${String(Math.abs(itemNumber) % 1_000_000).padStart(6, "0")}`;
  return first12 + ean13CheckDigit(first12);
}

// ── Code 128 (set B: printable ASCII) ──
const C128 = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000", "11010011100", "1100011101011",
];

export function encodeCode128(text: string): string {
  if (!text || text.length > 48 || !/^[\x20-\x7e]+$/.test(text)) throw new Error("Code 128 needs 1–48 printable characters");
  const values = [104, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  return [...values, check].map((v) => C128[v]).join("") + C128[106];
}

/** EAN-13 when the code is one, otherwise Code 128. */
export function barcodeKind(code: string): "ean13" | "code128" {
  return isValidEan13(normaliseGtin(code)) ? "ean13" : "code128";
}

/** An SVG barcode with its human-readable text. `module` is the bar width in px (or mm on labels). */
export function renderBarcodeSvg(code: string, opts: { height?: number; module?: number; showText?: boolean; unit?: "px" | "mm" } = {}): string {
  const c = normaliseGtin(code);
  const kind = barcodeKind(c);
  const bits = kind === "ean13" ? encodeEan13(c) : encodeCode128(c);
  const m = opts.module ?? 2;
  const h = opts.height ?? 60;
  const quiet = 10 * m;
  const textH = opts.showText === false ? 0 : Math.max(10, m * 7);
  const width = bits.length * m + quiet * 2;
  let rects = "";
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (bits[j] === "1") j++;
    // EAN guard bars run a little longer, as on printed packs.
    const guard = kind === "ean13" && (i < 3 || (i >= 45 && i < 50) || i >= 92);
    rects += `<rect x="${quiet + i * m}" y="0" width="${(j - i) * m}" height="${guard ? h + textH * 0.5 : h}"/>`;
    i = j;
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  let text = "";
  if (textH) {
    const y = h + textH * 0.95;
    if (kind === "ean13") {
      // Each group of six digits sits between the guard bars (42 modules); textLength keeps it there whatever the font.
      const fs = textH * 0.95;
      const group = (x: number, digits: string) => `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" textLength="${36 * m}" lengthAdjust="spacingAndGlyphs">${digits}</text>`;
      text = `<text x="${quiet - m * 1.5}" y="${y}" font-size="${fs}" text-anchor="end">${c[0]}</text>${group(quiet + 24 * m, c.slice(1, 7))}${group(quiet + 71 * m, c.slice(7))}`;
    } else text = `<text x="${width / 2}" y="${y}" font-size="${textH}" text-anchor="middle">${esc(c)}</text>`;
  }
  const u = opts.unit ?? "px";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h + textH * 1.15}" width="${width}${u === "mm" ? "mm" : ""}" height="${h + textH * 1.15}${u === "mm" ? "mm" : ""}" role="img" aria-label="Barcode ${esc(c)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g><g fill="#000" font-family="Helvetica,Arial,sans-serif" font-variant-numeric="tabular-nums">${text}</g></svg>`;
}

/** What a product QR code contains: its page on the live site, with the variant. Scannable by phones and by the POS. */
export function productQrPayload(siteUrl: string, slug: string, variantId?: string) {
  return `${siteUrl.replace(/\/$/, "")}/product/${encodeURIComponent(slug)}${variantId ? `?v=${variantId}` : ""}`;
}

/** UPI payment request (scanned by any UPI app). */
export function upiPayUrl(input: { vpa: string; name: string; amountMinor: number; note: string; ref?: string }) {
  const p = new URLSearchParams({ pa: input.vpa, pn: input.name.slice(0, 50), am: (input.amountMinor / 100).toFixed(2), cu: "INR", tn: input.note.slice(0, 60) });
  if (input.ref) p.set("tr", input.ref.slice(0, 35));
  return `upi://pay?${p.toString()}`;
}

/** A QR code as SVG, drawn synchronously from the QR matrix (no canvas, prints sharply). */
export function qrSvg(text: string, opts: { margin?: number; label?: string } = {}): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const m = opts.margin ?? 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
  const size = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${(opts.label ?? "QR code").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!)}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
