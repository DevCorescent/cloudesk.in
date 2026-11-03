// Documents: folders (with who may open them), files with every version kept
// and fingerprinted, links to records elsewhere (deals, employees, projects,
// suppliers…), and the contract register — terms, renewals and notice dates,
// obligations, approval before signature, termination.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { LINK_TYPES, MAX_FILE_BYTES, MAX_ORG_BYTES, contractSchema, contractTerm, fileMetaSchema, folderSchema, sniffFile, type LINK_LABEL } from "@/lib/documents/model";
import { gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, getFile, getFileAs, nextNumber, openFolders, requireManage, requireWrite, roleFor, todayIst, type Scope } from "./access";
import { contains } from "../security/like";

type LinkType = keyof typeof LINK_LABEL;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

// ── Links to records elsewhere ──────────────────────────────────────────────

const LINKS: Record<LinkType, { table: { id: never; orgId: never }; name: string; href: (id: string) => string }> = {
  crm_deal: { table: schema.crmDeals as never, name: "title", href: (id) => `/crm/deals/${id}` },
  crm_company: { table: schema.crmCompanies as never, name: "name", href: (id) => `/crm/companies/${id}` },
  crm_contact: { table: schema.crmContacts as never, name: "name", href: (id) => `/crm/contacts/${id}` },
  hr_employee: { table: schema.hrEmployees as never, name: "name", href: (id) => `/hr/people/${id}` },
  work_project: { table: schema.workProjects as never, name: "name", href: (id) => `/work/projects/${id}` },
  inv_supplier: { table: schema.invSuppliers as never, name: "name", href: (id) => `/inventory/suppliers/${id}` },
  sales_order: { table: schema.salesOrders as never, name: "number", href: (id) => `/sales/orders/${id}` },
  mnt_asset: { table: schema.mntAssets as never, name: "name", href: (id) => `/maintenance/assets/${id}` },
};

/** The record a link points at must be in this workspace. Returns its name. */
export async function checkLink(orgId: string, type: LinkType | null, id: string | null) {
  if (!type && !id) return null;
  if (!type || !id) throw new ApiError("validation_failed", "Pick what it's linked to", { linkId: ["Pick a record"] });
  const def = LINKS[type];
  const t = def.table as unknown as Record<string, never>;
  const [row] = (await db.select({ id: t.id, name: t[def.name] }).from(def.table as never).where(and(eq(t.id, id), eq(t.orgId, orgId)))) as { id: string; name: string }[];
  if (!row) throw new ApiError("validation_failed", "That record isn't in this workspace", { linkId: ["Unknown record"] });
  return row.name;
}

/** Names and links for records rows point at. */
async function linkNames(orgId: string, rows: { linkType: string | null; linkId: string | null }[]) {
  const out = new Map<string, { name: string; href: string }>();
  for (const type of LINK_TYPES) {
    const ids = [...new Set(rows.filter((r) => r.linkType === type && r.linkId).map((r) => r.linkId!))];
    if (!ids.length) continue;
    const def = LINKS[type];
    const t = def.table as unknown as Record<string, never>;
    const found = (await db.select({ id: t.id, name: t[def.name] }).from(def.table as never).where(and(inArray(t.id, ids), eq(t.orgId, orgId)))) as { id: string; name: string }[];
    for (const f of found) out.set(`${type}:${f.id}`, { name: String(f.name), href: def.href(f.id) });
  }
  return out;
}

/** Records of a kind to link a document or contract to, for the picker. */
export async function linkOptions(s: Scope, type: string, q = "") {
  if (!(LINK_TYPES as readonly string[]).includes(type)) throw new ApiError("validation_failed", "Unknown kind of record");
  const def = LINKS[type as LinkType];
  const t = def.table as unknown as Record<string, never>;
  const rows = (await db.select({ id: t.id, name: t[def.name] }).from(def.table as never).where(and(eq(t.orgId, s.orgId), q ? sql`${t[def.name]}::text ilike ${contains(q)}` : undefined)).orderBy(asc(t[def.name])).limit(200)) as { id: string; name: string }[];
  return rows.map((r) => ({ id: r.id, name: String(r.name) }));
}

