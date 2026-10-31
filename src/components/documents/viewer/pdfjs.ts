"use client";

// PDF.js, loaded only when a PDF is opened. Its worker, character maps, colour profiles,
// standard fonts and image decoders are served from /public/pdfjs (copied
// from pdfjs-dist; the worker's file name carries the version it must match).
import type { PDFDocumentProxy } from "pdfjs-dist";

const VERSION = "6.4.299";
let lib: Promise<typeof import("pdfjs-dist")> | null = null;

export function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${VERSION}.min.mjs`;
    if (m.version !== VERSION) console.warn(`pdfjs-dist is ${m.version}; public/pdfjs has the ${VERSION} worker — copy the new one`);
    return m;
  });
  return lib;
}

/** Opens a PDF from the app (sent with your cookies) or from bytes. */
export async function openPdf(src: string | Uint8Array): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({
    ...(typeof src === "string" ? { url: src, withCredentials: true } : { data: src }),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  }).promise;
}

/** A page drawn to a canvas at this width (CSS pixels), sharp on high-density screens. */
export async function renderThumb(doc: PDFDocumentProxy, n: number, width: number, rotation = 0) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width / base.width) * dpr, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${(vp.height / vp.width) * width}px`;
  await page.render({ canvas, viewport: vp }).promise;
  return canvas;
}

/** A page as a PNG or JPEG, at a print-friendly resolution. */
export async function pageImage(doc: PDFDocumentProxy, n: number, type: "image/png" | "image/jpeg", scale = 2): Promise<Blob> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, viewport: vp }).promise;
  return new Promise((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't draw the page"))), type, 0.92));
}

/** Every page's text, in order (for find and for turning a PDF into an editable document). */
export async function pagesText(doc: PDFDocumentProxy, onPage?: (n: number) => void) {
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      line += it.str;
      if (it.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    out.push(lines.join("\n"));
    onPage?.(n);
  }
  return out;
}
