import { describe, expect, it } from "vitest";
import { mbQty, progress, raBill } from "@/lib/construction/model";

describe("construction", () => {
  it("measures by numbers × dimensions taken, or a quantity given", () => {
    expect(mbQty({ nos: 2, length: 10, breadth: 0.23, depth: 3, qty: null })).toBe(13.8);
    expect(mbQty({ nos: 4, length: 12.5, breadth: null, depth: null, qty: null })).toBe(50);
    expect(mbQty({ nos: 1, length: null, breadth: null, depth: null, qty: -2.5 })).toBe(-2.5);
  });

  it("bills work to date less what was billed, with retention, advance recovery, GST and TDS", () => {
    const items = [{ id: "a", code: "2.1", description: "PCC 1:4:8", unit: "cum", qty: 100, rate: 5000_00 }, { id: "b", code: "5.3", description: "Brickwork", unit: "cum", qty: 200, rate: 6500_00 }, { id: "c", code: "9.9", description: "Not started", unit: "sqm", qty: 50, rate: 100_00 }];
    const r = raBill(items, { a: 60, b: 40 }, { a: 20 }, { retentionPct: 5, advancePct: 10, gstRate: 18, tdsPct: 2, interState: false }, 50000_00);
    expect(r.lines.map((l) => [l.code, l.prev, l.qty, l.amount])).toEqual([["2.1", 20, 40, 200000_00], ["5.3", 0, 40, 260000_00]]);
    expect(r).toMatchObject({ gross: 460000_00, retention: 23000_00, advance: 46000_00, gst: 82800_00, tds: 9200_00, cgst: 41400_00, sgst: 41400_00, igst: 0 });
    expect(r.net).toBe(460000_00 + 82800_00 - 23000_00 - 46000_00 - 9200_00);
    // Recovery never takes more advance than is left.
    expect(raBill(items, { a: 60 }, {}, { retentionPct: 0, advancePct: 10, gstRate: 0, tdsPct: 0, interState: true }, 5000_00).advance).toBe(5000_00);
    expect(raBill(items, { a: 150 }, {}, { retentionPct: 0, advancePct: 0, gstRate: 0, tdsPct: 0, interState: true }, 0).lines[0].excess).toBe(true);
    expect(progress(460000_00, 1805000_00)).toBe(25.5);
  });
});
