import { describe, expect, it } from "vitest";
import { crmNoteInput, resultText, titleFrom, toView, TOOLS, withQuestion } from "@/lib/copilot/model";
import { parseMarkdown } from "@/lib/copilot/markdown";

describe("copilot model", () => {
  it("titles a conversation from its first question", () => {
    expect(titleFrom("  Which   customers owe us the most? ")).toBe("Which customers owe us the most?");
    const long = titleFrom("How did our sales in Pune compare with Mumbai over the last three quarters, by product line?");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
    expect(titleFrom("   ")).toBe("New conversation");
  });

  it("shows questions, answers and the tools used, and marks tools that failed", () => {
    const view = toView([
      { role: "user", content: "Sales?" },
      { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "tool_use", id: "t1", name: "run_report", input: { dataset: "invoices" } }, { type: "tool_use", id: "t2", name: "search_records", input: { query: "Asha" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }, { type: "tool_result", tool_use_id: "t2", content: "bad", is_error: true }] },
      { role: "assistant", content: [{ type: "text", text: "₹1,20,000 this month." }] },
    ]);
    expect(view).toEqual([
      { role: "user", text: "Sales?" },
      { role: "tool", name: "run_report", label: "Ran a report on invoices", toolUseId: "t1", failed: false },
      { role: "tool", name: "search_records", label: "Searched for “Asha”", toolUseId: "t2", failed: true },
      { role: "assistant", text: "₹1,20,000 this month." },
    ]);
  });

  it("adds a question to a history, in the same turn when it ends on tool results", () => {
    expect(withQuestion([], "Hi")).toEqual([{ role: "user", content: "Hi" }]);
    const ended = [{ role: "assistant", content: [] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] }];
    const next = withQuestion(ended, "And now?");
    expect(next).toHaveLength(2);
    expect((next[1] as { content: unknown[] }).content).toEqual([{ type: "tool_result", tool_use_id: "x", content: "ok" }, { type: "text", text: "And now?" }]);
  });

  it("writes a report result as text with rupees and a total", () => {
    const t = resultText({ columns: [{ label: "Stage", type: "text" }, { label: "Count", type: "count" }, { label: "Total value", type: "money" }], rows: [["New", 2, 150000_00], ["Won", 1, 50000_00]], totals: [null, 3, 200000_00], range: { from: "2026-10-01", to: "2026-10-25" }, truncated: false });
    expect(t).toBe("Dates: 2026-10-01 to 2026-10-25\nStage | Count | Total value\nNew | 2 | ₹1,50,000\nWon | 1 | ₹50,000\nTotal | 3 | ₹2,00,000");
    const many = resultText({ columns: [{ label: "N", type: "number" }], rows: Array.from({ length: 5 }, (_, i) => [i]), totals: [null], range: { from: null, to: null }, truncated: true }, 2);
    expect(many).toContain("…3 more rows not shown");
    expect(many).toContain("(More rows exist than the limit.)");
  });

  it("needs a record for a note, and offers its tools", () => {
    expect(crmNoteInput.safeParse({ body: "Called" }).success).toBe(false);
    expect(crmNoteInput.safeParse({ body: "Called", dealId: "7b1c1c55-8d0e-4c43-9c39-1d2f6d6c1e10" }).success).toBe(true);
    expect(TOOLS.map((t) => t.name)).toEqual(["list_datasets", "run_report", "search_records", "find_anomalies", "propose_action", "mail_accounts", "mail_search", "mail_read", "mail_briefing", "calendar_upcoming", "invoices_list", "identify_document", "extract_bill", "setup_status", "knowledge_search", "dashboard_overview", "trend", "mail_analytics", "recall_conversations", "show_chart", "suggest_next", "remember"]);
  });
});

describe("copilot markdown", () => {
  it("parses paragraphs, lists, tables and emphasis", () => {
    const md = parseMarkdown("**Top customers**\n\n| Customer | Owes |\n|---|---:|\n| Asha | ₹10 |\n| Ravi | ₹5 |\n\n- one `x`\n- two\n1. first\n\nDone.");
    expect(md.map((b) => b.type)).toEqual(["p", "table", "ul", "ol", "p"]);
    expect(md[0]).toEqual({ type: "p", inline: [{ text: "Top customers", bold: true }] });
    expect(md[1]).toMatchObject({ type: "table", head: [[{ text: "Customer" }], [{ text: "Owes" }]], rows: [[[{ text: "Asha" }], [{ text: "₹10" }]], [[{ text: "Ravi" }], [{ text: "₹5" }]]] });
    expect(md[2]).toEqual({ type: "ul", items: [[{ text: "one " }, { text: "x", code: true }], [{ text: "two" }]] });
  });
  it("leaves HTML as text", () => {
    expect(parseMarkdown("<img src=x onerror=alert(1)>")).toEqual([{ type: "p", inline: [{ text: "<img src=x onerror=alert(1)>" }] }]);
  });
});

