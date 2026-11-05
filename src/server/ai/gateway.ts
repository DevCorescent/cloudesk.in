import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { decryptSecret } from "../security/secrets";
import { costMicroUsd, modelInfo, ROUTES, type TaskType } from "./catalog";
import { cfg } from "../platform/config";
import { GEMINI_MODEL, GeminiError, geminiClient } from "./gemini";

export type Completion = {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

export type CompletionRequest = {
  orgId: string;
  task: TaskType;
  system: string;
  /** Plain text, or content blocks (e.g. an image or PDF before the instruction). */
  messages: { role: "user" | "assistant"; content: string | Anthropic.Beta.BetaContentBlockParam[] }[];
  maxTokens?: number;
  signal: AbortSignal;
  /** Called with each piece of text as the model writes it. */
  onText?: (delta: string) => void;
};

type Llm = { provider: "anthropic" | "gemini"; apiKey: string };

/**
 * Which model answers, and with whose key. Never logged or returned. The
 * workspace's own keys come first (Anthropic, then Gemini), then the
 * platform's; Gemini is the free option for trying the AI features out.
 */
const llmCache = new Map<string, { at: number; v: Llm | null }>();
/** Forget a workspace's cached provider (its keys changed). Other servers notice within 30 seconds. */
export const clearLlmCache = (orgId?: string) => {
  for (const k of [...llmCache.keys()]) if (!orgId || k.startsWith(`${orgId}:`)) llmCache.delete(k);
};

async function llmFor(orgId: string): Promise<Llm | null> {
  // Looked up and decrypted once per 30 seconds per workspace, not on every AI call.
  // Only a provider found is remembered (connecting one takes effect at once),
  // and a change to the platform's own keys starts afresh.
  const key = `${orgId}:${cfg("ANTHROPIC_API_KEY")?.slice(-6) ?? ""}:${cfg("GEMINI_API_KEY")?.slice(-6) ?? ""}`;
  const hit = llmCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const v = await lookupLlm(orgId);
  if (v) llmCache.set(key, { at: Date.now(), v });
  return v;
}

async function lookupLlm(orgId: string): Promise<Llm | null> {
  const creds = await db
    .select({ provider: schema.providerCredentials.provider, ciphertext: schema.providerCredentials.ciphertext })
    .from(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.orgId, orgId), inArray(schema.providerCredentials.provider, ["anthropic", "gemini"])));
  for (const provider of ["anthropic", "gemini"] as const) {
    const c = creds.find((x) => x.provider === provider);
    if (c) return { provider, apiKey: decryptSecret(c.ciphertext) };
  }
  const a = cfg("ANTHROPIC_API_KEY");
  if (a) return { provider: "anthropic", apiKey: a };
  const g = cfg("GEMINI_API_KEY");
  if (g) return { provider: "gemini", apiKey: g };
  return null;
}

export async function hasLlm(orgId: string): Promise<boolean> {
  return !!(await llmFor(orgId));
}

/** The provider a workspace's AI runs on right now (for the settings page). */
export async function activeProvider(orgId: string): Promise<Llm["provider"] | null> {
  return (await llmFor(orgId))?.provider ?? null;
}

