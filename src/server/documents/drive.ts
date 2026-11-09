// The drive: My documents (private to you until shared), Team (the workspace's
// folders, by their rules), Shared with me, Starred, Recent and the Trash.
// Written documents and uploaded files live side by side in folders; every
// listing goes through the same access rules as opening a file does.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { FOLDER_ACCESS, LINK_TYPES } from "@/lib/documents/model";
import { DOC_TEMPLATES, SHARE_ROLES, TRASH_DAYS, docJsonSchema, emptyDoc, kindOf, pageSchema, snippetOf, templateById, textOf, wordsIn } from "@/lib/documents/write";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";
import { expireTick, liveDrop, tellUploader } from "./drop";
import { appUrl } from "../services/mail";
import { contains } from "../security/like";
import { atLeast, check, getFileAs, openFolders, requireWrite, roleFor, team, type Access, type FileRole, type Scope } from "./access";

const F = schema.docFiles;
const D = schema.docFolders;
type FileRow = typeof F.$inferSelect;
type FolderRow = typeof D.$inferSelect;
const isId = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);

// ── Activity ────────────────────────────────────────────────────────────────

export async function act(s: Pick<Scope, "orgId" | "userId">, kind: string, target: { fileId?: string | null; folderId?: string | null }, detail: Record<string, unknown> = {}) {
  await db.insert(schema.docActivity).values({ orgId: s.orgId, actorId: s.userId, kind, fileId: target.fileId ?? null, folderId: target.folderId ?? null, detail }).catch(() => {});
  // Someone who uploaded it by Drive QR hears about it straight away.
  if (target.fileId) await tellUploader(s.orgId, target.fileId, s.userId, kind, detail).catch(() => {});
}

// ── Shaping rows for the drive ──────────────────────────────────────────────

/** Files as the drive shows them: latest version's name/size, who made and last edited it, starred, shared. */
async function shapeFiles(s: Scope, rows: FileRow[], a: Access) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [versions, stars, shares, people] = await Promise.all([
    db.select({ fileId: schema.docVersions.fileId, version: schema.docVersions.version, filename: schema.docVersions.filename, mime: schema.docVersions.mime, size: schema.docVersions.size }).from(schema.docVersions).where(inArray(schema.docVersions.fileId, ids)),
    db.select({ itemId: schema.docStars.itemId }).from(schema.docStars).where(and(eq(schema.docStars.userId, s.userId), inArray(schema.docStars.itemId, ids))),
    db.select({ fileId: schema.docShares.fileId, n: sql<number>`count(*)::int` }).from(schema.docShares).where(inArray(schema.docShares.fileId, ids)).groupBy(schema.docShares.fileId),
    nameMap(s.orgId),
  ]);
  const starred = new Set(stars.map((x) => x.itemId));
  return rows.map((f) => {
    const v = f.kind === "file" ? versions.find((x) => x.fileId === f.id && x.version === f.version) : undefined;
    return {
      id: f.id,
      kind: f.kind as "doc" | "file",
      title: f.title,
      icon: f.icon,
      folderId: f.folderId,
      access: f.access,
      status: f.status,
      tags: f.tags,
      expiresOn: f.expiresOn,
      linkType: f.linkType,
      linkId: f.linkId,
      filename: v?.filename ?? "",
      mime: v?.mime ?? (f.kind === "doc" ? "application/vnd.cloudesk.doc" : ""),
      size: f.kind === "doc" ? f.bodyText.length : (v?.size ?? 0),
      version: f.version,
      words: f.words,
      snippet: snippetOf(f.bodyText, 180),
      createdBy: f.createdBy,
      owner: f.createdBy ? (people.get(f.createdBy) ?? "Someone") : "Someone",
      lastEditedBy: f.lastEditedBy ? (people.get(f.lastEditedBy) ?? null) : null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      deletedAt: f.deletedAt?.toISOString() ?? null,
      deleteAt: f.deleteAt?.toISOString() ?? null,
      dropped: f.dropId ? { name: f.dropFrom?.name ?? "", email: f.dropFrom?.email ?? "" } : null,
      starred: starred.has(f.id),
      shared: (shares.find((x) => x.fileId === f.id)?.n ?? 0) > 0 || !!f.shareNonce,
      linkShared: !!f.shareNonce,
      role: roleFor(s, f, a) ?? "view",
      mine: f.createdBy === s.userId,
    };
  });
}
export type DriveFile = Awaited<ReturnType<typeof shapeFiles>>[number];

