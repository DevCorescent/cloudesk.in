import { describe, expect, it } from "vitest";
import { BUILT_IN, BUILT_IN_FUNNELS, checkSteps, industryOf, merge, nextSlot, parsePasted, pickArm, renderEmail, scoreOf, stageFromScore, warmupCap, type Step } from "@/lib/outreach/model";

const asha = { email: "asha@rao.in", name: "Asha Rao", company: "Rao Traders", city: "", industry: "retail", title: "", data: { turnover: "2 Cr" } };
// 11:00 on Tuesday 10 Nov 2026 in India.
const ist = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 10, day, hour, min) - 19_800_000);
const window = { windowStart: 9, windowEnd: 19, days: [1, 2, 3, 4, 5, 6] };

describe("outreach model", () => {
  it("merges fields with fallbacks, extra columns included", () => {
    expect(merge("Hi {{firstName|there}} at {{company}}", asha)).toBe("Hi Asha at Rao Traders");
    expect(merge("From {{city|India}}, {{ unknown }}!", asha)).toBe("From India, !");
    expect(merge("{{turnover}} turnover, {{trial}} days", asha, { trial: "14" })).toBe("2 Cr turnover, 14 days");
  });

  it("reads pasted lists in every common shape", () => {
    const r = parsePasted("Ravi Menon <ravi@menon.in>, Menon Traders\nmeena@salon.in\nnonsense line\nKiran\tkiran@hw.in\tKiran Hardware");
    expect(r.map((x) => x.email)).toEqual(["ravi@menon.in", "meena@salon.in", "kiran@hw.in"]);
    expect(r[0]).toMatchObject({ name: "Ravi Menon", company: "Menon Traders" });
    expect(r[2]).toMatchObject({ name: "Kiran", company: "Kiran Hardware" });
  });

  it("recognises industries from a company name", () => {
    expect(industryOf("Third Wave Cafe")).toBe("restaurant");
    expect(industryOf("Smile Dental Clinic")).toBe("clinic");
    expect(industryOf("Acme Holdings")).toBe("other");
  });

  it("ships a library of templates and funnels that hold together", () => {
    expect(BUILT_IN.length).toBeGreaterThanOrEqual(18);
    expect(new Set(BUILT_IN.map((t) => t.key)).size).toBe(BUILT_IN.length);
    for (const t of BUILT_IN) expect(t.subjects.length).toBeGreaterThanOrEqual(2);
    for (const f of BUILT_IN_FUNNELS) expect(checkSteps(f.steps)).toBeNull();
  });

  it("checks funnel steps", () => {
    const email: Step = { id: "a", kind: "email", templateId: null, category: "intro" };
    expect(checkSteps([email])).toBeNull();
    expect(checkSteps([email, { ...email }])).toMatch(/own id/);
    expect(checkSteps([email, { id: "b", kind: "branch", if: "opened", then: "zz", else: null }])).toMatch(/isn't there/);
    expect(checkSteps([{ id: "w", kind: "wait", days: 1 }])).toMatch(/at least one email/);
  });

  it("renders tracked, escaped HTML with the unsubscribe footer and a plain-text twin", () => {
    const r = renderEmail({
      body: "Hi <Asha>,\n\n**Bold** and [our site](https://cloudesk.in/a?x=1&y=2)\n\n- one\n- two",
      preheader: "Peek",
      ctaLabel: "Start free",
      ctaUrl: "https://cloudesk.in/start",
      link: (u) => `https://t.example/c?u=${encodeURIComponent(u)}`,
      pixel: "https://t.example/o",
      unsubscribe: "https://t.example/u",
      fromName: "Cloudesk",
      postalAddress: "12 MG Road, Pune",
      reason: "You're getting this because…",
    });
    expect(r.html).toContain("Hi &lt;Asha&gt;,");
    expect(r.html).toContain("<strong>Bold</strong>");
    expect(r.html).toContain(encodeURIComponent("https://cloudesk.in/a?x=1&y=2"));
    expect(r.html).toContain("<ul");
    expect(r.html).toContain('src="https://t.example/o"');
    expect(r.html).toContain("12 MG Road, Pune");
    expect(r.text).toContain("Bold and our site (https://cloudesk.in/a?x=1&y=2)");
    expect(r.text).toContain("Unsubscribe: https://t.example/u");
  });

  it("learns which template wins, while still trying the new ones", () => {
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const arms = [{ sends: 400, opens: 80, clicks: 4 }, { sends: 400, opens: 160, clicks: 40 }];
    const picks = Array.from({ length: 200 }, () => pickArm(arms, rand));
    expect(picks.filter((p) => p === 1).length).toBeGreaterThan(190);
    const fresh = Array.from({ length: 200 }, () => pickArm([{ sends: 400, opens: 100, clicks: 20 }, { sends: 0, opens: 0, clicks: 0 }], rand));
    expect(fresh.filter((p) => p === 1).length).toBeGreaterThan(5);
    expect(pickArm([{ sends: 0, opens: 0, clicks: 0 }])).toBe(0);
  });

  it("sends inside the window, at the person's best hour, on sending days", () => {
    expect(nextSlot(ist(10, 11), window)).toEqual(ist(10, 11));
    expect(nextSlot(ist(10, 7), window)).toEqual(ist(10, 9));
    expect(nextSlot(ist(10, 11), window, 15)).toEqual(ist(10, 15));
    expect(nextSlot(ist(10, 20), window)).toEqual(ist(11, 9));
    expect(nextSlot(ist(10, 20), window, 14)).toEqual(ist(11, 14));
    // Saturday evening skips Sunday.
    expect(nextSlot(ist(14, 20), window)).toEqual(ist(16, 9));
    // A best hour outside the window is ignored.
    expect(nextSlot(ist(10, 7), window, 22)).toEqual(ist(10, 9));
  });

  it("scores engagement, fades it with time and keeps conversions", () => {
    const now = Date.now();
    expect(scoreOf({ opens: 1, clicks: 1, lastEventAt: new Date(now), stage: "new" }, now)).toBe(15);
    expect(scoreOf({ opens: 10, clicks: 0, lastEventAt: new Date(now - 10 * 7 * 86_400_000), stage: "new" }, now)).toBe(10);
    expect(stageFromScore(35, "new")).toBe("hot");
    expect(stageFromScore(8, "lost")).toBe("engaged");
    expect(stageFromScore(0, "lost")).toBe("lost");
    expect(stageFromScore(0, "trial")).toBe("trial");
  });

  it("warms up the daily volume", () => {
    const s = { warmup: true, warmupStart: 50, warmupGrowth: 1.25, dailyLimit: 500 };
    expect(warmupCap(s, 0)).toBe(50);
    expect(warmupCap(s, 4)).toBe(122);
    expect(warmupCap(s, 30)).toBe(500);
    expect(warmupCap({ ...s, warmup: false }, 0)).toBe(500);
  });
});
