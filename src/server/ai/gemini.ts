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

async function call(apiKey: string, p: Params, signal?: AbortSignal | null): Promise<Msg> {
  let last: GeminiError | null = null;
  for (const [i, model] of modelsToTry().entries()) {
    try {
      return await once(apiKey, model, p, signal);
    } catch (e) {
      // The free tier allows a few requests a minute: on the first model, waiting the few seconds Google asks for beats switching.
      if (i === 0 && e instanceof GeminiError && e.status === 429 && e.retryAfter !== null && e.retryAfter <= 25) {
        await wait(e.retryAfter * 1000 + 250, signal);
        try {
          return await once(apiKey, model, p, signal);
        } catch (again) {
          e = again;
        }
      }
      if (signal?.aborted) throw e;
      // Retired (404), overloaded (503), out of free quota for this model (429), or hung: the next one may answer.
      if (e instanceof GeminiError && [404, 429, 500, 503].includes(e.status)) last = e;
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError")) last = new GeminiError(504, "Gemini didn't answer in time");
      else throw e;
    }
  }
  throw last ?? new GeminiError(503, "No Gemini model answered");
}

async function once(apiKey: string, model: string, p: Params, signal?: AbortSignal | null): Promise<Msg> {
  const fmt = p.output_config?.format;
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAi(p),
    // Flash models return up to 65k tokens; ask for less so free-tier answers stay quick.
    max_tokens: Math.min(p.max_tokens ?? 8192, 16_384),
  };
  if (p.tools?.length)
    body.tools = (p.tools as unknown as { name: string; description?: string; input_schema?: unknown }[])
      .filter((t) => t.name)
      .map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: cleanSchema(t.input_schema ?? { type: "object", properties: {} }) } }));
  if (fmt?.type === "json_schema" && fmt.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: cleanSchema(fmt.schema) } };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    // A model that hangs gives way to the next one rather than holding the request.
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
  });
  const json = (await res.json().catch(() => ({}))) as OaResponse | OaResponse[];
  const r = Array.isArray(json) ? json[0]! : json;
  if (!res.ok || r.error) throw new GeminiError(res.status, r.error?.message ?? `HTTP ${res.status}`, retryHint(r.error));
  return fromOpenAi(r);
}

/** An object with the slice of the Anthropic client our features use, backed by Gemini. */
export function geminiClient(apiKey: string) {
  const stream = (p: Params, opts?: { signal?: AbortSignal | null }) => ({ finalMessage: () => call(apiKey, p, opts?.signal) });
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
