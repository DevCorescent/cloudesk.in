import { describe, expect, it } from "vitest";
import { computeScore, DEFAULT_SCORING, emailDomain, fieldKey, forecast, personFromForm, phoneKey, renderTemplate } from "@/lib/crm/model";

const facts = { email: "", phone: "", companyId: null, title: "", marketing: false, source: "manual", tags: [] as string[], lifecycle: "lead", activities30: 0, recentActivity: false, openDeals: 0, wonDeals: 0 };

describe("CRM rules", () => {
  it("matches phones on their last ten digits", () => {
    expect(phoneKey("+91 98200-11111")).toBe("9820011111");
    expect(phoneKey("09820011111")).toBe("9820011111");
    expect(phoneKey("12345")).toBe("");
  });
  it("ignores free mail domains when linking to companies", () => {
    expect(emailDomain("a@Acme.in")).toBe("acme.in");
    expect(emailDomain("a@gmail.com")).toBe("");
  });
  it("scores leads within 0–100, counting activities up to ten", () => {
    expect(computeScore(DEFAULT_SCORING, facts)).toBe(0);
    expect(computeScore(DEFAULT_SCORING, { ...facts, email: "x@y.z", phone: "1", companyId: "c", title: "CEO" })).toBe(35);
    expect(computeScore(DEFAULT_SCORING, { ...facts, activities30: 50, recentActivity: true, openDeals: 1, wonDeals: 1, email: "x" })).toBe(95);
    expect(computeScore([{ id: "a", signal: "tag", value: "vip", points: 40 }, { id: "b", signal: "source", value: "ads", points: -60 }], { ...facts, tags: ["VIP"], source: "ads" })).toBe(0);
  });
  it("reads people out of differently named form fields", () => {
    expect(personFromForm({ "First Name": "Nisha", "Last name": "Patel", "E-mail address": "N@x.co", "Mobile No": "98111", Organisation: "Bloom", "Your message": "Hi" })).toEqual({ name: "Nisha Patel", email: "n@x.co", phone: "98111", company: "Bloom", title: "", message: "Hi" });
    expect(personFromForm({ field_1: "someone@site.com" }).email).toBe("someone@site.com");
  });
  it("fills merge fields and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{first_name}} from {{company}}{{nope}}", { name: "Asha Kapoor", company: "Acme" })).toBe("Hi Asha from Acme");
    expect(renderTemplate("Hi {{ first_name }}", {})).toBe("Hi there");
  });
  it("forecasts open deals by month, weighted by stage", () => {
    const f = forecast([
      { value: 1000, probability: 50, expectedClose: "2026-11-10", status: "open" },
      { value: 3000, probability: 10, expectedClose: "2026-11-30", status: "open" },
      { value: 999, probability: 90, expectedClose: null, status: "open" },
      { value: 5000, probability: 100, expectedClose: "2026-10-01", status: "won" },
    ]);
    expect(f).toEqual([{ month: "2026-11", total: 4000, weighted: 800, count: 2 }, { month: "none", total: 999, weighted: 899, count: 1 }]);
  });
  it("turns field labels into keys", () => {
    expect(fieldKey("Annual revenue (₹)")).toBe("annual_revenue");
  });
});
