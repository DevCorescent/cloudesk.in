import { describe, expect, it } from "vitest";
import { checkDiscount } from "@/lib/store/discounts";
import { formatMoney, formatPrice, parseMoney } from "@/lib/store/money";
import { computeTotals, gstSplit } from "@/lib/store/pricing";
import { availableRates, matchZone, type Rate, type Zone } from "@/lib/store/shipping";

const line = (key: string, unitPrice: number, quantity = 1, taxBps = 1800, weightGrams = 500) => ({ key, unitPrice, quantity, taxBps, weightGrams });

describe("money", () => {
  it("formats and parses minor units", () => {
    expect(formatMoney(149900, "INR")).toBe("₹1,499.00");
    expect(formatPrice(149900, "INR")).toBe("₹1,499");
    expect(formatPrice(1999, "USD")).toBe("$19.99");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(parseMoney("1,499.50", "INR")).toBe(149950);
    expect(parseMoney("abc", "INR")).toBeNull();
  });
});

describe("totals", () => {
  it("extracts tax from tax-inclusive prices", () => {
    const t = computeTotals({ lines: [line("a", 118000)], shipping: 0, pricesIncludeTax: true });
    expect(t.tax).toBe(18000);
    expect(t.total).toBe(118000);
  });
  it("adds tax on top for tax-exclusive prices and taxes shipping", () => {
    const t = computeTotals({ lines: [line("a", 100000, 2)], shipping: 10000, pricesIncludeTax: false, shippingTaxBps: 1800 });
    expect(t.subtotal).toBe(200000);
    expect(t.tax).toBe(36000 + 1800);
    expect(t.total).toBe(200000 + 10000 + 37800);
  });
  it("allocates percentage discounts across lines before tax", () => {
    const t = computeTotals({ lines: [line("a", 100000), line("b", 50000, 1, 500)], discount: { kind: "percent", value: 10, minSubtotal: 0, code: "X" }, shipping: 0, pricesIncludeTax: false });
    expect(t.discount).toBe(15000);
    expect(t.lineTax.a).toBe(16200); // 18% of 90,000
    expect(t.lineTax.b).toBe(2250); // 5% of 45,000
    expect(t.total).toBe(150000 - 15000 + 18450);
  });
  it("caps fixed discounts and handles free shipping", () => {
    expect(computeTotals({ lines: [line("a", 5000)], discount: { kind: "fixed", value: 9000, minSubtotal: 0, code: "X" }, shipping: 0, pricesIncludeTax: true }).total).toBe(0);
    expect(computeTotals({ lines: [line("a", 5000)], discount: { kind: "free_shipping", value: 0, minSubtotal: 0, code: "X" }, shipping: 9900, pricesIncludeTax: true }).shipping).toBe(0);
    expect(computeTotals({ lines: [line("a", 5000)], discount: { kind: "percent", value: 50, minSubtotal: 10000, code: "X" }, shipping: 0, pricesIncludeTax: true }).discount).toBe(0);
  });
  it("splits GST by place of supply", () => {
    expect(gstSplit(1801, "Karnataka", "karnataka")).toEqual([{ name: "CGST", amount: 900 }, { name: "SGST", amount: 901 }]);
    expect(gstSplit(1800, "Karnataka", "Delhi")).toEqual([{ name: "IGST", amount: 1800 }]);
  });
});

