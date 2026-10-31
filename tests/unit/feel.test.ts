import { describe, expect, it } from "vitest";
import { applyFeel, feelFromCss } from "@/lib/site/brand";
import { themeFor } from "@/lib/site/design";

describe("clone the feel", () => {
  it("reads rounding, buttons, spacing, headline size and background from CSS", () => {
    const css = `body{background:#0b0b0f;color:#fff} h1{font-size:4.5rem} .hero{padding:128px 0} section{padding-top:120px;padding-bottom:120px}
      .card{border-radius:16px} .panel{border-radius:20px} .btn{border-radius:9999px;background:#7c3aed}`;
    const f = feelFromCss(css);
    expect(f).toMatchObject({ radius: "lg", buttonStyle: "pill", density: "airy", typeScale: "dramatic", dark: true });
    expect(f.evidence.length).toBe(5);
  });

  it("understands Tailwind class names and square, compact sites", () => {
    expect(feelFromCss("", '<section class="py-8"><h1 class="text-3xl">x</h1><a class="rounded-none">y</a></section>')).toMatchObject({ radius: "none", density: "compact" });
    expect(feelFromCss(".button{background:transparent;border:2px solid #000;border-radius:4px} html{background-color:#fff}")).toMatchObject({ buttonStyle: "outline", dark: false });
    expect(feelFromCss("")).toEqual({ evidence: [] });
  });

  it("applies only what was detected", () => {
    const t = themeFor("modern");
    const out = applyFeel(t, { radius: "none", evidence: [] });
    expect(out.radius).toBe("none");
    expect(out.density).toBe(t.density);
    expect(out.palette).toEqual(t.palette);
  });
});
