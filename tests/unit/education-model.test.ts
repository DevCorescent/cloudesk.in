import { describe, expect, it } from "vitest";
import { academicYear, attendancePct, feeFor, grade, planSchema, reportCard, settingsSchema, splitInstalments } from "@/lib/education/model";

const s = settingsSchema.parse({});

describe("fees", () => {
  it("applies a concession only to heads that allow it, and splits into instalments that add up", () => {
    const plan = { heads: [{ name: "Tuition", amount: 60000_00, concession: true }, { name: "Transport", amount: 18000_00, concession: false }] };
    expect(feeFor(plan, 0)).toBe(78000_00);
    expect(feeFor(plan, 25)).toBe(45000_00 + 18000_00);
    const parts = splitInstalments(10000_01, [{ label: "Term 1", dueDate: "2026-06-10", pct: 33.33 }, { label: "Term 2", dueDate: "2026-10-10", pct: 33.33 }, { label: "Term 3", dueDate: "2027-01-10", pct: 33.34 }]);
    expect(parts.reduce((n, p) => n + p.amount, 0)).toBe(10000_01);
    expect(parts.map((p) => p.amount)).toEqual([333300, 333300, 333401]);
  });
  it("refuses instalments that don't add up to 100%", () => {
    const base = { name: "Annual", year: "2026-27", classIds: ["7b1c1c55-8d0e-4c43-9c39-1d2f6d6c1e10"], heads: [{ name: "Tuition", amount: 1000 }] };
    expect(planSchema.safeParse({ ...base, installments: [{ label: "A", dueDate: "2026-06-01", pct: 50 }, { label: "B", dueDate: "2026-12-01", pct: 40 }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, installments: [{ label: "A", dueDate: "2026-06-01", pct: 50 }, { label: "B", dueDate: "2026-12-01", pct: 50 }] }).success).toBe(true);
  });
});

describe("marks and attendance", () => {
  it("grades on the CBSE-style scale and makes a report card", () => {
    expect([95, 81, 70, 33, 32.9].map((p) => grade(p, s.grades))).toEqual(["A1", "A2", "B2", "D", "E"]);
    const r = reportCard([{ name: "Maths", max: 100 }, { name: "Science", max: 80 }], { Maths: 92, Science: 24 }, s);
    expect(r.rows.map((x) => [x.subject, x.pct, x.grade, x.passed])).toEqual([["Maths", 92, "A1", true], ["Science", 30, "E", false]]);
    expect(r).toMatchObject({ total: 116, max: 180, pct: 64.4, grade: "B2", result: "fail" });
    expect(reportCard([{ name: "Maths", max: 100 }, { name: "Art", max: 50 }], { Maths: 50 }, s).result).toBe("incomplete");
  });
  it("counts late as attended and leave as excused", () => {
    expect(attendancePct(["present", "late", "absent", "leave"])).toBe(66.7);
    expect(attendancePct(["leave"])).toBeNull();
  });
  it("knows the academic year", () => {
    expect(academicYear("2026-06-01", 6)).toBe("2026-27");
    expect(academicYear("2027-03-31", 6)).toBe("2026-27");
    expect(academicYear("2027-04-01", 4)).toBe("2027-28");
  });
});
