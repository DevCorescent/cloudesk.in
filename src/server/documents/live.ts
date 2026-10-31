// Co-editing a written document. The shared copy is a Yjs document built from
// the saved content the first time anyone opens it; edits and cursors go
// through Postgres (any server instance relays them, see codoc-bus) and
// everyone's browser merges them. Editors save the merged document back as the
// file's content every few seconds, and a version is kept every ten minutes of
// editing. Restoring a version or replacing the content starts the shared copy
// again, and everyone's editor reloads.
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db, schema } from "@/db";
import { docExtensions } from "@/lib/documents/extensions";
import { emptyDoc, mentionsIn, textOf, wordsIn, type PMNode } from "@/lib/documents/write";
import { ApiError } from "../http/errors";
import { notify } from "../notify/notify";
import { appUrl } from "../services/mail";
import { getFileAs, type Scope } from "./access";
import { act } from "./drive";

const U = schema.docLiveUpdates;
export const MAX_UPDATE_BYTES = 768 * 1024;
const COMPACT_AFTER = 300;
const AWARENESS_TTL_MS = 60_000;
/** A version is kept when the last one is this old and the document has changed since. */
const VERSION_EVERY_MS = 10 * 60_000;
export const DOC_MIME = "application/vnd.cloudesk.doc+json";
const FIELD = "default";

let cached: ReturnType<typeof getSchema> | null = null;
export const pmSchema = () => (cached ??= getSchema(docExtensions()));

/** The editor JSON as a Yjs update (unknown nodes are dropped, so the schema always holds). */
export function seedUpdate(content: PMNode) {
  let doc: Y.Doc;
  try {
    doc = prosemirrorJSONToYDoc(pmSchema(), content, FIELD);
  } catch {
    // Content that doesn't fit the schema (an old import, a hand-made API call) starts clean rather than failing.
    doc = prosemirrorJSONToYDoc(pmSchema(), emptyDoc(), FIELD);
  }
  return Y.encodeStateAsUpdate(doc);
}

/** Checked, normalised editor JSON: parsed against the schema (dropping what doesn't fit). */
export function normalise(content: PMNode): PMNode {
  try {
    return pmSchema().nodeFromJSON(content).toJSON() as PMNode;
  } catch {
    return emptyDoc();
  }
}

async function docUpdates(fileId: string) {
  return db.select({ seq: U.seq, update: U.update }).from(U).where(and(eq(U.fileId, fileId), eq(U.kind, "doc"))).orderBy(asc(U.seq));
}

/** The shared copy (seeding it from the saved content if this is the first open), for the editor to start from. */
export async function openLive(s: Scope, fileId: string) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (f.kind !== "doc") throw new ApiError("conflict", "Only written documents are edited here");
  let rows = await docUpdates(f.id);
  if (!rows.length) {
    await db.transaction(async (tx) => {
      // One opener seeds it; anyone racing waits on the lock and then finds it seeded.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`doclive:${f.id}`}))`);
      const [any] = await tx.select({ seq: U.seq }).from(U).where(and(eq(U.fileId, f.id), eq(U.kind, "doc"))).limit(1);
      if (!any) await tx.insert(U).values({ fileId: f.id, kind: "doc", clientId: "server", update: Buffer.from(seedUpdate((f.content as PMNode) ?? emptyDoc())) });
    });
    rows = await docUpdates(f.id);
  }
  if (rows.length > COMPACT_AFTER) await compact(f.id);
  const [last] = await db.select({ seq: sql<number>`coalesce(max(${U.seq}), 0)::bigint` }).from(U).where(eq(U.fileId, f.id));
  return { state: Buffer.from(Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)))).toString("base64"), seq: Number(last!.seq), role };
}

