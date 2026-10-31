// Every account on the platform, for operators: find people, see their
// workspaces, sessions and sign-ins; disable or re-enable an account (which
// ends its sessions), sign it out everywhere, confirm its email; and — for
// platform owners — decide who else administers the platform.
import { and, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { GUEST_DOMAIN } from "@/lib/chat/guests";
import { isPlatformRole, PLATFORM_ROLES } from "@/lib/platform/admin-roles";
import { revokeAllSessions } from "../auth/session";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";

const U = schema.users;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const esc = (q: string) => `%${q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

export async function users(q: { q?: string; filter?: string } = {}) {
  const where = and(
    // Chat guests aren't accounts: no password, no sign-in.
    sql`${U.email} not like ${`%@${GUEST_DOMAIN}`}`,
    q.q?.trim() ? or(ilike(U.email, esc(q.q)), ilike(U.name, esc(q.q))) : undefined,
    q.filter === "disabled" ? sql`${U.disabledAt} is not null` : q.filter === "admins" ? eq(U.isPlatformAdmin, true) : q.filter === "unverified" ? isNull(U.emailVerifiedAt) : q.filter === "no_mfa" ? isNull(U.totpEnabledAt) : undefined,
  );
  const rows = await db
    .select({ u: U, workspaces: sql<number>`(select count(*)::int from memberships m where m.user_id = "users"."id")`, lastSeen: sql<string | null>`(select max(last_seen_at)::text from sessions s where s.user_id = "users"."id")` })
    .from(U)
    .where(where)
    .orderBy(desc(U.createdAt))
    .limit(300);
  return rows.map(({ u, workspaces, lastSeen }) => ({ id: u.id, name: u.name, email: u.email, verified: !!u.emailVerifiedAt, mfa: !!u.totpEnabledAt, isPlatformAdmin: u.isPlatformAdmin, platformRole: u.isPlatformAdmin ? (u.platformRole ?? "owner") : null, disabledAt: u.disabledAt, disabledReason: u.disabledReason, workspaces, lastSeen, createdAt: u.createdAt }));
}

async function user(id: string) {
  if (!isId(id)) throw notFound("User");
  const [u] = await db.select().from(U).where(eq(U.id, id));
  if (!u) throw notFound("User");
  return u;
}

export async function userDetail(id: string) {
  const u = await user(id);
  const [summary] = await users({ q: u.email });
  const memberships = await db.select({ orgId: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug, role: schema.memberships.role, joinedAt: schema.memberships.createdAt }).from(schema.memberships).innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId)).where(eq(schema.memberships.userId, id));
  const sessions = await db.select({ ip: schema.sessions.ip, userAgent: schema.sessions.userAgent, createdAt: schema.sessions.createdAt, lastSeenAt: schema.sessions.lastSeenAt }).from(schema.sessions).where(and(eq(schema.sessions.userId, id), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()))).orderBy(desc(schema.sessions.lastSeenAt)).limit(20);
  const logins = await db.select({ ok: schema.loginEvents.ok, method: schema.loginEvents.method, reason: schema.loginEvents.reason, ip: schema.loginEvents.ip, at: schema.loginEvents.at }).from(schema.loginEvents).where(eq(schema.loginEvents.userId, id)).orderBy(desc(schema.loginEvents.at)).limit(20);
  return { user: summary ?? null, memberships, sessions, logins };
}

/**
 * Another platform admin's account (disable, enable, sign out) is a platform
 * owner's call: an admin with users:write can't lock out the people above them.
 */
async function guardAdminTarget(adminId: string, target: typeof U.$inferSelect) {
  if (!target.isPlatformAdmin || target.id === adminId) return;
  const [actor] = await db.select({ isPlatformAdmin: U.isPlatformAdmin, platformRole: U.platformRole }).from(U).where(eq(U.id, adminId));
  if (!actor?.isPlatformAdmin || (actor.platformRole ?? "owner") !== "owner") throw new ApiError("forbidden", "Only a platform owner can change another admin's account.");
}

/** Owners can't lock themselves (or the last owner) out by accident. */
async function guardOwners(adminId: string, target: typeof U.$inferSelect, change: "disable" | "role") {
  if (target.id === adminId) throw new ApiError("conflict", change === "disable" ? "You can't disable your own account" : "You can't change your own admin role — ask another owner");
  if (target.isPlatformAdmin && (target.platformRole ?? "owner") === "owner") {
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where is_platform_admin and coalesce(platform_role, 'owner') = 'owner' and disabled_at is null`)).rows;
    if (Number(n) <= 1) throw new ApiError("conflict", "This is the last platform owner — make someone else an owner first");
  }
}

