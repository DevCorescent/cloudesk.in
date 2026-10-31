// Written documents in and out: download as PDF, Word, Markdown, HTML or text;
// bring in Word, Markdown, HTML or text files as editable documents; turn one
// into a PDF in the drive to send for signature; and the images placed in
// documents (stored per document, served to whoever can open it).
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAX_ORG_BYTES } from "@/lib/documents/model";
import { pageOf, type PMNode } from "@/lib/documents/write";
import { ApiError, notFound } from "../http/errors";
import { check, getFileAs, type Scope } from "./access";
import { fromDocx, fromHtml, fromMarkdown, fromText, toDocx, toHtml, toMarkdown, toPdf } from "./convert";
import { act, createDoc } from "./drive";
import { normalise } from "./live";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Images in a document point at its assets by URL; this finds the asset id in one. */
export const assetIdOf = (src: string) => src.match(/(?:^asset:|\/documents\/assets\/)([0-9a-f-]{36})/i)?.[1] ?? null;
export const assetPath = (orgId: string, id: string) => `/api/v1/orgs/${orgId}/documents/assets/${id}`;

const safeName = (t: string) => t.replace(/[^\w\- .()]+/g, "").trim().slice(0, 120) || "document";

function sniffImage(b: Buffer) {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function addAsset(s: Scope, fileId: string, file: { name: string; bytes: Buffer }) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this document, but not change it");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new ApiError("payload_too_large", "Images are limited to 8 MB");
  const mime = sniffImage(file.bytes);
  if (!mime) throw new ApiError("validation_failed", "Add a PNG, JPEG, GIF or WebP image");
  const [[files], [images]] = await Promise.all([
    db.select({ n: sql<number>`coalesce(sum(${schema.docVersions.size}), 0)::bigint` }).from(schema.docVersions).where(eq(schema.docVersions.orgId, s.orgId)),
    db.select({ n: sql<number>`coalesce(sum(${schema.docAssets.size}), 0)::bigint` }).from(schema.docAssets).where(eq(schema.docAssets.orgId, s.orgId)),
  ]);
  if (Number(files!.n) + Number(images!.n) + file.bytes.length > MAX_ORG_BYTES) throw new ApiError("conflict", "Your workspace has used its document storage. Delete old files or versions first.");
  const [row] = await db.insert(schema.docAssets).values({ orgId: s.orgId, fileId: f.id, mime, size: file.bytes.length, data: file.bytes, createdBy: s.userId }).returning({ id: schema.docAssets.id });
  return { id: row!.id, src: assetPath(s.orgId, row!.id) };
}

/** An image's bytes, for someone who can open the document it's in. */
export async function getAsset(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Image");
  const [a] = await db.select().from(schema.docAssets).where(and(eq(schema.docAssets.id, id), eq(schema.docAssets.orgId, s.orgId)));
  if (!a) throw notFound("Image");
  await getFileAs(s, a.fileId);
  return a;
}

