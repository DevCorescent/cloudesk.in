import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import type { Permission } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { enforceBrand } from "./brand";
import type { Tx } from "./orgs";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES_PER_PROJECT = 2000;

type Source = "user" | "ai" | "template" | "system" | "restore";
type Author = { userId: string | null; source: Source; aiTaskId?: string | null; message?: string; /** Set by co-editing's own save; any other write resets the shared document. */ keepCodoc?: boolean };

/** Drops the live co-editing document for a path; open editors reload. */
async function resetCodoc(tx: Tx, projectId: string, path: string) {
  const gone = await tx.delete(schema.codocs).where(and(eq(schema.codocs.projectId, projectId), eq(schema.codocs.path, path))).returning({ id: schema.codocs.id });
  // Wakes open editors' streams (delivered when the transaction commits).
  for (const g of gone) await tx.execute(sql`select pg_notify('codoc', ${g.id})`);
}

/** Normalizes and validates a project-relative path. Rejects traversal. */
export function normalizePath(input: string): string {
  const p = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.length > 200) throw new ApiError("validation_failed", "Path must be 1–200 characters", { path: ["Invalid length"] });
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || !/^[A-Za-z0-9._@-]+$/.test(s))) {
    throw new ApiError("validation_failed", "Paths may contain letters, numbers, dots, dashes and underscores", { path: ["Invalid path"] });
  }
  return parts.join("/");
}

/** Editing the design document is a design permission; anything else is code. */
export function permissionForPath(path: string): Permission {
  return path === SITE_DOC_PATH ? "design:write" : "code:write";
}

function validateContent(path: string, content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "Files are limited to 1 MB");
  if (path === SITE_DOC_PATH) {
    const r = parseSiteDoc(content);
    if (!r.ok) throw new ApiError("validation_failed", "The site document is invalid. Fix the problems listed and save again.", { problems: r.errors.slice(0, 50) });
  }
}

export async function listFiles(projectId: string) {
  return db
    .select({ id: schema.projectFiles.id, path: schema.projectFiles.path, revision: schema.projectFiles.revision, updatedAt: schema.projectFiles.updatedAt })
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId))
    .orderBy(asc(schema.projectFiles.path));
}

export async function readFile(projectId: string, path: string) {
  const [f] = await db
    .select()
    .from(schema.projectFiles)
    .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, normalizePath(path))));
  if (!f) throw notFound("File");
  return f;
}

export async function readAllFiles(projectId: string) {
  return db.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId)).orderBy(asc(schema.projectFiles.path));
}

async function touchProject(exec: Tx, projectId: string) {
  await exec.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
}

export async function createFile(projectId: string, rawPath: string, content: string, author: Author, exec?: Tx) {
  const path = normalizePath(rawPath);
  validateContent(path, content);
  const run = async (tx: Tx) => {
    const existing = await tx.select({ id: schema.projectFiles.id }).from(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId));
    if (existing.length >= MAX_FILES_PER_PROJECT) throw new ApiError("conflict", "This project has reached its file limit");
    const [f] = await tx
      .insert(schema.projectFiles)
      .values({ projectId, path, content, revision: 1, updatedBy: author.userId })
      .onConflictDoNothing()
      .returning();
    if (!f) throw new ApiError("conflict", `A file already exists at ${path}`);
    await tx.insert(schema.fileRevisions).values({ projectId, path, revision: 1, content, source: author.source, authorId: author.userId, aiTaskId: author.aiTaskId ?? null, message: author.message });
    await touchProject(tx, projectId);
    return f;
  };
  return exec ? run(exec) : db.transaction(run);
}

/**
 * Optimistic-concurrency write. The caller must send the revision it last
 * read; if someone (a person or an AI task) saved in between, the write is
 * rejected with revision_conflict instead of silently overwriting.
 */
