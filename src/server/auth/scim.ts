// SCIM 2.0 user provisioning, so an identity provider (Okta, Entra ID…) can
// add people to the workspace, change their names, and take them out when they
// leave. Each workspace has one bearer token (only its hash is stored). People
// provisioned here sign in with SSO; deprovisioning removes them from this
// workspace (never an owner) and signs them out if it was their only one.
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { revokeAllSessions } from "./session";

const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export async function rotateToken(orgId: string, actorId: string) {
  await db.update(schema.scimTokens).set({ revokedAt: new Date() }).where(and(eq(schema.scimTokens.orgId, orgId), isNull(schema.scimTokens.revokedAt)));
  const token = `scim_${randomToken(30)}`;
  await db.insert(schema.scimTokens).values({ orgId, prefix: token.slice(0, 10), tokenHash: sha256(token), createdBy: actorId });
  await audit({ orgId, actorId, action: "scim.token_created", targetType: "organization", targetId: orgId });
  return token;
}
export async function revokeToken(orgId: string, actorId: string) {
  await db.update(schema.scimTokens).set({ revokedAt: new Date() }).where(and(eq(schema.scimTokens.orgId, orgId), isNull(schema.scimTokens.revokedAt)));
  await audit({ orgId, actorId, action: "scim.token_revoked", targetType: "organization", targetId: orgId });
}
export async function tokenInfo(orgId: string) {
  const [t] = await db.select({ prefix: schema.scimTokens.prefix, createdAt: schema.scimTokens.createdAt, lastUsedAt: schema.scimTokens.lastUsedAt }).from(schema.scimTokens).where(and(eq(schema.scimTokens.orgId, orgId), isNull(schema.scimTokens.revokedAt)));
  return t ?? null;
}

async function orgFor(req: Request) {
  const raw = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!/^scim_[\w-]{30,60}$/.test(raw)) return null;
  const [t] = await db.select().from(schema.scimTokens).where(and(eq(schema.scimTokens.tokenHash, sha256(raw)), isNull(schema.scimTokens.revokedAt)));
  if (!t) return null;
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await db.update(schema.scimTokens).set({ lastUsedAt: new Date() }).where(eq(schema.scimTokens.id, t.id));
  return t.orgId;
}

type U = typeof schema.users.$inferSelect;
const split = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return { givenName: parts[0] ?? "", familyName: parts.slice(1).join(" ") };
};
const resource = (u: U, active: boolean, base: string) => ({ schemas: [USER], id: u.id, userName: u.email, name: { ...split(u.name), formatted: u.name }, displayName: u.name, emails: [{ value: u.email, primary: true, type: "work" }], active, meta: { resourceType: "User", created: u.createdAt.toISOString(), location: `${base}/Users/${u.id}` } });
const problem = (status: number, detail: string, scimType?: string) => Response.json({ schemas: [ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) }, { status, headers: { "Content-Type": "application/scim+json" } });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Content-Type": "application/scim+json" } });

async function member(orgId: string, userId: string) {
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  return m ?? null;
}
async function defaultRole(orgId: string) {
  const [c] = await db.select({ role: schema.ssoConnections.jitRole }).from(schema.ssoConnections).where(eq(schema.ssoConnections.orgId, orgId));
  return (c?.role ?? "viewer") as never;
}

async function setActive(orgId: string, u: U, active: boolean) {
  const m = await member(orgId, u.id);
  if (active && !m) {
    const { assertWithinLimit } = await import("../billing/billing");
    await assertWithinLimit(orgId, "seats");
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role: await defaultRole(orgId) });
    await audit({ orgId, actorId: null, action: "scim.user_activated", targetType: "user", targetId: u.id, metadata: { email: u.email } });
  }
  if (!active && m) {
    if (m.role === "owner") throw new ApiError("conflict", "An owner can't be deprovisioned; change their role in Cloudesk first");
    await db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, u.id)));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.userId, u.id));
    if (!n) await revokeAllSessions(u.id);
    await audit({ orgId, actorId: null, action: "scim.user_deactivated", targetType: "user", targetId: u.id, metadata: { email: u.email } });
  }
}

/** Users known to this workspace: current members, plus anyone this workspace deactivated (so the IdP can read them back). */
async function findUser(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("User");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) throw notFound("User");
  const m = await member(orgId, u.id);
  if (!m) {
    const [was] = await db.select({ id: schema.auditLogs.id }).from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.targetId, u.id), sql`${schema.auditLogs.action} like 'scim.%'`)).limit(1);
    if (!was) throw notFound("User");
  }
  return { u, active: !!m };
}

/**
 * The email domains this workspace has proved it owns (Settings → Identity).
 * The SCIM token can only create or pull in accounts on those domains, and only
 * rename those: an account on any other domain belongs to its owner, not to
 * this workspace's identity provider.
 */
async function ownsIdentity(orgId: string, email: string) {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  const [d] = await db.select({ id: schema.ssoDomains.id }).from(schema.ssoDomains).where(and(eq(schema.ssoDomains.orgId, orgId), eq(schema.ssoDomains.domain, domain), isNotNull(schema.ssoDomains.verifiedAt)));
  return !!d;
}

