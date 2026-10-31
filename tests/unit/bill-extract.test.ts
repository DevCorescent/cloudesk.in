import { describe, expect, it } from "vitest";
import { toDraft, type Extracted } from "@/lib/accounting/extract";

// Turning what the model read from a bill into a draft: supplier by GSTIN or
// name, accounts by code (or the supplier's last), GST across states, and
// warnings when the figures don't add up.
const KA = "29ABCDE1234F1ZW";
const MH = "27AAACS1234K1ZH";
const base: Extracted = { isBill: true, supplierName: "Sharma Packaging Pvt. Ltd.", supplierGstin: MH, billNo: "SP/1042", date: "2026-10-20", dueDate: "2026-11-19", currency: "INR", lines: [{ description: "Corrugated boxes", amount: 10000, gstRate: 18, accountCode: "5260" }], taxTotal: 1800, total: 11800 };
const ctx = { suppliers: [{ id: "s1", name: "Sharma Packaging", gstin: "", state: "MH" }, { id: "s2", name: "Bright Lights", gstin: KA, state: "" }], accounts: [{ id: "a-office", code: "5260", name: "Office supplies" }, { id: "a-rent", code: "5200", name: "Rent" }], homeState: "MH", today: "2026-10-25" };

describe("a bill read into a draft", () => {
  it("matches the supplier by name, puts lines to accounts, and keeps GST inside the state", () => {
    const { draft, warnings } = toDraft(base, ctx);
    expect(draft).toEqual({ supplierId: "s1", supplierName: "Sharma Packaging", supplierGstin: MH, billNo: "SP/1042", date: "2026-10-20", dueDate: "2026-11-19", currency: "INR", interState: false, lines: [{ accountId: "a-office", description: "Corrugated boxes", amount: 10000_00, gstRate: 18 }] });
    expect(warnings).toEqual([]);
  });

  it("matches by GSTIN first, and works out an inter-state bill from it", () => {
    const { draft } = toDraft({ ...base, supplierName: "BRIGHT LIGHTS & CO", supplierGstin: KA, lines: [{ description: "LED panels", amount: 5000, gstRate: 18, accountCode: "" }], taxTotal: 900, total: 5900 }, { ...ctx, fallbackAccountId: (id) => (id === "s2" ? "a-rent" : null) });
    expect(draft).toMatchObject({ supplierId: "s2", supplierName: "Bright Lights", interState: true, lines: [{ accountId: "a-rent" }] });
  });

  it("warns when the figures don't add up, the GSTIN is wrong, or the rate isn't a GST rate", () => {
    const { draft, warnings } = toDraft({ ...base, supplierName: "New Vendor", supplierGstin: "27AAACS1234K1ZX", lines: [{ description: "Thing", amount: 1000, gstRate: 17, accountCode: "9999" }], taxTotal: 170, total: 1500, date: "20/10/2026" }, ctx);
    expect(draft).toMatchObject({ supplierId: null, supplierName: "New Vendor", date: "2026-10-25", lines: [{ accountId: null, gstRate: 0 }] });
    expect(warnings.join("\n")).toMatch(/GSTIN .* doesn't check out: The GSTIN check digit is wrong/);
    expect(warnings.join("\n")).toMatch(/“New Vendor” isn't one of your suppliers yet/);
    expect(warnings.join("\n")).toMatch(/17% on “Thing” isn't a standard rate/);
    expect(warnings.join("\n")).toMatch(/Pick an account for each line/);
    expect(warnings.join("\n")).toMatch(/GST worked out from the lines \(0\.00\) differs from the bill's GST \(170\.00\)/);
    expect(warnings.join("\n")).toMatch(/come to 1000\.00, but the bill's total is 1500\.00/);
    expect(warnings.join("\n")).toMatch(/date couldn't be read/);
  });

  it("allows a rupee of rounding per line, and flags something that isn't a bill", () => {
    const { warnings } = toDraft({ ...base, total: 11800.6 }, ctx);
    expect(warnings).toEqual([]);
    expect(toDraft({ ...base, isBill: false }, ctx).warnings[0]).toMatch(/doesn't look like a bill/);
  });

  it("drops a due date before the bill date, and keeps a foreign bill out of IGST", () => {
    const { draft } = toDraft({ ...base, dueDate: "2026-10-01", currency: "usd", supplierGstin: "", supplierName: "Acme Inc" }, { ...ctx, homeState: "KA" });
    expect(draft).toMatchObject({ dueDate: null, currency: "USD", interState: false });
  });
});