async function shapeFolders(s: Scope, rows: FolderRow[], a: Access) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stars, files, subs, shares, people] = await Promise.all([
    db.select({ itemId: schema.docStars.itemId }).from(schema.docStars).where(and(eq(schema.docStars.userId, s.userId), inArray(schema.docStars.itemId, ids))),
    db.select({ folderId: F.folderId, n: sql<number>`count(*)::int` }).from(F).where(and(inArray(F.folderId, ids), isNull(F.deletedAt))).groupBy(F.folderId),
    db.select({ parentId: D.parentId, n: sql<number>`count(*)::int` }).from(D).where(and(inArray(D.parentId, ids), isNull(D.deletedAt))).groupBy(D.parentId),
    db.select({ folderId: schema.docShares.folderId, n: sql<number>`count(*)::int` }).from(schema.docShares).where(inArray(schema.docShares.folderId, ids)).groupBy(schema.docShares.folderId),
    nameMap(s.orgId),
  ]);
  const starred = new Set(stars.map((x) => x.itemId));
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    color: f.color,
    access: f.access,
    memberIds: s.manage || f.createdBy === s.userId ? f.memberIds : [],
    createdBy: f.createdBy,
    owner: f.createdBy ? (people.get(f.createdBy) ?? "Someone") : "Someone",
    createdAt: f.createdAt.toISOString(),
    deletedAt: f.deletedAt?.toISOString() ?? null,
    items: (files.find((x) => x.folderId === f.id)?.n ?? 0) + (subs.find((x) => x.parentId === f.id)?.n ?? 0),
    starred: starred.has(f.id),
    shared: (shares.find((x) => x.folderId === f.id)?.n ?? 0) > 0,
    role: (a.roleOf.get(f.id) ?? "view") as FileRole,
    mine: f.createdBy === s.userId,
  }));
}
export type DriveFolder = Awaited<ReturnType<typeof shapeFolders>>[number];

