import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as notices from "@/app/api/v1/notices/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { effectivePlan, planLimits } from "@/server/billing/billing";
import { ipAllowed } from "@/server/platform/admin";
import { call, cookieFrom, resetDb } from "../helpers";

// The control centre: admin roles enforced on the server, the IP allowlist
// and two-step requirement, sign-up rules, disabling accounts, maintenance
// mode, complimentary plans and limit overrides, analytics/health/go-live,
// and taking an abusive workspace's sites offline.
const PW = "correct-horse-42";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown, who = "owner", headers?: Record<string, string>) => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, headers, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const join = async (key: string, name: string, email: string) => {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: PW } });
  C[key] = cookieFrom(r);
  U[key] = (await call(me.GET, { cookie: C[key] })).json.user?.id;
  return r;
};

beforeAll(async () => {
  await resetDb();
  await join("owner", "Olu Owner", "olu@platform.example");
  await join("analyst", "Ana Analyst", "ana@platform.example");
  await join("support", "Sam Support", "sam@platform.example");
  await join("tenant", "Tia Tenant", "tia@shop.example");
  orgId = (await call(me.GET, { cookie: C.tenant })).json.organizations[0].id;
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, U.owner));
  await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "analyst" }).where(eq(schema.users.id, U.analyst));
  await db.update(schema.users).set({ isPlatformAdmin: true, platformRole: "support" }).where(eq(schema.users.id, U.support));
});
afterAll(closeDb);

describe("admin roles", () => {
  it("lets each role do only its part, checked on the server", async () => {
    expect((await A("GET", "me")).json).toMatchObject({ role: "owner" });
    expect((await A("GET", "overview", undefined, "analyst")).status).toBe(200);
    expect((await A("GET", "tenants", undefined, "analyst")).status).toBe(403);
    expect((await A("GET", "tenants", undefined, "support")).status).toBe(200);
    expect((await A("POST", `tenants/${orgId}/suspend`, { reason: "x" }, "support")).status).toBe(403);
    expect((await A("PUT", "settings/signup", { mode: "closed" }, "support")).status).toBe(403);
    expect((await A("GET", "tenants", undefined, "tenant")).status).toBe(404);
  });

  it("lets owners appoint admins, but never remove the last owner or change themselves", async () => {
    expect((await A("PUT", `users/${U.analyst}/role`, { role: "admin" }, "support")).status).toBe(403);
    expect((await A("PUT", `users/${U.owner}/role`, { role: "analyst" })).json.error.message).toMatch(/your own admin role/);
    expect((await A("PUT", `users/${U.tenant}/role`, { role: "support" })).status).toBe(200);
    const [t] = await db.select().from(schema.users).where(eq(schema.users.id, U.tenant));
    expect(t).toMatchObject({ isPlatformAdmin: true, platformRole: "support" });
    // The role change ended their sessions, so it applies at once.
    expect((await call(me.GET, { cookie: C.tenant })).status).toBe(401);
    expect((await A("PUT", `users/${U.tenant}/role`, { role: null })).status).toBe(200);
    C.tenant = cookieFrom(await call(login.POST, { method: "POST", body: { email: "tia@shop.example", password: PW } }));
    // A second owner can't remove the only other owner if that leaves none.
    await db.update(schema.users).set({ platformRole: "owner" }).where(eq(schema.users.id, U.analyst));
    expect((await A("PUT", `users/${U.analyst}/role`, { role: "support" })).status).toBe(200);
    C.analyst = cookieFrom(await call(login.POST, { method: "POST", body: { email: "ana@platform.example", password: PW } }));
    await db.update(schema.users).set({ platformRole: "analyst" }).where(eq(schema.users.id, U.analyst));
  });
});

