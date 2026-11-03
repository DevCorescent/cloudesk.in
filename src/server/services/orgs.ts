import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
import { canAssignRole, type Role } from "../authz/permissions";
import { ApiError, forbidden, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "./audit";
import { appUrl, sendMail } from "./mail";
import { assertWithinLimit } from "../billing/billing";
import { entitlementsFor, startTrial } from "../billing/subscriptions";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = Db | Tx;

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "untitled"
  );
}

export async function createOrganization(exec: Exec, input: { name: string; ownerId: string }) {
  const base = slugify(input.name);
  const [{ n }] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.organizations)
    .where(sql`${schema.organizations.slug} ~ ${`^${base}(-[0-9]+)?$`}`);
  const slug = n === 0 ? base : `${base}-${n + 1}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const [org] = await exec.insert(schema.organizations).values({ name: input.name, slug }).returning();
  await exec.insert(schema.memberships).values({ orgId: org.id, userId: input.ownerId, role: "owner" });
  // Every new workspace starts on the free trial of everything.
  await startTrial(exec, org.id);
  return org;
}

export async function listOrgsForUser(userId: string) {
  const rows = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug, role: schema.memberships.role, requireMfa: schema.organizations.requireMfa, modules: schema.organizations.modules, industry: schema.organizations.industry, partsOff: schema.organizations.partsOff, customRole: schema.customRoles.name, allowed: schema.customRoles.modules })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.organizations.createdAt));
  // What each workspace's plan includes. After it ends, what it had stays readable (writes are refused by the server).
  const ents = await entitlementsFor(rows.map((r) => r.id));
  return rows.map((r) => {
    const e = ents.get(r.id);
    return { ...r, entitled: e ? (e.state === "expired" ? e.had : e.modules) : null, plan: e ? { state: e.state, name: e.planName, until: e.until?.toISOString() ?? null } : null };
  });
}

export async function listMembers(orgId: string) {
  return db
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, customRoleId: schema.memberships.customRoleId, joinedAt: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.memberships.createdAt));
}

async function ownerCount(orgId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner")));
  return n;
}

/** A built-in role, or (with `customRoleId`) a workspace role built on `role`. */
export async function changeMemberRole(orgId: string, actor: { id: string; role: Role }, targetUserId: string, role: Role, customRoleId: string | null = null) {
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)));
  if (!m) throw notFound("Member");
  if (!canAssignRole(actor.role, role) || !canAssignRole(actor.role, m.role)) throw forbidden("You cannot assign this role");
  if (m.role === "owner" && role !== "owner" && (await ownerCount(orgId)) <= 1) {
    throw new ApiError("conflict", "An organization needs at least one owner");
  }
  await db.update(schema.memberships).set({ role, customRoleId }).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)));
  await audit({ orgId, actorId: actor.id, action: "member.role_changed", targetType: "user", targetId: targetUserId, metadata: { from: m.role, to: role, ...(customRoleId ? { customRoleId } : {}) } });
}

export async function removeMember(orgId: string, actor: { id: string; role: Role }, targetUserId: string) {
  const [m] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)));
  if (!m) throw notFound("Member");
  const self = actor.id === targetUserId;
  if (!self && !canAssignRole(actor.role, m.role)) throw forbidden("You cannot remove this member");
  if (m.role === "owner" && (await ownerCount(orgId)) <= 1) throw new ApiError("conflict", "An organization needs at least one owner");
  await db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)));
  await audit({ orgId, actorId: actor.id, action: self ? "member.left" : "member.removed", targetType: "user", targetId: targetUserId });
}

const INVITE_TTL_MS = 7 * 24 * 3600_000;

/**
 * Invites someone by email — or, with `userId`, an account found by its
 * username, whose email the inviter never sees. They get an email with the
 * link, and when they're signed in the invite waits for them in Cloudesk too.
 */
export async function createInvitation(orgId: string, actor: { id: string; role: Role; name: string }, email: string, role: Role, opts: { userId?: string } = {}) {
  if (!canAssignRole(actor.role, role)) throw forbidden("You cannot invite members with this role");
  await assertWithinLimit(orgId, "seats");
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, orgId), sql`lower(${schema.users.email}) = ${email.toLowerCase()}`));
  if (existing.length) throw new ApiError("conflict", "This person is already a member");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const token = randomToken();
  const [inv] = await db
    .insert(schema.invitations)
    .values({ orgId, email: email.trim(), userId: opts.userId ?? null, role, tokenHash: sha256(token), invitedBy: actor.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning();
  await sendMail({
    to: email,
    subject: `${actor.name} invited you to ${org.name}`,
    body: `You have been invited to join ${org.name} as ${role}.\n\nAccept: ${appUrl(`/invite?token=${token}`)}${opts.userId ? "\n\nOr just open Cloudesk: the invitation is waiting for you there too." : ""}\n\nThis invitation expires in 7 days.`,
  });
  await audit({ orgId, actorId: actor.id, action: "invitation.created", targetType: "invitation", targetId: inv.id, metadata: opts.userId ? { userId: opts.userId, role } : { email, role } });
  return { invitation: inv, token };
}

/** Pending invitations. Ones sent to a username show the person, never their email. */
export async function listInvitations(orgId: string) {
  const rows = await db
    .select({ id: schema.invitations.id, email: schema.invitations.email, userId: schema.invitations.userId, name: schema.users.name, username: schema.users.username, role: schema.invitations.role, expiresAt: schema.invitations.expiresAt, createdAt: schema.invitations.createdAt })
    .from(schema.invitations)
    .leftJoin(schema.users, eq(schema.users.id, schema.invitations.userId))
    .where(and(eq(schema.invitations.orgId, orgId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
  return rows.map((r) => ({ id: r.id, email: r.userId ? "" : r.email, label: r.userId ? `${r.name ?? "Cloudesk member"}${r.username ? ` · @${r.username}` : ""}` : r.email, role: r.role, expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

/** Invitations waiting for this person: sent to their username or to their email. */
export async function myInvitations(user: { id: string; email: string }) {
  const I = schema.invitations;
  const rows = await db
    .select({ id: I.id, orgName: schema.organizations.name, role: I.role, inviter: schema.users.name, expiresAt: I.expiresAt })
    .from(I)
    .innerJoin(schema.organizations, eq(schema.organizations.id, I.orgId))
    .leftJoin(schema.users, eq(schema.users.id, I.invitedBy))
    .where(and(sql`(${I.userId} = ${user.id} or lower(${I.email}) = ${user.email.toLowerCase()})`, isNull(I.acceptedAt), isNull(I.revokedAt), gt(I.expiresAt, new Date()), sql`not exists (select 1 from memberships m where m.org_id = ${I.orgId} and m.user_id = ${user.id})`))
    .orderBy(asc(I.createdAt));
  return rows.map((r) => ({ id: r.id, orgName: r.orgName, role: r.role, inviter: r.inviter ?? "Someone", expiresAt: r.expiresAt }));
}

/** Accept or decline an invitation from inside Cloudesk, without the emailed link. */
export async function answerInvitation(id: string, user: { id: string; email: string }, accept: boolean) {
  const [row] = await db
    .select({ inv: schema.invitations, orgName: schema.organizations.name })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.orgId))
    .where(eq(schema.invitations.id, id));
  const mine = row && (row.inv.userId === user.id || row.inv.email.toLowerCase() === user.email.toLowerCase());
  if (!row || !mine || row.inv.acceptedAt || row.inv.revokedAt || row.inv.expiresAt < new Date()) throw new ApiError("bad_request", "This invitation is invalid or has expired");
  if (!accept) {
    await db.update(schema.invitations).set({ revokedAt: new Date() }).where(and(eq(schema.invitations.id, id), isNull(schema.invitations.acceptedAt)));
    await audit({ orgId: row.inv.orgId, actorId: user.id, action: "invitation.declined", targetType: "invitation", targetId: id });
    return { orgId: row.inv.orgId, orgName: row.orgName, joined: false };
  }
  await join({ id, orgId: row.inv.orgId, role: row.inv.role }, user);
  return { orgId: row.inv.orgId, orgName: row.orgName, joined: true };
}

async function join(inv: { id: string; orgId: string; role: Role }, user: { id: string; email: string }) {
  // Seats are checked again on accepting: an invitation sent during a bigger plan (or the trial) can't overshoot today's.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.orgId, inv.orgId));
  const [member] = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, inv.orgId), eq(schema.memberships.userId, user.id)));
  if (!member) await assertWithinLimit(inv.orgId, "seats", n);
  await db.transaction(async (tx) => {
    const used = await tx
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(schema.invitations.id, inv.id), isNull(schema.invitations.acceptedAt)))
      .returning();
    if (!used.length) throw new ApiError("conflict", "This invitation was already used");
    await tx.insert(schema.memberships).values({ orgId: inv.orgId, userId: user.id, role: inv.role }).onConflictDoNothing();
    // An HR record with this email becomes theirs, for self-service.
    await tx.execute(sql`
      update hr_employees set user_id = ${user.id}
      where id = (select id from hr_employees where org_id = ${inv.orgId} and lower(email) = ${user.email.toLowerCase()} and user_id is null order by created_at limit 1)
        and not exists (select 1 from hr_employees where org_id = ${inv.orgId} and user_id = ${user.id})`);
  });
  await audit({ orgId: inv.orgId, actorId: user.id, action: "invitation.accepted" });
}

export async function revokeInvitation(orgId: string, actorId: string, invitationId: string) {
  const r = await db
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.orgId, orgId), isNull(schema.invitations.acceptedAt)))
    .returning();
  if (!r.length) throw notFound("Invitation");
  await audit({ orgId, actorId, action: "invitation.revoked", targetType: "invitation", targetId: invitationId });
}

export async function previewInvitation(token: string) {
  const [row] = await db
    .select({ inv: schema.invitations, orgName: schema.organizations.name })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.orgId))
    .where(eq(schema.invitations.tokenHash, sha256(token)));
  if (!row || row.inv.acceptedAt || row.inv.revokedAt || row.inv.expiresAt < new Date()) {
    throw new ApiError("bad_request", "This invitation is invalid or has expired");
  }
  return { id: row.inv.id, orgId: row.inv.orgId, orgName: row.orgName, email: row.inv.email, userId: row.inv.userId, role: row.inv.role };
}

export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const inv = await previewInvitation(token);
  // Sent to their email, or to their account by username.
  if (inv.email.toLowerCase() !== user.email.toLowerCase() && inv.userId !== user.id) {
    throw forbidden("This invitation was sent to a different email address");
  }
  await join(inv, user);
  return inv;
}
