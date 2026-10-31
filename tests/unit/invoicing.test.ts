import { describe, expect, it } from "vitest";
import { addPeriod, defaultTemplateConfig, displayStatus, docInputSchema, settingsSchema, templateConfigSchema, type Line } from "@/lib/invoicing/model";
import { renderDocument, type RenderDoc } from "@/lib/invoicing/render";
import { PREBUILT_TEMPLATES } from "@/lib/invoicing/templates";
import { computeDocTotals, isIntraState } from "@/lib/invoicing/totals";
import { amountInWords } from "@/lib/invoicing/words";

const line = (p: Partial<Line>): Line => ({ id: Math.random().toString(36).slice(2), itemId: null, name: "Item", description: "", hsn: "", quantity: 1, rate: 0, discount: null, taxBps: 0, unit: "", ...p });
const noAdj = { discount: null, charges: [], roundOff: false };

describe("document totals", () => {
  it("adds GST on top and splits CGST/SGST within the state", () => {
    const t = computeDocTotals({ lines: [line({ quantity: 2, rate: 50000, taxBps: 1800 }), line({ quantity: 1, rate: 100000, taxBps: 500 })], adjustments: noAdj, taxMode: "gst", inclusive: false, intraState: true, currency: "INR" });
    expect(t.subtotal).toBe(200000);
    expect(t.taxes).toEqual([
      { label: "CGST 2.5%", rateBps: 250, taxable: 100000, amount: 2500 },
      { label: "SGST 2.5%", rateBps: 250, taxable: 100000, amount: 2500 },
      { label: "CGST 9%", rateBps: 900, taxable: 100000, amount: 9000 },
      { label: "SGST 9%", rateBps: 900, taxable: 100000, amount: 9000 },
    ]);
    expect(t.total).toBe(223000);
  });

  it("uses IGST across states, and a custom tax name outside GST", () => {
    const l = [line({ rate: 100000, taxBps: 1800 })];
    expect(computeDocTotals({ lines: l, adjustments: noAdj, taxMode: "gst", inclusive: false, intraState: false, currency: "INR" }).taxes).toEqual([{ label: "IGST 18%", rateBps: 1800, taxable: 100000, amount: 18000 }]);
    expect(computeDocTotals({ lines: l, adjustments: noAdj, taxMode: "simple", inclusive: false, intraState: false, currency: "GBP", taxLabel: "VAT" }).taxes[0].label).toBe("VAT 18%");
    expect(computeDocTotals({ lines: l, adjustments: noAdj, taxMode: "none", inclusive: false, intraState: false, currency: "INR" })).toMatchObject({ tax: 0, total: 100000, taxes: [] });
  });

  it("takes tax out of inclusive prices without changing the total", () => {
    const t = computeDocTotals({ lines: [line({ rate: 118000, taxBps: 1800 })], adjustments: noAdj, taxMode: "gst", inclusive: true, intraState: false, currency: "INR" });
    expect(t).toMatchObject({ total: 118000, tax: 18000, taxable: 100000 });
  });

  it("applies line discounts, shares a document discount by value, taxes charges, and rounds off", () => {
    const t = computeDocTotals({
      lines: [line({ quantity: 3, rate: 33333, taxBps: 1800, discount: { kind: "percent", value: 10 } }), line({ quantity: 1, rate: 50000, taxBps: 1800 })],
      adjustments: { discount: { kind: "amount", value: 10000 }, charges: [{ label: "Shipping", amount: 5000, taxBps: 1800 }], roundOff: true },
      taxMode: "gst",
      inclusive: false,
      intraState: false,
      currency: "INR",
    });
    // 99999 − 10% (10000) = 89999; + 50000 = 139999; − 10000 shared ≈ 6429 / 3571.
    expect(t.lines.map((l) => l.discount)).toEqual([10000 + 6429, 3571]);
    expect(t.taxable).toBe(129999 + 5000);
    expect(t.tax).toBe(Math.round(83570 * 0.18) + Math.round(46429 * 0.18) + 900);
    const raw = 99999 + 50000 - 20000 + 5000 + t.tax;
    expect(t.total % 100).toBe(0);
    expect(t.total - raw).toBe(t.roundOff);
    expect(Math.abs(t.roundOff)).toBeLessThanOrEqual(50);
  });

  it("handles fractional quantities and zero-decimal currencies", () => {
    expect(computeDocTotals({ lines: [line({ quantity: 2.5, rate: 12000 })], adjustments: { ...noAdj, roundOff: true }, taxMode: "none", inclusive: false, intraState: false, currency: "JPY" }).total).toBe(30000);
  });

  it("works out intra-state supply from the business state", () => {
    expect(isIntraState("Karnataka", "karnataka")).toBe(true);
    expect(isIntraState("Karnataka", "Maharashtra")).toBe(false);
    expect(isIntraState("", "Goa")).toBe(false);
  });
});

it("writes amounts in words", () => {
  expect(amountInWords(12345678, "INR")).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only");
  expect(amountInWords(123456789, "USD")).toBe("One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Dollars and Eighty-Nine Cents Only");
  expect(amountInWords(500000, "JPY")).toBe("Five Hundred Thousand Yen Only");
});

