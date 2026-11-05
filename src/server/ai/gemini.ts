// Google Gemini as a stand-in for Anthropic, for testing on the free tier.
// Every AI feature is written against Anthropic's Messages API
// (client.beta.messages.stream(params).finalMessage()); this speaks that shape
// and translates to Gemini's OpenAI-compatible endpoint and back: system text,
// text/image/PDF content, tools and tool results, JSON-schema output. Claude-only
// options (thinking, effort, caching, betas) are dropped.
import type Anthropic from "@anthropic-ai/sdk";
import { cfg } from "../platform/config";

/** The cost catalogue's id for whichever Gemini model answers (all free here). */
export const GEMINI_MODEL = "gemini-flash";
/** Tried in order: GEMINI_MODEL if set, then current Flash models. Google retires and overloads models often. */
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
const modelsToTry = () => [...new Set([cfg("GEMINI_MODEL"), ...MODELS].filter((m): m is string => !!m))];
const BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

type Msg = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsStreaming & { output_config?: { format?: { type: string; schema?: Record<string, unknown> } } };
type Call = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
type OaMessage =
  | { role: "system" | "user" | "assistant"; content: string | { type: string; [k: string]: unknown }[] | null; tool_calls?: Call[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Gemini accepts a subset of JSON Schema: keep the parts it understands. */
const KEEP = new Set(["type", "description", "properties", "items", "required", "enum", "format", "nullable", "minimum", "maximum", "minItems", "maxItems", "anyOf"]);
export function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, d]) => [p, cleanSchema(d)]));
    else if (k === "type" && Array.isArray(v)) {
      // ["string", "null"] → string, nullable
      const t = v.filter((x) => x !== "null");
      out.type = t[0] ?? "string";
      if (t.length < v.length) out.nullable = true;
    } else out[k] = cleanSchema(v);
  }
  return out;
}

const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("") : "");

/** Anthropic messages → OpenAI-style chat messages. */
export function toOpenAi(p: Params): OaMessage[] {
  const out: OaMessage[] = [];
  const sys = text(p.system);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of p.messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: { type: string; [k: string]: unknown }[] = [];
    const calls: Call[] = [];
    for (const b of m.content as unknown as Record<string, unknown>[]) {
      if (b.type === "text") parts.push({ type: "text", text: String(b.text ?? "") });
      else if ((b.type === "image" || b.type === "document") && (b.source as { type?: string })?.type === "base64") {
        const src = b.source as { media_type: string; data: string };
        parts.push({ type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } });
      } else if (b.type === "tool_use") calls.push({ id: String(b.id), type: "function", function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) }, ...(b.gemini ? { extra_content: b.gemini } : {}) });
      else if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: String(b.tool_use_id), content: text(b.content) || (typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "")) });
      // thinking / redacted_thinking blocks have no counterpart and are left out.
    }
    if (m.role === "assistant") {
      const t = parts.filter((x) => x.type === "text").map((x) => x.text as string).join("");
      if (t || calls.length) out.push({ role: "assistant", content: t || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (parts.length) out.push({ role: "user", content: parts.length === 1 && parts[0]!.type === "text" ? (parts[0]!.text as string) : parts });
  }
  return out;
}

type OaResponse = {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number; status?: string };
};

/** An error shaped like the Anthropic SDK's, so callers' error handling still applies. */
export class GeminiError extends Error {
  /** How long Google asked us to wait before trying again (seconds), when it said. */
  retryAfter: number | null;
  constructor(public status: number, message: string, retryAfter: number | null = null) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

/** Google's "retry in 19.5s" (in the message, or a RetryInfo detail) as seconds. */
function retryHint(e: (NonNullable<OaResponse["error"]> & { details?: { retryDelay?: string }[] }) | undefined): number | null {
  const d = e?.details?.find((x) => x?.retryDelay)?.retryDelay ?? e?.message?.match(/retry in ([\d.]+)s/i)?.[1];
  const n = d ? parseFloat(String(d)) : NaN;
  return Number.isFinite(n) ? n : null;
}
const wait = (ms: number, signal?: AbortSignal | null) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => (clearTimeout(t), rej(signal.reason)), { once: true });
});

