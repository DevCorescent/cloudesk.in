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

export async function createInvitation(orgId: string, actor: { id: string; role: Role; name: string }, email: string, role: Role) {
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
    .values({ orgId, email: email.trim(), role, tokenHash: sha256(token), invitedBy: actor.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning();
  await sendMail({
    to: email,
    subject: `${actor.name} invited you to ${org.name}`,
    body: `You have been invited to join ${org.name} as ${role}.\n\nAccept: ${appUrl(`/invite?token=${token}`)}\n\nThis invitation expires in 7 days.`,
  });
  await audit({ orgId, actorId: actor.id, action: "invitation.created", targetType: "invitation", targetId: inv.id, metadata: { email, role } });
  return { invitation: inv, token };
}

export async function listInvitations(orgId: string) {
  return db
    .select({ id: schema.invitations.id, email: schema.invitations.email, role: schema.invitations.role, expiresAt: schema.invitations.expiresAt, createdAt: schema.invitations.createdAt })
    .from(schema.invitations)
    .where(and(eq(schema.invitations.orgId, orgId), isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date())));
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
  return { orgId: row.inv.orgId, orgName: row.orgName, email: row.inv.email, role: row.inv.role };
}

export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const inv = await previewInvitation(token);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden("This invitation was sent to a different email address");
  }
  await db.transaction(async (tx) => {
    const used = await tx
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt)))
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
  return inv;
}
