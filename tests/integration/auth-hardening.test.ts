// Security hardening of sign-in (2026-10-27 audit): redirects after sign-in stay
// on this site, per-account brakes on password and two-step guessing, sessions
// ending when two-step changes, reset links expiring together, the mail outbox
// hiding secrets, and platform admins not touching owners' accounts.
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as forgot from "@/app/api/v1/auth/forgot-password/route";
import * as ghCallback from "@/app/api/v1/auth/github/callback/route";
import * as ghStart from "@/app/api/v1/auth/github/start/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as mfa from "@/app/api/v1/auth/mfa/[[...slug]]/route";
import * as outbox from "@/app/api/v1/auth/outbox/route";
import * as password from "@/app/api/v1/auth/password/route";
import * as reset from "@/app/api/v1/auth/reset-password/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import { setGithubHttp } from "@/server/auth/github";
import { completeChallenge, createChallenge, stepOf, totpAt } from "@/server/auth/mfa";
import { secureAttr, sessionCookie } from "@/server/auth/session";
import { disableUser, signOutEverywhere } from "@/server/platform/users";
import { logIn } from "@/server/services/auth";
import { redactMailSecrets } from "@/server/services/mail";
import { call, cookieFrom, resetDb } from "../helpers";

const PW = "correct-horse-42";
const mfaCall = (cookie: string, slug: string[], body?: unknown) => call(slug.length ? mfa.POST : mfa.GET, { method: slug.length ? "POST" : "GET", cookie, body, params: { slug } });
const make = async (name: string, email: string) => cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: PW } }));
const userId = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0].id;
const meta = { ip: "203.0.113.9", userAgent: "vitest" };

beforeAll(async () => {
  await resetDb();
  process.env.GITHUB_CLIENT_ID = "gh-client";
  process.env.GITHUB_CLIENT_SECRET = "gh-secret";
});
afterEach(() => setGithubHttp(null));
afterAll(async () => {
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  await closeDb();
});

describe("redirects after GitHub sign-in", () => {
  it("never leave the site, even for /\\evil.com or /<tab>/evil.com", async () => {
    await make("Gita", "gita@example.com");
    setGithubHttp(async (url) => {
      if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_test" });
      if (url === "https://api.github.com/user") return Response.json({ id: 4242, login: "newbie", name: "New Bie" });
      if (url === "https://api.github.com/user/emails") return Response.json([{ email: "newbie@example.com", primary: true, verified: true }]);
      return new Response("", { status: 404 });
    });
    for (const evil of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com"]) {
      const start = await call(ghStart.GET, { path: `/x?next=${encodeURIComponent(evil)}` });
      const to = new URL(start.headers.get("location")!);
      const stateCookie = start.headers.getSetCookie()[0].split(";")[0];
      const cb = await call(ghCallback.GET, { cookie: stateCookie, path: `/x?code=c&state=${to.searchParams.get("state")}` });
      expect(cb.status).toBe(302);
      const where = new URL(cb.headers.get("location")!);
      expect(where.origin).toBe(new URL(process.env.APP_URL ?? "http://localhost:3000").origin);
      expect(where.pathname).toBe("/home");
    }
  });
});

