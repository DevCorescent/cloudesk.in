import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import { saveSection, settings } from "@/server/platform/settings";
import { checkRequest, flush, resetFirewall } from "@/server/security/firewall";
import { setCloudflareHttp } from "@/server/security/cloudflare";
import { call, cookieFrom, resetDb, waitFor } from "../helpers";

let cookie = "";
let adminId = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown) => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie, body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const req = (url: string, o: { ip?: string; ua?: string; method?: string; headers?: Record<string, string> } = {}) => {
  const u = new URL(url, "http://localhost:3000");
  return { method: o.method ?? "GET", headers: new Headers({ host: "localhost:3000", "user-agent": o.ua ?? "Mozilla/5.0", "x-forwarded-for": o.ip ?? "198.51.100.10", ...o.headers }), nextUrl: { pathname: u.pathname, search: u.search } };
};
const policy = async (v: Partial<Awaited<ReturnType<typeof settings>>["firewall"]>) => {
  await saveSection(adminId, "firewall", { ...(await settings()).firewall, ...v });
  resetFirewall();
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sec Admin", email: "sec@cloudesk.example", password: "correct-horse-42" } }));
  adminId = (await call(me.GET, { cookie })).json.user.id;
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, adminId));
});
beforeEach(() => resetFirewall());
afterAll(async () => {
  setCloudflareHttp(null);
  for (const k of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_ORIGIN_SECRET", "CLOUDFLARE_SYNC_BANS"]) delete process.env[k];
  await closeDb();
});

describe("the firewall in front of every request", () => {
  it("refuses attacks with a reference, logs them, and lets normal traffic through", async () => {
    await policy({ mode: "block", autoBanAfter: 0, ratePerMinute: 0 });
    expect(await checkRequest(req("/features/website-builder"))).toBeNull();
    const r = (await checkRequest(req("/api/v1/products?id=1 UNION SELECT password FROM users")))!;
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.details.reference[0]).toMatch(/^[0-9a-f]{10}$/);
    const page = (await checkRequest(req("/.env")))!;
    expect(page.headers.get("content-type")).toContain("text/html");
    await flush();
    const ev = await db.select().from(schema.firewallEvents);
    expect(ev.map((e) => e.rule).sort()).toEqual(["probe-secrets", "sqli-union"]);
    expect(ev[0]).toMatchObject({ ip: "198.51.100.10", action: "block" });
  });

  it("bans an address after repeated attacks, then refuses everything from it", async () => {
    await policy({ mode: "block", autoBanAfter: 3, autoBanMinutes: 30, ratePerMinute: 0 });
    for (let i = 0; i < 3; i++) expect((await checkRequest(req(`/wp-login.php?i=${i}`, { ip: "203.0.113.66" })))!.status).toBe(403);
    expect((await checkRequest(req("/", { ip: "203.0.113.66" })))!.status).toBe(403);
    expect(await checkRequest(req("/", { ip: "203.0.113.67" }))).toBeNull();
    // The ban is written in the background.
    const [ban] = await waitFor(() => db.select().from(schema.firewallBans).where(eq(schema.firewallBans.ip, "203.0.113.66")), (r) => r.length > 0);
    expect(ban).toMatchObject({ source: "auto" });
  });

  it("limits requests per address per minute", async () => {
    await policy({ mode: "block", ratePerMinute: 5, autoBanAfter: 0 });
    for (let i = 0; i < 5; i++) expect(await checkRequest(req("/", { ip: "192.0.2.5" }))).toBeNull();
    const r = (await checkRequest(req("/", { ip: "192.0.2.5" })))!;
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await checkRequest(req("/", { ip: "192.0.2.6" }))).toBeNull();
  });

  it("monitor mode only records; allow-listed addresses skip everything", async () => {
    await policy({ mode: "monitor", ratePerMinute: 0 });
    expect(await checkRequest(req("/.git/config"))).toBeNull();
    await policy({ mode: "block", allowIps: ["198.51.100.0/24"] });
    expect(await checkRequest(req("/.git/config"))).toBeNull();
    await policy({ allowIps: [] });
  });

  it("with the origin locked, refuses requests that didn't come through Cloudflare", async () => {
    process.env.CLOUDFLARE_ORIGIN_SECRET = "a".repeat(64);
    await policy({ mode: "block", requireCloudflare: true, ratePerMinute: 0 });
    expect((await checkRequest(req("/")))!.status).toBe(403);
    expect(await checkRequest(req("/", { headers: { "x-cloudesk-origin": "a".repeat(64) } }))).toBeNull();
    await policy({ requireCloudflare: false });
    delete process.env.CLOUDFLARE_ORIGIN_SECRET;
  });
});

