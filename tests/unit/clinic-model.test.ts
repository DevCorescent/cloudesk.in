import { describe, expect, it } from "vitest";
import { age, billTotal, bmi, flags, perDay, visitSchema } from "@/lib/clinic/model";

describe("clinic", () => {
  it("works out BMI with its band, and flags readings", () => {
    expect(bmi(70, 175)).toEqual({ value: 22.9, band: "normal" });
    expect(bmi(95, 170)).toEqual({ value: 32.9, band: "obese" });
    expect(bmi(null, 170)).toBeNull();
    expect(flags({ systolic: 150, diastolic: 95, pulse: 110, tempC: 38.4, spo2: 92, weightKg: null, heightCm: null })).toEqual(["High blood pressure", "Low oxygen saturation", "Fever", "Fast pulse"]);
    expect(flags({ systolic: 120, diastolic: 80, pulse: 72, tempC: 36.8, spo2: 98, weightKg: null, heightCm: null })).toEqual([]);
  });
  it("reads doses and ages", () => {
    expect([perDay("1-0-1"), perDay("0.5-0-0.5"), perDay("TDS"), perDay("as needed")]).toEqual([2, 1, 3, null]);
    expect(age({ dob: "1990-10-26", ageYears: null }, "2026-10-25")).toBe(35);
    expect(age({ dob: "1990-10-25", ageYears: null }, "2026-10-25")).toBe(36);
    expect(age({ dob: null, ageYears: 40 }, "2026-10-25")).toBe(40);
  });
  it("checks ICD-10 codes and totals bills", () => {
    const base = { patientId: "7b1c1c55-8d0e-4c43-9c39-1d2f6d6c1e10" };
    expect(visitSchema.safeParse({ ...base, icd10: "j06.9" }).data?.icd10).toBe("J06.9");
    expect(visitSchema.safeParse({ ...base, icd10: "fever" }).success).toBe(false);
    expect(billTotal([{ qty: 1, rate: 500_00 }, { qty: 2, rate: 150_00 }], 100_00)).toBe(700_00);
  });
});
