// Who is asking and what they may open. Every Documents call starts here: the
// workspace (module on), whether the member adds files and contracts
// (doc:write) or manages folders and approves (doc:manage), and which folders
// they can see.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { settingsSchema, type DocSettings } from "@/lib/documents/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: DocSettings; has: (m: ModuleId) => boolean };
type Folder = typeof schema.docFolders.$inferSelect;

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "doc:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "documents")) throw new ApiError("forbidden", "Switch on Documents & e-sign in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "doc:write"), manage: can(role, "doc:manage"), settings: await getSettings(orgId), has: (id) => visibleTo(visible, id) };
}

export function requireWrite(s: Pick<Scope, "write">) {
  if (!s.write) throw new ApiError("forbidden", "Your role can open documents, but not add or change them");
}
export function requireManage(s: Pick<Scope, "manage">) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
}

export async function getSettings(orgId: string): Promise<DocSettings> {
  const [row] = await db.select().from(schema.docSettings).where(eq(schema.docSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await db.insert(schema.docSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.docSettings.orgId, set: { settings: v } });
  return v;
}

export async function ensureSettings(orgId: string) {
  await db.insert(schema.docSettings).values({ orgId, settings: settingsSchema.parse({}) }).onConflictDoNothing();
}

export async function nextNumber(orgId: string, kind: "contract", prefix: string) {
  await db.insert(schema.docSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update doc_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

/** Whether a member can open a folder: everyone, owners and admins, the chosen people, or (private) only whoever made it. A folder inside one they can't open stays closed. */
export function opens(s: Pick<Scope, "manage" | "userId">, f: Pick<Folder, "access" | "memberIds"> & { createdBy?: string | null }) {
  if (f.access === "private") return f.createdBy === s.userId;
  if (s.manage) return true;
  if (f.access === "managers") return false;
  if (f.access === "members") return f.memberIds.includes(s.userId);
  return true;
}

/**
 * The folders this member can open: by the folders' own rules (a folder is only
 * open if every folder above it is), or because it — or a folder above it — is
 * shared with them. `role` is what a share lets them do there. Folders in the
 * trash, and everything under them, are left out unless `trashed` is asked for.
 */
export async function openFolders(s: Pick<Scope, "orgId" | "manage" | "userId"> & { write?: boolean }, opts: { trashed?: boolean } = {}) {
  const [all, shares] = await Promise.all([
    db.select().from(schema.docFolders).where(eq(schema.docFolders.orgId, s.orgId)),
    db.select({ fileId: schema.docShares.fileId, folderId: schema.docShares.folderId, role: schema.docShares.role }).from(schema.docShares).where(and(eq(schema.docShares.orgId, s.orgId), eq(schema.docShares.userId, s.userId))),
  ]);
  const byId = new Map(all.map((f) => [f.id, f]));
  const folderShares = new Map(shares.filter((x) => x.folderId).map((x) => [x.folderId!, x.role as FileRole]));
  const fileShares = new Map(shares.filter((x) => x.fileId).map((x) => [x.fileId!, x.role as FileRole]));
  /** The strongest share on a folder or any folder above it. */
  const sharedRole = (id: string | null, depth = 0): FileRole | null => {
    if (!id || depth > 30) return null;
    const f = byId.get(id);
    if (!f) return null;
    return best(folderShares.get(id) ?? null, sharedRole(f.parentId, depth + 1));
  };
  const byRules = (f: Folder, depth = 0): boolean => opens(s, f) && (!f.parentId || depth > 30 || (byId.has(f.parentId) && byRules(byId.get(f.parentId)!, depth + 1)));
  const inTrash = (f: Folder, depth = 0): boolean => !!f.deletedAt || (!!f.parentId && depth < 30 && !!byId.get(f.parentId) && inTrash(byId.get(f.parentId)!, depth + 1));
  const base: FileRole = s.write === false ? "view" : "edit";
  const roleOf = new Map<string, FileRole>();
  for (const f of all) {
    if (!opts.trashed && inTrash(f)) continue;
    const r = best(byRules(f) ? (f.createdBy === s.userId ? "edit" : base) : null, sharedRole(f.id));
    if (r) roleOf.set(f.id, r);
  }
  return { all, byId, open: new Set(roleOf.keys()), roleOf, fileShares, sharedRole, inTrash };
}

export type FileRole = "view" | "comment" | "edit";
const RANK: Record<FileRole, number> = { view: 1, comment: 2, edit: 3 };
export const best = (a: FileRole | null, b: FileRole | null): FileRole | null => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);
export const atLeast = (r: FileRole | null, need: FileRole) => !!r && RANK[r] >= RANK[need];
export type Access = Awaited<ReturnType<typeof openFolders>>;
type FileRow = typeof schema.docFiles.$inferSelect;

/**
 * What a member may do with a file, or null if they can't see it. Whoever made
 * it can always edit it; a private file is theirs and the people it's shared
 * with; otherwise its folder decides (top-level team files are open to the
 * team), and a share on the file or a folder above it can add to that.
 */
export function roleFor(s: Pick<Scope, "userId" | "write">, f: Pick<FileRow, "id" | "folderId" | "access" | "createdBy">, a: Access): FileRole | null {
  if (f.createdBy === s.userId) return "edit";
  const direct = a.fileShares.get(f.id) ?? null;
  if (f.access === "private") return best(direct, f.folderId ? a.sharedRole(f.folderId) : null);
  // The folder's role already counts shares on it and above it.
  const viaFolder = !f.folderId ? (s.write ? "edit" : "view") : (a.roleOf.get(f.folderId) ?? null);
  return best(viaFolder, direct);
}

/** A file this member can see (not in the trash unless asked), with what they may do with it. */
export async function getFileAs(s: Scope, id: string, opts: { trashed?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Document");
  const [f] = await db.select().from(schema.docFiles).where(and(eq(schema.docFiles.id, id), eq(schema.docFiles.orgId, s.orgId)));
  if (!f) throw notFound("Document");
  const a = await openFolders(s, { trashed: opts.trashed });
  const role = roleFor(s, f, a);
  if (!role) throw notFound("Document");
  if (!opts.trashed && (f.deletedAt || (f.folderId && a.byId.get(f.folderId) && a.inTrash(a.byId.get(f.folderId)!)))) throw notFound("Document");
  return { file: f, role, access: a };
}

export async function getFile(s: Scope, id: string) {
  return (await getFileAs(s, id)).file;
}

/** The file, if this member may change it. */
export async function editableFile(s: Scope, id: string) {
  const r = await getFileAs(s, id);
  if (r.role !== "edit") throw new ApiError("forbidden", "You can open this, but not change it");
  return r;
}

export async function team(orgId: string) {
  return db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.role} <> 'employee'`)).orderBy(schema.users.name);
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
