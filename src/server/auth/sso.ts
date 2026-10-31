// Single sign-on with OpenID Connect (Okta, Microsoft Entra ID, Google
// Workspace, Auth0, Keycloak…). A workspace proves it owns an email domain
// (a DNS TXT record), connects its identity provider, and people with that
// domain sign in there. ID tokens are checked here — signature against the
// provider's published keys (RS256 or ES256), issuer, audience, expiry and
// the nonce bound to this browser — before anyone is signed in. Someone new
// is added to the workspace with its chosen role; with "require SSO" on, the
// domain's members can't use a password or GitHub for that workspace's domain.
import { createHash, createHmac, createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { safeNextPath } from "@/lib/safe-next";
import { ApiError, notFound } from "../http/errors";
import { safeRequest, validateUrl } from "../net/safe-fetch";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken, safeEqual } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl } from "../services/mail";
import { recordLogin } from "./logins";
import { createChallenge } from "./mfa";
import { createSession, secureAttr } from "./session";

export const SSO_COOKIE = "cc_sso";
const STATE_TTL = 10 * 60_000;
const ROLES = ["admin", "billing", "developer", "designer", "editor", "viewer", "employee"] as const;

// ── Test hooks: the network and DNS ─────────────────────────────────────────

type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;
let http: Http = (url, init) => safeRequest(url, { ...init, maxBytes: 200_000, timeoutMs: 10_000 });
// A slow or unreachable DNS server shouldn't leave "Check now" hanging.
// The resolver's timeout is per try and per nameserver, so cap the whole lookup.
const resolveTxt = (name: string) => {
  const r = new Resolver({ timeout: 2000, tries: 1 });
  const cap = setTimeout(() => r.cancel(), 5000);
  return r.resolveTxt(name).finally(() => clearTimeout(cap));
};
let txt: (name: string) => Promise<string[][]> = resolveTxt;
export function setSsoHttp(fn: Http | null) {
  http = fn ?? ((url, init) => safeRequest(url, { ...init, maxBytes: 200_000, timeoutMs: 10_000 }));
}
export function setSsoDns(fn: ((name: string) => Promise<string[][]>) | null) {
  txt = fn ?? resolveTxt;
}

async function getJson(url: string) {
  const r = await http(url, { method: "GET", headers: { Accept: "application/json" } });
  if (r.status !== 200) throw new ApiError("provider_error", `The identity provider answered ${r.status} for ${new URL(url).pathname}`);
  try {
    return JSON.parse(r.text) as Record<string, unknown>;
  } catch {
    throw new ApiError("provider_error", "The identity provider didn't answer with JSON");
  }
}

const discoverySchema = z.object({ issuer: z.string(), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url() });
async function discover(issuer: string) {
  const base = issuer.replace(/\/+$/, "");
  const d = discoverySchema.safeParse(await getJson(`${base}/.well-known/openid-configuration`));
  if (!d.success) throw new ApiError("validation_failed", "That address isn't an OpenID Connect issuer (no valid discovery document)");
  if (d.data.issuer.replace(/\/+$/, "") !== base) throw new ApiError("validation_failed", `The provider says its issuer is ${d.data.issuer}`);
  return d.data;
}

// ── Workspace setup (owners and admins) ─────────────────────────────────────

export const connectionSchema = z.object({ issuer: z.url("Enter the issuer URL").max(300), clientId: z.string().trim().min(1, "Enter the client ID").max(300), clientSecret: z.string().max(500).optional(), enabled: z.boolean().default(true), enforce: z.boolean().default(false), jitRole: z.enum(ROLES).default("viewer") });

export async function connection(orgId: string) {
  const [c] = await db.select().from(schema.ssoConnections).where(eq(schema.ssoConnections.orgId, orgId));
  const domains = await db.select({ id: schema.ssoDomains.id, domain: schema.ssoDomains.domain, token: schema.ssoDomains.token, verifiedAt: schema.ssoDomains.verifiedAt }).from(schema.ssoDomains).where(eq(schema.ssoDomains.orgId, orgId));
  return { connection: c ? { issuer: c.issuer, clientId: c.clientId, enabled: c.enabled, enforce: c.enforce, jitRole: c.jitRole, lastLoginAt: c.lastLoginAt, hasSecret: !!c.clientSecretEnc } : null, domains: domains.map((d) => ({ ...d, record: { name: `_cloudesk.${d.domain}`, value: `cloudesk-verify=${d.token}` } })), redirectUri: appUrl("/api/v1/auth/sso/callback") };
}

