import { describe, expect, it } from "vitest";
import { addInterval, addonsOf, aiBudgetFor, PACK_KEYS, packCost, RUN_COST, topupQuote, DEFAULT_PLANS, DEFAULT_PRICING, entitlement, isDowngrade, prorate, QUOTA_KEYS, quote, QuoteError, taxOf } from "@/lib/billing/catalog";
import { MODULE_IDS } from "@/lib/workspace/modules";

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

describe("plans that never lose money", () => {
  const paid = DEFAULT_PLANS.filter((p) => p.kind !== "free");

  it("caps every paid plan's AI spend within the target share of its price", () => {
    for (const p of paid) {
      const usd = p.quotas?.aiBudgetUsd;
      expect(usd, p.id).toBeDefined();
      expect(usd!, p.id).toBeLessThanOrEqual(aiBudgetFor(p.monthly, P));
      // At the rupee rate, AI at its cap costs at most the target share of what the plan earns.
      expect(usd! * P.usdInr, p.id).toBeLessThanOrEqual(((p.monthly / 100) * P.aiCostShareBps) / 10000);
    }
  });

  it("gives every feature a plan below Enterprise, except the AI code editor", () => {
    const covered = new Set(paid.filter((p) => p.id !== "enterprise").flatMap((p) => p.modules ?? []));
    expect(MODULE_IDS.filter((m) => !covered.has(m))).toEqual(["ai-ide"]);
  });

  it("builds bigger plans on smaller ones", () => {
    const [, starter, growth, business] = paid;
    for (const [small, big] of [[starter, growth], [growth, business]] as const) {
      expect(small!.modules!.every((m) => big!.modules!.includes(m)), `${small!.id} ⊂ ${big!.id}`).toBe(true);
      expect(big!.monthly).toBeGreaterThan(small!.monthly);
    }
  });

  it("gives a built plan an AI budget that grows with its price, and its allowances", () => {
    const small = quote({ kind: "custom", modules: ["crm"], seats: 3, interval: "month" }, DEFAULT_PLANS, P);
    const big = quote({ kind: "custom", modules: ["crm", "accounting", "hr", "inventory"], seats: 10, interval: "month" }, DEFAULT_PLANS, P);
    expect(small.quotas.aiBudgetUsd).toBe(aiBudgetFor(small.monthly, P));
    expect(big.quotas.aiBudgetUsd!).toBeGreaterThan(small.quotas.aiBudgetUsd!);
    expect(small.quotas).toMatchObject({ contacts: P.customQuotas.contacts, storageMb: P.customQuotas.storageMb });
    // ₹1,000 a month at 20% and ₹85/$ is $2.35 of AI.
    expect(aiBudgetFor(100000, P)).toBe(2.35);
  });

  it("knows every allowance", () => {
    expect(QUOTA_KEYS).toEqual(["invoicesPerMonth", "contacts", "aiPerMonth", "aiBudgetUsd", "campaignEmailsPerMonth", "signaturesPerMonth", "storageMb", "chatGuests"]);
  });
});

