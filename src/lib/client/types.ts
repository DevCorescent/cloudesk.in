export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  description: string;
  updatedAt: string;
  productionDeploymentId: string | null;
};

export type TemplateInfo = { id: string; name: string; category: string; description: string; features: string[]; requiredIntegrations: string[]; defaultName: string };

export type TaskStep = { id: string; label: string; status: string; detail: string | null; createdAt: string };

export type ProposedChange = { path: string; action: "create" | "update" | "delete"; baseRevision: number | null; before: string | null; after: string | null };

export type AiTask = {
  id: string;
  kind: string;
  status: "queued" | "running" | "awaiting_review" | "succeeded" | "failed" | "cancelled";
  input: Record<string, unknown>;
  result:
    | { type: "plan"; planner: "builtin" | "llm"; spec: import("@/lib/site/spec").ProjectSpec }
    | { type: "changes"; planner: "builtin" | "llm"; summary: string; changes: ProposedChange[]; decision?: string }
    | null;
  error: string | null;
  errorCode: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  attempt: number;
  parentTaskId: string | null;
  createdAt: string;
  finishedAt: string | null;
  steps: TaskStep[];
};
