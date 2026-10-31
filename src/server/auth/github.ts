// "Sign in with GitHub" (OAuth 2 authorization code + PKCE). Configured with
// GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET; the button is hidden otherwise.
//
// Linking rules: a GitHub account is only ever attached to one user. A new
// GitHub user gets a new account. If the GitHub email already belongs to an
// account here, nothing is linked silently — the person signs in as usual
// and connects GitHub from Settings.
import { createHash, createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeNextPath } from "@/lib/safe-next";
import { ApiError } from "../http/errors";
import { randomToken, safeEqual } from "../security/tokens";
import { assertSignupAllowed } from "../platform/settings";
import { audit } from "../services/audit";
import { appUrl } from "../services/mail";
import { createOrganization } from "../services/orgs";
import { createChallenge } from "./mfa";
import { createSession, secureAttr } from "./session";
import { recordLogin } from "./logins";
import { ssoRequiredFor } from "./sso";
import { cfg } from "../platform/config";

export const OAUTH_COOKIE = "cc_oauth";
const STATE_TTL_MS = 10 * 60_000;

type Http = (url: string, init: RequestInit) => Promise<Response>;
let http: Http = (url, init) => fetch(url, init);
/** Test hook: replace the network. */
export function setGithubHttp(fn: Http | null) {
  http = fn ?? ((url, init) => fetch(url, init));
}

export const githubConfigured = () => !!(cfg("GITHUB_CLIENT_ID") && cfg("GITHUB_CLIENT_SECRET"));
const redirectUri = () => appUrl("/api/v1/auth/github/callback");

function signKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("oauth-state-v1").digest();
}

type State = { s: string; v: string; next: string; mode: "login" | "link"; uid?: string; x: number };

function seal(st: State) {
  const body = Buffer.from(JSON.stringify(st)).toString("base64url");
  return `${body}.${createHmac("sha256", signKey()).update(body).digest("base64url")}`;
}

function unseal(raw: string | undefined): State | null {
  const [body, sig] = (raw ?? "").split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", signKey()).update(body).digest("base64url"))) return null;
  try {
    const st = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
    return st.x > Date.now() ? st : null;
  } catch {
    return null;
  }
}


export function stateCookie(value: string, maxAge: number) {
  return `${OAUTH_COOKIE}=${value}; Path=/api/v1/auth/github; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttr()}`;
}

/** Builds the GitHub authorize URL and the cookie that binds the callback to this browser. */
export function startGithub(opts: { next?: string | null; mode: "login" | "link"; userId?: string }) {
  if (!githubConfigured()) throw new ApiError("conflict", "GitHub sign-in is not configured on this platform");
  const verifier = randomToken(48);
  const st: State = { s: randomToken(16), v: verifier, next: safeNextPath(opts.next), mode: opts.mode, uid: opts.userId, x: Date.now() + STATE_TTL_MS };
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: cfg("GITHUB_CLIENT_ID")!,
    redirect_uri: redirectUri(),
    scope: "read:user user:email",
    state: st.s,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "true",
  }).toString();
  return { url: url.toString(), cookie: stateCookie(seal(st), STATE_TTL_MS / 1000) };
}

type GithubProfile = { id: string; login: string; name: string; email: string | null };

async function fetchProfile(code: string, verifier: string): Promise<GithubProfile> {
  const tokenRes = await http("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: cfg("GITHUB_CLIENT_ID"), client_secret: cfg("GITHUB_CLIENT_SECRET"), code, redirect_uri: redirectUri(), code_verifier: verifier }),
  });
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tok.access_token) throw new ApiError("unauthenticated", "GitHub did not confirm the sign-in. Try again.");
  const headers = { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "creation-cloud" };
  const [uRes, eRes] = await Promise.all([http("https://api.github.com/user", { headers }), http("https://api.github.com/user/emails", { headers })]);
  if (!uRes.ok) throw new ApiError("unauthenticated", "Could not read your GitHub profile");
  const u = (await uRes.json()) as { id: number; login: string; name: string | null };
  const emails = eRes.ok ? ((await eRes.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
  // Only a verified address may create or identify an account.
  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) ?? null;
  return { id: String(u.id), login: u.login, name: u.name || u.login, email: primary?.email ?? null };
}

export type CallbackResult =
  | { kind: "session"; token: string; expiresAt: Date; next: string }
  | { kind: "mfa"; challenge: string; next: string }
  | { kind: "linked"; next: string }
  | { kind: "error"; message: string; next: string };

