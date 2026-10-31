import { describe, expect, it } from "vitest";
import { emailBlocks, textToBlocks, writtenPart } from "@/lib/mail/links";

describe("an email as a note", () => {
  it("keeps what was written, not the history or the signature", () => {
    expect(writtenPart("Sure, Thursday works.\n\nRavi\n-- \nRavi Kumar | Saffron\n\nOn Mon, 2 Nov 2026, Asha wrote:\n> Can we meet?")).toBe("Sure, Thursday works.\n\nRavi");
    expect(writtenPart("Done.\n\n-----Original Message-----\nFrom: x")).toBe("Done.");
    expect(writtenPart("Yes\nFrom: Asha <a@b.in>\nSent: Monday\nOld")).toBe("Yes");
    expect(writtenPart("Line\n> quoted\nMore")).toBe("Line\nMore");
  });

  it("turns lists into list blocks, even right under a line of text", () => {
    const b = textToBlocks("We agreed:\n- designs Friday\n- ads on the 5th\n\nSteps:\n1. Approve\n2) Publish");
    expect(b.map((x) => [x.type, x.text])).toEqual([["p", "We agreed:"], ["bullet", "designs Friday"], ["bullet", "ads on the 5th"], ["p", "Steps:"], ["number", "Approve"], ["number", "Publish"]]);
  });

  it("links back to the email and lists its attachments", () => {
    const b = emailBlocks({ orgId: "o1", threadId: "t1", subject: "Plan", attachments: true, messages: [{ id: "m1", fromName: "Asha", fromAddress: "a@b.in", date: "2026-11-02T04:30:00Z", text: "Hi", attachments: [{ id: "f1", filename: "plan [v2].pdf" }] }] });
    expect(b[0]).toMatchObject({ type: "record", text: "Plan", url: "/mail/t/t1", module: "Email" });
    expect(b.at(-1)).toMatchObject({ type: "bullet", text: "[plan v2.pdf](/api/v1/orgs/o1/mail/attachments/f1)" });
    const s = emailBlocks({ orgId: "o1", threadId: "t1", subject: "Plan", attachments: false, messages: [], summary: "Short.", actions: [{ text: "Reply to Asha" }] });
    expect(s.map((x) => x.type)).toEqual(["record", "h3", "p", "h3", "todo"]);
  });
});
