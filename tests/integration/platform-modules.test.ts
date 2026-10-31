import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import { moduleDetail, modulesOverview } from "@/server/platform/modules-usage";
import { MODULES } from "@/lib/workspace/modules";
import { call, cookieFrom, resetDb } from "../helpers";

// Module dashboards in the platform console: every module is measured from
// its own tables (or says it can't be), and real activity shows up.
let cookie = "";
let orgId = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const CRM = (method: string, path: string, body?: unknown) => call((crmApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Mia Modules", email: "mia@modules.example", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  await CRM("GET", "meta");
  expect((await CRM("POST", "contacts", { name: "Ravi", email: "ravi@lumen.example" })).status).toBeLessThan(300);
  expect((await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Mia's site" } })).status).toBeLessThan(300);
});
afterAll(closeDb);

describe("module dashboards", () => {
  it("measures every module (plus web apps & hosting) without errors", async () => {
    const o = await modulesOverview();
    expect(o.modules.map((m) => m.id)).toEqual(expect.arrayContaining(["sites", ...MODULES.map((m) => m.id)]));
    for (const m of o.modules) {
      expect(m.error, `${m.id}: ${m.error}`).toBeUndefined();
      for (const k of ["enabledWorkspaces", "activeWorkspaces30", "records", "records30", "recordsPrev30"] as const) expect(typeof m[k], `${m.id}.${k}`).toBe("number");
      for (const k of m.kpis) expect(Number.isFinite(k.value), `${m.id} ${k.label}`).toBe(true);
    }
    const crm = o.modules.find((m) => m.id === "crm")!;
    expect(crm.records30).toBeGreaterThanOrEqual(1);
    expect(crm.activeWorkspaces30).toBe(1);
    expect(crm.enabledWorkspaces).toBe(1);
    expect(crm.kpis.find((k) => k.label === "Contacts")?.value).toBeGreaterThanOrEqual(1);
    expect(o.modules.find((m) => m.id === "sites")!.kpis.find((k) => k.label === "Web apps")?.value).toBe(1);
  });

  it("opens a module with a filled 30-day trend and its busiest workspaces", async () => {
    const crm = await moduleDetail("crm");
    expect(crm.trend).toHaveLength(30);
    expect(crm.trend.reduce((a, p) => a + p.n, 0)).toBeGreaterThanOrEqual(1);
    expect(crm.top[0]).toMatchObject({ orgId, name: "Mia's workspace" });
    const store = await moduleDetail("store");
    expect(store.error).toBeUndefined();
    expect(store.trend).toHaveLength(30);
    expect(store.records30).toBe(0);
  });

  it("refuses an unknown module", async () => {
    await expect(moduleDetail("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