export function assetResponse(a: { data: Buffer; mime: string; id: string }) {
  return new Response(new Uint8Array(a.data), { headers: { "Content-Type": a.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", ETag: `"${a.id}"` } });
}

/** Loads a document's own images for exports (anything else — outside links — is left out). */
const imagesOf = (fileId: string) => async (src: string) => {
  const id = assetIdOf(src);
  if (!id) return null;
  const [a] = await db.select({ data: schema.docAssets.data, mime: schema.docAssets.mime }).from(schema.docAssets).where(and(eq(schema.docAssets.id, id), eq(schema.docAssets.fileId, fileId)));
  return a ?? null;
};

export const FORMATS = ["pdf", "docx", "md", "html", "txt"] as const;
export type Format = (typeof FORMATS)[number];

export async function render(f: typeof schema.docFiles.$inferSelect, format: Format, o: { assetUrl?: (id: string) => string } = {}) {
  const doc = (f.content as PMNode) ?? { type: "doc", content: [] };
  const page = pageOf(f.page);
  const name = safeName(f.title);
  switch (format) {
    case "pdf":
      return { data: Buffer.from(await toPdf(doc, { title: f.title, page, images: imagesOf(f.id) })), mime: "application/pdf", filename: `${name}.pdf` };
    case "docx":
      return { data: await toDocx(doc, { title: f.title, page, images: imagesOf(f.id) }), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: `${name}.docx` };
    case "md":
      return { data: Buffer.from(toMarkdown(doc, f.title)), mime: "text/markdown; charset=utf-8", filename: `${name}.md` };
    case "html":
      return { data: Buffer.from(toHtml(doc, { title: f.title, page, standalone: true, assetUrl: o.assetUrl })), mime: "text/html; charset=utf-8", filename: `${name}.html` };
    case "txt": {
      const { textOf } = await import("@/lib/documents/write");
      return { data: Buffer.from(`${f.title}\n\n${textOf(doc)}`), mime: "text/plain; charset=utf-8", filename: `${name}.txt` };
    }
  }
}

export async function exportDoc(s: Scope, id: string, raw: string | undefined, inline = false) {
  const { file: f } = await getFileAs(s, id);
  if (f.kind !== "doc") throw new ApiError("conflict", "Download uploaded files as they are");
  const format = check(z.enum(FORMATS), raw ?? "pdf");
  // Exports carry what's been saved; editors save every few seconds while you type.
  const out = await render(f, format, { assetUrl: (aid) => assetPath(s.orgId, aid) });
  await act(s, "exported", { fileId: f.id }, { format });
  const show = inline && format === "pdf";
  return new Response(new Uint8Array(out.data), {
    headers: { "Content-Type": out.mime, "Content-Disposition": `${show ? "inline" : "attachment"}; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...(format === "html" ? { "Content-Security-Policy": "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; sandbox" } : {}) },
  });
}

/** A Word, Markdown, HTML or text file as a new written document. */
export async function importDoc(s: Scope, file: { name: string; bytes: Buffer }, meta: unknown) {
  if (file.bytes.length > 20 * 1024 * 1024) throw new ApiError("payload_too_large", "Files to convert are limited to 20 MB");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  let content: PMNode;
  try {
    if (ext === "docx") content = await fromDocx(file.bytes);
    else if (ext === "md" || ext === "markdown") content = fromMarkdown(file.bytes.toString("utf8"));
    else if (ext === "html" || ext === "htm") content = fromHtml(file.bytes.toString("utf8"));
    else if (ext === "txt") content = fromText(file.bytes.toString("utf8"));
    else throw new ApiError("validation_failed", "Bring in a Word (.docx), Markdown, HTML or text file");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("validation_failed", e instanceof Error ? e.message : "That file couldn't be read");
  }
  const m = (meta ?? {}) as Record<string, unknown>;
  return createDoc(s, { ...m, title: String(m.title ?? "") || file.name.replace(/\.[^.]+$/, "").slice(0, 200), content: normalise(content) });
}

/** The document as a PDF in the drive (next to it), ready to send for signature. */
export async function pdfCopy(s: Scope, id: string) {
  const { file: f, role } = await getFileAs(s, id);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this document, but not change it");
  if (f.kind !== "doc") throw new ApiError("conflict", "This is already a file");
  const out = await render(f, "pdf");
  const sha256 = createHash("sha256").update(out.data).digest("hex");
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.docFiles).values({ orgId: s.orgId, kind: "file", title: f.title, folderId: f.folderId, access: f.access, status: "final", tags: f.tags, linkType: f.linkType, linkId: f.linkId, notes: `Made from the document “${f.title}”.`, createdBy: s.userId, lastEditedBy: s.userId }).returning();
    await tx.insert(schema.docVersions).values({ orgId: s.orgId, fileId: c!.id, version: 1, filename: out.filename, mime: out.mime, size: out.data.length, sha256, data: out.data, createdBy: s.userId });
    return c!;
  });
  await act(s, "pdf_made", { fileId: f.id }, { pdf: row.id });
  return { fileId: row.id, title: row.title };
}
