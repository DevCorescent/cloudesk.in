import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as connections from "@/app/api/v1/auth/connections/route";
import * as ghCallback from "@/app/api/v1/auth/github/callback/route";
import * as ghStart from "@/app/api/v1/auth/github/start/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as loginMfa from "@/app/api/v1/auth/login/mfa/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as mfa from "@/app/api/v1/auth/mfa/[[...slug]]/route";
import * as password from "@/app/api/v1/auth/password/route";
import * as providers from "@/app/api/v1/auth/providers/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as orgSecurity from "@/app/api/v1/orgs/[orgId]/security/route";
import { setGithubHttp } from "@/server/auth/github";
import { base32Encode, stepOf, totpAt } from "@/server/auth/mfa";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const PW = "correct-horse-42";
const mfaCall = (cookie: string, slug: string[], body?: unknown) => call(slug.length ? mfa.POST : mfa.GET, { method: slug.length ? "POST" : "GET", cookie, body, params: { slug } });
/** A valid code for a step that hasn't been used yet. */
const codeFor = (secret: string, offset = 0) => totpAt(secret, stepOf(Date.now()) + offset);

beforeAll(async () => {
  await resetDb();
  process.env.GITHUB_CLIENT_ID = "gh-client";
  process.env.GITHUB_CLIENT_SECRET = "gh-secret";
});
afterEach(() => {
  vi.useRealTimers();
  setGithubHttp(null);
});
afterAll(async () => {
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  await closeDb();
});

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors (SHA-1, 6 digits)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });
});

describe("two-factor sign-in", () => {
  let cookie = "";
  let secret = "";
  let recovery: string[] = [];

  it("sets up with a QR code and only turns on after a correct code", async () => {
    cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Tara", email: "tara@example.com", password: PW } }));
    const s = await mfaCall(cookie, ["setup"]);
    expect(s.json.qr).toContain("<svg");
    expect(s.json.url).toMatch(/^otpauth:\/\/totp\/Cloudesk:tara%40example\.com\?secret=/);
    secret = s.json.secret;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "tara@example.com"));
    expect(u.totpSecret).not.toContain(secret); // stored encrypted
    expect((await mfaCall(cookie, ["enable"], { code: "000000" })).status).toBe(422);
    const on = await mfaCall(cookie, ["enable"], { code: codeFor(secret) });
    expect(on.status).toBe(200);
    recovery = on.json.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await mfaCall(cookie, [])).json).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
  });

  it("asks for a code after the password, and refuses replays", async () => {
    const step1 = await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } });
    expect(step1.json).toMatchObject({ mfaRequired: true });
    expect(step1.headers.get("set-cookie")).toBeNull();
    // The code used to enable is spent; the next step's code works.
    const code = codeFor(secret, 1);
    const ok = await call(loginMfa.POST, { method: "POST", body: { challenge: step1.json.challenge, code } });
    expect(ok.status).toBe(200);
    expect(cookieFrom(ok)).toMatch(/^cc_session=/);
    // The challenge is single-use, and the same code can't be used again.
    expect((await call(loginMfa.POST, { method: "POST", body: { challenge: step1.json.challenge, code } })).status).toBe(401);
    const again = await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } });
    expect((await call(loginMfa.POST, { method: "POST", body: { challenge: again.json.challenge, code } })).status).toBe(401);
  });

  it("accepts each recovery code once, and locks a challenge after 5 wrong codes", async () => {
    const a = await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } });
    const r = await call(loginMfa.POST, { method: "POST", body: { challenge: a.json.challenge, code: recovery[0].toUpperCase() } });
    expect(r.json.usedRecoveryCode).toBe(true);
    const b = await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } });
    expect((await call(loginMfa.POST, { method: "POST", body: { challenge: b.json.challenge, code: recovery[0] } })).status).toBe(401);
    for (let i = 0; i < 4; i++) await call(loginMfa.POST, { method: "POST", body: { challenge: b.json.challenge, code: "111111" } });
    const locked = await call(loginMfa.POST, { method: "POST", body: { challenge: b.json.challenge, code: recovery[1] } });
    expect(locked.status).toBe(401);
    expect(locked.json.error.message).toMatch(/expired|Start again/);
    expect((await mfaCall(cookie, [])).json.recoveryCodesLeft).toBe(9);
  });

  it("only turns off with the password", async () => {
    expect((await mfaCall(cookie, ["disable"], { password: "wrong-password-1" })).status).toBe(403);
    expect((await mfaCall(cookie, ["disable"], { password: PW })).status).toBe(200);
    expect((await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } })).json.user).toBeTruthy();
    expect(await db.select().from(schema.mfaRecoveryCodes)).toHaveLength(0);
  });
});

