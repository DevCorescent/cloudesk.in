// Notes: each member's own notes and daily notes, in nested folders. A note
// is private to its owner unless they share it with the workspace (to read or
// to edit), with chosen members, or publish it read-only by link. Notes can be
// attached to any page or record ("notes on this invoice"), link to each other
// with [[Title]] (backlinks are worked out on save), keep earlier versions,
// remind their owner, and go to the trash before they're gone.
import { randomBytes } from "node:crypto";
import { and, arrayContains, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { dailyBlocks, docSchema, linkedTitles, plainOf, toText, uid, wordCount, type Doc } from "@/lib/notes/blocks";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { contains } from "../security/like";

const N = schema.notes;
const F = schema.noteFolders;
const S = schema.noteShares;
const V = schema.noteVersions;

export type Who = { orgId: string; userId: string };
type Note = typeof N.$inferSelect;

const VERSION_GAP_MS = 10 * 60_000;
const MAX_VERSIONS = 100;

// ─── Access ────────────────────────────────────────────────────────────────

async function shareOf(noteId: string, userId: string) {
  const [r] = await db.select({ role: S.role }).from(S).where(and(eq(S.noteId, noteId), eq(S.userId, userId)));
  return r?.role ?? null;
}

/** What this person may do with the note: own it, edit it, read it — or nothing. */
async function access(w: Who, n: Note) {
  if (n.orgId !== w.orgId) return null;
  if (n.ownerId === w.userId) return "owner" as const;
  const share = await shareOf(n.id, w.userId);
  if (share === "edit" || n.visibility === "edit") return "edit" as const;
  if (share === "view" || n.visibility === "view") return "view" as const;
  return null;
}

async function load(w: Who, id: string, need: "view" | "edit" | "owner" = "view") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Note");
  const [n] = await db.select().from(N).where(and(eq(N.id, id), eq(N.orgId, w.orgId)));
  const a = n ? await access(w, n) : null;
  if (!n || !a) throw notFound("Note");
  const rank = { view: 0, edit: 1, owner: 2 };
  if (rank[a] < rank[need]) throw new ApiError("forbidden", need === "owner" ? "Only the note's owner can do that." : "You can read this note but not change it.");
  return { n, a };
}

/** Notes this person can read: theirs, shared with them, or shared with the workspace. */
const readable = (w: Who) =>
  and(eq(N.orgId, w.orgId), or(eq(N.ownerId, w.userId), inArray(N.visibility, ["view", "edit"]), sql`exists (select 1 from ${S} where ${S.noteId} = ${N.id} and ${S.userId} = ${w.userId})`));

// ─── Shapes ────────────────────────────────────────────────────────────────

const summary = (n: Note & { ownerName?: string | null }, me: string) => ({
  id: n.id,
  title: n.title,
  icon: n.icon,
  color: n.color,
  folderId: n.ownerId === me ? n.folderId : null,
  tags: n.tags,
  pinned: n.pinned,
  locked: n.locked,
  kind: n.kind,
  day: n.day,
  visibility: n.visibility,
  attached: n.attached,
  snippet: n.text.slice(0, 180),
  words: n.words,
  remindAt: n.remindAt,
  published: !!n.publicToken,
  mine: n.ownerId === me,
  owner: n.ownerName ?? null,
  deletedAt: n.deletedAt,
  updatedAt: n.updatedAt,
  createdAt: n.createdAt,
});
export type NoteSummary = ReturnType<typeof summary>;

// ─── Listing and search ────────────────────────────────────────────────────

