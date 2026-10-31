import { describe, expect, it } from "vitest";
import { alternativeLabel, metricFor } from "@/server/growth/opportunities";

describe("growth suggestions", () => {
  it("suggests wording that fits the business", () => {
    expect(alternativeLabel("Book an appointment")).toBe("Book your appointment");
    expect(alternativeLabel("Reserve a table")).toBe("Book your table");
    expect(alternativeLabel("Shop now")).toBe("Shop bestsellers");
  });
  it("measures add-to-carts only on pages that sell products", () => {
    const page = (types: string[]) => ({ path: "/", sections: types.map((type, i) => ({ id: String(i), type, props: {} })) }) as never;
    expect(metricFor(page(["hero", "booking"]), true)).toBe("submit");
    expect(metricFor(page(["hero", "features"]), true)).toBe("submit");
    expect(metricFor(page(["hero", "productGrid"]), true)).toBe("cart_add");
  });
});
