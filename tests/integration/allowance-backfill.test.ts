import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { DEFAULT_PLANS } from "@/lib/billing/catalog";
import { allPlans, clearCatalogCache } from "@/server/billing/subscriptions";
import { resetDb } from "../helpers";

// A catalogue saved before plans had allowances (everything unlimited) gets the
// recommended ones once; an admin's later choice is then left alone.
const fresh = async () => {
  clearCatalogCache();
  (globalThis as { __allowancesChecked?: boolean }).__allowancesChecked = false;
  return allPlans();
};

beforeAll(async () => {
  await resetDb();
  await db.insert(schema.planCatalog).values(DEFAULT_PLANS.map((p) => ({ ...p, quotas: p.kind === "free" ? (p.quotas as Record<string, number>) : {} })));
});
afterAll(() => closeDb());

describe("allowances for an older catalogue", () => {
  it("fills in the built-in plans' allowances, leaving prices alone", async () => {
    const plans = await fresh();
    const growth = plans.find((p) => p.id === "growth")!;
    expect(growth.quotas).toEqual(DEFAULT_PLANS.find((p) => p.id === "growth")!.quotas);
    expect(growth.monthly).toBe(299900);
    expect(plans.find((p) => p.id === "free")!.quotas).toEqual(DEFAULT_PLANS.find((p) => p.id === "free")!.quotas);
  });

  it("does it only once", async () => {
    await db.update(schema.planCatalog).set({ quotas: {} }).where(eq(schema.planCatalog.id, "growth"));
    const plans = await fresh();
    expect(plans.find((p) => p.id === "growth")!.quotas).toEqual({});
  });
});