describe("organization rule", () => {
  it("locks projects for members without two-factor, and owners must have it first", async () => {
    const r = await call(signup.POST, { method: "POST", body: { name: "Omar", email: "omar@example.com", password: PW } });
    const cookie = cookieFrom(r);
    const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
    expect((await call(orgSecurity.PATCH, { method: "PATCH", cookie, params: { orgId }, body: { requireMfa: true } })).status).toBe(409);
    const s = await mfaCall(cookie, ["setup"]);
    await mfaCall(cookie, ["enable"], { code: codeFor(s.json.secret) });
    expect((await call(orgSecurity.PATCH, { method: "PATCH", cookie, params: { orgId }, body: { requireMfa: true } })).status).toBe(200);
    expect((await call(orgProjects.GET, { cookie, params: { orgId } })).status).toBe(200);
    // Turn the owner's two-factor off directly: now they're locked out of projects too.
    await db.update(schema.users).set({ totpEnabledAt: null }).where(eq(schema.users.email, "omar@example.com"));
    const blocked = await call(orgProjects.GET, { cookie, params: { orgId } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.details).toMatchObject({ mfaRequired: ["true"] });
  });
});

describe("GitHub sign-in", () => {
  const mockGithub = (profile: { id: number; login: string; name: string }, emails: { email: string; primary: boolean; verified: boolean }[]) =>
    setGithubHttp(async (url, init) => {
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ client_id: "gh-client", client_secret: "gh-secret", code: "the-code" });
        expect(body.code_verifier).toMatch(/^[\w-]{40,}$/);
        return Response.json({ access_token: "gho_test" });
      }
      if (url === "https://api.github.com/user") return Response.json(profile);
      if (url === "https://api.github.com/user/emails") return Response.json(emails);
      return new Response("not found", { status: 404 });
    });

  async function roundTrip(opts: { cookie?: string; mode?: string } = {}) {
    const start = await call(ghStart.GET, { cookie: opts.cookie, path: `/x?next=/projects${opts.mode ? `&mode=${opts.mode}` : ""}` });
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
    const cookies = [stateCookie, opts.cookie].filter(Boolean).join("; ");
    return call(ghCallback.GET, { cookie: cookies, path: `/x?code=the-code&state=${to.searchParams.get("state")}` });
  }

  it("reports itself as available, and creates a new verified account", async () => {
    expect((await call(providers.GET, {})).json).toEqual({ github: true });
    mockGithub({ id: 101, login: "nina", name: "Nina Patel" }, [{ email: "nina@example.com", primary: true, verified: true }]);
    const cb = await roundTrip();
    expect(cb.headers.get("location")).toBe(`${ORIGIN}/projects`);
    const cookie = cb.headers.getSetCookie().find((c) => c.startsWith("cc_session="))!.split(";")[0];
    const who = (await call(me.GET, { cookie })).json;
    expect(who.user).toMatchObject({ email: "nina@example.com", emailVerified: true });
    // No password yet: it can set one without a current password, and GitHub can't be disconnected before that.
    expect((await call(connections.DELETE, { method: "DELETE", cookie })).status).toBe(409);
    expect((await call(password.PATCH, { method: "PATCH", cookie, body: { newPassword: "brand-new-pass-9" } })).status).toBe(200);
    expect((await call(connections.DELETE, { method: "DELETE", cookie })).status).toBe(200);
  });

  it("never takes over an existing account by email, and needs a verified email", async () => {
    mockGithub({ id: 202, login: "tara-gh", name: "Tara" }, [{ email: "tara@example.com", primary: true, verified: true }]);
    const cb = await roundTrip();
    expect(decodeURIComponent(cb.headers.get("location")!)).toContain("already exists. Sign in with your password");
    expect(cb.headers.getSetCookie().some((c) => c.startsWith("cc_session="))).toBe(false);
    mockGithub({ id: 303, login: "ghost", name: "Ghost" }, [{ email: "ghost@example.com", primary: true, verified: false }]);
    expect(decodeURIComponent((await roundTrip()).headers.get("location")!)).toContain("no verified email");
  });

  it("connects from settings, then signs in through two-factor using a cookie, not the URL", async () => {
    const tara = cookieFrom(await call(login.POST, { method: "POST", body: { email: "tara@example.com", password: PW } }));
    mockGithub({ id: 202, login: "tara-gh", name: "Tara" }, [{ email: "tara@example.com", primary: true, verified: true }]);
    expect((await roundTrip({ cookie: tara, mode: "link" })).headers.get("location")).toBe(`${ORIGIN}/settings?github=connected`);
    expect((await call(connections.GET, { cookie: tara })).json.connections).toMatchObject([{ provider: "github", login: "tara-gh" }]);
    const s = await mfaCall(tara, ["setup"]);
    await mfaCall(tara, ["enable"], { code: codeFor(s.json.secret) });
    const cb = await roundTrip();
    expect(cb.headers.get("location")).toBe(`${ORIGIN}/login?mfa=1&next=%2Fprojects`);
    const mfaCookie = cb.headers.getSetCookie().find((c) => c.startsWith("cc_mfa="))!;
    expect(mfaCookie).toContain("HttpOnly");
    expect(cb.headers.getSetCookie().some((c) => c.startsWith("cc_session="))).toBe(false);
    const done = await call(loginMfa.POST, { method: "POST", cookie: mfaCookie.split(";")[0], body: { code: codeFor(s.json.secret, 1) } });
    expect(done.status).toBe(200);
    expect(done.json.user.email).toBe("tara@example.com");
  });

  it("rejects a callback whose state doesn't match this browser", async () => {
    mockGithub({ id: 101, login: "nina", name: "Nina Patel" }, [{ email: "nina@example.com", primary: true, verified: true }]);
    const start = await call(ghStart.GET, { path: "/x" });
    const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
    const cb = await call(ghCallback.GET, { cookie: stateCookie, path: "/x?code=the-code&state=forged-state" });
    expect(decodeURIComponent(cb.headers.get("location")!)).toContain("expired or came from another browser");
  });
});
