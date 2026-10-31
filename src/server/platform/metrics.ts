// Request metrics for scalability insights. Every API request and every page
// of a published site is counted in this server's memory by area (auth, crm,
// store, sites…): volume, 4xx/5xx, total and max time, and a latency
// histogram. Once a minute each server adds its counts to `request_stats`
// (one row per minute, server and area), so the console can show throughput,
// error rates, p95 latency and how many servers are serving — across the fleet.
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "../log";

/** Upper bounds (ms) of the latency buckets; the last bucket is "slower". */
export const LATENCY_BOUNDS = [25, 50, 100, 250, 500, 1000, 2500, 5000];
export const NODE_ID = `${hostname().slice(0, 40)}:${process.pid}`;

type Agg = { count: number; errors: number; clientErrors: number; totalMs: number; maxMs: number; hist: number[] };
const g = globalThis as unknown as { __reqMetrics?: Map<string, Agg>; __reqMetricsTimer?: ReturnType<typeof setInterval> };
const buf = () => (g.__reqMetrics ??= new Map());

/** The area of a request path: /api/v1/orgs/:id/crm/… → "crm", /api/v1/auth/login → "auth", /sites/… → "sites". */
export function areaOf(path: string): string {
  const p = path.split("?")[0]!.split("/").filter(Boolean);
  if (p[0] !== "api") return ["sites", "s", "d"].includes(p[0] ?? "") ? "sites" : (p[0] ?? "root").slice(0, 30);
  const rest = p.slice(2);
  const scoped = ["orgs", "projects", "finance", "store", "erp"].includes(rest[0] ?? "") && rest[1] && /^[0-9a-f-]{36}$/i.test(rest[1]);
  const area = scoped ? (rest[2] ?? rest[0]) : rest[0];
  return (area ?? "api").replace(/[^a-z0-9-]/gi, "").slice(0, 30) || "api";
}

export function recordRequest(path: string, status: number, ms: number) {
  const area = areaOf(path);
  const m = buf();
  let a = m.get(area);
  if (!a) m.set(area, (a = { count: 0, errors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, hist: new Array(LATENCY_BOUNDS.length + 1).fill(0) }));
  a.count++;
  if (status >= 500) a.errors++;
  else if (status >= 400) a.clientErrors++;
  a.totalMs += ms;
  a.maxMs = Math.max(a.maxMs, Math.round(ms));
  const i = LATENCY_BOUNDS.findIndex((b) => ms <= b);
  a.hist[i === -1 ? LATENCY_BOUNDS.length : i]!++;
}

/** Writes this server's counts for the current minute and starts afresh. */
export async function flushMetrics() {
  const m = buf();
  if (!m.size) return;
  g.__reqMetrics = new Map();
  const bucket = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  try {
    for (const [area, a] of m) {
      await db.execute(sql`insert into request_stats (bucket, node, area, count, errors, client_errors, total_ms, max_ms, hist)
        values (${bucket}, ${NODE_ID}, ${area}, ${a.count}, ${a.errors}, ${a.clientErrors}, ${Math.round(a.totalMs)}, ${a.maxMs}, ${sql.raw(`ARRAY[${a.hist.join(",")}]::int[]`)})
        on conflict (bucket, node, area) do update set count = request_stats.count + excluded.count, errors = request_stats.errors + excluded.errors,
          client_errors = request_stats.client_errors + excluded.client_errors, total_ms = request_stats.total_ms + excluded.total_ms,
          max_ms = greatest(request_stats.max_ms, excluded.max_ms),
          hist = (select array_agg(x + y order by i) from unnest(request_stats.hist, excluded.hist) with ordinality as t(x, y, i))`);
    }
  } catch (e) {
    log.warn("metrics_flush_failed", { error: String(e) });
  }
}

export function startMetrics() {
  if (g.__reqMetricsTimer) return;
  g.__reqMetricsTimer = setInterval(() => void flushMetrics(), 60_000);
  g.__reqMetricsTimer.unref?.();
}

/** The latency (ms) under which the given share of requests finished, from a histogram. */
export function percentile(hist: number[], q: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]!;
    if (seen >= q * total) return LATENCY_BOUNDS[i] ?? LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1]! * 2;
  }
  return null;
}
