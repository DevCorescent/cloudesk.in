// Working with uploaded files: a preview of anything the browser can't show
// by itself (Word as pages, spreadsheets as tables, slides' text, a ZIP's
// contents, text and Markdown), PDF tools (merge, extract, split, rotate,
// delete, reorder, watermark, page numbers, images to PDF) and conversions
// between formats — each saved next to the original (or as a new version of
// it) or downloaded.
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { pageOf, pageSchema, table as pmTable, h as pmH, p as pmP, textOf, type PMNode } from "@/lib/documents/write";
import { ApiError } from "../http/errors";
import { check, getFileAs, type Scope } from "./access";
import { fontBytes, fromDocx, fromHtml, fromMarkdown, fromText, openZip, toDocx, toHtml, toMarkdown, toPdf } from "./convert";
import { newVersion, upload, versionBytes } from "./core";
import { act, createDoc } from "./drive";
import { normalise } from "./live";
import { familyOf, TARGET_LABEL, targetsFor, TARGETS, type Family, type Target } from "@/lib/documents/formats";
export { familyOf, targetsFor };

const MAX_PDF_PAGES = 2000;
const MAX_SHEET_ROWS = 500;
const MAX_SHEET_COLS = 40;

type Src = { title: string; filename: string; mime: string; data: Buffer; ext: string };

/** The latest version of an uploaded file this member can open. */
async function source(s: Scope, id: string): Promise<{ f: typeof schema.docFiles.$inferSelect; role: string; src: Src }> {
  const { file: f, role } = await getFileAs(s, id);
  if (f.kind !== "file") throw new ApiError("conflict", "Written documents are opened in the editor");
  const v = await versionBytes(s, f.id);
  return { f, role, src: { title: f.title, filename: v.filename, mime: v.mime, data: v.data, ext: (v.filename.split(".").pop() ?? "").toLowerCase() } };
}

// ── Preview ─────────────────────────────────────────────────────────────────

export type Preview =
  | { type: "pdf"; pages: number }
  | { type: "image" }
  | { type: "html"; html: string; words: number }
  | { type: "text"; text: string; truncated: boolean }
  | { type: "sheet"; sheets: { name: string; rows: string[][]; total: number; cols: number }[] }
  | { type: "slides"; slides: { n: number; title: string; lines: string[] }[] }
  | { type: "zip"; entries: { name: string; size: number }[]; total: number }
  | { type: "none"; reason: string };

const PAGE = pageSchema.parse({});

export async function preview(s: Scope, id: string): Promise<{ preview: Preview; family: Family; filename: string; mime: string; size: number }> {
  const { src } = await source(s, id);
  const family = familyOf(src);
  const base = { family, filename: src.filename, mime: src.mime, size: src.data.length };
  try {
    switch (family) {
      case "pdf": {
        const pdf = await PDFDocument.load(src.data, { ignoreEncryption: true, updateMetadata: false });
        return { ...base, preview: { type: "pdf", pages: pdf.getPageCount() } };
      }
      case "image":
        return { ...base, preview: { type: "image" } };
      case "word": {
        const doc = await fromDocx(src.data);
        return { ...base, preview: { type: "html", html: toHtml(doc, { title: src.title, page: PAGE }), words: textOf(doc).split(/\s+/).filter(Boolean).length } };
      }
      case "markdown": {
        const doc = fromMarkdown(src.data.toString("utf8"));
        return { ...base, preview: { type: "html", html: toHtml(doc, { title: src.title, page: PAGE }), words: textOf(doc).split(/\s+/).filter(Boolean).length } };
      }
      case "text": {
        const text = src.data.toString("utf8");
        return { ...base, preview: { type: "text", text: text.slice(0, 200_000), truncated: text.length > 200_000 } };
      }
      case "sheet":
        return { ...base, preview: { type: "sheet", sheets: sheetsOf(src) } };
      case "slides":
        return { ...base, preview: { type: "slides", slides: slidesOf(src.data) } };
      case "zip": {
        const z = openZip(src.data);
        const entries = [...z.entries.entries()].filter(([n]) => !n.endsWith("/")).map(([name, e]) => ({ name, size: e.size }));
        return { ...base, preview: { type: "zip", entries: entries.slice(0, 500), total: entries.length } };
      }
      default:
        return { ...base, preview: { type: "none", reason: "This kind of file can't be shown here — download it to open it." } };
    }
  } catch (e) {
    return { ...base, preview: { type: "none", reason: e instanceof Error && e.message.length < 200 ? e.message : "This file couldn't be read for a preview. Download it to open it." } };
  }
}

