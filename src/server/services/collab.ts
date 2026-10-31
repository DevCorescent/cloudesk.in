import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "./audit";
import { appUrl, sendMail } from "./mail";

// ─── Presence ────────────────────────────────────────────────────────────────

export const PRESENCE_TTL_MS = 45_000;

export async function heartbeat(projectId: string, userId: string, pageId: string, sectionId: string) {
  await db
    .insert(schema.editorPresence)
    .values({ projectId, userId, pageId, sectionId })
    .onConflictDoUpdate({ target: [schema.editorPresence.projectId, schema.editorPresence.userId], set: { pageId, sectionId, seenAt: new Date() } });
  return othersHere(projectId, userId);
}

export async function othersHere(projectId: string, userId: string) {
  return db
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, pageId: schema.editorPresence.pageId, sectionId: schema.editorPresence.sectionId, seenAt: schema.editorPresence.seenAt })
    .from(schema.editorPresence)
    .innerJoin(schema.users, eq(schema.users.id, schema.editorPresence.userId))
    .where(and(eq(schema.editorPresence.projectId, projectId), ne(schema.editorPresence.userId, userId), gt(schema.editorPresence.seenAt, new Date(Date.now() - PRESENCE_TTL_MS))));
}

export async function leave(projectId: string, userId: string) {
  await db.delete(schema.editorPresence).where(and(eq(schema.editorPresence.projectId, projectId), eq(schema.editorPresence.userId, userId)));
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function listComments(projectId: string, opts: { reviewLinkId?: string } = {}) {
  return db
    .select({
      id: schema.designComments.id,
      pageId: schema.designComments.pageId,
      sectionId: schema.designComments.sectionId,
      parentId: schema.designComments.parentId,
      body: schema.designComments.body,
      authorId: schema.designComments.authorId,
      authorName: schema.users.name,
      guestName: schema.designComments.guestName,
      fromReview: schema.designComments.reviewLinkId,
      resolvedAt: schema.designComments.resolvedAt,
      createdAt: schema.designComments.createdAt,
    })
    .from(schema.designComments)
    .leftJoin(schema.users, eq(schema.users.id, schema.designComments.authorId))
    .where(and(eq(schema.designComments.projectId, projectId), opts.reviewLinkId ? eq(schema.designComments.reviewLinkId, opts.reviewLinkId) : undefined))
    .orderBy(asc(schema.designComments.createdAt))
    .limit(1000);
}

/** Org members mentioned as @firstname or @email-name in a comment. */
async function mentioned(orgId: string, body: string) {
  const handles = new Set([...body.matchAll(/@([\p{L}\p{N}._-]{2,40})/gu)].map((m) => m[1].toLowerCase()));
  if (!handles.size) return [];
  const members = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId));
  return members.filter((m) => handles.has(m.email.split("@")[0].toLowerCase()) || handles.has(m.name.split(/\s+/)[0].toLowerCase()) || handles.has(m.email.toLowerCase()));
}

export async function addComment(project: { id: string; orgId: string; name: string }, input: { pageId: string; sectionId: string; body: string; parentId?: string | null; authorId?: string | null; guestName?: string | null; reviewLinkId?: string | null }) {
  const body = input.body.trim();
  if (!body) throw new ApiError("validation_failed", "Write a comment first", { body: ["Required"] });
  if (input.parentId) {
    const [p] = await db.select({ id: schema.designComments.id }).from(schema.designComments).where(and(eq(schema.designComments.id, input.parentId), eq(schema.designComments.projectId, project.id)));
    if (!p) throw notFound("Comment");
  }
  const [c] = await db
    .insert(schema.designComments)
    .values({ projectId: project.id, pageId: input.pageId, sectionId: input.sectionId, parentId: input.parentId ?? null, authorId: input.authorId ?? null, guestName: input.guestName ?? null, reviewLinkId: input.reviewLinkId ?? null, body: body.slice(0, 4000) })
    .returning();
  const [author] = input.authorId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, input.authorId)) : [];
  const who = author?.name ?? `${input.guestName ?? "A client"} (client review)`;
  const link = appUrl(`/projects/${project.id}/builder`);
  for (const m of (await mentioned(project.orgId, body)).filter((x) => x.id !== input.authorId)) {
    await sendMail({ to: m.email, subject: `${who} mentioned you on ${project.name}`, body: `${who} wrote:\n\n${body}\n\nOpen the builder: ${link}` }).catch(() => {});
  }
  return c;
}

