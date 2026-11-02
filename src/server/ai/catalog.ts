// Explicit provider/model capability registry. Nothing assumes that every
// provider supports the same features; the UI reads this to explain what is
// available and why.
export type ProviderId = "anthropic" | "gemini" | "openai" | "builtin";

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
  capabilities: ("planning" | "site_edit" | "code_edit" | "chat")[];
};

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  description: string;
  implemented: boolean;
  envVar?: string;
  docsUrl?: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models for planning, site editing and code changes.",
    implemented: true,
    envVar: "ANTHROPIC_API_KEY",
    docsUrl: "https://platform.claude.com/docs",
  },
  {
    id: "gemini",
    name: "Google Gemini (free)",
    description: "Gemini Flash on Google's free tier — for trying the copilot, mail and chat AI without paying. Used when no Anthropic key is connected.",
    implemented: true,
    envVar: "GEMINI_API_KEY",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Adapter interface reserved. Not implemented yet, so it cannot be connected.",
    implemented: false,
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "builtin",
    name: "Built-in rules",
    description: "Deterministic planner and a small set of recognised edit commands. Not an AI model.",
    implemented: true,
  },
];

export const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    label: "Claude Opus 5.5",
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    inputPrice: 4,
    outputPrice: 20,
    capabilities: ["planning", "site_edit", "code_edit", "chat"],
  },
  {
    id: "gemini-flash",
    provider: "gemini",
    label: "Gemini Flash (free tier)",
    contextTokens: 1_000_000,
    maxOutputTokens: 65_536,
    inputPrice: 0,
    outputPrice: 0,
    capabilities: ["planning", "site_edit", "code_edit", "chat"],
  },
  {
    id: "builtin-rules",
    provider: "builtin",
    label: "Built-in rules",
    contextTokens: 0,
    maxOutputTokens: 0,
    inputPrice: 0,
    outputPrice: 0,
    capabilities: ["planning", "site_edit"],
  },
];

export type TaskType = "planning" | "site_edit" | "code_edit" | "chat";

// Task routing policy: which model handles which kind of work.
export const ROUTES: Record<TaskType, string> = {
  planning: "claude-opus-5-5",
  site_edit: "claude-opus-5-5",
  code_edit: "claude-opus-5-5",
  chat: "claude-opus-5-5",
};

export function modelInfo(id: string) {
  return MODELS.find((m) => m.id === id);
}

export function costMicroUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = modelInfo(modelId);
  if (!m) return 0;
  return Math.round(inputTokens * m.inputPrice + outputTokens * m.outputPrice);
}