function sheetsOf(src: Src) {
  const wb = src.ext === "csv" ? XLSX.read(src.data.toString("utf8"), { type: "string" }) : XLSX.read(src.data, { type: "buffer", cellDates: true, sheetRows: MAX_SHEET_ROWS + 1 });
  return wb.SheetNames.slice(0, 20).map((name) => {
    const all = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, blankrows: false, raw: false, defval: "" });
    const cols = Math.min(MAX_SHEET_COLS, Math.max(0, ...all.map((r) => r.length)));
    return { name, total: all.length, cols, rows: all.slice(0, MAX_SHEET_ROWS).map((r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? "").slice(0, 300))) };
  });
}

/** Each slide's title and text, in order. */
function slidesOf(data: Buffer) {
  const z = openZip(data);
  const names = [...z.entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  return names.slice(0, 300).map((n, i) => {
    const xml = z.read(n) ?? "";
    // Paragraphs are <a:p>; their runs' text is in <a:t>.
    const lines = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1]!.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decode(t[1]!)).join("")).filter((l) => l.trim());
    return { n: i + 1, title: lines[0] ?? `Slide ${i + 1}`, lines: lines.slice(1, 40) };
  });
}
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// ── Saving results ──────────────────────────────────────────────────────────

/** A new file next to the original (or in My documents when its folder is closed to changes). */
async function saveBeside(s: Scope, f: typeof schema.docFiles.$inferSelect, name: string, bytes: Buffer, title: string) {
  const place = { folderId: f.folderId, root: f.access === "private" ? "mine" : "team", title: title.slice(0, 200), tags: f.tags, linkType: f.linkType, linkId: f.linkId };
  try {
    return await upload(s, { name, bytes }, place);
  } catch (e) {
    if (e instanceof ApiError && (e.code === "forbidden" || e.code === "validation_failed")) return upload(s, { name, bytes }, { ...place, folderId: null, root: "mine" });
    throw e;
  }
}

const baseName = (t: string) => t.replace(/[^\w\- .()]+/g, "").trim().slice(0, 120) || "document";

// ── PDF tools ───────────────────────────────────────────────────────────────

const pagesSchema = z.array(z.number().int().min(1).max(MAX_PDF_PAGES)).max(MAX_PDF_PAGES);
const toolSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("merge"), fileIds: z.array(z.uuid()).min(2).max(30), title: z.string().trim().max(200).default("") }),
  z.object({ op: z.literal("extract"), fileId: z.uuid(), pages: pagesSchema.min(1), title: z.string().trim().max(200).default("") }),
  z.object({ op: z.literal("split"), fileId: z.uuid(), every: z.number().int().min(1).max(500).default(1) }),
  z.object({ op: z.literal("rotate"), fileId: z.uuid(), pages: pagesSchema.default([]), angle: z.union([z.literal(90), z.literal(180), z.literal(270)]), saveAs: z.enum(["version", "copy"]).default("version") }),
  z.object({ op: z.literal("delete"), fileId: z.uuid(), pages: pagesSchema.min(1), saveAs: z.enum(["version", "copy"]).default("version") }),
  z.object({ op: z.literal("reorder"), fileId: z.uuid(), order: pagesSchema.min(1), saveAs: z.enum(["version", "copy"]).default("version") }),
  z.object({ op: z.literal("watermark"), fileId: z.uuid(), text: z.string().trim().min(1).max(60), opacity: z.number().min(0.05).max(0.6).default(0.15), saveAs: z.enum(["version", "copy"]).default("copy") }),
  z.object({ op: z.literal("number"), fileId: z.uuid(), position: z.enum(["bottom-center", "bottom-right", "top-right"]).default("bottom-center"), format: z.enum(["n", "n-of-m", "page-n"]).default("n-of-m"), saveAs: z.enum(["version", "copy"]).default("version") }),
  z.object({ op: z.literal("edit"), fileId: z.uuid(), pages: z.array(z.object({ page: z.number().int().min(1).max(MAX_PDF_PAGES), rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0) })).min(1).max(MAX_PDF_PAGES), saveAs: z.enum(["version", "copy"]).default("version") }),
  z.object({ op: z.literal("images"), fileIds: z.array(z.uuid()).min(1).max(100), title: z.string().trim().max(200).default(""), paper: z.enum(["A4", "Letter", "fit"]).default("A4") }),
]);

