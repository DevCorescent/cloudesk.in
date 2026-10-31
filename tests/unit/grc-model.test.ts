import { describe, expect, it } from "vitest";
import { emissions, DEFAULT_FACTORS, heat, INDIA_PACK, nextTest, occurrences, rating, roleConflicts, roundBills, score, settingsSchema, sharedSupplierAccounts, splitBills, supplierEmployeeMatches, supplierPan } from "@/lib/grc/model";

describe("risks and controls", () => {
  it("scores and rates risks on the 5×5 scale and places them on the heat map", () => {
    expect([score(1, 4), score(3, 3), score(4, 4), score(5, 4)].map(rating)).toEqual(["low", "medium", "high", "critical"]);
    const g = heat([{ likelihood: 5, impact: 5 }, { likelihood: 1, impact: 1 }, { likelihood: 1, impact: 1 }]);
    expect(g[0][4]).toBe(1);
    expect(g[4][0]).toBe(2);
  });
  it("works out the next test date, keeping month ends sensible", () => {
    expect(nextTest("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextTest("2026-10-15", "quarterly")).toBe("2027-01-15");
    expect(nextTest("2026-08-31", "half_yearly")).toBe("2027-02-28");
    expect(nextTest("2026-10-15", "adhoc")).toBeNull();
  });
});

describe("the compliance calendar", () => {
  const pack = (k: string) => INDIA_PACK.find((p) => p.key === k)!.recurrence;
  it("puts a month's return in the following month", () => {
    expect(occurrences(pack("gstr3b"), "2026-10-01", "2026-12-31")).toEqual([
      { period: "2026-09", label: "Sept 2026", due: "2026-10-20" },
      { period: "2026-10", label: "Oct 2026", due: "2026-11-20" },
      { period: "2026-11", label: "Nov 2026", due: "2026-12-20" },
    ].map((x) => ({ ...x, label: expect.stringMatching(/2026$/) as unknown as string })));
  });
  it("gives March TDS until 30 April, and crosses the year end", () => {
    expect(occurrences(pack("tds_pay"), "2027-03-01", "2027-05-31").map((o) => [o.period, o.due])).toEqual([["2027-02", "2027-03-07"], ["2027-03", "2027-04-30"], ["2027-04", "2027-05-07"]]);
    expect(occurrences(pack("gstr1"), "2026-12-01", "2027-01-31").map((o) => o.due)).toEqual(["2026-12-11", "2027-01-11"]);
  });
  it("handles fixed dates each year and one-offs", () => {
    expect(occurrences(pack("advance_tax"), "2026-10-01", "2027-06-30").map((o) => o.due)).toEqual(["2026-12-15", "2027-03-15", "2027-06-15"]);
    expect(occurrences({ freq: "once", date: "2026-11-05" }, "2026-11-01", "2026-11-30")).toHaveLength(1);
    expect(occurrences({ freq: "monthly", day: 31, nextMonth: false, marchOverride: null }, "2027-02-01", "2027-02-28")[0].due).toBe("2027-02-28");
  });
});

describe("duties and fraud indicators", () => {
  it("finds members holding both sides of a duty", () => {
    const perms: Record<string, string[]> = { admin: ["inventory:write", "accounts:write"], editor: ["inventory:write"], billing: ["accounts:write"] };
    const r = roleConflicts([{ id: "1", name: "Ana", role: "admin" }, { id: "2", name: "Ed", role: "editor" }, { id: "3", name: "Bo", role: "billing" }], (role, p) => perms[role]?.includes(p) ?? false);
    expect(r.map((x) => [x.key, x.members.map((m) => m.name)])).toEqual([["buy_pay", ["Ana"]]]);
  });
  it("spots suppliers paid into staff accounts or with a staff PAN, and shared accounts", () => {
    expect(supplierPan({ pan: "", gstin: "27aaacs1234k1zh".toUpperCase() })).toBe("AAACS1234K");
    const s = [{ id: "s1", name: "Quick Supplies", pan: "", gstin: "27ABCDE1234F1Z5", account: "0012 3456 7890" }, { id: "s2", name: "Other", pan: "", gstin: "", account: "001234567890" }];
    const hits = supplierEmployeeMatches(s, [{ id: "e1", name: "Ravi", pan: "abcde1234f", account: "001234567890" }]);
    expect(hits.map((h) => h.kind).sort()).toEqual(["supplier_employee_bank", "supplier_employee_bank", "supplier_employee_pan"]);
    expect(sharedSupplierAccounts(s)[0].detail).toBe("Quick Supplies, Other all use the account ending 7890.");
  });
  it("flags bills split under a limit, and round sums", () => {
    const b = [{ id: "1", supplier: "A", date: "2026-10-01", total: 60000_00 }, { id: "2", supplier: "a", date: "2026-10-01", total: 45000_00 }, { id: "3", supplier: "A", date: "2026-10-02", total: 90000_00 }];
    expect(splitBills(b, 100000_00).map((x) => x.title)).toEqual(["2 bills from A on 2026-10-01"]);
    expect(roundBills([{ id: "1", supplier: "A", number: "B-1", total: 150000_00 }, { id: "2", supplier: "A", number: "B-2", total: 150000_50 }, { id: "3", supplier: "A", number: "B-3", total: 40000_00 }]).map((x) => x.detail)).toEqual(["B-1 is exactly ₹1,50,000."]);
  });
});

describe("emissions", () => {
  it("adds scope 1 fuels and scope 2 electricity by month", () => {
    const f = settingsSchema.parse({}).factors;
    expect(f).toEqual(DEFAULT_FACTORS);
    expect(emissions([{ month: "2026-10", metric: "diesel_l", quantity: 100 }, { month: "2026-10", metric: "electricity_kwh", quantity: 1000 }, { month: "2026-09", metric: "petrol_l", quantity: 10 }], f)).toEqual([{ month: "2026-09", scope1: 23, scope2: 0, total: 23 }, { month: "2026-10", scope1: 268, scope2: 716, total: 984 }]);
  });
});
