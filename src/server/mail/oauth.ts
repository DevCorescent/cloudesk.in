// "Sign in with Google / Microsoft" for mailboxes. The platform's own OAuth
// app (client id and secret set in Admin → Integrations, or the environment)
// asks the person for mail access; we keep only the refresh token (encrypted)
// and use short-lived access tokens over IMAP/SMTP (XOAUTH2). The state is
// signed and tied to a cookie, so a callback can't be replayed or forged.
import { createHmac } from "node:crypto";
import { ApiError } from "../http/errors";
import { cfg } from "../platform/config";
import { randomToken, safeEqual } from "../security/tokens";
import { appUrl } from "../services/mail";

export type OauthProvider = "google" | "microsoft";
export const OAUTH_COOKIE = "cc_mail_oauth";
const TTL = 10 * 60_000;

const ENDPOINTS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile https://mail.google.com/",
    id: "GOOGLE_OAUTH_CLIENT_ID",
    secret: "GOOGLE_OAUTH_CLIENT_SECRET",
  },
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    id: "MICROSOFT_OAUTH_CLIENT_ID",
    secret: "MICROSOFT_OAUTH_CLIENT_SECRET",
  },
} as const;

export const oauthConfigured = (p: OauthProvider) => !!(cfg(ENDPOINTS[p].id) && cfg(ENDPOINTS[p].secret));
export const redirectUri = () => appUrl("/api/v1/mail/oauth/callback");

type State = { p: OauthProvider; org: string; uid: string; n: string; x: number; shared: boolean };
function key() {
  const raw = process.env.APP_ENCRYPTION_KEY ?? "";
  return createHmac("sha256", Buffer.from(raw, "base64")).update("mail-oauth-state-v1").digest();
}
export function seal(st: State) {
  const body = Buffer.from(JSON.stringify(st)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function unseal(raw: string | null | undefined): State | null {
  const [body, sig] = (raw ?? "").split(".");
  if (!body || !sig || !safeEqual(sig, createHmac("sha256", key()).update(body).digest("base64url"))) return null;
  try {
    const st = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
    return st.x > Date.now() ? st : null;
  } catch {
    return null;
  }
}

/** Where to send the person to approve mail access, and the cookie that binds the answer to this browser. */
export function startUrl(p: OauthProvider, o: { orgId: string; userId: string; loginHint?: string; shared?: boolean }) {
  if (!oauthConfigured(p)) throw new ApiError("provider_not_configured", `Sign in with ${p === "google" ? "Google" : "Microsoft"} isn't set up on this platform yet — an admin adds it in Admin → Integrations.`);
  const st: State = { p, org: o.orgId, uid: o.userId, n: randomToken(16), x: Date.now() + TTL, shared: !!o.shared };
  const e = ENDPOINTS[p];
  const u = new URL(e.authorize);
  u.searchParams.set("client_id", cfg(e.id)!);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", e.scope);
  u.searchParams.set("state", seal(st));
  if (p === "google") {
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
  } else u.searchParams.set("prompt", "select_account");
  if (o.loginHint) u.searchParams.set("login_hint", o.loginHint);
  const secure = (process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return { url: u.toString(), cookie: `${OAUTH_COOKIE}=${st.n}; Path=/api/v1/mail/oauth; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure}`, state: st };
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; email: string | null; name: string | null };

async function tokenCall(p: OauthProvider, params: Record<string, string>, f: typeof fetch): Promise<Tokens> {
  const e = ENDPOINTS[p];
  let res: Response;
  try {
    res = await f(e.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg(e.id)!, client_secret: cfg(e.secret)!, ...params }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError("provider_error", `Couldn't reach ${p === "google" ? "Google" : "Microsoft"}. Try again.`);
  }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new ApiError("provider_error", `${p === "google" ? "Google" : "Microsoft"} refused: ${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  // The ID token comes straight from the token endpoint over TLS; its claims only label the mailbox.
  let email: string | null = null;
  let name: string | null = null;
  if (j.id_token) {
    try {
      const claims = JSON.parse(Buffer.from(j.id_token.split(".")[1] ?? "", "base64url").toString()) as { email?: string; preferred_username?: string; name?: string };
      email = claims.email ?? claims.preferred_username ?? null;
      name = claims.name ?? null;
    } catch {}
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000), email, name };
}

export const exchangeCode = (p: OauthProvider, code: string, f: typeof fetch = fetch) => tokenCall(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), ...(p === "microsoft" ? { scope: ENDPOINTS.microsoft.scope } : {}) }, f);
export const refreshAccess = (p: OauthProvider, refreshToken: string, f: typeof fetch = fetch) => tokenCall(p, { grant_type: "refresh_token", refresh_token: refreshToken, ...(p === "microsoft" ? { scope: ENDPOINTS.microsoft.scope } : {}) }, f);
