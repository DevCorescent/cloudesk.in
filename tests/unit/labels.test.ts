import { describe, expect, it } from "vitest";
import { storeEan13 } from "@/lib/store/barcode";
import { buildLabelDocument, LABEL_STOCKS, type LabelFields, type LabelItem } from "@/lib/store/labels";

const all: LabelFields = { shop: true, name: true, price: true, mrp: true, barcode: true, qr: true };
const item = (i: number, extra: Partial<LabelItem> = {}): LabelItem => ({ key: String(i), title: `Item ${i}`, variant: "", price: 49900, compareAt: null, barcode: storeEan13(1234, i), slug: `item-${i}`, variantId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, ...extra });
const stock = (id: string) => LABEL_STOCKS.find((s) => s.id === id)!;
const build = (id: string, items: LabelItem[], more: Partial<Parameters<typeof buildLabelDocument>[0]> = {}) =>
  buildLabelDocument({ stock: stock(id), items, fields: all, currency: "INR", shopName: "Corner Shop", siteUrl: "https://example.com/s/a/b", ...more });

describe("label sheets", () => {
  it("fit on the page they are printed on", () => {
    for (const s of LABEL_STOCKS) {
      const right = s.left + s.cols * s.w + (s.cols - 1) * s.gapX;
      const bottom = s.top + s.rows * s.h + (s.rows - 1) * s.gapY;
      expect(s.left, s.id).toBeGreaterThanOrEqual(0);
      expect(right, s.id).toBeLessThanOrEqual(s.pageW + 0.01);
      expect(bottom, s.id).toBeLessThanOrEqual(s.pageH + 0.01);
    }
  });

  it("sets the printer page to the stock, one row of a roll per page", () => {
    const t = build("t-50x25", [item(1), item(2), item(3)]);
    expect(t.html).toContain("@page{size:50mm 25mm;margin:0}");
    expect(t.pages).toBe(3);
    expect(t.html.match(/class="page"/g)).toHaveLength(3);
    const two = build("t2-38x25", [item(1), item(2), item(3)]);
    expect(two.html).toContain("@page{size:80mm 25mm;margin:0}");
    expect(two.pages).toBe(2);
  });

  it("fills A4 sheets in order, skipping used positions on the first sheet", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1));
    const d = build("a4-24", items, { skip: 3 });
    expect(d.html).toContain("@page{size:210mm 297mm;margin:0}");
    expect(d.pages).toBe(2); // 3 skipped + 30 = 33 positions
    const first = /<section class="page">(.*?)<\/section>/.exec(d.html)![1];
    const cells = first.split('class="label"').slice(1);
    expect(cells).toHaveLength(24);
    expect(cells.slice(0, 3).every((c) => !c.includes("Item"))).toBe(true);
    expect(cells[3]).toContain("Item 1<");
    // Position 4 is the first cell of row 2 on a 3-across sheet.
    expect(cells[3]).toMatch(new RegExp(`left:${stock("a4-24").left}mm;top:${Math.round((stock("a4-24").top + 33.9) * 100) / 100}mm`));
  });

  it("previews only the pages asked for but counts them all", () => {
    const d = build("t-50x25", [item(1), item(2), item(3)], { maxPages: 1, zoom: 2 });
    expect(d.pages).toBe(3);
    expect(d.html.match(/class="page"/g)).toHaveLength(1);
    expect(d.html).toContain("@media screen{body{zoom:2}}");
  });

  it("escapes product text and shows MRP only when it is higher", () => {
    const d = build("t-50x25", [item(1, { title: `<img src=x onerror=alert(1)> "Mug"`, compareAt: 59900 }), item(2, { compareAt: 100 })]);
    expect(d.html).not.toContain("<img");
    expect(d.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Mug&quot;");
    expect(d.html).toContain("MRP ₹599");
    expect(d.html.match(/MRP /g)).toHaveLength(1);
  });

  it("warns honestly about what won't scan or print", () => {
    expect(build("t-50x25", [item(1)], { siteUrl: null }).warnings).toContain("QR codes are left off until the site is published.");
    expect(build("a4-65", [item(1)]).warnings.join(" ")).toMatch(/hard to scan/);
    expect(build("t-38x25", [item(1, { barcode: "LONG-SKU-CODE-12345" })]).warnings.join(" ")).toMatch(/too long to scan reliably/);
    expect(build("t-50x25", [item(1, { barcode: "" })]).warnings.join(" ")).toMatch(/no barcode yet/);
    expect(build("t-50x25", [item(1)]).warnings).toEqual([]);
  });
});
