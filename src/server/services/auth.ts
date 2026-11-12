import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, verifyPassword } from "../auth/password";
import { createChallenge } from "../auth/mfa";
import { verifyOtp } from "../auth/otp";
import { createSession, revokeAllSessions } from "../auth/session";
import { ApiError } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "./audit";
import { appUrl, sendMail } from "./mail";
import { createOrganization } from "./orgs";
import { assertPasswordNotLocked, recordLogin } from "../auth/logins";
import { ssoRequiredFor } from "../auth/sso";
import { assertSignupAllowed, signupTrial } from "../platform/settings";

type Meta = { ip?: string | null; userAgent?: string | null };

// A real hash so failed lookups take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function findUserByEmail(email: string) {
  const [u] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return u ?? null;
}

export async function signUp(input: { name: string; email: string; password: string; orgName?: string }, meta: Meta) {
  if (await findUserByEmail(input.email)) {
    throw new ApiError("conflict", "An account with this email already exists");
  }
  await assertSignupAllowed(input.email);
  const trial = await signupTrial();
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({ name: input.name, email: input.email.trim(), passwordHash })
      .returning();
    const org = await createOrganization(tx, { name: input.orgName?.trim() || `${input.name.split(" ")[0]}'s workspace`, ownerId: u.id });
    if (trial.trialPlan) await tx.update(schema.organizations).set(trial).where(eq(schema.organizations.id, org.id));
    return u;
  });
  await issueEmailVerification(user.id, user.email);
  await audit({ actorId: user.id, action: "user.signup", targetType: "user", targetId: user.id, ip: meta.ip });
  const session = await createSession(user.id, meta);
  return { user, session };
}

export async function logIn(input: { email: string; password: string }, meta: Meta) {
  // Checked the same way whether or not the account exists, so it can't be used to find accounts.
  await assertPasswordNotLocked(input.email);
  const user = await findUserByEmail(input.email);
  const fail = async (reason: string) => {
    await recordLogin({ userId: user?.id ?? null, email: input.email, ok: false, method: "password", reason, ip: meta.ip, userAgent: meta.userAgent });
    return new ApiError("unauthenticated", "Email or password is incorrect");
  };
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(await dummyHash, input.password);
    throw await fail("unknown email");
  }
  if (!user.passwordHash) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(await dummyHash, input.password);
    throw await fail("no password set");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await audit({ actorId: user.id, action: "user.login_failed", ip: meta.ip });
    throw await fail("wrong password");
  }
  if (user.disabledAt) {
    await recordLogin({ userId: user.id, email: user.email, ok: false, method: "password", reason: "disabled", ip: meta.ip, userAgent: meta.userAgent });
    throw new ApiError("forbidden", "This account is disabled. Contact support if you think this is a mistake.");
  }
  // A workspace that requires SSO for its domain: the password isn't enough.
  const sso = await ssoRequiredFor(user.id, user.email);
  if (sso) {
    await recordLogin({ userId: user.id, email: user.email, ok: false, method: "password", reason: "sso required", ip: meta.ip, userAgent: meta.userAgent });
    throw new ApiError("forbidden", `${sso} signs in with single sign-on. Use “Sign in with SSO”.`);
  }
  // With two-factor on, the password only earns a short-lived challenge.
  if (user.totpEnabledAt) return { user, mfaChallenge: await createChallenge(user.id, "password") };
  const session = await createSession(user.id, meta);
  await audit({ actorId: user.id, action: "user.login", ip: meta.ip });
  await recordLogin({ userId: user.id, email: user.email, ok: true, method: "password", ip: meta.ip, userAgent: meta.userAgent });
  return { user, session };
}

/** Sign-in step one with an emailed code: the same answer whether or not the account exists. */
export async function sendLoginCode(email: string, meta: Meta) {
  const user = await findUserByEmail(email);
  if (!user || user.disabledAt) {
    // Still rate-limited and timed like a real send, so it can't be used to find accounts.
    const { rateLimit } = await import("../security/rate-limit");
    await rateLimit(`otp:login:${email.trim().toLowerCase()}`, 6, 60 * 60_000);
    return { sent: true as const, devCode: undefined };
  }
  const { issueOtp } = await import("../auth/otp");
  const r = await issueOtp(user.email, "login", { ip: meta.ip });
  return { sent: true as const, devCode: r.devCode };
}

