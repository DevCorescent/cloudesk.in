import { describe, expect, it } from "vitest";
import { diffStats, hunks, lineDiff } from "@/lib/diff";

describe("lineDiff", () => {
  it("finds inserted and removed lines", () => {
    const d = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d.map((l) => `${l.type[0]}${l.text}`)).toEqual(["sa", "db", "aB", "sc", "sd", "ae"]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });
  it("returns only same lines for identical input", () => {
    expect(lineDiff("x\ny", "x\ny").every((l) => l.type === "same")).toBe(true);
  });
  it("collapses unchanged context", () => {
    const a = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l25", "changed");
    const h = hunks(lineDiff(a, b), 2);
    expect(h[0]).toEqual({ skipped: 23 });
    expect("lines" in h[1] && h[1].lines.length).toBe(6);
  });
});
