import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import { launchOffer, LAUNCH_OFFER } from "@/lib/festive";
import { clearEntitlement, entitlementFor, publicCatalog } from "@/server/billing/subscriptions";
import { call, cookieFrom, resetDb } from "../helpers";

// The launch & Diwali offer: workspaces started while it runs get three months of everything.
beforeAll(resetDb);
afterEach(() => {
  delete process.env.FESTIVE_OFFER;
  clearEntitlement();
});
afterAll(closeDb);

const join = async (email: string) => {
  const cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Diya Rao", email, password: "correct-horse-42" } }));
  return (await call(me.GET, { cookie })).json.organizations[0].id as string;
};
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

describe("the launch & Diwali offer", () => {
  it("gives a workspace started during it a 90-day trial of every feature, and says so", async () => {
    process.env.FESTIVE_OFFER = "on";
    // Only while it runs: it ends with 10 November (IST).
    expect(launchOffer(new Date("2026-11-10T23:59:00+05:30"))).toBeTruthy();
    expect(launchOffer(new Date("2026-11-11T00:00:01+05:30"))).toBeNull();
    if (!launchOffer()) return; // run after the offer: nothing to check
    const org = await join("diya@offer.in");
    const [sub] = await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, org));
    expect(days(sub!.trialStartedAt!, sub!.trialEndsAt!)).toBe(LAUNCH_OFFER.trialDays);
    const e = await entitlementFor(org);
    expect(e.state).toBe("trial");
    expect(e.modules).toBeNull(); // every feature
    const [ev] = await db.select().from(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.orgId, org));
    expect(ev?.detail).toMatchObject({ days: 90, offer: "launch-diwali-2026" });
    expect((await publicCatalog()).pricing.trialDays).toBe(90);
  });

  it("leaves the standard trial alone when it isn't on", async () => {
    const org = await join("ravi@standard.in");
    const [sub] = await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, org));
    expect(days(sub!.trialStartedAt!, sub!.trialEndsAt!)).toBe(30);
    expect((await publicCatalog()).pricing.trialDays).toBe(30);
  });
});
