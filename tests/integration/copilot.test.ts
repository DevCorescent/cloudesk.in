import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as workApi from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { call, cookieFrom, resetDb } from "../helpers";

// The copilot with a stand-in model: tools run as the person asking (reports
// and search follow their permissions), bad tool input goes back to the model
// as an error, suggestions change nothing until confirmed (once), threads are
// private, and every call is counted against the AI budget.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const A = mk(api, "copilot");
const CRM = mk(crmApi, "crm");
const W = mk(workApi, "work");

type Req = { model: string; system: { text: string; cache_control?: unknown }[]; tools: { name: string }[]; messages: { role: string; content: unknown }[] };
type Reply = { content: unknown[]; stop_reason: string };
const requests: Req[] = [];
let script: ((r: Req) => Reply)[] = [];
const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const resultsOf = (r: Req) => r.messages[r.messages.length - 1].content as { tool_use_id: string; content: string; is_error?: boolean }[];

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Om Owner", email: "om.copilot@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [k, role] of [["rep", "editor"], ["viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "rep" ? "Rita Rep" : "Vik Viewer", email: `${k}.copilot@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.copilot@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  ids.asha = (await CRM("POST", "contacts", { name: "Asha Kulkarni", email: "asha@lumen.example", ownerId: U.owner })).json.contact.id;
  ids.deal = (await CRM("POST", "deals", { title: "Lumen pilot", value: 120000_00, contactId: ids.asha, ownerId: U.owner })).json.deal.id;
  await CRM("POST", "deals", { title: "Rita's lead", value: 30000_00, ownerId: U.rep });
  ids.project = (await W("POST", "projects", { name: "Lumen website" })).json.project.id;
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(closeDb);

function stub() {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (params: unknown) => ({ finalMessage: async () => {
    const r = JSON.parse(JSON.stringify(params)) as Req;
    requests.push(r);
    const next = script.shift();
    if (!next) throw new Error("No scripted reply left");
    return { ...next(r), model: "claude-opus-5-5", usage };
  } }) } } }) as never);
}