export async function writeFile(projectId: string, rawPath: string, content: string, baseRevision: number, author: Author, exec?: Tx) {
  const path = normalizePath(rawPath);
  validateContent(path, content);
  const run = async (tx: Tx) => {
    const [current] = await tx
      .select()
      .from(schema.projectFiles)
      .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
      .for("update");
    if (!current) throw notFound("File");
    if (current.revision !== baseRevision) {
      throw new ApiError("revision_conflict", "This file changed since you opened it. Review the latest version before saving.", {
        path,
        currentRevision: current.revision,
        baseRevision,
      });
    }
    if (current.content === content) return current;
    if (path === SITE_DOC_PATH) await enforceBrand(projectId, current.content, content, author.source, tx);
    const revision = current.revision + 1;
    const [f] = await tx
      .update(schema.projectFiles)
      .set({ content, revision, updatedBy: author.userId, updatedAt: new Date() })
      .where(eq(schema.projectFiles.id, current.id))
      .returning();
    await tx.insert(schema.fileRevisions).values({ projectId, path, revision, content, source: author.source, authorId: author.userId, aiTaskId: author.aiTaskId ?? null, message: author.message });
    if (!author.keepCodoc) await resetCodoc(tx, projectId, path);
    await touchProject(tx, projectId);
    return f;
  };
  return exec ? run(exec) : db.transaction(run);
}

export async function deleteFile(projectId: string, rawPath: string, baseRevision: number, author: Author, exec?: Tx) {
  const path = normalizePath(rawPath);
  if (path === SITE_DOC_PATH) throw new ApiError("conflict", "The site document cannot be deleted");
  const run = async (tx: Tx) => {
    const [current] = await tx
      .select()
      .from(schema.projectFiles)
      .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, path)))
      .for("update");
    if (!current) throw notFound("File");
    if (current.revision !== baseRevision) {
      throw new ApiError("revision_conflict", "This file changed since you opened it.", { path, currentRevision: current.revision, baseRevision });
    }
    await tx.delete(schema.projectFiles).where(eq(schema.projectFiles.id, current.id));
    await tx.insert(schema.fileRevisions).values({ projectId, path, revision: current.revision + 1, content: null, source: author.source, authorId: author.userId, aiTaskId: author.aiTaskId ?? null, message: author.message ?? "Deleted" });
    await resetCodoc(tx, projectId, path);
    await touchProject(tx, projectId);
  };
  return exec ? run(exec) : db.transaction(run);
}

export async function renameFile(projectId: string, fromPath: string, toPath: string, baseRevision: number, author: Author) {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (from === SITE_DOC_PATH || to === SITE_DOC_PATH) throw new ApiError("conflict", "The site document cannot be renamed");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.projectFiles)
      .where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, from)))
      .for("update");
    if (!current) throw notFound("File");
    if (current.revision !== baseRevision) throw new ApiError("revision_conflict", "This file changed since you opened it.", { path: from });
    const created = await createFile(projectId, to, current.content, { ...author, message: `Renamed from ${from}` }, tx);
    await tx.delete(schema.projectFiles).where(eq(schema.projectFiles.id, current.id));
    await tx.insert(schema.fileRevisions).values({ projectId, path: from, revision: current.revision + 1, content: null, source: author.source, authorId: author.userId, message: `Renamed to ${to}` });
    await resetCodoc(tx, projectId, from);
    return created;
  });
}

export async function fileHistory(projectId: string, rawPath: string, limit = 100) {
  const path = normalizePath(rawPath);
  return db
    .select({
      revision: schema.fileRevisions.revision,
      source: schema.fileRevisions.source,
      message: schema.fileRevisions.message,
      aiTaskId: schema.fileRevisions.aiTaskId,
      createdAt: schema.fileRevisions.createdAt,
      authorName: schema.users.name,
      deleted: schema.fileRevisions.content,
    })
    .from(schema.fileRevisions)
    .leftJoin(schema.users, eq(schema.users.id, schema.fileRevisions.authorId))
    .where(and(eq(schema.fileRevisions.projectId, projectId), eq(schema.fileRevisions.path, path)))
    .orderBy(desc(schema.fileRevisions.revision))
    .limit(limit)
    .then((rows) => rows.map(({ deleted, ...r }) => ({ ...r, deleted: deleted === null })));
}

export async function readRevision(projectId: string, rawPath: string, revision: number) {
  const path = normalizePath(rawPath);
  const [r] = await db
    .select()
    .from(schema.fileRevisions)
    .where(and(eq(schema.fileRevisions.projectId, projectId), eq(schema.fileRevisions.path, path), eq(schema.fileRevisions.revision, revision)));
  if (!r || r.content === null) throw notFound("Revision");
  return r;
}

export async function restoreRevision(projectId: string, rawPath: string, revision: number, baseRevision: number, userId: string) {
  const r = await readRevision(projectId, rawPath, revision);
  return writeFile(projectId, rawPath, r.content!, baseRevision, { userId, source: "restore", message: `Restored revision ${revision}` });
}