export async function resolveComment(projectId: string, id: string, userId: string, resolved: boolean) {
  const r = await db
    .update(schema.designComments)
    .set(resolved ? { resolvedAt: new Date(), resolvedBy: userId } : { resolvedAt: null, resolvedBy: null })
    .where(and(eq(schema.designComments.id, id), eq(schema.designComments.projectId, projectId)))
    .returning({ id: schema.designComments.id });
  if (!r.length) throw notFound("Comment");
}

export async function deleteComment(projectId: string, id: string, userId: string, canModerate: boolean) {
  const [c] = await db.select().from(schema.designComments).where(and(eq(schema.designComments.id, id), eq(schema.designComments.projectId, projectId)));
  if (!c) throw notFound("Comment");
  if (c.authorId !== userId && !canModerate) throw new ApiError("forbidden", "You can delete only your own comments");
  // Replies go with the comment they answer.
  await db.delete(schema.designComments).where(and(eq(schema.designComments.projectId, projectId), or(eq(schema.designComments.id, c.id), eq(schema.designComments.parentId, c.id))));
}

// ─── Review links ────────────────────────────────────────────────────────────

export async function createReviewLink(project: { id: string; orgId: string }, userId: string, input: { deploymentId?: string; label: string; days: number }) {
  const deps = await db
    .select({ id: schema.deployments.id, status: schema.deployments.status })
    .from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, project.id), eq(schema.deployments.status, "ready"), input.deploymentId ? eq(schema.deployments.id, input.deploymentId) : undefined))
    .orderBy(desc(schema.deployments.createdAt))
    .limit(1);
  if (!deps.length) throw new ApiError("conflict", "Deploy a preview first; clients review a deployed version");
  const token = randomToken(24);
  const [l] = await db
    .insert(schema.reviewLinks)
    .values({ projectId: project.id, deploymentId: deps[0].id, tokenHash: sha256(token), label: input.label, expiresAt: new Date(Date.now() + input.days * 86400_000), createdBy: userId })
    .returning();
  await audit({ orgId: project.orgId, actorId: userId, action: "review_link.created", targetType: "review_link", targetId: l.id, metadata: { deploymentId: deps[0].id, days: input.days } });
  return { link: l, url: appUrl(`/review/${token}`) };
}

export async function listReviewLinks(projectId: string) {
  return db.select().from(schema.reviewLinks).where(eq(schema.reviewLinks.projectId, projectId)).orderBy(desc(schema.reviewLinks.createdAt));
}

export async function revokeReviewLink(projectId: string, id: string) {
  const r = await db.update(schema.reviewLinks).set({ revokedAt: new Date() }).where(and(eq(schema.reviewLinks.id, id), eq(schema.reviewLinks.projectId, projectId), isNull(schema.reviewLinks.revokedAt))).returning({ id: schema.reviewLinks.id });
  if (!r.length) throw notFound("Review link");
}

/** A usable link for a token, with its project and deployment. */
export async function reviewLinkByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [r] = await db
    .select({ link: schema.reviewLinks, project: { id: schema.projects.id, orgId: schema.projects.orgId, name: schema.projects.name, archivedAt: schema.projects.archivedAt } })
    .from(schema.reviewLinks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.reviewLinks.projectId))
    .where(eq(schema.reviewLinks.tokenHash, sha256(token)));
  if (!r || r.link.revokedAt || r.link.expiresAt < new Date() || r.project.archivedAt) return null;
  return r;
}

export async function decideReview(token: string, input: { name: string; decision: "approved" | "changes_requested"; note: string }) {
  const r = await reviewLinkByToken(token);
  if (!r) throw notFound("Review link");
  await db.update(schema.reviewLinks).set({ status: input.decision, decidedBy: input.name, decisionNote: input.note, decidedAt: new Date() }).where(eq(schema.reviewLinks.id, r.link.id));
  const team = await db.select({ email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, r.project.orgId), inArray(schema.memberships.role, ["owner", "admin", "designer", "editor"])));
  for (const t of team) {
    await sendMail({ to: t.email, subject: `${input.name} ${input.decision === "approved" ? "approved" : "requested changes to"} ${r.project.name}`, body: `${input.name} ${input.decision === "approved" ? "approved the design" : "asked for changes"}${r.link.label ? ` (${r.link.label})` : ""}.${input.note ? `\n\n“${input.note}”` : ""}\n\nComments and history: ${appUrl(`/projects/${r.project.id}/builder`)}` }).catch(() => {});
  }
}
