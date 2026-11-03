import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import { DEFAULT_PLANS } from "@/lib/billing/catalog";
import { monthlySpend } from "@/server/ai/tasks";
import { adminAct, allowancesOf, allPlans, applyRecommendedPlans, assertQuota, changePlan, clearCatalogCache, clearEntitlement, entitlementFor, margins, quotaUsage, subscriptionTick, syncSubscribers } from "@/server/billing/subscriptions";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
let org = "";
let user = "";
let projectId = "";

const overrides = (o: Record<string, unknown>) => adminAct(user, org, { action: "set_overrides", overrides: { modules: [], limits: {}, quotas: {}, note: "", ...o } as never });
const toFree = async () => {
  await db.update(schema.orgSubscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.orgSubscriptions.orgId, org));
  await subscriptionTick();
  clearEntitlement();
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Limit Lata", email: "lata@limits.in", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie })).json;
  org = m.organizations[0].id;
  user = m.user.id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: org }, body: { templateId: "blank", name: "Lata Studio" } })).json.project.id;
});
afterAll(closeDb);

describe("allowances on every plan", () => {
  it("gives the trial a fair-use cap on every costly thing", async () => {
    const e = await entitlementFor(org);
    expect(e.state).toBe("trial");
    expect(e.quotas).toMatchObject({ aiBudgetUsd: 2, campaignEmailsPerMonth: 500, signaturesPerMonth: 10, storageMb: 5120, chatGuests: 25 });
  });

  it("ties the AI budget to the plan, not one ceiling for everyone", async () => {
    expect((await monthlySpend(org)).budgetMicroUsd).toBe(2_000_000);
    await toFree();
    expect((await monthlySpend(org)).budgetMicroUsd).toBe(250_000);
  });

  it("refuses campaign email on Free, and counts storage across files and site media", async () => {
    await expect(assertQuota(org, "campaignEmailsPerMonth", 1)).rejects.toThrow(/campaign emails/);
    await db.insert(schema.assets).values({ projectId, filename: "hero.png", mime: "image/png", size: 3 * 1_048_576, sha256: "x".repeat(64), data: Buffer.from("x") });
    expect(Math.round((await quotaUsage(org, "storageMb")).storageMb)).toBe(3);
    await expect(assertQuota(org, "storageMb", 498)).rejects.toThrow(/MB of files/);
    await expect(assertQuota(org, "storageMb", 1)).resolves.toBeUndefined();
  });
});

describe("the platform team's overrides", () => {
  it("adds features, changes limits and makes allowances unlimited for one workspace", async () => {
    await overrides({ modules: ["clinic"], limits: { seats: 7 }, quotas: { contacts: null, signaturesPerMonth: 1 }, note: "Pilot clinic" });
    const e = await entitlementFor(org);
    expect(e.state).toBe("free");
    expect(e.modules).toContain("clinic");
    expect(e.limits.seats).toBe(7);
    expect(e.quotas.contacts).toBeUndefined();
    expect(e.quotas.signaturesPerMonth).toBe(1);
    const a = await allowancesOf(org);
    expect(a.overrides).toMatchObject({ modules: ["clinic"], note: "Pilot clinic" });
    expect(a.quotas.find((q) => q.key === "contacts")?.limit).toBeNull();
    const [ev] = await db.select().from(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.kind, "overrides_set"));
    expect(ev).toMatchObject({ orgId: org, byPlatform: true });
  });

  it("can raise an allowance past the plan's, and remove every override", async () => {
    await overrides({ quotas: { campaignEmailsPerMonth: 50 } });
    await expect(assertQuota(org, "campaignEmailsPerMonth", 40)).resolves.toBeUndefined();
    await overrides({});
    await expect(assertQuota(org, "campaignEmailsPerMonth", 1)).rejects.toThrow();
    expect((await entitlementFor(org)).modules).not.toContain("clinic");
  });
});

describe("changing plan", () => {
  it("won't move to a plan smaller than what the workspace uses", async () => {
    // Workday has no web apps; this workspace has one.
    await expect(changePlan(org, user, { kind: "plan", planId: "workday", interval: "month" })).rejects.toThrow(/1 sites \(the plan has 0\)/);
    await expect(changePlan(org, user, { kind: "plan", planId: "starter", interval: "month" })).resolves.toBeTruthy();
  });

  it("brings existing subscribers up to the plan as it is now, keeping what they pay", async () => {
    await db.update(schema.orgSubscriptions).set({ planId: "growth", planName: "Growth", modules: ["crm"], quotas: {}, monthly: 123400, limits: { projects: 1, seats: 30, customDomains: 0, automationsPerProject: 0 } }).where(eq(schema.orgSubscriptions.orgId, org));
    const r = await syncSubscribers(user, "growth");
    expect(r.updated).toBe(1);
    const [s] = await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, org));
    const growth = DEFAULT_PLANS.find((p) => p.id === "growth")!;
    expect(s!.modules).toEqual(growth.modules);
    expect(s!.quotas).toEqual(growth.quotas);
    expect(s!.monthly).toBe(123400);
    // Seats bought on top of the plan are kept.
    expect(s!.limits.seats).toBe(30);
  });
});

describe("the recommended plans", () => {
  it("restores features and allowances, keeps the platform's prices, and adds Business", async () => {
    await db.update(schema.planCatalog).set({ modules: ["crm"], quotas: {}, monthly: 111100 }).where(eq(schema.planCatalog.id, "starter"));
    await db.delete(schema.planCatalog).where(eq(schema.planCatalog.id, "business"));
    clearCatalogCache();
    await applyRecommendedPlans(user);
    const plans = await allPlans();
    const starter = plans.find((p) => p.id === "starter")!;
    expect(starter.modules).toEqual(DEFAULT_PLANS.find((p) => p.id === "starter")!.modules);
    expect(starter.quotas).toEqual(DEFAULT_PLANS.find((p) => p.id === "starter")!.quotas);
    expect(starter.monthly).toBe(111100);
    expect(plans.find((p) => p.id === "business")).toMatchObject({ monthly: 499900, active: true });
  });
});

describe("margins", () => {
  it("weighs what a workspace pays against what it costs to run", async () => {
    await db.insert(schema.aiTasks).values({ orgId: org, kind: "chat", status: "succeeded", input: {}, provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 5_000_000 });
    await db.update(schema.orgSubscriptions).set({ status: "active", monthly: 10000, complimentary: false }).where(eq(schema.orgSubscriptions.orgId, org));
    const m = await margins();
    const row = m.workspaces.find((w) => w.orgId === org)!;
    expect(row.aiUsd).toBe(5);
    expect(row.revenue).toBe(10000);
    // $5 of AI at ₹85 is ₹425 — more than the ₹100 it pays.
    expect(row.cost).toBeGreaterThanOrEqual(42500);
    expect(row.losing).toBe(true);
    expect(m.totals.losing).toBeGreaterThanOrEqual(1);
  });
});
