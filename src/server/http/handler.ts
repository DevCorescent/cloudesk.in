import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { readCookie, resolveSession, SESSION_COOKIE, type SessionUser } from "../auth/session";
import { recordRequest } from "../platform/metrics";
import { cachedSettings, maintenance } from "../platform/settings";
import { clientIpFrom, type TrustProxy } from "@/lib/security/ip";
import { can, type Permission, type Role } from "../authz/permissions";
import { ApiError, forbidden, notFound } from "./errors";
import { log } from "../log";
import { assertEntitled } from "../billing/subscriptions";
import { isPartOn, moduleById, moduleForApi, reachable, type ModuleId, type PartsOff } from "@/lib/workspace/modules";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type RequestContext = {
  req: Request;
  ip: string | null;
  user: SessionUser | null;
  sessionId: string | null;
  /** Response headers to append (e.g. Set-Cookie). */
  headers: Headers;
};

export type AuthedContext = RequestContext & { user: SessionUser; sessionId: string };

type Params = Record<string, string | string[]>;
type RouteCtx = { params: Promise<Params> };

export function clientIp(req: Request): string | null {
  // Which header to believe is set in Admin → Security → Firewall (or TRUST_PROXY); values are validated as addresses.
  const mode = (cachedSettings()?.firewall.trustProxy ?? process.env.TRUST_PROXY ?? "xff-first") as TrustProxy;
  return clientIpFrom(req.headers, mode);
}

// CSRF defence for cookie-authenticated requests: SameSite=Lax cookies plus a
// strict Origin check on every state-changing request.
function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(req.url).origin]);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  if (!origin || !allowed.has(origin)) {
    throw new ApiError("forbidden", "Cross-origin request rejected");
  }
}

export async function readJson<T extends z.ZodType>(req: Request, schemaDef: T): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "Request body is too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError("payload_too_large", "Request body is too large");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("bad_request", "Request body must be valid JSON");
  }
  const parsed = schemaDef.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("validation_failed", "Some fields are invalid", z.flattenError(parsed.error).fieldErrors);
  }
  return parsed.data;
}

export function errorResponse(err: unknown): Response {
  // A schema check that wasn't caught on the way: still the caller's input, so a 422.
  if (err instanceof z.ZodError) {
    const details: Record<string, string[]> = {};
    for (const i of err.issues) (details[i.path.join(".")] ??= []).push(i.message);
    err = new ApiError("validation_failed", err.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (err.code === "rate_limited" && retry) headers["Retry-After"] = String(retry);
    return Response.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status, headers },
    );
  }
  log.error("unhandled_api_error", { error: err instanceof Error ? err.stack : String(err) });
  return Response.json(
    { error: { code: "internal_error", message: "Something went wrong on our side.", details: null } },
    { status: 500 },
  );
}

type HandlerOpts = { auth?: boolean };

/**
 * Wraps a route handler with the platform's request pipeline: origin check,
 * session resolution, consistent error envelope, and response headers.
 */
export function route<P extends Params = Params>(
  fn: (ctx: RequestContext, params: P) => Promise<Response | unknown>,
  opts: { auth: false },
): (req: Request, rc: RouteCtx) => Promise<Response>;
export function route<P extends Params = Params>(
  fn: (ctx: AuthedContext, params: P) => Promise<Response | unknown>,
  opts?: HandlerOpts,
): (req: Request, rc: RouteCtx) => Promise<Response>;
export function route(
  fn: (ctx: never, params: Params) => Promise<Response | unknown>,
  opts: HandlerOpts = {},
) {
  const requireAuth = opts.auth !== false;
  return async (req: Request, rc: RouteCtx) => {
    const started = performance.now();
    const res = await handleRoute(req, rc);
    recordRequest(new URL(req.url).pathname, res.status, performance.now() - started);
    return res;
  };
  async function handleRoute(req: Request, rc: RouteCtx): Promise<Response> {
    const headers = new Headers();
    try {
      if (MUTATING.has(req.method)) assertSameOrigin(req);
      const resolved = await resolveSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
      if (requireAuth && !resolved) throw new ApiError("unauthenticated", "Please sign in to continue");
      const ctx: RequestContext = {
        req,
        ip: clientIp(req),
        user: resolved?.user ?? null,
        sessionId: resolved?.sessionId ?? null,
        headers,
      };
      // Maintenance mode: workspaces are read-only for everyone but platform admins (signing in and out still works).
      if (MUTATING.has(req.method) && resolved && !resolved.user.isPlatformAdmin && !new URL(req.url).pathname.startsWith("/api/v1/auth/")) {
        const m = await maintenance();
        if (m.enabled) throw new ApiError("unavailable", m.message);
      }
      const params = rc?.params ? await rc.params : {};
      // A write sent again with the same Idempotency-Key (the offline outbox
      // replaying after a dropped connection) gets the first answer back
      // instead of being done twice.
      const idem = MUTATING.has(req.method) && resolved ? (req.headers.get("idempotency-key") ?? "").trim() : "";
      if (idem && !/^[A-Za-z0-9_-]{8,80}$/.test(idem)) throw new ApiError("validation_failed", "Idempotency-Key must be 8–80 letters, digits, - or _");
      const path = new URL(req.url).pathname;
      if (idem) {
        const [seen] = await db.select().from(schema.idempotentWrites).where(and(eq(schema.idempotentWrites.userId, resolved!.user.id), eq(schema.idempotentWrites.key, idem)));
        if (seen) {
          if (seen.method !== req.method || seen.path !== path) throw new ApiError("conflict", "This Idempotency-Key was used for a different request");
          const res = Response.json(seen.body, { status: seen.status });
          res.headers.set("Idempotent-Replayed", "true");
          res.headers.set("Cache-Control", "no-store");
          return res;
        }
      }
      const out = await fn(ctx as never, params);
      const res = out instanceof Response ? out : Response.json(out ?? { ok: true });
      if (idem && res.status < 300 && !(out instanceof Response)) {
        await db.insert(schema.idempotentWrites).values({ userId: resolved!.user.id, key: idem, method: req.method, path, status: res.status, body: out ?? { ok: true } }).onConflictDoNothing();
      }
      headers.forEach((v, k) => res.headers.append(k, v));
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      const res = errorResponse(err);
      headers.forEach((v, k) => {
        if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
      });
      return res;
    }
  }
}

