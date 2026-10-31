// Scalability insights: traffic and latency from the per-minute request
// metrics, how many servers are serving, database size and growth (from daily
// snapshots) with a straight-line projection, job throughput, and plain
// recommendations derived from those numbers. Nothing here is estimated
// without data: missing history is reported as missing.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { LATENCY_BOUNDS, NODE_ID, percentile } from "./metrics";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;
const n = (v: unknown) => Number(v ?? 0);
const sumHist = (list: number[][]) => list.reduce((acc, h) => acc.map((x, i) => x + (h[i] ?? 0)), new Array(LATENCY_BOUNDS.length + 1).fill(0) as number[]);

/** Records today's figures (database and table sizes, totals). Idempotent per day; run hourly by the worker. */
export async function snapshot() {
  const day = new Date().toISOString().slice(0, 10);
  const [t] = await rows<Record<string, number>>(sql`select pg_database_size(current_database())::bigint as db_bytes,
    (select count(*) from users)::bigint as users, (select count(*) from organizations)::bigint as orgs,
    (select count(*) from projects)::bigint as projects, (select count(*) from store_orders)::bigint as store_orders,
    (select count(*) from audit_logs)::bigint as audit_logs, (select coalesce(sum(size),0) from assets)::bigint as asset_bytes,
    (select count(*) from jobs)::bigint as jobs`);
  const tables = await rows<{ name: string; bytes: number }>(sql`select relname as name, pg_total_relation_size(relid)::bigint as bytes from pg_stat_user_tables order by 2 desc limit 25`);
  const values: [string, number][] = [...Object.entries(t ?? {}).map(([k, v]) => [k, n(v)] as [string, number]), ...tables.map((x) => [`table:${x.name}`, n(x.bytes)] as [string, number])];
  for (const [key, value] of values) await db.execute(sql`insert into platform_snapshots (day, key, value) values (${day}, ${key}, ${value}) on conflict (day, key) do update set value = excluded.value`);
  // Keep request metrics for 14 days and snapshots for two years.
  await db.execute(sql`delete from request_stats where bucket < now() - interval '14 days'`);
  await db.execute(sql`delete from platform_snapshots where day < to_char(now() - interval '730 days', 'YYYY-MM-DD')`);
}