async function nameMap(orgId: string) {
  const rows = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Where a folder sits: its parents up to My documents or Team. */
function pathTo(a: Access, folderId: string | null, userId: string) {
  const crumbs: { id: string; name: string }[] = [];
  let top: FolderRow | undefined;
  for (let at = folderId, i = 0; at && i < 40; i++) {
    const f = a.byId.get(at);
    if (!f) break;
    if (!a.open.has(f.id)) break;
    crumbs.unshift({ id: f.id, name: f.name });
    top = f;
    at = f.parentId;
  }
  const root: "mine" | "team" | "shared" = !top ? "team" : top.access === "private" ? (top.createdBy === userId ? "mine" : "shared") : top.parentId && !a.open.has(top.parentId) ? "shared" : "team";
  return { root, crumbs };
}

// ── Listing ─────────────────────────────────────────────────────────────────

export const SECTIONS = ["mine", "team", "shared", "starred", "recent", "trash", "folder", "search"] as const;
const listSchema = z.object({
  section: z.enum(SECTIONS).default("mine"),
  folderId: z.string().optional(),
  q: z.string().max(200).optional(),
  type: z.enum(["doc", "pdf", "image", "sheet", "word", "slides", "text", "other", ""]).optional(),
  owner: z.enum(["me", "others", ""]).optional(),
  modified: z.enum(["today", "week", "month", "year", ""]).optional(),
  linkType: z.string().optional(),
  linkId: z.string().optional(),
});

const SINCE: Record<string, number> = { today: 1, week: 7, month: 30, year: 365 };

export async function list(s: Scope, raw: unknown) {
  const q = check(listSchema, raw);
  const trash = q.section === "trash";
  if (trash) await purgeExpired(s.orgId);
  // Files past their delete time go now, even between the minute ticks.
  await expireTick().catch(() => {});
  const a = await openFolders(s, { trashed: trash });
  const live = (f: FileRow) => !f.deletedAt && !(f.folderId && a.byId.get(f.folderId) && a.inTrash(a.byId.get(f.folderId)!));
  let files: FileRow[] = [];
  let folders: FolderRow[] = [];
  let crumbs: ReturnType<typeof pathTo> = { root: q.section === "mine" ? "mine" : "team", crumbs: [] };
  let current: FolderRow | null = null;
  const searching = !!q.q?.trim() || q.section === "search";

  const where = [eq(F.orgId, s.orgId)];
  if (q.type === "doc") where.push(eq(F.kind, "doc"));
  if (q.owner === "me") where.push(eq(F.createdBy, s.userId));
  if (q.owner === "others") where.push(sql`${F.createdBy} is distinct from ${s.userId}`);
  if (q.modified) where.push(sql`${F.updatedAt} > now() - make_interval(days => ${SINCE[q.modified]})`);
  if (q.linkType && isId(q.linkId)) where.push(and(eq(F.linkType, q.linkType), eq(F.linkId, q.linkId))!);

  if (searching) {
    const term = q.q?.trim() ?? "";
    if (term) where.push(sql`(${F.title} ilike ${contains(term)} or ${F.bodyText} ilike ${contains(term)} or ${F.notes} ilike ${contains(term)} or exists (select 1 from unnest(${F.tags}) t where t ilike ${contains(term)}) or exists (select 1 from doc_versions v where v.file_id = ${F.id} and v.filename ilike ${contains(term)}))`);
    files = (await db.select().from(F).where(and(...where, isNull(F.deletedAt))).orderBy(desc(F.updatedAt)).limit(300)).filter(live);
    folders = term ? (await db.select().from(D).where(and(eq(D.orgId, s.orgId), isNull(D.deletedAt), sql`${D.name} ilike ${contains(term)}`)).limit(60)).filter((f) => a.open.has(f.id)) : [];
  } else if (q.section === "folder") {
    if (!isId(q.folderId) || !a.open.has(q.folderId)) throw notFound("Folder");
    current = a.byId.get(q.folderId)!;
    crumbs = pathTo(a, q.folderId, s.userId);
    files = (await db.select().from(F).where(and(...where, eq(F.folderId, q.folderId), isNull(F.deletedAt))).orderBy(F.title)).filter(live);
    folders = a.all.filter((f) => f.parentId === q.folderId && a.open.has(f.id) && !f.deletedAt);
  } else if (q.section === "mine") {
    files = await db.select().from(F).where(and(...where, isNull(F.folderId), eq(F.access, "private"), eq(F.createdBy, s.userId), isNull(F.deletedAt))).orderBy(desc(F.updatedAt));
    folders = a.all.filter((f) => !f.parentId && f.access === "private" && f.createdBy === s.userId && !f.deletedAt);
  } else if (q.section === "team") {
    files = await db.select().from(F).where(and(...where, isNull(F.folderId), eq(F.access, "inherit"), isNull(F.deletedAt))).orderBy(F.title);
    folders = a.all.filter((f) => !f.parentId && f.access !== "private" && a.open.has(f.id) && !f.deletedAt);
  } else if (q.section === "shared") {
    const fileIds = [...a.fileShares.keys()];
    const folderIds = new Set([...a.roleOf.keys()].filter((id) => a.sharedRole(id) && !a.sharedRole(a.byId.get(id)?.parentId ?? null)));
    files = fileIds.length ? (await db.select().from(F).where(and(...where, inArray(F.id, fileIds), isNull(F.deletedAt)))).filter((f) => f.createdBy !== s.userId && live(f)) : [];
    folders = a.all.filter((f) => folderIds.has(f.id) && f.createdBy !== s.userId);
  } else if (q.section === "starred") {
    const stars = await db.select().from(schema.docStars).where(and(eq(schema.docStars.orgId, s.orgId), eq(schema.docStars.userId, s.userId)));
    const fileIds = stars.filter((x) => x.kind === "file").map((x) => x.itemId);
    files = fileIds.length ? (await db.select().from(F).where(and(...where, inArray(F.id, fileIds), isNull(F.deletedAt)))).filter(live) : [];
    folders = a.all.filter((f) => stars.some((x) => x.kind === "folder" && x.itemId === f.id) && a.open.has(f.id));
  } else if (q.section === "recent") {
    const rows = await db.select({ f: F }).from(schema.docRecents).innerJoin(F, eq(F.id, schema.docRecents.fileId)).where(and(eq(schema.docRecents.orgId, s.orgId), eq(schema.docRecents.userId, s.userId), isNull(F.deletedAt), ...where.slice(1))).orderBy(desc(schema.docRecents.openedAt)).limit(60);
    files = rows.map((r) => r.f).filter(live);
  } else if (trash) {
    // What was put in the trash directly — a folder's contents come back with it.
    files = (await db.select().from(F).where(and(...where, isNotNull(F.deletedAt))).orderBy(desc(F.deletedAt))).filter((f) => !(f.folderId && a.byId.get(f.folderId)?.deletedAt));
    folders = a.all.filter((f) => f.deletedAt && !(f.parentId && a.inTrash(a.byId.get(f.parentId) ?? ({} as FolderRow))));
  }

  const visible = files.filter((f) => roleFor(s, f, a) && (!trash || atLeast(roleFor(s, f, a), "edit")));
  const visibleFolders = trash ? folders.filter((f) => f.createdBy === s.userId || (s.manage && f.access !== "private")) : folders;
  let shaped = await shapeFiles(s, visible, a);
  if (q.type && q.type !== "doc") {
    shaped = shaped.filter((f) => kindOf(f) === q.type || (q.type === "other" && ["archive", "other"].includes(kindOf(f))));
  }
  const qrLive = q.section === "folder" || q.section === "team" || q.section === "mine" ? await liveDrop(s.orgId, q.section === "folder" ? (q.folderId ?? null) : null, q.section === "mine" ? "mine" : "team", s.userId) : false;
  return {
    qrLive,
    section: q.section,
    folder: current ? (await shapeFolders(s, [current], a))[0] : null,
    path: crumbs,
    folders: await shapeFolders(s, visibleFolders, a),
    files: shaped,
  };
}

/** Every folder this member can open, for the tree and Move to. */
export async function tree(s: Scope) {
  const a = await openFolders(s);
  const rows = a.all.filter((f) => a.open.has(f.id) && !f.deletedAt);
  return rows
    .map((f) => ({ id: f.id, name: f.name, parentId: f.parentId && a.open.has(f.parentId) ? f.parentId : null, color: f.color, access: f.access, root: pathTo(a, f.id, s.userId).root, role: a.roleOf.get(f.id) ?? "view" }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** How much of the workspace's storage is used, and by what. */
export async function storage(s: Scope) {
  const [files, docs, assets] = await Promise.all([
    db.select({ n: sql<number>`coalesce(sum(${schema.docVersions.size}), 0)::bigint` }).from(schema.docVersions).where(eq(schema.docVersions.orgId, s.orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(F).where(and(eq(F.orgId, s.orgId), eq(F.kind, "doc"), isNull(F.deletedAt))),
    db.select({ n: sql<number>`coalesce(sum(${schema.docAssets.size}), 0)::bigint` }).from(schema.docAssets).where(eq(schema.docAssets.orgId, s.orgId)),
  ]);
  const { MAX_ORG_BYTES } = await import("@/lib/documents/model");
  return { used: Number(files[0]!.n) + Number(assets[0]!.n), limit: MAX_ORG_BYTES, docs: docs[0]!.n };
}

// ── Where things go ─────────────────────────────────────────────────────────

const placeSchema = z.object({
  /** A folder, or null for the top of My documents / Team. */
  folderId: z.uuid().nullable().default(null),
  root: z.enum(["mine", "team"]).default("mine"),
});

/** Checks a destination and returns the file access that goes with it. */
async function destination(s: Scope, a: Access, place: z.infer<typeof placeSchema>) {
  if (place.folderId) {
    const r = a.roleOf.get(place.folderId);
    if (!r) throw new ApiError("validation_failed", "That folder isn't open to you", { folderId: ["Unknown folder"] });
    if (r !== "edit") throw new ApiError("forbidden", "You can open that folder, but not add to it");
    return { folderId: place.folderId, access: "inherit" as const };
  }
  if (place.root === "team") requireWrite(s);
  return { folderId: null, access: place.root === "mine" ? ("private" as const) : ("inherit" as const) };
}

// ── Written documents ───────────────────────────────────────────────────────

const createDocSchema = placeSchema.extend({
  title: z.string().trim().max(200).default(""),
  templateId: z.string().max(40).optional(),
  content: docJsonSchema.optional(),
  page: pageSchema.optional(),
  icon: z.string().max(8).default(""),
  linkType: z.enum(LINK_TYPES).nullable().default(null),
  linkId: z.uuid().nullable().default(null),
});

export async function createDoc(s: Scope, raw: unknown) {
  const v = check(createDocSchema, raw);
  const a = await openFolders(s);
  const place = await destination(s, a, v);
  if (v.linkType && v.linkId) {
    const { checkLink } = await import("./core");
    await checkLink(s.orgId, v.linkType, v.linkId);
  }
  const tpl = v.templateId ? templateById(v.templateId) : undefined;
  if (v.templateId && !tpl) throw new ApiError("validation_failed", "Unknown template");
  const content = v.content ?? tpl?.build() ?? emptyDoc();
  const text = textOf(content);
  const title = v.title || (tpl && tpl.id !== "blank" ? tpl.name : "Untitled document");
  const page = pageSchema.parse({ ...(tpl?.page ?? {}), ...(v.page ?? {}) });
  const [row] = await db
    .insert(F)
    .values({ orgId: s.orgId, kind: "doc", title, icon: v.icon || (tpl && tpl.id !== "blank" ? tpl.icon : ""), folderId: place.folderId, access: place.access, status: "draft", content: content as Record<string, unknown>, bodyText: text, words: wordsIn(text), page, version: 0, linkType: v.linkType, linkId: v.linkId, createdBy: s.userId, lastEditedBy: s.userId })
    .returning();
  await act(s, "created", { fileId: row!.id }, { template: tpl?.id ?? null });
  await touch(s, row!.id);
  return (await shapeFiles(s, [row!], await openFolders(s)))[0]!;
}

/** The document to open in the editor: content, page, who can do what, comments count. */
export async function openDoc(s: Scope, id: string) {
  const { file: f, role } = await getFileAs(s, id);
  if (f.kind !== "doc") throw new ApiError("conflict", "This is an uploaded file. Open it to preview or download it.");
  await touch(s, f.id);
  const a = await openFolders(s);
  const [shaped] = await shapeFiles(s, [f], a);
  // A file at the top level sits in My documents (private) or Team; inside a folder, wherever the folder is.
  const path = f.folderId ? pathTo(a, f.folderId, s.userId) : { root: f.access === "private" ? (f.createdBy === s.userId ? "mine" : "shared") : "team", crumbs: [] };
  return { file: shaped!, content: f.content ?? emptyDoc(), page: pageSchema.parse(f.page ?? {}), role, path, people: await team(s.orgId), templates: DOC_TEMPLATES.map(({ id, name }) => ({ id, name })) };
}

/** Remember that this member opened a file (for Recent). */
export async function touch(s: Pick<Scope, "orgId" | "userId">, fileId: string) {
  await db.insert(schema.docRecents).values({ orgId: s.orgId, userId: s.userId, fileId }).onConflictDoUpdate({ target: [schema.docRecents.userId, schema.docRecents.fileId], set: { openedAt: new Date() } });
}

const docMetaSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200).optional(),
  icon: z.string().max(8).optional(),
  page: pageSchema.optional(),
  status: z.enum(["draft", "final", "archived"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  linkType: z.enum(LINK_TYPES).nullable().optional(),
  linkId: z.uuid().nullable().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
});

/** Title, icon, page setup, tags and links — for documents and uploads alike. */
export async function patchFile(s: Scope, id: string, raw: unknown) {
  const { file: f, role } = await getFileAs(s, id);
  if (role !== "edit") throw new ApiError("forbidden", "You can open this, but not change it");
  const v = check(docMetaSchema, raw);
  if (v.linkType !== undefined || v.linkId !== undefined) {
    const { checkLink } = await import("./core");
    await checkLink(s.orgId, v.linkType ?? null, v.linkId ?? null);
  }
  const [row] = await db.update(F).set({ ...v, updatedAt: new Date(), lastEditedBy: s.userId }).where(eq(F.id, f.id)).returning();
  if (v.title && v.title !== f.title) await act(s, "renamed", { fileId: f.id }, { from: f.title, to: v.title });
  return (await shapeFiles(s, [row!], await openFolders(s)))[0]!;
}

// ── Folders ─────────────────────────────────────────────────────────────────

const newFolderSchema = placeSchema.extend({ name: z.string().trim().min(1, "Name the folder").max(120), color: z.string().max(12).default("") });

export async function createFolder(s: Scope, raw: unknown) {
  const v = check(newFolderSchema, raw);
  const a = await openFolders(s);
  if (v.folderId) await destination(s, a, v);
  else if (v.root === "team") requireWrite(s);
  const [row] = await db.insert(D).values({ orgId: s.orgId, name: v.name, color: v.color, parentId: v.folderId, access: v.folderId ? "team" : v.root === "mine" ? "private" : "team", createdBy: s.userId }).returning();
  await act(s, "folder_created", { folderId: row!.id }, { name: v.name });
  return (await shapeFolders(s, [row!], await openFolders(s)))[0]!;
}

const folderPatchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), color: z.string().max(12).optional(), access: z.enum(FOLDER_ACCESS).optional(), memberIds: z.array(z.uuid()).max(200).optional() });

export async function patchFolder(s: Scope, id: string, raw: unknown) {
  const a = await openFolders(s);
  const f = isId(id) ? a.byId.get(id) : undefined;
  if (!f || !a.open.has(f.id)) throw notFound("Folder");
  if (a.roleOf.get(f.id) !== "edit") throw new ApiError("forbidden", "You can open this folder, but not change it");
  const v = check(folderPatchSchema, raw);
  // Who can open a folder is the call of whoever made it, or an owner or admin.
  if ((v.access || v.memberIds) && f.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Only whoever made this folder, or an owner or admin, can change who opens it");
  if (v.access === "private" && f.createdBy !== s.userId) throw new ApiError("forbidden", "Only whoever made a folder can make it private");
  if (v.memberIds?.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, v.memberIds)));
    if (found.length !== new Set(v.memberIds).size) throw new ApiError("validation_failed", "Everyone chosen must be in this workspace");
  }
  const [row] = await db.update(D).set(v).where(eq(D.id, f.id)).returning();
  if (v.name && v.name !== f.name) await act(s, "folder_renamed", { folderId: f.id }, { from: f.name, to: v.name });
  return (await shapeFolders(s, [row!], await openFolders(s)))[0]!;
}

