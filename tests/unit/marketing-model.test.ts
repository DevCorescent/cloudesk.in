import { describe, expect, it } from "vitest";
import { attribute, emailStats, linksIn, matches, renderEmail, roi, rulesSchema, utmUrl, variantFor } from "@/lib/marketing/model";

const c = { lifecycle: "lead", source: "web_to_lead", tags: ["Pune", "VIP"], score: 40, city: "Pune", country: "India", ownerId: null, createdAt: new Date("2026-10-01"), openDeals: 1, wonDeals: 0 };

describe("segments", () => {
  it("needs every rule that's set to hold", () => {
    const r = (x: object) => rulesSchema.parse(x);
    expect(matches(r({}), c)).toBe(true);
    expect(matches(r({ lifecycle: ["lead", "customer"], tagsAny: ["vip"], minScore: 30, cities: ["pune"] }), c)).toBe(true);
    expect(matches(r({ tagsAll: ["vip", "b2b"] }), c)).toBe(false);
    expect(matches(r({ minScore: 50 }), c)).toBe(false);
    expect(matches(r({ openDeal: "no" }), c)).toBe(false);
    expect(matches(r({ wonDeal: "no" }), c)).toBe(true);
    expect(matches(r({ createdWithinDays: 7 }), c, new Date("2026-10-24"))).toBe(false);
  });
});

describe("email", () => {
  it("fills in names, tracks each link, and adds unsubscribe", () => {
    const body = "Hi {{first_name}},\nSee https://shop.example/sale. And https://shop.example/sale again, or https://x.example/a?b=1!";
    expect(linksIn(body)).toEqual(["https://shop.example/sale", "https://x.example/a?b=1"]);
    const out = renderEmail(body, { name: "Asha Nair", email: "a@x.example", company: "Lumen" }, (i) => `https://app/m/c${i}`, "https://app/m/u", "Lumen Store");
    expect(out).toContain("Hi Asha,");
    expect(out).toContain("See https://app/m/c0. And https://app/m/c0 again, or https://app/m/c1!");
    expect(out.endsWith("Unsubscribe: https://app/m/u")).toBe(true);
    expect(renderEmail("Hello {{name}}", { name: "", email: "", company: "" }, () => "", "u", "X")).toMatch(/^Hello there/);
  });

  it("splits A/B the same way every time, and counts results per subject", () => {
    expect(variantFor("c1", "k", false)).toBe("A");
    const v = Array.from({ length: 400 }, (_, i) => variantFor(`contact-${i}`, "camp", true));
    expect(v.filter((x) => x === "B").length).toBeGreaterThan(150);
    expect(variantFor("contact-1", "camp", true)).toBe(variantFor("contact-1", "camp", true));
    const s = emailStats([{ variant: "A", status: "sent", clicks: 2, unsubscribedAt: null }, { variant: "A", status: "sent", clicks: 0, unsubscribedAt: new Date() }, { variant: "B", status: "failed", clicks: 0, unsubscribedAt: null }, { variant: "B", status: "sent", clicks: 1, unsubscribedAt: null }]);
    expect(s.all).toMatchObject({ total: 4, sent: 3, failed: 1, clicked: 2, unsubscribed: 1 });
    expect(s.A.clickRate).toBe(0.5);
    expect(s.B.clickRate).toBe(1);
  });

  it("tags links for analytics", () => {
    expect(utmUrl("https://shop.example/p?x=1", { source: "cloudesk", medium: "email", campaign: "diwali-26" })).toBe("https://shop.example/p?x=1&utm_source=cloudesk&utm_medium=email&utm_campaign=diwali-26");
  });
});

describe("attribution", () => {
  it("credits first, last and every touch within the window", () => {
    const touches = [{ campaignId: "news", contactId: "p", at: "2026-08-01" }, { campaignId: "webinar", contactId: "p", at: "2026-09-10" }, { campaignId: "old", contactId: "p", at: "2025-01-01" }, { campaignId: "after", contactId: "p", at: "2026-10-30" }];
    const a = attribute(touches, [{ id: "d1", contactId: "p", value: 100000, closedAt: "2026-10-01" }, { id: "d2", contactId: null, value: 5, closedAt: "2026-10-01" }], 90);
    expect(a.get("news")).toEqual({ deals: 1, firstValue: 100000, lastValue: 0, linearValue: 50000 });
    expect(a.get("webinar")).toEqual({ deals: 1, firstValue: 0, lastValue: 100000, linearValue: 50000 });
    expect(a.has("old")).toBe(false);
    expect(a.has("after")).toBe(false);
    expect(roi(150000, 50000)).toBe(2);
    expect(roi(1, 0)).toBeNull();
  });
});
