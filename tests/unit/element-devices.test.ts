import { describe, expect, it } from "vitest";
import { elementsCss, elementsSchema } from "@/lib/site/advanced";

describe("per-device and hover element styles", () => {
  it("adds tablet then phone rules, phone last so it wins", () => {
    const css = elementsCss(".s-a", { heading: { size: 64, tablet: { size: 48, align: "center" }, mobile: { size: 32, hidden: false } } });
    const t = css.indexOf("@media (max-width:1023px)");
    const m = css.indexOf("@media (max-width:767px)");
    expect(t).toBeGreaterThan(-1);
    expect(m).toBeGreaterThan(t);
    expect(css).toContain('@media (max-width:1023px){.s-a [data-f="heading"]{font-size:48px!important;text-align:center!important;margin-left:auto!important;margin-right:auto!important}}');
    expect(css).toContain('@media (max-width:767px){.s-a [data-f="heading"]{font-size:32px!important}}');
  });

  it("hides an element on one device only", () => {
    const css = elementsCss(".s-a", { primaryLabel: { tablet: { hidden: true } } });
    expect(css).toBe('@media (max-width:1023px){.s-a [data-f="primaryLabel"]{display:none!important}}');
  });

  it("styles hover only where there's a pointer, with a transition", () => {
    const css = elementsCss(".s-a", { primaryLabel: { hover: { bg: "#111111", scale: 105, lift: true, shadow: "soft" } } });
    expect(css).toContain("transition:");
    expect(css).toContain('@media (hover:hover){.s-a [data-f="primaryLabel"]:hover{background:#111111!important;transform:scale(1.05) translateY(-3px)!important;box-shadow:');
  });

  it("rejects values out of range", () => {
    expect(elementsSchema.safeParse({ heading: { mobile: { size: 900 } } }).success).toBe(false);
    expect(elementsSchema.safeParse({ heading: { hover: { scale: 200 } } }).success).toBe(false);
    expect(elementsSchema.safeParse({ heading: { hover: { color: "red;}body{x" } } }).success).toBe(false);
  });
});