export async function saveConnection(orgId: string, actorId: string, raw: unknown) {
  const v = connectionSchema.parse(raw);
  validateUrl(v.issuer);
  try {
    await discover(v.issuer);
  } catch (e) {
    if (e instanceof ApiError && e.code === "provider_error") throw new ApiError("validation_failed", `Couldn't read the provider's OpenID configuration: ${e.message}`, { issuer: ["Not reachable"] });
    throw e;
  }
  const [cur] = await db.select().from(schema.ssoConnections).where(eq(schema.ssoConnections.orgId, orgId));
  if (!cur && !v.clientSecret) throw new ApiError("validation_failed", "Enter the client secret", { clientSecret: ["Required"] });
  if (v.enforce && !(await db.select().from(schema.ssoDomains).where(and(eq(schema.ssoDomains.orgId, orgId), isNotNull(schema.ssoDomains.verifiedAt)))).length) throw new ApiError("validation_failed", "Verify a domain before requiring SSO");
  const values = { issuer: v.issuer.replace(/\/+$/, ""), clientId: v.clientId, enabled: v.enabled, enforce: v.enforce, jitRole: v.jitRole, ...(v.clientSecret ? { clientSecretEnc: encryptSecret(v.clientSecret) } : {}) };
  if (cur) await db.update(schema.ssoConnections).set(values).where(eq(schema.ssoConnections.orgId, orgId));
  else await db.insert(schema.ssoConnections).values({ ...values, orgId, clientSecretEnc: encryptSecret(v.clientSecret!) });
  await audit({ orgId, actorId, action: "sso.configured", targetType: "organization", targetId: orgId, metadata: { issuer: values.issuer, enabled: v.enabled, enforce: v.enforce, jitRole: v.jitRole } });
  return connection(orgId);
}

export async function removeConnection(orgId: string, actorId: string) {
  await db.delete(schema.ssoConnections).where(eq(schema.ssoConnections.orgId, orgId));
  await audit({ orgId, actorId, action: "sso.removed", targetType: "organization", targetId: orgId });
}

const domainRe = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PUBLIC = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com", "aol.com", "zoho.com"]);

export async function addDomain(orgId: string, raw: unknown) {
  const domain = z.object({ domain: z.string().trim().toLowerCase().max(253) }).parse(raw).domain.replace(/^@/, "");
  if (!domainRe.test(domain)) throw new ApiError("validation_failed", "Enter a domain like yourcompany.in", { domain: ["Invalid"] });
  if (PUBLIC.has(domain)) throw new ApiError("validation_failed", "A public email domain can't be claimed by a workspace", { domain: ["Public domain"] });
  const [r] = await db.insert(schema.ssoDomains).values({ orgId, domain, token: randomToken(16) }).onConflictDoNothing().returning();
  if (!r) throw new ApiError("conflict", "That domain is already added");
  return r;
}

export async function removeDomain(orgId: string, id: string) {
  await db.delete(schema.ssoDomains).where(and(eq(schema.ssoDomains.id, id), eq(schema.ssoDomains.orgId, orgId)));
}

/** Look for the TXT record; a domain can be verified by only one workspace. */
export async function verifyDomain(orgId: string, actorId: string, id: string) {
  const [d] = await db.select().from(schema.ssoDomains).where(and(eq(schema.ssoDomains.id, id), eq(schema.ssoDomains.orgId, orgId)));
  if (!d) throw notFound("Domain");
  let records: string[][] = [];
  try {
    records = await txt(`_cloudesk.${d.domain}`);
  } catch {
    records = [];
  }
  if (!records.some((r) => r.join("") === `cloudesk-verify=${d.token}`)) throw new ApiError("validation_failed", `No TXT record _cloudesk.${d.domain} with cloudesk-verify=${d.token} yet. DNS changes can take a while to appear.`);
  try {
    await db.update(schema.ssoDomains).set({ verifiedAt: new Date() }).where(eq(schema.ssoDomains.id, d.id));
  } catch {
    throw new ApiError("conflict", "Another workspace has already verified this domain");
  }
  await audit({ orgId, actorId, action: "sso.domain_verified", targetType: "organization", targetId: orgId, metadata: { domain: d.domain } });
  return { ok: true };
}

