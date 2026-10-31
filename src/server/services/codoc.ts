// Real-time co-editing of project files. Each open file gets a shared Yjs
// document; clients exchange updates through Postgres (any server instance can
// relay them) and see each other's cursors via awareness messages. Saving
// writes the merged text through the normal revisioned file path. A write from
// anywhere else (builder, AI, restore) resets the shared document.
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { MAX_FILE_BYTES, normalizePath, readFile, writeFile } from "./files";

export const MAX_UPDATE_BYTES = 512 * 1024;
const COMPACT_AFTER = 400;
const AWARENESS_TTL_MS = 60_000;

type Codoc = typeof schema.codocs.$inferSelect;

/** Opens (creating if needed) the shared document for a file. */
export async function openCodoc(projectId: string, rawPath: string): Promise<{ doc: Codoc; state: Uint8Array; seq: number }> {
  const path = normalizePath(rawPath);
  let [doc] = await db.select().from(schema.codocs).where(and(eq(schema.codocs.projectId, projectId), eq(schema.codocs.path, path)));
  if (!doc) {
    const file = await readFile(projectId, path);
    // Created in one transaction with its initial text, so concurrent openers
    // never see an empty document and never insert the text twice.
    doc = await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.codocs).values({ projectId, path, baseRevision: file.revision }).onConflictDoNothing().returning();
      if (!created) return (await tx.select().from(schema.codocs).where(and(eq(schema.codocs.projectId, projectId), eq(schema.codocs.path, path))))[0];
      const y = new Y.Doc();
      y.getText("content").insert(0, file.content);
      await tx.insert(schema.codocUpdates).values({ docId: created.id, kind: "doc", clientId: "server", update: Buffer.from(Y.encodeStateAsUpdate(y)) });
      return created;
    });
  }
  const rows = await db.select({ seq: schema.codocUpdates.seq, update: schema.codocUpdates.update }).from(schema.codocUpdates).where(and(eq(schema.codocUpdates.docId, doc.id), eq(schema.codocUpdates.kind, "doc"))).orderBy(asc(schema.codocUpdates.seq));
  const [last] = await db.select({ seq: sql<number>`coalesce(max(${schema.codocUpdates.seq}), 0)::bigint` }).from(schema.codocUpdates).where(eq(schema.codocUpdates.docId, doc.id));
  if (rows.length > COMPACT_AFTER) await compact(doc.id);
  return { doc, state: rows.length ? Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update))) : new Uint8Array(), seq: Number(last.seq) };
}

async function compact(docId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${docId}))`);
    const rows = await tx.select().from(schema.codocUpdates).where(and(eq(schema.codocUpdates.docId, docId), eq(schema.codocUpdates.kind, "doc"))).orderBy(asc(schema.codocUpdates.seq));
    if (rows.length <= COMPACT_AFTER) return;
    const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)));
    const maxSeq = rows.at(-1)!.seq;
    await tx.delete(schema.codocUpdates).where(and(eq(schema.codocUpdates.docId, docId), eq(schema.codocUpdates.kind, "doc"), sql`${schema.codocUpdates.seq} <= ${maxSeq}`));
    // Re-inserted with a new seq; clients that already applied the parts ignore duplicates (Yjs updates are idempotent).
    await tx.insert(schema.codocUpdates).values({ docId, kind: "doc", clientId: "server", update: Buffer.from(merged) });
  });
}

export async function getCodoc(projectId: string, docId: string) {
  const [doc] = await db.select().from(schema.codocs).where(and(eq(schema.codocs.id, docId), eq(schema.codocs.projectId, projectId)));
  return doc ?? null;
}

export async function pushUpdate(doc: Codoc, kind: "doc" | "awareness", clientId: string, userId: string, update: Uint8Array) {
  if (update.byteLength > MAX_UPDATE_BYTES) throw new ApiError("payload_too_large", "Update too large");
  if (kind === "doc") {
    // Reject malformed updates before they reach other clients.
    try {
      Y.decodeUpdate(update);
    } catch {
      throw new ApiError("validation_failed", "Invalid update");
    }
  }
  const [row] = await db.insert(schema.codocUpdates).values({ docId: doc.id, kind, clientId: clientId.slice(0, 40), userId, update: Buffer.from(update) }).returning({ seq: schema.codocUpdates.seq });
  if (kind === "awareness" && row.seq % 50 === 0) await db.delete(schema.codocUpdates).where(and(eq(schema.codocUpdates.docId, doc.id), eq(schema.codocUpdates.kind, "awareness"), lt(schema.codocUpdates.createdAt, new Date(Date.now() - AWARENESS_TTL_MS))));
  return row.seq;
}

export async function updatesSince(docId: string, seq: number, limit = 200) {
  return db
    .select({ seq: schema.codocUpdates.seq, kind: schema.codocUpdates.kind, clientId: schema.codocUpdates.clientId, update: schema.codocUpdates.update, createdAt: schema.codocUpdates.createdAt })
    .from(schema.codocUpdates)
    .where(and(eq(schema.codocUpdates.docId, docId), gt(schema.codocUpdates.seq, seq)))
    .orderBy(asc(schema.codocUpdates.seq))
    .limit(limit);
}

/** Writes the shared text as a new file revision and tells the other editors. */
export async function saveCodoc(projectId: string, docId: string, userId: string) {
  const doc = await getCodoc(projectId, docId);
  if (!doc) throw new ApiError("conflict", "This file was changed elsewhere. Reload to see the latest version.", { reset: true });
  const rows = await db.select({ update: schema.codocUpdates.update }).from(schema.codocUpdates).where(and(eq(schema.codocUpdates.docId, doc.id), eq(schema.codocUpdates.kind, "doc"))).orderBy(asc(schema.codocUpdates.seq));
  const y = new Y.Doc();
  Y.applyUpdate(y, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update))));
  const content = y.getText("content").toString();
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "Files are limited to 1 MB");
  const f = await writeFile(projectId, doc.path, content, doc.baseRevision, { userId, source: "user", keepCodoc: true });
  if (f.revision !== doc.baseRevision) {
    await db.update(schema.codocs).set({ baseRevision: f.revision }).where(eq(schema.codocs.id, doc.id));
    await db.insert(schema.codocUpdates).values({ docId: doc.id, kind: "saved", clientId: "server", userId, update: Buffer.from(String(f.revision)) });
  }
  return { revision: f.revision, content };
}

export function notFoundDoc() {
  return notFound("Shared document");
}
