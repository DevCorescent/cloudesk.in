// Two-factor sign-in with authenticator apps (TOTP, RFC 6238: SHA-1, 30 s,
// 6 digits) and one-time recovery codes.
import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { rateLimit } from "../security/rate-limit";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken, safeEqual, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { verifyPassword } from "./password";
import { createSession, revokeAllSessions, secureAttr } from "./session";
import { recordLogin } from "./logins";

const STEP_S = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for a given 30-second step. */
export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_S);

/** Accepts the current code and one step either side (clock drift). Returns the matched step. */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepOf(now);
  for (const step of [s, s - 1, s + 1]) if (safeEqual(totpAt(secretB32, step), c)) return step;
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = "Cloudesk") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

export async function mfaStatus(userId: string) {
  const [u] = await db.select({ enabled: schema.users.totpEnabledAt, hasPassword: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, userId));
  const codes = await db.select({ usedAt: schema.mfaRecoveryCodes.usedAt }).from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
  return { enabled: !!u?.enabled, enabledAt: u?.enabled ?? null, recoveryCodesLeft: codes.filter((c) => !c.usedAt).length, hasPassword: !!u?.hasPassword };
}

/** Starts setup: a fresh secret, saved but not active until a code confirms it. */
export async function beginTotpSetup(userId: string, email: string) {
  const [u] = await db.select({ enabled: schema.users.totpEnabledAt }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.enabled) throw new ApiError("conflict", "Two-factor sign-in is already on. Turn it off first to set up a new device.");
  const secret = base32Encode(randomBytes(20));
  await db.update(schema.users).set({ totpSecret: encryptSecret(secret) }).where(eq(schema.users.id, userId));
  return { secret, url: otpauthUrl(secret, email) };
}

function newRecoveryCodes() {
  // 10 codes like "k7m2-9xqp-4tzd": easy to type, ~60 bits each.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => {
    const b = randomBytes(12);
    const raw = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

async function replaceRecoveryCodes(userId: string) {
  const codes = newRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
    await tx.insert(schema.mfaRecoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(c) })));
  });
  return codes;
}

export async function enableTotp(userId: string, code: string, meta: { ip?: string | null; sessionId?: string }) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.totpSecret) throw new ApiError("conflict", "Start setup first");
  if (u.totpEnabledAt) throw new ApiError("conflict", "Two-factor sign-in is already on");
  const step = matchTotp(decryptSecret(u.totpSecret), code);
  if (step === null) throw new ApiError("validation_failed", "That code didn't match. Check the time on your phone and try the newest code.", { code: ["Incorrect code"] });
  await db.update(schema.users).set({ totpEnabledAt: new Date(), totpLastStep: step }).where(eq(schema.users.id, userId));
  const codes = await replaceRecoveryCodes(userId);
  // Sessions started before two-step was on (perhaps by someone else) end; this one stays.
  await revokeAllSessions(userId, meta.sessionId);
  await audit({ actorId: userId, action: "user.mfa_enabled", targetType: "user", targetId: userId, ip: meta.ip });
  return { recoveryCodes: codes };
}

/** Checks a TOTP code (no replays) or an unused recovery code. */
export async function verifySecondFactor(userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.totpEnabledAt || !u.totpSecret) return null;
  const clean = code.trim().toLowerCase();
  if (/^\d{3}\s?\d{3}$/.test(clean)) {
    const step = matchTotp(decryptSecret(u.totpSecret), clean);
    if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep)) return null;
    // Conditional update: two requests with the same code can't both win.
    const ok = await db
      .update(schema.users)
      .set({ totpLastStep: step })
      .where(and(eq(schema.users.id, userId), u.totpLastStep === null ? isNull(schema.users.totpLastStep) : eq(schema.users.totpLastStep, u.totpLastStep)))
      .returning({ id: schema.users.id });
    return ok.length ? "totp" : null;
  }
  const used = await db
    .update(schema.mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.mfaRecoveryCodes.userId, userId), eq(schema.mfaRecoveryCodes.codeHash, sha256(clean)), isNull(schema.mfaRecoveryCodes.usedAt)))
    .returning({ id: schema.mfaRecoveryCodes.id });
  return used.length ? "recovery" : null;
}

