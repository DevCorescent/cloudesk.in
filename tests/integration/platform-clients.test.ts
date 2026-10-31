import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import { clientDetail, revenueOverview } from "@/server/platform/clients";
import { call, cookieFrom, resetDb } from "../helpers";

// Revenue across the platform and the per-client profile operators open:
// real paid orders counted per currency and source, net of refunds; a store
// order that isn't paid never counts; platform MRR stays empty without billing.
let cookie = "";
let orgId = "";
let projectId = "";

const order = (n: number, v: { total: number; refunded?: number; currency?: string; paid?: Date | null; channel?: string }) => ({
  projectId,
  number: n,
  accessKeyHash: `hash-${n}`,
  email: `buyer${n}@example.com`,
  shippingAddress: {},
  currency: v.currency ?? "INR",
  subtotal: v.total,
  total: v.total,
  refundedTotal: v.refunded ?? 0,
  taxIncluded: true,
  paymentMethod: "razorpay",
  channel: v.channel ?? "online",
  paidAt: v.paid === undefined ? new Date() : v.paid,
});

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Rhea Revenue", email: "rhea@shop.example", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Rhea Shop" } })).json.project.id;
  expect((await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).status).toBe(201);
  await db.insert(schema.storeOrders).values([
    order(1, { total: 250_000, refunded: 50_000 }),
    order(2, { total: 100_000, channel: "pos" }),
    order(3, { total: 999_999, paid: null }),
    order(4, { total: 4_000, currency: "USD" }),
    order(5, { total: 70_000, paid: new Date(Date.now() - 45 * 86_400_000) }),
  ]);
});
afterAll(closeDb);

describe("revenue across the platform", () => {
  it("counts paid orders per currency and source, net of refunds, and never adds currencies", async () => {
    const r = await revenueOverview();
    const inr = r.gmv.byCurrency.find((c) => c.currency === "INR")!;
    expect(inr.last30).toBe(200_000 + 100_000);
    expect(inr.prev30).toBe(70_000);
    expect(inr.allTime).toBe(370_000);
    expect(inr.growthPct).toBeCloseTo(((300_000 - 70_000) / 70_000) * 100, 0);
    expect(inr.bySource.find((s) => s.source === "pos")).toMatchObject({ last30: 100_000 });
    expect(inr.bySource.find((s) => s.source === "store")).toMatchObject({ last30: 200_000, allTime: 270_000 });
    expect(r.gmv.byCurrency.find((c) => c.currency === "USD")).toMatchObject({ last30: 4_000 });
    const months = r.gmv.monthly.filter((m) => m.currency === "INR");
    expect(months).toHaveLength(12);
    expect(months[11]!.month).toBe(new Date().toISOString().slice(0, 7));
    expect(months.reduce((a, m) => a + m.amount, 0)).toBe(370_000);
    expect(r.gmv.topClients).toContainEqual({ orgId, name: "Rhea's workspace", slug: expect.any(String), currency: "INR", last30: 300_000 });
  });

  it("leaves platform revenue empty when billing isn't connected", async () => {
    const r = await revenueOverview();
    expect(r.platform.billingConfigured).toBe(false);
    expect(r.platform.mrr).toBeNull();
    expect(r.platform.perPlan.every((p) => p.mrr === null)).toBe(true);
    expect(r.platform.counts.paying).toBe(0);
  });
});

describe("one client's profile", () => {
  it("brings together members, web apps, revenue, usage and health", async () => {
    const c = await clientDetail(orgId);
    expect(c.profile).toMatchObject({ id: orgId, name: "Rhea's workspace" });
    expect(c.owners).toEqual([{ name: "Rhea Revenue", email: "rhea@shop.example" }]);
    expect(c.members[0]).toMatchObject({ role: "owner", email: "rhea@shop.example", mfa: false });
    expect(c.members[0]!.lastSeen).not.toBeNull();
    expect(c.webApps).toHaveLength(1);
    expect(c.webApps[0]).toMatchObject({ name: "Rhea Shop", live: true, lastDeployStatus: "ready" });
    expect(c.revenue.byCurrency.find((x) => x.currency === "INR")).toMatchObject({ last30: 300_000, allTime: 370_000 });
    expect(c.usage.used.projects).toBe(1);
    expect(c.usage.enforced).toBe(false);
    // During the free trial a workspace has the largest limits on sale.
    expect(c.usage.limits.projects).toBe(50);
    expect(c.billing).toMatchObject({ plan: "free", compPlan: null, trialActive: false });
    expect(c.health).toMatchObject({ suspended: false, sitesOffline: false, pastDue: false, failedDeploys7d: 0 });
    expect(c.signIns30.ok).toBeGreaterThanOrEqual(0);
    expect(c.activity30.some((a) => a.area === "deployment" || a.area === "project")).toBe(true);
    // Counts and totals only: no buyer emails from the orders.
    expect(JSON.stringify(c)).not.toContain("buyer1@example.com");
  });

  it("answers not found for an unknown or malformed id", async () => {
    await expect(clientDetail("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "not_found" });
    await expect(clientDetail("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
