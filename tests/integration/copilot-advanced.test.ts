import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { call, cookieFrom, resetDb } from "../helpers";

// The copilot's analysis, mail and memory tools, with a stand-in model: a
// monthly trend with a projection, the dashboard and email analytics as text,
// charts and follow-ups that show in the conversation, tidying email, reminders
// and notes that change nothing until confirmed, and earlier conversations it
// can look back on — with what it learned about the person sent along.
let orgId = "";
let cookie = "";
let threadId = "";
let accountId = "";
const A = (method: string, path: string, body?: unknown) => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/copilot/${path}`, params: { orgId, slug: path.split("?")[0]!.split("/").filter(Boolean) } });

type Req = { system: { text: string }[]; messages: { role: string; content: unknown }[] };
type Reply = { content: unknown[]; stop_reason: string };
let script: ((r: Req) => Reply)[] = [];
const requests: Req[] = [];
const toolUse = (id: string, name: string, input: unknown): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });
const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const propose = (id: string, kind: string, input: unknown) => toolUse(id, "propose_action", { kind, summary: kind, input });
const result = (r: Req) => (r.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]!;

async function ask(text: string, turns: ((r: Req) => Reply)[], thread?: string) {
  script = turns;
  const r = await A("POST", thread ? `threads/${thread}/messages` : "threads", { text });
  expect(r.status).toBe(200);
  return r.json as { id: string; items: { role: string; [k: string]: unknown }[]; actions: { id: string; kind: string; status: string }[] };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kavya Rao", email: "kavya.adv@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "kavya.adv@example.com"));
  const [acc] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: u!.id, name: "Work", address: "kavya@rao.in", displayName: "Kavya Rao", provider: "custom", imapHost: "imap.rao.in", imapPort: 993, smtpHost: "smtp.rao.in", smtpPort: 465, username: "k", secretEnc: "x", status: "active" } as never).returning();
  accountId = acc!.id;
  const [t] = await db.insert(schema.mailThreads).values({ orgId, accountId, subject: "Weekly deals newsletter", normSubject: "weekly deals newsletter", participants: [{ name: "Deals Daily", address: "news@deals.in" }], snippet: "This week's offers", messageCount: 1, unread: 1, lastMessageAt: new Date(), lastDirection: "in", category: "newsletters" } as never).returning();
  threadId = t!.id;
  await db.insert(schema.mailMessages).values({ orgId, accountId, threadId, messageId: "<n1@deals.in>", fromAddress: "news@deals.in", fromName: "Deals Daily", to: [{ name: "", address: "kavya@rao.in" }], cc: [], subject: "Weekly deals newsletter", date: new Date(), text: "This week's offers", direction: "in" } as never);
  // Contacts made over the last few months, for a trend to count.
  for (const [months, n] of [[3, 2], [2, 4], [1, 6]] as const) {
    const at = new Date();
    at.setUTCDate(10);
    at.setUTCMonth(at.getUTCMonth() - months);
    for (let i = 0; i < n; i++) await db.insert(schema.crmContacts).values({ orgId, name: `Lead ${months}-${i}`, createdAt: at } as never);
  }
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (params: unknown) => ({ on: () => {}, finalMessage: async () => {
    const r = JSON.parse(JSON.stringify(params)) as Req;
    requests.push(r);
    const next = script.shift();
    if (!next) throw new Error("No scripted reply left");
    return { ...next(r), model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 10 } };
  } }) } } }) as never);
});
afterEach(() => {
  script = [];
});
afterAll(async () => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
  await closeDb();
});

describe("the copilot's analysis tools", () => {
  it("works out a monthly trend with growth, pace and a projection", async () => {
    let out = "";
    await ask("How are new leads trending?", [() => toolUse("t1", "trend", { dataset: "contacts", measure: { agg: "count" }, months: 6 }), (r) => ((out = result(r).content), say("Leads are rising."))]);
    expect(out).toContain("Contacts — ");
    expect(out).toMatch(/Last complete month 6, up 50% on the month before/);
    expect(out).toMatch(/Average month/);
    expect(out).toMatch(/Straight-line projection: /);
    expect(out).toMatch(/This month so far 0/);
  });

  it("refuses a trend on a dataset that isn't there", async () => {
    let r0: { content: string } = { content: "" };
    await ask("Trend of nothing", [() => toolUse("t2", "trend", { dataset: "nope", measure: { agg: "count" } }), (r) => ((r0 = result(r)), say("I couldn't."))]);
    expect(r0.content).toMatch(/Unknown dataset/);
  });

  it("reads the dashboard and email analytics as text", async () => {
    let dash = "";
    let mail = "";
    await ask("How's everything?", [
      () => ({ content: [{ type: "tool_use", id: "d1", name: "dashboard_overview", input: {} }, { type: "tool_use", id: "m1", name: "mail_analytics", input: { days: 30 } }], stop_reason: "tool_use" }),
      (r) => {
        const rs = r.messages.at(-1)!.content as { content: string }[];
        dash = rs[0]!.content;
        mail = rs[1]!.content;
        return say("Here's the picture.");
      },
    ]);
    expect(dash).toMatch(/Headline figures|No headline figures/);
    expect(mail).toContain("Email, last 30 days");
    expect(mail).toMatch(/Received 1 \(0\)/);
    expect(mail).toContain("Top senders: Deals Daily 1");
  });

  it("shows charts and follow-ups in the conversation, and turns away a chart that doesn't add up", async () => {
    let bad: { content: string; is_error?: boolean } = { content: "" };
    const t = await ask("Chart leads by month", [
      () => toolUse("c0", "show_chart", { title: "Broken", kind: "bar", unit: "number", labels: ["Aug", "Sep"], series: [{ name: "Leads", values: [1] }] }),
      (r) => ((bad = result(r)), toolUse("c1", "show_chart", { title: "New leads by month", kind: "bar", unit: "number", labels: ["Aug", "Sep", "Oct"], series: [{ name: "Leads", values: [2, 4, 6] }] })),
      () => toolUse("n1", "suggest_next", { prompts: ["Show it as money", "Draft follow-ups for new leads", "", "Compare with last year", "One too many"] }),
      () => say("Leads tripled in three months."),
    ]);
    expect(bad.is_error).toBe(true);
    expect(t.items.filter((i) => i.role === "chart")).toEqual([{ role: "chart", chart: { title: "New leads by month", kind: "bar", unit: "number", labels: ["Aug", "Sep", "Oct"], series: [{ name: "Leads", values: [2, 4, 6] }] } }]);
    expect(t.items.find((i) => i.role === "next")).toEqual({ role: "next", prompts: ["Show it as money", "Draft follow-ups for new leads", "Compare with last year", "One too many"] });
    expect(t.items.at(-1)).toEqual({ role: "assistant", text: "Leads tripled in three months." });
  });
});

describe("the copilot's mail, reminder and note actions", () => {
  it("archives email only when confirmed, and sets a follow-up", async () => {
    const t = await ask("Archive my newsletters", [() => propose("a1", "mail_tidy", { threadIds: [threadId], action: "archive" }), () => say("Ready to archive 1 newsletter.")]);
    const a = t.actions.at(-1)!;
    expect(a).toMatchObject({ kind: "mail_tidy", status: "proposed" });
    let [row] = await db.select().from(schema.mailThreads).where(eq(schema.mailThreads.id, threadId));
    expect(row!.status).toBe("inbox");
    const done = await A("POST", `actions/${a.id}/confirm`, {});
    expect(done.status).toBe(200);
    expect(done.json.link).toBe(`/mail/t/${threadId}`);
    [row] = await db.select().from(schema.mailThreads).where(eq(schema.mailThreads.id, threadId));
    expect(row!.status).toBe("archived");

    const f = await ask("Remind me if they don't reply by Friday", [() => propose("a2", "mail_tidy", { threadIds: [threadId], action: "followup", value: "2030-01-04T10:00:00+05:30" }), () => say("Follow-up ready.")]);
    expect((await A("POST", `actions/${f.actions.at(-1)!.id}/confirm`, {})).status).toBe(200);
    [row] = await db.select().from(schema.mailThreads).where(eq(schema.mailThreads.id, threadId));
    expect(row!.followUpAt?.toISOString()).toBe("2030-01-04T04:30:00.000Z");
  });

  it("checks a tidy before proposing it: a snooze needs a time", async () => {
    let r0: { content: string; is_error?: boolean } = { content: "" };
    await ask("Snooze it", [() => propose("a3", "mail_tidy", { threadIds: [threadId], action: "snooze" }), (r) => ((r0 = result(r)), say("When?"))]);
    expect(r0.is_error).toBe(true);
    expect(r0.content).toMatch(/Say when/);
  });

  it("sets a reminder and saves a note in Notes once confirmed", async () => {
    const r = await ask("Remind me to call Sharma", [() => propose("r1", "reminder", { title: "Call Sharma about the order", at: "2030-01-03T11:00:00+05:30", details: "Ask about the second batch" }), () => say("Reminder ready.")]);
    const rem = await A("POST", `actions/${r.actions.at(-1)!.id}/confirm`, {});
    expect(rem.status).toBe(200);
    const [n] = await db.select().from(schema.notes).where(and(eq(schema.notes.orgId, orgId), eq(schema.notes.title, "Call Sharma about the order")));
    expect(n!.remindAt?.toISOString()).toBe("2030-01-03T05:30:00.000Z");
    expect(rem.json.link).toBe(`/notes/${n!.id}`);

    const past = await ask("Remind me yesterday", [() => propose("r2", "reminder", { title: "Too late", at: "2020-01-01T10:00:00+05:30" }), () => say("Ready.")]);
    expect((await A("POST", `actions/${past.actions.at(-1)!.id}/confirm`, {})).status).toBe(422);

    const m = await ask("Note the plan", [() => propose("n1", "note", { title: "Q4 plan", body: "Grow repeat orders.\n\n- Call top 10 customers\n- Launch the Diwali offer", tags: ["plan"] }), () => say("Note ready.")]);
    expect((await A("POST", `actions/${m.actions.at(-1)!.id}/confirm`, {})).status).toBe(200);
    const [note] = await db.select().from(schema.notes).where(and(eq(schema.notes.orgId, orgId), eq(schema.notes.title, "Q4 plan")));
    const blocks = (note!.content as { blocks: { type: string; text: string }[] }).blocks.map((b) => [b.type, b.text]);
    expect(blocks).toEqual([["p", "Grow repeat orders."], ["bullet", "Call top 10 customers"], ["bullet", "Launch the Diwali offer"]]);
  });
});

describe("the copilot's memory of earlier conversations", () => {
  it("finds earlier conversations by what was said, for the list and for the model", async () => {
    await ask("What discount did we give Sharma Traders?", [() => say("Sharma Traders get 7% off orders over ₹50,000.")]);
    const list = await A("GET", "threads?q=sharma");
    expect(list.status).toBe(200);
    expect(list.json.threads[0]).toMatchObject({ title: "What discount did we give Sharma Traders?" });
    expect(list.json.threads[0].match).toMatch(/7% off/);

    let found = "";
    await ask("Like last time for Sharma", [() => toolUse("h1", "recall_conversations", { query: "Sharma discount" }), (r) => ((found = result(r).content), say("Same as before: 7%."))]);
    expect(found).toContain("What discount did we give Sharma Traders?");
    expect(found).toContain("7% off orders over ₹50,000");
  });

  it("sends what it has learned: recent conversations and which suggestions they accept", async () => {
    // One dismissed CRM contact suggestion alongside the confirmed email tidies above.
    const c = await ask("Add Ravi", [() => propose("x1", "crm_contact", { name: "Ravi" }), () => say("Ready.")]);
    await A("POST", `actions/${c.actions.at(-1)!.id}/dismiss`, {});
    const c2 = await ask("Add Ravi again", [() => propose("x2", "crm_contact", { name: "Ravi M" }), () => say("Ready.")]);
    await A("POST", `actions/${c2.actions.at(-1)!.id}/dismiss`, {});
    requests.length = 0;
    await ask("Anything new?", [() => say("All quiet.")]);
    const system = requests[0]!.system.map((b) => b.text).join("\n");
    expect(system).toContain("What you've learned from working with Kavya Rao");
    expect(system).toMatch(/Their recent conversations with you .*"Add Ravi again"/);
    expect(system).toMatch(/Tidy email: confirmed 2 of 2/);
    expect(system).toMatch(/New contact: confirmed 0 of 2/);
  });
});
