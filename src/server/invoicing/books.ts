// Where invoicing data lives: a project's books, or a standalone finance
// book that belongs to the workspace (for people who just want invoicing and
// their financials, with no website or store). Both share every invoicing
// feature; the owner id is the project's id or the book's id.
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, requireProject, type AuthedContext } from "../http/handler";
import { MAX_ASSET_BYTES, uploadAsset } from "../media/assets";
import { sniffImage } from "../media/images";
import { audit } from "../services/audit";

export type InvoicingScope = {
  /** Owner id used by every invoicing table. */
  id: string;
  kind: "project" | "book";
  orgId: string;
  role: Role;
  name: string;
  project?: typeof schema.projects.$inferSelect;
};

async function ensureOwner(id: string, ref: { projectId?: string; bookId?: string }) {
  await db.insert(schema.invoiceOwners).values({ id, projectId: ref.projectId ?? null, bookId: ref.bookId ?? null }).onConflictDoNothing();
}

export async function projectScope(ctx: AuthedContext, projectId: string, permission: "invoices:manage" = "invoices:manage"): Promise<InvoicingScope> {
  const { project, role } = await requireProject(ctx, projectId, permission);
  await ensureOwner(project.id, { projectId: project.id });
  return { id: project.id, kind: "project", orgId: project.orgId, role, name: project.name, project };
}

export async function bookScope(ctx: AuthedContext, bookId: string): Promise<InvoicingScope> {
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) throw notFound("Books");
  const [b] = await db.select().from(schema.financeBooks).where(eq(schema.financeBooks.id, bookId));
  if (!b) throw notFound("Books");
  // Not a member → same answer as a missing book.
  const { role } = await requireOrg(ctx, b.orgId, "invoices:manage").catch((e: ApiError) => {
    throw e.code === "forbidden" ? e : notFound("Books");
  });
  return { id: b.id, kind: "book", orgId: b.orgId, role, name: b.name };
}

// ── Books ───────────────────────────────────────────────────────────────────

export async function listBooks(orgId: string) {
  const rows = await db.select().from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId)).orderBy(asc(schema.financeBooks.createdAt));
  if (!rows.length) return [];
  const stats = await db
    .select({ owner: schema.invoiceDocuments.projectId, open: sql<number>`coalesce(sum(case when ${schema.invoiceDocuments.type} = 'invoice' and ${schema.invoiceDocuments.status} in ('sent','viewed','partial') then ${schema.invoiceDocuments.total} - ${schema.invoiceDocuments.amountPaid} else 0 end),0)::bigint`, docs: sql<number>`count(*)::int` })
    .from(schema.invoiceDocuments)
    .where(sql`${schema.invoiceDocuments.projectId} in ${rows.map((r) => r.id)}`)
    .groupBy(schema.invoiceDocuments.projectId);
  const by = new Map(stats.map((s) => [s.owner, s]));
  const settings = await db.select({ owner: schema.invoiceSettings.projectId, currency: sql<string>`${schema.invoiceSettings.data}->>'currency'` }).from(schema.invoiceSettings).where(sql`${schema.invoiceSettings.projectId} in ${rows.map((r) => r.id)}`);
  const cur = new Map(settings.map((s) => [s.owner, s.currency]));
  return rows.map((r) => ({ ...r, currency: cur.get(r.id) || "INR", documents: by.get(r.id)?.docs ?? 0, outstanding: Number(by.get(r.id)?.open ?? 0) }));
}

export async function createBook(orgId: string, userId: string, name: string) {
  const count = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId)))[0].n;
  if (count >= 20) throw new ApiError("conflict", "A workspace can keep up to 20 sets of books");
  const [b] = await db.insert(schema.financeBooks).values({ orgId, name: name.trim().slice(0, 80) || "My business", createdBy: userId }).returning();
  await ensureOwner(b.id, { bookId: b.id });
  await audit({ orgId, actorId: userId, action: "finance.book_created", targetType: "finance_book", targetId: b.id, metadata: { name: b.name } });
  return b;
}

export async function renameBook(scope: InvoicingScope, name: string) {
  if (scope.kind !== "book") throw notFound("Books");
  const [b] = await db.update(schema.financeBooks).set({ name: name.trim().slice(0, 80) || "My business" }).where(eq(schema.financeBooks.id, scope.id)).returning();
  return b;
}

/** Permanently deletes the books and everything in them (owners and admins only). */
export async function deleteBook(scope: InvoicingScope, userId: string) {
  if (scope.kind !== "book") throw notFound("Books");
  if (scope.role !== "owner" && scope.role !== "admin") throw new ApiError("forbidden", "Only workspace owners and admins can delete a set of books");
  await db.delete(schema.financeBooks).where(eq(schema.financeBooks.id, scope.id));
  await audit({ orgId: scope.orgId, actorId: userId, action: "finance.book_deleted", targetType: "finance_book", targetId: scope.id, metadata: { name: scope.name } });
}

// ── Images (logos, signatures) ──────────────────────────────────────────────

export async function uploadImage(scope: InvoicingScope, userId: string, file: { name: string; bytes: Buffer }) {
  if (scope.project) return uploadAsset(scope.project, userId, file);
  if (!file.bytes.length) throw new ApiError("validation_failed", "The file is empty");
  if (file.bytes.length > MAX_ASSET_BYTES) throw new ApiError("payload_too_large", "Images are limited to 5 MB");
  const info = sniffImage(file.bytes);
  if (!info) throw new ApiError("validation_failed", "Upload a PNG, JPEG, WebP or GIF image");
  const used = (await db.select({ n: sql<number>`coalesce(sum(${schema.financeFiles.size}),0)::bigint` }).from(schema.financeFiles).where(eq(schema.financeFiles.bookId, scope.id)))[0].n;
  if (Number(used) + file.bytes.length > 50 * 1024 * 1024) throw new ApiError("conflict", "These books have reached their 50 MB image limit");
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const [existing] = await db.select({ id: schema.financeFiles.id }).from(schema.financeFiles).where(and(eq(schema.financeFiles.bookId, scope.id), eq(schema.financeFiles.sha256, sha256)));
  if (existing) return { id: existing.id, url: `/f/${existing.id}`, duplicate: true };
  const [f] = await db.insert(schema.financeFiles).values({ bookId: scope.id, mime: info.mime, size: file.bytes.length, sha256, data: file.bytes, createdBy: userId }).returning({ id: schema.financeFiles.id });
  return { id: f.id, url: `/f/${f.id}`, duplicate: false };
}

export async function financeFile(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db.select({ mime: schema.financeFiles.mime, data: schema.financeFiles.data, sha256: schema.financeFiles.sha256 }).from(schema.financeFiles).where(eq(schema.financeFiles.id, id));
  return f ?? null;
}
