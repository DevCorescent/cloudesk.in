import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as modules from "@/app/api/v1/orgs/[orgId]/modules/route";
import * as roles from "@/app/api/v1/orgs/[orgId]/roles/[[...id]]/route";
import * as member from "@/app/api/v1/orgs/[orgId]/members/[userId]/route";
import * as hr from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as crm from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as store from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as horeca from "@/app/api/v1/projects/[projectId]/horeca/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let staff = "";
let staffId = "";
let orgId = "";
let projectId = "";
const user = async (name: string, email: string) => {
  const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
  return { cookie: c, id: (await call(me.GET, { cookie: c })).json.user.id as string };
};
const hrCall = (method: string, path: string, cookie = owner, body?: unknown) => call(hr[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/hr/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const crmCall = (method: string, path: string, cookie = owner, body?: unknown) => call(crm[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const proj = (h: typeof store, seg: string, path: string, cookie = staff) => call(h.GET, { cookie, path: `/api/v1/projects/${projectId}/${seg}/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const putModules = (body: unknown) => call(modules.PUT, { method: "PUT", cookie: owner, body, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules` });

beforeAll(async () => {
  await resetDb();
  const o = await user("Kiran Owner", "kiran.compose@example.com");
  owner = o.cookie;
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  const s = await user("Lata Floor", "lata.compose@example.com");
  staff = s.cookie;
  staffId = s.id;
  await db.insert(schema.memberships).values({ orgId, userId: s.id, role: "editor" });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Masala Lane" } })).json.project.id;
});
afterAll(closeDb);

describe("build your app", () => {
  it("switches parts of a module off, and the API follows", async () => {
    expect((await hrCall("GET", "payroll")).status).toBe(200);
    const r = await putModules({ modules: null, partsOff: { hr: ["payroll", "made-up"], crm: ["sequences"] } });
    expect(r.status).toBe(200);
    expect(r.json.partsOff).toEqual({ hr: ["payroll"], crm: ["sequences"] });
    const off = await hrCall("GET", "payroll");
    expect(off.status).toBe(403);
    expect(off.json.error.message).toMatch(/Payroll is switched off/);
    expect((await hrCall("GET", "payslips/mine")).status).toBe(403);
    // Other parts and the core of the module carry on.
    expect((await hrCall("GET", "leave")).status).toBe(200);
    expect((await hrCall("GET", "people")).status).toBe(200);
    expect((await crmCall("GET", "sequences")).status).toBe(403);
    expect((await crmCall("GET", "contacts")).status).toBe(200);
    // The session carries it to the client.
    const org = (await call(me.GET, { cookie: owner })).json.organizations[0];
    expect(org.partsOff).toEqual({ hr: ["payroll"], crm: ["sequences"] });
    // Leaving partsOff out keeps what's saved; an empty list switches them on.
    await putModules({ modules: null });
    expect((await hrCall("GET", "payroll")).status).toBe(403);
    await putModules({ modules: null, partsOff: {} });
    expect((await hrCall("GET", "payroll")).status).toBe(200);
  });

  it("only owners and admins change features", async () => {
    const r = await call(modules.PUT, { method: "PUT", cookie: staff, body: { modules: null, partsOff: { hr: ["leave"] } }, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules` });
    expect(r.status).toBe(403);
  });

  it("with attendance off, payroll counts only unpaid leave as loss of pay", async () => {
    await hrCall("PUT", "settings", owner, { attendance: { absentIfNoCheckIn: true } });
    const p = await hrCall("POST", "people", owner, { name: "Ravi Cook", designation: "Cook", joinDate: "2026-01-01", ctc: 360000_00 });
    expect(p.status).toBe(200);
    const withAtt = await hrCall("POST", "payroll", owner, { month: "2026-03" });
    expect(withAtt.status).toBe(200);
    const slip = (await hrCall("GET", `payroll/${withAtt.json.run.id}`)).json.slips[0];
    expect(slip.data.days.lop).toBeGreaterThan(20); // no check-ins all month
    await hrCall("DELETE", `payroll/${withAtt.json.run.id}`);
    await putModules({ modules: null, partsOff: { hr: ["attendance"] } });
    const run = await hrCall("POST", "payroll", owner, { month: "2026-03" });
    const slip2 = (await hrCall("GET", `payroll/${run.json.run.id}`)).json.slips[0];
    expect(slip2.data.days.lop).toBe(0);
    expect((await hrCall("GET", "attendance/today")).status).toBe(403);
    await putModules({ modules: null, partsOff: {} });
  });
});

describe("workspace roles", () => {
  let roleId = "";
  it("makes a role limited to some modules", async () => {
    const bad = await call(roles.POST, { method: "POST", cookie: owner, params: { orgId }, body: { name: "Empty", baseRole: "editor", modules: [] } });
    expect(bad.status).toBe(422);
    const r = await call(roles.POST, { method: "POST", cookie: owner, params: { orgId }, body: { name: "Floor manager", baseRole: "editor", modules: ["horeca"] } });
    expect(r.status).toBe(200);
    roleId = r.json.role.id;
    const dup = await call(roles.POST, { method: "POST", cookie: owner, params: { orgId }, body: { name: "floor MANAGER", baseRole: "viewer", modules: ["crm"] } });
    expect(dup.status).toBe(409);
    // Members can't make roles.
    expect((await call(roles.POST, { method: "POST", cookie: staff, params: { orgId }, body: { name: "Mine", baseRole: "editor", modules: ["crm"] } })).status).toBe(403);
  });

  it("limits a member to the role's modules (and what they rely on)", async () => {
    // Before: an editor reaches the CRM.
    expect((await crmCall("GET", "contacts", staff)).status).toBe(200);
    const a = await call(member.PATCH, { method: "PATCH", cookie: owner, params: { orgId, userId: staffId }, body: { customRoleId: roleId } });
    expect(a.status).toBe(200);
    const org = (await call(me.GET, { cookie: staff })).json.organizations[0];
    expect(org).toMatchObject({ role: "editor", customRole: "Floor manager", allowed: ["horeca"] });
    const blocked = await crmCall("GET", "contacts", staff);
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.message).toMatch(/doesn't include CRM/);
    expect((await hrCall("GET", "meta", staff)).status).toBe(403);
    // Horeca's screens use the store's API, so that stays reachable.
    expect((await proj(horeca, "horeca", "venue")).status).not.toBe(403);
    expect((await proj(store, "store", "products")).status).not.toBe(403);
    const list = (await call(roles.GET, { cookie: owner, params: { orgId } })).json.roles;
    expect(list[0]).toMatchObject({ name: "Floor manager", members: 1 });
  });

  it("changing the base role moves its members; deleting lifts the limit", async () => {
    const u = await call(roles.PUT, { method: "PUT", cookie: owner, params: { orgId, id: [roleId] }, body: { name: "Floor manager", baseRole: "viewer", modules: ["horeca", "crm"] } });
    expect(u.status).toBe(200);
    let org = (await call(me.GET, { cookie: staff })).json.organizations[0];
    expect(org).toMatchObject({ role: "viewer", allowed: ["horeca", "crm"] });
    expect((await crmCall("GET", "contacts", staff)).status).toBe(200);
    expect((await call(roles.DELETE, { method: "DELETE", cookie: owner, params: { orgId, id: [roleId] } })).status).toBe(200);
    org = (await call(me.GET, { cookie: staff })).json.organizations[0];
    expect(org).toMatchObject({ role: "viewer", customRole: null, allowed: null });
  });

  it("picking a built-in role clears a workspace role", async () => {
    const r = (await call(roles.POST, { method: "POST", cookie: owner, params: { orgId }, body: { name: "HR desk", baseRole: "editor", modules: ["hr"] } })).json.role;
    await call(member.PATCH, { method: "PATCH", cookie: owner, params: { orgId, userId: staffId }, body: { customRoleId: r.id } });
    await call(member.PATCH, { method: "PATCH", cookie: owner, params: { orgId, userId: staffId }, body: { role: "designer" } });
    const org = (await call(me.GET, { cookie: staff })).json.organizations[0];
    expect(org).toMatchObject({ role: "designer", customRole: null, allowed: null });
  });
});

import * as setupRoute from "@/app/api/v1/orgs/[orgId]/modules/setup/route";
import { MODULE_IDS } from "@/lib/workspace/modules";
import { MODULE_SETUP } from "@/server/workspace/setup";
describe("onboarding sets up what's picked", () => {
  it("has a setup for every module, and each one runs", async () => {
    expect(Object.keys(MODULE_SETUP).sort()).toEqual([...MODULE_IDS].sort());
    for (const id of MODULE_IDS) {
      const r = await call(setupRoute.POST, { method: "POST", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules/setup`, body: { module: id } });
      expect(r.status, id).toBe(200);
    }
    const [wh] = await db.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId));
    expect(wh).toMatchObject({ name: "Main store room", isDefault: true });
    expect((await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).length).toBeGreaterThan(30);
    expect(await db.select().from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId))).toHaveLength(1);
    expect((await db.select().from(schema.hrLeaveTypes).where(eq(schema.hrLeaveTypes.orgId, orgId))).length).toBe(4);
    // Running it again adds nothing new.
    await call(setupRoute.POST, { method: "POST", cookie: owner, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules/setup`, body: { module: "invoicing" } });
    expect(await db.select().from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId))).toHaveLength(1);
    // Members can't run setup.
    expect((await call(setupRoute.POST, { method: "POST", cookie: staff, params: { orgId }, path: `/api/v1/orgs/${orgId}/modules/setup`, body: { module: "crm" } })).status).toBe(403);
  });

  it("switching a module on later sets it up too", async () => {
    await putModules({ modules: ["crm"] });
    await db.delete(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId));
    await putModules({ modules: ["crm", "inventory"] });
    expect(await db.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId))).toHaveLength(1);
    await putModules({ modules: null });
  });
});
