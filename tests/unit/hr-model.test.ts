import { describe, expect, it } from "vitest";
import { accrued, computePayslip, incomeTaxNewRegime, leaveDays, PT_STATES, settingsSchema, structure, workingDays } from "@/lib/hr/model";

const rules = settingsSchema.parse({}).payroll;

describe("HR rules", () => {
  it("counts working days without weekly offs and holidays", () => {
    // 1–7 Dec 2026: Tue–Mon; Sunday 6 is off, Friday 4 a holiday.
    expect(workingDays("2026-12-01", "2026-12-07", [1, 2, 3, 4, 5, 6], new Set(["2026-12-04"]))).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-05", "2026-12-07"]);
    expect(leaveDays("2026-12-02", "2026-12-02", "first", [1, 2, 3, 4, 5], new Set())).toBe(0.5);
    expect(leaveDays("2026-12-05", "2026-12-06", "none", [1, 2, 3, 4, 5], new Set())).toBe(0);
  });
  it("accrues leave yearly (pro-rated for joiners) or monthly", () => {
    expect(accrued({ quota: 12, accrual: "yearly" }, 2026, "2020-01-01", "2026-03-10")).toBe(12);
    expect(accrued({ quota: 12, accrual: "yearly" }, 2026, "2026-07-15", "2026-08-01")).toBe(6);
    expect(accrued({ quota: 12, accrual: "monthly" }, 2026, "2020-01-01", "2026-03-10")).toBe(3);
    expect(accrued({ quota: 15, accrual: "monthly" }, 2026, "2026-10-01", "2026-12-31")).toBe(4);
    expect(accrued({ quota: 0, accrual: "none" }, 2026, "2020-01-01", "2026-12-31")).toBe(0);
  });
  it("builds the structure from CTC with employer PF capped at ₹15,000 wages", () => {
    const s = structure(1200000_00, { ...rules });
    expect(s.monthlyCtc).toBe(100000_00);
    expect(s.basic).toBe(50000_00);
    expect(s.hra).toBe(20000_00);
    expect(s.employerPf).toBe(1800_00);
    expect(s.esiApplies).toBe(false);
    expect(s.gross).toBe(98200_00);
  });
  it("applies ESI below ₹21,000 gross, with the employer's share inside CTC", () => {
    const s = structure(240000_00, { ...rules });
    expect(s.esiApplies).toBe(true);
    expect(s.gross + s.employerPf + s.employerEsi).toBe(s.monthlyCtc);
  });
  it("estimates new-regime tax: nil to ₹12.75 lakh salary, marginal relief just above", () => {
    expect(incomeTaxNewRegime(1275000_00)).toBe(0);
    expect(incomeTaxNewRegime(1280000_00)).toBe(5200_00); // ₹5,000 over the limit + cess
    // ₹20 lakh salary: taxable ₹19.25 lakh → 20,000 + 40,000 + 60,000 + 65,000 = ₹1,85,000, plus 4% cess.
    expect(incomeTaxNewRegime(2000000_00)).toBe(Math.round(185000_00 * 1.04));
  });
  it("has Maharashtra professional tax with ₹300 in February", () => {
    expect(PT_STATES.MH.slab(9000_00, 5, "male")).toBe(175_00);
    expect(PT_STATES.MH.slab(30000_00, 2, "male")).toBe(300_00);
    expect(PT_STATES.MH.slab(20000_00, 5, "female")).toBe(0);
  });
  it("pro-rates a payslip for loss of pay and adds one-offs", () => {
    const full = computePayslip({ ctc: 600000_00, rules, overrides: {}, month: "2026-11", employedDays: 30, lopDays: 0, gender: "male", adjustments: [] });
    const lop = computePayslip({ ctc: 600000_00, rules, overrides: {}, month: "2026-11", employedDays: 30, lopDays: 3, gender: "male", adjustments: [{ label: "Diwali bonus", amount: 5000_00, kind: "earning" }, { label: "Travel claim", amount: 1200_00, kind: "reimbursement" }] });
    expect(full.days.paid).toBe(30);
    expect(lop.days.paid).toBe(27);
    const basic = (x: typeof full) => x.earnings.find((l) => l.code === "BASIC")!.amount;
    expect(basic(lop)).toBe(Math.round(basic(full) * 0.9));
    expect(lop.earnings.some((l) => l.label === "Diwali bonus")).toBe(true);
    expect(full.deductions.find((l) => l.code === "PF")!.amount).toBe(1800_00);
    expect(full.deductions.find((l) => l.code === "PT")!.amount).toBe(200_00);
    expect(full.deductions.some((l) => l.code === "TDS")).toBe(false); // ₹6 lakh a year
    expect(lop.net).toBe(lop.gross - lop.deductionsTotal + 1200_00);
  });
});
