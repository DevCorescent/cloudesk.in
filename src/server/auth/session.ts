import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";

export const SESSION_COOKIE = "cc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  /** owner | admin | support | analyst for platform admins, else null. */
  platformRole: string | null;
  mfaEnabled: boolean;
};

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  // Every way in (password, two-step, GitHub, SSO) ends here: a disabled account gets no session.
  const [u] = await db.select({ disabledAt: schema.users.disabledAt }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.disabledAt) throw new ApiError("forbidden", "This account is disabled. Contact support if you think this is a mistake.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined | null) {
  if (!token) return null;
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, sha256(token)),
        gt(schema.sessions.expiresAt, new Date()),
        isNull(schema.sessions.revokedAt),
        isNull(schema.users.disabledAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const user: SessionUser = {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    emailVerified: !!row.user.emailVerifiedAt,
    isPlatformAdmin: row.user.isPlatformAdmin,
    platformRole: row.user.isPlatformAdmin ? (row.user.platformRole ?? "owner") : null,
    mfaEnabled: !!row.user.totpEnabledAt,
  };
  return { sessionId: row.session.id, user };
}

export async function revokeSession(sessionId: string) {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  for (const r of rows) if (r.id !== exceptSessionId) await revokeSession(r.id);
}

/**
 * "; Secure" for sign-in cookies: on HTTPS installs, and in production unless
 * APP_URL is explicitly plain http:// (a missing APP_URL must not downgrade them).
 */
export function secureAttr(): string {
  const app = process.env.APP_URL ?? "";
  if (app.startsWith("https://")) return "; Secure";
  return process.env.NODE_ENV === "production" && !app.startsWith("http://") ? "; Secure" : "";
}

export function sessionCookie(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureAttr()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttr()}`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