// ── Folders ─────────────────────────────────────────────────────────────────

export async function folders(s: Scope) {
  const { all, open } = await openFolders(s);
  // (Folders in the trash are already left out of `open`.)
  const counts = await db.select({ folderId: schema.docFiles.folderId, n: sql<number>`count(*)::int` }).from(schema.docFiles).where(and(eq(schema.docFiles.orgId, s.orgId), sql`${schema.docFiles.status} <> 'archived'`)).groupBy(schema.docFiles.folderId);
  return all.filter((f) => open.has(f.id)).sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ ...f, memberIds: s.manage ? f.memberIds : [], files: counts.find((c) => c.folderId === f.id)?.n ?? 0 }));
}

export async function saveFolder(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(folderSchema, raw);
  const { all } = await openFolders(s);
  if (v.parentId) {
    if (!all.some((f) => f.id === v.parentId)) throw new ApiError("validation_failed", "That folder isn't in this workspace", { parentId: ["Unknown folder"] });
    for (let at: string | null = v.parentId, i = 0; at && i < 40; i++) {
      if (at === id) throw new ApiError("validation_failed", "A folder can't go inside itself");
      at = all.find((f) => f.id === at)?.parentId ?? null;
    }
  }
  if (v.memberIds.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, v.memberIds)));
    if (found.length !== new Set(v.memberIds).size) throw new ApiError("validation_failed", "Everyone chosen must be in this workspace", { memberIds: ["Not in this workspace"] });
  }
  const values = { ...v, memberIds: v.access === "members" ? [...new Set(v.memberIds)] : [] };
  if (id) {
    if (!isId(id)) throw notFound("Folder");
    const [row] = await db.update(schema.docFolders).set(values).where(and(eq(schema.docFolders.id, id), eq(schema.docFolders.orgId, s.orgId))).returning();
    if (!row) throw notFound("Folder");
    return row;
  }
  const [row] = await db.insert(schema.docFolders).values({ ...values, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteFolder(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Folder");
  const [{ files }] = await db.select({ files: sql<number>`count(*)::int` }).from(schema.docFiles).where(eq(schema.docFiles.folderId, id));
  const [{ subs }] = await db.select({ subs: sql<number>`count(*)::int` }).from(schema.docFolders).where(eq(schema.docFolders.parentId, id));
  if (files || subs) throw new ApiError("conflict", "Move or delete what's in this folder first");
  const [row] = await db.delete(schema.docFolders).where(and(eq(schema.docFolders.id, id), eq(schema.docFolders.orgId, s.orgId))).returning();
  if (!row) throw notFound("Folder");
}

// ── Files ───────────────────────────────────────────────────────────────────

type FileRow = typeof schema.docFiles.$inferSelect;

async function withLatest(s: Scope, rows: FileRow[]) {
  if (!rows.length) return [];
  const versions = await db.select({ fileId: schema.docVersions.fileId, version: schema.docVersions.version, filename: schema.docVersions.filename, mime: schema.docVersions.mime, size: schema.docVersions.size, createdAt: schema.docVersions.createdAt }).from(schema.docVersions).where(inArray(schema.docVersions.fileId, rows.map((r) => r.id)));
  const links = await linkNames(s.orgId, rows);
  const today = todayIst();
  return rows.map((f) => {
    const v = versions.find((x) => x.fileId === f.id && x.version === f.version);
    return { ...f, filename: v?.filename ?? "", mime: v?.mime ?? "", size: v?.size ?? 0, link: f.linkType && f.linkId ? links.get(`${f.linkType}:${f.linkId}`) ?? null : null, expired: !!f.expiresOn && String(f.expiresOn) < today };
  });
}

/** Files in a folder (or the top level), or matching a search across every folder the member can open. */
export async function files(s: Scope, q: { folderId?: string; q?: string; tag?: string; linkType?: string; linkId?: string; status?: string; expiring?: string; all?: string } = {}) {
  const a = await openFolders(s);
  const where = [eq(schema.docFiles.orgId, s.orgId)];
  const searching = !!(q.q || q.tag || q.linkId || q.expiring || q.all);
  if (!searching) where.push(q.folderId && isId(q.folderId) ? eq(schema.docFiles.folderId, q.folderId) : isNull(schema.docFiles.folderId));
  if (q.q) where.push(sql`(${schema.docFiles.title} ilike ${contains(q.q)} or ${schema.docFiles.notes} ilike ${contains(q.q)} or exists (select 1 from unnest(${schema.docFiles.tags}) t where t ilike ${contains(q.q)}) or exists (select 1 from doc_versions v where v.file_id = ${schema.docFiles.id} and v.filename ilike ${contains(q.q)}))`);
  if (q.tag) where.push(sql`${q.tag} = any(${schema.docFiles.tags})`);
  if (q.linkType && q.linkId && isId(q.linkId)) where.push(and(eq(schema.docFiles.linkType, q.linkType), eq(schema.docFiles.linkId, q.linkId))!);
  if (q.status === "all") {
    // everything
  } else if (q.status) where.push(eq(schema.docFiles.status, q.status));
  else where.push(sql`${schema.docFiles.status} <> 'archived'`);
  if (q.expiring) where.push(sql`${schema.docFiles.expiresOn} <= ${addDaysIso(todayIst(), s.settings.alertDays)}`);
  where.push(isNull(schema.docFiles.deletedAt));
  const rows = await db.select().from(schema.docFiles).where(and(...where)).orderBy(asc(schema.docFiles.title)).limit(1000);
  return withLatest(s, rows.filter((f) => roleFor(s, f, a)));
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function checkFolder(s: Scope, folderId: string | null) {
  if (!folderId) return;
  const { roleOf } = await openFolders(s);
  if (!roleOf.has(folderId)) throw new ApiError("validation_failed", "That folder isn't open to you", { folderId: ["Unknown folder"] });
  if (roleOf.get(folderId) !== "edit") throw new ApiError("forbidden", "You can open that folder, but not add to it");
}

/** Room left in the workspace for another file. */
async function assertRoom(orgId: string, bytes: number) {
  const { assertQuota, entitlementFor } = await import("../billing/subscriptions");
  // The plan's storage (files, versions and site media together); the old flat 1 GB only when plans aren't enforced.
  await assertQuota(orgId, "storageMb", bytes / 1_048_576);
  if ((await entitlementFor(orgId)).state !== "unrestricted") return;
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${schema.docVersions.size}), 0)::bigint` }).from(schema.docVersions).where(eq(schema.docVersions.orgId, orgId));
  if (Number(used) + bytes > MAX_ORG_BYTES) throw new ApiError("conflict", "Your workspace has used its 1 GB of document storage. Delete old files or versions first.");
}

function checkBytes(name: string, bytes: Buffer) {
  if (!bytes.length) throw new ApiError("validation_failed", "The file is empty");
  if (bytes.length > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "Files are limited to 25 MB");
  const t = sniffFile(bytes, name);
  if (!t) throw new ApiError("validation_failed", "Upload a PDF, Word, Excel or PowerPoint file, an image, a ZIP, CSV or text file");
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\- .()]+/g, "").trim().slice(0, 120) || "document";
  return { ...t, filename: `${base}.${t.ext}`, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function upload(s: Scope, file: { name: string; bytes: Buffer }, rawMeta: unknown) {
  const t = checkBytes(file.name, file.bytes);
  const v = check(fileMetaSchema, { title: file.name.replace(/\.[^.]+$/, ""), ...(rawMeta as object) });
  // Into My documents (private to you) or the top of Team; inside a folder, its rules apply.
  const access = !v.folderId && (rawMeta as { root?: string })?.root === "mine" ? "private" : "inherit";
  if (s.write === false && access === "inherit" && !v.folderId) requireWrite(s);
  await checkFolder(s, v.folderId);
  await checkLink(s.orgId, v.linkType, v.linkId);
  await assertRoom(s.orgId, file.bytes.length);
  const row = await db.transaction(async (tx) => {
    const [f] = await tx.insert(schema.docFiles).values({ ...v, access, orgId: s.orgId, createdBy: s.userId, lastEditedBy: s.userId }).returning();
    await tx.insert(schema.docVersions).values({ orgId: s.orgId, fileId: f.id, version: 1, filename: t.filename, mime: t.mime, size: file.bytes.length, sha256: t.sha256, data: file.bytes, createdBy: s.userId });
    return f;
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.uploaded", targetType: "doc_file", targetId: row.id, metadata: { size: file.bytes.length, mime: t.mime } });
  return (await withLatest(s, [row]))[0];
}

/** A new version of a file; earlier ones are kept. */
export async function newVersion(s: Scope, id: string, file: { name: string; bytes: Buffer }, note: string) {
  const { file: f, role } = await getFileAs(s, id);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this, but not change it");
  if (f.kind === "doc") throw new ApiError("conflict", "Written documents keep versions as you edit");
  if (f.status === "archived") throw new ApiError("conflict", "This file is archived. Restore it first.");
  const t = checkBytes(file.name, file.bytes);
  await assertRoom(s.orgId, file.bytes.length);
  const version = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.docFiles).set({ version: sql`${schema.docFiles.version} + 1`, updatedAt: new Date() }).where(eq(schema.docFiles.id, f.id)).returning({ version: schema.docFiles.version });
    await tx.insert(schema.docVersions).values({ orgId: s.orgId, fileId: f.id, version: row.version, filename: t.filename, mime: t.mime, size: file.bytes.length, sha256: t.sha256, data: file.bytes, note: note.slice(0, 300), createdBy: s.userId });
    return row.version;
  });
  return { version };
}

export async function fileDetail(s: Scope, id: string) {
  const f = await getFile(s, id);
  const [versions, requests, contracts] = await Promise.all([
    db.select({ id: schema.docVersions.id, version: schema.docVersions.version, filename: schema.docVersions.filename, mime: schema.docVersions.mime, size: schema.docVersions.size, sha256: schema.docVersions.sha256, note: schema.docVersions.note, createdAt: schema.docVersions.createdAt, by: schema.users.name }).from(schema.docVersions).leftJoin(schema.users, eq(schema.users.id, schema.docVersions.createdBy)).where(eq(schema.docVersions.fileId, f.id)).orderBy(desc(schema.docVersions.version)),
    db.select({ id: schema.docSignRequests.id, title: schema.docSignRequests.title, status: schema.docSignRequests.status, versionId: schema.docSignRequests.versionId, createdAt: schema.docSignRequests.createdAt, completedAt: schema.docSignRequests.completedAt }).from(schema.docSignRequests).where(eq(schema.docSignRequests.fileId, f.id)).orderBy(desc(schema.docSignRequests.createdAt)),
    db.select({ id: schema.docContracts.id, number: schema.docContracts.number, title: schema.docContracts.title, status: schema.docContracts.status }).from(schema.docContracts).where(eq(schema.docContracts.fileId, f.id)),
  ]);
  return { file: (await withLatest(s, [f]))[0], versions, requests, contracts };
}

export async function updateFile(s: Scope, id: string, raw: unknown) {
  const { file: f, role } = await getFileAs(s, id);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this, but not change it");
  const v = check(fileMetaSchema, raw);
  await checkFolder(s, v.folderId);
  await checkLink(s.orgId, v.linkType, v.linkId);
  const [row] = await db.update(schema.docFiles).set({ ...v, updatedAt: new Date() }).where(eq(schema.docFiles.id, f.id)).returning();
  return row;
}

/** Deleting a file and its versions; refused while it's out for signature or is a signed contract's copy. */
export async function deleteFile(s: Scope, id: string) {
  const { file: f, role } = await getFileAs(s, id, { trashed: true });
  if (role !== "edit") throw new ApiError("forbidden", "You can open this, but not change it");
  if (!s.manage && f.createdBy !== s.userId) throw new ApiError("forbidden", "Only whoever uploaded it, or an owner or admin, can delete this");
  const [open] = await db.select({ id: schema.docSignRequests.id }).from(schema.docSignRequests).where(and(eq(schema.docSignRequests.fileId, f.id), inArray(schema.docSignRequests.status, ["sent", "completed"])));
  if (open) throw new ApiError("conflict", "This file has been sent for signature. Archive it instead, so the signed record stays.");
  await db.delete(schema.docFiles).where(eq(schema.docFiles.id, f.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.deleted", targetType: "doc_file", targetId: f.id, metadata: { title: f.title } });
}

/** A version's bytes, for download (or showing inline, for PDFs and images). */
export async function versionBytes(s: Scope, id: string, version?: number) {
  const f = await getFile(s, id);
  const [v] = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, version ?? f.version)));
  if (!v) throw notFound("Version");
  return v;
}

export function fileResponse(v: { data: Buffer; mime: string; filename: string; sha256: string }, inline: boolean) {
  const show = inline && (v.mime === "application/pdf" || v.mime.startsWith("image/"));
  return new Response(new Uint8Array(v.data), {
    headers: {
      "Content-Type": v.mime,
      "Content-Disposition": `${show ? "inline" : "attachment"}; filename="${v.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      // PDFs open in the browser's viewer, which a sandbox would block; nothing else that could run script is accepted.
      ...(v.mime === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      ETag: `"${v.sha256}"`,
    },
  });
}

