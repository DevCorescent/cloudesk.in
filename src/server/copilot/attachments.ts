// Files the person adds to a question: photos and PDFs go to the model as they
// are; Word, Excel, PowerPoint, CSV and text files go as their text. Each gets
// a short id (f1, f2…) that tools use to act on it — read a bill, save it to
// Documents — and that stays with the conversation, so later questions can
// still refer to it.
import * as XLSX from "xlsx";
import { sniffFile } from "@/lib/documents/model";
import { ApiError } from "../http/errors";

/** Vercel accepts request bodies up to 4.5 MB; photos are shrunk in the browser first. */
export const MAX_ATTACH_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACH_FILES = 4;
const TEXT_LIMIT = 80_000;

export type Upload = { name: string; bytes: Buffer };
export type Attached = { id: string; name: string; mime: string; size: number };
type Block = Record<string, unknown>;

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clip = (t: string) => (t.length > TEXT_LIMIT ? `${t.slice(0, TEXT_LIMIT)}\n…(cut: the file is longer)` : t);
const xmlText = (xml: string) =>
  xml
    .replace(/<\/w:p>|<\/a:p>|<w:br\/>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The text inside an Office file (docx/pptx are zips of XML). */
function officeText(bytes: Buffer, ext: string): string {
  const zip = XLSX.CFB.read(bytes, { type: "buffer" }) as { FullPaths: string[]; FileIndex: { content?: Uint8Array | number[] }[] };
  const files: [string, { content?: Uint8Array | number[] }][] = zip.FullPaths.map((p: string, i: number) => [p, zip.FileIndex[i]!] as [string, { content?: Uint8Array | number[] }]).filter(([p]) => (ext === "docx" ? /word\/document\.xml$/.test(p) : /ppt\/slides\/slide\d+\.xml$/.test(p)));
  if (ext === "pptx") files.sort(([a], [b]) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  return files.map(([, f], i) => `${ext === "pptx" ? `--- slide ${i + 1}\n` : ""}${xmlText(Buffer.from(f.content ?? []).toString("utf8"))}`).join("\n\n");
}

function sheetText(bytes: Buffer): string {
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
  return wb.SheetNames.slice(0, 8)
    .map((n) => `--- sheet “${n}”\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]!, { blankrows: false }).split("\n").slice(0, 2000).join("\n")}`)
    .join("\n\n");
}

/** Turns uploads into model content blocks, numbered after the ones already in the conversation. */
export function toBlocks(files: Upload[], already: number): { blocks: Block[]; attached: Attached[] } {
  if (files.length > MAX_ATTACH_FILES) throw new ApiError("validation_failed", `Add up to ${MAX_ATTACH_FILES} files at a time`);
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_ATTACH_BYTES) throw new ApiError("payload_too_large", "Files added to one question are limited to 4 MB in all. Split them, or add a smaller copy.");
  const blocks: Block[] = [];
  const attached: Attached[] = [];
  files.forEach((f, i) => {
    if (!f.bytes.length) throw new ApiError("validation_failed", `“${f.name}” is empty`);
    const kind = sniffFile(f.bytes, f.name);
    const ext = (kind?.ext ?? f.name.split(".").pop() ?? "").toLowerCase();
    const id = `f${already + i + 1}`;
    const mime = kind?.mime ?? "application/octet-stream";
    attached.push({ id, name: f.name.slice(0, 200), mime, size: f.bytes.length });
    const head = `[Attachment ${id}: “${f.name.slice(0, 200)}” — ${ext.toUpperCase() || "file"}, ${kb(f.bytes.length)}]`;
    const data = f.bytes.toString("base64");
    // cc_file marks a file's content in the stored conversation; it's taken off before anything goes to the model.
    const tag = { cc_file: { id, name: f.name.slice(0, 200), mime } };
    if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) {
      blocks.push({ type: "text", text: head, ...tag }, { type: "image", source: { type: "base64", media_type: mime, data }, ...tag });
    } else if (mime === "application/pdf") {
      blocks.push({ type: "text", text: head, ...tag }, { type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: f.name.slice(0, 200), ...tag });
    } else {
      let text: string;
      if (["xlsx", "xls", "csv", "ods"].includes(ext)) text = sheetText(f.bytes);
      else if (ext === "docx" || ext === "pptx") text = officeText(f.bytes, ext);
      else if (["txt", "md", "json", "xml", "html", "htm"].includes(ext) || mime.startsWith("text/")) text = f.bytes.toString("utf8");
      else throw new ApiError("validation_failed", `“${f.name}” can't be read here. Add a photo, PDF, Word, Excel, PowerPoint, CSV or text file.`);
      if (!text.trim()) throw new ApiError("validation_failed", `“${f.name}” has no text to read`);
      // The text for the model, and the original kept for saving to Documents.
      blocks.push({ type: "text", text: `${head}\n${clip(text)}`, ...tag, cc_data: data });
    }
  });
  return { blocks, attached };
}

type Tagged = Block & { cc_file?: { id: string; name: string; mime: string }; cc_data?: string; source?: { data?: string } };

/** How many files the conversation already has, so new ones get the next ids. */
export function countAttached(messages: unknown[]): number {
  const ids = new Set<string>();
  for (const m of messages as { content: unknown }[]) if (Array.isArray(m.content)) for (const b of m.content as Tagged[]) if (b.cc_file) ids.add(b.cc_file.id);
  return ids.size;
}

/** A file from the conversation by id, with its bytes. */
export function findAttached(messages: unknown[], id: string): { name: string; mime: string; bytes: Buffer } | null {
  for (const m of messages as { content: unknown }[]) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Tagged[]) {
      if (b.cc_file?.id !== id) continue;
      const data = b.cc_data ?? b.source?.data;
      if (data) return { name: b.cc_file.name, mime: b.cc_file.mime, bytes: Buffer.from(data, "base64") };
    }
  }
  return null;
}

/** The files a stored message carries, for showing them as chips. */
export function filesOf(content: unknown): { id: string; name: string; mime: string }[] {
  if (!Array.isArray(content)) return [];
  const seen = new Map<string, { id: string; name: string; mime: string }>();
  for (const b of content as Tagged[]) if (b.cc_file) seen.set(b.cc_file.id, b.cc_file);
  return [...seen.values()];
}

/** What goes to the model: the same history with the storage-only markers taken off. */
export function forModel(messages: unknown[]): unknown[] {
  return (messages as { role: string; content: unknown }[]).map((m) =>
    Array.isArray(m.content)
      ? {
          ...m,
          content: (m.content as Tagged[]).map((b) => {
            if (!b.cc_file) return b;
            const { cc_file: _f, cc_data: _d, ...rest } = b;
            void _f;
            void _d;
            return rest;
          }),
        }
      : m,
  );
}