async function loadPdf(s: Scope, id: string) {
  const { f, role, src } = await source(s, id);
  if (familyOf(src) !== "pdf") throw new ApiError("validation_failed", `“${f.title}” isn't a PDF`);
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(src.data, { ignoreEncryption: false });
  } catch (e) {
    throw new ApiError("validation_failed", /encrypt/i.test(String(e)) ? `“${f.title}” is password-protected. Remove the password first.` : `“${f.title}” couldn't be read as a PDF`);
  }
  return { f, role, src, pdf };
}

const checkPages = (pages: number[], count: number) => {
  const bad = pages.find((p) => p > count);
  if (bad) throw new ApiError("validation_failed", `There's no page ${bad} — it has ${count} page${count === 1 ? "" : "s"}`);
};

/** A new PDF holding these pages (1-based) of another, in this order. */
async function pick(from: PDFDocument, pages: number[]) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(from, pages.map((p) => p - 1));
  for (const c of copied) out.addPage(c);
  return out;
}

/** Writes a changed PDF back: a new version of the same file (the old one is kept), or a copy beside it. */
async function writeBack(s: Scope, f: typeof schema.docFiles.$inferSelect, role: string, pdf: PDFDocument, saveAs: "version" | "copy", note: string, suffix: string) {
  const bytes = Buffer.from(await pdf.save());
  if (saveAs === "version") {
    if (role !== "edit") throw new ApiError("forbidden", "You can open this file, but not change it — save it as a copy instead");
    const r = await newVersion(s, f.id, { name: `${baseName(f.title)}.pdf`, bytes }, note);
    return { fileId: f.id, version: r.version, created: false };
  }
  const c = await saveBeside(s, f, `${baseName(f.title)} ${suffix}.pdf`, bytes, `${f.title} (${suffix})`);
  return { fileId: c!.id, created: true };
}