// ── Contracts ───────────────────────────────────────────────────────────────

type Contract = typeof schema.docContracts.$inferSelect;

function shapeContract(s: Scope, c: Contract, links: Map<string, { name: string; href: string }>) {
  const today = todayIst();
  return {
    ...c,
    term: contractTerm({ startOn: c.startOn ? String(c.startOn) : null, endOn: c.endOn ? String(c.endOn) : null, autoRenew: c.autoRenew, renewalMonths: c.renewalMonths, noticeDays: c.noticeDays, status: c.status }, today, s.settings.alertDays),
    link: c.linkType && c.linkId ? links.get(`${c.linkType}:${c.linkId}`) ?? null : null,
    obligationsDue: c.obligations.filter((o) => !o.done && o.due && o.due <= addDaysIso(today, s.settings.alertDays)).length,
  };
}

async function getContract(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Contract");
  const [c] = await db.select().from(schema.docContracts).where(and(eq(schema.docContracts.id, id), eq(schema.docContracts.orgId, s.orgId)));
  if (!c) throw notFound("Contract");
  return c;
}

export async function contracts(s: Scope, q: { status?: string; q?: string; linkType?: string; linkId?: string } = {}) {
  const where = [eq(schema.docContracts.orgId, s.orgId)];
  if (q.status && q.status !== "all") where.push(eq(schema.docContracts.status, q.status));
  if (q.q) where.push(sql`(${schema.docContracts.title} ilike ${contains(q.q)} or ${schema.docContracts.counterparty} ilike ${contains(q.q)} or ${schema.docContracts.number} ilike ${contains(q.q)})`);
  if (q.linkType && q.linkId && isId(q.linkId)) where.push(and(eq(schema.docContracts.linkType, q.linkType), eq(schema.docContracts.linkId, q.linkId))!);
  const rows = await db.select().from(schema.docContracts).where(and(...where)).orderBy(desc(schema.docContracts.createdAt)).limit(1000);
  const links = await linkNames(s.orgId, rows);
  return rows.map((c) => ({ ...shapeContract(s, c, links), value: s.write ? c.value : 0 }));
}