describe("the console", () => {
  it("shows the overview, bans and unbans by hand, and saves the policy", async () => {
    await flush();
    const o = await A("GET", "security/firewall");
    expect(o.status).toBe(200);
    expect(o.json.day.blocked).toBeGreaterThan(0);
    expect(o.json.byRule.length).toBeGreaterThan(0);
    const b = await A("POST", "security/bans", { ip: "198.51.100.200", minutes: 60, reason: "Credential stuffing" });
    expect(b.status).toBe(200);
    expect((await checkRequest(req("/", { ip: "198.51.100.200" })))!.status).toBe(403);
    expect((await A("DELETE", "security/bans?ip=198.51.100.200")).status).toBe(200);
    resetFirewall();
    expect(await checkRequest(req("/", { ip: "198.51.100.200" }))).toBeNull();
    expect((await A("POST", "security/bans", { ip: "not-an-ip", minutes: 5, reason: "x" })).status).toBe(422);
    const saved = await A("PUT", "security/firewall", { ...(await settings()).firewall, ratePerMinute: 900, blockCountries: ["xx"] });
    expect(saved.json.policy).toMatchObject({ ratePerMinute: 900, blockCountries: ["XX"] });
    const ev = await A("GET", "security/events?action=block&limit=5");
    expect(ev.json.events.length).toBeGreaterThan(0);
    const posture = await A("GET", "security/posture");
    expect(posture.json.score).toBeGreaterThan(0);
    expect(posture.json.checks.find((c: { id: string }) => c.id === "firewall-mode")).toMatchObject({ ok: true });
  });
});

describe("Cloudflare", () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  beforeAll(() => {
    process.env.CLOUDFLARE_API_TOKEN = "t".repeat(40);
    process.env.CLOUDFLARE_ZONE_ID = "f".repeat(32);
    setCloudflareHttp(async (input, init) => {
      const url = String(input).replace("https://api.cloudflare.com/client/v4", "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
      if (url === "/user/tokens/verify") return ok({ status: "active" });
      if (url.endsWith(`/zones/${"f".repeat(32)}`)) return ok({ id: "f".repeat(32), name: "cloudesk.example", status: "active", paused: false, plan: { name: "Pro Website" }, name_servers: ["ada.ns.cloudflare.com"] });
      if (url.endsWith("/settings") && method === "GET") return ok([{ id: "security_level", value: "medium", editable: true }, { id: "ssl", value: "strict", editable: true }, { id: "unrelated", value: "x", editable: true }]);
      if (url.includes("/settings/") && method === "PATCH") return ok({ id: url.split("/").pop(), value: body.value });
      if (url.includes("/phases/http_request_late_transform/entrypoint") && method === "GET") return Response.json({ success: false, errors: [{ code: 10003, message: "could not find entrypoint ruleset" }], result: null }, { status: 404 });
      if (url.includes("/phases/http_request_late_transform/entrypoint") && method === "PUT") return ok({ id: "r1", rules: body.rules });
      if (url.includes("/firewall/access_rules/rules") && method === "POST") return ok({ id: "a".repeat(32) });
      if (url.includes("/purge_cache")) return ok({ id: "p" });
      return Response.json({ success: false, errors: [{ code: 1, message: `unexpected ${method} ${url}` }], result: null }, { status: 400 });
    });
  });

  it("reports the zone and only the settings it manages", async () => {
    const s = await A("GET", "security/cloudflare");
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ configured: true, token: { status: "active" }, zone: { name: "cloudesk.example", plan: "Pro Website" } });
    expect(Object.keys(s.json.settings).sort()).toEqual(["security_level", "ssl"]);
  });

  it("changes a setting (only to values Cloudflare accepts) and purges the cache", async () => {
    expect((await A("PUT", "security/cloudflare-setting", { id: "security_level", value: "under_attack" })).json).toEqual({ id: "security_level", value: "under_attack" });
    expect((await A("PUT", "security/cloudflare-setting", { id: "security_level", value: "maximum" })).status).toBe(422);
    expect((await A("PUT", "security/cloudflare-setting", { id: "dns_records", value: "on" })).status).toBe(422);
    expect((await A("POST", "security/cloudflare-purge", { files: null })).status).toBe(200);
    expect(calls.find((c) => c.url.includes("purge_cache"))?.body).toEqual({ purge_everything: true });
  });

  it("locks the origin: saves a secret, then has Cloudflare add it to every request", async () => {
    const r = await A("POST", "security/cloudflare-lock");
    expect(r.status).toBe(200);
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("late_transform"))!;
    const rule = (put.body as { rules: { description: string; action_parameters: { headers: Record<string, { value: string }> } }[] }).rules[0]!;
    expect(rule.description).toBe("Cloudesk origin lock");
    const secret = rule.action_parameters.headers["x-cloudesk-origin"]!.value;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    const [stored] = await db.select().from(schema.platformConfig).where(eq(schema.platformConfig.key, "CLOUDFLARE_ORIGIN_SECRET"));
    expect(stored!.valueEnc).not.toContain(secret);
  });

  it("copies bans to Cloudflare when switched on", async () => {
    process.env.CLOUDFLARE_SYNC_BANS = "on";
    await A("POST", "security/bans", { ip: "203.0.113.99", minutes: null, reason: "Scanner" });
    const push = calls.find((c) => c.method === "POST" && c.url.includes("access_rules"));
    expect(push?.body).toMatchObject({ mode: "block", configuration: { target: "ip", value: "203.0.113.99" } });
    const [ban] = await db.select().from(schema.firewallBans).where(eq(schema.firewallBans.ip, "203.0.113.99"));
    expect(ban!.cloudflareRuleId).toBe("a".repeat(32));
  });
});