// ── Moving, copying, starring, trash ────────────────────────────────────────

const itemsSchema = z.object({ files: z.array(z.uuid()).max(500).default([]), folders: z.array(z.uuid()).max(200).default([]) });

/** The items, each one this member may change (anything else is refused, so nothing half-moves). */
async function editable(s: Scope, a: Access, raw: z.infer<typeof itemsSchema>, opts: { trashed?: boolean } = {}) {
  const files = raw.files.length ? await db.select().from(F).where(and(eq(F.orgId, s.orgId), inArray(F.id, raw.files))) : [];
  if (files.length !== new Set(raw.files).size) throw notFound("Document");
  for (const f of files) {
    if (roleFor(s, f, a) !== "edit") throw new ApiError("forbidden", `You can't change “${f.title}”`);
    if (!opts.trashed && f.deletedAt) throw notFound("Document");
  }
  const folders = raw.folders.map((id) => a.byId.get(id));
  for (const f of folders) {
    if (!f || !a.open.has(f.id)) throw notFound("Folder");
    if (a.roleOf.get(f.id) !== "edit") throw new ApiError("forbidden", `You can't change “${f.name}”`);
  }
  return { files, folders: folders as FolderRow[] };
}

const moveSchema = itemsSchema.extend(placeSchema.shape);

