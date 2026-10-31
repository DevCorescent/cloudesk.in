// Tenant isolation and role escalation: ids from another workspace are refused
// (HR, CRM, logistics, apps, automations), single sign-on and SCIM are for
// owners, and a member on a module-limited workspace role can't lift the limit.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as apps from "@/app/api/v1/orgs/[orgId]/apps/[[...slug]]/route";
import * as chat from "@/app/api/v1/orgs/[orgId]/chat/[[...slug]]/route";
import * as crm from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as hr from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as identity from "@/app/api/v1/orgs/[orgId]/identity/[[...slug]]/route";
import * as invitations from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as logistics from "@/app/api/v1/orgs/[orgId]/logistics/[[...slug]]/route";
import * as member from "@/app/api/v1/orgs/[orgId]/members/[userId]/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as roles from "@/app/api/v1/orgs/[orgId]/roles/[[...id]]/route";
import * as automations from "@/app/api/v1/projects/[projectId]/automations/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

type Mod = Record<string, Parameters<typeof call>[0]>;
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const user = async (name: string, email: string) => {
  const cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie })).json;
  return { cookie, id: m.user.id as string, orgId: m.organizations[0]?.id as string };
};
const on = (mod: unknown, base: string) => (cookie: string, orgId: string, method: string, path: string, body?: unknown) =>
  call((mod as Mod)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const H = on(hr, "hr");
const CRM = on(crm, "crm");
const LGX = on(logistics, "logistics");
const ID = on(identity, "identity");

// Workspace A belongs to Alice; workspace B to Bob, where Eve is an employee.
let A: Awaited<ReturnType<typeof user>>;
let B: Awaited<ReturnType<typeof user>>;
let eve: Awaited<ReturnType<typeof user>>;
const ids: Record<string, string> = {};
const day = new Date(Date.now() + 5.5 * 3600_000 - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  A = await user("Alice A", "alice.iso@example.com");
  B = await user("Bob B", "bob.iso@example.com");
  eve = await user("Eve E", "eve.iso@example.com");
  await db.insert(schema.memberships).values({ orgId: B.orgId, userId: eve.id, role: "employee" });
  await H(A.cookie, A.orgId, "GET", "meta");
  await H(B.cookie, B.orgId, "GET", "meta");
  await H(A.cookie, A.orgId, "PUT", "settings", { overtime: { enabled: true } });
  await H(B.cookie, B.orgId, "PUT", "settings", { overtime: { enabled: true } });
  ids.bEve = (await H(B.cookie, B.orgId, "POST", "people", { name: "Eve E", email: "eve.iso@example.com", joinDate: "2025-01-01", ctc: 600000_00 })).json.employee.id;
});
afterAll(closeDb);

describe("HR across workspaces", () => {
  it("an HR admin of one workspace can't touch another workspace's people by id", async () => {
    // Eve sees her colleagues' ids in B, then acts from a workspace she owns (A).
    expect((await H(A.cookie, A.orgId, "POST", "attendance/mark", { employeeIds: [ids.bEve], date: day, status: "absent" })).status).toBe(403);
    expect((await H(A.cookie, A.orgId, "POST", "overtime", { employeeId: ids.bEve, date: day, minutes: 600 })).status).toBe(403);
    expect((await H(A.cookie, A.orgId, "POST", "roster", { entries: [{ employeeId: ids.bEve, date: day, shiftId: null }] })).status).toBe(403);
    expect((await H(A.cookie, A.orgId, "GET", `people/${ids.bEve}/payslips`)).status).toBe(404);
    expect((await H(A.cookie, A.orgId, "POST", `people/${ids.bEve}/stay`)).status).toBe(404);
    expect(await db.select().from(schema.hrAttendance).where(eq(schema.hrAttendance.employeeId, ids.bEve))).toEqual([]);
    expect(await db.select().from(schema.hrOvertime).where(eq(schema.hrOvertime.employeeId, ids.bEve))).toEqual([]);
    expect(await db.select().from(schema.hrEvents).where(and(eq(schema.hrEvents.employeeId, ids.bEve), eq(schema.hrEvents.orgId, A.orgId)))).toEqual([]);
    // In its own workspace, the same calls work.
    expect((await H(B.cookie, B.orgId, "POST", "attendance/mark", { employeeIds: [ids.bEve], date: day, status: "present" })).status).toBe(200);
    expect((await H(B.cookie, B.orgId, "GET", `people/${ids.bEve}/payslips`)).status).toBe(200);
  });

  it("only HR, payroll and someone's managers see their leave balances", async () => {
    ids.bAlex = (await H(B.cookie, B.orgId, "POST", "people", { name: "Alex Colleague", joinDate: "2025-01-01" })).json.employee.id;
    expect((await H(eve.cookie, B.orgId, "GET", `people/${ids.bEve}/balances`)).status).toBe(200);
    expect((await H(eve.cookie, B.orgId, "GET", `people/${ids.bAlex}/balances`)).status).toBe(404);
    expect((await H(B.cookie, B.orgId, "GET", `people/${ids.bAlex}/balances`)).status).toBe(200);
  });

  it("a job can't point at another workspace's department", async () => {
    const dept = (await H(B.cookie, B.orgId, "POST", "departments", { name: "Secret Lab" })).json.department.id;
    expect((await H(A.cookie, A.orgId, "POST", "jobs", { title: "Spy", departmentId: dept })).status).toBe(422);
  });
});