/** Least-squares slope (per day) of a daily series. */
function slope(points: { x: number; y: number }[]) {
  if (points.length < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den ? num / den : null;
}

export async function scalability() {
  // Traffic: per 5 minutes over the last 24 hours, all servers together.
  const series = await rows<{ t: string; count: number; errors: number; total_ms: number }>(sql`select to_char(date_bin('5 minutes', bucket, timestamp '2000-01-01'), 'YYYY-MM-DD"T"HH24:MI') as t, sum(count)::int as count, sum(errors)::int as errors, sum(total_ms)::bigint as total_ms from request_stats where bucket > now() - interval '24 hours' group by 1 order by 1`);
  const areas = await rows<{ area: string; count: number; errors: number; client_errors: number; total_ms: number; max_ms: number; hists: number[][] }>(sql`select area, sum(count)::int as count, sum(errors)::int as errors, sum(client_errors)::int as client_errors, sum(total_ms)::bigint as total_ms, max(max_ms)::int as max_ms, array_agg(hist) as hists from request_stats where bucket > now() - interval '24 hours' group by area order by 2 desc`);
  const nodes = await rows<{ node: string; count: number; last: string }>(sql`select node, sum(count)::int as count, max(bucket)::text as last from request_stats where bucket > now() - interval '15 minutes' group by node order by 2 desc`);
  const [peak] = await rows<{ day: number; week: number }>(sql`select
    coalesce((select max(c) from (select sum(count) c from request_stats where bucket > now() - interval '24 hours' group by bucket) x), 0)::int as day,
    coalesce((select max(c) from (select sum(count) c from request_stats where bucket > now() - interval '7 days' group by bucket) x), 0)::int as week`);
  const allHist = sumHist(areas.flatMap((a) => a.hists ?? []));
  const total = areas.reduce((a, x) => a + n(x.count), 0);
  const errors = areas.reduce((a, x) => a + n(x.errors), 0);

  // Database: now, and growth from daily snapshots.
  const [dbNow] = await rows<{ bytes: number; connections: number; max: number; active: number; cache_hit: number | null }>(sql`select pg_database_size(current_database())::bigint as bytes,
    (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
    current_setting('max_connections')::int as max,
    (select count(*)::int from pg_stat_activity where datname = current_database() and state = 'active') as active,
    (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database where datname = current_database()) as cache_hit`);
  const history = await rows<{ day: string; key: string; value: number }>(sql`select day, key, value from platform_snapshots where day >= to_char(now() - interval '90 days', 'YYYY-MM-DD') and key in ('db_bytes', 'users', 'orgs', 'store_orders', 'asset_bytes') order by day`);
  const by = (k: string) => history.filter((h) => h.key === k).map((h) => ({ day: h.day, value: n(h.value) }));
  const dbSeries = by("db_bytes");
  const t0 = dbSeries.length ? Date.parse(dbSeries[0]!.day) : 0;
  const perDay = slope(dbSeries.map((p) => ({ x: (Date.parse(p.day) - t0) / 86_400_000, y: p.value })));
  const bytes = n(dbNow?.bytes);
  const projection = perDay !== null && dbSeries.length >= 3 ? { perDayBytes: Math.round(perDay), in90Days: Math.round(bytes + perDay * 90), in365Days: Math.round(bytes + perDay * 365) } : null;
  const tableGrowth = await rows<{ name: string; now: number; before: number }>(sql`select substr(a.key, 7) as name, a.value as now, coalesce(b.value, 0) as before
    from platform_snapshots a left join platform_snapshots b on b.key = a.key and b.day = to_char(now() - interval '7 days', 'YYYY-MM-DD')
    where a.day = (select max(day) from platform_snapshots) and a.key like 'table:%' order by a.value desc limit 12`);

  // Jobs: what finished per hour, and what's waiting.
  const jobs = await rows<{ hour: string; done: number; failed: number }>(sql`select to_char(date_trunc('hour', finished_at), 'YYYY-MM-DD"T"HH24:00') as hour, count(*) filter (where status = 'succeeded')::int as done, count(*) filter (where status in ('failed','dead'))::int as failed from jobs where finished_at > now() - interval '24 hours' group by 1 order by 1`);
  const [backlog] = await rows<{ ready: number; oldest_sec: number | null }>(sql`select count(*)::int as ready, extract(epoch from now() - min(run_at))::int as oldest_sec from jobs where status in ('queued','failed') and run_at <= now()`);

  const area = areas.map((a) => {
    const h = sumHist(a.hists ?? []);
    return { area: a.area, requests: n(a.count), errorRate: n(a.count) ? n(a.errors) / n(a.count) : 0, clientErrorRate: n(a.count) ? n(a.client_errors) / n(a.count) : 0, avgMs: n(a.count) ? Math.round(n(a.total_ms) / n(a.count)) : 0, p50: percentile(h, 0.5), p95: percentile(h, 0.95), p99: percentile(h, 0.99), maxMs: n(a.max_ms) };
  });

  const connPct = n(dbNow?.max) ? n(dbNow?.connections) / n(dbNow?.max) : 0;
  const p95 = percentile(allHist, 0.95);
  const recs: { level: "ok" | "info" | "warn" | "critical"; title: string; detail: string }[] = [];
  if (!total) recs.push({ level: "info", title: "No traffic recorded yet", detail: "Request metrics are written by each server once a minute; insights fill in as the platform is used." });
  if (total && errors / total > 0.01) recs.push({ level: "critical", title: `${((errors / total) * 100).toFixed(1)}% of requests failed with a server error`, detail: "Check Health → failing, and server logs (search for level \"error\")." });
  for (const a of area.filter((x) => x.requests >= 50 && (x.p95 ?? 0) >= 1000)) recs.push({ level: "warn", title: `“${a.area}” is slow: 95% of requests within ${a.p95} ms`, detail: "Look for missing indexes or heavy queries in this area; add web servers if CPU is the limit." });
  if (connPct > 0.8) recs.push({ level: "critical", title: `Database connections at ${Math.round(connPct * 100)}% of the limit`, detail: "Put PgBouncer (transaction mode) in front of Postgres or raise max_connections; each server keeps its own pool." });
  else if (connPct > 0.6) recs.push({ level: "warn", title: `Database connections at ${Math.round(connPct * 100)}% of the limit`, detail: "Plan a connection pooler before adding more servers." });
  if (dbNow?.cache_hit !== null && dbNow?.cache_hit !== undefined && n(dbNow.cache_hit) < 95 && total > 1000) recs.push({ level: "warn", title: `Database cache hit ratio is ${dbNow.cache_hit}%`, detail: "Most reads should come from memory (99%+). Give the database more RAM or review large scans." });
  if (n(backlog?.ready) > 50 || n(backlog?.oldest_sec) > 600) recs.push({ level: "warn", title: `${n(backlog?.ready)} jobs waiting, oldest ${Math.round(n(backlog?.oldest_sec) / 60)} min`, detail: "Add a worker node (a server without APP_ROLE=web), or check Health for a failing job kind." });
  if (nodes.length <= 1 && n(peak?.week) > 600) recs.push({ level: "warn", title: `One server handled up to ${peak!.week} requests a minute`, detail: "Run at least two web servers behind the load balancer for headroom and zero-downtime releases." });
  if (projection && projection.in365Days > 50e9) recs.push({ level: "info", title: `Database on track for ${(projection.in365Days / 1e9).toFixed(0)} GB in a year`, detail: "Size storage and backups for it; consider retention for audit logs and AI task history." });
  if (dbSeries.length < 3) recs.push({ level: "info", title: "Growth history is still building", detail: `A snapshot is taken hourly by the worker; projections appear after three days of history (${dbSeries.length} so far).` });
  if (process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_STORE === "memory") recs.push({ level: "warn", title: "Rate limits are per server", detail: "RATE_LIMIT_STORE=memory is set; remove it so limits are shared through Postgres." });
  if (!recs.some((r) => r.level === "warn" || r.level === "critical") && total) recs.push({ level: "ok", title: "No capacity problems found", detail: "Error rate, latency, connections and job backlog are within healthy ranges." });

  return {
    thisNode: NODE_ID,
    traffic: { last24h: total, errors24h: errors, errorRate: total ? errors / total : 0, p50: percentile(allHist, 0.5), p95, p99: percentile(allHist, 0.99), peakPerMinute24h: n(peak?.day), peakPerMinute7d: n(peak?.week), series: series.map((s) => ({ t: s.t, requests: n(s.count), errors: n(s.errors), avgMs: n(s.count) ? Math.round(n(s.total_ms) / n(s.count)) : 0 })), histogram: allHist.map((c, i) => ({ upTo: LATENCY_BOUNDS[i] ?? null, count: c })) },
    areas: area,
    nodes: nodes.map((x) => ({ node: x.node, requests15m: n(x.count), lastSeen: x.last })),
    database: { bytes, connections: n(dbNow?.connections), maxConnections: n(dbNow?.max), activeQueries: n(dbNow?.active), cacheHitPct: dbNow?.cache_hit === null || dbNow?.cache_hit === undefined ? null : n(dbNow.cache_hit), history: dbSeries, projection, tables: tableGrowth.map((x) => ({ name: x.name, bytes: n(x.now), growth7d: n(x.before) ? n(x.now) - n(x.before) : null })) },
    growth: { users: by("users"), workspaces: by("orgs"), orders: by("store_orders"), assetBytes: by("asset_bytes") },
    jobs: { perHour: jobs.map((j) => ({ hour: j.hour, done: n(j.done), failed: n(j.failed) })), ready: n(backlog?.ready), oldestSec: backlog?.oldest_sec === null || backlog?.oldest_sec === undefined ? null : n(backlog.oldest_sec) },
    recommendations: recs,
  };
}