export const listQuery = z.object({
  view: z.enum(["all", "mine", "shared", "pinned", "daily", "templates", "trash", "reminders", "page"]).default("all"),
  folder: z.string().max(40).optional(),
  tag: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
  href: z.string().max(500).optional(),
  sort: z.enum(["updated", "created", "title"]).default("updated"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function list(w: Who, raw: unknown) {
  const q = listQuery.parse(raw);
  const where = [q.view === "trash" ? and(eq(N.ownerId, w.userId), isNotNull(N.deletedAt)) : and(readable(w), isNull(N.deletedAt))];
  if (q.view === "mine") where.push(eq(N.ownerId, w.userId));
  if (q.view === "shared") where.push(ne(N.ownerId, w.userId));
  if (q.view === "pinned") where.push(eq(N.pinned, true));
  if (q.view === "daily") where.push(eq(N.kind, "daily"));
  if (q.view === "templates") where.push(eq(N.kind, "template"));
  else if (q.view !== "trash" && q.view !== "daily") where.push(ne(N.kind, "template"));
  if (q.view === "reminders") where.push(isNotNull(N.remindAt), eq(N.ownerId, w.userId));
  if (q.view === "page" && q.href) where.push(sql`${N.attached}->>'href' = ${q.href}`);
  if (q.folder === "none") where.push(isNull(N.folderId), eq(N.ownerId, w.userId));
  else if (q.folder) where.push(inArray(N.folderId, await subtree(w, q.folder)), eq(N.ownerId, w.userId));
  if (q.tag) where.push(arrayContains(N.tags, [q.tag.toLowerCase()]));
  if (q.q?.trim()) where.push(or(sql`${N.title} ilike ${contains(q.q.trim())}`, sql`${N.text} ilike ${contains(q.q.trim())}`, arrayContains(N.tags, [q.q.trim().toLowerCase()]))!);
  const order = q.sort === "title" ? [asc(N.title)] : q.sort === "created" ? [desc(N.createdAt)] : [desc(N.pinned), desc(N.updatedAt)];
  const rows = await db.select({ n: N, ownerName: schema.users.name }).from(N).leftJoin(schema.users, eq(schema.users.id, N.ownerId)).where(and(...where)).orderBy(...(q.view === "reminders" ? [asc(N.remindAt)] : order)).limit(q.limit);
  return rows.map((r) => summary({ ...r.n, ownerName: r.ownerName }, w.userId));
}

/** The sidebar: folders with counts, tags, and how many notes are in each view. */
export async function overview(w: Who) {
  const folders = await db.select().from(F).where(and(eq(F.orgId, w.orgId), eq(F.ownerId, w.userId))).orderBy(asc(F.sort), asc(F.name));
  const counts = await db.select({ folderId: N.folderId, n: sql<number>`count(*)::int` }).from(N).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), isNull(N.deletedAt), ne(N.kind, "template"))).groupBy(N.folderId);
  const tags = await db.execute<{ tag: string; n: number }>(sql`select t as tag, count(*)::int as n from ${N}, unnest(${N.tags}) t where ${readable(w)} and ${N.deletedAt} is null group by t order by n desc, t limit 60`);
  const [c] = await db.select({
    all: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.kind} <> 'template')::int`,
    mine: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.kind} <> 'template' and ${N.ownerId} = ${w.userId})::int`,
    shared: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.kind} <> 'template' and ${N.ownerId} <> ${w.userId})::int`,
    pinned: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.pinned} and ${N.kind} <> 'template')::int`,
    daily: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.kind} = 'daily')::int`,
    templates: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.kind} = 'template')::int`,
    reminders: sql<number>`count(*) filter (where ${N.deletedAt} is null and ${N.remindAt} is not null and ${N.ownerId} = ${w.userId})::int`,
    trash: sql<number>`count(*) filter (where ${N.deletedAt} is not null and ${N.ownerId} = ${w.userId})::int`,
  }).from(N).where(readable(w));
  return {
    folders: folders.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, color: f.color, icon: f.icon, module: f.module, sort: f.sort, count: counts.find((x) => x.folderId === f.id)?.n ?? 0 })),
    unfiled: counts.find((x) => x.folderId === null)?.n ?? 0,
    tags: tags.rows.map((t) => ({ tag: t.tag, n: Number(t.n) })),
    counts: c ?? {},
  };
}

// ─── One note ──────────────────────────────────────────────────────────────

export async function get(w: Who, id: string) {
  const { n, a } = await load(w, id);
  const [owner] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, n.ownerId));
  const shares = await db.select({ userId: S.userId, role: S.role, name: schema.users.name, email: schema.users.email }).from(S).innerJoin(schema.users, eq(schema.users.id, S.userId)).where(eq(S.noteId, n.id));
  const back = await db.select({ id: N.id, title: N.title, icon: N.icon }).from(N).where(and(readable(w), isNull(N.deletedAt), arrayContains(N.links, [n.id]))).limit(50);
  const links = n.links.length ? await db.select({ id: N.id, title: N.title, icon: N.icon }).from(N).where(and(readable(w), isNull(N.deletedAt), inArray(N.id, n.links))) : [];
  const [{ versions }] = await db.select({ versions: sql<number>`count(*)::int` }).from(V).where(eq(V.noteId, n.id));
  return {
    ...summary(n, w.userId),
    content: n.content as Doc,
    version: n.version,
    access: a,
    canEdit: (a === "owner" || a === "edit") && !n.locked,
    owner: owner ? { id: n.ownerId, name: owner.name, email: owner.email } : null,
    shares: a === "owner" ? shares : [],
    publicToken: a === "owner" ? n.publicToken : null,
    backlinks: back,
    links,
    versions,
    updatedBy: n.updatedBy,
  };
}