export async function move(s: Scope, raw: unknown) {
  const v = check(moveSchema, raw);
  const a = await openFolders(s);
  const { files, folders } = await editable(s, a, v);
  const to = await destination(s, a, v);
  for (const f of folders) {
    for (let at = to.folderId, i = 0; at && i < 40; i++) {
      if (at === f.id) throw new ApiError("validation_failed", `“${f.name}” can't go inside itself`);
      at = a.byId.get(at)?.parentId ?? null;
    }
    // A folder moved to the top of My documents becomes yours alone; to Team, it opens to the team.
    if (!to.folderId && f.access === "private" && v.root === "team" && f.createdBy !== s.userId) throw new ApiError("forbidden", `Only whoever made “${f.name}” can move it to Team`);
  }
  await db.transaction(async (tx) => {
    if (files.length) await tx.update(F).set({ folderId: to.folderId, access: to.access, updatedAt: new Date() }).where(inArray(F.id, files.map((f) => f.id)));
    for (const f of folders) await tx.update(D).set({ parentId: to.folderId, ...(to.folderId ? {} : { access: v.root === "mine" ? "private" : f.access === "private" ? "team" : f.access }) }).where(eq(D.id, f.id));
  });
  for (const f of files) await act(s, "moved", { fileId: f.id }, { to: to.folderId ? a.byId.get(to.folderId)?.name : v.root === "mine" ? "My documents" : "Team" });
  return { moved: files.length + folders.length };
}