export async function finishGithub(input: { code: string | null; state: string | null; cookie: string | undefined; currentUserId: string | null; meta: { ip?: string | null; userAgent?: string | null } }): Promise<CallbackResult> {
  const st = unseal(input.cookie);
  if (!st || !input.state || !safeEqual(st.s, input.state) || !input.code) return { kind: "error", message: "The GitHub sign-in expired or came from another browser. Try again.", next: "/login" };
  let profile: GithubProfile;
  try {
    profile = await fetchProfile(input.code, st.v);
  } catch (e) {
    return { kind: "error", message: e instanceof ApiError ? e.message : "GitHub sign-in failed", next: st.mode === "link" ? "/settings" : "/login" };
  }
  const [existing] = await db.select().from(schema.oauthAccounts).where(and(eq(schema.oauthAccounts.provider, "github"), eq(schema.oauthAccounts.providerUserId, profile.id)));

  if (st.mode === "link") {
    if (!st.uid || st.uid !== input.currentUserId) return { kind: "error", message: "Sign in again, then connect GitHub.", next: "/settings" };
    if (existing && existing.userId !== st.uid) return { kind: "error", message: `GitHub account @${profile.login} is already connected to another account.`, next: "/settings" };
    if (!existing) {
      const inserted = await db.insert(schema.oauthAccounts).values({ userId: st.uid, provider: "github", providerUserId: profile.id, login: profile.login, email: profile.email }).onConflictDoNothing().returning();
      if (!inserted.length) return { kind: "error", message: "Your account is already connected to a different GitHub account. Disconnect it first.", next: "/settings" };
      await audit({ actorId: st.uid, action: "user.github_connected", targetType: "user", targetId: st.uid, metadata: { login: profile.login } });
    }
    return { kind: "linked", next: "/settings?github=connected" };
  }

  let userId = existing?.userId ?? null;
  if (!userId) {
    if (!profile.email) return { kind: "error", message: "Your GitHub account has no verified email address. Add one on GitHub, or sign up with email.", next: "/login" };
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${profile.email.toLowerCase()}`);
    if (taken) return { kind: "error", message: `An account for ${profile.email} already exists. Sign in with your password, then connect GitHub in Settings.`, next: "/login" };
    try {
      await assertSignupAllowed(profile.email);
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "Sign-up isn't open", next: "/login" };
    }
    userId = await db.transaction(async (tx) => {
      const [u] = await tx.insert(schema.users).values({ name: profile.name.slice(0, 120), email: profile.email!, passwordHash: null, emailVerifiedAt: new Date() }).returning();
      await createOrganization(tx, { name: `${profile.name.split(" ")[0]}'s workspace`, ownerId: u.id });
      await tx.insert(schema.oauthAccounts).values({ userId: u.id, provider: "github", providerUserId: profile.id, login: profile.login, email: profile.email });
      return u.id;
    });
    await audit({ actorId: userId, action: "user.signup", targetType: "user", targetId: userId, ip: input.meta.ip, metadata: { via: "github" } });
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const sso = await ssoRequiredFor(user.id, user.email);
  if (sso) return { kind: "error", message: `${sso} signs in with single sign-on. Use “Sign in with SSO”.`, next: "/login" };
  if (user.totpEnabledAt) return { kind: "mfa", challenge: await createChallenge(user.id, "github"), next: st.next };
  const session = await createSession(user.id, input.meta);
  await recordLogin({ userId: user.id, email: user.email, ok: true, method: "github", ip: input.meta.ip, userAgent: input.meta.userAgent });
  await audit({ actorId: user.id, action: "user.login", ip: input.meta.ip, metadata: { via: "github" } });
  return { kind: "session", token: session.token, expiresAt: session.expiresAt, next: st.next };
}

export async function listConnections(userId: string) {
  return db.select({ provider: schema.oauthAccounts.provider, login: schema.oauthAccounts.login, createdAt: schema.oauthAccounts.createdAt }).from(schema.oauthAccounts).where(eq(schema.oauthAccounts.userId, userId));
}

export async function disconnectGithub(userId: string) {
  const [u] = await db.select({ hasPassword: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, userId));
  // Never leave an account with no way to sign in.
  if (!u?.hasPassword) throw new ApiError("conflict", "Set a password before disconnecting GitHub, or you won't be able to sign in.");
  await db.delete(schema.oauthAccounts).where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.provider, "github")));
  await audit({ actorId: userId, action: "user.github_disconnected", targetType: "user", targetId: userId });
}
