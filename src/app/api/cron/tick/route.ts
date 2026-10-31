// The scheduler for serverless hosts (Vercel): no process stays up to run the
// timers in src/instrumentation.ts, so Vercel Cron calls this every minute
// (vercel.json) and each call does what those timers would have done by now.
// Vercel sends "Authorization: Bearer $CRON_SECRET"; without the secret set,
// the route refuses everyone.
import { timingSafeEqual } from "node:crypto";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How long to keep working through queued jobs, leaving room to answer. */
const JOB_BUDGET_MS = 45_000;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return want.length === got.length && timingSafeEqual(want, got);
}

type Task = [name: string, run: () => Promise<unknown>];

/** Every task due at this minute of the hour, mirroring the worker's intervals. */
async function due(minute: number): Promise<Task[]> {
  const every = (n: number) => minute % n === 0;
  const tasks: Task[] = [];
  const add = (name: string, run: () => Promise<unknown>) => tasks.push([name, run]);

  add("calendar", async () => (await import("@/server/calendar/tick")).calendarTick());
  add("mail-schedules", async () => (await import("@/server/mail/schedules")).mailScheduleTick());
  add("chat", async () => (await import("@/server/chat/tick")).chatTick());
  add("notes", async () => (await import("@/server/notes/core")).notesTick());
  add("reminders", async () => (await import("@/server/notify/notify")).sendDueReminders());
  add("workflows", async () => (await import("@/server/automation/workflows")).scheduleTick());
  if (every(2)) add("mail-sync", async () => (await import("@/server/mail/sync")).mailTick());
  if (every(5)) {
    add("helpdesk", async () => (await import("@/server/helpdesk/core")).tick());
    add("bi-reports", async () => (await import("@/server/bi/core")).sendDue());
    add("ai-tasks", async () => (await import("@/server/ai/tasks")).recoverInterruptedTasks((Number(process.env.AI_TASK_STALE_MIN) || 20) * 60_000));
    add("stale-jobs", async () => (await import("@/server/jobs/queue")).recoverStaleJobs());
  }
  if (every(10)) {
    add("subscriptions", async () => (await import("@/server/billing/subscriptions")).subscriptionTick());
    add("bookings", async () => {
      const b = await import("@/server/bookings/bookings");
      await Promise.all([b.releaseExpiredBookings(), b.sendBookingReminders()]);
    });
  }
  if (every(15)) {
    add("approvals", async () => (await import("@/server/approvals/engine")).escalate());
    add("accounting", async () => (await import("@/server/accounting/sync")).syncAll());
    add("cart-recovery", async () => (await import("@/server/commerce/recovery")).runCartRecovery());
  }
  if (minute === 0) {
    add("growth-snapshot", async () => {
      const [{ snapshot }, { pruneRateLimits }] = await Promise.all([import("@/server/platform/scalability"), import("@/server/security/rate-limit")]);
      await Promise.all([snapshot(), pruneRateLimits()]);
    });
    add("growth-tests", async () => (await import("@/server/growth/experiments")).growthTick());
    add("lifecycle", async () => (await import("@/server/platform/lifecycle")).sweep());
    add("fee-reminders", async () => (await import("@/server/education/core")).remind());
    add("hub-prune", async () => (await import("@/server/hub/core")).prune());
    add("grc", async () => (await import("@/server/grc/calendar")).remind());
    add("firewall-prune", async () => (await import("@/server/security/firewall")).pruneFirewall());
    add("otp-prune", async () => (await import("@/server/auth/otp")).pruneOtps());
    add("invoicing", async () => (await import("@/server/invoicing/service")).invoicingTick());
  }
  return tasks;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const minute = new Date().getUTCMinutes();
  const tasks = await due(minute);
  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [{ name: tasks[i]![0], error: String(r.reason) }] : []));
  for (const f of failed) log.warn("cron_task_failed", f);

  // Queued jobs (automations, retries): work through them until the budget runs out.
  await import("@/server/jobs/registry");
  const { workOnce } = await import("@/server/jobs/queue");
  let jobs = 0;
  while (Date.now() - started < JOB_BUDGET_MS) {
    const n = await workOnce(5).catch((e) => {
      log.warn("cron_jobs_failed", { error: (e as Error).message });
      return 0;
    });
    jobs += n;
    if (n === 0) break;
  }
  return Response.json({ ok: failed.length === 0, minute, ran: tasks.length, failed: failed.map((f) => f.name), jobs, ms: Date.now() - started });
}
