import { gunzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as logins from "@/app/api/v1/auth/logins/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as lifecycle from "@/app/api/v1/orgs/[orgId]/lifecycle/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import { isFlagOn } from "@/server/platform/admin";
import { buildExport, sweep } from "@/server/platform/lifecycle";
import { call, cookieFrom, resetDb } from "../helpers";

// The platform console (hidden from everyone but platform admins): suspending,
// trials, release flags, support access only while granted; and a workspace's
// own export, scheduled deletion, retention — plus sign-ins being recorded.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown, who = "staff") => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const L = (method: string, path: string, body?: unknown, who = "owner") => call((lifecycle as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/lifecycle/${path}`, params: { orgId, slug: seg(path) } });
const CRM = (method: string, path: string, body?: unknown, who = "owner") => call((crmApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Tara Tenant", email: "tara@tenant.example", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  C.staff = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pat Platform", email: "pat@platform.example", password: "correct-horse-42" } }));
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.email, "pat@platform.example"));
  C.admin = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Adi Admin", email: "adi@tenant.example", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "adi@tenant.example"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "admin" });
  await CRM("GET", "meta");
  await CRM("POST", "contacts", { name: "Asha", email: "asha@lumen.example" });
});
afterAll(closeDb);

describe("the platform console", () => {
  it("doesn't exist for anyone but platform admins", async () => {
    expect((await A("GET", "tenants", undefined, "owner")).status).toBe(404);
    const t = (await A("GET", "tenants")).json.tenants.find((x: { id: string }) => x.id === orgId);
    expect(t).toMatchObject({ members: 2, plan: "free", suspendedAt: null });
  });

  it("suspends a workspace (members can't use it, with the reason) and lifts it", async () => {
    expect((await A("POST", `tenants/${orgId}/suspend`, {})).status).toBe(422);
    await A("POST", `tenants/${orgId}/suspend`, { reason: "Payment dispute" });
    const r = await CRM("GET", "contacts");
    expect(r.status).toBe(403);
    expect(r.json.error.message).toBe("This workspace is suspended: Payment dispute. Contact support.");
    await A("POST", `tenants/${orgId}/unsuspend`);
    expect((await CRM("GET", "contacts")).status).toBe(200);
    // The suspension is in the workspace's audit log, so it now has a last activity.
    expect((await A("GET", "tenants")).json.tenants.find((x: { id: string }) => x.id === orgId).lastActive).not.toBeNull();
  });

  it("gives a trial of a paid plan", async () => {
    await A("POST", `tenants/${orgId}/trial`, { plan: "business", days: 14 });
    expect((await A("GET", "tenants?state=trial")).json.tenants.map((t: { id: string; plan: string }) => [t.id, t.plan])).toEqual([[orgId, "business"]]);
    await A("POST", `tenants/${orgId}/trial`, { plan: null });
    expect((await A("GET", "tenants?state=trial")).json.tenants).toHaveLength(0);
  });

  it("turns release flags on for chosen workspaces or everyone", async () => {
    expect(await isFlagOn("new-ledger", orgId)).toBe(false);
    await A("PUT", "flags", { key: "new-ledger", description: "Faster ledger", orgIds: [orgId] });
    expect(await isFlagOn("new-ledger", orgId)).toBe(true);
    expect(await isFlagOn("new-ledger", "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect((await A("PUT", "flags", { key: "Bad Key" })).status).toBe(422);
  });

  it("shows a workspace's activity only while its owner allows support in, and logs each look", async () => {
    expect((await A("GET", `tenants/${orgId}`)).json.support).toBeNull();
    expect((await L("POST", "support", { hours: 4 })).status).toBe(422);
    await L("POST", "support", { hours: 4, reason: "Ledger doesn't balance" });
    const d = (await A("GET", `tenants/${orgId}`)).json;
    expect(d.grant.reason).toBe("Ledger doesn't balance");
    expect(d.support.activity.length).toBeGreaterThan(0);
    const views = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, "support.viewed")));
    expect(views).toHaveLength(1);
    const g = (await L("GET", "")).json.grants[0];
    await L("DELETE", `support/${g.id}`);
    expect((await A("GET", `tenants/${orgId}`)).json.support).toBeNull();
  });
});

describe("a workspace's lifecycle", () => {
  it("exports everything it holds, without secrets", async () => {
    const e = (await L("POST", "exports")).json.export;
    expect((await L("POST", "exports")).status).toBe(409);
    await buildExport(e.id);
    const res = await (lifecycle as unknown as { GET: Parameters<typeof call>[0] }).GET(new Request(`http://localhost:3000/api/v1/orgs/${orgId}/lifecycle/exports/${e.id}/download`, { headers: { cookie: C.owner } }), { params: Promise.resolve({ orgId, slug: ["exports", e.id, "download"] }) } as never);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    const data = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
    expect(data.format).toBe("cloudesk-workspace-export");
    expect(data.tables.crm_contacts.map((c: { name: string }) => c.name)).toEqual(["Asha"]);
    expect(data.members.map((m: { email: string }) => m.email).sort()).toEqual(["adi@tenant.example", "tara@tenant.example"]);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/password_hash|secret_enc|token_hash|capture_token/);
  });

  it("deletes the workspace only after confirming, the owner can cancel, and it goes after 30 days", async () => {
    expect((await L("POST", "deletion", { confirm: "x" }, "admin")).status).toBe(403);
    expect((await L("POST", "deletion", { confirm: "wrong" })).status).toBe(422);
    const name = (await L("GET", "")).json.name;
    const r = (await L("POST", "deletion", { confirm: name })).json;
    expect(new Date(r.deletionScheduledAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await L("DELETE", "deletion");
    expect((await L("GET", "")).json.deletionScheduledAt).toBeNull();
    await L("POST", "deletion", { confirm: name });
    expect((await sweep()).deleted).toBe(0);
    expect((await sweep(new Date(Date.now() + 31 * 86_400_000))).deleted).toBe(1);
    expect(await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId))).toHaveLength(0);
  });
});

describe("sign-ins", () => {
  it("records each attempt, and emails about a new device", async () => {
    await call(login.POST, { method: "POST", body: { email: "pat@platform.example", password: "wrong-password-1" } });
    const ok = await call(login.POST, { method: "POST", body: { email: "pat@platform.example", password: "correct-horse-42" } });
    expect(ok.status).toBe(200);
    const mine = (await call(logins.GET, { cookie: C.staff })).json.logins;
    expect(mine.map((l: { ok: boolean; reason: string }) => [l.ok, l.reason])).toEqual(expect.arrayContaining([[false, "wrong password"], [true, ""]]));
    // Same person, another browser and network.
    const req = new Request("http://localhost:3000/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ email: "pat@platform.example", password: "correct-horse-42" }) });
    expect((await login.POST(req, { params: Promise.resolve({}) } as never)).status).toBe(200);
    const mails = await db.select().from(schema.outboundEmails).where(and(eq(schema.outboundEmails.to, "pat@platform.example"), eq(schema.outboundEmails.subject, "New sign-in to your Cloudesk account")));
    expect(mails).toHaveLength(1);
    expect(mails[0].body).toContain("Firefox on Windows (203.0.113.9)");
  });
});
