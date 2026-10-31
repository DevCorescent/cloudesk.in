import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { bannedIn, lockViolations, voicePrompt } from "@/lib/site/brand-rules";
import { applyTexts, checkTranslations, chunkTexts, collectTexts } from "@/lib/site/translate";
import { getBrandRules } from "../services/brand";
import { db, schema } from "@/db";
import { runCommand } from "@/lib/site/commands";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH, siteDocSchema } from "@/lib/site/model";
import { planFromBrief } from "@/lib/site/planner";
import { projectSpecSchema } from "@/lib/site/spec";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { audit } from "../services/audit";
import { createFile, deleteFile, normalizePath, readAllFiles, readFile, writeFile } from "../services/files";
import { hasLlm } from "./gateway";
import { completeJson } from "./json";
import { CODE_EDIT_SYSTEM, PLAN_SYSTEM, SITE_EDIT_SYSTEM, TRANSLATE_SYSTEM } from "./prompts";
import { cfg } from "../platform/config";

export const TASK_KINDS = ["plan", "site_edit", "code_edit", "translate"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

const TASK_TIMEOUT_MS = 180_000;
const MAX_CONTEXT_CHARS = 200_000;

export const planInput = z.object({ brief: z.string().trim().min(10).max(4000), name: z.string().trim().max(120).optional(), answers: z.record(z.string(), z.string().max(1000)).optional() });
export const siteEditInput = z.object({ instruction: z.string().trim().min(3).max(2000), pageId: z.string().max(64).optional(), sectionId: z.string().max(64).optional() });
export const translateInput = z.object({ lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/) });
export const codeEditInput = z.object({ instruction: z.string().trim().min(3).max(4000), paths: z.array(z.string().max(200)).max(20).default([]) });

export type ProposedChange = { path: string; action: "create" | "update" | "delete"; baseRevision: number | null; before: string | null; after: string | null };
export type TaskResult =
  | { type: "plan"; planner: "builtin" | "llm"; spec: z.infer<typeof projectSpecSchema> }
  | { type: "changes"; planner: "builtin" | "llm"; summary: string; changes: ProposedChange[]; decision?: "applied" | "rejected" };

// In-process runner. Each running task has an AbortController so cancellation
// interrupts the provider request instead of waiting for it to finish.
const running = new Map<string, AbortController>();

/** Monthly AI spend ceiling per organization, enforced server-side. */
export function monthlyBudgetMicroUsd() {
  return Math.round(Number(cfg("AI_MONTHLY_BUDGET_USD") ?? 20) * 1_000_000);
}