export async function contractDetail(s: Scope, id: string) {
  const c = await getContract(s, id);
  const links = await linkNames(s.orgId, [c]);
  const file = c.fileId ? await getFile(s, c.fileId).then((f) => withLatest(s, [f]).then((r) => r[0])).catch(() => null) : null;
  const requests = await db.select({ id: schema.docSignRequests.id, title: schema.docSignRequests.title, status: schema.docSignRequests.status, createdAt: schema.docSignRequests.createdAt, completedAt: schema.docSignRequests.completedAt }).from(schema.docSignRequests).where(eq(schema.docSignRequests.contractId, c.id)).orderBy(desc(schema.docSignRequests.createdAt));
  const [approval] = await db.select({ status: schema.approvalRequests.status, policyName: schema.approvalRequests.policyName }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, s.orgId), eq(schema.approvalRequests.kind, "doc.contract"), eq(schema.approvalRequests.refId, c.id))).orderBy(desc(schema.approvalRequests.createdAt)).limit(1);
  return { contract: { ...shapeContract(s, c, links), value: s.write ? c.value : 0 }, file, requests, approval: approval ?? null };
}

async function checkContractRefs(s: Scope, v: z.infer<typeof contractSchema>) {
  if (v.startOn && v.endOn && v.endOn < v.startOn) throw new ApiError("validation_failed", "It ends before it starts", { endOn: ["Before the start"] });
  if (v.fileId) await getFile(s, v.fileId);
  await checkLink(s.orgId, v.linkType, v.linkId);
  const users = [...new Set([v.ownerId, ...v.obligations.map((o) => o.ownerId)].filter(Boolean) as string[])];
  if (users.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, users)));
    if (found.length !== users.length) throw new ApiError("validation_failed", "Owners must be in this workspace", { ownerId: ["Not in this workspace"] });
  }
}

