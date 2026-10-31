import { describe, expect, it } from "vitest";
import { bookedShares, dayAfter, inrOf, monthEnds, revaluation } from "@/lib/accounting/fx";

describe("foreign currency", () => {
  it("converts minor units at a rate, including currencies without decimals", () => {
    expect(inrOf(100_00, "USD", 83.25)).toBe(8325_00);
    expect(inrOf(1, "USD", 83.333333)).toBe(83);
    expect(inrOf(1000, "JPY", 0.5612)).toBe(561_20);
  });

  it("books payments so that settling in full leaves no rounding behind", () => {
    // $100.01 at 83.333333 = ₹8,334.17; three payments book exactly that in total.
    const total = 100_01;
    const totalInr = inrOf(total, "USD", 83.333333);
    const shares = bookedShares([33_33, 33_33, 33_35], total, totalInr, "USD", 83.333333);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(totalInr);
    expect(shares[0]).toBe(inrOf(33_33, "USD", 83.333333));
  });

  it("revalues an open balance at the closing rate", () => {
    // $1,000 open, booked at 83 (₹83,000); closing 84 → ₹1,000 gain on a receivable.
    expect(revaluation(1000_00, 83000_00, "USD", 84)).toBe(1000_00);
    expect(revaluation(1000_00, 83000_00, "USD", 82.5)).toBe(-500_00);
  });

  it("lists completed month ends", () => {
    expect(monthEnds("2026-08-15", "2026-10-24")).toEqual(["2026-08-31", "2026-09-30"]);
    expect(monthEnds("2026-12-01", "2027-02-01")).toEqual(["2026-12-31", "2027-01-31"]);
    expect(monthEnds("2026-10-01", "2026-10-31")).toEqual([]);
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });
});