export async function monthlySpend(orgId: string) {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const [{ cost, tasks, tokens }] = await db
    .select({
      cost: sql<number>`coalesce(sum(${schema.aiTasks.costMicroUsd}),0)::bigint`,
      tasks: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${schema.aiTasks.inputTokens} + ${schema.aiTasks.outputTokens}),0)::bigint`,
    })
    .from(schema.aiTasks)
    .where(and(eq(schema.aiTasks.orgId, orgId), gte(schema.aiTasks.createdAt, since)));
  return { costMicroUsd: Number(cost), tasks, tokens: Number(tokens), budgetMicroUsd: monthlyBudgetMicroUsd(), since };
}

async function step(taskId: string, label: string, status: "running" | "done" | "error" | "info" = "done", detail?: string) {
  await db.insert(schema.aiTaskSteps).values({ taskId, label, status, detail });
}

export async function createTask(input: { orgId: string; projectId: string | null; userId: string; kind: TaskKind; payload: unknown; parentTaskId?: string; attempt?: number }) {
  const active = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.aiTasks)
    .where(and(eq(schema.aiTasks.createdBy, input.userId), inArray(schema.aiTasks.status, ["queued", "running"])));
  if (active[0].n >= 3) throw new ApiError("rate_limited", "You already have 3 AI tasks running. Wait for one to finish.");
  const spend = await monthlySpend(input.orgId);
  if (spend.costMicroUsd >= spend.budgetMicroUsd) {
    throw new ApiError("forbidden", "This organization has reached its monthly AI budget.");
  }
  await (await import("../billing/subscriptions")).assertQuota(input.orgId, "aiPerMonth");
  const [task] = await db
    .insert(schema.aiTasks)
    .values({
      orgId: input.orgId,
      projectId: input.projectId,
      kind: input.kind,
      input: input.payload as object,
      createdBy: input.userId,
      parentTaskId: input.parentTaskId,
      attempt: input.attempt ?? 1,
    })
    .returning();
  await audit({ orgId: input.orgId, actorId: input.userId, action: "ai_task.created", targetType: "ai_task", targetId: task.id, metadata: { kind: input.kind } });
  setTimeout(() => void runTask(task.id), 0);
  return task;
}

export async function runTask(taskId: string) {
  const [claimed] = await db
    .update(schema.aiTasks)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(schema.aiTasks.id, taskId), eq(schema.aiTasks.status, "queued"), eq(schema.aiTasks.cancelRequested, false)))
    .returning();
  if (!claimed) return;
  const controller = new AbortController();
  running.set(taskId, controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TASK_TIMEOUT_MS)]);
  try {
    const out = await execute(claimed, signal);
    if (signal.aborted) throw new ApiError("conflict", "Cancelled");
    const status = out.result.type === "plan" ? "succeeded" : "awaiting_review";
    await db
      .update(schema.aiTasks)
      .set({ status, result: out.result, finishedAt: new Date(), ...out.usage })
      .where(and(eq(schema.aiTasks.id, taskId), eq(schema.aiTasks.status, "running")));
    await step(taskId, status === "awaiting_review" ? "Ready for review" : "Completed");
  } catch (err) {
    const cancelled = controller.signal.aborted;
    const timedOut = !cancelled && signal.aborted;
    const e = err instanceof ApiError ? err : null;
    const message = cancelled ? "Cancelled" : timedOut ? "The task took too long and was stopped." : (e?.message ?? "The task failed unexpectedly.");
    if (!e && !cancelled && !timedOut) log.error("ai_task_failed", { taskId, error: err instanceof Error ? err.stack : String(err) });
    await db
      .update(schema.aiTasks)
      .set({ status: cancelled ? "cancelled" : "failed", error: message, errorCode: cancelled ? "cancelled" : timedOut ? "timeout" : (e?.code ?? "internal_error"), finishedAt: new Date() })
      .where(eq(schema.aiTasks.id, taskId));
    const problems = (e?.details as { problems?: string[] } | undefined)?.problems;
    // The message itself is shown by the task's error field; steps only add detail.
    await step(taskId, cancelled ? "Cancelled" : "Failed", "error", problems?.join("\n"));
  } finally {
    running.delete(taskId);
  }
}

type Row = typeof schema.aiTasks.$inferSelect;
type Exec = { result: TaskResult; usage: { provider: string; model: string; inputTokens: number; outputTokens: number; costMicroUsd: number } };
const NO_USAGE = { provider: "builtin", model: "builtin-rules", inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };

async function execute(task: Row, signal: AbortSignal): Promise<Exec> {
  const onStep = (label: string) => step(task.id, label, "info");
  const llm = await hasLlm(task.orgId);

  if (task.kind === "plan") {
    const input = planInput.parse(task.input);
    const answers = input.answers ? Object.entries(input.answers).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
    if (!llm) {
      await step(task.id, "No AI provider connected — using the built-in rule-based planner");
      const brief = answers ? `${input.brief}\n${answers}` : input.brief;
      return { result: { type: "plan", planner: "builtin", spec: planFromBrief(brief, { name: input.name || input.answers?.name }) }, usage: NO_USAGE };
    }
    await step(task.id, "Analysing the brief");
    const { value, usage } = await completeJson(
      {
        orgId: task.orgId,
        task: "planning",
        system: PLAN_SYSTEM,
        signal,
        maxTokens: 16_000,
        messages: [{ role: "user", content: `<user_brief>\n${input.brief}\n${input.name ? `Business name: ${input.name}\n` : ""}${answers ? `Answers to earlier questions:\n${answers}\n` : ""}</user_brief>` }],
      },
      projectSpecSchema,
      { onStep },
    );
    await step(task.id, "Specification validated");
    return { result: { type: "plan", planner: "llm", spec: value }, usage };
  }

  if (!task.projectId) throw new ApiError("bad_request", "Task has no project");

  if (task.kind === "site_edit") {
    const input = siteEditInput.parse(task.input);
    await step(task.id, "Reading the design document");
    const file = await readFile(task.projectId, SITE_DOC_PATH);
    const parsed = parseSiteDoc(file.content);
    if (!parsed.ok) throw new ApiError("validation_failed", "The design document is invalid; fix it in the IDE first.", { problems: parsed.errors });

    const builtin = runCommand(parsed.doc, input.instruction, input.pageId);
    if (builtin) {
      await step(task.id, "Recognised as a built-in command (no AI model used)");
      return {
        result: {
          type: "changes",
          planner: "builtin",
          summary: builtin.summary,
          changes: [{ path: SITE_DOC_PATH, action: "update", baseRevision: file.revision, before: file.content, after: serializeSiteDoc(builtin.doc) }],
        },
        usage: NO_USAGE,
      };
    }
    if (!llm) {
      throw new ApiError(
        "provider_not_configured",
        "This request needs an AI model. Connect Anthropic under Settings → AI providers, or use a built-in design action such as “Make it more premium”, “Switch to dark mode” or “Add a pricing section”.",
      );
    }
    await step(task.id, "Asking the model for a revised design");
    const rules = await getBrandRules(task.projectId);
    const brand = voicePrompt(rules);
    const focus = input.sectionId ? `\nThe user has selected section id "${input.sectionId}"${input.pageId ? ` on page id "${input.pageId}"` : ""}; apply the instruction to it unless the instruction clearly says otherwise.` : input.pageId ? `\nThe user is viewing page id "${input.pageId}".` : "";
    const { value, usage } = await completeJson(
      {
        orgId: task.orgId,
        task: "site_edit",
        system: SITE_EDIT_SYSTEM,
        signal,
        messages: [{ role: "user", content: `<project_file path="${SITE_DOC_PATH}">\n${file.content}\n</project_file>\n<instruction>\n${input.instruction}\n</instruction>${focus}${brand ? `\n${brand}` : ""}` }],
      },
      z.object({ summary: z.string().max(1000), doc: siteDocSchema }),
      // Brand rules are checked before the proposal is shown; violations go back to the model to fix.
      { onStep, extraValidate: (v) => (rules ? lockViolations(parsed.doc, v.doc, rules, { ai: true }) : []) },
    );
    await step(task.id, "Validated the revised design document");
    return {
      result: { type: "changes", planner: "llm", summary: value.summary, changes: [{ path: SITE_DOC_PATH, action: "update", baseRevision: file.revision, before: file.content, after: serializeSiteDoc(value.doc) }] },
      usage,
    };
  }

  if (task.kind === "translate") {
    const input = translateInput.parse(task.input);
    if (!llm) throw new ApiError("provider_not_configured", "Translation needs an AI model. Connect Anthropic under Settings → AI providers.");
    await step(task.id, "Reading the design document");
    const file = await readFile(task.projectId, SITE_DOC_PATH);
    const parsed = parseSiteDoc(file.content);
    if (!parsed.ok) throw new ApiError("validation_failed", "The design document is invalid; fix it in the IDE first.", { problems: parsed.errors });
    const items = collectTexts(parsed.doc, input.lang);
    if (!items.length) throw new ApiError("conflict", `There are no pages in “${input.lang}” to translate. Add a language in Pages first.`);
    const language = new Intl.DisplayNames(["en"], { type: "language" }).of(input.lang) ?? input.lang;
    const rules = await getBrandRules(task.projectId);
    const brand = voicePrompt(rules);
    const chunks = chunkTexts(items);
    const usage = { ...NO_USAGE };
    const out: Record<string, string> = {};
    for (const [i, chunk] of chunks.entries()) {
      await step(task.id, `Translating ${chunk.length} text${chunk.length === 1 ? "" : "s"} into ${language}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ""}`);
      const r = await completeJson(
        {
          orgId: task.orgId,
          task: "site_edit",
          system: TRANSLATE_SYSTEM,
          signal,
          messages: [{ role: "user", content: `Target language: ${language} (${input.lang})\nWebsite: ${parsed.doc.name}${brand ? `\n${brand}` : ""}\n<texts>\n${JSON.stringify(Object.fromEntries(chunk.map((c) => [c.key, c.text])), null, 1)}\n</texts>` }],
        },
        z.record(z.string(), z.string()),
        { onStep, extraValidate: (v) => [...checkTranslations(chunk, v), ...Object.values(v).flatMap((t) => bannedIn(t, rules?.bannedWords ?? []).map((w) => `Do not use “${w}”`))] },
      );
      Object.assign(out, r.value);
      usage.provider = r.usage.provider;
      usage.model = r.usage.model;
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      usage.costMicroUsd += r.usage.costMicroUsd;
    }
    const doc = structuredClone(parsed.doc);
    const changed = applyTexts(doc, input.lang, out);
    await step(task.id, `Prepared ${changed} translated field${changed === 1 ? "" : "s"}; layout, links and prices are unchanged`);
    return {
      result: { type: "changes", planner: "llm", summary: `Translated ${changed} texts on the ${language} pages.`, changes: [{ path: SITE_DOC_PATH, action: "update", baseRevision: file.revision, before: file.content, after: serializeSiteDoc(doc) }] },
      usage,
    };
  }

  if (task.kind === "code_edit") {
    const input = codeEditInput.parse(task.input);
    if (!llm) throw new ApiError("provider_not_configured", "Code changes need an AI model. Connect Anthropic under Settings → AI providers.");
    await step(task.id, "Collecting project context");
    const files = await readAllFiles(task.projectId);
    const wanted = new Set(input.paths.map((p) => normalizePath(p)));
    // Requested files first, then everything else while it fits.
    const ordered = [...files.filter((f) => wanted.has(f.path)), ...files.filter((f) => !wanted.has(f.path))];
    let budget = MAX_CONTEXT_CHARS;
    const included: typeof files = [];
    for (const f of ordered) {
      if (f.content.length > budget) continue;
      budget -= f.content.length;
      included.push(f);
    }
    const listing = files.map((f) => `- ${f.path}${included.includes(f) ? "" : " (not included)"}`).join("\n");
    const context = included.map((f) => `<project_file path="${f.path}">\n${f.content}\n</project_file>`).join("\n");
    await step(task.id, `Sending ${included.length} of ${files.length} files to the model`);
    const changeSchema = z.object({
      summary: z.string().max(2000),
      changes: z.array(z.object({ path: z.string().max(200), action: z.enum(["create", "update", "delete"]), content: z.string() })).max(30),
    });
    const byPath = new Map(files.map((f) => [f.path, f]));
    const { value, usage } = await completeJson(
      {
        orgId: task.orgId,
        task: "code_edit",
        system: CODE_EDIT_SYSTEM,
        signal,
        messages: [{ role: "user", content: `Project files:\n${listing}\n\n${context}\n\n<instruction>\n${input.instruction}\n</instruction>` }],
      },
      changeSchema,
      {
        onStep,
        extraValidate: (v) =>
          v.changes.flatMap((c) => {
            try {
              const p = normalizePath(c.path);
              if (c.action !== "create" && !byPath.has(p)) return [`${c.path}: file does not exist; use action "create"`];
              if (c.action === "create" && byPath.has(p)) return [`${c.path}: file already exists; use action "update"`];
              if (p === SITE_DOC_PATH && c.action !== "delete") {
                const r = parseSiteDoc(c.content);
                if (!r.ok) return r.errors.slice(0, 10).map((e) => `${p}: ${e}`);
              }
              if (p === SITE_DOC_PATH && c.action === "delete") return [`${p} cannot be deleted`];
              return [];
            } catch (e) {
              return [`${c.path}: ${(e as Error).message}`];
            }
          }),
      },
    );
    const changes: ProposedChange[] = value.changes.map((c) => {
      const path = normalizePath(c.path);
      const cur = byPath.get(path);
      return { path, action: c.action, baseRevision: cur?.revision ?? null, before: cur?.content ?? null, after: c.action === "delete" ? null : c.content };
    });
    await step(task.id, `Proposed changes to ${changes.length} file${changes.length === 1 ? "" : "s"}`);
    return { result: { type: "changes", planner: "llm", summary: value.summary, changes }, usage };
  }
  throw new ApiError("bad_request", `Unknown task kind ${task.kind}`);
}

// ─── Lifecycle operations ────────────────────────────────────────────────────

export async function getTask(taskId: string) {
  const [t] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.id, taskId));
  if (!t) throw notFound("Task");
  const steps = await db.select().from(schema.aiTaskSteps).where(eq(schema.aiTaskSteps.taskId, taskId)).orderBy(asc(schema.aiTaskSteps.createdAt));
  return { ...t, steps };
}

export async function listProjectTasks(projectId: string, limit = 30) {
  return db
    .select({
      id: schema.aiTasks.id,
      kind: schema.aiTasks.kind,
      status: schema.aiTasks.status,
      input: schema.aiTasks.input,
      error: schema.aiTasks.error,
      model: schema.aiTasks.model,
      inputTokens: schema.aiTasks.inputTokens,
      outputTokens: schema.aiTasks.outputTokens,
      costMicroUsd: schema.aiTasks.costMicroUsd,
      createdAt: schema.aiTasks.createdAt,
      finishedAt: schema.aiTasks.finishedAt,
    })
    .from(schema.aiTasks)
    .where(eq(schema.aiTasks.projectId, projectId))
    .orderBy(desc(schema.aiTasks.createdAt))
    .limit(limit);
}

export async function cancelTask(taskId: string, userId: string) {
  const [t] = await db
    .update(schema.aiTasks)
    .set({ cancelRequested: true })
    .where(and(eq(schema.aiTasks.id, taskId), inArray(schema.aiTasks.status, ["queued", "running"])))
    .returning();
  if (!t) throw new ApiError("conflict", "Only queued or running tasks can be cancelled");
  // Queued tasks never started; mark them directly.
  await db
    .update(schema.aiTasks)
    .set({ status: "cancelled", error: "Cancelled", errorCode: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.aiTasks.id, taskId), eq(schema.aiTasks.status, "queued")));
  running.get(taskId)?.abort();
  await audit({ orgId: t.orgId, actorId: userId, action: "ai_task.cancelled", targetType: "ai_task", targetId: taskId });
}

export async function retryTask(taskId: string, userId: string) {
  const [t] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.id, taskId));
  if (!t) throw notFound("Task");
  if (!["failed", "cancelled"].includes(t.status)) throw new ApiError("conflict", "Only failed or cancelled tasks can be retried");
  if (t.attempt >= 5) throw new ApiError("conflict", "This task has been retried too many times");
  return createTask({ orgId: t.orgId, projectId: t.projectId, userId, kind: t.kind as TaskKind, payload: t.input, parentTaskId: t.id, attempt: t.attempt + 1 });
}

/**
 * Applies reviewed changes. Every write is checked against the revision the
 * AI saw; if anyone edited a file since, nothing is applied (all-or-nothing).
 */
export async function applyTask(taskId: string, userId: string, canWrite: (path: string) => boolean) {
  const [t] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.id, taskId));
  if (!t || !t.projectId) throw notFound("Task");
  if (t.status !== "awaiting_review") throw new ApiError("conflict", "This task has no changes waiting for review");
  const result = t.result as TaskResult;
  if (result.type !== "changes") throw new ApiError("conflict", "Nothing to apply");
  for (const c of result.changes) if (!canWrite(c.path)) throw new ApiError("forbidden", `You do not have permission to change ${c.path}`);
  const projectId = t.projectId;
  const author = { userId, source: "ai" as const, aiTaskId: t.id, message: result.summary.slice(0, 200) };
  await db.transaction(async (tx) => {
    for (const c of result.changes) {
      if (c.action === "create") await createFile(projectId, c.path, c.after ?? "", author, tx);
      else if (c.action === "update") await writeFile(projectId, c.path, c.after ?? "", c.baseRevision ?? -1, author, tx);
      else await deleteFile(projectId, c.path, c.baseRevision ?? -1, author, tx);
    }
    const [claimed] = await tx
      .update(schema.aiTasks)
      .set({ status: "succeeded", result: { ...result, decision: "applied" } })
      .where(and(eq(schema.aiTasks.id, taskId), eq(schema.aiTasks.status, "awaiting_review")))
      .returning();
    if (!claimed) throw new ApiError("conflict", "This task was already handled");
  });
  await audit({ orgId: t.orgId, actorId: userId, action: "ai_task.applied", targetType: "ai_task", targetId: taskId, metadata: { files: result.changes.map((c) => c.path) } });
}

export async function rejectTask(taskId: string, userId: string) {
  const [t] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.id, taskId));
  if (!t) throw notFound("Task");
  if (t.status !== "awaiting_review") throw new ApiError("conflict", "This task has no changes waiting for review");
  await db
    .update(schema.aiTasks)
    .set({ status: "cancelled", error: "Changes rejected", errorCode: "rejected", result: { ...(t.result as object), decision: "rejected" } })
    .where(eq(schema.aiTasks.id, taskId));
  await audit({ orgId: t.orgId, actorId: userId, action: "ai_task.rejected", targetType: "ai_task", targetId: taskId });
}

/** Tasks left "running" by a crashed or restarted process are marked failed. */
/**
 * Fails tasks that will never finish. A task runs on the server that started it,
 * so with several servers only tasks older than `staleMs` can be called
 * interrupted — younger ones may still be running elsewhere. The worker sweeps
 * every few minutes; `staleMs` 0 fails every queued or running task (a single
 * server restarting).
 */
export async function recoverInterruptedTasks(staleMs = 0) {
  const before = new Date(Date.now() - staleMs);
  const r = await db
    .update(schema.aiTasks)
    .set({ status: "failed", error: "Interrupted by a server restart. Retry the task.", errorCode: "interrupted", finishedAt: new Date() })
    .where(and(inArray(schema.aiTasks.status, ["queued", "running"]), lt(sql`coalesce(${schema.aiTasks.startedAt}, ${schema.aiTasks.createdAt})`, before)))
    .returning({ id: schema.aiTasks.id });
  if (r.length) log.warn("ai_tasks_recovered", { count: r.length, staleMs });
}