export async function saveContract(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(contractSchema, raw);
  await checkContractRefs(s, v);
  if (id) {
    const c = await getContract(s, id);
    // Once approved or signed, the terms are what was agreed: only obligations, notes and links change.
    const locked = ["approved", "signing", "signed"].includes(c.status);
    const set = locked ? { obligations: v.obligations, notes: v.notes, linkType: v.linkType, linkId: v.linkId, ownerId: v.ownerId, counterpartyEmail: v.counterpartyEmail } : v;
    if (c.status === "terminated") throw new ApiError("conflict", "This contract has been terminated");
    const [row] = await db.update(schema.docContracts).set(set).where(eq(schema.docContracts.id, c.id)).returning();
    return row;
  }
  const number = await nextNumber(s.orgId, "contract", s.settings.contractPrefix);
  const [row] = await db.insert(schema.docContracts).values({ ...v, ownerId: v.ownerId ?? s.userId, orgId: s.orgId, number, createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.contract_created", targetType: "doc_contract", targetId: row.id, metadata: { number, value: row.value } });
  return row;
}

/** Send a draft for approval: approval rules for contracts (by value) decide; without one an owner or admin approves. */
export async function submitContract(s: Scope, id: string) {
  requireWrite(s);
  const c = await getContract(s, id);
  if (c.status !== "draft") throw new ApiError("conflict", "Only a draft is sent for approval");
  const g = await gate(s.orgId, { kind: "doc.contract", refId: c.id, label: `${c.number} · ${c.title} · ${c.counterparty}`, amount: Number(c.value), requesterId: s.userId, link: `/documents/contracts/${c.id}` });
  const status = g.status === "approved" || (g.status === "none" && s.manage) ? "approved" : "review";
  await db.update(schema.docContracts).set({ status }).where(eq(schema.docContracts.id, c.id));
  return { status };
}

/** An owner or admin decides a contract no approval rule covers. */
export async function decideContract(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  const c = await getContract(s, id);
  if (c.status !== "review") throw new ApiError("conflict", "This contract isn't waiting for a decision");
  const [req] = await db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, s.orgId), eq(schema.approvalRequests.kind, "doc.contract"), eq(schema.approvalRequests.refId, c.id), eq(schema.approvalRequests.status, "pending")));
  if (req) throw new ApiError("conflict", "This contract is with its approvers. Decide it in Approvals.");
  const { approve } = check(z.object({ approve: z.boolean() }), raw);
  await contractDecided(s.orgId, c.id, approve);
  return { status: approve ? "approved" : "draft" };
}

