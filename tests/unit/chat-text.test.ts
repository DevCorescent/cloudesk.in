import { describe, expect, it } from "vitest";
import { parseWhen, pipeParts, safeLink } from "@/lib/chat/model";
import { bigEmoji, extract, parse, plain, preview, recordToken, userToken } from "@/lib/chat/text";

const U = "11111111-2222-3333-4444-555555555555";

describe("chat text", () => {
  it("finds people, records, topics and @everyone — not inside code", () => {
    const body = `Hi ${userToken(U, "Ravi Kumar")}, see ${recordToken("invoices", "abc", "INV/0042")} #Pricing #q4-plan @here \`#notatag @[X](u:${U.replace("1", "9")})\``;
    expect(extract(body)).toEqual({ users: [U], everyone: true, records: [{ kind: "invoices", id: "abc", label: "INV/0042" }], tags: ["pricing", "q4-plan"] });
    expect(extract("Email me at a@b.in, issue #12 and C# code").tags).toEqual([]);
    expect(extract("nobody@everyone.com").everyone).toBe(false);
  });

  it("turns tokens into plain words for previews", () => {
    expect(plain(`**Hi** ${userToken(U, "Ravi")} — ${recordToken("deals", "d1", "Taj deal")} _now_`)).toBe("Hi @Ravi — Taj deal now");
    expect(preview("a ".repeat(200), 20)).toHaveLength(20);
  });

  it("parses blocks and inline formatting without HTML", () => {
    const b = parse("Hello **bold _both_** and `x<y`\n> quoted\n- one\n- two\n```\n<script>\n```\nhttps://cloudesk.in/x.");
    expect(b.map((x) => x.b)).toEqual(["p", "quote", "ul", "code", "p"]);
    expect(b[0]).toMatchObject({ tokens: [{ t: "text", v: "Hello " }, { t: "bold" }, { t: "text", v: " and " }, { t: "code", v: "x<y" }] });
    expect((b[0] as { tokens: { t: string; children?: { t: string }[] }[] }).tokens[1]!.children!.map((c) => c.t)).toEqual(["text", "text", "italic"]);
    expect(b[3]).toEqual({ b: "code", v: "<script>" });
    expect(b[4]).toMatchObject({ tokens: [{ t: "link", href: "https://cloudesk.in/x" }, { t: "text", v: "." }] });
    expect(parse("snake_case_name stays")[0]).toMatchObject({ tokens: [{ t: "text", v: "snake_case_name stays" }] });
  });

  it("spots emoji-only messages", () => {
    expect(bigEmoji("🎉🎉")).toBe(true);
    expect(bigEmoji("👍🏽")).toBe(true);
    expect(bigEmoji("ok 👍")).toBe(false);
    expect(bigEmoji("1")).toBe(false);
  });
});

describe("chat model", () => {
  const now = new Date(2026, 9, 26, 10, 0); // Monday 26 Oct 2026, 10:00 local

  it("reads reminder times", () => {
    expect(parseWhen("in 30m", now)!.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(parseWhen("in 2 hours", now)!.getTime() - now.getTime()).toBe(2 * 3_600_000);
    expect(parseWhen("tomorrow", now)!.toString()).toBe(new Date(2026, 9, 27, 9, 0).toString());
    expect(parseWhen("tomorrow 4:30pm", now)!.toString()).toBe(new Date(2026, 9, 27, 16, 30).toString());
    expect(parseWhen("friday", now)!.toString()).toBe(new Date(2026, 9, 30, 9, 0).toString());
    expect(parseWhen("monday", now)!.toString()).toBe(new Date(2026, 10, 2, 9, 0).toString());
    expect(parseWhen("5pm", now)!.toString()).toBe(new Date(2026, 9, 26, 17, 0).toString());
    expect(parseWhen("9am", now)!.toString()).toBe(new Date(2026, 9, 27, 9, 0).toString());
    expect(parseWhen("someday", now)).toBeNull();
    expect(parseWhen("tomorrow 25pm", now)).toBeNull();
  });

  it("keeps shared links inside the app", () => {
    expect(safeLink("/crm/deals/1")).toBe("/crm/deals/1");
    expect(safeLink("//evil.example")).toBe("");
    expect(safeLink("https://evil.example")).toBe("");
    expect(safeLink("javascript:alert(1)")).toBe("");
    expect(pipeParts(" Lunch? | Thali |  | Pizza ")).toEqual(["Lunch?", "Thali", "Pizza"]);
  });
});