/** The workspace that owns this email's domain and has SSO on, if any. */
async function connectionForEmail(email: string) {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (!domain) return null;
  const [r] = await db.select({ c: schema.ssoConnections, org: schema.organizations }).from(schema.ssoDomains).innerJoin(schema.ssoConnections, eq(schema.ssoConnections.orgId, schema.ssoDomains.orgId)).innerJoin(schema.organizations, eq(schema.organizations.id, schema.ssoDomains.orgId)).where(and(eq(schema.ssoDomains.domain, domain), isNotNull(schema.ssoDomains.verifiedAt), eq(schema.ssoConnections.enabled, true)));
  return r ?? null;
}

/** If this person must use SSO (their domain's workspace requires it and they're a member there), its name. */
export async function ssoRequiredFor(userId: string, email: string) {
  const r = await connectionForEmail(email);
  if (!r || !r.c.enforce) return null;
  const [m] = await db.select({ u: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, r.org.id), eq(schema.memberships.userId, userId)));
  return m ? r.org.name : null;
}

// ── Signing in ──────────────────────────────────────────────────────────────

function key() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("sso-state-v1").digest();
}
type State = { o: string; s: string; n: string; v: string; next: string; x: number };
const seal = (st: State) => {
  const body = Buffer.from(JSON.stringify(st)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
};
function unseal(raw: string | undefined): State | null {
  const [body, sig] = (raw ?? "").split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", key()).update(body).digest("base64url"))) return null;
  try {
    const st = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
    return st.x > Date.now() ? st : null;
  } catch {
    return null;
  }
}
export const ssoCookie = (value: string, maxAge: number) => `${SSO_COOKIE}=${value}; Path=/api/v1/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttr()}`;

/** Where to send someone to sign in, from their email. Says the same for unknown domains as a fixed message. */
export async function start(raw: unknown) {
  const v = z.object({ email: z.email("Enter your work email"), next: z.string().max(300).optional() }).parse(raw);
  const r = await connectionForEmail(v.email);
  if (!r) throw new ApiError("not_found", "Single sign-on isn't set up for that email's domain. Sign in with your password instead.");
  const d = await discover(r.c.issuer);
  const verifier = randomToken(32);
  const st: State = { o: r.org.id, s: randomToken(16), n: randomToken(16), v: verifier, next: safeNextPath(v.next), x: Date.now() + STATE_TTL };
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: r.c.clientId, redirect_uri: appUrl("/api/v1/auth/sso/callback"), scope: "openid email profile", state: st.s, nonce: st.n, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", login_hint: v.email }).toString();
  return { url: url.toString(), cookie: ssoCookie(seal(st), STATE_TTL / 1000) };
}

const b64 = (s: string) => Buffer.from(s, "base64url");

/** Check an ID token's signature against the provider's keys, and its claims. */
export async function verifyIdToken(idToken: string, opts: { issuer: string; clientId: string; jwksUri: string; nonce: string; now?: number }) {
  const [h, p, sig] = idToken.split(".");
  if (!h || !p || !sig) throw new ApiError("unauthenticated", "The identity provider sent a malformed token");
  const header = JSON.parse(b64(h).toString()) as { alg: string; kid?: string };
  if (header.alg !== "RS256" && header.alg !== "ES256") throw new ApiError("unauthenticated", `Unsupported token algorithm ${header.alg}`);
  const jwks = (await getJson(opts.jwksUri)) as { keys?: (JsonWebKey & { kid?: string; use?: string })[] };
  const candidates = (jwks.keys ?? []).filter((k) => (!header.kid || k.kid === header.kid) && (!k.use || k.use === "sig") && (header.alg === "RS256" ? k.kty === "RSA" : k.kty === "EC"));
  const data = Buffer.from(`${h}.${p}`);
  const ok = candidates.some((k) => {
    try {
      const pub = createPublicKey({ key: k, format: "jwk" });
      return header.alg === "RS256" ? cryptoVerify("sha256", data, pub, b64(sig)) : cryptoVerify("sha256", data, { key: pub, dsaEncoding: "ieee-p1363" }, b64(sig));
    } catch {
      return false;
    }
  });
  if (!ok) throw new ApiError("unauthenticated", "The identity provider's token signature didn't check out");
  const c = JSON.parse(b64(p).toString()) as { iss?: string; aud?: string | string[]; exp?: number; iat?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string; azp?: string };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if ((c.iss ?? "").replace(/\/+$/, "") !== opts.issuer.replace(/\/+$/, "")) throw new ApiError("unauthenticated", "The token is from a different issuer");
  if (!aud.includes(opts.clientId) || (aud.length > 1 && c.azp && c.azp !== opts.clientId)) throw new ApiError("unauthenticated", "The token wasn't issued for Cloudesk");
  if (!c.exp || c.exp < now - 60) throw new ApiError("unauthenticated", "The token has expired");
  if (c.iat && c.iat > now + 300) throw new ApiError("unauthenticated", "The token is dated in the future");
  if (!c.nonce || !safeEqual(c.nonce, opts.nonce)) throw new ApiError("unauthenticated", "The token doesn't belong to this sign-in");
  if (!c.sub) throw new ApiError("unauthenticated", "The token has no subject");
  return c;
}

export type SsoResult = { kind: "session"; token: string; expiresAt: Date; next: string } | { kind: "mfa"; challenge: string; next: string } | { kind: "error"; message: string };

export async function finish(input: { code: string | null; state: string | null; cookie: string | undefined; meta: { ip: string | null; userAgent: string | null } }): Promise<SsoResult> {
  const st = unseal(input.cookie);
  if (!st || !input.state || !safeEqual(st.s, input.state) || !input.code) return { kind: "error", message: "The sign-in expired or came from another browser. Try again." };
  const [c] = await db.select().from(schema.ssoConnections).where(and(eq(schema.ssoConnections.orgId, st.o), eq(schema.ssoConnections.enabled, true)));
  if (!c) return { kind: "error", message: "Single sign-on is no longer set up for this workspace" };
  try {
    const d = await discover(c.issuer);
    const tok = await http(d.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(decryptSecret(c.clientSecretEnc))}`).toString("base64")}` }, body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: appUrl("/api/v1/auth/sso/callback"), code_verifier: st.v }).toString() });
    if (tok.status !== 200) throw new ApiError("unauthenticated", `The identity provider refused the sign-in (${tok.status})`);
    const idToken = (JSON.parse(tok.text) as { id_token?: string }).id_token;
    if (!idToken) throw new ApiError("unauthenticated", "The identity provider sent no ID token");
    const claims = await verifyIdToken(idToken, { issuer: d.issuer, clientId: c.clientId, jwksUri: d.jwks_uri, nonce: st.n });
    const email = (claims.email ?? "").toLowerCase();
    if (!email || claims.email_verified === false || claims.email_verified === "false") throw new ApiError("unauthenticated", "The identity provider didn't give a verified email");
    const [dom] = await db.select().from(schema.ssoDomains).where(and(eq(schema.ssoDomains.orgId, c.orgId), eq(schema.ssoDomains.domain, email.split("@")[1] ?? ""), isNotNull(schema.ssoDomains.verifiedAt)));
    if (!dom) throw new ApiError("forbidden", `${email} isn't on a domain this workspace has verified`);
    // The person: found by email, or created; added to the workspace if new to it.
    let [user] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
    if (!user) [user] = await db.insert(schema.users).values({ email, name: (claims.name ?? email.split("@")[0]).slice(0, 120), passwordHash: null, emailVerifiedAt: new Date() }).returning();
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, c.orgId), eq(schema.memberships.userId, user.id)));
    if (!m) {
      const { assertWithinLimit } = await import("../billing/billing");
      await assertWithinLimit(c.orgId, "seats");
      await db.insert(schema.memberships).values({ orgId: c.orgId, userId: user.id, role: c.jitRole as never });
      await audit({ orgId: c.orgId, actorId: user.id, action: "member.joined_sso", targetType: "user", targetId: user.id, metadata: { role: c.jitRole } });
    }
    // The account is the person's own (it may own other workspaces): its two-step
    // sign-in still applies, so one workspace's identity provider can't skip it.
    if (user.disabledAt) throw new ApiError("forbidden", "This account is disabled. Contact support if you think this is a mistake.");
    if (user.totpEnabledAt) return { kind: "mfa", challenge: await createChallenge(user.id, "sso"), next: st.next };
    const session = await createSession(user.id, input.meta);
    await db.update(schema.ssoConnections).set({ lastLoginAt: new Date() }).where(eq(schema.ssoConnections.orgId, c.orgId));
    await audit({ orgId: c.orgId, actorId: user.id, action: "user.login", ip: input.meta.ip, metadata: { via: "sso", subject: claims.sub } });
    await recordLogin({ userId: user.id, email, ok: true, method: "sso", ip: input.meta.ip, userAgent: input.meta.userAgent });
    return { kind: "session", token: session.token, expiresAt: session.expiresAt, next: st.next };
  } catch (e) {
    const message = e instanceof ApiError ? e.message : "Single sign-on failed";
    await recordLogin({ userId: null, email: "", ok: false, method: "sso", reason: message.slice(0, 200), ip: input.meta.ip, userAgent: input.meta.userAgent });
    return { kind: "error", message };
  }
}
