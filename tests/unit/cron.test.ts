import { describe, expect, it } from "vitest";
import { cronMatches, nextRuns, parseCron } from "@/lib/automation/cron";
import { evaluateCondition, renderTemplate } from "@/lib/automation/model";

describe("cron", () => {
  it("evaluates in the workflow's time zone", () => {
    // 09:00 in Kolkata is 03:30 UTC.
    const c = parseCron("0 9 * * mon-fri");
    expect(cronMatches(c, new Date("2026-10-19T03:30:00Z"), "Asia/Kolkata")).toBe(true); // Monday
    expect(cronMatches(c, new Date("2026-10-18T03:30:00Z"), "Asia/Kolkata")).toBe(false); // Sunday
    expect(cronMatches(c, new Date("2026-10-19T09:00:00Z"), "UTC")).toBe(true);
    expect(nextRuns("0 9 * * *", "Asia/Kolkata", new Date("2026-10-19T04:00:00Z"), 2).map((d) => d.toISOString())).toEqual(["2026-10-20T03:30:00.000Z", "2026-10-21T03:30:00.000Z"]);
  });

  it("supports steps, lists, names and the day-of-month OR weekday rule", () => {
    const every15 = parseCron("*/15 * * * *");
    expect([0, 15, 30, 45].every((m) => every15.sets[0].has(m))).toBe(true);
    expect(every15.sets[0].has(10)).toBe(false);
    const c = parseCron("0 10 1 * sun");
    expect(cronMatches(c, new Date("2026-11-01T10:00:00Z"), "UTC")).toBe(true); // the 1st (also a Sunday)
    expect(cronMatches(c, new Date("2026-11-08T10:00:00Z"), "UTC")).toBe(true); // a Sunday
    expect(cronMatches(c, new Date("2026-11-03T10:00:00Z"), "UTC")).toBe(false);
    expect(parseCron("0 0 * * 7").sets[4].has(0)).toBe(true);
    expect(() => parseCron("61 * * * *")).toThrow(/out of range/);
    expect(() => parseCron("* * *")).toThrow(/five fields/);
  });
});

describe("templates", () => {
  const scope = { trigger: { name: 'Riya "R" <b>', total: "1499.00", nested: { city: "Pune" } }, steps: { a: { status: 200 } } };
  it("fills placeholders, escapes for JSON and never runs code", () => {
    expect(renderTemplate("Hi {{ trigger.name }} from {{trigger.nested.city}} ({{steps.a.status}}) {{missing.x}}", scope)).toBe('Hi Riya "R" <b> from Pune (200) ');
    const body = renderTemplate('{"text":"{{trigger.name}}"}', scope, "json");
    expect(JSON.parse(body)).toEqual({ text: 'Riya "R" <b>' });
    expect(renderTemplate("{{constructor}}{{constructor.constructor}}{{__proto__}}", scope)).toBe("");
  });
  it("evaluates conditions", () => {
    expect(evaluateCondition({ left: "{{trigger.total}}", op: "gt", right: "1000" }, scope)).toBe(true);
    expect(evaluateCondition({ left: "{{trigger.nested.city}}", op: "equals", right: "pune" }, scope)).toBe(true);
    expect(evaluateCondition({ left: "{{trigger.coupon}}", op: "exists", right: "" }, scope)).toBe(false);
  });
});