describe("the copilot", () => {
  it("says no provider is connected, and does nothing", async () => {
    expect((await A("GET", "meta")).json).toEqual({ connected: false, canConnect: true, books: true });
    const r = await A("POST", "threads", { text: "How are sales?" });
    expect(r.status).toBe(424);
    expect(await db.select().from(schema.copilotThreads)).toHaveLength(0);
  });

  it("answers from a report and a search run as the person, then suggests a follow-up", async () => {
    stub();
    script = [
      () => ({ content: [use("t1", "list_datasets", {}), use("t2", "search_records", { query: "Asha" })], stop_reason: "tool_use" }),
      () => ({ content: [use("t3", "run_report", { dataset: "deals", spec: { dims: [{ field: "owner" }], measures: [{ field: "value", agg: "sum" }], range: { preset: "all" } } }), use("t4", "run_report", { dataset: "ledger" })], stop_reason: "tool_use" }),
      () => ({ content: [use("t5", "propose_action", { kind: "crm_task", summary: "Call Asha about the pilot on Friday", input: { subject: "Call Asha about the pilot", dueDate: "2026-10-30", contactId: ids.asha, dealId: ids.deal } })], stop_reason: "tool_use" }),
      () => say("Open deals total **₹1,50,000**. I've drafted a follow-up with Asha for you to confirm."),
    ];
    const r = await A("POST", "threads", { text: "What's in the pipeline, and remind me to call Asha on Friday" });
    expect(r.status).toBe(200);
    ids.thread = r.json.id;
    expect(r.json.title).toBe("What's in the pipeline, and remind me to call Asha on Friday");

    const [first, second, third] = requests;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tools.map((t) => t.name)).toEqual(["list_datasets", "run_report", "search_records", "find_anomalies", "propose_action", "mail_accounts", "mail_search", "mail_read", "mail_briefing", "calendar_upcoming", "invoices_list", "setup_status"]);
    expect(first.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.system[1].text).toMatch(/^Today is \d{4}-\d{2}-\d{2} \(India\)\. You're helping Om Owner\.$/);
    const [datasets, found] = resultsOf(second);
    expect(datasets.content).toContain("deals — Deals");
    expect(found.content).toContain(`contacts: Asha Kulkarni · asha@lumen.example — id ${ids.asha}`);
    const [report, bad] = resultsOf(third);
    expect(report.content).toContain("Om Owner | ₹1,20,000");
    expect(report.content).toContain("Rita Rep | ₹30,000");
    // A spec the model left out goes back to it as an error, not a crash.
    expect(bad).toMatchObject({ tool_use_id: "t4", is_error: true });

    // History is append-only: each request starts with everything sent before.
    expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);

    expect(r.json.items.filter((i: { role: string }) => i.role === "tool").map((i: { label: string }) => i.label)).toEqual(["Looked at the available data", "Searched for “Asha”", "Ran a report on deals", "Ran a report on ledger", "Suggested: Call Asha about the pilot on Friday"]);
    expect(r.json.items.at(-1)).toEqual({ role: "assistant", text: "Open deals total **₹1,50,000**. I've drafted a follow-up with Asha for you to confirm." });
    expect(r.json.actions).toHaveLength(1);
    expect(r.json.actions[0]).toMatchObject({ kind: "crm_task", status: "proposed", toolUseId: "t5", label: "CRM follow-up" });
    ids.action = r.json.actions[0].id;
    // Nothing is saved until the person confirms.
    expect(await db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.orgId, orgId), eq(schema.crmActivities.kind, "task")))).toHaveLength(0);

    const spend = await db.select().from(schema.aiTasks).where(and(eq(schema.aiTasks.orgId, orgId), eq(schema.aiTasks.kind, "copilot")));
    expect(spend).toHaveLength(4);
    expect(spend.every((x) => x.inputTokens === 1200 && x.costMicroUsd > 0)).toBe(true);
  });

  it("does a confirmed suggestion once, through the CRM", async () => {
    const r = await A("POST", `actions/${ids.action}/confirm`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "done", link: `/crm/deals/${ids.deal}` });
    const [act] = await db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.orgId, orgId), eq(schema.crmActivities.kind, "task")));
    expect(act).toMatchObject({ kind: "task", subject: "Call Asha about the pilot", contactId: ids.asha, dealId: ids.deal, ownerId: U.owner });
    expect(act.dueAt?.toISOString()).toBe("2026-10-30T04:30:00.000Z");
    expect((await A("POST", `actions/${ids.action}/confirm`)).status).toBe(409);
    expect((await A("POST", `actions/${ids.action}/dismiss`)).status).toBe(409);
  });

  it("carries on a conversation, and adds a project task when confirmed", async () => {
    stub();
    requests.length = 0;
    script = [
      () => ({ content: [use("w1", "propose_action", { kind: "work_task", summary: "Add “Send pilot report” to Lumen website", input: { projectId: ids.project, title: "Send pilot report", priority: "high" } }), use("w2", "propose_action", { kind: "crm_note", summary: "A note with nowhere to go", input: { body: "Hi" } })], stop_reason: "tool_use" }),
      () => say("Drafted a task on Lumen website."),
    ];
    const r = await A("POST", `threads/${ids.thread}/messages`, { text: "Also add a task to send the pilot report" });
    expect(r.status).toBe(200);
    expect(requests[0].messages.at(-1)).toEqual({ role: "user", content: "Also add a task to send the pilot report" });
    expect(resultsOf(requests[1])[1]).toMatchObject({ is_error: true });
    expect(resultsOf(requests[1])[1].content).toContain("A note belongs on a contact, company or deal");
    const task = r.json.actions.find((a: { kind: string }) => a.kind === "work_task");
    expect((await A("POST", `actions/${task.id}/confirm`)).json).toMatchObject({ status: "done", link: `/work/projects/${ids.project}` });
    const [t] = await db.select().from(schema.workTasks).where(eq(schema.workTasks.projectId, ids.project));
    expect(t).toMatchObject({ title: "Send pilot report", priority: "high", createdBy: U.owner });
  });

  it("keeps the CRM's 'own records' rule in search, and conversations private", async () => {
    await CRM("PUT", "settings", { visibility: "own" });
    expect((await A("GET", "search?q=lumen", undefined, "rep")).json.results.map((x: { kind: string }) => x.kind)).toEqual(["projects"]);
    expect((await A("GET", "search?q=lead", undefined, "rep")).json.results.map((x: { label: string }) => x.label)).toEqual(["Rita's lead · ₹30,000 · open"]);
    expect((await A("GET", "search?q=asha", undefined, "rep")).json.results).toHaveLength(0);
    expect((await A("GET", "search?q=asha")).json.results).toHaveLength(1);
    expect((await A("GET", `threads/${ids.thread}`, undefined, "rep")).status).toBe(404);
    expect((await A("GET", "threads", undefined, "rep")).json.threads).toHaveLength(0);
    await CRM("PUT", "settings", { visibility: "all" });
  });

  it("runs a suggestion with the person's own role: a viewer can't add CRM tasks", async () => {
    stub();
    script = [() => ({ content: [use("v1", "propose_action", { kind: "crm_task", summary: "Follow up", input: { subject: "Follow up" } })], stop_reason: "tool_use" }), () => say("Drafted.")];
    const r = await A("POST", "threads", { text: "Remind me to follow up" }, "viewer");
    const a = r.json.actions[0];
    expect((await A("POST", `actions/${a.id}/confirm`, undefined, "viewer")).status).toBe(403);
    const [after] = await db.select().from(schema.copilotActions).where(eq(schema.copilotActions.id, a.id));
    expect(after).toMatchObject({ status: "failed" });
    expect(after.error).toMatch(/permission/);
  });

  it("stops on a refusal, and says so", async () => {
    stub();
    script = [() => ({ content: [], stop_reason: "refusal" })];
    const r = await A("POST", "threads", { text: "Something it won't do" });
    expect(r.json.items.at(-1)).toEqual({ role: "assistant", text: "I can't help with that request." });
  });

  it("finds a bill entered twice, for those who read the books, and the model can ask for it", async () => {
    const A2 = mk(accApi, "accounts");
    await A2("GET", "meta");
    const exp = (await A2("GET", "meta")).json.accounts.find((a: { code: string }) => a.code === "5260").id;
    for (const billNo of ["INV-9", "inv 9"]) expect((await A2("POST", "bills", { supplierName: "Paper Mart", billNo, date: "2026-10-20", lines: [{ accountId: exp, amount: 2500_00, gstRate: 18 }] })).status).toBe(200);
    const r = (await A("GET", "checks")).json;
    expect(r.open).toBe(true);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "duplicate_bill", title: "Possible duplicate bill from Paper Mart" });
    expect((await A("GET", "checks", undefined, "rep")).json).toEqual({ open: false, findings: [] });
    stub();
    script = [() => ({ content: [use("c1", "find_anomalies", {})], stop_reason: "tool_use" }), (req) => say(resultsOf(req)[0].content.includes("Possible duplicate bill from Paper Mart") ? "One bill may be a duplicate." : "Nothing.")];
    expect((await A("POST", "threads", { text: "Anything odd in the books?" })).json.items.at(-1).text).toBe("One bill may be a duplicate.");
  });

  it("shows owners the AI activity: calls, cost and what was carried out", async () => {
    const r = (await A("GET", "activity")).json;
    const mine = r.usage.find((u: { kind: string; name: string }) => u.kind === "copilot" && u.name === "Om Owner");
    expect(mine.calls).toBeGreaterThanOrEqual(6);
    expect(r.actions.map((a: { summary: string }) => a.summary)).toEqual(expect.arrayContaining(["Call Asha about the pilot on Friday", "Add “Send pilot report” to Lumen website", "Follow up"]));
    expect((await A("GET", "activity", undefined, "rep")).status).toBe(403);
  });

  it("refuses once the month's AI budget is spent", async () => {
    stub();
    await db.insert(schema.aiTasks).values({ orgId, kind: "copilot", status: "succeeded", input: {}, provider: "anthropic", model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0, costMicroUsd: 1_000_000_000 });
    const r = await A("POST", "threads", { text: "Anything" });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/budget is used up/);
  });
});
