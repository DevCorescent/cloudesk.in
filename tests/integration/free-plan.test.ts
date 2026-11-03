import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as crm from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as dash from "@/app/api/v1/orgs/[orgId]/dashboard/[[...slug]]/route";
import * as subApi from "@/app/api/v1/orgs/[orgId]/subscription/[[...slug]]/route";
import * as plansApi from "@/app/api/v1/plans/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as invRoute from "@/app/api/v1/projects/[projectId]/invoicing/[[...slug]]/route";
import * as storeRoute from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import { addPeriod } from "@/lib/invoicing/model";
import { assertQuota, clearEntitlement, entitlementFor, keepRecap, quotaUsage, recommendPlan, subscriptionTick } from "@/server/billing/subscriptions";
import { today } from "@/server/invoicing/service";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
let org = "";
let projectId = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const R = (mod: Record<string, unknown>, base: string, params: Record<string, string>) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie, body, path: `${base}/${path}`, params: { ...params, slug: seg(path) } });
let CRM: ReturnType<typeof R>;
let S: ReturnType<typeof R>;
let I: ReturnType<typeof R>;

const toFree = async () => {
  // The trial ended a moment ago, nothing was paid.
  await db.update(schema.orgSubscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.orgSubscriptions.orgId, org));
  await subscriptionTick();
  clearEntitlement();
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Free Fiona", email: "fiona@free.in", password: "correct-horse-42" } }));
  org = (await call(me.GET, { cookie })).json.organizations[0].id;
  CRM = R(crm, `/api/v1/orgs/${org}/crm`, { orgId: org });
  S = R(subApi, `/api/v1/orgs/${org}/subscription`, { orgId: org });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: org }, body: { templateId: "blank", name: "Fiona Studio" } })).json.project.id;
  await call(storeRoute.POST, { method: "POST", cookie, path: `/api/v1/projects/${projectId}/store/setup`, params: { projectId, slug: ["setup"] }, body: { name: "Fiona Studio", country: "IN", region: "Karnataka" } });
  I = R(invRoute, `/api/v1/projects/${projectId}/invoicing`, { projectId });
  // Something built during the trial in a feature Free doesn't include.
  await db.insert(schema.hrEmployees).values([{ orgId: org, empNo: "E1", name: "Ravi", joinDate: "2026-04-01" }, { orgId: org, empNo: "E2", name: "Meena", joinDate: "2026-04-01" }] as never);
});
afterAll(closeDb);