const attachedSchema = z.object({ module: z.string().trim().max(40), href: z.string().trim().max(500).regex(/^\/(?!\/)/, "A page in the app"), label: z.string().trim().max(200) }).nullable();
const tagsSchema = z.array(z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]*$/u, "Tags are words")).max(20);

export const createSchema = z.object({
  title: z.string().trim().max(300).default(""),
  icon: z.string().max(16).default(""),
  folderId: z.uuid().nullable().default(null),
  content: docSchema.optional(),
  tags: tagsSchema.default([]),
  kind: z.enum(["note", "template"]).default("note"),
  attached: attachedSchema.default(null),
  /** Start from another note (a template, or to duplicate one). */
  from: z.uuid().optional(),
});

/** Work out the note's search text, word count and [[links]]. */
async function derive(w: Who, doc: Doc, title: string) {
  const text = toText(doc);
  const titles = linkedTitles(doc);
  const links = titles.length ? (await db.select({ id: N.id }).from(N).where(and(readable(w), isNull(N.deletedAt), inArray(sql`lower(${N.title})`, titles)))).map((r) => r.id) : [];
  return { text: `${title}\n${text}`.slice(0, 200_000), words: wordCount(`${title} ${text}`), links };
}

async function checkFolder(w: Who, folderId: string | null | undefined) {
  if (!folderId) return;
  const [f] = await db.select({ id: F.id }).from(F).where(and(eq(F.id, folderId), eq(F.orgId, w.orgId), eq(F.ownerId, w.userId)));
  if (!f) throw new ApiError("validation_failed", "That folder doesn't exist.", { folderId: ["Not found"] });
}

/** A module's own folder ("CRM"), made the first time a note is saved from it. */
async function moduleFolder(w: Who, module: string, name: string) {
  const [f] = await db.select({ id: F.id }).from(F).where(and(eq(F.orgId, w.orgId), eq(F.ownerId, w.userId), eq(F.module, module)));
  if (f) return f.id;
  const [made] = await db.insert(F).values({ orgId: w.orgId, ownerId: w.userId, name, module, color: "sky", sort: 1000 }).returning({ id: F.id });
  return made!.id;
}

const MODULE_NAMES: Record<string, string> = { crm: "CRM", invoicing: "Invoicing", hr: "HR", work: "Projects", mail: "Mail", calendar: "Calendar", chat: "Chat", inventory: "Inventory", sales: "Sales", accounting: "Accounts", helpdesk: "Helpdesk", clinic: "Clinic", education: "School", construction: "Construction", manufacturing: "Manufacturing", store: "Store", pos: "Point of sale", horeca: "Restaurant", marketing: "Marketing", documents: "Documents", objects: "Records", bi: "Reports", copilot: "Copilot", projects: "Web apps" };

export async function create(w: Who, raw: unknown) {
  const v = createSchema.parse(raw);
  let content: Doc = v.content ?? { blocks: [{ id: uid(), type: "p", text: "" }] };
  let title = v.title;
  let icon = v.icon;
  let tags = v.tags;
  if (v.from) {
    const { n } = await load(w, v.from);
    // Fresh block ids, so two notes never share them.
    content = { blocks: (n.content as Doc).blocks.map((b) => ({ ...b, id: uid() })) };
    title ||= n.kind === "template" ? n.title : `${n.title} (copy)`;
    icon ||= n.icon;
    tags = tags.length ? tags : n.tags;
  }
  await checkFolder(w, v.folderId);
  const folderId = v.folderId ?? (v.attached?.module && v.kind === "note" ? await moduleFolder(w, v.attached.module, MODULE_NAMES[v.attached.module] ?? v.attached.module[0]!.toUpperCase() + v.attached.module.slice(1)) : null);
  const d = await derive(w, content, title);
  const [n] = await db.insert(N).values({ orgId: w.orgId, ownerId: w.userId, folderId, title, icon, content, tags, kind: v.kind, attached: v.attached, ...d, updatedBy: w.userId }).returning();
  return get(w, n!.id);
}

