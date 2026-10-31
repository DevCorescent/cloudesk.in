// System health for operators: the database (latency, size, connections,
// largest tables, migrations), this server process, background jobs and
// schedulers, and what has been failing recently across every workspace —
// deployments, custom domains, publishing elsewhere, emails, webhooks and
// sign-ins. Measured live on each request.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;
const n = (v: unknown) => Number(v ?? 0);

/** Background schedulers and their switches (on unless set to "off" or APP_ROLE=web, as in instrumentation.ts). */
export const SCHEDULERS = ["JOBS_WORKER", "INVOICING_SCHEDULER", "HELPDESK_SCHEDULER", "GROWTH_SCHEDULER", "GRC_SCHEDULER", "BOOKING_SCHEDULER", "BI_SCHEDULER", "APPROVALS_SCHEDULER", "CART_RECOVERY", "ACCOUNTING_SYNC", "MAIL_SYNC", "CALENDAR_REMINDERS", "CHAT_SCHEDULER", "SUBSCRIPTION_SCHEDULER"] as const;
export const switchOn = (k: string) => process.env.APP_ROLE !== "web" && process.env[k] !== "off";

function migrationFiles(): number | null {
  try {
    const j = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
    return j.entries.length;
  } catch {
    return null;
  }
}

export async function health() {
  const t0 = performance.now();
  await db.execute(sql`select 1`);
  const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
  const [info] = await rows<{ version: string; size: number; connections: number; max_conn: number }>(sql`select version() as version, pg_database_size(current_database())::bigint as size, (select count(*)::int from pg_stat_activity where datname = current_database()) as connections, current_setting('max_connections')::int as max_conn`);
  const tables = await rows<{ name: string; bytes: number; rows: number }>(sql`select relname as name, pg_total_relation_size(relid)::bigint as bytes, n_live_tup::bigint as rows from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12`);
  const applied = await rows<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => [{ n: -1 }]);
  const files = migrationFiles();

  const jobs = await rows<{ status: string; n: number }>(sql`select status, count(*)::int as n from jobs group by status`);
  const [backlog] = await rows<{ overdue: number; oldest: string | null }>(sql`select count(*)::int as overdue, min(run_at)::text as oldest from jobs where status = 'queued' and run_at < now() - interval '5 minutes'`);
  // "failed" jobs will be retried; "dead" ones ran out of attempts and need a person.
  const failedJobs = await rows<{ kind: string; n: number; dead: number; last_error: string | null; last: string }>(sql`select kind, count(*)::int as n, count(*) filter (where status = 'dead')::int as dead, (array_agg(last_error order by coalesce(finished_at, created_at) desc))[1] as last_error, max(coalesce(finished_at, created_at))::text as last from jobs where status in ('failed', 'dead') and created_at > now() - interval '7 days' group by kind order by dead desc, n desc limit 10`);

  const problems = {
    deployments: await rows<{ project: string; org: string; at: string }>(sql`select p.name as project, o.name as org, d.created_at::text as at from deployments d join projects p on p.id = d.project_id join organizations o on o.id = p.org_id where d.status = 'failed' and d.created_at > now() - interval '24 hours' order by d.created_at desc limit 10`),
    domains: await rows<{ domain: string; org: string; status: string }>(sql`select sd.hostname as domain, o.name as org, sd.status from site_domains sd join projects p on p.id = sd.project_id join organizations o on o.id = p.org_id where sd.status = 'failed' order by sd.created_at desc limit 10`).catch(() => []),
    externalPublishing: await rows<{ name: string; provider: string; error: string; org: string }>(sql`select t.name, t.provider, t.last_error as error, o.name as org from site_targets t join projects p on p.id = t.project_id join organizations o on o.id = p.org_id where t.status = 'failed' order by t.last_run_at desc nulls last limit 10`),
    emails: await rows<{ status: string; n: number }>(sql`select status, count(*)::int as n from outbound_emails where created_at > now() - interval '24 hours' group by status`),
    webhooks: await rows<{ n: number }>(sql`select count(*)::int as n from webhook_deliveries where status = 'failed' and created_at > now() - interval '24 hours'`).catch(() => [{ n: 0 }]),
    loginFailures: await rows<{ ip: string | null; n: number }>(sql`select ip, count(*)::int as n from login_events where not ok and at > now() - interval '24 hours' group by ip order by n desc limit 8`),
  };

  const mem = process.memoryUsage();
  let version = "";
  try {
    version = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "";
  } catch {}

  return {
    database: { ok: true, latencyMs, version: String(info?.version ?? "").split(",")[0], sizeBytes: n(info?.size), connections: n(info?.connections), maxConnections: n(info?.max_conn), migrations: { applied: n(applied[0]?.n), files }, tables: tables.map((x) => ({ name: x.name, bytes: n(x.bytes), rows: n(x.rows) })) },
    server: { role: process.env.APP_ROLE === "web" ? "web" : "web + worker", node: process.version, env: process.env.NODE_ENV ?? "", version, region: process.env.DATA_REGION ?? "", uptimeSec: Math.round(process.uptime()), rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, heapTotalBytes: mem.heapTotal, pid: process.pid },
    jobs: { byStatus: Object.fromEntries(jobs.map((j) => [j.status, n(j.n)])), overdue: n(backlog?.overdue), oldestOverdue: backlog?.oldest ?? null, failing: failedJobs.map((j) => ({ ...j, n: n(j.n), dead: n(j.dead) })) },
    schedulers: SCHEDULERS.map((k) => ({ key: k, on: switchOn(k) })),
    problems: { ...problems, emails: Object.fromEntries(problems.emails.map((e) => [e.status, n(e.n)])), webhooks: n(problems.webhooks[0]?.n), loginFailures: problems.loginFailures.map((x) => ({ ip: x.ip ?? "unknown", n: n(x.n) })) },
  };
}

/** Puts every dead job of one kind back in the queue (after its cause is fixed). */
export async function retryDeadJobs(adminId: string, kind: string) {
  const { audit } = await import("../services/audit");
  const r = await db.execute(sql`update jobs set status = 'queued', run_at = now(), attempts = 0, last_error = null, finished_at = null where status = 'dead' and kind = ${kind}`);
  await audit({ actorId: adminId, action: "platform.jobs_retried", targetType: "job_kind", targetId: kind, metadata: { jobs: r.rowCount ?? 0 } });
  return { retried: r.rowCount ?? 0 };
}