describe("add-ons", () => {
  const growth = (interval: "month" | "year", addons: Parameters<typeof quote>[0] extends infer C ? (C extends { kind: "plan"; addons?: infer A } ? A : never) : never) => quote({ kind: "plan", planId: "growth", interval, addons }, DEFAULT_PLANS, P);

  it("adds a feature and packs to a plan's bill, line by line", () => {
    const q = growth("month", { modules: ["quality"], packs: { invoicesPerMonth: 2, seats: 1 } });
    expect(q.lines.map((l) => [l.label, l.amount, l.addon ?? null, l.qty ?? null])).toEqual([
      ["Growth plan, monthly", 299900, null, null],
      ["quality", 29900, "module", null],
      ["+1 seat", 9900, "seats", 1],
      ["+1,000 invoices a month", 19800, "invoicesPerMonth", 2],
    ]);
    expect(q.amount).toBe(299900 + 29900 + 9900 + 19800);
    expect(q.monthly).toBe(q.amount);
    expect(q.amount).toBe(q.lines.reduce((s, l) => s + l.amount, 0));
    expect(q.modules).toContain("quality");
    expect(q).toMatchObject({ seats: 26, limits: { seats: 26 }, quotas: { invoicesPerMonth: 4000 } });
  });

  it("bills a yearly plan's add-ons at the yearly rate (yearlyMonths of them)", () => {
    const q = growth("year", { modules: ["quality"], packs: { invoicesPerMonth: 2, seats: 1 } });
    expect(q.amount).toBe(2999000 + (29900 + 9900 + 19800) * P.yearlyMonths);
    expect(q.monthly).toBe(Math.round(q.amount / 12));
    expect(q.amount).toBe(q.lines.reduce((s, l) => s + l.amount, 0));
  });

  it("leaves out what the plan already has, so add-ons carry over between plans", () => {
    // Business includes Quality; Enterprise has every feature and unlimited contacts.
    const b = quote({ kind: "plan", planId: "business", interval: "month", addons: { modules: ["quality"] } }, DEFAULT_PLANS, P);
    expect(b.amount).toBe(499900);
    const e = quote({ kind: "plan", planId: "enterprise", interval: "month", addons: { modules: ["quality"], packs: { contacts: 3, storageMb: 1 } } }, DEFAULT_PLANS, P);
    expect(e.lines.map((l) => l.addon)).toEqual([undefined, "storageMb"]);
    expect(e.amount).toBe(799900 + 9900);
    expect(e.quotas.contacts).toBeUndefined();
  });

  it("brings the features an add-on needs, each at its price", () => {
    const q = quote({ kind: "plan", planId: "workday", interval: "month", addons: { modules: ["accounting"] } }, DEFAULT_PLANS, P);
    expect(q.lines.map((l) => [l.module, l.amount])).toEqual([[undefined, 19900], ["invoicing", 29900], ["accounting", 49900]]);
  });

  it("raises the AI budget by what more AI requests pay for", () => {
    const q = growth("month", { packs: { aiPerMonth: 1 } });
    expect(q.quotas.aiPerMonth).toBe(1500 + 500);
    expect(q.quotas.aiBudgetUsd).toBe(Math.round((7 + aiBudgetFor(29900, P)) * 100) / 100);
  });

  it("adds packs to a built plan, with its seats chosen as before", () => {
    const q = quote({ kind: "custom", modules: ["crm"], seats: 4, interval: "month", addons: { packs: { contacts: 1 } } }, DEFAULT_PLANS, P);
    expect(q.amount).toBe(19900 + 29900 + 9900 + 19900);
    expect(q.quotas.contacts).toBe(5000 + 5000);
    expect(() => quote({ kind: "custom", modules: [], seats: 4, interval: "month", addons: { packs: { seats: 1 } } }, DEFAULT_PLANS, P)).toThrow(QuoteError);
  });

  it("refuses counts it can't sell", () => {
    expect(() => growth("month", { packs: { contacts: 1.5 } })).toThrow(QuoteError);
    expect(() => growth("month", { packs: { contacts: 1001 } })).toThrow(QuoteError);
    expect(() => growth("month", { modules: ["nope" as never] })).toThrow(QuoteError);
  });

  it("reads the add-ons back from a subscription's lines", () => {
    const q = growth("month", { modules: ["quality"], packs: { storageMb: 2, chatGuests: 1 } });
    expect(addonsOf(q.lines)).toEqual({ modules: ["quality"], packs: { storageMb: 2, chatGuests: 1 } });
    expect(growth("month", addonsOf(q.lines)).amount).toBe(q.amount);
  });
});

describe("unit economics", () => {
  const inr = (usd: number) => usd * P.usdInr * 100;
  it("every pack costs well under its price to run, payment fee included", () => {
    for (const k of PACK_KEYS) expect(packCost(k, P.packs[k], P) / P.packs[k].price, k).toBeLessThanOrEqual(0.5);
  });

  it("no paid plan, used to every limit, costs more than 70% of its price (AI, email, storage, payment fee)", () => {
    for (const p of DEFAULT_PLANS.filter((x) => x.monthly > 0)) {
      const q = p.quotas ?? {};
      const cost = inr(q.aiBudgetUsd ?? 0) + inr((q.campaignEmailsPerMonth ?? 0) * RUN_COST.emailUsd) + inr(((q.storageMb ?? 0) / 1024) * RUN_COST.storageGbUsd) + (p.monthly * RUN_COST.paymentFeeBps) / 10000;
      expect(cost / p.monthly, p.id).toBeLessThanOrEqual(0.7);
    }
  });

  it("prices top-ups exactly, with the AI spend their price pays for", () => {
    const t = topupQuote({ aiPerMonth: 2, invoicesPerMonth: 1 }, P);
    expect(t.amount).toBe(2 * 29900 + 9900);
    expect(t.units).toEqual({ aiPerMonth: 1000, aiBudgetUsd: aiBudgetFor(2 * 29900, P), invoicesPerMonth: 500 });
    expect(() => topupQuote({}, P)).toThrow(QuoteError);
    expect(() => topupQuote({ aiPerMonth: 1.5 }, P)).toThrow(QuoteError);
  });
});