export async function copyFile(s: Scope, id: string, raw: unknown) {
  const { file: f } = await getFileAs(s, id);
  const a = await openFolders(s);
  const v = check(placeSchema.extend({ title: z.string().trim().max(200).optional() }), raw ?? {});
  // By default the copy goes next to the original if you can add there, otherwise to My documents.
  const near = f.folderId && a.roleOf.get(f.folderId) === "edit" ? { folderId: f.folderId, root: "mine" as const } : { folderId: null, root: f.access === "inherit" && !f.folderId && s.write ? ("team" as const) : ("mine" as const) };
  const to = await destination(s, a, v.folderId !== null || (raw as { root?: string })?.root ? v : near);
  const title = v.title || `Copy of ${f.title}`.slice(0, 200);
  const row = await db.transaction(async (tx) => {
    const [c] = await tx.insert(F).values({ orgId: s.orgId, kind: f.kind, title, icon: f.icon, folderId: to.folderId, access: to.access, status: f.kind === "doc" ? "draft" : f.status, tags: f.tags, content: f.content, bodyText: f.bodyText, words: f.words, page: f.page, notes: f.notes, linkType: f.linkType, linkId: f.linkId, version: f.kind === "doc" ? 0 : 1, createdBy: s.userId, lastEditedBy: s.userId }).returning();
    if (f.kind === "file") {
      const [v1] = await tx.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, f.version)));
      if (v1) await tx.insert(schema.docVersions).values({ orgId: s.orgId, fileId: c!.id, version: 1, filename: v1.filename, mime: v1.mime, size: v1.size, sha256: v1.sha256, data: v1.data, createdBy: s.userId });
    } else {
      // Images in the document come along, under the copy.
      const assets = await tx.select().from(schema.docAssets).where(eq(schema.docAssets.fileId, f.id));
      let json = JSON.stringify(f.content ?? {});
      for (const x of assets) {
        const [n] = await tx.insert(schema.docAssets).values({ orgId: s.orgId, fileId: c!.id, mime: x.mime, size: x.size, data: x.data, createdBy: s.userId }).returning({ id: schema.docAssets.id });
        json = json.split(x.id).join(n!.id);
      }
      if (assets.length) await tx.update(F).set({ content: JSON.parse(json) }).where(eq(F.id, c!.id));
    }
    return c!;
  });
  await act(s, "copied", { fileId: row.id }, { from: f.title });
  return (await shapeFiles(s, [row], await openFolders(s)))[0]!;
}

export async function star(s: Scope, raw: unknown) {
  const v = check(z.object({ id: z.uuid(), kind: z.enum(["file", "folder"]), on: z.boolean() }), raw);
  if (v.kind === "file") await getFileAs(s, v.id);
  else {
    const a = await openFolders(s);
    if (!a.open.has(v.id)) throw notFound("Folder");
  }
  if (v.on) await db.insert(schema.docStars).values({ orgId: s.orgId, userId: s.userId, itemId: v.id, kind: v.kind }).onConflictDoNothing();
  else await db.delete(schema.docStars).where(and(eq(schema.docStars.userId, s.userId), eq(schema.docStars.itemId, v.id)));
  return { starred: v.on };
}

export async function trash(s: Scope, raw: unknown) {
  const v = check(itemsSchema, raw);
  const a = await openFolders(s);
  const { files, folders } = await editable(s, a, v);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (files.length) await tx.update(F).set({ deletedAt: now, deletedBy: s.userId }).where(inArray(F.id, files.map((f) => f.id)));
    if (folders.length) await tx.update(D).set({ deletedAt: now, deletedBy: s.userId }).where(inArray(D.id, folders.map((f) => f.id)));
  });
  for (const f of files) await act(s, "trashed", { fileId: f.id });
  return { trashed: files.length + folders.length };
}

export async function restore(s: Scope, raw: unknown) {
  const v = check(itemsSchema, raw);
  const a = await openFolders(s, { trashed: true });
  const { files, folders } = await editable(s, a, v, { trashed: true });
  await db.transaction(async (tx) => {
    for (const f of files) {
      // Its folder may have gone; then it comes back to the top of where it was.
      const parent = f.folderId ? a.byId.get(f.folderId) : null;
      const gone = f.folderId && (!parent || a.inTrash(parent));
      await tx.update(F).set({ deletedAt: null, deletedBy: null, ...(gone ? { folderId: null } : {}) }).where(eq(F.id, f.id));
    }
    for (const f of folders) {
      const parent = f.parentId ? a.byId.get(f.parentId) : null;
      await tx.update(D).set({ deletedAt: null, deletedBy: null, ...(f.parentId && (!parent || a.inTrash(parent)) ? { parentId: null } : {}) }).where(eq(D.id, f.id));
    }
  });
  for (const f of files) await act(s, "restored", { fileId: f.id });
  return { restored: files.length + folders.length };
}