export async function pdfTool(s: Scope, raw: unknown) {
  const v = check(toolSchema, raw);
  switch (v.op) {
    case "merge": {
      const out = await PDFDocument.create();
      let first: typeof schema.docFiles.$inferSelect | null = null;
      for (const id of v.fileIds) {
        const { f, pdf } = await loadPdf(s, id);
        first ??= f;
        for (const p of await out.copyPages(pdf, pdf.getPageIndices())) out.addPage(p);
        if (out.getPageCount() > MAX_PDF_PAGES) throw new ApiError("validation_failed", `A PDF can hold up to ${MAX_PDF_PAGES} pages`);
      }
      const title = v.title || `${first!.title} (merged)`;
      const c = await saveBeside(s, first!, `${baseName(title)}.pdf`, Buffer.from(await out.save()), title);
      await act(s, "pdf_merged", { fileId: c!.id }, { from: v.fileIds.length });
      return { fileId: c!.id, created: true, pages: out.getPageCount() };
    }
    case "extract": {
      const { f, pdf } = await loadPdf(s, v.fileId);
      checkPages(v.pages, pdf.getPageCount());
      const out = await pick(pdf, v.pages);
      const label = v.pages.length === 1 ? `page ${v.pages[0]}` : `pages ${ranges(v.pages)}`;
      const c = await saveBeside(s, f, `${baseName(f.title)} ${label}.pdf`, Buffer.from(await out.save()), v.title || `${f.title} (${label})`);
      return { fileId: c!.id, created: true, pages: out.getPageCount() };
    }
    case "split": {
      const { f, pdf } = await loadPdf(s, v.fileId);
      const n = pdf.getPageCount();
      if (n < 2) throw new ApiError("validation_failed", "There's only one page");
      if (Math.ceil(n / v.every) > 100) throw new ApiError("validation_failed", "That would make more than 100 files — split into bigger parts");
      const made: string[] = [];
      for (let start = 1; start <= n; start += v.every) {
        const pages = Array.from({ length: Math.min(v.every, n - start + 1) }, (_, i) => start + i);
        const label = pages.length === 1 ? `page ${start}` : `pages ${start}-${pages.at(-1)}`;
        const c = await saveBeside(s, f, `${baseName(f.title)} ${label}.pdf`, Buffer.from(await (await pick(pdf, pages)).save()), `${f.title} (${label})`);
        made.push(c!.id);
      }
      return { fileIds: made, created: true };
    }
    case "rotate": {
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      checkPages(v.pages, pdf.getPageCount());
      const which = v.pages.length ? v.pages : pdf.getPageIndices().map((i) => i + 1);
      for (const p of which) {
        const page = pdf.getPage(p - 1);
        page.setRotation(degrees((page.getRotation().angle + v.angle) % 360));
      }
      return writeBack(s, f, role, pdf, v.saveAs, `Rotated ${which.length === pdf.getPageCount() ? "all pages" : `page${which.length === 1 ? "" : "s"} ${ranges(which)}`}`, "rotated");
    }
    case "delete": {
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      const n = pdf.getPageCount();
      checkPages(v.pages, n);
      const keep = pdf.getPageIndices().map((i) => i + 1).filter((p) => !v.pages.includes(p));
      if (!keep.length) throw new ApiError("validation_failed", "That would delete every page");
      return writeBack(s, f, role, await pick(pdf, keep), v.saveAs, `Deleted page${v.pages.length === 1 ? "" : "s"} ${ranges(v.pages)}`, "edited");
    }
    case "reorder": {
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      const n = pdf.getPageCount();
      checkPages(v.order, n);
      if (new Set(v.order).size !== v.order.length) throw new ApiError("validation_failed", "Each page can appear once");
      return writeBack(s, f, role, await pick(pdf, v.order), v.saveAs, "Reordered pages", "reordered");
    }
    case "edit": {
      // The page editor's changes in one go: this order, these rotations; pages left out are deleted.
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      const n = pdf.getPageCount();
      checkPages(v.pages.map((x) => x.page), n);
      if (new Set(v.pages.map((x) => x.page)).size !== v.pages.length) throw new ApiError("validation_failed", "Each page can appear once");
      const out = await pick(pdf, v.pages.map((x) => x.page));
      out.getPages().forEach((page, i) => {
        const r = v.pages[i]!.rotate;
        if (r) page.setRotation(degrees((page.getRotation().angle + r) % 360));
      });
      const removed = n - v.pages.length;
      const moved = v.pages.some((x, i) => x.page !== i + 1);
      const turned = v.pages.filter((x) => x.rotate).length;
      const note = [removed && `deleted ${removed} page${removed === 1 ? "" : "s"}`, moved && "reordered", turned && `rotated ${turned}`].filter(Boolean).join(", ") || "saved";
      return writeBack(s, f, role, out, v.saveAs, note[0]!.toUpperCase() + note.slice(1), "edited");
    }
    case "watermark": {
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont((await fontBytes()).bold, { subset: true });
      const text = v.text;
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        const size = Math.min(width, height) / Math.max(4, text.length * 0.55);
        const w = font.widthOfTextAtSize(text, size);
        // Diagonally across the middle of the page.
        page.drawText(text, { x: width / 2 - (w / 2) * Math.cos(Math.PI / 4), y: height / 2 - (w / 2) * Math.sin(Math.PI / 4), size, font, color: rgb(0.5, 0.5, 0.55), opacity: v.opacity, rotate: degrees(45) });
      }
      return writeBack(s, f, role, pdf, v.saveAs, `Watermark “${text}”`, "watermarked");
    }
    case "number": {
      const { f, role, pdf } = await loadPdf(s, v.fileId);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const pages = pdf.getPages();
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const label = v.format === "n" ? String(i + 1) : v.format === "page-n" ? `Page ${i + 1}` : `${i + 1} / ${pages.length}`;
        const size = 9;
        const w = font.widthOfTextAtSize(label, size);
        const x = v.position === "bottom-center" ? width / 2 - w / 2 : width - 36 - w;
        const y = v.position === "top-right" ? height - 28 : 20;
        page.drawText(label, { x, y, size, font, color: rgb(0.35, 0.37, 0.4) });
      });
      return writeBack(s, f, role, pdf, v.saveAs, "Added page numbers", "numbered");
    }
    case "images": {
      const out = await PDFDocument.create();
      let first: typeof schema.docFiles.$inferSelect | null = null;
      for (const id of v.fileIds) {
        const { f, src } = await source(s, id);
        first ??= f;
        if (src.mime !== "image/png" && src.mime !== "image/jpeg") throw new ApiError("validation_failed", `“${f.title}” isn't a PNG or JPEG image`);
        const img = src.mime === "image/png" ? await out.embedPng(src.data) : await out.embedJpg(src.data);
        const [pw, ph] = v.paper === "Letter" ? [612, 792] : v.paper === "A4" ? [595.28, 841.89] : [img.width, img.height];
        const landscape = v.paper !== "fit" && img.width > img.height;
        const [W, H] = landscape ? [ph, pw] : [pw, ph];
        const page = out.addPage([W, H]);
        const margin = v.paper === "fit" ? 0 : 28;
        const scale = Math.min((W - margin * 2) / img.width, (H - margin * 2) / img.height, v.paper === "fit" ? 1 : Infinity);
        page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
      }
      const title = v.title || (v.fileIds.length === 1 ? first!.title : `${first!.title} and ${v.fileIds.length - 1} more`);
      const c = await saveBeside(s, first!, `${baseName(title)}.pdf`, Buffer.from(await out.save()), title);
      return { fileId: c!.id, created: true, pages: out.getPageCount() };
    }
  }
}

