import { describe, expect, it } from "vitest";
import { barcodeKind, ean13CheckDigit, encodeCode128, encodeEan13, isValidEan13, normaliseGtin, renderBarcodeSvg, storeEan13, upiPayUrl } from "@/lib/store/barcode";

// Independent decoders, used to prove the encoders round-trip.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => [...p].reverse().map((b) => (b === "1" ? "0" : "1")).join(""));
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function decodeEan13(bits: string) {
  expect(bits.length).toBe(95);
  expect(bits.slice(0, 3)).toBe("101");
  expect(bits.slice(45, 50)).toBe("01010");
  let parity = "";
  let digits = "";
  for (let i = 0; i < 6; i++) {
    const chunk = bits.slice(3 + i * 7, 10 + i * 7);
    const l = L.indexOf(chunk);
    parity += l >= 0 ? "L" : "G";
    digits += l >= 0 ? l : G.indexOf(chunk);
  }
  for (let i = 0; i < 6; i++) digits += R.indexOf(bits.slice(50 + i * 7, 57 + i * 7));
  return PARITY.indexOf(parity) + digits;
}

describe("EAN-13", () => {
  it("computes check digits and validates codes", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("8901030865275")).toBe(true); // a common Indian GTIN
    expect(normaliseGtin("036000291452")).toBe("0036000291452"); // UPC-A
  });
  it("encodes bars that decode back to the same number", () => {
    for (const code of ["4006381333931", "8901030865275", "0036000291452", storeEan13(42, 7)]) expect(decodeEan13(encodeEan13(code))).toBe(code);
    expect(() => encodeEan13("1234567890123")).toThrow();
  });
  it("makes in-store numbers in the GS1 restricted range", () => {
    const a = storeEan13(1234, 1);
    expect(a).toMatch(/^201234000001\d$/);
    expect(isValidEan13(a)).toBe(true);
    expect(storeEan13(1234, 2)).not.toBe(a);
  });
});

describe("Code 128", () => {
  it("encodes with start, checksum and stop", () => {
    const bits = encodeCode128("SKU-001");
    expect(bits.startsWith("11010010000")).toBe(true); // start B
    expect(bits.endsWith("1100011101011")).toBe(true); // stop
    // 1 start + 7 chars + 1 check = 9 symbols of 11 modules, plus a 13-module stop.
    expect(bits.length).toBe(9 * 11 + 13);
    expect(() => encodeCode128("ünïcode")).toThrow();
  });
  it("chooses EAN-13 for valid GTINs and Code 128 otherwise", () => {
    expect(barcodeKind("8901030865275")).toBe("ean13");
    expect(barcodeKind("MUG-SAGE-300")).toBe("code128");
  });
});

describe("SVG and UPI", () => {
  it("renders an SVG with bars and readable text", () => {
    const svg = renderBarcodeSvg("8901030865275");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect((svg.match(/<rect x=/g) ?? []).length).toBe(30); // EAN-13 always has 30 bars
    expect(svg).toContain(">8</text>");
    expect(renderBarcodeSvg('A<"&>')).toContain("A&lt;&quot;&amp;&gt;");
  });
  it("builds a UPI payment link with the exact amount", () => {
    expect(upiPayUrl({ vpa: "shop@okaxis", name: "Saanjh Studio", amountMinor: 189950, note: "Bill 1042" })).toBe("upi://pay?pa=shop%40okaxis&pn=Saanjh+Studio&am=1899.50&cu=INR&tn=Bill+1042");
  });
});