describe("status and dates", () => {
  const d = { type: "invoice" as const, status: "sent" as const, total: 1000, amountPaid: 0, dueDate: "2026-10-01" };
  it("derives paid, part paid, overdue and expired", () => {
    expect(displayStatus(d, "2026-09-30")).toBe("sent");
    expect(displayStatus(d, "2026-10-02")).toBe("overdue");
    expect(displayStatus({ ...d, amountPaid: 400 }, "2026-09-30")).toBe("partial");
    expect(displayStatus({ ...d, amountPaid: 1000 }, "2026-12-30")).toBe("paid");
    expect(displayStatus({ ...d, type: "quote" }, "2026-10-02")).toBe("expired");
    expect(displayStatus({ ...d, status: "void" }, "2026-12-30")).toBe("void");
  });
  it("adds periods safely at month ends", () => {
    expect(addPeriod("2026-01-31", "month")).toBe("2026-02-28");
    expect(addPeriod("2026-11-30", "quarter")).toBe("2027-02-28");
    expect(addPeriod("2026-10-21", "week")).toBe("2026-10-28");
    expect(addPeriod("2028-02-29", "year")).toBe("2029-02-28");
  });
});

describe("schemas", () => {
  it("fill in every template option and settings default", () => {
    const c = defaultTemplateConfig();
    expect(c.labels.invoice).toBe("Tax Invoice");
    expect(c.table.columns.amount).toBe(true);
    expect(templateConfigSchema.parse({ labels: { total: "Grand total" } }).labels).toMatchObject({ total: "Grand total", billTo: "Bill to" });
    expect(settingsSchema.parse({}).numbering.invoice).toEqual({ prefix: "INV", next: 1, pad: 4, yearly: true });
  });
  it("reject bad input with clear messages", () => {
    const r = docInputSchema.safeParse({ type: "invoice", client: { name: "" }, issueDate: "21/10/2026", currency: "inr", lines: [], taxMode: "gst" });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(["Add the client's name", "Use a date like 2026-10-21", "Add at least one line"]));
  });
});

describe("rendering", () => {
  const doc: RenderDoc = {
    type: "invoice", number: "INV/2026-27/0007", status: "sent", title: "", issueDate: "2026-10-21", dueDate: "2026-11-05",
    client: { name: "Asha Rao", company: "Rao & Co <script>", email: "asha@rao.co", phone: "", gstin: "27AAPFU0939F1ZV", billing: { line1: "12 MG Road", line2: "", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN" }, shipping: null },
    lines: [line({ name: "Brand identity", hsn: "998391", rate: 4500000, taxBps: 1800 })],
    adjustments: noAdj, taxMode: "gst", inclusive: false, placeOfSupply: "Maharashtra", reference: "PO-88", notes: "Thank you", terms: "Pay within 15 days", footer: "", customFields: [{ label: "Project", value: "Rebrand" }], amountPaid: 0, currency: "INR",
  };
  const settings = { business: { ...settingsSchema.parse({}).business, name: "Studio North", gstin: "29ABCDE1234F1Z5", address: { line1: "1 Lavelle Rd", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" } }, payment: { ...settingsSchema.parse({}).payment, upiId: "studio@upi", accountNumber: "1234567890", ifsc: "HDFC0000001" }, taxLabel: "Tax" };

  it("draws every prebuilt template with escaped text, IGST, UPI and paper size", () => {
    for (const t of PREBUILT_TEMPLATES) {
      const { html, totals } = renderDocument({ doc, settings, template: t.config });
      expect(totals.total).toBe(5310000);
      expect(html).toContain("INV/2026-27/0007");
      expect(html).toContain("Rao &amp; Co &lt;script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).toContain("IGST 18%");
      expect(html).toContain("Scan to pay");
      expect(html).toContain("@page { size: 210mm 297mm");
      expect(html).toContain(`layout-${t.config.layout}`);
      expect(html).toContain("Fifty Three Thousand One Hundred Rupees Only");
    }
  });

  it("follows the template's choices", () => {
    const t = defaultTemplateConfig();
    t.show.upiQr = false;
    t.show.taxSummary = false;
    t.labels.total = "Amount payable";
    t.paper = "Letter";
    const { html } = renderDocument({ doc: { ...doc, status: "paid", amountPaid: 5310000 }, settings, template: t });
    expect(html).not.toContain("Scan to pay");
    expect(html).not.toContain('class="hsn"');
    expect(html).toContain("Amount payable");
    expect(html).toContain("215.9mm 279.4mm");
    expect(html).toContain('class="stamp">PAID');
  });

  it("marks drafts and quotes clearly", () => {
    const { html } = renderDocument({ doc: { ...doc, type: "quote", status: "draft", number: "" }, settings, template: defaultTemplateConfig() });
    expect(html).toContain('class="watermark">DRAFT');
    expect(html).toContain("Valid until");
    expect(html).not.toContain("Scan to pay");
  });
});