async function compact(fileId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`doclive:${fileId}`}))`);
    const rows = await tx.select().from(U).where(and(eq(U.fileId, fileId), eq(U.kind, "doc"))).orderBy(asc(U.seq));
    if (rows.length <= COMPACT_AFTER) return;
    const merged = Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update)));
    await tx.delete(U).where(and(eq(U.fileId, fileId), eq(U.kind, "doc"), sql`${U.seq} <= ${rows.at(-1)!.seq}`));
    // A new seq; editors that already have the parts ignore the repeat (Yjs updates are idempotent).
    await tx.insert(U).values({ fileId, kind: "doc", clientId: "server", update: Buffer.from(merged) });
  });
}

export async function pushLive(s: Scope, fileId: string, kind: "doc" | "awareness", clientId: string, update: Uint8Array) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (kind === "doc" && role !== "edit") throw new ApiError("forbidden", "You can open this document, but not change it");
  if (update.byteLength > MAX_UPDATE_BYTES) throw new ApiError("payload_too_large", "That change is too large. Paste less at once, or add images one by one.");
  if (kind === "doc") {
    try {
      Y.decodeUpdate(update);
    } catch {
      throw new ApiError("validation_failed", "Invalid update");
    }
  }
  const [row] = await db.insert(U).values({ fileId: f.id, kind, clientId: clientId.slice(0, 40), userId: s.userId, update: Buffer.from(update) }).returning({ seq: U.seq });
  if (kind === "awareness" && row!.seq % 40 === 0) await db.delete(U).where(and(eq(U.fileId, f.id), eq(U.kind, "awareness"), lt(U.createdAt, new Date(Date.now() - AWARENESS_TTL_MS))));
  await db.execute(sql`select pg_notify('codoc', ${f.id})`);
  return row!.seq;
}

export async function liveSince(fileId: string, seq: number, limit = 200) {
  return db.select({ seq: U.seq, kind: U.kind, clientId: U.clientId, update: U.update, createdAt: U.createdAt }).from(U).where(and(eq(U.fileId, fileId), gt(U.seq, seq))).orderBy(asc(U.seq)).limit(limit);
}

/** The shared copy as editor JSON. */
async function merged(fileId: string) {
  const rows = await docUpdates(fileId);
  if (!rows.length) return null;
  const y = new Y.Doc();
  Y.applyUpdate(y, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.update))));
  return yXmlFragmentToProsemirrorJSON(y.getXmlFragment(FIELD)) as PMNode;
}

/**
 * Writes the shared copy back as the document's content (and its text, words),
 * keeps a version every ten minutes of editing, and tells anyone newly
 * @mentioned. Any editor can call it; it's a no-op when nothing changed.
 */
export async function saveLive(s: Scope, fileId: string, opts: { name?: string } = {}) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this document, but not change it");
  const content = await merged(f.id);
  if (!content) return { saved: false, version: f.version };
  const before = JSON.stringify(f.content ?? null);
  const now = JSON.stringify(content);
  const changed = before !== now;
  const text = textOf(content);
  if (changed) await db.update(schema.docFiles).set({ content: content as Record<string, unknown>, bodyText: text, words: wordsIn(text), updatedAt: new Date(), lastEditedBy: s.userId }).where(eq(schema.docFiles.id, f.id));
  // A version: asked for by name, or every ten minutes of changes.
  const [last] = await db.select({ createdAt: schema.docVersions.createdAt, sha256: schema.docVersions.sha256 }).from(schema.docVersions).where(eq(schema.docVersions.fileId, f.id)).orderBy(desc(schema.docVersions.version)).limit(1);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(now).digest("hex");
  let version = f.version;
  if ((opts.name || (changed && (!last || Date.now() - last.createdAt.getTime() > VERSION_EVERY_MS))) && last?.sha256 !== sha) version = await keepVersion(s, f.id, content, opts.name ?? "");
  else if (opts.name && last?.sha256 === sha) {
    // Naming the version you're on.
    await db.update(schema.docVersions).set({ note: opts.name.slice(0, 120) }).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, f.version)));
  }
  if (changed) await tellMentioned(s, f, (f.content as PMNode) ?? null, content);
  return { saved: changed, version, words: wordsIn(text) };
}

export async function keepVersion(s: Pick<Scope, "orgId" | "userId">, fileId: string, content: PMNode, name: string) {
  const json = Buffer.from(JSON.stringify(content));
  const { createHash } = await import("node:crypto");
  return db.transaction(async (tx) => {
    const [row] = await tx.update(schema.docFiles).set({ version: sql`${schema.docFiles.version} + 1` }).where(eq(schema.docFiles.id, fileId)).returning({ version: schema.docFiles.version, title: schema.docFiles.title });
    await tx.insert(schema.docVersions).values({ orgId: s.orgId, fileId, version: row!.version, filename: `${row!.title.replace(/[^\w\- .()]+/g, "").slice(0, 100) || "document"}.json`, mime: DOC_MIME, size: json.length, sha256: createHash("sha256").update(json).digest("hex"), data: json, note: name.slice(0, 120), createdBy: s.userId });
    return row!.version;
  });
}

async function tellMentioned(s: Scope, f: typeof schema.docFiles.$inferSelect, before: PMNode | null, after: PMNode) {
  const had = new Set(mentionsIn(before));
  const added = mentionsIn(after).filter((id) => !had.has(id) && id !== s.userId);
  if (!added.length) return;
  const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
  const link = `/documents/d/${f.id}`;
  // Only people who can open it hear about it.
  const { openFolders, roleFor } = await import("./access");
  for (const uid of added) {
    const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, uid)));
    if (!m) continue;
    const { can } = await import("../authz/permissions");
    const as = { orgId: s.orgId, userId: uid, manage: can(m.role as never, "doc:manage"), write: can(m.role as never, "doc:write") };
    if (!roleFor(as, f, await openFolders(as))) continue;
    await notify(s.orgId, [uid], { kind: "documents.mention", title: `${me?.name ?? "Someone"} mentioned you in “${f.title}”`, link, values: { who: me?.name ?? "Someone", title: f.title, text: "", link: appUrl(link) } });
  }
}

/** Replaces the content (restoring a version, an import): the shared copy starts again and open editors reload. */
export async function replaceContent(s: Scope, fileId: string, content: PMNode, why: string) {
  const clean = normalise(content);
  const text = textOf(clean);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`doclive:${fileId}`}))`);
    await tx.update(schema.docFiles).set({ content: clean as Record<string, unknown>, bodyText: text, words: wordsIn(text), updatedAt: new Date(), lastEditedBy: s.userId }).where(eq(schema.docFiles.id, fileId));
    await tx.delete(U).where(eq(U.fileId, fileId));
    await tx.insert(U).values({ fileId, kind: "doc", clientId: "server", update: Buffer.from(seedUpdate(clean)) });
    await tx.insert(U).values({ fileId, kind: "reset", clientId: "server", userId: s.userId, update: Buffer.from(why) });
  });
  await db.execute(sql`select pg_notify('codoc', ${fileId})`);
}