// ─── Tenant authorization ────────────────────────────────────────────────────

export async function getMembership(userId: string, orgId: string): Promise<Role | null> {
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.orgId, orgId)))
    .limit(1);
  return m?.role ?? null;
}

/**
 * Resolves the caller's role in an organization. Non-members get 404 rather
 * than 403 so organization ids cannot be probed.
 */
/** Organizations can require every member to use two-factor sign-in. */
async function assertOrgMfa(ctx: AuthedContext, orgId: string) {
  if (ctx.user.mfaEnabled) return;
  const [o] = await db.select({ requireMfa: schema.organizations.requireMfa }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (o?.requireMfa) throw new ApiError("forbidden", "This organization requires two-factor sign-in. Turn it on in Settings → Account.", { mfaRequired: ["true"] });
}

export async function requireOrg(ctx: AuthedContext, orgId: string, permission: Permission) {
  if (!z.uuid().safeParse(orgId).success) throw notFound("Organization");
  const [m] = await db
    .select({ role: schema.memberships.role, allowed: schema.customRoles.modules })
    .from(schema.memberships)
    .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
    .where(and(eq(schema.memberships.userId, ctx.user.id), eq(schema.memberships.orgId, orgId)))
    .limit(1);
  if (!m) throw notFound("Organization");
  // A workspace the platform suspended can't be used (the reason is shown).
  const [o] = await db.select({ suspendedAt: schema.organizations.suspendedAt, reason: schema.organizations.suspendedReason }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (o?.suspendedAt) throw new ApiError("forbidden", `This workspace is suspended${o.reason ? `: ${o.reason}` : ""}. Contact support.`);
  if (!can(m.role, permission)) throw forbidden();
  await assertModuleAccess(ctx, orgId, m.allowed);
  await assertOrgMfa(ctx, orgId);
  return { orgId, role: m.role };
}

/**
 * Module-level checks for the API path being called: a workspace role limited
 * to some modules can't reach others, and a switched-off part of a module
 * (Settings → Features) can't be used. Whole modules switched off are checked
 * by the modules themselves, since some share APIs with each other.
 */
async function assertModuleAccess(ctx: AuthedContext, orgId: string, allowed: string[] | null) {
  const hit = moduleForApi(new URL(ctx.req.url).pathname);
  // The subscription: features outside the plan, and read-only once it has ended.
  await assertEntitled(orgId, ctx.req, hit?.module ?? null);
  if (!hit) return;
  const name = moduleById(hit.module)?.name ?? hit.module;
  if (allowed && !reachable(allowed as ModuleId[]).has(hit.module)) throw forbidden(`Your role in this workspace doesn't include ${name}`);
  if (hit.part) {
    const [o] = await db.select({ partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
    if (!isPartOn(o?.partsOff as PartsOff, hit.module, hit.part)) {
      const part = moduleById(hit.module)?.parts?.find((p) => p.id === hit.part)?.name ?? hit.part;
      throw forbidden(`${part} is switched off for this workspace — an owner or admin can switch it on in Settings → Features`);
    }
  }
}

export async function requireProject(ctx: AuthedContext, projectId: string, permission: Permission) {
  if (!z.uuid().safeParse(projectId).success) throw notFound("Project");
  const [row] = await db
    .select({ project: schema.projects, role: schema.memberships.role, allowed: schema.customRoles.modules })
    .from(schema.projects)
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.orgId, schema.projects.orgId), eq(schema.memberships.userId, ctx.user.id)),
    )
    .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row || row.project.archivedAt) throw notFound("Project");
  if (!can(row.role, permission)) throw forbidden();
  await assertModuleAccess(ctx, row.project.orgId, row.allowed);
  await assertOrgMfa(ctx, row.project.orgId);
  return { project: row.project, role: row.role };
}