export const updateSchema = z.object({
  title: z.string().trim().max(300).optional(),
  icon: z.string().max(16).optional(),
  color: z.string().max(20).optional(),
  content: docSchema.optional(),
  tags: tagsSchema.optional(),
  folderId: z.uuid().nullable().optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
  visibility: z.enum(["private", "view", "edit"]).optional(),
  remindAt: z.iso.datetime().nullable().optional(),
  attached: attachedSchema.optional(),
  kind: z.enum(["note", "template"]).optional(),
  /** The version the change was made on; an older one means someone else saved first. */
  baseVersion: z.number().int().optional(),
});

export async function update(w: Who, id: string, raw: unknown) {
  const v = updateSchema.parse(raw);
  const { n, a } = await load(w, id, "edit");
  const ownerOnly = (["folderId", "pinned", "locked", "visibility", "remindAt", "kind"] as const).filter((k) => v[k] !== undefined);
  if (ownerOnly.length && a !== "owner") throw new ApiError("forbidden", "Only the note's owner can change that.");
  const changesText = v.content !== undefined || v.title !== undefined;
  if (n.locked && v.locked !== false && (changesText || v.tags !== undefined || v.icon !== undefined)) throw new ApiError("conflict", "This note is locked. Unlock it to make changes.");
  if (changesText && v.baseVersion !== undefined && v.baseVersion !== n.version) {
    const [by] = n.updatedBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, n.updatedBy)) : [];
    throw new ApiError("conflict", `${by?.name ?? "Someone"} changed this note while you were editing. Reload to see their changes.`, { version: [String(n.version)] });
  }
  if (v.folderId !== undefined) await checkFolder(w, v.folderId);
  const title = v.title ?? n.title;
  const content = v.content ?? (n.content as Doc);
  const now = new Date();
  const set: Partial<typeof N.$inferInsert> = { updatedAt: now };
  for (const k of ["icon", "color", "tags", "folderId", "pinned", "locked", "visibility", "attached", "kind"] as const) if (v[k] !== undefined) (set as Record<string, unknown>)[k] = v[k];
  if (v.remindAt !== undefined) Object.assign(set, { remindAt: v.remindAt ? new Date(v.remindAt) : null, remindedAt: null });
  if (changesText) {
    Object.assign(set, { title, content, ...(await derive(w, content, title)), version: n.version + 1, updatedBy: w.userId });
    // Keep what it was, if it hasn't been kept recently.
    const [last] = await db.select({ createdAt: V.createdAt }).from(V).where(eq(V.noteId, n.id)).orderBy(desc(V.createdAt)).limit(1);
    if (!last || now.getTime() - last.createdAt.getTime() > VERSION_GAP_MS) await keepVersion(n, w.userId);
  }
  await db.update(N).set(set).where(eq(N.id, n.id));
  return get(w, n.id);
}

async function keepVersion(n: Note, by: string) {
  if (!(n.content as Doc).blocks.some((b) => b.text || b.rows || b.url) && !n.title) return;
  await db.insert(V).values({ noteId: n.id, version: n.version, title: n.title, content: n.content as Doc, words: n.words, createdBy: by });
  const old = await db.select({ id: V.id }).from(V).where(eq(V.noteId, n.id)).orderBy(desc(V.createdAt)).offset(MAX_VERSIONS);
  if (old.length) await db.delete(V).where(inArray(V.id, old.map((o) => o.id)));
}

export async function versions(w: Who, id: string) {
  await load(w, id);
  return db.select({ id: V.id, version: V.version, title: V.title, words: V.words, createdAt: V.createdAt, by: schema.users.name }).from(V).leftJoin(schema.users, eq(schema.users.id, V.createdBy)).where(eq(V.noteId, id)).orderBy(desc(V.createdAt)).limit(MAX_VERSIONS);
}

export async function version(w: Who, id: string, versionId: string) {
  await load(w, id);
  const [r] = await db.select().from(V).where(and(eq(V.id, versionId), eq(V.noteId, id)));
  if (!r) throw notFound("Version");
  return { id: r.id, version: r.version, title: r.title, content: r.content as Doc, createdAt: r.createdAt };
}