export async function contractDecided(orgId: string, id: string, approved: boolean) {
  await db.update(schema.docContracts).set({ status: approved ? "approved" : "draft" }).where(and(eq(schema.docContracts.id, id), eq(schema.docContracts.orgId, orgId), eq(schema.docContracts.status, "review")));
}

/** Signed outside Cloudesk (on paper, or another service): record it. */
export async function markSigned(s: Scope, id: string) {
  requireManage(s);
  const c = await getContract(s, id);
  if (!["approved", "signing"].includes(c.status)) throw new ApiError("conflict", c.status === "signed" ? "Already signed" : "Approve it first");
  await db.update(schema.docContracts).set({ status: "signed" }).where(eq(schema.docContracts.id, c.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.contract_marked_signed", targetType: "doc_contract", targetId: c.id, metadata: { number: c.number } });
}

export async function terminateContract(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  const c = await getContract(s, id);
  if (c.status === "terminated") throw new ApiError("conflict", "Already terminated");
  const { on, reason } = check(z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(500).default("") }), raw);
  await db.update(schema.docContracts).set({ status: "terminated", terminatedOn: on, endOn: c.endOn && String(c.endOn) < on ? c.endOn : on, autoRenew: false, notes: reason ? `${c.notes}${c.notes ? "\n" : ""}Terminated ${on}: ${reason}` : c.notes }).where(eq(schema.docContracts.id, c.id));
}