describe("the Free plan", () => {
  it("is in the catalogue as ₹0, separate from the plans on sale", async () => {
    const pub = (await call(plansApi.GET, { path: "/api/v1/plans" })).json;
    expect(pub.plans.map((p: { id: string }) => p.id)).toEqual(["workday", "starter", "growth", "business", "enterprise"]);
    expect(pub.free).toMatchObject({ id: "free", monthly: 0, quotas: { invoicesPerMonth: 10, contacts: 100, aiPerMonth: 25, aiBudgetUsd: 0.25, storageMb: 500 } });
    expect((await S("POST", "quote", { kind: "plan", planId: "free", interval: "month" })).status).toBe(422);
  });

  it("is generous during the trial, and shows what Free would lock away", async () => {
    const e = await entitlementFor(org);
    expect(e).toMatchObject({ state: "trial", modules: null, quotas: { invoicesPerMonth: 100, contacts: 1000, aiPerMonth: 200 } });
    const recap = await keepRecap(org);
    expect(recap.lost).toEqual([{ module: "hr", name: expect.any(String), records: 2 }]);
    expect(recap.plan).toMatchObject({ planId: "growth" });
    expect(recap.custom!.monthly).toBe(19900 + 49900);
  });

  it("takes over when the trial ends without a plan: its features only, nothing read-only", async () => {
    await toFree();
    const e = await entitlementFor(org);
    expect(e).toMatchObject({ state: "free", planName: "Free", limits: { projects: 1, seats: 2, customDomains: 0 } });
    const m = (await call(me.GET, { cookie })).json.organizations[0];
    expect(m.plan).toMatchObject({ state: "free", name: "Free" });
    expect(m.entitled).toEqual(["mail", "calendar", "chat", "invoicing", "crm"]);
    // The dashboard offers only what the plan includes.
    const d = await call(dash.GET, { cookie, path: `/api/v1/orgs/${org}/dashboard`, params: { orgId: org, slug: [] } });
    expect(d.status).toBe(200);
    const ids = d.json.quick.map((q: { id: string }) => q.id);
    expect(ids).not.toContain("payroll");
    expect(ids.some((x: string) => ["invoice", "contact", "deal"].includes(x))).toBe(true);
    const o = (await S("GET", "")).json;
    expect(o).toMatchObject({ state: "free", free: { id: "free" }, recap: { lost: [{ module: "hr", records: 2 }] } });
    expect(o.quotas.contacts).toMatchObject({ used: 0, limit: 100 });
  });

  it("stops at the contact allowance with the plan that has more — and warns at 80% first", async () => {
    await db.insert(schema.crmContacts).values(Array.from({ length: 99 }, (_, i) => ({ orgId: org, name: `Lead ${i}`, email: `lead${i}@x.in` })) as never);
    expect((await CRM("POST", "contacts", { name: "Number 100", email: "n100@x.in" })).status).toBe(200);
    const warned = await db.select().from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.orgId, org), eq(schema.subscriptionEvents.kind, "quota_warning")));
    await expect.poll(async () => (await db.select().from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.orgId, org), eq(schema.subscriptionEvents.kind, "quota_warning")))).length).toBe(Math.max(1, warned.length));
    const r = await CRM("POST", "contacts", { name: "Number 101", email: "n101@x.in" });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/Free plan includes 100 contacts and you've used 100/);
    expect(r.json.error.details).toMatchObject({ quota: ["contacts"], upgrade: ["starter"] });
    expect((await quotaUsage(org)).contacts).toBe(100);
  });

  it("allows 10 invoices a month, then asks for a plan", async () => {
    const client = { name: "Asha", company: "", email: "asha@x.in", phone: "", gstin: "", billing: { line1: "1 Road", line2: "", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN" }, shipping: null };
    const doc = () => ({ type: "invoice", client, issueDate: today(), dueDate: addPeriod(today(), "month"), currency: "INR", lines: [{ id: "a", name: "Work", quantity: 1, rate: 100000, taxBps: 1800, unit: "" }], taxMode: "gst", placeOfSupply: "Maharashtra", notes: "" });
    for (let i = 0; i < 10; i++) expect((await I("POST", "documents", { document: doc() })).status).toBe(201);
    const eleventh = await I("POST", "documents", { document: doc() });
    expect(eleventh.status).toBe(409);
    expect(eleventh.json.error.details).toMatchObject({ quota: ["invoicesPerMonth"] });
    // A quote isn't an invoice.
    expect((await I("POST", "documents", { document: { ...doc(), type: "quote" } })).status).toBe(201);
  });

  it("counts AI requests against the monthly allowance", async () => {
    await db.insert(schema.aiTasks).values(Array.from({ length: 25 }, () => ({ orgId: org, kind: "chat", status: "succeeded", input: {}, provider: "anthropic" })) as never);
    await expect(assertQuota(org, "aiPerMonth")).rejects.toThrow(/25 AI requests this month/);
  });

  it("recommends the cheapest plan that covers what's needed", async () => {
    expect(await recommendPlan({ modules: ["invoicing"] })).toMatchObject({ planId: "starter" });
    expect(await recommendPlan({ modules: ["hr", "inventory"] })).toMatchObject({ planId: "growth" });
    // Industry suites come with Business; the AI code editor only with Enterprise.
    expect(await recommendPlan({ modules: ["clinic"] })).toMatchObject({ planId: "business" });
    expect(await recommendPlan({ modules: ["ai-ide"] })).toMatchObject({ planId: "enterprise" });
    expect(await recommendPlan({ modules: ["mail", "chat"] })).toMatchObject({ planId: "workday" });
  });
});