describe("shipping", () => {
  const zones: Zone[] = [
    { id: "world", name: "Rest of world", countries: ["*"], regions: [], postalPrefixes: [], sort: 9 },
    { id: "in", name: "India", countries: ["IN"], regions: [], postalPrefixes: [], sort: 1 },
    { id: "blr", name: "Bengaluru", countries: ["IN"], regions: [], postalPrefixes: ["560"], sort: 0 },
  ];
  const rates: Rate[] = [
    { id: "std", zoneId: "in", name: "Standard", kind: "free_over", amount: 9900, freeOver: 99900, weightTiers: [], eta: "3–5 days", codAllowed: true, sort: 0 },
    { id: "heavy", zoneId: "in", name: "By weight", kind: "weight", amount: 0, freeOver: null, weightTiers: [{ upToGrams: 1000, amount: 5000 }, { upToGrams: 5000, amount: 15000 }], eta: "", codAllowed: true, sort: 1 },
    { id: "local", zoneId: "blr", name: "Same-day", kind: "flat", amount: 4900, freeOver: null, weightTiers: [], eta: "Today", codAllowed: true, sort: 0 },
    { id: "pick", zoneId: "blr", name: "Pickup", kind: "pickup", amount: 0, freeOver: null, weightTiers: [], eta: "", codAllowed: true, sort: 1 },
    { id: "intl", zoneId: "world", name: "International", kind: "flat", amount: 199900, freeOver: null, weightTiers: [], eta: "", codAllowed: false, sort: 0 },
  ];
  it("matches the most specific zone", () => {
    expect(matchZone(zones, { country: "IN", region: "Karnataka", postalCode: "560001" })?.id).toBe("blr");
    expect(matchZone(zones, { country: "IN", region: "Delhi", postalCode: "110001" })?.id).toBe("in");
    expect(matchZone(zones, { country: "US", region: "CA", postalCode: "94016" })?.id).toBe("world");
  });
  it("prices rates by subtotal and weight, dropping inapplicable tiers", () => {
    const r = availableRates(zones, rates, { country: "IN", region: "Delhi", postalCode: "110001" }, 120000, 6000);
    expect(r.rates.map((x) => [x.id, x.price])).toEqual([["std", 0]]);
    const r2 = availableRates(zones, rates, { country: "IN", region: "Delhi", postalCode: "110001" }, 50000, 800);
    expect(r2.rates.map((x) => [x.id, x.price])).toEqual([["std", 9900], ["heavy", 5000]]);
  });
});

describe("discount eligibility", () => {
  const base = { code: "SAVE", kind: "percent" as const, value: 10, minSubtotal: 50000, usageLimit: 2, usedCount: 0, startsAt: null, endsAt: null, active: true };
  it("checks activity, dates, limits and minimums", () => {
    expect(checkDiscount(base, 60000).ok).toBe(true);
    expect(checkDiscount({ ...base, active: false }, 60000).ok).toBe(false);
    expect(checkDiscount({ ...base, usedCount: 2 }, 60000).ok).toBe(false);
    expect(checkDiscount(base, 1000).ok).toBe(false);
    expect(checkDiscount({ ...base, endsAt: "2020-01-01" }, 60000).ok).toBe(false);
    expect(checkDiscount(null, 60000).ok).toBe(false);
  });
});

describe("store templates", () => {
  it("produce valid storefronts with no deploy-blocking problems", async () => {
    const { diagnose } = await import("@/lib/site/diagnostics");
    const { storeSiteDoc, STORE_TEMPLATES, samplePrice } = await import("@/lib/store/templates");
    expect(STORE_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of STORE_TEMPLATES) {
      const doc = storeSiteDoc(t);
      expect(diagnose(doc).filter((d) => d.severity === "error"), t.id).toEqual([]);
      for (const p of t.products) expect(t.collections[p.collection], `${t.id}: ${p.title}`).toBeDefined();
    }
    expect(samplePrice(1999, "INR")).toBe(199900);
    expect(samplePrice(1999, "USD") % 100).toBe(99);
  });

  it("still flags links to store pages on sites without a store", async () => {
    const { diagnose } = await import("@/lib/site/diagnostics");
    const { storeSiteDoc, STORE_TEMPLATES } = await import("@/lib/store/templates");
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    doc.pages[0].sections = doc.pages[0].sections.filter((s) => !["productGrid", "collectionList", "navbar"].includes(s.type));
    expect(diagnose(doc).some((d) => d.severity === "error" && d.message.includes("/shop"))).toBe(true);
  });
});
