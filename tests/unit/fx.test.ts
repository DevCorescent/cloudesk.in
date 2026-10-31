import { describe, expect, it } from "vitest";
import { availableCurrencies, convertMinor, presentment, toBaseMinor } from "@/lib/store/fx";

describe("currency conversion", () => {
  it("converts minor units between currencies with different decimals", () => {
    expect(convertMinor(100000, "INR", { code: "USD", rate: "0.012", rounding: "none" })).toBe(1200); // ₹1,000 → $12.00
    expect(convertMinor(149900, "INR", { code: "JPY", rate: "1.79", rounding: "none" })).toBe(2683); // ₹1,499 → ¥2,683
    expect(convertMinor(1999, "USD", { code: "INR", rate: "83.25", rounding: "none" })).toBe(166417);
  });
  it("rounds display prices up to charm endings, never below the exact price", () => {
    const usd = (r: "whole" | "x.99" | "x.95") => ({ code: "USD", rate: "0.012", rounding: r });
    const price = { price: true };
    expect(convertMinor(149900, "INR", usd("x.99"), price)).toBe(1799); // 17.988 → 17.99
    expect(convertMinor(150000, "INR", usd("x.99"), price)).toBe(1899); // 18.00 → 18.99 (17.99 would be below)
    expect(convertMinor(149900, "INR", usd("x.95"), price)).toBe(1895); // 17.95 would be below 17.988
    expect(convertMinor(149900, "INR", usd("whole"), price)).toBe(1800);
    expect(convertMinor(149900, "INR", { code: "JPY", rate: "1.79", rounding: "x.99" }, price)).toBe(2684); // no decimals: up to a whole yen
    // Shipping and fees stay exact even when prices are rounded.
    expect(convertMinor(4900, "INR", usd("x.99"))).toBe(59);
  });
  it("converts back to base for reports, and only offers configured currencies", () => {
    expect(toBaseMinor(1200, "INR", { code: "USD", rate: "0.012", rounding: "none" })).toBe(100000);
    const extra = [{ code: "usd", rate: "0.012", rounding: "none" as const }, { code: "EUR", rate: "oops", rounding: "none" as const }];
    expect(availableCurrencies("INR", extra)).toEqual(["INR", "USD", "EUR"]);
    expect(presentment("INR", extra, "USD")?.code).toBe("USD");
    expect(presentment("INR", extra, "EUR")).toBeNull();
    expect(presentment("INR", extra, "INR")).toBeNull();
  });
});