/** Deletes for good: files out for signature (or signed) are kept, so the signed record stays. */
export async function purge(s: Scope, raw: unknown) {
  const v = check(itemsSchema, raw);
  const a = await openFolders(s, { trashed: true });
  const { files, folders } = await editable(s, a, v, { trashed: true });
  for (const f of files) if (!f.deletedAt) throw new ApiError("conflict", `Put “${f.title}” in the trash first`);
  for (const f of folders) if (!f.deletedAt) throw new ApiError("conflict", `Put “${f.name}” in the trash first`);
  // Everything inside the folders goes too.
  const folderIds = new Set<string>(folders.map((f) => f.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of a.all)
      if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
        folderIds.add(f.id);
        grew = true;
      }
  }
  const inside = folderIds.size ? await db.select().from(F).where(and(eq(F.orgId, s.orgId), inArray(F.folderId, [...folderIds]))) : [];
  const all = [...files, ...inside];
  const signed = all.length ? await db.select({ fileId: schema.docSignRequests.fileId }).from(schema.docSignRequests).where(and(inArray(schema.docSignRequests.fileId, all.map((f) => f.id)), inArray(schema.docSignRequests.status, ["sent", "completed"]))) : [];
  if (signed.length) throw new ApiError("conflict", `“${all.find((f) => f.id === signed[0]!.fileId)?.title}” has been sent for signature, so it's kept. Restore it and archive it instead.`);
  for (const f of all) if (f.dropFrom?.email) await tellUploader(s.orgId, f.id, s.userId, "deleted");
  await db.transaction(async (tx) => {
    if (all.length) await tx.delete(schema.docStars).where(inArray(schema.docStars.itemId, all.map((f) => f.id)));
    if (all.length) await tx.delete(F).where(inArray(F.id, all.map((f) => f.id)));
    if (folderIds.size) await tx.delete(D).where(inArray(D.id, [...folderIds]));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.purged", targetType: "doc_file", metadata: { files: all.length, folders: folderIds.size } });
  return { deleted: all.length + folderIds.size };
}

export async function emptyTrash(s: Scope) {
  const listing = await list(s, { section: "trash" });
  if (!listing.files.length && !listing.folders.length) return { deleted: 0 };
  return purge(s, { files: listing.files.map((f) => f.id), folders: listing.folders.map((f) => f.id) });
}

/** Things in the trash for more than 30 days go for good (signed files excepted). */
async function purgeExpired(orgId: string) {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000);
  const kept = sql`not exists (select 1 from doc_sign_requests r where r.file_id = ${F.id} and r.status in ('sent','completed'))`;
  await db.delete(F).where(and(eq(F.orgId, orgId), lt(F.deletedAt, cutoff), kept));
  const old = await db.select({ id: D.id }).from(D).where(and(eq(D.orgId, orgId), lt(D.deletedAt, cutoff)));
  for (const f of old) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(F).where(eq(F.folderId, f.id));
    if (!n) await db.delete(D).where(eq(D.id, f.id)).catch(() => {});
  }
}

// ── Sharing ─────────────────────────────────────────────────────────────────

const shareSchema = z.object({
  fileId: z.uuid().optional(),
  folderId: z.uuid().optional(),
  people: z.array(z.object({ userId: z.uuid(), role: z.enum(SHARE_ROLES) })).max(200),
  /** People to tell (by notification and email). */
  notify: z.boolean().default(true),
  message: z.string().trim().max(500).default(""),
});

async function shareTarget(s: Scope, fileId?: string, folderId?: string) {
  if (!!fileId === !!folderId) throw new ApiError("validation_failed", "Share a file or a folder");
  if (fileId) {
    const { file, role } = await getFileAs(s, fileId);
    if (role !== "edit") throw new ApiError("forbidden", "Only people who can edit this can share it");
    return { fileId: file.id, folderId: null, title: file.title, link: file.kind === "doc" ? `/documents/d/${file.id}` : `/documents/file/${file.id}`, owner: file.createdBy };
  }
  const a = await openFolders(s);
  const f = a.byId.get(folderId!);
  if (!f || a.roleOf.get(f.id) !== "edit") throw new ApiError("forbidden", "Only people who can edit this folder can share it");
  return { fileId: null, folderId: f.id, title: f.name, link: `/documents/folder/${f.id}`, owner: f.createdBy };
}

export async function shares(s: Scope, q: { fileId?: string; folderId?: string }) {
  const t = await shareTarget(s, q.fileId, q.folderId);
  const rows = await db.select({ userId: schema.docShares.userId, role: schema.docShares.role, name: schema.users.name, email: schema.users.email }).from(schema.docShares).innerJoin(schema.users, eq(schema.users.id, schema.docShares.userId)).where(t.fileId ? eq(schema.docShares.fileId, t.fileId) : eq(schema.docShares.folderId, t.folderId!));
  let link: { url: string; role: string; expiresAt: string | null } | null = null;
  if (t.fileId) {
    const [f] = await db.select({ nonce: F.shareNonce, role: F.shareRole, expiresAt: F.shareExpiresAt }).from(F).where(eq(F.id, t.fileId));
    if (f?.nonce) link = { url: appUrl(`/read/${tokenFor(t.fileId, f.nonce)}`), role: f.role ?? "view", expiresAt: f.expiresAt?.toISOString() ?? null };
  }
  return { people: rows, link, ownerId: t.owner, team: await team(s.orgId) };
}