export async function disableUser(adminId: string, id: string, raw: unknown) {
  const u = await user(id);
  const { reason } = z.object({ reason: z.string().trim().min(1, "Say why").max(300) }).parse(raw);
  await guardOwners(adminId, u, "disable");
  await guardAdminTarget(adminId, u);
  await db.update(U).set({ disabledAt: new Date(), disabledReason: reason }).where(eq(U.id, id));
  await revokeAllSessions(id);
  await audit({ actorId: adminId, action: "platform.user_disabled", targetType: "user", targetId: id, metadata: { reason, email: u.email } });
}

export async function enableUser(adminId: string, id: string) {
  const u = await user(id);
  await guardAdminTarget(adminId, u);
  await db.update(U).set({ disabledAt: null, disabledReason: "" }).where(eq(U.id, id));
  await audit({ actorId: adminId, action: "platform.user_enabled", targetType: "user", targetId: id, metadata: { email: u.email } });
}

export async function signOutEverywhere(adminId: string, id: string) {
  const u = await user(id);
  await guardAdminTarget(adminId, u);
  await revokeAllSessions(id);
  await audit({ actorId: adminId, action: "platform.user_signed_out", targetType: "user", targetId: id, metadata: { email: u.email } });
}

export async function verifyUserEmail(adminId: string, id: string) {
  const u = await user(id);
  if (u.emailVerifiedAt) return;
  await db.update(U).set({ emailVerifiedAt: new Date() }).where(eq(U.id, id));
  await audit({ actorId: adminId, action: "platform.email_verified", targetType: "user", targetId: id, metadata: { email: u.email } });
}

/** Makes someone a platform admin with a role, or removes them (role null). Their sessions end so the change applies at once. */
export async function setPlatformRole(adminId: string, id: string, raw: unknown) {
  const u = await user(id);
  const { role } = z.object({ role: z.enum(PLATFORM_ROLES).nullable() }).parse(raw);
  await guardOwners(adminId, u, "role");
  if (role && u.disabledAt) throw new ApiError("conflict", "Enable the account first");
  if (role && !isPlatformRole(role)) throw new ApiError("validation_failed", "Unknown role");
  await db.update(U).set({ isPlatformAdmin: !!role, platformRole: role }).where(eq(U.id, id));
  await revokeAllSessions(id);
  await audit({ actorId: adminId, action: role ? "platform.admin_role_set" : "platform.admin_removed", targetType: "user", targetId: id, metadata: { role, email: u.email } });
}

// ── Audit log across the platform ───────────────────────────────────────────

export async function auditSearch(q: { action?: string; org?: string; actor?: string; days?: string }) {
  const A = schema.auditLogs;
  const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
  const rows = await db
    .select({ id: A.id, action: A.action, targetType: A.targetType, targetId: A.targetId, metadata: A.metadata, ip: A.ip, createdAt: A.createdAt, org: schema.organizations.name, orgSlug: schema.organizations.slug, actor: U.email })
    .from(A)
    .leftJoin(schema.organizations, eq(schema.organizations.id, A.orgId))
    .leftJoin(U, eq(U.id, A.actorId))
    .where(and(
      gt(A.createdAt, new Date(Date.now() - days * 86_400_000)),
      q.action?.trim() ? ilike(A.action, `${q.action.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`) : undefined,
      q.org?.trim() ? or(ilike(schema.organizations.name, esc(q.org)), ilike(schema.organizations.slug, esc(q.org))) : undefined,
      q.actor?.trim() ? ilike(U.email, esc(q.actor)) : undefined,
    ))
    .orderBy(desc(A.createdAt))
    .limit(300);
  return rows;
}
