import { describe, expect, it } from "vitest";
import { addMonths, cashFlow, depreciation, disposal, monthsBetween, occurrences, spread } from "@/lib/accounting/finance";

describe("depreciation", () => {
  const laptop = { cost: 120000_00, residual: 0, method: "slm", lifeMonths: 36, rate: 0, inUseDate: "2026-04-01" };
  it("spreads straight line evenly and stops at the end of its life", () => {
    const rows = depreciation(laptop, "2030-12");
    expect(rows).toHaveLength(36);
    expect(rows[0]).toMatchObject({ month: "2026-04", amount: 3333_33 });
    expect(rows.at(-1)).toMatchObject({ month: "2029-03", accumulated: 120000_00, bookValue: 0 });
  });
  it("counts the first month from the day it went into use", () => {
    const rows = depreciation({ ...laptop, inUseDate: "2026-04-16" }, "2026-05");
    // 15 of 30 days in April.
    expect(rows[0].amount).toBe(Math.round((120000_00 / 36) * (15 / 30)));
    expect(rows[1].amount).toBe(Math.round(120000_00 / 36));
  });
  it("keeps the residual value", () => {
    const rows = depreciation({ ...laptop, residual: 12000_00, lifeMonths: 12 }, "2028-01");
    expect(rows.at(-1)!.bookValue).toBe(12000_00);
  });
  it("applies written-down value to what's left", () => {
    const rows = depreciation({ cost: 100000_00, residual: 5000_00, method: "wdv", lifeMonths: 60, rate: 40, inUseDate: "2026-04-01" }, "2026-06");
    expect(rows[0].amount).toBe(Math.round((100000_00 * 0.4) / 12));
    expect(rows[1].amount).toBe(Math.round(((100000_00 - rows[0].amount) * 0.4) / 12));
  });
  it("doesn't depreciate land", () => {
    expect(depreciation({ ...laptop, method: "none" }, "2030-01")).toEqual([]);
  });
  it("works out a sale's gain or loss after depreciation to the day", () => {
    const d = disposal({ ...laptop, disposedOn: "2026-06-15" }, 100000_00);
    // April and May in full, half of June.
    expect(d.accumulated).toBe(Math.round(120000_00 / 36) * 2 + Math.round((120000_00 / 36) * (15 / 30)));
    expect(d.gain).toBe(100000_00 - (120000_00 - d.accumulated));
  });
});

describe("repeating and spread journals", () => {
  it("falls on the same day each period, capped at month end", () => {
    expect(occurrences({ startDate: "2026-01-31", endDate: null, every: "month" }, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences({ startDate: "2026-04-01", endDate: "2026-09-30", every: "quarter" }, "2027-12-31")).toEqual(["2026-04-01", "2026-07-01"]);
  });
  it("splits a total into months, the last taking the rounding", () => {
    const s = spread(100000, 3, "2026-04-10");
    expect(s.map((x) => x.amount)).toEqual([33333, 33333, 33334]);
    expect(s[0].date).toBe("2026-04-30");
  });
  it("counts months", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(monthsBetween("2026-04", "2027-03")).toBe(11);
  });
});

describe("cash flow", () => {
  it("adds up to the change in cash", () => {
    const accs = [
      { id: "bank", type: "asset", subtype: "bank", systemKey: "bank", name: "Bank" },
      { id: "ar", type: "asset", subtype: "receivable", systemKey: "ar", name: "Receivable" },
      { id: "fa", type: "asset", subtype: "fixed", systemKey: "fixed_assets", name: "Fixed assets" },
      { id: "dep", type: "asset", subtype: "fixed", systemKey: "acc_dep", name: "Accumulated depreciation" },
      { id: "loan", type: "liability", subtype: "other", systemKey: null, name: "Loans" },
      { id: "sales", type: "income", subtype: "other", systemKey: "sales", name: "Sales" },
      { id: "depx", type: "expense", subtype: "other", systemKey: "depreciation", name: "Depreciation" },
    ];
    // Sold 1000 (700 received), bought an asset for 500 with a 400 loan, depreciation 50.
    const open = new Map<string, number>();
    const close = new Map<string, number>([["bank", 700 - 500 + 400], ["ar", 300], ["fa", 500], ["dep", -50], ["loan", -400], ["sales", -1000], ["depx", 50]]);
    const cf = cashFlow(accs, open, close);
    expect(cf.profit).toBe(950);
    expect(cf.operating).toBe(950 + 50 - 300);
    expect(cf.investingTotal).toBe(-500);
    expect(cf.financingTotal).toBe(400);
    expect(cf.net).toBe(600);
    expect(cf.difference).toBe(0);
  });
});
