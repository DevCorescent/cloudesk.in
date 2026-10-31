import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, durationText, fillCanned, settingsSchema, stats, stripQuoted, ticketRef } from "@/lib/helpdesk/model";

// Business time in India: Mon–Fri 09:30–18:30 here, with a holiday.
const hours = { days: [1, 2, 3, 4, 5], start: "09:30", end: "18:30" };
const ist = (s: string) => new Date(`${s}+05:30`);
const iso = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

describe("business hours", () => {
  it("adds minutes inside the day, across the evening, the weekend and a holiday", () => {
    expect(iso(addBusinessMinutes(ist("2026-10-22T10:00:00"), 120, hours))).toBe("2026-10-22 12:00");
    // Thursday 17:30 + 2h: one hour Thursday, one Friday morning.
    expect(iso(addBusinessMinutes(ist("2026-10-22T17:30:00"), 120, hours))).toBe("2026-10-23 10:30");
    // Friday 18:00 + 1h: half an hour Friday, then Monday.
    expect(iso(addBusinessMinutes(ist("2026-10-23T18:00:00"), 60, hours))).toBe("2026-10-26 10:00");
    // Before opening starts at opening; a holiday Monday is skipped.
    expect(iso(addBusinessMinutes(ist("2026-10-24T08:00:00"), 30, hours, ["2026-10-26"]))).toBe("2026-10-27 10:00");
    // Exactly to closing stays on that day.
    expect(iso(addBusinessMinutes(ist("2026-10-22T09:30:00"), 540, hours))).toBe("2026-10-22 18:30");
  });

  it("counts minutes between, and agrees with adding", () => {
    expect(businessMinutesBetween(ist("2026-10-23T18:00:00"), ist("2026-10-26T10:00:00"), hours)).toBe(60);
    expect(businessMinutesBetween(ist("2026-10-24T10:00:00"), ist("2026-10-25T20:00:00"), hours)).toBe(0);
    expect(businessMinutesBetween(ist("2026-10-26T10:00:00"), ist("2026-10-23T10:00:00"), hours)).toBe(0);
    const from = ist("2026-10-21T15:47:00");
    for (const m of [1, 59, 540, 1000, 5000]) expect(businessMinutesBetween(from, addBusinessMinutes(from, m, hours, ["2026-10-26"]), hours, ["2026-10-26"])).toBe(m);
  });

  it("says durations in working days", () => {
    expect(durationText(45, hours)).toBe("45 min");
    expect(durationText(200, hours)).toBe("3 h 20 min");
    expect(durationText(540 * 2 + 60, hours)).toBe("2 working days 1 h");
    expect(durationText(0, hours)).toBe("0 min");
  });

  it("refuses hours that close before they open", () => {
    expect(settingsSchema.safeParse({ hours: { start: "18:00", end: "09:00" } }).success).toBe(false);
    expect(settingsSchema.parse({}).sla.urgent).toEqual({ first: 30, resolve: 240 });
  });
});

describe("email threading", () => {
  it("finds the ticket number in a reply subject", () => {
    expect(ticketRef("Re: Printer jammed [HD-0042]", "HD-")).toBe("HD-0042");
    expect(ticketRef("RE: fwd: [hd-7] help", "HD-")).toBe("HD-7");
    expect(ticketRef("Order 42 question", "HD-")).toBeNull();
    expect(ticketRef("[T.1] x", "T.")).toBe("T.1");
  });
  it("keeps only the new part of a reply", () => {
    expect(stripQuoted("Thanks, that worked!\n\nOn Mon, 26 Oct 2026 at 10:00, Support <s@x.in> wrote:\n> Try restarting")).toBe("Thanks, that worked!");
    expect(stripQuoted("Still broken.\r\n-----Original Message-----\r\nFrom: Support")).toBe("Still broken.");
    expect(stripQuoted("Line one\n> quoted")).toBe("Line one");
  });
  it("fills saved replies", () => {
    expect(fillCanned("Hi {{name}}, about {{ ticket }} — {{agent}}{{other}}", { name: "Asha", ticket: "HD-0001", agent: "Om" })).toBe("Hi Asha, about HD-0001 — Om{{other}}");
  });
});

describe("helpdesk reports", () => {
  it("works out targets met, average times and satisfaction", () => {
    const t = (o: object) => ({ createdAt: ist("2026-10-22T10:00:00"), firstRespondedAt: null, resolvedAt: null, firstResponseDue: null, resolveDue: null, firstBreached: false, resolveBreached: false, csat: null, status: "open" as const, ...o });
    const s = stats([t({ firstRespondedAt: ist("2026-10-22T10:30:00"), resolvedAt: ist("2026-10-22T12:00:00"), status: "resolved", csat: 5 }), t({ firstRespondedAt: ist("2026-10-22T17:30:00"), firstBreached: true, csat: 2 }), t({})], hours);
    expect(s).toEqual({ tickets: 3, open: 2, firstMet: 50, resolveMet: 100, avgFirst: 240, avgResolve: 120, csat: 3.5, happy: 50, rated: 2 });
  });
});

describe("the SLA clock", async () => {
  const { transition } = await import("@/lib/helpdesk/model");
  const s = { hours, holidays: [] };
  const base = { status: "open" as const, resolveDue: ist("2026-10-22T16:00:00"), pausedAt: null, remainingMins: null, resolvedAt: null, closedAt: null, resolveBreached: false };
  it("stops while waiting on the customer and restarts with the time that was left", () => {
    const paused = transition(base, "pending", ist("2026-10-22T14:00:00"), s);
    expect(paused).toMatchObject({ status: "pending", remainingMins: 120, closedAt: null });
    const back = transition({ ...base, ...paused, status: "pending" }, "open", ist("2026-10-23T18:00:00"), s);
    // 30 minutes Friday evening, 90 on Monday.
    expect(iso(back.resolveDue!)).toBe("2026-10-26 11:00");
    expect(back).toMatchObject({ pausedAt: null, remainingMins: null });
  });
  it("stamps resolving and closing, and marks a late resolution", () => {
    const late = transition(base, "resolved", ist("2026-10-22T17:00:00"), s);
    expect(late).toMatchObject({ resolveBreached: true, remainingMins: 0 });
    expect(late.resolvedAt).toEqual(ist("2026-10-22T17:00:00"));
    const closed = transition({ ...base, ...late, status: "resolved" }, "closed", ist("2026-10-23T10:00:00"), s);
    expect(closed.closedAt).toEqual(ist("2026-10-23T10:00:00"));
    expect(closed.resolvedAt).toBeUndefined();
    expect(transition(base, "open", new Date(), s)).toEqual({});
  });
});
