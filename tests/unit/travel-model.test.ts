import { describe, expect, it } from "vitest";
import { cardFingerprint, mileageAmount, perDiemFor, policyCheck, settingsSchema, tripBalance, tripDays } from "@/lib/hr/model";

const policy = settingsSchema.parse({ expenses: { limits: [{ category: "Food", perClaim: 1500_00, perDay: 2000_00, receiptAbove: 500_00 }], mileage: { car: 12_00, bike: 5_00 }, perDiem: { domestic: 1000_00, international: 4000_00 } } }).expenses;

describe("expense policy", () => {
  it("flags claims over the limit, over the day, or without a receipt", () => {
    expect(policyCheck({ category: "Food", amount: 400_00, receiptUrl: "" }, policy)).toEqual([]);
    expect(policyCheck({ category: "food", amount: 1800_00, receiptUrl: "https://r.example/1" }, policy).map((f) => f.code)).toEqual(["over_limit"]);
    const day = policyCheck({ category: "Food", amount: 900_00, receiptUrl: "" }, policy, 1200_00);
    expect(day.map((f) => f.code)).toEqual(["over_daily", "no_receipt"]);
    expect(day[0].message).toBe("₹2,100 on Food that day, over the ₹2,000 daily limit");
    expect(policyCheck({ category: "Travel", amount: 99999_00, receiptUrl: "" }, policy)).toEqual([]);
  });

  it("works out mileage and per diem", () => {
    expect(mileageAmount(42.5, "car", policy)).toBe(510_00);
    expect(mileageAmount(10, "bike", policy)).toBe(50_00);
    expect(tripDays("2026-11-02", "2026-11-04")).toBe(3);
    expect(perDiemFor({ departOn: "2026-11-02", returnOn: "2026-11-04", international: false }, policy)).toBe(3000_00);
    expect(perDiemFor({ departOn: "2026-11-02", returnOn: "2026-11-02", international: true }, policy)).toBe(4000_00);
  });

  it("settles a trip against its advance, and recognises the same card line", () => {
    expect(tripBalance(10000_00, 12500_00).net).toBe(2500_00);
    expect(tripBalance(10000_00, 7000_00).net).toBe(-3000_00);
    expect(cardFingerprint({ date: "2026-11-02", amount: 100, merchant: " Uber  India ", reference: "" })).toBe(cardFingerprint({ date: "2026-11-02", amount: 100, merchant: "uber india", reference: "" }));
  });
});
