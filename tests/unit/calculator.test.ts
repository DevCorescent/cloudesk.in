import { describe, expect, it } from "vitest";
import { CalcError, evaluate, type Env } from "@/lib/calculator/expr";
import { formatNumber, rupeesInWords, shortIndian, wordsIndian } from "@/lib/calculator/format";
import { FORMULAS, FormulaError, runFormula } from "@/lib/calculator/formulas";

const env = (over: Partial<Env> = {}): Env => ({ vars: {}, ans: 0, angle: "deg", ...over });
const ev = (s: string, e = env()) => evaluate(s, e).value;

describe("expressions", () => {
  it("follows the usual order of operations", () => {
    expect(ev("2 + 3 × 4")).toBe(14);
    expect(ev("(2 + 3) * 4")).toBe(20);
    expect(ev("2^3^2")).toBe(512);
    expect(ev("-2^2")).toBe(-4);
    expect(ev("10 ÷ 4")).toBe(2.5);
    expect(ev("17 mod 5")).toBe(2);
    expect(ev("5!")).toBe(120);
    expect(ev("2 x 3")).toBe(6);
  });
  it("hides floating-point noise", () => {
    expect(ev("0.1 + 0.2")).toBe(0.3);
    expect(ev("1.1 * 1.1")).toBe(1.21);
  });
  it("does percentages the way a business calculator does", () => {
    expect(ev("200 + 18%")).toBe(236);
    expect(ev("200 - 10%")).toBe(180);
    expect(ev("18% of 200")).toBe(36);
    expect(ev("200 * 10%")).toBe(20);
    expect(ev("50%")).toBe(0.5);
  });
  it("reads grouped numbers and currency signs", () => {
    expect(ev("₹1,23,456 + 44")).toBe(123500);
    expect(ev("12,345,678 / 2")).toBe(6172839);
    expect(ev("max(10,20)")).toBe(20);
    expect(ev("1e3 + .5")).toBe(1000.5);
  });
  it("has functions, constants, implicit multiplication and angle modes", () => {
    expect(ev("sqrt(144)")).toBe(12);
    expect(ev("round(2pi, 4)")).toBe(6.2832);
    expect(ev("2(3+4)")).toBe(14);
    expect(ev("sin(30)")).toBe(0.5);
    expect(ev("sin(pi/6)", env({ angle: "rad" }))).toBe(0.5);
    expect(ev("avg(10, 20, 30)")).toBe(20);
    expect(ev("median(5, 1, 9, 3)")).toBe(4);
    expect(ev("gst(1000, 18)")).toBe(1180);
    expect(ev("exgst(1180, 18)")).toBe(1000);
    expect(ev("change(80, 100)")).toBe(25);
    expect(ev("log(1000)")).toBe(3);
  });
  it("keeps variables and the last answer", () => {
    const e = env();
    const r = evaluate("rate = 18", e);
    expect(r).toEqual({ value: 18, assign: "rate" });
    e.vars.rate = 18;
    expect(ev("1000 + rate%", e)).toBe(1180);
    expect(ev("ans * 2", env({ ans: 21 }))).toBe(42);
  });
  it("explains mistakes instead of guessing", () => {
    expect(() => ev("1 / 0")).toThrow(/divide by zero/);
    expect(() => ev("(1 + 2")).toThrow(/bracket/);
    expect(() => ev("1 + ")).toThrow(CalcError);
    expect(() => ev("foo + 1")).toThrow(/isn't defined/);
    expect(() => ev("sqrt(-4)")).toThrow(/negative/);
    expect(() => ev("sin = 4")).toThrow(/can't be a variable/);
    expect(() => ev("alert(1)")).toThrow(CalcError);
    expect(() => ev("constructor")).toThrow(/isn't defined/);
  });
});

describe("formatting", () => {
  it("groups the Indian and the international way", () => {
    expect(formatNumber(12345678.5, { grouping: "indian" })).toBe("1,23,45,678.5");
    expect(formatNumber(12345678.5, { grouping: "international" })).toBe("12,345,678.5");
    expect(formatNumber(-999, {})).toBe("−999");
    expect(formatNumber(1234.5, { decimals: 2 })).toBe("1,234.50");
  });
  it("writes amounts in words like a cheque", () => {
    expect(wordsIndian(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
    expect(rupeesInWords(120000.5)).toBe("Rupees One Lakh Twenty Thousand and Fifty Paise Only");
    expect(rupeesInWords(0)).toBe("Rupees Zero Only");
    expect(shortIndian(12500000)).toBe("1.25 crore");
    expect(shortIndian(350000)).toBe("3.5 lakh");
  });
});

describe("business formulas", () => {
  const first = (id: string, v: Record<string, number | string>) => runFormula(id, v).results[0]!.value;
  it("GST both ways, split by supply", () => {
    const add = runFormula("gst-add", { amount: 10000, rate: "18", supply: "intra" });
    expect(add.results.map((r) => [r.label, r.value])).toEqual([["Total with GST", 11800], ["Taxable value", 10000], ["Total GST", 1800], ["CGST @ 9%", 900], ["SGST @ 9%", 900]]);
    expect(runFormula("gst-add", { amount: 10000, rate: "18", supply: "inter" }).results.at(-1)).toMatchObject({ label: "IGST @ 18%", value: 1800 });
    expect(first("gst-remove", { amount: 11800, rate: "18", supply: "intra" })).toBe(10000);
  });
  it("EMI matches the standard formula and the schedule pays off the loan", () => {
    const r = runFormula("emi", { principal: 1000000, rate: 9, months: 240 });
    expect(r.results[0]!.value).toBe(8997.26);
    expect(r.table!.rows).toHaveLength(240);
    expect(r.table!.rows.at(-1)![4]).toBe(0);
    expect(first("emi", { principal: 120000, rate: 0, months: 12 })).toBe(10000);
  });
  it("margin, markup, discounts and break-even", () => {
    const mg = runFormula("margin", { cost: 600, price: 1000 }).results;
    expect(mg.map((r) => r.value)).toEqual([400, 40, (400 / 600) * 100]);
    expect(first("price-from-margin", { cost: 600, margin: 40 })).toBe(1000);
    expect(first("discount", { price: 1000, d1: 20, d2: 10 })).toBe(720);
    expect(first("break-even", { fixed: 150000, price: 500, variable: 300 })).toBe(750);
    expect(() => runFormula("break-even", { fixed: 1, price: 100, variable: 100 })).toThrow(FormulaError);
  });
  it("growth, investments and interest", () => {
    expect(Math.round(Number(first("cagr", { start: 100, end: 200, years: 1 })))).toBe(100);
    expect(first("simple-interest", { principal: 100000, rate: 8, years: 3 })).toBe(24000);
    expect(first("compound", { principal: 100000, rate: 10, years: 1, freq: "1" })).toBe(110000);
    expect(first("sip", { monthly: 1000, rate: 0, years: 1 })).toBe(12000);
    expect(first("eoq", { demand: 12000, order: 1500, holding: 20 })).toBe(1342);
    expect(first("reorder", { daily: 40, lead: 7, safety: 60 })).toBe(340);
  });
  it("dates count working days and due dates", () => {
    const r = runFormula("days-between", { start: "2026-11-02", end: "2026-11-08", week: "6" });
    expect(r.results.map((x) => x.value)).toEqual([6, 7, 6, 0.86]);
    expect(runFormula("due-date", { date: "2026-10-31", credit: 30 }).results[1]!.value).toBe("2026-11-30");
  });
  it("every formula runs on its own defaults (where it has them)", () => {
    for (const f of FORMULAS) {
      if (f.fields.some((x) => x.kind === "date")) continue;
      const v = Object.fromEntries(f.fields.map((x) => [x.id, x.default ?? ""]));
      expect(() => runFormula(f.id, v), f.id).not.toThrow();
    }
  });
});