describe("checks on the books", () => {
  const bill = (id: string, supplier: string, billNo: string, total: number, date: string) => ({ id, number: `BILL-${id}`, supplier, billNo, total, date });
  it("finds the same supplier bill entered twice, by number or amount and date", async () => {
    const { duplicateBills } = await import("@/lib/copilot/anomalies");
    const found = duplicateBills([bill("1", "Sharma Packaging", "SP/0042", 5000_00, "2026-10-01"), bill("2", "sharma packaging", "SP-42", 5100_00, "2026-10-09"), bill("3", "Sharma Packaging", "", 7000_00, "2026-10-10"), bill("4", "Sharma Packaging", "", 7000_00, "2026-10-12"), bill("5", "Other Co", "SP/0042", 5000_00, "2026-10-01"), bill("6", "Sharma Packaging", "", 7000_00, "2026-10-20")]);
    expect(found.map((f) => f.link)).toEqual(["/accounts/bills/2", "/accounts/bills/4"]);
    expect(found[0].detail).toBe("BILL-2 has the same supplier bill number (SP-42) as BILL-1.");
    expect(found[1].detail).toBe("BILL-4 is for the same amount (₹7,000) as BILL-3, 2 day(s) apart.");
  });
  it("flags a recent bill far above the supplier's usual, once there's history", async () => {
    const { largeBills } = await import("@/lib/copilot/anomalies");
    const history = [1000, 1200, 900, 1100].map((t, i) => bill(`h${i}`, "Power Co", "", t * 100, `2026-0${i + 5}-01`));
    expect(largeBills([...history, bill("x", "Power Co", "", 4000_00, "2026-10-20")], "2026-09-25").map((f) => f.detail)).toEqual(["BILL-x is ₹4,000; their bills are usually around ₹1,050 (3.8×)."]);
    expect(largeBills([...history, bill("y", "Power Co", "", 3000_00, "2026-10-20")], "2026-09-25")).toEqual([]);
    expect(largeBills([...history.slice(0, 3), bill("z", "Power Co", "", 9000_00, "2026-10-20")], "2026-09-25")).toEqual([]);
  });
  it("flags an expense account well ahead of its recent months", async () => {
    const { expenseSpikes } = await import("@/lib/copilot/anomalies");
    const rows = [{ accountId: "a", name: "Travel", month: "2026-07", amount: 20000_00 }, { accountId: "a", name: "Travel", month: "2026-08", amount: 10000_00 }, { accountId: "a", name: "Travel", month: "2026-10", amount: 45000_00 }, { accountId: "b", name: "Rent", month: "2026-09", amount: 2000_00 }, { accountId: "b", name: "Rent", month: "2026-10", amount: 6000_00 }];
    const f = expenseSpikes(rows, "2026-10");
    // Rent tripled, but only by ₹4,000: under the ₹10,000 floor.
    expect(f.map((x) => x.title)).toEqual(["Travel is running high"]);
    expect(f[0].detail).toBe("₹45,000 so far this month against an average of ₹15,000 over the 2 month(s) before.");
  });
});

describe("charts and follow-ups in answers", () => {
  it("keeps a chart only when every series has a value per label, trimmed to sane sizes", async () => {
    const { chartOf, nextOf } = await import("@/lib/copilot/model");
    expect(chartOf({ title: "Sales", kind: "line", unit: "money", labels: ["Sep", "Oct"], series: [{ name: "Sales", values: [1200, "1500"] }] })).toEqual({ title: "Sales", kind: "line", unit: "money", labels: ["Sep", "Oct"], series: [{ name: "Sales", values: [1200, 1500] }] });
    expect(chartOf({ title: "x", kind: "bar", unit: "number", labels: ["a", "b"], series: [{ name: "y", values: [1] }] })).toBeNull();
    expect(chartOf({ title: "x", kind: "bar", unit: "number", labels: [], series: [] })).toBeNull();
    // Unknown kinds and units fall back rather than failing.
    expect(chartOf({ title: "x", kind: "radar", unit: "kg", labels: ["a"], series: [{ name: "", values: [Number.NaN] }] })).toEqual({ title: "x", kind: "bar", unit: "number", labels: ["a"], series: [{ name: "Value", values: [0] }] });
    expect(nextOf({ prompts: ["  One ", "", "Two", "Three", "Four", "Five"] })).toEqual(["One", "Two", "Three", "Four"]);
    expect(nextOf({})).toEqual([]);
  });

  it("shows a chart and the follow-ups where the model drew them, and hides their tool calls", async () => {
    const { toView } = await import("@/lib/copilot/model");
    const view = toView([
      { role: "user", content: "Chart it" },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "show_chart", input: { title: "T", kind: "pie", unit: "percent", labels: ["A", "B"], series: [{ name: "Share", values: [60, 40] }] } }, { type: "tool_use", id: "n1", name: "suggest_next", input: { prompts: ["More"] } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "ok" }, { type: "tool_result", tool_use_id: "n1", content: "ok" }] },
      { role: "assistant", content: [{ type: "text", text: "A leads." }] },
    ]);
    expect(view).toEqual([
      { role: "user", text: "Chart it" },
      { role: "chart", chart: { title: "T", kind: "pie", unit: "percent", labels: ["A", "B"], series: [{ name: "Share", values: [60, 40] }] } },
      { role: "next", prompts: ["More"] },
      { role: "assistant", text: "A leads." },
    ]);
  });
});
