import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanSchema, fromOpenAi, geminiClient, resetGeminiState, toOpenAi } from "@/server/ai/gemini";

// Gemini speaking the Anthropic Messages API: requests translate to the
// OpenAI-compatible shape (system, images and PDFs, tools and tool results,
// JSON output) and answers come back as Anthropic messages.
type P = Parameters<typeof toOpenAi>[0];
const p = (x: Record<string, unknown>) => ({ model: "claude-opus-5-5", max_tokens: 100, ...x }) as unknown as P;

afterEach(() => {
  vi.unstubAllGlobals();
  resetGeminiState();
});

describe("Gemini adapter", () => {
  it("turns system blocks, text, images and a tool loop into chat messages", () => {
    const out = toOpenAi(
      p({
        system: [{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }, { type: "text", text: " Today is Monday." }],
        messages: [
          { role: "user", content: "How were sales?" },
          { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "x" }, { type: "text", text: "Checking." }, { type: "tool_use", id: "t1", name: "run_report", input: { dataset: "sales" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"total":5}' }] },
          { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }, { type: "text", text: "Read this" }] },
        ],
      }),
    );
    expect(out[0]).toEqual({ role: "system", content: "Be brief. Today is Monday." });
    expect(out[1]).toEqual({ role: "user", content: "How were sales?" });
    expect(out[2]).toMatchObject({ role: "assistant", content: "Checking.", tool_calls: [{ id: "t1", type: "function", function: { name: "run_report", arguments: '{"dataset":"sales"}' } }] });
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "t1", content: '{"total":5}' });
    expect(out[4]).toMatchObject({ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }, { type: "text", text: "Read this" }] });
  });

  it("keeps only the JSON Schema Gemini accepts", () => {
    expect(cleanSchema({ type: "object", additionalProperties: false, $schema: "x", properties: { a: { type: ["string", "null"], maxLength: 4 }, b: { type: "array", items: { type: "integer" } } }, required: ["a"] })).toEqual({
      type: "object",
      properties: { a: { type: "string", nullable: true }, b: { type: "array", items: { type: "integer" } } },
      required: ["a"],
    });
  });

  it("reads tool calls, text, stop reasons and usage back as an Anthropic message", () => {
    const m = fromOpenAi({ model: "gemini-3.5-flash", choices: [{ finish_reason: "tool_calls", message: { content: "Looking", tool_calls: [{ id: "c1", function: { name: "search_records", arguments: '{"query":"Asha"}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 7 } });
    expect(m.stop_reason).toBe("tool_use");
    expect(m.content).toEqual([{ type: "text", text: "Looking", citations: null }, { type: "tool_use", id: "c1", name: "search_records", input: { query: "Asha" } }]);
    expect(m.usage.input_tokens).toBe(50);
    expect(fromOpenAi({ choices: [{ finish_reason: "length", message: { content: "cut" } }] }).stop_reason).toBe("max_tokens");
    expect(fromOpenAi({ choices: [{ finish_reason: "stop", message: { content: "done" } }] }).stop_reason).toBe("end_turn");
  });

  it("calls Google with the key, tools and JSON format, through the client the features use", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = geminiClient("AIza-test-key");
    const msg = await client.beta.messages
      .stream({ model: "claude-opus-5-5", max_tokens: 99_000, system: "s", messages: [{ role: "user", content: "hi" }], tools: [{ name: "find_anomalies", description: "d", input_schema: { type: "object", properties: {}, additionalProperties: false } }], output_config: { format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } as never)
      .finalMessage();
    expect(msg.content[0]).toMatchObject({ type: "text", text: '{"ok":true}' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer AIza-test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gemini-3.5-flash");
    expect(body.max_tokens).toBe(16_384);
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "find_anomalies", description: "d", parameters: { type: "object", properties: {} } } });
    expect(body.response_format.type).toBe("json_schema");
  });

  it("hands Gemini's thought signature back on the next turn", () => {
    const m = fromOpenAi({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", function: { name: "run_report", arguments: "{}" }, extra_content: { google: { thought_signature: "SIG" } } }] } }] });
    const out = toOpenAi(p({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: m.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "r" }] }] }));
    expect(out[1]).toMatchObject({ tool_calls: [{ id: "c1", extra_content: { google: { thought_signature: "SIG" } } }] });
  });

  it("moves on to the next model when one is retired or busy", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ error: { code: 503, message: "high demand" } }]), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "hi" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const msg = await geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }] } as never).finalMessage();
    expect(msg.content[0]).toMatchObject({ text: "hi" });
    expect(JSON.parse(String((fetch.mock.calls[1]![1] as RequestInit).body)).model).toBe("gemini-3.5-flash-lite");
  });

  it("moves straight to the next model when one is busy, and rests the busy one for a while", async () => {
    const ok = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "fast" } }] }), { status: 200 });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ error: { code: 429, message: "Quota exceeded. Please retry in 2.5s." } }]), { status: 429 })).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const ask = () => geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }] } as never).finalMessage();
    expect((await ask()).content[0]).toMatchObject({ text: "fast" });
    // The next question goes to the model that answered, not the busy one.
    await ask();
    expect(fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).model)).toEqual(["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  });

  it("waits the few seconds Google asks for only when every model is busy", async () => {
    vi.useFakeTimers();
    const busy = () => new Response(JSON.stringify([{ error: { code: 429, message: "Quota exceeded. Please retry in 2.5s." } }]), { status: 429 });
    const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "later" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const done = geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }] } as never).finalMessage();
    await vi.advanceTimersByTimeAsync(3000);
    expect((await done).content[0]).toMatchObject({ text: "later" });
    expect(fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).model)).toEqual(["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"]);
    vi.useRealTimers();
  });

  it("thinks least for quick answers, and asks again without the setting if a model won't take it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ error: { code: 400, message: "reasoning_effort is not supported" } }]), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }], output_config: { effort: "low" } } as never).finalMessage();
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0].reasoning_effort).toBe("minimal");
    expect(bodies[1].reasoning_effort).toBeUndefined();
  });

  it("streams the answer as it's written, tool calls and usage included", async () => {
    const sse = [
      { model: "gemini-3.5-flash", choices: [{ delta: { content: "Sales " } }] },
      { choices: [{ delta: { content: "rose 12%." } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "run_report", arguments: '{"dataset":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"sales"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 40, completion_tokens: 9 } },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join("") + "data: [DONE]\n\n";
    const fetch = vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const parts: string[] = [];
    const msg = await geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }] } as never).on("text", (d: string) => parts.push(d)).finalMessage();
    expect(parts).toEqual(["Sales ", "rose 12%."]);
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).stream).toBe(true);
    expect(msg.stop_reason).toBe("tool_use");
    expect(msg.content).toMatchObject([{ type: "text", text: "Sales rose 12%." }, { type: "tool_use", id: "c1", name: "run_report", input: { dataset: "sales" } }]);
    expect(msg.usage).toMatchObject({ input_tokens: 40, output_tokens: 9 });
  });

  it("reports Google's errors with their status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ error: { code: 400, message: "Bad key" } }]), { status: 400 })));
    await expect(geminiClient("k").beta.messages.stream({ messages: [{ role: "user", content: "x" }] } as never).finalMessage()).rejects.toMatchObject({ status: 400 });
  });
});