describe("CRM and logistics references", () => {
  it("an email can't be filed on another workspace's deal", async () => {
    const deal = (await CRM(B.cookie, B.orgId, "POST", "deals", { title: "B's secret deal", value: 100 })).json.deal.id;
    const contact = (await CRM(A.cookie, A.orgId, "POST", "contacts", { name: "Asha", email: "asha.iso@example.com" })).json.contact.id;
    expect((await CRM(A.cookie, A.orgId, "POST", `contacts/${contact}/email`, { subject: "Hi", body: "Planted", dealId: deal })).status).toBe(404);
    // B's deal has its own activities (e.g. it was created); none of them is A's planted email.
    const acts = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.dealId, deal));
    expect(acts.filter((x) => x.kind === "email" || x.orgId === A.orgId)).toEqual([]);
  });

  it("a shipment can't be moved onto another workspace's carrier", async () => {
    const theirs = (await LGX(B.cookie, B.orgId, "POST", "carriers", { name: "B Freight", kind: "transporter" })).json.carrier.id;
    const mine = (await LGX(A.cookie, A.orgId, "POST", "carriers", { name: "A Freight", kind: "transporter" })).json.carrier.id;
    const ship = await LGX(A.cookie, A.orgId, "POST", "shipments", { mode: "carrier", carrierId: mine, deliveryIds: [], consignee: "Someone" });
    expect(ship.status).toBe(200);
    const id = ship.json.shipment.id;
    expect((await LGX(A.cookie, A.orgId, "PUT", `shipments/${id}`, { carrierId: theirs })).status).toBe(422);
    const [row] = await db.select().from(schema.lgxShipments).where(eq(schema.lgxShipments.id, id));
    expect(row.carrierId).toBe(mine);
  });
});

describe("apps and automations", () => {
  it("deleting another workspace's app id removes nothing of it", async () => {
    const pA = (await call(orgProjects.POST, { method: "POST", cookie: A.cookie, params: { orgId: A.orgId }, body: { templateId: "blank", name: "A site" } })).json.project.id;
    const [app] = await db.insert(schema.apps).values({ orgId: A.orgId, slug: "a-app", manifest: { name: "A app" }, secretEnc: "x" }).returning();
    const [inst] = await db.insert(schema.appInstalls).values({ appId: app.id, projectId: pA, scopes: [] }).returning();
    const r = await call((apps as unknown as Mod).DELETE, { method: "DELETE", cookie: B.cookie, path: `/api/v1/orgs/${B.orgId}/apps/${app.id}`, params: { orgId: B.orgId, slug: [app.id] } });
    expect(r.status).toBe(404);
    expect((await db.select().from(schema.appInstalls).where(eq(schema.appInstalls.id, inst.id))).length).toBe(1);
    ids.pA = pA;
  });

  it("a run can only be stopped from its own project", async () => {
    const pB = (await call(orgProjects.POST, { method: "POST", cookie: B.cookie, params: { orgId: B.orgId }, body: { templateId: "blank", name: "B site" } })).json.project.id;
    const [wf] = await db.insert(schema.workflows).values({ projectId: ids.pA, name: "A flow", trigger: { type: "manual" } }).returning();
    const [run] = await db.insert(schema.workflowRuns).values({ workflowId: wf.id, projectId: ids.pA, triggerType: "manual", snapshot: {}, status: "waiting" }).returning();
    const stop = (cookie: string, projectId: string) => call((automations as unknown as Mod).POST, { method: "POST", cookie, path: `/api/v1/projects/${projectId}/automations/${wf.id}/runs/${run.id}`, params: { projectId, slug: [wf.id, "runs", run.id] } });
    expect((await stop(B.cookie, pB)).status).toBe(404);
    expect((await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id)))[0].status).toBe("waiting");
    expect((await stop(A.cookie, ids.pA)).status).toBe(200);
  });
});

