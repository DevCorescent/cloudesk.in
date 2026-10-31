// Identifies image formats from their bytes (never from the filename or the
// browser-supplied type) and reads pixel dimensions from the headers.
// SVG is deliberately not accepted: it can carry script.
export type ImageInfo = { mime: string; ext: string; width: number | null; height: number | null };

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

export function sniffImage(b: Buffer): ImageInfo | null {
  if (b.length < 16) return null;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (b.length < 24) return null;
    return { mime: "image/png", ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", ext: "jpg", ...jpegSize(b) };
  }
  if (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a") {
    return { mime: "image/gif", ext: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", ...webpSize(b) };
  }
  if (b.toString("ascii", 4, 12) === "ftypavif" || b.toString("ascii", 4, 12) === "ftypavis") {
    return { mime: "image/avif", ext: "avif", width: null, height: null };
  }
  return null;
}

function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return { width: null, height: null };
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 " && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.length >= 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return { width: null, height: null };
}