export async function restoreVersion(w: Who, id: string, versionId: string) {
  const { n } = await load(w, id, "edit");
  if (n.locked) throw new ApiError("conflict", "This note is locked. Unlock it to restore a version.");
  const v = await version(w, id, versionId);
  await keepVersion(n, w.userId);
  return update(w, id, { title: v.title, content: v.content });
}

export async function remove(w: Who, id: string) {
  const { n } = await load(w, id, "owner");
  await db.update(N).set({ deletedAt: new Date(), pinned: false, publicToken: null }).where(eq(N.id, n.id));
}

export async function restore(w: Who, id: string) {
  const [n] = await db.update(N).set({ deletedAt: null }).where(and(eq(N.id, id), eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), isNotNull(N.deletedAt))).returning({ id: N.id });
  if (!n) throw notFound("Note");
  return get(w, id);
}

/** Deletes from the trash for good (one note, or all of it). */
export async function purge(w: Who, id: string | "all") {
  const where = and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), isNotNull(N.deletedAt), id === "all" ? undefined : eq(N.id, id));
  const gone = await db.delete(N).where(where).returning({ id: N.id });
  return { deleted: gone.length };
}

/** Notes in the trash for more than 30 days go for good. */
export async function emptyOldTrash(now = new Date()) {
  await db.delete(N).where(and(isNotNull(N.deletedAt), lt(N.deletedAt, new Date(now.getTime() - 30 * 86_400_000))));
}

// ─── Sharing and publishing ────────────────────────────────────────────────

export const sharesSchema = z.object({ shares: z.array(z.object({ userId: z.uuid(), role: z.enum(["view", "edit"]) })).max(200) });

export async function setShares(w: Who, id: string, raw: unknown) {
  const { n } = await load(w, id, "owner");
  const { shares } = sharesSchema.parse(raw);
  const ids = [...new Set(shares.map((s) => s.userId).filter((u) => u !== w.userId))];
  const members = ids.length ? (await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, w.orgId), inArray(schema.memberships.userId, ids)))).map((m) => m.userId) : [];
  if (members.length !== ids.length) throw new ApiError("validation_failed", "Notes can only be shared with people in this workspace.");
  const before = new Set((await db.select({ userId: S.userId }).from(S).where(eq(S.noteId, n.id))).map((r) => r.userId));
  await db.transaction(async (tx) => {
    await tx.delete(S).where(eq(S.noteId, n.id));
    if (ids.length) await tx.insert(S).values(ids.map((userId) => ({ noteId: n.id, userId, role: shares.find((s) => s.userId === userId)!.role })));
  });
  const added = ids.filter((u) => !before.has(u));
  if (added.length) {
    const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, w.userId));
    await notify(w.orgId, added, { kind: "notes.shared", title: `${me?.name ?? "Someone"} shared “${n.title || "Untitled"}” with you`, link: `/notes/${n.id}`, values: { who: me?.name ?? "", note: n.title || "Untitled", link: `/notes/${n.id}` } });
  }
  return get(w, n.id);
}

export async function publish(w: Who, id: string, on: boolean) {
  const { n } = await load(w, id, "owner");
  await db.update(N).set({ publicToken: on ? (n.publicToken ?? randomBytes(18).toString("base64url")) : null }).where(eq(N.id, n.id));
  return get(w, n.id);
}

/** A published note, for /n/<token>. Nothing else of the workspace is shown. */
export async function publicNote(token: string) {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  const [r] = await db.select({ n: N, owner: schema.users.name, org: schema.organizations.name }).from(N).innerJoin(schema.users, eq(schema.users.id, N.ownerId)).innerJoin(schema.organizations, eq(schema.organizations.id, N.orgId)).where(and(eq(N.publicToken, token), isNull(N.deletedAt)));
  if (!r) return null;
  return { title: r.n.title, icon: r.n.icon, content: r.n.content as Doc, updatedAt: r.n.updatedAt, owner: r.owner, org: r.org, words: r.n.words };
}

export async function members(w: Who) {
  return db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, w.orgId), ne(schema.users.id, w.userId))).orderBy(asc(schema.users.name)).limit(500);
}

// ─── Folders ───────────────────────────────────────────────────────────────

export const folderSchema = z.object({ name: z.string().trim().min(1, "Name the folder").max(80), parentId: z.uuid().nullable().default(null), color: z.string().max(20).default("slate"), icon: z.string().max(16).default("") });