export async function setShares(s: Scope, raw: unknown) {
  const v = check(shareSchema, raw);
  const t = await shareTarget(s, v.fileId, v.folderId);
  const ids = [...new Set(v.people.map((p) => p.userId))];
  if (ids.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, ids)));
    if (found.length !== ids.length) throw new ApiError("validation_failed", "Everyone must be in this workspace");
  }
  const target = t.fileId ? eq(schema.docShares.fileId, t.fileId) : eq(schema.docShares.folderId, t.folderId!);
  const before = await db.select({ userId: schema.docShares.userId }).from(schema.docShares).where(target);
  await db.transaction(async (tx) => {
    await tx.delete(schema.docShares).where(target);
    const rows = v.people.filter((p) => p.userId !== t.owner).map((p) => ({ orgId: s.orgId, fileId: t.fileId, folderId: t.folderId, userId: p.userId, role: p.role, createdBy: s.userId }));
    if (rows.length) await tx.insert(schema.docShares).values(rows);
  });
  const added = ids.filter((id) => !before.some((b) => b.userId === id) && id !== s.userId && id !== t.owner);
  if (v.notify && added.length) {
    const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
    for (const uid of added) {
      const role = v.people.find((p) => p.userId === uid)!.role;
      await notify(s.orgId, [uid], { kind: "documents.shared", title: `${me?.name ?? "Someone"} shared “${t.title}” with you`, body: v.message || `You ${role === "edit" ? "can edit" : role === "comment" ? "can comment on" : "can view"} it.`, link: t.link, values: { who: me?.name ?? "Someone", title: t.title, role, link: appUrl(t.link) } });
    }
  }
  await act(s, "shared", { fileId: t.fileId, folderId: t.folderId }, { people: ids.length });
  return shares(s, { fileId: t.fileId ?? undefined, folderId: t.folderId ?? undefined });
}

// ── Links anyone can open ──────────────────────────────────────────────────

function linkKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new ApiError("conflict", "Share links need APP_ENCRYPTION_KEY to be configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("doc-share-link-v1").digest();
}
const tokenFor = (fileId: string, nonce: string) => `${fileId.replace(/-/g, "")}.${createHmac("sha256", linkKey()).update(`${fileId}:${nonce}`).digest("base64url").slice(0, 32)}`;

export async function setLink(s: Scope, id: string, raw: unknown) {
  const { file: f, role } = await getFileAs(s, id);
  if (role !== "edit") throw new ApiError("forbidden", "Only people who can edit this can share it");
  const v = check(z.object({ on: z.boolean(), role: z.enum(["view"]).default("view"), days: z.number().int().min(0).max(365).default(0) }), raw);
  if (!v.on) {
    await db.update(F).set({ shareNonce: null, shareRole: null, shareExpiresAt: null }).where(eq(F.id, f.id));
    await act(s, "link_off", { fileId: f.id });
    return { link: null };
  }
  const nonce = f.shareNonce ?? randomBytes(16).toString("base64url");
  const expiresAt = v.days ? new Date(Date.now() + v.days * 86_400_000) : null;
  await db.update(F).set({ shareNonce: nonce, shareRole: v.role, shareExpiresAt: expiresAt }).where(eq(F.id, f.id));
  if (!f.shareNonce) await act(s, "link_on", { fileId: f.id }, { role: v.role });
  return { link: { url: appUrl(`/read/${tokenFor(f.id, nonce)}`), role: v.role, expiresAt: expiresAt?.toISOString() ?? null } };
}

/** The file a share link opens, if the link is still on (and not past its date). */
export async function byLink(token: string) {
  const [hex, sig] = token.split(".");
  if (!hex || !sig || !/^[0-9a-f]{32}$/i.test(hex)) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const [f] = await db.select().from(F).where(and(eq(F.id, id), isNull(F.deletedAt)));
  if (!f?.shareNonce) return null;
  const want = Buffer.from(tokenFor(f.id, f.shareNonce).split(".")[1]!);
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (f.shareExpiresAt && f.shareExpiresAt < new Date()) return null;
  return f;
}

// ── Activity, details ──────────────────────────────────────────────────────

export async function activity(s: Scope, id: string) {
  const { file: f } = await getFileAs(s, id);
  const rows = await db.select({ kind: schema.docActivity.kind, detail: schema.docActivity.detail, at: schema.docActivity.at, who: schema.users.name }).from(schema.docActivity).leftJoin(schema.users, eq(schema.users.id, schema.docActivity.actorId)).where(eq(schema.docActivity.fileId, f.id)).orderBy(desc(schema.docActivity.at)).limit(100);
  return rows.map((r) => ({ ...r, at: r.at.toISOString(), who: r.who ?? "Someone" }));
}

/** Recent written documents for Home's desk and other modules' pickers. */
export async function recentDocs(s: Scope, limit = 5) {
  const a = await openFolders(s);
  const rows = await db.select({ f: F, openedAt: schema.docRecents.openedAt }).from(schema.docRecents).innerJoin(F, eq(F.id, schema.docRecents.fileId)).where(and(eq(schema.docRecents.orgId, s.orgId), eq(schema.docRecents.userId, s.userId), isNull(F.deletedAt))).orderBy(desc(schema.docRecents.openedAt)).limit(limit * 2);
  const ok = rows.filter((r) => roleFor(s, r.f, a) && !(r.f.folderId && a.byId.get(r.f.folderId) && a.inTrash(a.byId.get(r.f.folderId)!)));
  return (await shapeFiles(s, ok.slice(0, limit).map((r) => r.f), a)).map((f, i) => ({ ...f, openedAt: ok[i]!.openedAt.toISOString() }));
}

/** Files a member can see, as a flat list (for pickers elsewhere: attach to mail, share in chat). */
export async function pickable(s: Scope, q: string) {
  const r = await list(s, { section: "search", q });
  return r.files.slice(0, 40);
}
