// Durable job queue on Postgres.
//
// - enqueue() writes a row; nothing runs in the request that queued it.
// - Workers claim ready rows with FOR UPDATE SKIP LOCKED, so any number of
//   app instances can work the same queue without running a job twice.
// - Failures retry with exponential backoff and jitter, then go "dead".
// - A worker that dies mid-job leaves a stale lock; those jobs are re-queued.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { log } from "../log";

export type Job = typeof schema.jobs.$inferSelect;
export type JobContext = { job: Job; signal: AbortSignal };
type Handler = { run: (payload: never, ctx: JobContext) => Promise<unknown>; timeoutMs?: number };

const handlers = new Map<string, Handler>();
const WORKER_ID = `w-${process.pid}-${randomBytes(3).toString("hex")}`;
const STALE_MS = 10 * 60_000;

/** Registers what a job kind does. Handlers must be safe to run again after a crash. */
export function defineJob<P>(kind: string, run: (payload: P, ctx: JobContext) => Promise<unknown>, opts: { timeoutMs?: number } = {}) {
  handlers.set(kind, { run: run as Handler["run"], timeoutMs: opts.timeoutMs });
}

/** Thrown by a handler to fail without retrying (bad input, permanently refused). */
export class PermanentError extends Error {}

export async function enqueue(kind: string, payload: unknown, opts: { runAt?: Date; delayMs?: number; maxAttempts?: number; priority?: number; dedupeKey?: string; orgId?: string | null; projectId?: string | null } = {}) {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  const [j] = await db
    .insert(schema.jobs)
    .values({ kind, payload: payload as object, runAt, maxAttempts: opts.maxAttempts ?? 5, priority: opts.priority ?? 100, dedupeKey: opts.dedupeKey ?? null, orgId: opts.orgId ?? null, projectId: opts.projectId ?? null })
    .onConflictDoNothing()
    .returning();
  return j ?? null; // null: an identical job (same dedupe key) already exists
}

/** Delay before retry n (1-based): 10 s, 20 s, 40 s … capped at 1 h, ±20% jitter. */
export function backoffMs(attempt: number) {
  const base = Math.min(3600_000, 10_000 * 2 ** (attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function claim(limit: number) {
  const r = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${WORKER_ID}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status IN ('queued', 'failed') AND run_at <= now()
      ORDER BY priority, run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *`);
  return (r.rows as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    payload: row.payload,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
  }));
}

async function finish(id: string, ok: true, result: unknown): Promise<void>;
async function finish(id: string, ok: false, error: string, attempts: number, maxAttempts: number, permanent: boolean): Promise<void>;
async function finish(id: string, ok: boolean, resultOrError: unknown, attempts?: number, maxAttempts?: number, permanent?: boolean) {
  if (ok) {
    await db.update(schema.jobs).set({ status: "succeeded", result: (resultOrError ?? null) as object, lockedAt: null, lockedBy: null, finishedAt: new Date(), lastError: null }).where(eq(schema.jobs.id, id));
    return;
  }
  const dead = permanent || attempts! >= maxAttempts!;
  await db
    .update(schema.jobs)
    .set({ status: dead ? "dead" : "failed", lastError: String(resultOrError).slice(0, 2000), lockedAt: null, lockedBy: null, runAt: dead ? undefined : new Date(Date.now() + backoffMs(attempts!)), finishedAt: dead ? new Date() : null })
    .where(eq(schema.jobs.id, id));
}

/** Runs up to `limit` ready jobs. Returns how many ran. */
export async function workOnce(limit = 5): Promise<number> {
  const claimed = await claim(limit);
  await Promise.all(
    claimed.map(async (c) => {
      const h = handlers.get(c.kind);
      if (!h) {
        // An older worker (mid-deploy, or a dev server started before the handler existed) may
        // claim a job it doesn't know: retry with backoff so a current worker can pick it up.
        await finish(c.id, false, `No handler for job kind "${c.kind}"`, c.attempts, c.maxAttempts, false);
        return;
      }
      const ctl = new AbortController();
      const timeout = h.timeoutMs ?? 60_000;
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, c.id));
        const out = await Promise.race([
          h.run(c.payload as never, { job, signal: ctl.signal }),
          new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new Error(`Timed out after ${Math.round(timeout / 1000)} s`)))),
        ]);
        await finish(c.id, true, out);
      } catch (e) {
        await finish(c.id, false, (e as Error).message, c.attempts, c.maxAttempts, e instanceof PermanentError);
        log.warn("job_failed", { kind: c.kind, id: c.id, attempt: c.attempts, error: (e as Error).message });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return claimed.length;
}

/** Re-queues jobs whose worker vanished (crash, deploy) while running them. */
export async function recoverStaleJobs(staleMs = STALE_MS) {
  const r = await db
    .update(schema.jobs)
    .set({ status: "failed", lockedAt: null, lockedBy: null, lastError: "Worker stopped while running this job", runAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - staleMs))))
    .returning({ id: schema.jobs.id });
  return r.length;
}

/** Drains everything ready now (tests and the "run now" button). */
export async function drain(max = 200) {
  let total = 0;
  for (let i = 0; i < max; i++) {
    const n = await workOnce(10);
    total += n;
    if (!n) break;
  }
  return total;
}

export async function retryJob(id: string, projectId: string) {
  const r = await db
    .update(schema.jobs)
    .set({ status: "queued", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.projectId, projectId), inArray(schema.jobs.status, ["dead", "failed", "cancelled"])))
    .returning({ id: schema.jobs.id });
  return r.length > 0;
}

export async function cancelJob(id: string, projectId: string) {
  const r = await db
    .update(schema.jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.projectId, projectId), inArray(schema.jobs.status, ["queued", "failed"])))
    .returning({ id: schema.jobs.id });
  return r.length > 0;
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

/** Starts polling. Safe to run in every instance. */
export function startWorker(intervalMs = 2000) {
  if (timer) return;
  void recoverStaleJobs().catch(() => {});
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await workOnce(5);
    } catch (e) {
      log.warn("job_worker_error", { error: (e as Error).message });
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  const stale = setInterval(() => void recoverStaleJobs().catch(() => {}), 5 * 60_000);
  stale.unref?.();
}

/** Stops claiming jobs (SIGTERM). A job already running finishes. */
export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
