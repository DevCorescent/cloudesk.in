import { describe, expect, it } from "vitest";
import { EMPTY, fromBrief, merge, profileFor, recommend, usualFor } from "@/lib/onboarding/recommend";

describe("reading the description", () => {
  it("hears how the business sells, what it tracks and its size", () => {
    const r = fromBrief("A bakery in Pune with a shop and online orders, team of 12, we deliver across the city");
    expect(r.profile.sell).toEqual(expect.arrayContaining(["online", "counter"]));
    expect(r.profile.track).toEqual(expect.arrayContaining(["production", "delivery"]));
    expect(r.profile.team).toBe("medium");
    expect(r.heard).toContain("12 people");
  });
  it("hears nothing in an empty line", () => {
    expect(fromBrief("").heard).toEqual([]);
  });
  it("knows a one-person business", () => {
    expect(fromBrief("Freelance designer, just me").profile.team).toBe("solo");
  });
});

describe("recommending modules", () => {
  it("gives a restaurant Horeca, invoices and HR, with reasons", () => {
    const r = recommend(usualFor("restaurant"), "restaurant");
    expect(r.modules).toEqual(expect.arrayContaining(["horeca", "invoicing", "hr", "inventory"]));
    expect(r.modules).not.toContain("manufacturing");
    expect(r.why.horeca).toEqual(["You serve customers at tables"]);
  });
  it("adds what a module needs and says why", () => {
    const r = recommend(merge(EMPTY, { customers: ["marketing"] }), null);
    expect(r.modules).toEqual(expect.arrayContaining(["marketing", "crm"]));
    expect(r.why.crm).toEqual(["Needed by another feature you're getting"]);
  });
  it("adds the industry pack and accounts for a contractor", () => {
    const r = recommend(usualFor("construction"), "construction");
    expect(r.modules).toEqual(expect.arrayContaining(["construction", "inventory", "maintenance", "documents", "accounting", "hr", "work"]));
  });
  it("suggests reports, compliance and copilot only for bigger setups", () => {
    expect(recommend(merge(EMPTY, { sell: ["online"], team: "solo" }), null).modules).not.toContain("bi");
    const big = recommend(merge(usualFor("retail"), { team: "large" }), "retail");
    expect(big.modules).toEqual(expect.arrayContaining(["bi", "grc"]));
  });
  it("combines the industry with what the description says", () => {
    const { profile, heard } = profileFor("cafe", "We also make our own cakes and deliver them");
    expect(profile.sell).toEqual(expect.arrayContaining(["tables", "counter"]));
    expect(profile.track).toEqual(expect.arrayContaining(["production", "delivery"]));
    expect(heard).toEqual(expect.arrayContaining(["makes products", "delivers"]));
  });
});