describe("password guessing per account", () => {
  it("pauses password sign-in after many failures, whatever the address, without revealing the account", async () => {
    await make("Lena", "lena@example.com");
    for (let i = 0; i < 20; i++) await expect(logIn({ email: "lena@example.com", password: `wrong-${i}-pass` }, { ...meta, ip: `198.51.100.${i}` })).rejects.toMatchObject({ code: "unauthenticated" });
    // Even the right password waits now…
    await expect(logIn({ email: "lena@example.com", password: PW }, meta)).rejects.toMatchObject({ code: "rate_limited" });
    // …and an address with no account behaves the same, so it can't be used to find accounts.
    for (let i = 0; i < 20; i++) await logIn({ email: "ghost@example.com", password: `wrong-${i}-pass` }, meta).catch(() => {});
    await expect(logIn({ email: "ghost@example.com", password: PW }, meta)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("two-step sign-in", () => {
  let cookie = "";
  let secret = "";
  it("ends other sessions when two-step is turned on or off", async () => {
    cookie = await make("Mira", "mira@example.com");
    const other = cookieFrom(await call(login.POST, { method: "POST", body: { email: "mira@example.com", password: PW } }));
    expect((await call(me.GET, { cookie: other })).status).toBe(200);
    secret = (await mfaCall(cookie, ["setup"])).json.secret;
    expect((await mfaCall(cookie, ["enable"], { code: totpAt(secret, stepOf(Date.now())) })).status).toBe(200);
    expect((await call(me.GET, { cookie: other })).status).toBe(401);
    expect((await call(me.GET, { cookie })).status).toBe(200);
  });

  it("counts guesses on a challenge atomically, so parallel guesses can't get past five", async () => {
    const uid = await userId("mira@example.com");
    const token = await createChallenge(uid, "password");
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => completeChallenge(token, String(100000 + i), meta)));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const [c] = await db.select().from(schema.mfaChallenges).where(eq(schema.mfaChallenges.userId, uid));
    expect(c.attempts).toBe(5);
  });

  it("limits codes per account across many challenges", async () => {
    const uid = await userId("mira@example.com");
    let limited = false;
    for (let i = 0; i < 4 && !limited; i++) {
      const token = await createChallenge(uid, "password");
      for (let j = 0; j < 5; j++) {
        const e = await completeChallenge(token, "000001", meta).catch((x) => x);
        if (e?.code === "rate_limited") limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("password reset links", () => {
  it("all stop working once the password has been reset with one of them", async () => {
    await make("Rosa", "rosa@example.com");
    await call(forgot.POST, { method: "POST", body: { email: "rosa@example.com" } });
    await call(forgot.POST, { method: "POST", body: { email: "rosa@example.com" } });
    const mails = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "rosa@example.com"), eq(schema.outboundEmails.subject, "Reset your password")));
    const tokens = mails.map((m) => /token=([\w-]+)/.exec(m.body)![1]);
    expect(tokens).toHaveLength(2);
    expect((await call(reset.POST, { method: "POST", body: { token: tokens[0], password: "brand-new-pass-1" } })).status).toBe(200);
    expect((await call(reset.POST, { method: "POST", body: { token: tokens[1], password: "attacker-pass-2" } })).status).toBe(400);
  });

  it("and changing the password expires links still in the mailbox", async () => {
    const cookie = await make("Uma", "uma@example.com");
    await call(forgot.POST, { method: "POST", body: { email: "uma@example.com" } });
    const [m] = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "uma@example.com"), eq(schema.outboundEmails.subject, "Reset your password")));
    const token = /token=([\w-]+)/.exec(m.body)![1];
    expect((await call(password.PATCH, { method: "PATCH", cookie, body: { currentPassword: PW, newPassword: "another-pass-77" } })).status).toBe(200);
    expect((await call(reset.POST, { method: "POST", body: { token, password: "attacker-pass-2" } })).status).toBe(400);
  });
});

describe("the mail outbox page", () => {
  it("hides reset links and sign-in codes outside a development outbox", async () => {
    expect(redactMailSecrets("open https://x.test/reset-password?token=abc_DEF-123 now")).toBe("open https://x.test/reset-password?token=[hidden] now");
    expect(redactMailSecrets("123456 is your Cloudesk code")).toBe("•••••• is your Cloudesk code");
    expect(redactMailSecrets("Order 123456 shipped")).toBe("Order 123456 shipped");
    const cookie = await make("Odin", "odin@example.com");
    await call(forgot.POST, { method: "POST", body: { email: "odin@example.com" } });
    // Development outbox: shown in full (that's how people get their links locally).
    expect(JSON.stringify((await call(outbox.GET, { cookie })).json)).toMatch(/token=[\w-]{20,}/);
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const body = JSON.stringify((await call(outbox.GET, { cookie })).json);
      expect(body).toContain("token=[hidden]");
      expect(body).not.toMatch(/token=[\w-]{20,}/);
    } finally {
      env.NODE_ENV = was;
    }
  });
});

describe("sign-in cookies", () => {
  it("are Secure in production even without APP_URL, unless APP_URL is plain http", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { NODE_ENV: env.NODE_ENV, APP_URL: env.APP_URL };
    try {
      env.NODE_ENV = "production";
      delete env.APP_URL;
      expect(secureAttr()).toBe("; Secure");
      expect(sessionCookie("t", new Date())).toContain("; Secure");
      env.APP_URL = "http://intranet.local";
      expect(secureAttr()).toBe("");
      env.NODE_ENV = "development";
      env.APP_URL = "https://app.example.com";
      expect(secureAttr()).toBe("; Secure");
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      if (saved.APP_URL === undefined) delete env.APP_URL;
      else env.APP_URL = saved.APP_URL;
    }
  });
});

describe("platform admins and owners", () => {
  it("an admin (not an owner) can't disable or sign out a platform owner", async () => {
    await make("Paula Owner", "paula@platform.example");
    await make("Adam Admin", "adam@platform.example");
    await make("Ola Owner2", "ola@platform.example");
    await make("Ursula User", "ursula@example.com");
    await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "owner" }).where(eq(schema.users.email, "paula@platform.example"));
    await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "owner" }).where(eq(schema.users.email, "ola@platform.example"));
    await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "admin" }).where(eq(schema.users.email, "adam@platform.example"));
    const [paula, adam, ola, ursula] = await Promise.all(["paula@platform.example", "adam@platform.example", "ola@platform.example", "ursula@example.com"].map(userId));
    await expect(disableUser(adam, paula, { reason: "takeover" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(signOutEverywhere(adam, paula)).rejects.toMatchObject({ code: "forbidden" });
    // Ordinary accounts are still theirs to manage; owners can manage other admins.
    await disableUser(adam, ursula, { reason: "spam" });
    await signOutEverywhere(ola, adam);
    await disableUser(ola, paula, { reason: "left the company" });
  });
});