/** A folder and everything inside it. */
async function subtree(w: Who, folderId: string) {
  const all = await db.select({ id: F.id, parentId: F.parentId }).from(F).where(and(eq(F.orgId, w.orgId), eq(F.ownerId, w.userId)));
  const out = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return [...out];
}

export async function createFolder(w: Who, raw: unknown) {
  const v = folderSchema.parse(raw);
  await checkFolder(w, v.parentId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(F).where(and(eq(F.orgId, w.orgId), eq(F.ownerId, w.userId)));
  if (n >= 500) throw new ApiError("conflict", "You can have up to 500 folders.");
  const [f] = await db.insert(F).values({ ...v, orgId: w.orgId, ownerId: w.userId, sort: n }).returning();
  return f!;
}

export async function updateFolder(w: Who, id: string, raw: unknown) {
  const v = folderSchema.partial().extend({ sort: z.number().optional() }).parse(raw);
  const [cur] = await db.select().from(F).where(and(eq(F.id, id), eq(F.orgId, w.orgId), eq(F.ownerId, w.userId)));
  if (!cur) throw notFound("Folder");
  if (v.parentId) {
    await checkFolder(w, v.parentId);
    if ((await subtree(w, id)).includes(v.parentId)) throw new ApiError("validation_failed", "A folder can't go inside itself.");
  }
  const [f] = await db.update(F).set(v).where(eq(F.id, id)).returning();
  return f!;
}

/** Deletes a folder; its notes and folders move up to its parent. */
export async function deleteFolder(w: Who, id: string) {
  const [cur] = await db.select().from(F).where(and(eq(F.id, id), eq(F.orgId, w.orgId), eq(F.ownerId, w.userId)));
  if (!cur) throw notFound("Folder");
  await db.transaction(async (tx) => {
    await tx.update(N).set({ folderId: cur.parentId }).where(and(eq(N.orgId, w.orgId), eq(N.folderId, id)));
    await tx.update(F).set({ parentId: cur.parentId }).where(and(eq(F.orgId, w.orgId), eq(F.parentId, id)));
    await tx.delete(F).where(eq(F.id, id));
  });
}

/** Moves several notes at once (drag and drop of a selection). */
export async function moveNotes(w: Who, ids: string[], folderId: string | null) {
  await checkFolder(w, folderId);
  const moved = await db.update(N).set({ folderId, updatedAt: new Date() }).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), inArray(N.id, ids.slice(0, 500)))).returning({ id: N.id });
  return { moved: moved.length };
}

// ─── Daily notes ───────────────────────────────────────────────────────────

const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const istTime = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(11, 16);

/**
 * The day's note, made the first time it's opened: your meetings that day
 * (from Calendar) and your open tasks due by then (from Projects) are written
 * in, as links.
 */
export async function daily(w: Who, day = istDay()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError("validation_failed", "Pick a day.");
  const [has] = await db.select({ id: N.id }).from(N).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), eq(N.kind, "daily"), eq(N.day, day), isNull(N.deletedAt)));
  if (has) return get(w, has.id);
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86_400_000);
  const events = await db.select({ id: schema.calEvents.id, title: schema.calEvents.title, startsAt: schema.calEvents.startsAt, allDay: schema.calEvents.allDay }).from(schema.calEvents).where(and(eq(schema.calEvents.orgId, w.orgId), eq(schema.calEvents.ownerId, w.userId), gte(schema.calEvents.startsAt, start), lt(schema.calEvents.startsAt, end), ne(schema.calEvents.status, "cancelled"))).orderBy(asc(schema.calEvents.startsAt)).limit(20);
  const tasks = await db.select({ id: schema.workTasks.id, title: schema.workTasks.title, dueDate: schema.workTasks.dueDate }).from(schema.workTasks).where(and(eq(schema.workTasks.orgId, w.orgId), eq(schema.workTasks.assigneeId, w.userId), ne(schema.workTasks.status, "done"), isNotNull(schema.workTasks.dueDate), lte(schema.workTasks.dueDate, day))).orderBy(asc(schema.workTasks.dueDate)).limit(20);
  const blocks = dailyBlocks(day, events.map((e) => ({ time: e.allDay ? "All day" : istTime(e.startsAt), title: e.title, href: "/calendar" })), tasks.map((t) => ({ title: t.dueDate && t.dueDate < day ? `${t.title} (was due ${t.dueDate})` : t.title, href: `/work/tasks/${t.id}`, due: t.dueDate })));
  const title = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const content = { blocks };
  try {
    const [n] = await db.insert(N).values({ orgId: w.orgId, ownerId: w.userId, kind: "daily", day, title, icon: "🗓️", content, ...(await derive(w, content, title)), tags: ["daily"], updatedBy: w.userId }).returning();
    return get(w, n!.id);
  } catch {
    // Opened twice at once: the other one won.
    const [again] = await db.select({ id: N.id }).from(N).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), eq(N.kind, "daily"), eq(N.day, day), isNull(N.deletedAt)));
    if (again) return get(w, again.id);
    throw new ApiError("conflict", "Couldn't make the daily note — try again.");
  }
}

