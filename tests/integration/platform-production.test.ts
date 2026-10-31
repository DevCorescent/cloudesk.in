import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import { checkProductionEnv } from "@/server/platform/boot";
import { cfg, configSource } from "@/server/platform/config";
import { areaOf, flushMetrics, percentile, recordRequest } from "@/server/platform/metrics";
import { snapshot } from "@/server/platform/scalability";
import { mailProvider } from "@/server/services/mail";
import { rateLimit } from "@/server/security/rate-limit";
import { call, cookieFrom, resetDb } from "../helpers";

// Running the platform for production: integration settings saved from the
// console (encrypted, never returned, environment wins), shared rate limits,
// password re-entry for sensitive admin actions, request metrics and
// scalability insights, and the production start-up check.
const PW = "correct-horse-42";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown, who = "owner") => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["owner", "Oda Owner", "oda@ops.example"], ["member", "Mia Member", "mia@shop.example"]]) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: PW } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, U.owner));
});
afterAll(closeDb);

describe("integration settings from the console", () => {
  it("saves encrypted, never returns secrets, and takes effect", async () => {
    expect(mailProvider()).toBe("outbox");
    const r = await A("PUT", "config", { MAIL_FROM: "hello@ops.example", MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_live_secret_value_123" });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("re_live_secret_value_123");
    const email = r.json.config.email as { key: string; source: string; value: string }[];
    expect(email.find((f) => f.key === "RESEND_API_KEY")).toMatchObject({ source: "console", value: "" });
    expect(email.find((f) => f.key === "MAIL_FROM")).toMatchObject({ source: "console", value: "hello@ops.example" });
    const [row] = await db.select().from(schema.platformConfig).where(eq(schema.platformConfig.key, "RESEND_API_KEY"));
    expect(row!.valueEnc).not.toContain("re_live");
    expect(cfg("RESEND_API_KEY")).toBe("re_live_secret_value_123");
    expect(mailProvider()).toBe("resend");
    // The audit records which keys changed, never values.
    const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "platform.config_saved"));
    expect(JSON.stringify(log!.metadata)).not.toContain("re_live");
    // Cleared again.
    await A("PUT", "config", { MAIL_FROM: null, MAIL_PROVIDER: null, RESEND_API_KEY: null });
    expect(mailProvider()).toBe("outbox");
  });

  it("refuses unknown keys, malformed values and keys set in the environment", async () => {
    expect((await A("PUT", "config", { DATABASE_URL: "postgres://x" })).status).toBe(422);
    expect((await A("PUT", "config", { STRIPE_SECRET_KEY: "not-a-key" })).json.error.message).toMatch(/doesn't look right/);
    process.env.VOYAGE_MODEL = "from-env";
    expect((await A("PUT", "config", { VOYAGE_MODEL: "x" })).status).toBe(409);
    expect(configSource("VOYAGE_MODEL")).toBe("env");
    delete process.env.VOYAGE_MODEL;
  });
});

describe("password re-entry for sensitive actions", () => {
  it("asks again after 15 minutes, and accepts only the right password", async () => {
    await db.update(schema.sessions).set({ createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.sessions.userId, U.owner));
    const stale = await A("PUT", "config", { VOYAGE_MODEL: "voyage-3.5-lite" });
    expect(stale.status).toBe(403);
    expect(stale.json.error.details).toEqual({ reauth: true });
    // Reading isn't sensitive.
    expect((await A("GET", "config")).status).toBe(200);
    expect((await A("POST", "reauth", { password: "wrong-password" })).status).toBe(403);
    expect((await A("POST", "reauth", { password: PW })).status).toBe(200);
    expect((await A("PUT", "config", { VOYAGE_MODEL: "voyage-3.5-lite" })).status).toBe(200);
    expect((await A("PUT", `users/${U.member}/role`, { role: "analyst" })).status).toBe(200);
    expect((await A("PUT", `users/${U.member}/role`, { role: null })).status).toBe(200);
  });
});

describe("shared rate limits", () => {
  it("counts in Postgres when configured, so the limit holds across servers", async () => {
    process.env.RATE_LIMIT_STORE = "postgres";
    try {
      const key = `test:${Date.now()}`;
      await rateLimit(key, 2, 60_000);
      await rateLimit(key, 2, 60_000);
      await expect(rateLimit(key, 2, 60_000)).rejects.toThrow(/Too many requests/);
      const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key));
      expect(row!.count).toBe(3);
      // A fresh window starts over.
      await db.update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) }).where(eq(schema.rateLimits.key, key));
      await rateLimit(key, 2, 60_000);
    } finally {
      delete process.env.RATE_LIMIT_STORE;
    }
  });
});