/** Sign-in step two: the code, then the same checks as a password (disabled, SSO, two-step). */
export async function logInWithCode(input: { email: string; code: string }, meta: Meta) {
  const { verifyOtp } = await import("../auth/otp");
  const user = await findUserByEmail(input.email);
  try {
    await verifyOtp({ purpose: "login", email: input.email, code: input.code, ip: meta.ip });
  } catch (e) {
    await recordLogin({ userId: user?.id ?? null, email: input.email, ok: false, method: "email_code", reason: "wrong code", ip: meta.ip, userAgent: meta.userAgent });
    throw e;
  }
  if (!user) throw new ApiError("unauthenticated", "That code is wrong or has expired. Ask for a new one.");
  if (user.disabledAt) throw new ApiError("forbidden", "This account is disabled. Contact support if you think this is a mistake.");
  const sso = await ssoRequiredFor(user.id, user.email);
  if (sso) throw new ApiError("forbidden", `${sso} signs in with single sign-on. Use “Sign in with SSO”.`);
  // The code proves the mailbox, so the address counts as verified.
  if (!user.emailVerifiedAt) await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
  if (user.totpEnabledAt) return { user, mfaChallenge: await createChallenge(user.id, "password") };
  const session = await createSession(user.id, meta);
  await audit({ actorId: user.id, action: "user.login", ip: meta.ip, metadata: { method: "email_code" } });
  await recordLogin({ userId: user.id, email: user.email, ok: true, method: "email_code", ip: meta.ip, userAgent: meta.userAgent });
  return { user, session };
}

async function issueToken(userId: string, kind: "email_verify" | "password_reset", ttlMs: number) {
  const token = randomToken();
  await db.insert(schema.authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function consumeToken(token: string, kind: "email_verify" | "password_reset") {
  const [row] = await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.authTokens.tokenHash, sha256(token)),
        eq(schema.authTokens.kind, kind),
        isNull(schema.authTokens.usedAt),
        gt(schema.authTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new ApiError("bad_request", "This link is invalid or has expired");
  return row;
}

/** Once the password changes, any other reset link still in a mailbox stops working. */
async function expireResetLinks(userId: string) {
  await db.update(schema.authTokens).set({ usedAt: new Date() }).where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.kind, "password_reset"), isNull(schema.authTokens.usedAt)));
}

export async function issueEmailVerification(userId: string, email: string) {
  const token = await issueToken(userId, "email_verify", 48 * 3600_000);
  await sendMail({
    to: email,
    subject: "Verify your email",
    body: `Confirm your email address by opening this link:\n\n${appUrl(`/verify-email?token=${token}`)}\n\nThe link expires in 48 hours.`,
  });
}

export async function verifyEmail(token: string) {
  const row = await consumeToken(token, "email_verify");
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, row.userId));
  await audit({ actorId: row.userId, action: "user.email_verified" });
}

export async function requestPasswordReset(email: string, meta: Meta) {
  const user = await findUserByEmail(email);
  // Same response whether or not the account exists.
  if (!user) return;
  const token = await issueToken(user.id, "password_reset", 3600_000);
  await sendMail({
    to: user.email,
    subject: "Reset your password",
    body: `Someone asked to reset the password for this account. If it was you, open:\n\n${appUrl(`/reset-password?token=${token}`)}\n\nThe link expires in 1 hour. If it was not you, ignore this email.`,
  });
  await audit({ actorId: user.id, action: "user.password_reset_requested", ip: meta.ip });
}

export async function resetPassword(token: string, password: string, meta: Meta) {
  const row = await consumeToken(token, "password_reset");
  await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, row.userId));
  await expireResetLinks(row.userId);
  await revokeAllSessions(row.userId);
  await audit({ actorId: row.userId, action: "user.password_reset", ip: meta.ip });
}

export async function changePassword(userId: string, sessionId: string, current: string, next: string, opts: { code?: string; ip?: string | null } = {}) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new ApiError("unauthenticated", "Sign in again");
  // Forgot the current one: a code emailed to the account stands in for it.
  if (opts.code) await verifyOtp({ purpose: "password", code: opts.code, email: u.email, ip: opts.ip ?? null });
  // Accounts created with GitHub have no password yet and may set one here.
  else if (u.passwordHash && !(await verifyPassword(u.passwordHash, current))) {
    throw new ApiError("validation_failed", "Current password is incorrect", { currentPassword: ["Incorrect password"] });
  }
  await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, userId));
  await expireResetLinks(userId);
  await revokeAllSessions(userId, sessionId);
  await audit({ actorId: userId, action: "user.password_changed", ...(opts.code ? { metadata: { by: "email_code" } } : {}) });
}
