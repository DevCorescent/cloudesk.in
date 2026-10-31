import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps paths on this site", () => {
    expect(safeNextPath("/projects/1?tab=a#x")).toBe("/projects/1?tab=a#x");
    expect(safeNextPath("/settings?github=connected")).toBe("/settings?github=connected");
  });
  it("refuses anything the browser would read as another site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", null, undefined, `/${"a".repeat(400)}`]) {
      expect(safeNextPath(bad as string | null)).toBe("/home");
    }
    expect(safeNextPath("//evil.com", "")).toBe("");
  });
});