/** OpenAI-style answer → Anthropic message. */
export function fromOpenAi(r: OaResponse): Msg {
  const c = r.choices?.[0];
  const content: Record<string, unknown>[] = [];
  if (c?.message?.content) content.push({ type: "text", text: c.message.content, citations: null });
  (c?.message?.tool_calls ?? []).forEach((t, i) => {
    let input: unknown = {};
    try {
      input = JSON.parse(t.function?.arguments || "{}");
    } catch {}
    // Gemini 3 signs each call ("thought signature") and refuses the next turn without it, so it rides along on the block.
    content.push({ type: "tool_use", id: t.id || `call_${Date.now().toString(36)}_${i}`, name: t.function?.name ?? "", input, ...(t.extra_content ? { gemini: t.extra_content } : {}) });
  });
  const f = c?.finish_reason;
  const stop = (c?.message?.tool_calls?.length ? "tool_use" : f === "length" ? "max_tokens" : f === "content_filter" ? "refusal" : "end_turn") as Msg["stop_reason"];
  return {
    id: `gemini_${Date.now().toString(36)}`,
    type: "message",
    role: "assistant",
    model: GEMINI_MODEL,
    content: content as unknown as Msg["content"],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0, cache_creation_input_tokens: null, cache_read_input_tokens: null } as unknown as Msg["usage"],
  } as unknown as Msg;
}

type OnText = (delta: string) => void;

// Models Google said were busy (429/503), skipped for a short while so the
// next request doesn't wait on them too; shared by every request on this server.
const resting = new Map<string, number>();
const rest = (model: string, seconds: number) => resting.set(model, Date.now() + Math.min(60, Math.max(5, seconds)) * 1000);
const awake = (model: string) => (resting.get(model) ?? 0) <= Date.now();

async function call(apiKey: string, p: Params, signal?: AbortSignal | null, onText?: OnText): Promise<Msg> {
  let last: GeminiError | null = null;
  let firstWait: { model: string; s: number } | null = null;
  const all = modelsToTry();
  // Busy models go last rather than first.
  const order = [...all.filter(awake), ...all.filter((m) => !awake(m))];
  // Once part of an answer has been shown, another model can't take over without repeating it.
  let spoke = false;
  const said = onText && ((d: string) => ((spoke = true), onText(d)));
  for (const model of order) {
    try {
      return await once(apiKey, model, p, signal, said);
    } catch (e) {
      if (signal?.aborted || spoke) throw e;
      // Busy or out of free quota: move straight to the next model instead of waiting.
      if (e instanceof GeminiError && (e.status === 429 || e.status === 503)) {
        rest(model, e.retryAfter ?? 20);
        if (!firstWait && e.retryAfter !== null && e.retryAfter <= 20) firstWait = { model, s: e.retryAfter };
      }
      // Retired (404), overloaded (503), out of free quota for this model (429), or hung: the next one may answer.
      if (e instanceof GeminiError && [404, 429, 500, 503].includes(e.status)) last = e;
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError")) last = new GeminiError(504, "Gemini didn't answer in time");
      else throw e;
    }
  }
  // Every model was busy: wait the few seconds Google asked for, once.
  if (firstWait) {
    await wait(firstWait.s * 1000 + 250, signal);
    return once(apiKey, firstWait.model, p, signal, said);
  }
  throw last ?? new GeminiError(503, "No Gemini model answered");
}

/** How hard Gemini thinks, from the caller's effort: quick answers think least, which is most of the wait. */
function reasoningFor(p: Params): string {
  const effort = (p as { output_config?: { effort?: string } }).output_config?.effort;
  return effort === "high" || effort === "max" ? "medium" : effort === "medium" ? "low" : "minimal";
}
// Models that turned down a reasoning setting: asked without it from then on.
const noReasoning = new Set<string>();

/** Tests start each case with no model resting and every reasoning setting allowed. */
export function resetGeminiState() {
  resting.clear();
  noReasoning.clear();
}

