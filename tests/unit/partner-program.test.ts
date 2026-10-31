import { describe, expect, it } from "vitest";
import { cleanCode, CODE_RE, DEFAULT_PROGRAM, discountText, months, payoutSplit, rateFor, shareOf, tierFor, TYPE_INFO, PARTNER_TYPES } from "@/lib/partners/program";

describe("partner program maths", () => {
  it("picks the highest tier reached and says how far the next is", () => {
    expect(tierFor(0, DEFAULT_PROGRAM.tiers)).toMatchObject({ tier: { name: "Partner" }, next: { name: "Gold" }, toNext: 10 });
    expect(tierFor(10, DEFAULT_PROGRAM.tiers)).toMatchObject({ tier: { name: "Gold", bonusBps: 500 }, toNext: 15 });
    expect(tierFor(400, DEFAULT_PROGRAM.tiers)).toMatchObject({ tier: { name: "Platinum" }, next: null, toNext: 0 });
    // Order in settings doesn't matter.
    expect(tierFor(12, [...DEFAULT_PROGRAM.tiers].reverse()).tier.name).toBe("Gold");
  });

  it("adds the tier bonus to the partner's own or their kind's rate, capped at 100%", () => {
    expect(rateFor({ type: "organisation", commissionBps: null }, DEFAULT_PROGRAM, 0)).toMatchObject({ base: 3000, bonus: 0, rate: 3000 });
    expect(rateFor({ type: "influencer", commissionBps: null }, DEFAULT_PROGRAM, 30)).toMatchObject({ base: 2000, bonus: 1000, rate: 3000 });
    expect(rateFor({ type: "sales", commissionBps: 9500 }, DEFAULT_PROGRAM, 30).rate).toBe(10000);
  });

  it("rounds shares and tax to the paisa", () => {
    expect(shareOf(84915, 2000)).toBe(16983);
    expect(payoutSplit(15000, 200)).toEqual({ amount: 15000, tds: 300, net: 14700 });
    expect(payoutSplit(100000, 0)).toEqual({ amount: 100000, tds: 0, net: 100000 });
  });

  it("describes terms in words", () => {
    expect(discountText(1500, 3)).toBe("15% off the first 3 payments");
    expect(discountText(1000, 1)).toBe("10% off the first payment");
    expect(discountText(0, 3)).toBe("");
    expect(months(0)).toBe("for as long as they pay");
    expect(months(24)).toBe("for 24 months");
  });

  it("cleans codes to 4–20 upper-case letters and digits", () => {
    expect(cleanCode(" riya-42 ")).toBe("RIYA42");
    expect(CODE_RE.test(cleanCode("ab"))).toBe(false);
    expect(cleanCode("x".repeat(40))).toHaveLength(20);
  });

  it("asks every kind of partner its own questions and lists their scope of work", () => {
    for (const t of PARTNER_TYPES) {
      expect(TYPE_INFO[t].scope.length).toBeGreaterThanOrEqual(4);
      expect(TYPE_INFO[t].fields.some((f) => f.required)).toBe(true);
      expect(DEFAULT_PROGRAM.types[t].maxDiscountBps).toBeGreaterThanOrEqual(DEFAULT_PROGRAM.types[t].discountBps);
    }
  });
});