/** Days that have a daily note in a month (for the calendar strip). */
export async function dailyDays(w: Who, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return (await db.select({ day: N.day }).from(N).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), eq(N.kind, "daily"), isNull(N.deletedAt), sql`to_char(${N.day}, 'YYYY-MM') = ${month}`))).map((r) => r.day);
}

// ─── Reminders ─────────────────────────────────────────────────────────────

export async function notesTick(now = new Date()) {
  const due = await db.select({ id: N.id, orgId: N.orgId, ownerId: N.ownerId, title: N.title }).from(N).where(and(isNotNull(N.remindAt), lte(N.remindAt, now), isNull(N.remindedAt), isNull(N.deletedAt))).limit(200);
  for (const n of due) {
    const [claimed] = await db.update(N).set({ remindedAt: now }).where(and(eq(N.id, n.id), isNull(N.remindedAt))).returning({ id: N.id });
    if (!claimed) continue;
    await notify(n.orgId, [n.ownerId], { kind: "notes.reminder", title: `Reminder: ${n.title || "a note"}`, link: `/notes/${n.id}`, values: { note: n.title || "Untitled", link: `/notes/${n.id}` } });
  }
  await emptyOldTrash(now);
  return due.length;
}

// ─── Export ────────────────────────────────────────────────────────────────

export async function exportCsv(w: Who) {
  const rows = await db.select({ n: N, folder: F.name }).from(N).leftJoin(F, eq(F.id, N.folderId)).where(and(eq(N.orgId, w.orgId), eq(N.ownerId, w.userId), isNull(N.deletedAt))).orderBy(desc(N.updatedAt)).limit(5000);
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["title", "folder", "tags", "kind", "day", "words", "updated", "text"];
  return [head.join(","), ...rows.map(({ n, folder }) => [n.title, folder ?? "", n.tags.join("; "), n.kind, n.day ?? "", n.words, n.updatedAt.toISOString(), plainOf(n.text).slice(n.title.length + 1, 30_000)].map(cell).join(","))].join("\n");
}

/** Imported notes (Markdown or text files, or rows of a sheet): one note each. */
export const importSchema = z.object({ notes: z.array(z.object({ title: z.string().trim().max(300).default(""), content: docSchema, tags: tagsSchema.default([]) })).min(1).max(200), folderId: z.uuid().nullable().default(null) });

export async function importNotes(w: Who, raw: unknown) {
  const v = importSchema.parse(raw);
  await checkFolder(w, v.folderId);
  const ids: string[] = [];
  for (const x of v.notes) {
    const d = await derive(w, x.content, x.title);
    const [n] = await db.insert(N).values({ orgId: w.orgId, ownerId: w.userId, folderId: v.folderId, title: x.title, content: x.content, tags: x.tags, ...d, updatedBy: w.userId }).returning({ id: N.id });
    ids.push(n!.id);
  }
  return { created: ids.length, ids };
}

/** Notes the AI may read for "ask my notes": the person's readable notes that best match the words. */
export async function searchForAi(w: Who, question: string, limit = 8) {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]{2,}/gu) ?? [])].slice(0, 8);
  if (!words.length) return [];
  const score = sql<number>`(${sql.join(words.map((x) => sql`(case when ${N.text} ilike ${contains(x)} then 1 else 0 end)`), sql` + `)})`;
  return db.select({ id: N.id, title: N.title, text: N.text, updatedAt: N.updatedAt, score }).from(N).where(and(readable(w), isNull(N.deletedAt), sql`${score} > 0`)).orderBy(desc(score), desc(N.updatedAt)).limit(limit);
}