/** 1,2,3,5 → "1–3, 5" */
export function ranges(pages: number[]) {
  const xs = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j]! + 1) j++;
    out.push(j > i ? `${xs[i]}–${xs[j]}` : String(xs[i]));
    i = j;
  }
  return out.join(", ");
}

// ── Conversions ─────────────────────────────────────────────────────────────

const MIME: Record<Exclude<Target, "doc">, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json; charset=utf-8",
};

/** A file's content as editor JSON (what most conversions go through). */
async function asDoc(src: Src): Promise<PMNode> {
  switch (familyOf(src)) {
    case "word":
      return fromDocx(src.data);
    case "markdown":
      return fromMarkdown(src.data.toString("utf8"));
    case "text":
      return /\.html?$/.test(src.filename) ? fromHtml(src.data.toString("utf8")) : fromText(src.data.toString("utf8"));
    case "sheet": {
      const content: PMNode[] = [];
      for (const sh of sheetsOf(src)) {
        if (!sh.rows.length) continue;
        content.push(pmH(2, sh.name));
        const [head, ...rest] = sh.rows;
        content.push(pmTable(head!.map((c) => c || " "), ...rest.map((r) => r.map((c) => c || ""))));
        if (sh.total > sh.rows.length) content.push(pmP(`Showing the first ${sh.rows.length} of ${sh.total} rows.`));
      }
      return { type: "doc", content: content.length ? content : [pmP("This spreadsheet is empty.")] };
    }
    case "slides": {
      const content: PMNode[] = [];
      for (const sl of slidesOf(src.data)) {
        content.push(pmH(2, `${sl.n}. ${sl.title}`));
        for (const l of sl.lines) content.push(pmP(l));
      }
      return { type: "doc", content: content.length ? content : [pmP("No text in these slides.")] };
    }
    default:
      throw new ApiError("validation_failed", "This kind of file can't be converted");
  }
}

const convertSchema = z.object({ to: z.enum(TARGETS), mode: z.enum(["save", "download"]).default("save") });