export async function complete(req: CompletionRequest): Promise<Completion> {
  const modelId = ROUTES[req.task];
  const info = modelInfo(modelId);
  if (!info || info.provider !== "anthropic") {
    throw new ApiError("provider_not_configured", `No implemented provider is routed for ${req.task}`);
  }
  const llm = await llmFor(req.orgId);
  if (!llm) {
    throw new ApiError(
      "provider_not_configured",
      "No AI provider is connected. Add an Anthropic or a free Google Gemini key under Settings → AI providers.",
    );
  }
  const apiKey = llm.apiKey;
  const client = llm.provider === "gemini" ? (geminiClient(apiKey) as unknown as Anthropic) : new Anthropic({ apiKey, maxRetries: 2, timeout: 170_000 });
  try {
    const stream = client.beta.messages.stream(
      {
        model: modelId,
        max_tokens: req.maxTokens ?? 32_000,
        system: req.system,
        messages: req.messages,
        // Visitor chat must answer quickly; editing work gets more thought.
        output_config: { effort: req.task === "code_edit" ? "high" : req.task === "chat" ? "low" : "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: req.signal },
    );
    if (req.onText) stream.on("text", (d: string) => req.onText!(d));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") {
      throw new ApiError("provider_error", "The model declined this request. Try rephrasing it.");
    }
    if (msg.stop_reason === "max_tokens") {
      throw new ApiError("provider_error", "The model's response was too long and was cut off. Try a smaller change.");
    }
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    const outputTokens = msg.usage.output_tokens;
    return {
      text,
      provider: "anthropic",
      model: msg.model,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(llm.provider === "gemini" ? GEMINI_MODEL : modelId, inputTokens, outputTokens),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (req.signal.aborted) throw new ApiError("conflict", "Cancelled");
    if (err instanceof GeminiError) throw geminiError(err);
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ApiError("provider_error", "The Anthropic API key was rejected. Check it under Settings → AI providers.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ApiError("provider_error", "The AI provider is rate limiting requests. Retry in a minute.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new ApiError("provider_error", `The AI provider returned an error (${err.status ?? "network"}).`);
    }
    throw new ApiError("provider_error", "Could not reach the AI provider.");
  }
}

/** Lightweight credential check used by "Test connection". */
export async function verifyAnthropicKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  try {
    await client.models.retrieve(ROUTES.planning);
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "The key was rejected (401)." };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "The key lacks permission for this model (403)." };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `Provider error (${err.status ?? "network"}).` };
    return { ok: false, error: "Could not reach api.anthropic.com." };
  }
}

// ── Shared client for features that drive the API themselves (the copilot's
// tool loop, document reading) ─────────────────────────────────────────────

type MessagesLike = Pick<Anthropic, "beta">;
let makeClient: (apiKey: string) => MessagesLike = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 170_000 });
/** Tests swap in a stand-in client; production always talks to Anthropic. */
export function setAnthropicClientFactory(f: ((apiKey: string) => MessagesLike) | null) {
  makeClient = f ?? ((apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 170_000 }));
}

/** The workspace's AI client (Anthropic, or Gemini speaking the same API), or a clear "not connected" error. Refuses once the month's AI budget is spent. */
export async function anthropicFor(orgId: string) {
  const llm = await llmFor(orgId);
  if (!llm) throw new ApiError("provider_not_configured", "No AI provider is connected. Add an Anthropic or a free Google Gemini key under Settings → AI providers.");
  // The plan's monthly AI spend and requests (Free: $0.25 and 25 requests).
  await (await import("./tasks")).assertAiAllowed(orgId);
  return llm.provider === "gemini" ? geminiClient(llm.apiKey) : makeClient(llm.apiKey);
}

/** Record what a call cost, so it counts against the monthly budget like every other AI task. */
export async function recordUsage(orgId: string, userId: string | null, kind: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, model: string, meta: Record<string, unknown> = {}) {
  const inputTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  await db.insert(schema.aiTasks).values({ orgId, kind, status: "succeeded", input: meta, provider: "anthropic", model, inputTokens, outputTokens: usage.output_tokens, costMicroUsd: costMicroUsd(modelInfo(model) ? model : ROUTES.chat, inputTokens, usage.output_tokens), createdBy: userId, startedAt: new Date(), finishedAt: new Date() });
}

/** Turn an SDK failure into a message people can act on (never the key, never raw provider text). */
function geminiError(err: GeminiError): ApiError {
  if (err.status === 429) return new ApiError("provider_error", "Gemini's free limit for now is used up. Wait a minute and try again.");
  if (err.status === 504 || err.status === 503) return new ApiError("provider_error", "Gemini is busy right now. Try again in a minute.");
  if (err.status === 400 || err.status === 401 || err.status === 403) return new ApiError("provider_error", `Gemini refused the request: ${err.message.slice(0, 160)}`);
  return new ApiError("provider_error", `Gemini returned an error (${err.status || "network"}).`);
}

export function providerError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof GeminiError) return geminiError(err);
  if (err instanceof Anthropic.AuthenticationError) return new ApiError("provider_error", "The Anthropic API key was rejected. Check it under Settings → AI providers.");
  if (err instanceof Anthropic.RateLimitError) return new ApiError("provider_error", "The AI provider is rate limiting requests. Retry in a minute.");
  if (err instanceof Anthropic.APIError) return new ApiError("provider_error", `The AI provider returned an error (${err.status ?? "network"}).`);
  return new ApiError("provider_error", "Could not reach the AI provider.");
}

export const COPILOT_MODEL = ROUTES.chat;
