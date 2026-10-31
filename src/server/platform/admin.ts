// The platform's own console, for its operators (users marked as platform
// admins): every workspace with its plan, size and state; suspending and
// lifting; trials of a paid plan; release flags; and — only while a workspace
// owner has granted support access — a look at its activity. Every action is
// in the audit log, and support views are in the workspace's own log too.
import { and, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { platformCan, type PlatformPerm } from "@/lib/platform/admin-roles";
import { isPlanId, PLAN_IDS } from "@/lib/platform/plans";
import { effectivePlan } from "../billing/billing";
import { ApiError, notFound } from "../http/errors";
import type { AuthedContext } from "../http/handler";
import { audit } from "../services/audit";
import { verifyPassword } from "../auth/password";
import { verifySecondFactor } from "../auth/mfa";
import { settings } from "./settings";

const O = schema.organizations;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

/** Only platform admins get in; to anyone else the console doesn't exist. */
export function requirePlatformAdmin(ctx: AuthedContext) {
  if (!ctx.user.isPlatformAdmin) throw notFound("Page");
  return ctx.user.id;
}

function ipv4(ip: string) {
  const m = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).reduce((n, o) => (n << 8) + Number(o), 0) >>> 0 : null;
}
/** Is this address in the allowlist (exact addresses, or IPv4 ranges like 10.0.0.0/8)? */
export function ipAllowed(ip: string | null, list: string[]) {
  if (!list.length) return true;
  if (!ip) return false;
  return list.some((entry) => {
    const [base, bits] = entry.split("/");
    if (bits === undefined) return base === ip || base === ip.replace(/^::ffff:/, "");
    const a = ipv4(ip), b = ipv4(base!), n = Number(bits);
    if (a === null || b === null || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

/**
 * The console's gate: a platform admin whose role allows this, signed in with
 * two-step if the platform requires it, from an allowed address if there's a list.
 */
export async function requirePlatform(ctx: AuthedContext, perm: PlatformPerm, opts: { fresh?: boolean } = {}) {
  if (!ctx.user.isPlatformAdmin) throw notFound("Page");
  const sec = (await settings()).security;
  if (!ipAllowed(ctx.ip, sec.adminIpAllowlist)) throw new ApiError("forbidden", "The admin console isn't available from this network.");
  if (sec.adminMfaRequired && !ctx.user.mfaEnabled) throw new ApiError("forbidden", "Turn on two-step sign-in (Settings → Security) to use the admin console.");
  if (!platformCan(ctx.user.platformRole, perm)) throw new ApiError("forbidden", "Your admin role doesn't include this.");
  if (opts.fresh) await requireFresh(ctx);
  return ctx.user.id;
}

/** Sensitive actions need a password (or two-step code) entered in this session within the last 15 minutes. */
export const FRESH_MS = 15 * 60_000;
async function requireFresh(ctx: AuthedContext) {
  const [s] = await db.select({ createdAt: schema.sessions.createdAt, reauthAt: schema.sessions.reauthAt }).from(schema.sessions).where(eq(schema.sessions.id, ctx.sessionId));
  const last = Math.max(s?.createdAt?.getTime() ?? 0, s?.reauthAt?.getTime() ?? 0);
  if (Date.now() - last > FRESH_MS) throw new ApiError("forbidden", "Confirm it's you to continue.", { reauth: true });
}

/** Re-checks the admin's password (or two-step code for accounts without one) and marks this session fresh. */
export async function reauthenticate(ctx: AuthedContext, raw: unknown) {
  const v = z.object({ password: z.string().max(200).default(""), code: z.string().max(20).default("") }).parse(raw);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.user.id));
  if (!u) throw notFound("User");
  let ok = false;
  if (u.passwordHash && v.password) ok = await verifyPassword(u.passwordHash, v.password);
  else if (!u.passwordHash && u.totpEnabledAt && v.code) ok = !!(await verifySecondFactor(u.id, v.code));
  else if (!u.passwordHash) throw new ApiError("conflict", "Your account has no password — turn on two-step sign-in and use its code.");
  if (!ok) {
    await audit({ actorId: u.id, action: "platform.reauth_failed", ip: ctx.ip });
    throw new ApiError("forbidden", u.passwordHash ? "That password isn't right." : "That code isn't right.");
  }
  await db.update(schema.sessions).set({ reauthAt: new Date() }).where(eq(schema.sessions.id, ctx.sessionId));
  await audit({ actorId: u.id, action: "platform.reauth", ip: ctx.ip });
}

export async function tenants(q: { q?: string; state?: string } = {}) {
  const t = q.q?.trim() ? `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const rows = await db
    .select({ o: O, members: sql<number>`(select count(*)::int from memberships m where m.org_id = "organizations"."id")`, lastActive: sql<string | null>`(select max(created_at) from audit_logs a where a.org_id = "organizations"."id")` })
    .from(O)
    .where(and(t ? or(ilike(O.name, t), ilike(O.slug, t)) : sql`true`, q.state === "suspended" ? sql`${O.suspendedAt} is not null` : q.state === "trial" ? sql`${O.trialEndsAt} > now()` : q.state === "deleting" ? sql`${O.deletionScheduledAt} is not null` : sql`true`))
    .orderBy(desc(O.createdAt))
    .limit(500);
  return rows.map(({ o, members, lastActive }) => ({ id: o.id, name: o.name, slug: o.slug, plan: effectivePlan(o), paidPlan: o.plan, subscriptionStatus: o.subscriptionStatus, trialPlan: o.trialPlan, trialEndsAt: o.trialEndsAt, suspendedAt: o.suspendedAt, suspendedReason: o.suspendedReason, sitesOffline: o.sitesOffline, deletionScheduledAt: o.deletionScheduledAt, industry: o.industry, compPlan: o.compPlan, note: o.platformNote, modules: o.modules, members, lastActive, createdAt: o.createdAt }));
}

async function org(id: string) {
  if (!isId(id)) throw notFound("Workspace");
  const [o] = await db.select().from(O).where(eq(O.id, id));
  if (!o) throw notFound("Workspace");
  return o;
}

export async function activeGrant(orgId: string) {
  const [g] = await db.select().from(schema.supportGrants).where(and(eq(schema.supportGrants.orgId, orgId), isNull(schema.supportGrants.revokedAt), gt(schema.supportGrants.expiresAt, new Date()))).orderBy(desc(schema.supportGrants.expiresAt)).limit(1);
  return g ?? null;
}

/** A workspace's summary; its activity and record counts only while support access is granted. */
export async function tenant(adminId: string, id: string) {
  const o = await org(id);
  const owners = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, id), eq(schema.memberships.role, "owner")));
  const grant = await activeGrant(id);
  let support: { activity: unknown[]; modules: string[] | null } | null = null;
  if (grant) {
    const activity = await db.select({ action: schema.auditLogs.action, targetType: schema.auditLogs.targetType, createdAt: schema.auditLogs.createdAt }).from(schema.auditLogs).where(eq(schema.auditLogs.orgId, id)).orderBy(desc(schema.auditLogs.createdAt)).limit(100);
    support = { activity, modules: o.modules as string[] | null };
    await audit({ orgId: id, actorId: adminId, action: "support.viewed", targetType: "organization", targetId: id, metadata: { grantId: grant.id } });
  }
  // Usage figures are counts only — no workspace content — so they're shown without support access.
  const [usage] = (await db.execute<{ projects: number; live: number; members: number; orders30: number; ai_cost: number }>(sql`select
      (select count(*)::int from projects where org_id = ${id} and archived_at is null) as projects,
      (select count(*)::int from projects where org_id = ${id} and production_deployment_id is not null) as live,
      (select count(*)::int from memberships where org_id = ${id}) as members,
      (select count(*)::int from store_orders so join projects p on p.id = so.project_id where p.org_id = ${id} and so.created_at > now() - interval '30 days') as orders30,
      (select coalesce(sum(cost_micro_usd),0)::bigint from ai_tasks where org_id = ${id} and created_at >= date_trunc('month', now())) as ai_cost`)).rows;
  return { tenant: (await tenants({ q: o.slug })).find((t) => t.id === id), owners, usage, grant: grant && { reason: grant.reason, expiresAt: grant.expiresAt }, support };
}

export async function setComp(adminId: string, id: string, raw: unknown) {
  const o = await org(id);
  const { plan } = z.object({ plan: z.enum(PLAN_IDS).nullable() }).parse(raw);
  const compPlan = plan && plan !== "free" ? plan : null;
  await db.update(O).set({ compPlan }).where(eq(O.id, o.id));
  await audit({ orgId: o.id, actorId: adminId, action: compPlan ? "platform.comp_given" : "platform.comp_removed", targetType: "organization", targetId: o.id, metadata: { plan: compPlan } });
}

export async function setNote(adminId: string, id: string, raw: unknown) {
  const o = await org(id);
  const { note } = z.object({ note: z.string().max(2000) }).parse(raw);
  await db.update(O).set({ platformNote: note }).where(eq(O.id, o.id));
  await audit({ actorId: adminId, action: "platform.note_saved", targetType: "organization", targetId: o.id });
}

export async function suspend(adminId: string, id: string, raw: unknown) {
  const o = await org(id);
  const { reason, sitesOffline } = z.object({ reason: z.string().trim().min(1, "Say why").max(300), sitesOffline: z.boolean().default(false) }).parse(raw);
  await db.update(O).set({ suspendedAt: new Date(), suspendedReason: reason, sitesOffline }).where(eq(O.id, o.id));
  await audit({ orgId: o.id, actorId: adminId, action: "platform.suspended", targetType: "organization", targetId: o.id, metadata: { reason, sitesOffline } });
}

export async function unsuspend(adminId: string, id: string) {
  const o = await org(id);
  await db.update(O).set({ suspendedAt: null, suspendedReason: "", sitesOffline: false }).where(eq(O.id, o.id));
  await audit({ orgId: o.id, actorId: adminId, action: "platform.unsuspended", targetType: "organization", targetId: o.id });
}

export async function setTrial(adminId: string, id: string, raw: unknown) {
  const o = await org(id);
  const v = z.object({ plan: z.enum(PLAN_IDS).nullable(), days: z.number().int().min(1).max(90).default(14) }).parse(raw);
  const values = v.plan && v.plan !== "free" ? { trialPlan: v.plan, trialEndsAt: new Date(Date.now() + v.days * 86_400_000) } : { trialPlan: null, trialEndsAt: null };
  await db.update(O).set(values).where(eq(O.id, o.id));
  await audit({ orgId: o.id, actorId: adminId, action: values.trialPlan ? "platform.trial_started" : "platform.trial_ended", targetType: "organization", targetId: o.id, metadata: { plan: values.trialPlan, until: values.trialEndsAt } });
}

// ── Release flags ───────────────────────────────────────────────────────────

const flagSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,60}$/, "Use lower-case letters, digits, . _ -"), description: z.string().trim().max(300).default(""), enabled: z.boolean().default(false), orgIds: z.array(z.uuid()).max(1000).default([]) });

export const flags = () => db.select().from(schema.featureFlags).orderBy(schema.featureFlags.key);

export async function saveFlag(adminId: string, raw: unknown) {
  const v = flagSchema.parse(raw);
  await db.insert(schema.featureFlags).values({ ...v, updatedBy: adminId }).onConflictDoUpdate({ target: schema.featureFlags.key, set: { description: v.description, enabled: v.enabled, orgIds: v.orgIds, updatedBy: adminId, updatedAt: new Date() } });
  await audit({ actorId: adminId, action: "platform.flag_saved", targetType: "feature_flag", targetId: v.key, metadata: { enabled: v.enabled, orgs: v.orgIds.length } });
  cache.clear();
}

export async function deleteFlag(adminId: string, key: string) {
  await db.delete(schema.featureFlags).where(eq(schema.featureFlags.key, key));
  await audit({ actorId: adminId, action: "platform.flag_deleted", targetType: "feature_flag", targetId: key });
  cache.clear();
}

const cache = new Map<string, { at: number; on: boolean; orgs: Set<string> }>();
/** Is a release flag on for this workspace? Unknown flags are off. Cached for 30 seconds. */
export async function isFlagOn(key: string, orgId: string | null) {
  let c = cache.get(key);
  if (!c || Date.now() - c.at > 30_000) {
    const [f] = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, key));
    c = { at: Date.now(), on: !!f?.enabled, orgs: new Set(f?.orgIds ?? []) };
    cache.set(key, c);
  }
  return c.on || (!!orgId && c.orgs.has(orgId));
}

export const planIds = () => PLAN_IDS.filter((p) => isPlanId(p));