/** Converts an uploaded file (or a written document) to another format, saving it beside the original or downloading it. */
export async function convert(s: Scope, id: string, raw: unknown) {
  const v = check(convertSchema, raw);
  const { file: f } = await getFileAs(s, id);
  let out: { data: Buffer; ext: Exclude<Target, "doc">; title: string } | { doc: PMNode; title: string };
  if (f.kind === "doc") {
    if (!targetsFor("written").includes(v.to)) throw new ApiError("validation_failed", "Written documents convert to PDF, Word, Markdown, HTML or text");
    const { render } = await import("./exporting");
    const r = await render(f, v.to as "pdf" | "docx" | "md" | "html" | "txt");
    out = { data: r.data, ext: v.to as Exclude<Target, "doc">, title: f.title };
  } else {
    const { src } = await source(s, id);
    const fam = familyOf(src);
    if (!targetsFor(fam).includes(v.to)) throw new ApiError("validation_failed", `This file can't be turned into ${TARGET_LABEL[v.to]}`);
    out = await convertFile(src, v.to);
  }
  if ("doc" in out) {
    if (v.mode === "download") throw new ApiError("validation_failed", "An editable document is saved to your drive");
    const body = { title: out.title, content: normalise(out.doc) };
    // Beside the original if you can add there; otherwise in My documents.
    const file = await createDoc(s, { ...body, folderId: f.folderId, root: f.access === "private" ? "mine" : "team" }).catch(() => createDoc(s, { ...body, root: "mine" }));
    await act(s, "converted", { fileId: f.id }, { to: "doc" });
    return { fileId: file.id, kind: "doc" as const };
  }
  const filename = `${baseName(out.title)}.${out.ext}`;
  if (v.mode === "download") {
    await act(s, "converted", { fileId: f.id }, { to: out.ext, download: true });
    return new Response(new Uint8Array(out.data), { headers: { "Content-Type": MIME[out.ext], "Content-Disposition": `attachment; filename="${filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  }
  // Text formats the drive accepts as uploads keep their own type; others go through as they are.
  const c = await saveBeside(s, f, filename, out.data, out.title);
  await act(s, "converted", { fileId: f.id }, { to: out.ext });
  return { fileId: c!.id, kind: "file" as const };
}

async function convertFile(src: Src, to: Target): Promise<{ data: Buffer; ext: Exclude<Target, "doc">; title: string } | { doc: PMNode; title: string }> {
  const title = src.title;
  const fam = familyOf(src);
  if (fam === "image") {
    const pdf = await PDFDocument.create();
    const img = src.mime === "image/png" ? await pdf.embedPng(src.data) : src.mime === "image/jpeg" ? await pdf.embedJpg(src.data) : null;
    if (!img) throw new ApiError("validation_failed", "Only PNG and JPEG images become PDFs");
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    return { data: Buffer.from(await pdf.save()), ext: "pdf", title };
  }
  if (fam === "sheet" && (to === "xlsx" || to === "csv" || to === "json")) {
    const wb = src.ext === "csv" ? XLSX.read(src.data.toString("utf8"), { type: "string" }) : XLSX.read(src.data, { type: "buffer", cellDates: true });
    if (to === "xlsx") return { data: Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), ext: "xlsx", title };
    const first = wb.Sheets[wb.SheetNames[0]!]!;
    if (to === "csv") return { data: Buffer.from(XLSX.utils.sheet_to_csv(first)), ext: "csv", title };
    const json = Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n]!, { defval: null })]));
    return { data: Buffer.from(JSON.stringify(wb.SheetNames.length === 1 ? json[wb.SheetNames[0]!] : json, null, 2)), ext: "json", title };
  }
  const doc = normalise(await asDoc(src));
  const page = pageOf({ landscape: fam === "sheet" });
  switch (to) {
    case "doc":
      return { doc, title };
    case "pdf":
      return { data: Buffer.from(await toPdf(doc, { title, page })), ext: "pdf", title };
    case "docx":
      return { data: await toDocx(doc, { title, page }), ext: "docx", title };
    case "md":
      return { data: Buffer.from(toMarkdown(doc, title)), ext: "md", title };
    case "html":
      return { data: Buffer.from(toHtml(doc, { title, page, standalone: true })), ext: "html", title };
    case "txt":
      return { data: Buffer.from(`${title}\n\n${textOf(doc)}`), ext: "txt", title };
    default:
      throw new ApiError("validation_failed", "That conversion isn't available");
  }
}

/** For the share link's public page: the file's latest bytes. */
export async function publicFileBytes(fileId: string) {
  const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, fileId));
  if (!f) return null;
  const [v] = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, f.version)));
  return v ?? null;
}
