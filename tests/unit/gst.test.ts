import { describe, expect, it } from "vitest";
import { financialYear, orderTaxLines, rupeesInWords, splitTax, stateCode, validateGstin } from "@/lib/store/gst";

describe("GST helpers", () => {
  it("validates GSTINs including the check digit", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toEqual({ ok: true, gstin: "27AAPFU0939F1ZV", state: "Maharashtra" });
    expect(validateGstin(" 27aapfu0939f1zv ")).toMatchObject({ ok: true });
    expect(validateGstin("27AAPFU0939F1ZW")).toMatchObject({ ok: false, reason: expect.stringContaining("check digit") });
    expect(validateGstin("99AAPFU0939F1ZV")).toMatchObject({ ok: false, reason: expect.stringContaining("state code") });
    expect(validateGstin("ABC")).toMatchObject({ ok: false });
    expect(stateCode("karnataka")).toBe("29");
  });

  it("labels financial years from April", () => {
    expect(financialYear(new Date("2026-03-31T12:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-03-31T19:00:00Z"))).toBe("2026-27"); // 00:30 IST on 1 April
    expect(financialYear(new Date("2026-10-20T00:00:00Z"))).toBe("2026-27");
  });

  it("writes amounts in Indian words", () => {
    expect(rupeesInWords(0)).toBe("Zero Rupees Only");
    expect(rupeesInWords(149950)).toBe("One Thousand Four Hundred Ninety Nine Rupees and Fifty Paise Only");
    expect(rupeesInWords(12345678900)).toBe("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees Only");
  });

  it("recomputes per-line tax the same way checkout does", () => {
    const r = orderTaxLines(
      [
        { key: "a", title: "Shirt", hsn: "6205", quantity: 2, unitPrice: 105000, taxBps: 500 },
        { key: "b", title: "Bag", hsn: "4202", quantity: 1, unitPrice: 118000, taxBps: 1800 },
      ],
      { discountTotal: 32800, shippingTotal: 11800, taxTotal: 10000 + 16000 + 1800, taxIncluded: true },
    );
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(32800);
    for (const l of r.lines) expect(l.taxable + l.tax).toBe(l.unitPrice * l.quantity - l.discount);
    expect(r.shipping.tax + r.lines.reduce((a, l) => a + l.tax, 0)).toBe(27800);
    expect(splitTax(1001, true)).toEqual({ igst: 0, cgst: 500, sgst: 501 });
    expect(splitTax(1001, false)).toEqual({ igst: 1001, cgst: 0, sgst: 0 });
  });
});