describe("roles and identity", () => {
  it("single sign-on and SCIM are for owners, and never add owners", async () => {
    const admin = await user("Ada Admin", "ada.iso@example.com");
    await db.insert(schema.memberships).values({ orgId: B.orgId, userId: admin.id, role: "admin" });
    expect((await ID(admin.cookie, B.orgId, "GET", "sso")).status).toBe(200);
    expect((await ID(admin.cookie, B.orgId, "PUT", "sso", { issuer: "https://idp.evil.example", clientId: "x", clientSecret: "y", jitRole: "viewer" })).status).toBe(403);
    expect((await ID(admin.cookie, B.orgId, "POST", "scim")).status).toBe(403);
    expect((await ID(B.cookie, B.orgId, "PUT", "sso", { issuer: "https://idp.example", clientId: "x", clientSecret: "y", jitRole: "owner" })).status).toBe(422);
  });

  it("a member on a module-limited role can't lift the limit", async () => {
    const lim = await user("Lim Admin", "lim.iso@example.com");
    const role = (await call((roles as unknown as Mod).POST, { method: "POST", cookie: B.cookie, params: { orgId: B.orgId }, body: { name: "Store admin", baseRole: "admin", modules: ["store"] } })).json.role;
    await db.insert(schema.memberships).values({ orgId: B.orgId, userId: lim.id, role: "admin", customRoleId: role.id });
    const patch = (body: unknown) => call((member as unknown as Mod).PATCH, { method: "PATCH", cookie: lim.cookie, body, params: { orgId: B.orgId, userId: lim.id } });
    expect((await patch({ role: "admin" })).status).toBe(403);
    expect((await call((roles as unknown as Mod).PUT, { method: "PUT", cookie: lim.cookie, params: { orgId: B.orgId, id: [role.id] }, body: { name: "Store admin", baseRole: "admin", modules: ["store", "hr", "crm"] } })).status).toBe(403);
    expect((await call((invitations as unknown as Mod).POST, { method: "POST", cookie: lim.cookie, params: { orgId: B.orgId }, body: { email: "alt.iso@example.com", role: "admin" } })).status).toBe(403);
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, B.orgId), eq(schema.memberships.userId, lim.id)));
    expect(m.customRoleId).toBe(role.id);
  });
});

describe("chat presence", () => {
  it("says a colleague is in a meeting without showing the meeting's title", async () => {
    const now = Date.now();
    await db.insert(schema.calCalendars).values({ orgId: B.orgId, ownerId: B.id, name: "Personal" }).returning().then(async ([cal]) => {
      await db.insert(schema.calEvents).values({ orgId: B.orgId, ownerId: B.id, calendarId: cal.id, uid: `onc-${now}@cloudesk`, title: "Oncology follow-up", startsAt: new Date(now - 600_000), endsAt: new Date(now + 600_000), tz: "Asia/Kolkata" });
    });
    const r = await call((chat as unknown as Mod).GET, { cookie: eve.cookie, path: `/api/v1/orgs/${B.orgId}/chat/meta`, params: { orgId: B.orgId, slug: ["meta"] } });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain("Oncology");
    expect(r.json.people.find((p: { id: string }) => p.id === B.id).inMeeting).toBeTruthy();
  });
});
