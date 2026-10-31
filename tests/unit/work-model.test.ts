import { describe, expect, it } from "vitest";
import { clean } from "@/lib/import/engine";
import { target } from "@/lib/import/targets";
import { billLines, burn, capacity, hm, hourlyCost, hrs, parseDuration, roundUp, weekDays, weekOf, weekday } from "@/lib/work/model";

describe("reading durations", () => {
  it("understands the ways people write time", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1h30m")).toBe(90);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("90 mins")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("soon")).toBeNull();
  });
  it("tells Excel times (fractions of a day) from plain hours", () => {
    expect(parseDuration(0.0625)).toBe(90); // 1:30 kept as a time
    expect(parseDuration(0.5)).toBe(30); // half an hour
    expect(parseDuration(2)).toBe(120);
  });
  it("imports durations, and doesn't convert them twice", () => {
    const f = target("work.time").fields.find((x) => x.key === "minutes")!;
    expect(clean("2:15", f).value).toBe(135);
    expect(clean("25:00", f).error).toContain("more than a day");
    expect(clean("lots", f).error).toContain("isn't a duration");
  });
  it("shows minutes as hours", () => {
    expect(hm(90)).toBe("1:30");
    expect(hm(5)).toBe("0:05");
    expect(hrs(90)).toBe("1.5h");
    expect(hrs(47)).toBe("0.78h");
  });
});

describe("weeks and capacity", () => {
  it("finds the Monday of a week", () => {
    expect(weekday("2026-10-24")).toBe(6);
    expect(weekOf("2026-10-24")).toBe("2026-10-19");
    expect(weekOf("2026-10-19")).toBe("2026-10-19");
    expect(weekOf("2026-10-25")).toBe("2026-10-19");
    expect(weekDays("2026-10-19")[6]).toBe("2026-10-25");
  });
  it("counts working hours less leave", () => {
    const s = { dailyHours: 8, workDays: [1, 2, 3, 4, 5] };
    expect(capacity(weekDays("2026-10-19"), s)).toBe(40 * 60);
    expect(capacity(weekDays("2026-10-19"), s, 1.5)).toBe(28 * 60);
  });
  it("works out an hour's cost from a yearly CTC", () => {
    // ₹12 lakh a year, 5 days × 8 hours: 1,200,000 / 12 / (5 × 52/12 × 8) ≈ ₹576.92
    expect(hourlyCost(12_00_000_00, { dailyHours: 8, workDays: [1, 2, 3, 4, 5] })).toBe(57692);
  });
});

describe("billing time", () => {
  const e = (id: string, minutes: number, rate: number, task: string, user = "Asha", date = "2026-10-20") => ({ id, minutes, rate, taskId: task, taskTitle: task, userName: user, date, note: "" });
  it("groups by task and keeps different rates on their own lines", () => {
    const lines = billLines([e("a", 60, 100000, "Design"), e("b", 30, 100000, "Design", "Asha", "2026-10-22"), e("c", 60, 150000, "Design", "Ravi")], "task");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: "Design", hours: 1.5, amount: 150000, from: "2026-10-20", to: "2026-10-22" });
    expect(lines[1]).toMatchObject({ hours: 1, amount: 150000 });
  });
  it("rounds each entry up when asked, and prices hours as the invoice will", () => {
    expect(roundUp(7, 15)).toBe(15);
    expect(roundUp(7, 0)).toBe(7);
    const [l] = billLines([e("a", 7, 120000, "Call"), e("b", 22, 120000, "Call")], "single", 15, "Services");
    expect(l).toMatchObject({ name: "Services", minutes: 45, hours: 0.75, amount: 90000 });
    // 47 minutes is 0.783h on the invoice.
    expect(billLines([e("a", 47, 200000, "X")], "task")[0].amount).toBe(156600);
  });
  it("measures budget burn by money first, then hours", () => {
    expect(burn({ budgetHours: 10, budgetAmount: 0 }, { minutes: 300, amount: 0 })).toBe(0.5);
    expect(burn({ budgetHours: 10, budgetAmount: 100000 }, { minutes: 300, amount: 150000 })).toBe(1.5);
    expect(burn({ budgetHours: 0, budgetAmount: 0 }, { minutes: 300, amount: 0 })).toBeNull();
  });
});
