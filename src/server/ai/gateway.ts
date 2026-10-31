import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { decryptSecret } from "../security/secrets";
import { costMicroUsd, modelInfo, ROUTES, type TaskType } from "./catalog";
import { cfg } from "../platform/config";

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
};

/** Org credential first, then the platform-level key. Never logged or returned. */
async function anthropicKey(orgId: string): Promise<string | null> {
  const [cred] = await db
    .select({ ciphertext: schema.providerCredentials.ciphertext })
    .from(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.provider, "anthropic")));
  if (cred) return decryptSecret(cred.ciphertext);
  return cfg("ANTHROPIC_API_KEY") || null;
}

export async function hasLlm(orgId: string): Promise<boolean> {
  return !!(await anthropicKey(orgId));
}

export async function complete(req: CompletionRequest): Promise<Completion> {
  const modelId = ROUTES[req.task];
  const info = modelInfo(modelId);
  if (!info || info.provider !== "anthropic") {
    throw new ApiError("provider_not_configured", `No implemented provider is routed for ${req.task}`);
  }
  const apiKey = await anthropicKey(req.orgId);
  if (!apiKey) {
    throw new ApiError(
      "provider_not_configured",
      "No AI provider is connected. Add an Anthropic API key under Settings → AI providers.",
    );
  }
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 170_000 });
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
      costMicroUsd: costMicroUsd(modelId, inputTokens, outputTokens),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (req.signal.aborted) throw new ApiError("conflict", "Cancelled");
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

/** The workspace's Anthropic client, or a clear "not connected" error. Refuses once the month's AI budget is spent. */
export async function anthropicFor(orgId: string) {
  const apiKey = await anthropicKey(orgId);
  if (!apiKey) throw new ApiError("provider_not_configured", "No AI provider is connected. Add an Anthropic API key under Settings → AI providers.");
  const { monthlySpend } = await import("./tasks");
  const spend = await monthlySpend(orgId);
  if (spend.costMicroUsd >= spend.budgetMicroUsd) throw new ApiError("conflict", "This month's AI budget is used up. It resets on the 1st, or raise AI_MONTHLY_BUDGET_USD.");
  // The plan's monthly AI allowance (Free: 25 requests).
  await (await import("../billing/subscriptions")).assertQuota(orgId, "aiPerMonth");
  return makeClient(apiKey);
}

/** Record what a call cost, so it counts against the monthly budget like every other AI task. */
export async function recordUsage(orgId: string, userId: string | null, kind: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }, model: string, meta: Record<string, unknown> = {}) {
  const inputTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  await db.insert(schema.aiTasks).values({ orgId, kind, status: "succeeded", input: meta, provider: "anthropic", model, inputTokens, outputTokens: usage.output_tokens, costMicroUsd: costMicroUsd(ROUTES.chat, inputTokens, usage.output_tokens), createdBy: userId, startedAt: new Date(), finishedAt: new Date() });
}

/** Turn an SDK failure into a message people can act on (never the key, never raw provider text). */
export function providerError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new ApiError("provider_error", "The Anthropic API key was rejected. Check it under Settings → AI providers.");
  if (err instanceof Anthropic.RateLimitError) return new ApiError("provider_error", "The AI provider is rate limiting requests. Retry in a minute.");
  if (err instanceof Anthropic.APIError) return new ApiError("provider_error", `The AI provider returned an error (${err.status ?? "network"}).`);
  return new ApiError("provider_error", "Could not reach the AI provider.");
}

export const COPILOT_MODEL = ROUTES.chat;
