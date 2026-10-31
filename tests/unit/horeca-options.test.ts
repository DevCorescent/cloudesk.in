import { describe, expect, it } from "vitest";
import { toggleOption } from "@/lib/horeca/model";

const spice = { minSelect: 1, maxSelect: 1, options: [{ id: "mild" }, { id: "hot" }] };
const extras = { minSelect: 0, maxSelect: 2, options: [{ id: "cheese" }, { id: "egg" }, { id: "olives" }] };
const sauce = { minSelect: 0, maxSelect: 1, options: [{ id: "mint" }, { id: "tamarind" }] };

describe("toggleOption", () => {
  it("keeps a required single choice when it is tapped again", () => {
    expect(toggleOption(["half", "mild"], spice, "mild")).toEqual(["half", "mild"]);
  });
  it("swaps a single choice", () => {
    expect(toggleOption(["half", "mild"], spice, "hot")).toEqual(["half", "hot"]);
  });
  it("lets an optional single choice be cleared", () => {
    expect(toggleOption(["mint"], sauce, "mint")).toEqual([]);
  });
  it("adds and removes extras up to the limit", () => {
    expect(toggleOption(["cheese"], extras, "egg")).toEqual(["cheese", "egg"]);
    expect(toggleOption(["cheese", "egg"], extras, "olives")).toEqual(["cheese", "egg"]);
    expect(toggleOption(["cheese", "egg"], extras, "cheese")).toEqual(["egg"]);
  });
});