function nameFrom(b: { name?: { formatted?: string; givenName?: string; familyName?: string }; displayName?: string }, fallback: string) {
  return (b.name?.formatted || [b.name?.givenName, b.name?.familyName].filter(Boolean).join(" ") || b.displayName || fallback).slice(0, 120);
}

export async function handleScim(req: Request, path: string[]) {
  const base = new URL(req.url).origin + "/api/v1/scim/v2";
  try {
    const [res, id] = path;
    if (res === "ServiceProviderConfig") return ok({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 100 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "The workspace's SCIM token" }] });
    if (res === "ResourceTypes") return ok({ schemas: [LIST], totalResults: 1, Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER }] });
    const orgId = await orgFor(req);
    if (!orgId) return problem(401, "A valid SCIM bearer token is required");
    if (res !== "Users") return problem(404, "Only Users are supported");
    const body = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    if (req.method === "GET" && !id) {
      const q = new URL(req.url).searchParams;
      const start = Math.max(1, Number(q.get("startIndex") ?? 1) || 1);
      const count = Math.min(100, Math.max(0, Number(q.get("count") ?? 100) || 100));
      const f = /^userName\s+eq\s+"([^"]+)"$/i.exec(q.get("filter") ?? "");
      if (q.get("filter") && !f) return problem(400, "Only filter=userName eq \"…\" is supported", "invalidFilter");
      const rows = await db.select({ u: schema.users }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), f ? sql`lower(${schema.users.email}) = ${f[1].toLowerCase()}` : sql`true`)).orderBy(schema.users.createdAt);
      return ok({ schemas: [LIST], totalResults: rows.length, startIndex: start, itemsPerPage: Math.min(count, Math.max(0, rows.length - start + 1)), Resources: rows.slice(start - 1, start - 1 + count).map((r) => resource(r.u, true, base)) });
    }
    if (req.method === "GET") {
      const { u, active } = await findUser(orgId, id);
      return ok(resource(u, active, base));
    }
    if (req.method === "POST" && !id) {
      const email = String((body.userName as string) ?? (body.emails as { value?: string }[] | undefined)?.[0]?.value ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problem(400, "userName must be an email address", "invalidValue");
      if (!(await ownsIdentity(orgId, email))) return problem(403, "userName must be on an email domain this workspace has verified (Settings → Identity)", "invalidValue");
      let [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
      if (u && (await member(orgId, u.id))) return problem(409, "That user is already in this workspace", "uniqueness");
      if (!u) [u] = await db.insert(schema.users).values({ email, name: nameFrom(body as never, email.split("@")[0]), passwordHash: null, emailVerifiedAt: new Date() }).returning();
      const active = body.active !== false;
      if (active) await setActive(orgId, u, true);
      await audit({ orgId, actorId: null, action: "scim.user_created", targetType: "user", targetId: u.id, metadata: { email, active } });
      return ok(resource(u, active, base), 201);
    }
    if ((req.method === "PUT" || req.method === "PATCH") && id) {
      let { u } = await findUser(orgId, id);
      let active: boolean | undefined;
      let name: string | undefined;
      if (req.method === "PUT") {
        active = body.active !== false;
        name = nameFrom(body as never, u.name);
      } else {
        if (!(body.schemas as string[] | undefined)?.includes(PATCH)) return problem(400, "Send a SCIM PatchOp", "invalidSyntax");
        for (const op of (body.Operations as { op: string; path?: string; value?: unknown }[]) ?? []) {
          if (!/^(replace|add)$/i.test(op.op)) continue;
          const v = (op.path ? { [op.path]: op.value } : (op.value as Record<string, unknown>)) ?? {};
          if ("active" in v) active = v.active === true || v.active === "true" || v.active === "True";
          if ("name.formatted" in v || "displayName" in v || "name" in v) name = nameFrom({ name: (v.name as never) ?? { formatted: v["name.formatted"] as string }, displayName: v.displayName as string }, u.name);
          if ("name.givenName" in v || "name.familyName" in v) name = nameFrom({ name: { givenName: (v["name.givenName"] as string) ?? split(u.name).givenName, familyName: (v["name.familyName"] as string) ?? split(u.name).familyName } }, u.name);
        }
      }
      if (name && name !== u.name && (await ownsIdentity(orgId, u.email))) [u] = await db.update(schema.users).set({ name }).where(eq(schema.users.id, u.id)).returning();
      if (active !== undefined) await setActive(orgId, u, active);
      return ok(resource(u, !!(await member(orgId, u.id)), base));
    }
    if (req.method === "DELETE" && id) {
      const { u } = await findUser(orgId, id);
      await setActive(orgId, u, false);
      return new Response(null, { status: 204 });
    }
    return problem(405, "Not supported");
  } catch (e) {
    if (e instanceof ApiError) return problem(e.status, e.message);
    return problem(500, "Something went wrong");
  }
}