// ── Versions ────────────────────────────────────────────────────────────────

export async function docVersions(s: Scope, fileId: string) {
  const { file: f } = await getFileAs(s, fileId);
  return db
    .select({ version: schema.docVersions.version, note: schema.docVersions.note, size: schema.docVersions.size, createdAt: schema.docVersions.createdAt, by: schema.users.name })
    .from(schema.docVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.docVersions.createdBy))
    .where(eq(schema.docVersions.fileId, f.id))
    .orderBy(desc(schema.docVersions.version))
    .limit(200)
    .then((rows) => rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), by: r.by ?? "Someone" })));
}

export async function versionContent(s: Scope, fileId: string, version: number) {
  const { file: f } = await getFileAs(s, fileId);
  const [v] = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, version)));
  if (!v || v.mime !== DOC_MIME) throw new ApiError("not_found", "That version isn't there");
  return JSON.parse(v.data.toString()) as PMNode;
}

export async function restoreVersion(s: Scope, fileId: string, version: number) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this document, but not change it");
  // Today's text is kept as a version first, so restoring never loses anything.
  const current = await merged(f.id);
  if (current) await keepVersion(s, f.id, current, `Before restoring version ${version}`);
  const content = await versionContent(s, f.id, version);
  await replaceContent(s, f.id, content, `Restored version ${version}`);
  await act(s, "restored_version", { fileId: f.id }, { version });
  return { ok: true };
}
