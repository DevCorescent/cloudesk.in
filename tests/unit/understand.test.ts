import { describe, expect, it } from "vitest";
import { buildPlan, cleanDomain, understandBrief, type Answers } from "@/lib/onboarding/understand";

const answers = (a: Partial<Answers>): Answers => ({ name: "", brief: "", sells: null, stage: null, goals: [], assets: [], catalogSize: null, domain: "", ...a });

describe("understanding a description", () => {
  it.each([
    ["We sell handmade oxidised silver earrings and bangles", "store", "jewellery", null],
    ["Handloom cotton kurtas and sarees from Jaipur artisans", "store", "fashion", null],
    ["Eggless cakes, brownies and cookies baked fresh in Pune", "store", "bakery", null],
    ["Personalised return gifts and diwali hampers", "store", "gifts", null],
    ["A family restaurant in Goa with seafood and a bar", "website", null, "restaurant"],
    ["Unisex salon and spa with bridal makeup", "website", null, "salon"],
    ["Dental clinic in Indiranagar — book an appointment online", "website", null, "clinic"],
    ["JEE coaching classes for class 11 and 12", "website", null, "education"],
  ])("%s", (brief, kind, store, site) => {
    const u = understandBrief(brief);
    expect(u.kind).toBe(kind);
    if (store) expect(u.storeCategory).toBe(store);
    if (site) expect(u.websiteCategory).toBe(site);
    expect(u.confidence).not.toBe("none");
  });

  it("matches whole words, not fragments", () => {
    expect(understandBrief("Spring collection of classic linen dresses").storeCategory).toBe("fashion");
    expect(understandBrief("Spring string bring").storeCategory).toBeNull();
    expect(understandBrief("classic shirts").goals).not.toContain("bookings");
    expect(understandBrief("an online shop for candles").goals).not.toContain("pos");
  });

  it("picks up goals and says which words it used", () => {
    const u = understandBrief("Candles and decor — we also have a small shop counter in Bandra and take orders on Instagram, shipping worldwide");
    expect(u.storeCategory).toBe("home");
    expect(u.goals).toEqual(expect.arrayContaining(["sell", "pos", "whatsapp", "ship-intl"]));
    expect(u.signals.find((s) => s.label === "Sell in my shop (POS)")?.words).toContain("counter");
  });

  it("spots businesses that bill clients directly", () => {
    expect(understandBrief("Digital marketing agency for D2C brands").goals).toContain("invoicing");
    expect(understandBrief("We send GST bills and quotations to our dealers").goals).toContain("invoicing");
    expect(understandBrief("Handmade candles").goals).not.toContain("invoicing");
    const p = buildPlan(answers({ brief: "Interior design consultant — quotes and invoices for every project", sells: "none" }));
    expect(p.features.map((f) => f.id)).toContain("invoicing");
  });

  it("knows when it doesn't know", () => {
    expect(understandBrief("").confidence).toBe("none");
    expect(understandBrief("hello there").confidence).toBe("none");
  });
});

describe("the plan", () => {
  it("a shop that also sells at the counter gets the till, labels and an import step", () => {
    const p = buildPlan(answers({ name: "Saanjh", brief: "handwoven kurtas", sells: "both", assets: ["spreadsheet"], catalogSize: "100-1000", domain: "saanjh.in" }));
    expect(p.kind).toBe("store");
    expect(p.category).toBe("fashion");
    expect(p.features.map((f) => f.id)).toEqual(expect.arrayContaining(["checkout", "orders", "pos", "labels", "domain"]));
    expect(p.features.find((f) => f.id === "domain")!.title).toBe("Your domain saanjh.in");
    expect(p.steps.map((s) => s.id)).toEqual(["brand", "products", "look", "payments", "domain", "launch"]);
    expect(p.steps[1].title).toBe("Import your products");
    expect(p.minutes).toBeGreaterThanOrEqual(3);
  });

  it("a clinic gets a website with appointments and no store steps", () => {
    const p = buildPlan(answers({ brief: "Physiotherapy clinic", sells: "none", goals: ["bookings"] }));
    expect(p.kind).toBe("website");
    expect(p.category).toBe("clinic");
    expect(p.pages).toContain("Appointments");
    expect(p.features.map((f) => f.id)).toEqual(expect.arrayContaining(["bookings", "forms"]));
    expect(p.steps.map((s) => s.id)).not.toContain("products");
  });

  it("respects the person's own choice over what was detected", () => {
    expect(buildPlan(answers({ brief: "cakes", kind: "website", category: "restaurant" }))).toMatchObject({ kind: "website", category: "restaurant" });
  });
});

it("cleans domains", () => {
  expect(cleanDomain(" https://Shop.Example.com/path ")).toBe("shop.example.com");
  expect(cleanDomain("not a domain")).toBeNull();
  expect(cleanDomain("example")).toBeNull();
});