describe("request metrics and scalability", () => {
  it("groups requests by area and works out percentiles", () => {
    expect(areaOf("/api/v1/orgs/3a5c2f90-47f8-4d23-ac97-c5b65209f95d/crm/contacts")).toBe("crm");
    expect(areaOf("/api/v1/auth/login")).toBe("auth");
    expect(areaOf("/sites/abc")).toBe("sites");
    expect(percentile([90, 5, 5, 0, 0, 0, 0, 0, 0], 0.5)).toBe(25);
    expect(percentile([90, 5, 5, 0, 0, 0, 0, 0, 0], 0.99)).toBe(100);
    expect(percentile(new Array(9).fill(0), 0.5)).toBeNull();
  });

  it("records real requests, merges flushes, and reports traffic, servers and recommendations", async () => {
    await flushMetrics();
    await db.delete(schema.requestStats);
    for (let i = 0; i < 40; i++) recordRequest("/api/v1/orgs/3a5c2f90-47f8-4d23-ac97-c5b65209f95d/crm/contacts", 200, 30);
    recordRequest("/api/v1/auth/login", 500, 1200);
    await flushMetrics();
    // Real handler calls are counted too.
    await call(login.POST, { method: "POST", body: { email: "nobody@x.example", password: "wrong-pass-123" }, path: "/api/v1/auth/login" });
    await flushMetrics();
    await snapshot();
    const s = (await A("GET", "scalability")).json;
    expect(s.traffic.last24h).toBeGreaterThanOrEqual(42);
    const crm = s.areas.find((a: { area: string }) => a.area === "crm");
    expect(crm).toMatchObject({ requests: 40, errorRate: 0, p95: 50 });
    const auth = s.areas.find((a: { area: string }) => a.area === "auth");
    expect(auth.requests).toBeGreaterThanOrEqual(2);
    expect(auth.errorRate).toBeGreaterThan(0);
    expect(s.nodes).toHaveLength(1);
    expect(s.database.history).toHaveLength(1);
    expect(s.database.projection).toBeNull();
    expect(s.recommendations.some((r: { level: string }) => r.level === "critical")).toBe(true);
    // The role changes above ended the member's sessions; sign in again — the console still doesn't exist for them.
    C.member = cookieFrom(await call(login.POST, { method: "POST", body: { email: "mia@shop.example", password: PW } }));
    expect((await A("GET", "scalability", undefined, "member")).status).toBe(404);
  });
});

describe("production start-up check", () => {
  it("stops without essentials and warns about weak settings", () => {
    expect(() => checkProductionEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL.*APP_ENCRYPTION_KEY.*APP_URL/);
    // The key must be exactly what the cipher needs: 32 bytes, base64 — not just 32 characters.
    expect(() => checkProductionEnv({ DATABASE_URL: "postgres://x", APP_ENCRYPTION_KEY: "short", APP_URL: "https://a.example" })).toThrow(/32 bytes/);
    expect(() => checkProductionEnv({ DATABASE_URL: "postgres://x", APP_ENCRYPTION_KEY: "k".repeat(32), APP_URL: "https://a.example" })).toThrow(/32 bytes/);
    const key = Buffer.alloc(32, 7).toString("base64");
    const ok = checkProductionEnv({ DATABASE_URL: "postgres://x", APP_ENCRYPTION_KEY: key, APP_URL: "http://app.example.com" });
    expect(ok.warn[0]).toMatch(/https/);
    // Weak-but-allowed settings each get a warning: no TLS to the database, no proxy trust, no mail provider, a worker.
    const bare = checkProductionEnv({ DATABASE_URL: "postgres://x", APP_ENCRYPTION_KEY: key, APP_URL: "http://localhost:3100" }).warn;
    expect(bare.join("\n")).toMatch(/DATABASE_SSL_CA/);
    expect(bare.join("\n")).toMatch(/TRUST_PROXY/);
    expect(bare.join("\n")).toMatch(/email provider/);
    expect(bare.join("\n")).toMatch(/one worker replica/);
    // A fully configured web server warns about nothing.
    expect(checkProductionEnv({ DATABASE_URL: "postgres://x", APP_ENCRYPTION_KEY: key, APP_URL: "http://localhost:3100", DATABASE_SSL_CA: "/app/certs/rds-global-bundle.pem", TRUST_PROXY: "xff-last", MAIL_FROM: "a@b.example", RESEND_API_KEY: "re_x", APP_ROLE: "web" }).warn).toEqual([]);
  });
});
