import { describe, expect, it } from "vitest";
import { bestAnswer, searchSite } from "@/components/marketing/nav";

describe("site search", () => {
  it("answers questions in plain words", () => {
    expect(bestAnswer("can I export my data?")?.title).toBe("Can I export my data?");
    expect(bestAnswer("is my data safe")?.title).toBe("Is my data safe?");
    expect(bestAnswer("how do I cancel my subscription")?.title).toBe("Can I cancel any time?");
    expect(bestAnswer("crm")).toBeNull();
  });

  it("finds pages, features and what they do — little words don't have to match", () => {
    expect(searchSite("can I export my data?").length).toBeGreaterThan(0);
    expect(searchSite("invoice").map((e) => e.kind)).toContain("Feature");
    expect(searchSite("gst returns").some((e) => /accounts/i.test(`${e.title} ${e.group ?? ""}`))).toBe(true);
    expect(searchSite("partners")[0]?.href).toBe("/partners");
    expect(searchSite("privacy").some((e) => e.href === "/privacy")).toBe(true);
    expect(searchSite("zzqx")).toEqual([]);
  });
});
