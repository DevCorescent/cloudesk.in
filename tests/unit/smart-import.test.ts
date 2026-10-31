import { describe, expect, it } from "vitest";
import { analyse, extractImages, findHeaderRow, isReady, parseDelimited, parseMoney, parseStock, parseWeightGrams, pickSheet } from "@/lib/store/import";

const fields = (r: ReturnType<typeof analyse>) => Object.fromEntries(r.headers.map((h, i) => [h, r.mapping[i].field + (r.mapping[i].option ? `:${r.mapping[i].option}` : "")]));

describe("money, stock, weight and images", () => {
  it("reads prices written many ways", () => {
    expect(parseMoney("₹1,299.00")).toBe(129900);
    expect(parseMoney("Rs. 499/-")).toBe(49900);
    expect(parseMoney("1.299,50 €")).toBe(129950);
    expect(parseMoney("1 299,50")).toBe(129950);
    expect(parseMoney("$12")).toBe(1200);
    expect(parseMoney("1,00,000")).toBe(10000000); // Indian grouping
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney(799)).toBe(79900);
    expect(parseMoney("1.234.567")).toBe(123456700);
    expect(parseMoney("₹ 1.200")).toBe(120000);
    expect(parseMoney("12.500,00 €")).toBe(1250000);
    expect(parseMoney("¥1200", 0)).toBe(1200);
    expect(parseMoney("free")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("reads stock and weight", () => {
    expect(parseStock("12 pcs")).toBe(12);
    expect(parseStock("Out of stock")).toBe(0);
    expect(parseStock("In stock")).toBeNull();
    expect(parseStock(7.6)).toBe(8);
    expect(parseWeightGrams("1.2 kg", "Weight")).toBe(1200);
    expect(parseWeightGrams(0.5, "Weight (kg)")).toBe(500);
    expect(parseWeightGrams("250", "Weight (g)")).toBe(250);
  });
  it("finds image links, including Google Drive and several per cell", () => {
    expect(extractImages("https://cdn.shop.com/a.jpg, https://cdn.shop.com/b.png | http://x.com/c.webp")).toEqual(["https://cdn.shop.com/a.jpg", "https://cdn.shop.com/b.png", "https://x.com/c.webp"]);
    expect(extractImages("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing")).toEqual(["https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz123&sz=w1600"]);
  });
});

describe("column detection", () => {
  it("handles a Shopify export with variants and image-only rows", () => {
    const csv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Status
linen-shirt,Linen Shirt,"<p>Breathable linen for hot days, cut for an easy fit.</p>",Loom,Shirts,"summer, linen",Size,S,LS-S,4,1499,1999,https://cdn.shopify.com/s/files/a.jpg,active
linen-shirt,,,,,,,M,LS-M,6,1499,1999,https://cdn.shopify.com/s/files/b.jpg,
linen-shirt,,,,,,,L,LS-L,0,1599,1999,,
linen-shirt,,,,,,,,,,,,https://cdn.shopify.com/s/files/c.jpg,
canvas-tote,Canvas Tote,Sturdy cotton canvas tote bag with inner pocket.,Loom,Bags,,Title,Default Title,CT-1,20,699,,https://cdn.shopify.com/s/files/t.jpg,draft`;
    const r = analyse(parseDelimited(csv));
    expect(fields(r)).toMatchObject({ Handle: "group", Title: "title", "Body (HTML)": "description", Vendor: "vendor", Type: "category", Tags: "tags", "Option1 Value": "option:Size", "Variant SKU": "sku", "Variant Inventory Qty": "stock", "Variant Price": "price", "Variant Compare At Price": "compareAt", "Image Src": "images", Status: "status" });
    const [shirt, tote] = r.products;
    expect(shirt).toMatchObject({ title: "Linen Shirt", category: "Shirts", vendor: "Loom", tags: ["summer", "linen"], options: [{ name: "Size", values: ["S", "M", "L"] }] });
    expect(shirt.description).toBe("Breathable linen for hot days, cut for an easy fit.");
    expect(shirt.images).toHaveLength(3);
    expect(shirt.variants.map((v) => [v.options.Size, v.price, v.compareAt, v.stock, v.sku])).toEqual([["S", 149900, 199900, 4, "LS-S"], ["M", 149900, 199900, 6, "LS-M"], ["L", 159900, 199900, 0, "LS-L"]]);
    expect(tote).toMatchObject({ title: "Canvas Tote", active: false, options: [] });
    expect(r.products.every(isReady)).toBe(true);
  });

  it("handles a hand-made Indian seller sheet with a title row, MRP and selling price", () => {
    const grid = [
      ["Saree Collection — Diwali 2026"],
      [],
      ["S.No", "Product Name", "Colour", "MRP (₹)", "Selling Price", "Qty", "Fabric", "Photo"],
      [1, "Banarasi Silk Saree", "Red", "₹ 8,999", "₹ 6,499", 3, "Silk", "https://images.example.com/sarees/red.jpg"],
      [2, "Banarasi Silk Saree", "Green", "₹ 8,999", "₹ 6,499", 2, "Silk", "https://images.example.com/sarees/green.jpg"],
      [3, "Cotton Kurta", "", "1299", "", "", "", ""],
    ];
    expect(findHeaderRow(grid)).toBe(2);
    const r = analyse(grid);
    expect(fields(r)).toMatchObject({ "Product Name": "title", Colour: "option:Colour", "MRP (₹)": "compareAt", "Selling Price": "price", Qty: "stock", Photo: "images" });
    const [saree, kurta] = r.products;
    expect(saree.options).toEqual([{ name: "Colour", values: ["Red", "Green"] }]);
    expect(saree.variants.map((v) => [v.price, v.compareAt])).toEqual([[649900, 899900], [649900, 899900]]);
    expect(isReady(saree)).toBe(true);
    // Missing price is flagged as required; other gaps are suggestions.
    expect(kurta.issues.map((i) => `${i.field}:${i.level}`)).toEqual(["price:required", "images:recommended", "description:recommended", "stock:recommended", "category:recommended"]);
    expect(isReady(kurta)).toBe(false);
  });

  it("recognises columns by their values when the headings are unhelpful", () => {
    const grid = [
      ["A", "B", "C", "D"],
      ["Brass lamp", "₹2,450", "https://cdn.example.com/lamp.jpg", "A hand-cast brass table lamp with a linen shade, made in Moradabad by third-generation artisans."],
      ["Clay vase", "₹890", "https://cdn.example.com/vase.png", "Wheel-thrown terracotta vase finished with a matte glaze; every piece is slightly different."],
    ];
    const r = analyse(grid, {});
    // Header row detection treats A/B/C/D as headings (letters, no numbers).
    expect(r.mapping.map((m) => m.field)).toEqual(["ignore", "price", "images", "description"]);
  });

  it("uses MRP as the price when it's the only price, and drops fake discounts", () => {
    const r = analyse([["Item", "MRP", "Sale Price"], ["Mug", "500", "450"], ["Plate", "300", "350"]]);
    expect(r.products[0].variants[0]).toMatchObject({ price: 45000, compareAt: 50000 });
    expect(r.products[1].variants[0]).toMatchObject({ price: 35000, compareAt: null });
    const only = analyse([["Item", "MRP"], ["Mug", "500"]]);
    expect(only.products[0].variants[0].price).toBe(50000);
  });

  it("reads WooCommerce, European semicolon CSVs and TSV", () => {
    const woo = analyse(parseDelimited(`ID,Type,SKU,Name,Published,Short description,Regular price,Sale price,Categories,Images,Stock\n10,simple,WC-1,Beanie,1,Warm knitted beanie for winter.,20,18,Clothing > Accessories,"https://shop.example/wp-content/uploads/beanie.jpg, https://shop.example/wp-content/uploads/beanie-2.jpg",15`));
    expect(woo.products[0]).toMatchObject({ title: "Beanie", category: "Accessories", images: ["https://shop.example/wp-content/uploads/beanie.jpg", "https://shop.example/wp-content/uploads/beanie-2.jpg"] });
    expect(woo.products[0].variants[0]).toMatchObject({ price: 1800, compareAt: 2000, stock: 15, sku: "WC-1" });
    const eu = analyse(parseDelimited(`Produktname;Preis;Bestand\nTasse;12,90 €;5`));
    expect(eu.products[0]).toMatchObject({ title: "Tasse" });
    expect(eu.products[0].variants[0].price).toBe(1290);
    const tsv = analyse(parseDelimited(`name\tprice\tsize\nTee\t499\tM\nTee\t499\tL`));
    expect(tsv.products[0].options).toEqual([{ name: "Size", values: ["M", "L"] }]);
  });

  it("picks the product sheet in a workbook", () => {
    const best = pickSheet([
      { name: "Instructions", grid: [["Read me"], ["Fill the Products sheet"]] },
      { name: "Products", grid: [["Product name", "Price"], ["Candle", "₹399"]] },
    ]);
    expect(best.name).toBe("Products");
  });
});

describe("real spreadsheet files", () => {
  it("reads an .xlsx workbook with several sheets, numeric prices and hyperlink cells", async () => {
    const XLSX = await import("xlsx");
    const { readSheets } = await import("@/lib/store/read-sheet");
    const { pickSheet } = await import("@/lib/store/import");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["How to use"], ["Fill in the Catalogue sheet"]]), "Readme");
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item Name", "Price (INR)", "Stock", "Picture", "Size"],
      ["Oversized Hoodie", 1899, 12, "View image", "M"],
      ["Oversized Hoodie", 1899, 4, "View image", "L"],
    ]);
    ws["D2"].l = { Target: "https://cdn.example.com/hoodie-m.jpg" };
    ws["D3"].l = { Target: "https://cdn.example.com/hoodie-l.jpg" };
    XLSX.utils.book_append_sheet(wb, ws, "Catalogue");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sheets = await readSheets(buf, "catalogue.xlsx");
    const best = pickSheet(sheets);
    expect(best.name).toBe("Catalogue");
    const r = analyse(best.grid);
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ title: "Oversized Hoodie", images: ["https://cdn.example.com/hoodie-m.jpg", "https://cdn.example.com/hoodie-l.jpg"], options: [{ name: "Size", values: ["M", "L"] }] });
    expect(r.products[0].variants.map((v) => [v.price, v.stock])).toEqual([[189900, 12], [189900, 4]]);
  });

  it("reads legacy .xls and OpenDocument .ods", async () => {
    const XLSX = await import("xlsx");
    const { readSheets } = await import("@/lib/store/read-sheet");
    for (const bookType of ["xls", "ods"] as const) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Product", "Rate"], ["Ghee 500ml", "₹ 650"]]), "Sheet1");
      const buf = XLSX.write(wb, { type: "array", bookType: bookType === "xls" ? "biff8" : "ods" }) as ArrayBuffer;
      const [s] = await readSheets(buf, `list.${bookType}`);
      expect(analyse(s.grid).products[0]).toMatchObject({ title: "Ghee 500ml" });
      expect(analyse(s.grid).products[0].variants[0].price).toBe(65000);
    }
  });
});

describe("abbreviations and photo checks", () => {
  it("recognises dotted abbreviations like M.R.P. and S.K.U.", () => {
    const r = analyse([["Item Name", "M.R.P.", "Our Price", "S.K.U."], ["Mug", "₹500", "₹450", "MG-1"]]);
    expect(r.mapping.map((m) => m.field)).toEqual(["title", "compareAt", "price", "sku"]);
    expect(r.products[0].variants[0]).toMatchObject({ price: 45000, compareAt: 50000, sku: "MG-1" });
  });
  it("flags photo links that didn't open", async () => {
    const { issuesFor } = await import("@/lib/store/import");
    const issues = issuesFor({ title: "Mug", description: "A lovely stoneware mug for slow mornings.", category: "Kitchen", images: [], brokenImages: ["https://x.example/a.jpg"], variants: [{ options: {}, price: 100, compareAt: null, cost: null, sku: "", stock: 1, weightGrams: null }] });
    expect(issues).toEqual([{ field: "images", level: "recommended", message: "1 photo link didn't open — replace it" }]);
  });
});
