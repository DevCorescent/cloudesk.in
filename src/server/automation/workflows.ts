// Workflow automation: triggers start runs; each step of a run is a durable
// job, so steps retry with backoff, survive restarts and can wait for days.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { cronMatches, isValidTimeZone, parseCron, zonedParts } from "@/lib/automation/cron";
import { delayMs, evaluateCondition, MAX_STEPS, renderTemplate, stepSchema, triggerSchema, workflowInputSchema, type Step, type TemplateScope, type Trigger, type TriggerType } from "@/lib/automation/model";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { safeRequest, type SafeResponse } from "../net/safe-fetch";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl, sendMail } from "../services/mail";
import { log } from "../log";
import { assertWithinLimit } from "../billing/billing";

export const MAX_WORKFLOWS = 50;
export const MAX_RUNS_PER_DAY = 5000;
export const MAX_EMAILS_PER_DAY = 200;

type Http = (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => Promise<SafeResponse>;
let http: Http = (url, opts) => safeRequest(url, { ...opts, maxBytes: 64_000, timeoutMs: 10_000 });
/** Test hook. */
export function setWorkflowHttp(fn: Http | null) {
  http = fn ?? ((url, opts) => safeRequest(url, { ...opts, maxBytes: 64_000, timeoutMs: 10_000 }));
}

type WorkflowRow = typeof schema.workflows.$inferSelect;
type Snapshot = { name: string; trigger: Trigger; steps: Step[] };
type StepLog = { id: string; type: string; status: "succeeded" | "failed" | "stopped" | "waiting"; output?: unknown; error?: string; attempts: number; finishedAt?: string };

// ─── Definitions ─────────────────────────────────────────────────────────────

function validate(input: { trigger: Trigger; steps: Step[] }) {
  if (input.trigger.type === "schedule") {
    try {
      parseCron(input.trigger.config.cron);
    } catch (e) {
      throw new ApiError("validation_failed", `Schedule: ${(e as Error).message}`, { cron: [(e as Error).message] });
    }
    if (!isValidTimeZone(input.trigger.config.timezone)) throw new ApiError("validation_failed", "Unknown time zone", { timezone: ["Unknown time zone"] });
  }
  const ids = new Set<string>();
  for (const s of input.steps) {
    if (ids.has(s.id)) throw new ApiError("validation_failed", `Two steps share the id "${s.id}"`);
    ids.add(s.id);
  }
}

function publicView(w: WorkflowRow) {
  const secretNames = w.secretsEnc ? Object.keys(JSON.parse(decryptSecret(w.secretsEnc)) as Record<string, string>) : [];
  return { id: w.id, name: w.name, enabled: w.enabled, trigger: w.trigger as Trigger, steps: w.steps as Step[], secretNames, hasWebhook: !!w.webhookTokenHash, createdAt: w.createdAt, updatedAt: w.updatedAt };
}

export async function listWorkflows(projectId: string) {
  const rows = await db.select().from(schema.workflows).where(eq(schema.workflows.projectId, projectId)).orderBy(desc(schema.workflows.updatedAt));
  const since = new Date(Date.now() - 7 * 86400_000);
  const stats = await db
    .select({ workflowId: schema.workflowRuns.workflowId, status: schema.workflowRuns.status, n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.workflowRuns.startedAt})` })
    .from(schema.workflowRuns)
    .where(and(eq(schema.workflowRuns.projectId, projectId), gt(schema.workflowRuns.startedAt, since)))
    .groupBy(schema.workflowRuns.workflowId, schema.workflowRuns.status);
  return rows.map((w) => {
    const s = stats.filter((x) => x.workflowId === w.id);
    return { ...publicView(w), runs7d: s.reduce((a, x) => a + x.n, 0), failed7d: s.filter((x) => x.status === "failed").reduce((a, x) => a + x.n, 0), lastRunAt: s.map((x) => x.last).sort().at(-1) ?? null };
  });
}

export async function getWorkflow(projectId: string, id: string) {
  const [w] = await db.select().from(schema.workflows).where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)));
  if (!w) throw notFound("Workflow");
  return w;
}

function mergeSecrets(existing: string | null, incoming: Record<string, string>) {
  const cur = existing ? (JSON.parse(decryptSecret(existing)) as Record<string, string>) : {};
  const next: Record<string, string> = {};
  // Names not sent are removed; an empty value keeps what was stored.
  for (const [k, v] of Object.entries(incoming)) next[k] = v === "" ? (cur[k] ?? "") : v;
  return Object.keys(next).length ? encryptSecret(JSON.stringify(next)) : null;
}

export async function saveWorkflow(project: { id: string; orgId: string }, userId: string, raw: unknown, id?: string) {
  const input = workflowInputSchema.parse(raw);
  validate(input);
  if (id) {
    const w = await getWorkflow(project.id, id);
    const [u] = await db
      .update(schema.workflows)
      .set({ name: input.name, trigger: input.trigger, steps: input.steps, secretsEnc: mergeSecrets(w.secretsEnc, input.secrets), updatedAt: new Date() })
      .where(eq(schema.workflows.id, w.id))
      .returning();
    await audit({ orgId: project.orgId, actorId: userId, action: "workflow.updated", targetType: "workflow", targetId: w.id });
    return publicView(u);
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workflows).where(eq(schema.workflows.projectId, project.id));
  if (n >= MAX_WORKFLOWS) throw new ApiError("conflict", `A project can have up to ${MAX_WORKFLOWS} automations`);
  await assertWithinLimit(project.orgId, "automationsPerProject", n);
  const [w] = await db
    .insert(schema.workflows)
    .values({ projectId: project.id, name: input.name, trigger: input.trigger, steps: input.steps, secretsEnc: mergeSecrets(null, input.secrets), createdBy: userId })
    .returning();
  await audit({ orgId: project.orgId, actorId: userId, action: "workflow.created", targetType: "workflow", targetId: w.id });
  return publicView(w);
}

export async function setEnabled(project: { id: string; orgId: string }, userId: string, id: string, enabled: boolean) {
  const w = await getWorkflow(project.id, id);
  if (enabled && !(w.steps as Step[]).length) throw new ApiError("conflict", "Add at least one step first");
  await db.update(schema.workflows).set({ enabled, updatedAt: new Date(), ...(enabled && (w.trigger as Trigger).type === "schedule" ? { lastScheduledAt: new Date() } : {}) }).where(eq(schema.workflows.id, w.id));
  await audit({ orgId: project.orgId, actorId: userId, action: enabled ? "workflow.enabled" : "workflow.disabled", targetType: "workflow", targetId: w.id });
}

export async function deleteWorkflow(project: { id: string; orgId: string }, userId: string, id: string) {
  const w = await getWorkflow(project.id, id);
  await db.delete(schema.workflows).where(eq(schema.workflows.id, w.id));
  await audit({ orgId: project.orgId, actorId: userId, action: "workflow.deleted", targetType: "workflow", targetId: w.id, metadata: { name: w.name } });
}

/** A new secret webhook URL; the old one stops working. Shown once. */
export async function rotateWebhook(projectId: string, id: string) {
  const w = await getWorkflow(projectId, id);
  const token = randomToken(24);
  await db.update(schema.workflows).set({ webhookTokenHash: sha256(token) }).where(eq(schema.workflows.id, w.id));
  return { url: appUrl(`/api/v1/hooks/w/${token}`) };
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function startRun(w: WorkflowRow, triggerType: TriggerType, input: unknown) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.workflowId, w.id), gt(schema.workflowRuns.startedAt, new Date(Date.now() - 86400_000))));
  if (n >= MAX_RUNS_PER_DAY) {
    log.warn("workflow_run_limit", { workflowId: w.id });
    return null;
  }
  const snapshot: Snapshot = { name: w.name, trigger: triggerSchema.parse(w.trigger), steps: (w.steps as unknown[]).map((s) => stepSchema.parse(s)) };
  const [run] = await db
    .insert(schema.workflowRuns)
    .values({ workflowId: w.id, projectId: w.projectId, triggerType, input: (input ?? {}) as object, snapshot, status: snapshot.steps.length ? "running" : "succeeded", finishedAt: snapshot.steps.length ? null : new Date() })
    .returning();
  if (snapshot.steps.length) await enqueue("workflow.step", { runId: run.id, index: 0 }, { projectId: w.projectId, maxAttempts: 5 });
  return run;
}

export async function runManually(projectId: string, id: string, input: unknown) {
  const w = await getWorkflow(projectId, id);
  if (!(w.steps as Step[]).length) throw new ApiError("conflict", "Add at least one step first");
  return startRun(w, "manual", input);
}

export async function listRuns(projectId: string, workflowId: string, limit = 50) {
  return db
    .select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status, triggerType: schema.workflowRuns.triggerType, input: schema.workflowRuns.input, log: schema.workflowRuns.log, error: schema.workflowRuns.error, startedAt: schema.workflowRuns.startedAt, finishedAt: schema.workflowRuns.finishedAt })
    .from(schema.workflowRuns)
    .where(and(eq(schema.workflowRuns.projectId, projectId), eq(schema.workflowRuns.workflowId, workflowId)))
    .orderBy(desc(schema.workflowRuns.startedAt))
    .limit(limit);
}

async function loadScope(run: typeof schema.workflowRuns.$inferSelect, w: WorkflowRow | undefined): Promise<TemplateScope> {
  const [p] = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, run.projectId));
  const steps: Record<string, unknown> = {};
  for (const l of run.log as StepLog[]) if (l.output !== undefined) steps[l.id] = l.output;
  const secrets = w?.secretsEnc ? (JSON.parse(decryptSecret(w.secretsEnc)) as Record<string, string>) : {};
  return { trigger: run.input, steps, workflow: { name: (run.snapshot as Snapshot).name }, project: { name: p?.name ?? "" }, run: { id: run.id }, secrets };
}

/**
 * Emails may go to teammates, or — for runs started by real site activity
 * (forms, orders, bookings) — to an address in that activity (the customer).
 * Webhook, manual and scheduled runs can only email teammates, so a leaked
 * webhook URL can't be used to send mail to strangers.
 */
const CUSTOMER_TRIGGERS = new Set(["form_submitted", "order_placed", "order_paid", "booking_confirmed"]);
async function allowedRecipient(projectId: string, to: string, run: { input: unknown; triggerType: string }) {
  const addr = to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  if (CUSTOMER_TRIGGERS.has(run.triggerType) && JSON.stringify(run.input ?? {}).toLowerCase().includes(`"${addr}"`)) return true;
  const [m] = await db
    .select({ id: schema.users.id })
    .from(schema.projects)
    .innerJoin(schema.memberships, eq(schema.memberships.orgId, schema.projects.orgId))
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.projects.id, projectId), sql`lower(${schema.users.email}) = ${addr}`));
  return !!m;
}

async function runStep(step: Step, scope: TemplateScope, run: typeof schema.workflowRuns.$inferSelect): Promise<{ output?: unknown; stop?: boolean; delay?: number }> {
  switch (step.type) {
    case "send_email": {
      const to = renderTemplate(step.config.to, scope);
      if (!(await allowedRecipient(run.projectId, to, run))) throw new PermanentError(`Emails can go to teammates, or to the customer from a form, order or booking; "${to}" is neither`);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.jobs)
        .where(and(eq(schema.jobs.projectId, run.projectId), eq(schema.jobs.kind, "workflow.step"), eq(schema.jobs.status, "succeeded"), sql`${schema.jobs.result}->>'type' = 'send_email'`, gt(schema.jobs.finishedAt, new Date(Date.now() - 86400_000))));
      if (n >= MAX_EMAILS_PER_DAY) throw new PermanentError(`Daily automation email limit (${MAX_EMAILS_PER_DAY}) reached`);
      await sendMail({ to, subject: renderTemplate(step.config.subject, scope).slice(0, 200), body: renderTemplate(step.config.body, scope) });
      return { output: { to } };
    }
    case "http_request": {
      const url = renderTemplate(step.config.url, scope);
      const headers = Object.fromEntries(Object.entries(step.config.headers).map(([k, v]) => [k, renderTemplate(v, scope)]));
      const isJson = /json/i.test(headers["Content-Type"] ?? headers["content-type"] ?? "") || /^\s*[[{]/.test(step.config.body);
      if (isJson && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
      const body = step.config.method === "GET" ? undefined : renderTemplate(step.config.body, scope, isJson ? "json" : "text");
      const r = await http(url, { method: step.config.method, headers, body });
      let json: unknown = undefined;
      try {
        json = JSON.parse(r.text);
      } catch {
        /* not JSON */
      }
      const output = { status: r.status, body: json ?? r.text.slice(0, 4000) };
      if (r.status >= 500 || r.status === 429) throw new Error(`The service answered ${r.status}`);
      if (r.status >= 400 && step.config.failOn4xx) throw new PermanentError(`The service answered ${r.status}: ${r.text.slice(0, 200)}`);
      return { output };
    }
    case "slack": {
      const url = String((scope.secrets as Record<string, string>).slackWebhookUrl ?? "");
      if (!/^https:\/\/hooks\.slack\.com\//.test(url)) throw new PermanentError("Add a Slack incoming-webhook URL as the secret slackWebhookUrl");
      const r = await http(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: renderTemplate(step.config.text, scope).slice(0, 3000) }) });
      if (r.status >= 500 || r.status === 429) throw new Error(`Slack answered ${r.status}`);
      if (r.status >= 400) throw new PermanentError(`Slack answered ${r.status}: ${r.text.slice(0, 200)}`);
      return { output: { status: r.status } };
    }
    case "delay":
      return { output: { waitedMs: delayMs(step.config) }, delay: delayMs(step.config) };
    case "condition": {
      const ok = evaluateCondition(step.config, scope);
      return { output: { passed: ok }, stop: !ok };
    }
  }
}

async function writeLog(runId: string, index: number, entry: StepLog, patch: Partial<typeof schema.workflowRuns.$inferInsert> = {}) {
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ log: schema.workflowRuns.log }).from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId)).for("update");
    const logArr = [...((r?.log as StepLog[]) ?? [])];
    logArr[index] = entry;
    await tx.update(schema.workflowRuns).set({ log: logArr, ...patch }).where(eq(schema.workflowRuns.id, runId));
  });
}

defineJob<{ runId: string; index: number }>(
  "workflow.step",
  async ({ runId, index }, { job }) => {
    const [run] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, runId));
    if (!run || !["running", "waiting"].includes(run.status)) return { skipped: true };
    const snap = run.snapshot as Snapshot;
    const step = snap.steps[index];
    if (!step) return { skipped: true };
    const done = (run.log as StepLog[])[index];
    const [w] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, run.workflowId));
    // A step that already succeeded (crash after finishing) is not repeated.
    if (done?.status !== "succeeded") {
      const scope = await loadScope(run, w);
      try {
        const r = await runStep(step, scope, run);
        const last = index === snap.steps.length - 1;
        if (r.stop) {
          await writeLog(runId, index, { id: step.id, type: step.type, status: "stopped", output: r.output, attempts: job.attempts, finishedAt: new Date().toISOString() }, { status: "stopped", finishedAt: new Date() });
          return { type: step.type, stopped: true };
        }
        await writeLog(runId, index, { id: step.id, type: step.type, status: "succeeded", output: r.output, attempts: job.attempts, finishedAt: new Date().toISOString() }, last ? { status: "succeeded", finishedAt: new Date() } : { status: r.delay ? "waiting" : "running" });
        if (!last) await enqueue("workflow.step", { runId, index: index + 1 }, { projectId: run.projectId, delayMs: r.delay ?? 0, maxAttempts: 5 });
        return { type: step.type };
      } catch (e) {
        const final = e instanceof PermanentError || job.attempts >= job.maxAttempts;
        await writeLog(runId, index, { id: step.id, type: step.type, status: "failed", error: (e as Error).message.slice(0, 500), attempts: job.attempts }, final ? { status: "failed", error: `${step.type}: ${(e as Error).message}`.slice(0, 500), finishedAt: new Date() } : {});
        throw e;
      }
    }
    if (index < snap.steps.length - 1) await enqueue("workflow.step", { runId, index: index + 1 }, { projectId: run.projectId, maxAttempts: 5 });
    return { type: step.type, resumed: true };
  },
  { timeoutMs: 30_000 },
);

// ─── Triggers ────────────────────────────────────────────────────────────────

/** Starts every enabled workflow listening for this event. Never throws into the caller. */
export async function emitWorkflowEvent(projectId: string, type: Exclude<TriggerType, "schedule" | "webhook" | "manual">, payload: Record<string, unknown>) {
  try {
    const rows = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.projectId, projectId), eq(schema.workflows.enabled, true), sql`${schema.workflows.trigger}->>'type' = ${type}`));
    for (const w of rows) {
      const t = w.trigger as Trigger;
      if (t.type === "form_submitted" && t.config.formId && t.config.formId !== payload.formId) continue;
      await startRun(w, type, payload);
    }
  } catch (e) {
    log.warn("workflow_emit_failed", { projectId, type, error: (e as Error).message });
  }
}

export async function triggerWebhook(token: string, input: { body: unknown; query: Record<string, string> }) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [w] = await db.select().from(schema.workflows).where(eq(schema.workflows.webhookTokenHash, sha256(token)));
  if (!w || !w.enabled || (w.trigger as Trigger).type !== "webhook") return null;
  return startRun(w, "webhook", input);
}

/** Called every minute: starts scheduled workflows whose cron matches this minute (once). */
export async function scheduleTick(now = new Date()) {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const rows = await db.select().from(schema.workflows).where(and(eq(schema.workflows.enabled, true), sql`${schema.workflows.trigger}->>'type' = 'schedule'`));
  let started = 0;
  for (const w of rows) {
    const t = w.trigger as Extract<Trigger, { type: "schedule" }>;
    try {
      if (!cronMatches(parseCron(t.config.cron), minute, t.config.timezone)) continue;
    } catch {
      continue;
    }
    // Claim this minute: concurrent ticks (other instances) can't both start it.
    const claimed = await db
      .update(schema.workflows)
      .set({ lastScheduledAt: minute })
      .where(and(eq(schema.workflows.id, w.id), sql`(${schema.workflows.lastScheduledAt} is null or ${schema.workflows.lastScheduledAt} < ${minute.toISOString()}::timestamptz)`))
      .returning({ id: schema.workflows.id });
    if (!claimed.length) continue;
    const z = zonedParts(minute, t.config.timezone);
    await startRun(w, "schedule", { scheduledFor: minute.toISOString(), local: `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")} ${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}` });
    started++;
  }
  return started;
}

export const workflowLimits = { MAX_WORKFLOWS, MAX_STEPS, MAX_RUNS_PER_DAY, MAX_EMAILS_PER_DAY };