export async function tickObligation(s: Scope, id: string, raw: unknown) {
  const c = await getContract(s, id);
  const { item, done } = check(z.object({ item: z.string().min(1).max(40), done: z.boolean() }), raw);
  const o = c.obligations.find((x) => x.id === item);
  if (!o) throw notFound("Obligation");
  if (!s.write && o.ownerId !== s.userId) throw new ApiError("forbidden", "Only its owner or someone who manages contracts can tick this");
  const obligations = c.obligations.map((x) => (x.id === item ? { ...x, done } : x));
  await db.update(schema.docContracts).set({ obligations }).where(eq(schema.docContracts.id, c.id));
  return { obligations };
}

// ── Home ────────────────────────────────────────────────────────────────────

export async function home(s: Scope) {
  const [cs, expiring, signing, used] = await Promise.all([
    contracts(s),
    files(s, { expiring: "1" }),
    db.select({ id: schema.docSignRequests.id, title: schema.docSignRequests.title, createdAt: schema.docSignRequests.createdAt, expiresAt: schema.docSignRequests.expiresAt }).from(schema.docSignRequests).where(and(eq(schema.docSignRequests.orgId, s.orgId), eq(schema.docSignRequests.status, "sent"))).orderBy(asc(schema.docSignRequests.expiresAt)),
    db.select({ n: sql<number>`coalesce(sum(${schema.docVersions.size}), 0)::bigint` }).from(schema.docVersions).where(eq(schema.docVersions.orgId, s.orgId)),
  ]);
  const live = cs.filter((c) => c.status !== "terminated");
  const today = todayIst();
  const soon = addDaysIso(today, s.settings.alertDays);
  return {
    counts: { contracts: live.filter((c) => c.status === "signed").length, review: live.filter((c) => c.status === "review").length, signing: signing.length, expiringFiles: expiring.length },
    attention: live.filter((c) => ["notice_due", "ending", "renewing", "expired"].includes(c.term.state) && c.status === "signed").map((c) => ({ id: c.id, number: c.number, title: c.title, counterparty: c.counterparty, state: c.term.state, termEnd: c.term.termEnd, noticeBy: c.term.noticeBy })),
    obligations: live.flatMap((c) => c.obligations.filter((o) => !o.done && o.due && o.due <= soon).map((o) => ({ contractId: c.id, number: c.number, text: o.text, due: o.due!, ownerId: o.ownerId, overdue: o.due! < today }))).sort((a, b) => a.due.localeCompare(b.due)),
    expiring: expiring.slice(0, 10),
    signing: signing.slice(0, 10),
    storage: { used: Number(used[0].n), limit: MAX_ORG_BYTES },
  };
}
