import { describe, expect, it } from "vitest";
import { addInterval, DEFAULT_PLANS, DEFAULT_PRICING, entitlement, isDowngrade, prorate, quote, QuoteError, taxOf } from "@/lib/billing/catalog";

const P = DEFAULT_PRICING;

describe("quotes", () => {
  it("prices a catalogue plan for a month or a year", () => {
    const m = quote({ kind: "plan", planId: "starter", interval: "month" }, DEFAULT_PLANS, P);
    expect(m).toMatchObject({ planId: "starter", amount: 99900, monthly: 99900, interval: "month" });
    const y = quote({ kind: "plan", planId: "growth", interval: "year" }, DEFAULT_PLANS, P);
    expect(y).toMatchObject({ amount: 2999000, monthly: Math.round(2999000 / 12) });
    expect(quote({ kind: "plan", planId: "workday", interval: "month" }, DEFAULT_PLANS, P).modules).toEqual(["mail", "calendar", "chat"]);
  });

  it("refuses plans that aren't on sale", () => {
    expect(() => quote({ kind: "plan", planId: "nope", interval: "month" }, DEFAULT_PLANS, P)).toThrow(QuoteError);
    const archived = DEFAULT_PLANS.map((p) => (p.id === "starter" ? { ...p, active: false } : p));
    expect(() => quote({ kind: "plan", planId: "starter", interval: "month" }, archived, P)).toThrow(QuoteError);
  });

  it("builds your own: the base, each feature, what it needs, and extra seats", () => {
    // Accounting needs Invoicing, so both are priced; Mail, Calendar and Chat are the base.
    const q = quote({ kind: "custom", modules: ["accounting", "mail"], seats: 5, interval: "month" }, DEFAULT_PLANS, P);
    expect(q.modules).toEqual(expect.arrayContaining(["mail", "calendar", "chat", "accounting", "invoicing"]));
    expect(q.lines.map((l) => [l.label, l.amount])).toEqual([
      ["Base: Mail, Calendar and Chat", 19900],
      ["invoicing", 29900],
      ["accounting", 49900],
      ["2 extra seats", 19800],
    ]);
    expect(q.amount).toBe(19900 + 29900 + 49900 + 19800);
    expect(q.limits.seats).toBe(5);
    // A year is the monthly price times the months charged (10).
    const y = quote({ kind: "custom", modules: ["accounting"], seats: 5, interval: "year" }, DEFAULT_PLANS, P);
    expect(y.amount).toBe(q.amount * 10);
    expect(() => quote({ kind: "custom", modules: [], seats: 1, interval: "month" }, DEFAULT_PLANS, P)).toThrow(/between 3/);
  });
});

describe("dates, tax and proration", () => {
  it("adds calendar months without spilling into the next month", () => {
    expect(addInterval(new Date("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(new Date("2028-01-31T10:00:00Z"), "month").toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval(new Date("2026-03-15T00:00:00Z"), "year").toISOString()).toBe("2027-03-15T00:00:00.000Z");
  });

  it("rounds tax to the paisa", () => {
    expect(taxOf(99900, 1800)).toBe(17982);
    expect(taxOf(133333, 1800)).toBe(24000);
  });

  it("credits unused time and charges the time left (same interval)", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    const now = new Date("2026-11-11T00:00:00Z"); // 20 of 30 days left
    const r = prorate({ current: { amount: 99900, interval: "month" }, periodStart: start, periodEnd: end, now, next: { amount: 299900, interval: "month" } });
    expect(r.credit).toBe(66600);
    expect(r.charge).toBe(199933);
    expect(r.periodEnd).toEqual(end);
  });

  it("starts a fresh period when the interval changes", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    const now = new Date("2026-11-16T00:00:00Z"); // half left
    const r = prorate({ current: { amount: 100000, interval: "month" }, periodStart: start, periodEnd: end, now, next: { amount: 1000000, interval: "year" } });
    expect(r).toMatchObject({ credit: 50000, charge: 1000000 });
    expect(r.periodStart).toEqual(now);
    expect(r.periodEnd.toISOString()).toBe("2027-11-16T00:00:00.000Z");
  });

  it("knows a downgrade: cheaper, or losing a feature", () => {
    const growth = { monthly: 299900, modules: ["crm", "hr"], limits: DEFAULT_PLANS[2]!.limits };
    expect(isDowngrade(growth, { monthly: 99900, modules: ["crm"], limits: DEFAULT_PLANS[1]!.limits })).toBe(true);
    expect(isDowngrade(growth, { monthly: 399900, modules: ["crm"], limits: DEFAULT_PLANS[2]!.limits })).toBe(true);
    expect(isDowngrade(growth, { monthly: 799900, modules: null, limits: DEFAULT_PLANS[3]!.limits })).toBe(false);
  });
});

describe("what a workspace may use", () => {
  const base = { status: "trialing", modules: ["mail"], limits: DEFAULT_PLANS[0]!.limits, trialEndsAt: null as Date | null, currentPeriodEnd: null as Date | null, graceEndsAt: null as Date | null, cancelAtPeriodEnd: false, complimentary: false, compUntil: null as Date | null };
  const TL = DEFAULT_PLANS[3]!.limits;
  const now = new Date("2026-11-10T00:00:00Z");
  const later = new Date("2026-12-10T00:00:00Z");
  const before = new Date("2026-11-01T00:00:00Z");

  it("trial: everything, with the largest limits", () => {
    expect(entitlement({ ...base, trialEndsAt: later }, TL, now)).toMatchObject({ state: "trial", modules: null, limits: TL });
  });
  it("paid: the plan's features; cancelling keeps them to the end", () => {
    expect(entitlement({ ...base, status: "active", currentPeriodEnd: later }, TL, now)).toMatchObject({ state: "active", modules: ["mail"] });
    expect(entitlement({ ...base, status: "active", currentPeriodEnd: later, cancelAtPeriodEnd: true }, TL, now).state).toBe("canceling");
  });
  it("grace after a missed renewal, then expired with nothing", () => {
    expect(entitlement({ ...base, status: "past_due", currentPeriodEnd: before, graceEndsAt: later }, TL, now).state).toBe("grace");
    const e = entitlement({ ...base, status: "expired", currentPeriodEnd: before, trialEndsAt: before }, TL, now);
    expect(e).toMatchObject({ state: "expired", modules: [] });
    expect(e.limits.projects).toBe(0);
  });
  it("complimentary plans and switched-off enforcement", () => {
    expect(entitlement({ ...base, status: "active", complimentary: true }, TL, now).state).toBe("active");
    expect(entitlement({ ...base, status: "expired" }, TL, now, false).state).toBe("unrestricted");
  });
});
