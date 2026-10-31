import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "../http/errors";
import { log } from "../log";

// Fixed-window rate limits. In production the counters live in Postgres (an
// unlogged table, one atomic upsert per check), so a limit holds across every
// server behind the load balancer. Development and tests count in memory.
// RATE_LIMIT_STORE=memory|postgres overrides the choice. If the database
// can't be reached, the check falls back to this server's memory rather than
// refusing everyone.
const buckets = new Map<string, { count: number; resetAt: number }>();
const shared = () => (process.env.RATE_LIMIT_STORE ?? (process.env.NODE_ENV === "production" ? "postgres" : "memory")) === "postgres";

function local(key: string, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  b.count += 1;
  return b;
}

async function remote(key: string, windowMs: number) {
  const r = await db.execute<{ count: number; reset_at: Date }>(sql`
    insert into rate_limits (key, count, reset_at) values (${key}, 1, now() + ${`${windowMs} milliseconds`}::interval)
    on conflict (key) do update set
      count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
    returning count, reset_at`);
  const row = r.rows[0]!;
  return { count: Number(row.count), resetAt: new Date(row.reset_at).getTime() };
}

export async function rateLimit(key: string, limit: number, windowMs: number) {
  let b: { count: number; resetAt: number };
  if (shared()) {
    try {
      b = await remote(key.slice(0, 300), windowMs);
    } catch (e) {
      log.warn("rate_limit_store_unavailable", { error: String(e) });
      b = local(key, windowMs);
    }
  } else b = local(key, windowMs);
  if (b.count > limit) {
    throw new ApiError("rate_limited", "Too many requests. Please wait a moment and try again.", {
      retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000)),
    });
  }
}

/** Removes expired shared counters (run hourly by the worker). */
export async function pruneRateLimits() {
  await db.execute(sql`delete from rate_limits where reset_at < now() - interval '1 minute'`);
}

export function resetRateLimits() {
  buckets.clear();
}
