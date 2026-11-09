export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // APP_ROLE=web: a web-only node behind a load balancer — no job worker and no
    // schedulers; a separate worker node (APP_ROLE unset or "worker") runs them.
    const webOnly = process.env.APP_ROLE === "web";
    // Production refuses to start without the settings everything else depends on.
    if (process.env.NODE_ENV === "production") {
      const { checkProductionEnv } = await import("./server/platform/boot");
      checkProductionEnv();
    }
    // Every server: integration settings saved in the admin console (refreshed
    // every 30 s so a change reaches all servers), and request metrics.
    {
      const { loadConfig } = await import("./server/platform/config");
      await loadConfig();
      const tc = setInterval(() => void loadConfig(), 30_000);
      tc.unref?.();
      const { startMetrics } = await import("./server/platform/metrics");
      startMetrics();
    }
    // Worker: sync every connected mailbox every few minutes, and send follow-up reminders.
    if (!webOnly && process.env.MAIL_SYNC !== "off") {
      const { mailTick } = await import("./server/mail/sync");
      const tm = setInterval(() => void mailTick().catch(() => {}), 2 * 60_000);
      tm.unref?.();
    }
    // Worker: documents past their delete time (Drive QR uploads and others) go completely, every minute.
    if (!webOnly) {
      const { expireTick } = await import("./server/documents/drop");
      const tdx = setInterval(() => void expireTick().catch(() => {}), 60_000);
      tdx.unref?.();
    }
    // Worker: meeting reminders and "add the minutes" nudges, every minute.
    if (!webOnly && process.env.CALENDAR_REMINDERS !== "off") {
      const { calendarTick } = await import("./server/calendar/tick");
      const tcal = setInterval(() => void calendarTick().catch(() => {}), 60_000);
      tcal.unref?.();
    }
    // Worker: recurring emails going out (and their meetings kept in the calendar), every minute.
    if (!webOnly && process.env.MAIL_SCHEDULES !== "off") {
      const { mailScheduleTick } = await import("./server/mail/schedules");
      const tms = setInterval(() => void mailScheduleTick().catch(() => {}), 60_000);
      tms.unref?.();
    }
    // Worker: chat — scheduled messages, "remind me", and urgent messages nudging until read. Every minute.
    if (!webOnly && process.env.CHAT_SCHEDULER !== "off") {
      const { chatTick } = await import("./server/chat/tick");
      const tch = setInterval(() => void chatTick().catch(() => {}), 60_000);
      tch.unref?.();
    }
    // Worker: hourly growth snapshot (database and table sizes, totals), metric
    // retention, and expired shared rate-limit counters.
    if (!webOnly) {
      const { snapshot } = await import("./server/platform/scalability");
      const { pruneRateLimits } = await import("./server/security/rate-limit");
      const hourly = () => void Promise.all([snapshot(), pruneRateLimits()]).catch(() => {});
      setTimeout(hourly, 60_000).unref?.();
      const ts = setInterval(hourly, 60 * 60_000);
      ts.unref?.();
    }
    // Worker: AI tasks run on the web server that started them, so a web server
    // restarting must not fail tasks other servers are still running. The worker
    // fails only tasks nobody has touched for AI_TASK_STALE_MIN minutes (default
    // 20), at start and every 5 minutes.
    if (!webOnly) {
      const { recoverInterruptedTasks } = await import("./server/ai/tasks");
      const staleMs = (Number(process.env.AI_TASK_STALE_MIN) || 20) * 60_000;
      await recoverInterruptedTasks(staleMs).catch(() => {});
      const tr = setInterval(() => void recoverInterruptedTasks(staleMs).catch(() => {}), 5 * 60_000);
      tr.unref?.();
    }
    // Graceful shutdown: on SIGTERM (a deploy, a scale-in) stop claiming jobs so a
    // job never dies half-way; `next start` finishes in-flight requests and exits.
    if (!webOnly && !process.listeners("SIGTERM").some((l) => (l as { __cc?: true }).__cc)) {
      const onTerm = Object.assign(async () => {
        const { stopWorker } = await import("./server/jobs/queue");
        stopWorker();
        const { log } = await import("./server/log");
        log.info("shutdown", { reason: "SIGTERM", worker: "stopped" });
      }, { __cc: true as const });
      process.once("SIGTERM", onTerm);
    }
    // Hourly: decide finished growth tests and, where the owner opted in, start the next one.
    // Single-instance scheduler; the Growth page also evaluates whenever it is opened.
    if (!webOnly && process.env.GROWTH_SCHEDULER !== "off") {
      const { growthTick } = await import("./server/growth/experiments");
      const timer = setInterval(() => void growthTick().catch(() => {}), 60 * 60_000);
      timer.unref?.();
    }
    // Durable jobs (automations, retries). Every instance can run a worker:
    // jobs are claimed with SKIP LOCKED, so nothing runs twice.
    if (!webOnly && process.env.JOBS_WORKER !== "off") {
      await import("./server/jobs/registry");
      const { startWorker } = await import("./server/jobs/queue");
      startWorker(Number(process.env.JOBS_POLL_MS) || 2000);
      const { scheduleTick } = await import("./server/automation/workflows");
      const t3 = setInterval(() => void scheduleTick().catch(() => {}), 60_000);
      t3.unref?.();
    }
    // Every 5 minutes: email scheduled reports that are due.
    if (!webOnly && process.env.BI_SCHEDULER !== "off") {
      const { sendDue } = await import("./server/bi/core");
      const t8 = setInterval(() => void sendDue().catch(() => {}), 5 * 60_000);
      t8.unref?.();
    }
    // Hourly: workspaces past their deletion date, expired exports, and logs past retention.
    if (!webOnly) {
      const { sweep } = await import("./server/platform/lifecycle");
      const t12 = setInterval(() => void sweep().catch(() => {}), 60 * 60_000);
      t12.unref?.();
    }
    // Hourly: fee reminders to guardians (each fee at most weekly).
    if (!webOnly) {
      const { remind: feeRemind } = await import("./server/education/core");
      const t13 = setInterval(() => void feeRemind().catch(() => {}), 60 * 60_000);
      t13.unref?.();
    }
    // Hourly: trim the integration hub's call and delivery logs, and old idempotent-write answers.
    if (!webOnly) {
      const { prune } = await import("./server/hub/core");
      const t11 = setInterval(() => void prune().catch(() => {}), 60 * 60_000);
      t11.unref?.();
    }
    // Hourly: compliance filings coming due or overdue.
    if (!webOnly && process.env.GRC_SCHEDULER !== "off") {
      const { remind } = await import("./server/grc/calendar");
      const t10 = setInterval(() => void remind().catch(() => {}), 60 * 60_000);
      t10.unref?.();
    }
    // Every 5 minutes: helpdesk tickets past their response targets, and resolved ones to auto-close.
    if (!webOnly && process.env.HELPDESK_SCHEDULER !== "off") {
      const { tick: helpdeskTick } = await import("./server/helpdesk/core");
      const t9 = setInterval(() => void helpdeskTick().catch(() => {}), 5 * 60_000);
      t9.unref?.();
    }
    // Every 5 minutes: requisition reminders that are due.
    if (!webOnly && process.env.REQUISITIONS_SCHEDULER !== "off") {
      const { requisitionsTick } = await import("./server/requisitions/core");
      const tr = setInterval(() => void requisitionsTick().catch(() => {}), 5 * 60_000);
      tr.unref?.();
    }
    // Hourly: firewall events older than 30 days and expired bans.
    if (!webOnly) {
      const { pruneFirewall } = await import("./server/security/firewall");
      const tfw = setInterval(() => void pruneFirewall().catch(() => {}), 60 * 60_000);
      tfw.unref?.();
    }
    // Every 10 minutes: subscription trials, renewals, grace periods; hourly: old email codes.
    if (!webOnly && process.env.SUBSCRIPTION_SCHEDULER !== "off") {
      const { subscriptionTick } = await import("./server/billing/subscriptions");
      const { pruneOtps } = await import("./server/auth/otp");
      const tsub = setInterval(() => void subscriptionTick().catch(() => {}), 10 * 60_000);
      tsub.unref?.();
      const totp = setInterval(() => void pruneOtps().catch(() => {}), 60 * 60_000);
      totp.unref?.();
    }
    // Every minute: note reminders (and notes in the trash for 30 days go for good).
    if (!webOnly && process.env.NOTES_SCHEDULER !== "off") {
      const { notesTick } = await import("./server/notes/core");
      const tn = setInterval(() => void notesTick().catch(() => {}), 60_000);
      tn.unref?.();
    }
    // Hourly: recurring invoices and payment reminders (once a day per invoice).
    if (!webOnly && process.env.INVOICING_SCHEDULER !== "off") {
      const { invoicingTick } = await import("./server/invoicing/service");
      const t4 = setInterval(() => void invoicingTick().catch(() => {}), 60 * 60_000);
      t4.unref?.();
    }
    // Every 15 minutes: keep the accounting ledger in step with invoices, sales, purchases and payroll.
    if (!webOnly && process.env.ACCOUNTING_SYNC !== "off") {
      const { syncAll } = await import("./server/accounting/sync");
      const t5 = setInterval(() => void syncAll().catch(() => {}), 15 * 60_000);
      t5.unref?.();
    }
    // Every minute: reminders people set; every 15 minutes: escalate overdue approvals.
    if (!webOnly && process.env.APPROVALS_SCHEDULER !== "off") {
      const { sendDueReminders } = await import("./server/notify/notify");
      const { escalate } = await import("./server/approvals/engine");
      const t6 = setInterval(() => void sendDueReminders().catch(() => {}), 60_000);
      const t7 = setInterval(() => void escalate().catch(() => {}), 15 * 60_000);
      t6.unref?.();
      t7.unref?.();
    }
    // Every 10 minutes: booking reminders and releasing unpaid booking holds.
    // Automatic abandoned-cart reminders (claims each cart atomically, so overlapping runs never double-send).
    if (!webOnly && process.env.CART_RECOVERY !== "off") {
      const { runCartRecovery } = await import("./server/commerce/recovery");
      const t3 = setInterval(() => void runCartRecovery().catch(() => {}), 15 * 60_000);
      t3.unref?.();
    }
    if (!webOnly && process.env.BOOKING_SCHEDULER !== "off") {
      const { releaseExpiredBookings, sendBookingReminders } = await import("./server/bookings/bookings");
      const t2 = setInterval(() => void Promise.all([releaseExpiredBookings(), sendBookingReminders()]).catch(() => {}), 10 * 60_000);
      t2.unref?.();
    }
  }
}
