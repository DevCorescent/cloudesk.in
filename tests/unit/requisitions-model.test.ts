import { describe, expect, it } from "vitest";
import { composeEmail, daysToDue, matchByName, newText, nextReminder, progressOf, refIn, scheduleSchema } from "@/lib/requisitions/model";

const S = scheduleSchema.parse({ everyDays: 2, at: "10:30", weekdaysOnly: true });
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");

describe("the reminder schedule", () => {
  it("goes every N days at the set India time", () => {
    // Monday 3 Nov 2026, 15:00 IST → Wednesday 10:30 IST.
    expect(ist(nextReminder(new Date("2026-11-02T09:30:00Z"), S))).toBe("2026-11-04 10:30");
  });
  it("moves past weekends when asked", () => {
    // Thursday + 2 days = Saturday → Monday.
    expect(ist(nextReminder(new Date("2026-11-05T05:00:00Z"), S))).toBe("2026-11-09 10:30");
    expect(ist(nextReminder(new Date("2026-11-05T05:00:00Z"), { ...S, weekdaysOnly: false }))).toBe("2026-11-07 10:30");
  });
  it("never goes before a hold (a quiet spell after a reply, or a promised date)", () => {
    const hold = new Date("2026-11-12T00:00:00+05:30");
    expect(ist(nextReminder(new Date("2026-11-02T09:30:00Z"), S, hold))).toBe("2026-11-12 10:30");
  });
  it("counts days to the due date in India time", () => {
    expect(daysToDue("2026-11-10", new Date("2026-11-09T20:00:00Z"))).toBe(0); // already the 10th in India
    expect(daysToDue("2026-11-08", new Date("2026-11-09T06:00:00Z"))).toBe(-1);
    expect(daysToDue(null)).toBeNull();
  });
});

describe("the emails", () => {
  const base = { n: 0, max: 6, escalate: true, business: "Rao & Co", number: "REQ-0007", title: "ITR documents", message: "", clientName: "Asha Kulkarni", dueDate: "2026-11-20", link: "https://cloudesk.in/collect/x.y", signOff: "", sender: "Meera, Rao & Co", now: new Date("2026-11-09T05:00:00Z") };
  const items = [
    { title: "PAN card", description: "", status: "pending" as const, required: true, note: "" },
    { title: "Form 16", description: "From each employer", status: "received" as const, required: true, note: "" },
    { title: "Bank statement", description: "", status: "rejected" as const, required: true, note: "Pages 3–4 are missing" },
    { title: "Rent receipts", description: "", status: "pending" as const, required: false, note: "" },
  ];
  it("asks once, with every item, the link and the number to thread replies", () => {
    const e = composeEmail({ ...base, kind: "request", items });
    expect(e.subject).toBe("ITR documents — documents needed [REQ-0007]");
    expect(e.body).toMatch(/^Hi Asha,/);
    expect(e.body).toContain("• PAN card");
    expect(e.body).toContain("(Please send this again: Pages 3–4 are missing)");
    expect(e.body).toContain("If you have them (optional):");
    expect(e.body).toContain(base.link);
    expect(e.body).toContain("by 20 November 2026");
  });
  it("keeps reminders in the same conversation, firmer as they go, and says the last is the last", () => {
    const r1 = composeEmail({ ...base, kind: "reminder", n: 1, items });
    expect(r1.subject).toBe("Re: ITR documents — documents needed [REQ-0007]");
    expect(r1.body).toContain("A gentle reminder");
    expect(r1.body).toContain("Already received — thank you: Form 16.");
    expect(r1.body).not.toContain("• Form 16");
    expect(composeEmail({ ...base, kind: "reminder", n: 3, items }).body).toContain("We're still waiting");
    const last = composeEmail({ ...base, kind: "reminder", n: 6, items });
    expect(last.subject).toBe("Final reminder: ITR documents — documents needed [REQ-0007]");
    expect(last.body).toContain("This is our last reminder");
  });
  it("finds the number in a reply's subject", () => {
    expect(refIn("Re: Re: ITR documents — documents needed [REQ-0007]")).toBe("REQ-0007");
    expect(refIn("Hello")).toBeNull();
  });
});

describe("reading a reply without AI", () => {
  const items = [{ id: "pan", title: "PAN card" }, { id: "bank", title: "Bank statements" }, { id: "f16", title: "Form 16" }, { id: "aad", title: "Aadhaar card" }];
  it("matches attachments to items by name (plural or not), surest when every word matches", () => {
    const m = matchByName(items, "Hi, please find attached.", ["PAN_Asha.pdf", "bank statement oct.pdf"]);
    expect(m.find((x) => x.id === "pan")).toMatchObject({ confidence: 0.85, reason: "Attached as PAN_Asha.pdf" });
    expect(m.find((x) => x.id === "bank")?.confidence).toBe(0.85);
    expect(m.find((x) => x.id === "f16")).toBeUndefined();
  });
  it("gives each attachment to the one item it fits best, and none when it fits two equally", () => {
    const two = [{ id: "sales", title: "Sales invoices" }, { id: "buy", title: "Purchase invoices" }];
    expect(matchByName(two, "", ["sales-invoices-oct.zip"]).map((x) => x.id)).toEqual(["sales"]);
    expect(matchByName(two, "", ["invoices.zip"])).toEqual([]);
  });
  it("counts a mention only when they say they've sent it, and only weakly", () => {
    expect(matchByName(items, "I have sent the Form 16 separately.", []).find((x) => x.id === "f16")?.confidence).toBe(0.55);
    expect(matchByName(items, "I will get the Form 16 next week.", [])).toEqual([]);
  });
  it("reads only the new part of a reply", () => {
    expect(newText("Attached the PAN.\n\nOn Mon, 9 Nov 2026 at 10:30, Rao & Co wrote:\n> Hi Asha\n> We need the PAN card")).toBe("Attached the PAN.");
  });
  it("measures progress over required items, leaving out what isn't needed", () => {
    expect(progressOf([{ status: "received", required: true }, { status: "pending", required: true }, { status: "waived", required: true }, { status: "pending", required: false }])).toEqual({ got: 1, of: 2, pct: 50 });
  });
});