/** Turning it off needs proof: the password (if the account has one) or a current code. */
export async function disableTotp(userId: string, proof: { password?: string; code?: string }, meta: { ip?: string | null; sessionId?: string }) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.totpEnabledAt) throw new ApiError("conflict", "Two-factor sign-in is not on");
  const byPassword = !!(proof.password && u.passwordHash && (await verifyPassword(u.passwordHash, proof.password)));
  const byCode = !byPassword && !!proof.code && !!(await verifySecondFactor(userId, proof.code));
  if (!byPassword && !byCode) throw new ApiError("forbidden", "Confirm with your password or a current code");
  await db.update(schema.users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(schema.users.id, userId));
  await db.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
  await revokeAllSessions(userId, meta.sessionId);
  await audit({ actorId: userId, action: "user.mfa_disabled", targetType: "user", targetId: userId, ip: meta.ip });
}

export async function regenerateRecoveryCodes(userId: string, code: string) {
  if ((await verifySecondFactor(userId, code)) !== "totp") throw new ApiError("forbidden", "Enter a current code from your authenticator app");
  const codes = await replaceRecoveryCodes(userId);
  await audit({ actorId: userId, action: "user.mfa_recovery_regenerated", targetType: "user", targetId: userId });
  return { recoveryCodes: codes };
}

// ─── Sign-in challenge ───────────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_COOKIE = "cc_mfa";

/** Carries a GitHub sign-in's challenge to the code step; only the code endpoint sees it. */
export function mfaCookie(value: string, maxAge: number) {
  return `${MFA_COOKIE}=${value}; Path=/api/v1/auth/login/mfa; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttr()}`;
}
const MAX_ATTEMPTS = 5;

export async function createChallenge(userId: string, method: "password" | "github" | "sso") {
  const token = randomToken();
  await db.insert(schema.mfaChallenges).values({ id: sha256(token), userId, method, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  return token;
}

export async function completeChallenge(token: string, code: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const id = sha256(token);
  // A try is taken before the code is checked, in one statement, so guesses
  // sent in parallel can't get past the limit.
  const [c] = await db
    .update(schema.mfaChallenges)
    .set({ attempts: sql`${schema.mfaChallenges.attempts} + 1` })
    .where(and(eq(schema.mfaChallenges.id, id), isNull(schema.mfaChallenges.usedAt), gt(schema.mfaChallenges.expiresAt, new Date()), lt(schema.mfaChallenges.attempts, MAX_ATTEMPTS)))
    .returning();
  if (!c) throw new ApiError("unauthenticated", "This sign-in expired. Start again.");
  // Someone who knows the password can start many challenges (from many addresses): codes per account are limited too.
  await rateLimit(`mfa:user:${c.userId}`, 10, 15 * 60_000);
  const method = await verifySecondFactor(c.userId, code);
  if (!method) {
    await audit({ actorId: c.userId, action: "user.mfa_failed", ip: meta.ip });
    await recordLogin({ userId: c.userId, email: "", ok: false, method: "mfa", reason: "wrong code", ip: meta.ip, userAgent: meta.userAgent });
    throw new ApiError("unauthenticated", c.attempts >= MAX_ATTEMPTS ? "Too many incorrect codes. Start again." : "That code didn't work. Try the newest code or a recovery code.");
  }
  const consumed = await db.update(schema.mfaChallenges).set({ usedAt: new Date() }).where(and(eq(schema.mfaChallenges.id, id), isNull(schema.mfaChallenges.usedAt))).returning({ id: schema.mfaChallenges.id });
  if (!consumed.length) throw new ApiError("unauthenticated", "This sign-in expired. Start again.");
  const session = await createSession(c.userId, meta);
  await audit({ actorId: c.userId, action: "user.login", ip: meta.ip, metadata: { mfa: method, via: c.method } });
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, c.userId));
  await recordLogin({ userId: c.userId, email: user?.email ?? "", ok: true, method: c.method === "github" ? "github" : c.method === "sso" ? "sso" : "mfa", ip: meta.ip, userAgent: meta.userAgent });
  return { user, session, usedRecoveryCode: method === "recovery" };
}
