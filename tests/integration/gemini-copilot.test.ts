import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import * as providers from "@/app/api/v1/orgs/[orgId]/providers/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// The free Gemini connector end to end: with only a platform Gemini key, the
// copilot runs its tool loop through Google (a search, then an answer), the
// workspace shows Gemini as the provider in use, and usage is recorded at no cost.
let orgId = "";
let cookie = "";
const realFetch = globalThis.fetch;
const sent: { tools?: { function: { name: string } }[]; messages: { role: string; tool_call_id?: string; content: unknown }[] }[] = [];

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Gita Gemini", email: "gita.gemini@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  await call(crmApi.POST, { method: "POST", cookie, body: { name: "Asha Kulkarni", email: "asha@lumen.example" }, path: `/api/v1/orgs/${orgId}/crm/contacts`, params: { orgId, slug: ["contacts"] } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.GEMINI_API_KEY = "";
});
afterAll(closeDb);

describe("Free Gemini connector", () => {
  it("answers copilot questions with tools, through Google, at no cost", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.GEMINI_API_KEY = "AIza-test-key-0000000000000000000000000";
    const replies = [
      { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "g1", function: { name: "search_records", arguments: '{"query":"Asha"}' } }] } }], usage: { prompt_tokens: 900, completion_tokens: 20 } },
      { choices: [{ finish_reason: "stop", message: { content: "Asha Kulkarni is your contact at Lumen." } }], usage: { prompt_tokens: 1100, completion_tokens: 15 } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(url, init);
        sent.push(JSON.parse(String(init!.body)));
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }),
    );

    const list = await call(providers.GET, { cookie, params: { orgId } });
    expect(list.json.active).toBe("gemini");
    expect(list.json.providers.find((p: { id: string }) => p.id === "gemini").platformKeyAvailable).toBe(true);

    const r = await call(api.POST, { method: "POST", cookie, body: { text: "Who is Asha?" }, path: `/api/v1/orgs/${orgId}/copilot/threads`, params: { orgId, slug: ["threads"] } });
    expect(r.status).toBe(200);
    expect(r.json.items.at(-1)).toMatchObject({ role: "assistant", text: "Asha Kulkarni is your contact at Lumen." });

    // The tools went to Google, and the search's result came back to it as a tool message.
    expect(sent[0]!.tools!.map((t) => t.function.name)).toContain("search_records");
    const toolMsg = sent[1]!.messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("g1");
    expect(String(toolMsg?.content)).toContain("Asha");

    const used = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.orgId, orgId));
    expect(used.length).toBe(2);
    expect(used.every((u) => u.costMicroUsd === 0)).toBe(true);
  });
});