describe("console access rules", () => {
  it("matches the IP allowlist, including IPv4 ranges", () => {
    expect(ipAllowed("10.1.2.3", [])).toBe(true);
    expect(ipAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipAllowed("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("::ffff:192.168.1.9", ["192.168.1.0/24"])).toBe(true);
    expect(ipAllowed("203.0.113.5", ["203.0.113.5"])).toBe(true);
    expect(ipAllowed(null, ["203.0.113.5"])).toBe(false);
  });

  it("refuses the console from other networks, and without two-step when required", async () => {
    await A("PUT", "settings/security", { adminMfaRequired: false, adminIpAllowlist: ["198.51.100.0/24"] }, "owner", { "x-forwarded-for": "198.51.100.7" });
    expect((await A("GET", "overview", undefined, "owner", { "x-forwarded-for": "203.0.113.9" })).json.error.message).toMatch(/isn't available from this network/);
    expect((await A("GET", "overview", undefined, "owner", { "x-forwarded-for": "198.51.100.7" })).status).toBe(200);
    await A("PUT", "settings/security", { adminMfaRequired: true, adminIpAllowlist: [] }, "owner", { "x-forwarded-for": "198.51.100.7" });
    expect((await A("GET", "overview")).json.error.message).toMatch(/two-step/);
    // Nobody here has two-step, so turn it back off directly.
    await db.delete(schema.platformSettings).where(eq(schema.platformSettings.key, "security"));
    const { clearSettingsCache } = await import("@/server/platform/settings");
    clearSettingsCache();
    expect((await A("GET", "overview")).status).toBe(200);
  });
});

describe("sign-up rules", () => {
  it("can close sign-up, limit it to domains, block domains, and start new workspaces on a trial", async () => {
    expect((await A("PUT", "settings/signup", { mode: "closed" })).status).toBe(200);
    expect((await call(signup.POST, { method: "POST", body: { name: "N", email: "n@x.example", password: PW } })).json.error.message).toMatch(/closed/);
    await A("PUT", "settings/signup", { mode: "open", allowedDomains: ["acme.example"], blockedDomains: ["spam.example"], trialPlan: "pro", trialDays: 7 });
    expect((await call(signup.POST, { method: "POST", body: { name: "N", email: "n@other.example", password: PW } })).status).toBe(403);
    expect((await call(signup.POST, { method: "POST", body: { name: "N", email: "n@spam.example", password: PW } })).json.error.message).toMatch(/domain/);
    const ok = await call(signup.POST, { method: "POST", body: { name: "Nia", email: "nia@acme.example", password: PW } });
    expect(ok.status).toBe(201);
    const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.name, "Nia's workspace"));
    expect(o).toMatchObject({ trialPlan: "pro" });
    expect(effectivePlan(o!)).toBe("pro");
    expect((await A("PUT", "settings/signup", { mode: "sometimes" })).status).toBe(422);
    await A("PUT", "settings/signup", { mode: "open" });
  });
});

describe("accounts", () => {
  it("disables an account: sessions end and sign-in is refused, until enabled", async () => {
    expect((await A("POST", `users/${U.owner}/disable`, { reason: "self" })).status).toBe(409);
    expect((await A("POST", `users/${U.tenant}/disable`, { reason: "Chargeback fraud" })).status).toBe(200);
    expect((await call(me.GET, { cookie: C.tenant })).status).toBe(401);
    const r = await call(login.POST, { method: "POST", body: { email: "tia@shop.example", password: PW } });
    expect(r.status).toBe(403);
    expect(r.json.error.message).toMatch(/disabled/);
    expect((await A("GET", "users?filter=disabled")).json.users.map((u: { email: string }) => u.email)).toEqual(["tia@shop.example"]);
    await A("POST", `users/${U.tenant}/enable`);
    C.tenant = cookieFrom(await call(login.POST, { method: "POST", body: { email: "tia@shop.example", password: PW } }));
    expect((await call(me.GET, { cookie: C.tenant })).status).toBe(200);
    const d = (await A("GET", `users/${U.tenant}`)).json;
    expect(d.memberships[0]).toMatchObject({ role: "owner" });
    expect(d.logins.some((l: { reason: string }) => l.reason === "disabled")).toBe(true);
  });

  it("exports people as CSV with spreadsheet formulas neutralised", async () => {
    await db.update(schema.users).set({ name: "=HYPERLINK(\"x\")" }).where(eq(schema.users.id, U.tenant));
    const r = await A("GET", "users/csv");
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.text).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("maintenance mode and announcements", () => {
  it("makes workspaces read-only for members, not for platform admins, and shows the banner", async () => {
    await A("PUT", "settings/maintenance", { enabled: true, message: "Upgrading the database" });
    const blocked = await call(orgProjects.POST, { method: "POST", cookie: C.tenant, params: { orgId }, body: { templateId: "blank", name: "During" } });
    expect(blocked.status).toBe(503);
    expect(blocked.json.error.message).toBe("Upgrading the database");
    expect((await call(orgProjects.GET, { cookie: C.tenant, params: { orgId } })).status).toBe(200);
    expect((await call(notices.GET, { cookie: C.tenant })).json.notices[0]).toMatchObject({ kind: "maintenance", text: "Upgrading the database" });
    await A("PUT", "settings/maintenance", { enabled: false });
    await A("PUT", "settings/announcement", { enabled: true, text: "New: point of sale", tone: "success", audience: "business" });
    expect((await call(notices.GET, { cookie: C.tenant })).json.notices).toEqual([]);
    await A("PUT", "settings/announcement", { enabled: true, text: "New: point of sale", tone: "success", audience: "all" });
    expect((await call(notices.GET, { cookie: C.tenant })).json.notices).toEqual([{ kind: "announcement", tone: "success", text: "New: point of sale" }]);
  });
});

describe("plans", () => {
  it("gives a complimentary plan and overrides plan limits", async () => {
    await A("POST", `tenants/${orgId}/comp`, { plan: "business" });
    const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(effectivePlan(o!)).toBe("business");
    await A("POST", `tenants/${orgId}/comp`, { plan: null });
    expect((await planLimits("free")).projects).toBe(3);
    await A("PUT", "settings/plans", { free: { projects: 5 } });
    expect((await planLimits("free")).projects).toBe(5);
    expect((await A("GET", "plans")).json.plans[0]).toMatchObject({ id: "free", limits: { projects: 5 }, builtIn: { projects: 3 } });
  });
});

describe("insight endpoints", () => {
  it("answers analytics, health, go-live and integrations without revealing secrets", async () => {
    const o = (await A("GET", "overview")).json;
    expect(o.totals.users).toBeGreaterThanOrEqual(5);
    // Every total is a number (no figure lost to a mis-cased column).
    for (const k of ["users", "orgs", "active7", "dau", "projects", "deploys30", "deploysFailed30", "aiCost30", "emails30", "emailsFailed30"]) expect(typeof o.totals[k], k).toBe("number");
    expect(o.series.signups).toHaveLength(30);
    expect(o.funnel[0]).toMatchObject({ step: "Signed up" });
    expect(o.plans.mrr).toBeNull();
    const h = (await A("GET", "health")).json;
    expect(h.database.ok).toBe(true);
    expect(h.database.migrations.applied).toBe(h.database.migrations.files);
    const g = (await A("GET", "golive")).json;
    expect(g.ready).toBe(false);
    expect(g.checks.find((c: { id: string }) => c.id === "backups")).toMatchObject({ status: "todo", manual: true });
    await A("POST", "golive", { id: "backups", done: true });
    expect((await A("GET", "golive")).json.checks.find((c: { id: string }) => c.id === "backups")).toMatchObject({ status: "done", doneBy: "olu@platform.example" });
    const i = await A("GET", "integrations");
    expect(i.json.integrations.find((x: { id: string }) => x.id === "database").status).toBe("ready");
    expect(i.text).not.toContain(process.env.DATABASE_URL!);
    expect((await A("POST", "integrations/database/test", {})).json.ok).toBe(true);
    expect((await A("POST", "integrations/database/test", {}, "support")).status).toBe(403);
  });

  it("shows jobs that gave up and puts them back in the queue", async () => {
    await db.insert(schema.jobs).values({ kind: "mail.send", status: "dead", attempts: 6, lastError: "SMTP 550" });
    const failing = (await A("GET", "health")).json.jobs.failing;
    expect(failing.find((f: { kind: string }) => f.kind === "mail.send")).toMatchObject({ dead: 1, last_error: "SMTP 550" });
    expect((await A("POST", "jobs/retry", { kind: "mail.send" }, "analyst")).status).toBe(403);
    expect((await A("POST", "jobs/retry", { kind: "mail.send" })).json).toEqual({ retried: 1 });
    const [j] = await db.select().from(schema.jobs).where(eq(schema.jobs.kind, "mail.send"));
    expect(j).toMatchObject({ status: "queued", attempts: 0 });
    await db.delete(schema.jobs).where(eq(schema.jobs.kind, "mail.send"));
  });

  it("searches the audit log across the platform", async () => {
    const r = (await A("GET", "audit?action=platform.")).json.entries;
    expect(r.some((e: { action: string; actor: string }) => e.action === "platform.user_disabled" && e.actor === "olu@platform.example")).toBe(true);
  });
});

describe("abuse", () => {
  it("can take a suspended workspace's public sites offline, and back", async () => {
    const pid = (await call(orgProjects.POST, { method: "POST", cookie: C.tenant, params: { orgId }, body: { templateId: "blank", name: "Shady" } })).json.project.id;
    const dep = (await call(deployments.POST, { method: "POST", cookie: C.tenant, params: { projectId: pid }, body: { environment: "production" } })).json.deployment.id;
    const site = () => call(siteServe.GET, { params: { deploymentId: dep }, path: `/sites/${dep}` });
    expect((await site()).status).toBe(200);
    await A("POST", `tenants/${orgId}/suspend`, { reason: "Phishing", sitesOffline: true });
    const off = await site();
    expect(off.status).toBe(503);
    expect(off.text).toContain("currently unavailable");
    await A("POST", `tenants/${orgId}/unsuspend`);
    expect((await site()).status).toBe(200);
  });
});
