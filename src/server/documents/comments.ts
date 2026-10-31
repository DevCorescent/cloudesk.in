// Comments on a written document. A thread is anchored to the text it's about
// by Yjs relative positions (so it follows edits and never changes the
// document — people who can only comment can still start one); replies hang
// off it. Anyone who can comment can start,
// reply to and resolve threads; only the author edits or deletes a comment
// (and whoever can edit the document can delete a thread).
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { appUrl } from "../services/mail";
import { atLeast, check, getFileAs, openFolders, roleFor, type Scope } from "./access";
import { act } from "./drive";

const C = schema.docComments;

export async function comments(s: Scope, fileId: string) {
  const { file: f } = await getFileAs(s, fileId);
  const rows = await db.select({ c: C, name: schema.users.name }).from(C).leftJoin(schema.users, eq(schema.users.id, C.createdBy)).where(eq(C.fileId, f.id)).orderBy(asc(C.createdAt));
  const shape = (r: (typeof rows)[number]) => ({ id: r.c.id, parentId: r.c.parentId, body: r.c.body, quote: r.c.quote, by: r.c.createdBy, name: r.name ?? "Someone", at: r.c.createdAt.toISOString(), editedAt: r.c.editedAt?.toISOString() ?? null, mine: r.c.createdBy === s.userId });
  const roots = rows.filter((r) => !r.c.parentId);
  return roots.map((r) => ({ ...shape(r), anchor: r.c.anchor, resolved: !!r.c.resolvedAt, resolvedAt: r.c.resolvedAt?.toISOString() ?? null, replies: rows.filter((x) => x.c.parentId === r.c.id).map(shape) }));
}

const addSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  quote: z.string().max(1000).default(""),
  anchor: z.object({ from: z.string().max(400), to: z.string().max(400) }).nullable().default(null),
  body: z.string().trim().min(1, "Write something").max(5000),
  mentions: z.array(z.uuid()).max(50).default([]),
});

async function commentable(s: Scope, fileId: string) {
  const r = await getFileAs(s, fileId);
  if (r.file.kind !== "doc") throw new ApiError("conflict", "Comments are for written documents");
  if (!atLeast(r.role, "comment")) throw new ApiError("forbidden", "You can view this document, but not comment on it");
  return r;
}

export async function addComment(s: Scope, fileId: string, raw: unknown) {
  const { file: f } = await commentable(s, fileId);
  const v = check(addSchema, raw);
  let root: typeof C.$inferSelect | undefined;
  if (v.parentId) {
    [root] = await db.select().from(C).where(and(eq(C.id, v.parentId), eq(C.fileId, f.id), isNull(C.parentId)));
    if (!root) throw notFound("Comment");
  }
  const [row] = await db.insert(C).values({ orgId: s.orgId, fileId: f.id, parentId: v.parentId, quote: v.parentId ? "" : v.quote, anchor: v.parentId ? null : v.anchor, body: v.body, mentions: v.mentions, createdBy: s.userId }).returning();
  // A reply reopens a resolved thread.
  if (root?.resolvedAt) await db.update(C).set({ resolvedAt: null, resolvedBy: null }).where(eq(C.id, root.id));
  await act(s, "commented", { fileId: f.id });
  await tell(s, f, row, root);
  return row;
}

/** The owner, anyone @mentioned, and others in the thread — if they can open the document. */
async function tell(s: Scope, f: typeof schema.docFiles.$inferSelect, c: typeof C.$inferSelect, root?: typeof C.$inferSelect) {
  const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
  const who = me?.name ?? "Someone";
  const link = `/documents/d/${f.id}?comment=${root?.id ?? c.id}`;
  const thread = root ? await db.select({ by: C.createdBy }).from(C).where(or(eq(C.id, root.id), eq(C.parentId, root.id))) : [];
  const mentioned = new Set(c.mentions);
  const others = new Set([f.createdBy, ...thread.map((t) => t.by)].filter((x): x is string => !!x && !mentioned.has(x)));
  const everyone = [...new Set([...mentioned, ...others])].filter((id) => id !== s.userId);
  if (!everyone.length) return;
  const members = await db.select({ userId: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, everyone)));
  const { can } = await import("../authz/permissions");
  const text = c.body.slice(0, 200);
  for (const m of members) {
    const as = { orgId: s.orgId, userId: m.userId, manage: can(m.role as never, "doc:manage"), write: can(m.role as never, "doc:write") };
    if (!roleFor(as, f, await openFolders(as))) continue;
    if (mentioned.has(m.userId)) await notify(s.orgId, [m.userId], { kind: "documents.mention", title: `${who} mentioned you in a comment on “${f.title}”`, body: text, link, values: { who, title: f.title, text, link: appUrl(link) } });
    else await notify(s.orgId, [m.userId], { kind: "documents.comment", title: root ? `${who} replied on “${f.title}”` : `${who} commented on “${f.title}”`, body: text, link, values: { who, title: f.title, text, link: appUrl(link) } });
  }
}

async function getComment(fileId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Comment");
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.fileId, fileId)));
  if (!c) throw notFound("Comment");
  return c;
}

export async function editComment(s: Scope, fileId: string, id: string, raw: unknown) {
  const { file: f } = await commentable(s, fileId);
  const c = await getComment(f.id, id);
  if (c.createdBy !== s.userId) throw new ApiError("forbidden", "Only whoever wrote a comment can change it");
  const { body } = check(z.object({ body: z.string().trim().min(1).max(5000) }), raw);
  const [row] = await db.update(C).set({ body, editedAt: new Date() }).where(eq(C.id, c.id)).returning();
  return row;
}

export async function deleteComment(s: Scope, fileId: string, id: string) {
  const { file: f, role } = await commentable(s, fileId);
  const c = await getComment(f.id, id);
  if (c.createdBy !== s.userId && role !== "edit") throw new ApiError("forbidden", "Only whoever wrote a comment can delete it");
  await db.delete(C).where(or(eq(C.id, c.id), eq(C.parentId, c.id)));
  return { thread: !c.parentId };
}

export async function resolveComment(s: Scope, fileId: string, id: string, raw: unknown) {
  const { file: f } = await commentable(s, fileId);
  const c = await getComment(f.id, id);
  if (c.parentId) throw new ApiError("conflict", "Resolve the thread, not a reply");
  const { resolved } = check(z.object({ resolved: z.boolean() }), raw);
  await db.update(C).set(resolved ? { resolvedAt: new Date(), resolvedBy: s.userId } : { resolvedAt: null, resolvedBy: null }).where(eq(C.id, c.id));
  if (resolved) await act(s, "resolved_comment", { fileId: f.id });
  return { resolved };
}