async function once(apiKey: string, model: string, p: Params, signal?: AbortSignal | null, onText?: OnText): Promise<Msg> {
  const fmt = p.output_config?.format;
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAi(p),
    // Flash models return up to 65k tokens; ask for less so free-tier answers stay quick.
    max_tokens: Math.min(p.max_tokens ?? 8192, 16_384),
  };
  if (!noReasoning.has(model)) body.reasoning_effort = reasoningFor(p);
  if (p.tools?.length)
    body.tools = (p.tools as unknown as { name: string; description?: string; input_schema?: unknown }[])
      .filter((t) => t.name)
      .map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: cleanSchema(t.input_schema ?? { type: "object", properties: {} }) } }));
  if (fmt?.type === "json_schema" && fmt.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: cleanSchema(fmt.schema) } };
  if (onText) Object.assign(body, { stream: true, stream_options: { include_usage: true } });
  // A model that hangs gives way to the next one rather than holding the request
  // (streamed answers only need to start in time; they then keep the line busy).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("Gemini didn't answer in time", "TimeoutError")), onText ? 20_000 : 40_000);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
  }).catch((e) => {
    clearTimeout(timer);
    throw e;
  });
  if (!res.ok || !onText) {
    clearTimeout(timer);
    const json = (await res.json().catch(() => ({}))) as OaResponse | OaResponse[];
    const r = Array.isArray(json) ? json[0]! : json;
    if (!res.ok || r.error) {
      // A model that doesn't take a reasoning setting: ask again without it.
      if (res.status === 400 && body.reasoning_effort && /reason|thinking/i.test(r.error?.message ?? "")) {
        noReasoning.add(model);
        return once(apiKey, model, p, signal, onText);
      }
      throw new GeminiError(res.status, r.error?.message ?? `HTTP ${res.status}`, retryHint(r.error));
    }
    return fromOpenAi(r);
  }
  clearTimeout(timer);
  return fromOpenAi(await readStream(res, onText, signal));
}

/** Gemini's streamed answer (OpenAI-style server-sent events), passing text on as it arrives and putting the whole answer back together. */
async function readStream(res: Response, onText: OnText, signal?: AbortSignal | null): Promise<OaResponse> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish: string | undefined;
  let usage: OaResponse["usage"];
  let model: string | undefined;
  const calls: { id?: string; function: { name?: string; arguments: string }; extra_content?: unknown }[] = [];
  // Between pieces of a long answer, a stall this long means it hung.
  let idle: ReturnType<typeof setTimeout> | null = null;
  const stall = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => void reader.cancel(new DOMException("Gemini stopped answering", "TimeoutError")).catch(() => {}), 30_000);
  };
  try {
    stall();
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) break;
      stall();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: { model?: string; error?: OaResponse["error"]; usage?: OaResponse["usage"]; choices?: { finish_reason?: string; delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[] } }[] };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new GeminiError(chunk.error.code ?? 500, chunk.error.message ?? "Gemini error", retryHint(chunk.error));
        model ??= chunk.model;
        if (chunk.usage) usage = chunk.usage;
        const c = chunk.choices?.[0];
        if (!c) continue;
        if (c.finish_reason) finish = c.finish_reason;
        const d = c.delta?.content;
        if (d) {
          content += d;
          onText(d);
        }
        for (const t of c.delta?.tool_calls ?? []) {
          const i = t.index ?? calls.length;
          const cur = (calls[i] ??= { function: { arguments: "" } });
          if (t.id) cur.id = t.id;
          if (t.function?.name) cur.function.name = t.function.name;
          if (t.function?.arguments) cur.function.arguments += t.function.arguments;
          if (t.extra_content) cur.extra_content = t.extra_content;
        }
      }
    }
  } finally {
    if (idle) clearTimeout(idle);
  }
  return { model, usage, choices: [{ finish_reason: finish, message: { content: content || null, tool_calls: calls.filter(Boolean).length ? calls.filter(Boolean) : undefined } }] };
}

/** An object with the slice of the Anthropic client our features use, backed by Gemini. */
export function geminiClient(apiKey: string) {
  // Like the Anthropic SDK's MessageStream: listen for "text" as it arrives, then await finalMessage().
  const stream = (p: Params, opts?: { signal?: AbortSignal | null }) => {
    const listeners: OnText[] = [];
    let started: Promise<Msg> | null = null;
    const s = {
      on(ev: string, cb: OnText) {
        if (ev === "text") listeners.push(cb);
        return s;
      },
      finalMessage: () => (started ??= call(apiKey, p, opts?.signal, listeners.length ? (d) => listeners.forEach((l) => l(d)) : undefined)),
    };
    return s;
  };
  return { beta: { messages: { stream, create: (p: Params, opts?: { signal?: AbortSignal | null }) => call(apiKey, p, opts?.signal) } } } as unknown as Pick<Anthropic, "beta">;
}

/** "Test connection": lists models, which uses no quota. */
export async function verifyGeminiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return { ok: true };
    if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, error: "Google rejected the key — check it in Google AI Studio." };
    return { ok: false, error: `Provider error (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach generativelanguage.googleapis.com." };
  }
}
