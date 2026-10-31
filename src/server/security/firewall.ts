// The firewall's runtime, called by src/proxy.ts before any page or API route
// runs. The policy (Admin → Security → Firewall) and the ban list are kept in
// memory and refreshed in the background, so no request waits on the database;
// refused requests are written to firewall_events in small batches. Requests per
// address are counted here per server (spread across servers, the limit applies
// to each). FIREWALL=off switches it off entirely (an emergency switch if an
// admin locks themselves out).
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientIpFrom, cleanIp, type TrustProxy } from "@/lib/security/ip";
import { inspect, type Policy, type Probe } from "@/lib/security/waf";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { cfg } from "../platform/config";
import { settings, type Settings } from "../platform/settings";
import { audit } from "../services/audit";
import { safeEqual } from "./tokens";

type FwSettings = Settings["firewall"];
type State = { at: number; fw: FwSettings; policy: Policy; bans: Map<string, number | null>; originSecret: string };
type Event = typeof schema.firewallEvents.$inferInsert;

type Runtime = { state: State | null; loading: Promise<State> | null; hits: Map<string, { n: number; at: number; noted: boolean }>; strikes: Map<string, number[]>; queue: Event[]; flushing: boolean; timer: ReturnType<typeof setTimeout> | null };
const G = globalThis as unknown as { __fw?: Runtime };
const fw = (): Runtime => (G.__fw ??= { state: null, loading: null, hits: new Map(), strikes: new Map(), queue: [], flushing: false, timer: null });

const REFRESH_MS = 10_000;
const ORIGIN_HEADER = "x-cloudesk-origin";

async function load(): Promise<State> {
  const s = (await settings()).firewall;
  const now = new Date();
  const bans = await db.select({ ip: schema.firewallBans.ip, until: schema.firewallBans.until }).from(schema.firewallBans).where(or(isNull(schema.firewallBans.until), gt(schema.firewallBans.until, now)));
  const policy: Policy = { mode: s.mode, rules: s.rules, allowIps: s.allowIps, blockIps: s.blockIps, blockCountries: s.blockCountries, custom: s.custom };
  return { at: Date.now(), fw: s, policy, bans: new Map(bans.map((b) => [b.ip, b.until ? b.until.getTime() : null])), originSecret: cfg("CLOUDFLARE_ORIGIN_SECRET") ?? "" };
}

async function state(): Promise<State> {
  const f = fw();
  if (f.state && Date.now() - f.state.at < REFRESH_MS) return f.state;
  f.loading ??= load()
    .then((s) => (f.state = s))
    .finally(() => (f.loading = null));
  // A stale policy keeps serving while the fresh one loads; only the very first request waits.
  if (f.state) {
    f.loading.catch((e) => log.warn("firewall.load_failed", { error: String(e) }));
    return f.state;
  }
  return f.loading;
}

/** After an admin change: the next request reloads the policy. */
export const clearFirewallCache = () => void (fw().state = null);

function enqueue(e: Event) {
  const f = fw();
  if (f.queue.length >= 2000) return; // under a flood, keep the newest picture rather than all of it
  f.queue.push(e);
  f.timer ??= setTimeout(() => void flush(), 1500);
}

export async function flush() {
  const f = fw();
  f.timer = null;
  if (f.flushing || !f.queue.length) return;
  f.flushing = true;
  const batch = f.queue.splice(0, 500);
  try {
    await db.insert(schema.firewallEvents).values(batch);
  } catch (e) {
    log.warn("firewall.events_failed", { error: String(e), dropped: batch.length });
  } finally {
    f.flushing = false;
    if (f.queue.length) f.timer ??= setTimeout(() => void flush(), 1500);
  }
}

/**
 * The server's own address (a proxy on the same machine, health checks, or a
 * misconfigured address source that makes every visitor look local): never
 * banned or rate-limited — banning it would lock everyone out at once.
 */
const isLoopback = (ip: string | null) => !!ip && (ip === "::1" || ip.startsWith("127."));
const localSeen = ((globalThis as unknown as { __fwLocal?: { n: number; total: number } }).__fwLocal ??= { n: 0, total: 0 });
/** Share of recent requests that looked like they came from this machine (Posture warns if it's all of them). */
export const localShare = () => (localSeen.total ? localSeen.n / localSeen.total : 0);

/** Files served as they are (images, fonts, scripts): checked by the rules but not counted toward the rate limit. */
const STATIC = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|css|js|map|mp4|webm|txt|xml|json)$/i;

/** Repeat offenders are banned for a while. Returns true if this strike banned the address. */
function strike(ip: string | null, st: State, reason: string): boolean {
  if (!ip || isLoopback(ip) || st.fw.autoBanAfter <= 0 || st.policy.mode !== "block") return false;
  const f = fw();
  const now = Date.now();
  const list = (f.strikes.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  f.strikes.set(ip, list);
  if (f.strikes.size > 50_000) f.strikes.clear();
  if (list.length < st.fw.autoBanAfter) return false;
  f.strikes.delete(ip);
  const until = new Date(now + st.fw.autoBanMinutes * 60_000);
  st.bans.set(ip, until.getTime());
  void db
    .insert(schema.firewallBans)
    .values({ ip, reason: `Automatic: ${list.length} refused requests in 10 minutes (last: ${reason})`.slice(0, 300), source: "auto", until })
    .onConflictDoUpdate({ target: schema.firewallBans.ip, set: { until, reason: `Automatic: repeated attacks (last: ${reason})`.slice(0, 300), source: "auto" } })
    .then(() => pushBanToCloudflare(ip, `Cloudesk auto-ban: ${reason}`))
    .catch((e) => log.warn("firewall.ban_failed", { error: String(e) }));
  return true;
}

async function pushBanToCloudflare(ip: string, note: string) {
  const { cloudflareSyncOn, cloudflareBlockIp } = await import("./cloudflare");
  if (!(await cloudflareSyncOn())) return;
  const id = await cloudflareBlockIp(ip, note).catch(() => null);
  if (id) await db.update(schema.firewallBans).set({ cloudflareRuleId: id }).where(eq(schema.firewallBans.ip, ip));
}

const isApi = (path: string) => path.startsWith("/api/");

function refuse(status: 403 | 429, path: string, ref: string, retryAfter?: number) {
  const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  const message = status === 429 ? "Too many requests from your address. Please slow down and try again shortly." : "This request was blocked by the Cloudesk firewall.";
  if (isApi(path)) return Response.json({ error: { code: status === 429 ? "rate_limited" : "forbidden", message, details: { reference: [ref] } } }, { status, headers });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status === 429 ? "Slow down" : "Request blocked"}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#fbfaf8;color:#1d1d24}main{max-width:440px;padding:32px;text-align:center}h1{font-weight:500;font-size:22px;margin:0 0 8px}p{color:#6b6b76;margin:0 0 6px}code{font-size:12px;color:#8a8a94}</style></head><body><main><h1>${status === 429 ? "Too many requests" : "Request blocked"}</h1><p>${message}</p><p>If you think this is a mistake, contact support with this reference.</p><code>Ref ${ref}</code></main></body></html>`;
  return new Response(html, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

type Req = { method: string; headers: Headers; nextUrl: { pathname: string; search: string } };

/**
 * Checks one request. Returns a response to send instead (403 or 429), or null
 * to let it through.
 */
export async function checkRequest(req: Req): Promise<Response | null> {
  if (process.env.FIREWALL === "off") return null;
  let st: State;
  try {
    st = await state();
  } catch (e) {
    // The database being unreachable mustn't take the whole site down with it.
    log.warn("firewall.unavailable", { error: String(e) });
    return null;
  }
  if (st.policy.mode === "off") return null;
  const h = req.headers;
  const ip = clientIpFrom(h, st.fw.trustProxy as TrustProxy);
  const country = st.fw.trustProxy === "cloudflare" ? (h.get("cf-ipcountry") ?? "").toUpperCase().slice(0, 2) || null : null;
  const path = req.nextUrl.pathname;
  const probe: Probe = {
    ip,
    country,
    method: req.method.toUpperCase(),
    host: h.get("host") ?? "",
    path,
    query: req.nextUrl.search.replace(/^\?/, ""),
    ua: h.get("user-agent") ?? "",
    referer: h.get("referer") ?? "",
    headers: [h.get("x-forwarded-host") ?? "", h.get("x-original-url") ?? "", h.get("x-rewrite-url") ?? ""].filter(Boolean),
  };
  const ref = randomBytes(5).toString("hex");
  const record = (rule: string, grp: string, action: "block" | "log", detail: string) =>
    enqueue({ ip, country, method: probe.method.slice(0, 12), host: probe.host.slice(0, 200), path: (path + (probe.query ? `?${probe.query}` : "")).slice(0, 500), rule, grp, action, detail: `[${ref}] ${detail}`.slice(0, 300), ua: probe.ua.slice(0, 300) });

  const verdict = inspect(probe, st.policy);
  if (verdict.action === "allow") return null;

  // Only requests through Cloudflare (it adds a secret header — Admin → Security → Cloudflare → Lock origin).
  const viaCloudflare = !!st.originSecret && safeEqual(h.get(ORIGIN_HEADER) ?? "", st.originSecret);
  if (viaCloudflare) originSeen.at = Date.now();
  if (st.fw.requireCloudflare && st.originSecret && !viaCloudflare) {
    record("origin-lock", "origin", st.policy.mode === "block" ? "block" : "log", "didn't come through Cloudflare");
    if (st.policy.mode === "block") return refuse(403, path, ref);
  }

  if (ip) {
    const until = st.bans.get(ip);
    if (until !== undefined && (until === null || until > Date.now())) {
      if (st.policy.mode === "block") {
        // Not logged every time: a banned scanner would fill the log.
        if (Math.random() < 0.05) record("ban", "ban", "block", "banned address");
        return refuse(403, path, ref);
      }
    }
  }

  if (verdict.action === "block" || verdict.action === "log") {
    record(verdict.rule, verdict.group, verdict.action, verdict.detail);
    if (verdict.action === "block") {
      strike(ip, st, verdict.rule);
      return refuse(403, path, ref);
    }
  }

  // Requests per minute from one address.
  if (localSeen.total > 10_000) [localSeen.n, localSeen.total] = [localSeen.n / 2, localSeen.total / 2];
  localSeen.total++;
  if (isLoopback(ip)) localSeen.n++;
  if (ip && !isLoopback(ip) && st.fw.ratePerMinute > 0 && !STATIC.test(path) && h.get("next-router-prefetch") === null) {
    const f = fw();
    const now = Date.now();
    let b = f.hits.get(ip);
    if (!b || now - b.at >= 60_000) {
      b = { n: 0, at: now, noted: false };
      f.hits.set(ip, b);
      if (f.hits.size > 100_000) {
        for (const [k, v] of f.hits) if (now - v.at >= 60_000) f.hits.delete(k);
      }
    }
    b.n++;
    if (b.n > st.fw.ratePerMinute) {
      if (!b.noted) {
        b.noted = true;
        record("rate-limit", "rate", st.policy.mode === "block" ? "block" : "log", `${b.n} requests in a minute`);
        strike(ip, st, "rate limit");
      }
      if (st.policy.mode === "block") return refuse(429, path, ref, Math.max(1, Math.ceil((b.at + 60_000 - now) / 1000)));
    }
  }
  return null;
}

const originSeen = ((globalThis as unknown as { __fwOrigin?: { at: number } }).__fwOrigin ??= { at: 0 });
/** When this server last saw a request carrying Cloudflare's origin header (0 = not yet). */
export const originLastSeen = () => originSeen.at;

// ── The console ─────────────────────────────────────────────────────────────

export async function firewallOverview() {
  const day = new Date(Date.now() - 86_400_000);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const ev = schema.firewallEvents;
  const [byGroup, byRule, topIps, topPaths, timeline, [totals], [weekTotal], bans] = await Promise.all([
    db.select({ grp: ev.grp, action: ev.action, n: count() }).from(ev).where(gte(ev.at, day)).groupBy(ev.grp, ev.action),
    db.select({ rule: ev.rule, n: count() }).from(ev).where(gte(ev.at, day)).groupBy(ev.rule).orderBy(desc(count())).limit(10),
    db.select({ ip: ev.ip, country: sql<string | null>`max(${ev.country})`, n: count() }).from(ev).where(gte(ev.at, day)).groupBy(ev.ip).orderBy(desc(count())).limit(10),
    db.select({ path: sql<string>`split_part(${ev.path}, '?', 1)`, n: count() }).from(ev).where(gte(ev.at, day)).groupBy(sql`split_part(${ev.path}, '?', 1)`).orderBy(desc(count())).limit(10),
    db.select({ hour: sql<string>`date_trunc('hour', ${ev.at})`, action: ev.action, n: count() }).from(ev).where(gte(ev.at, day)).groupBy(sql`date_trunc('hour', ${ev.at})`, ev.action).orderBy(sql`date_trunc('hour', ${ev.at})`),
    db.select({ blocked: sql<number>`count(*) filter (where ${ev.action} = 'block')::int`, logged: sql<number>`count(*) filter (where ${ev.action} = 'log')::int` }).from(ev).where(gte(ev.at, day)),
    db.select({ n: count() }).from(ev).where(gte(ev.at, week)),
    db.select().from(schema.firewallBans).where(or(isNull(schema.firewallBans.until), gt(schema.firewallBans.until, new Date()))).orderBy(desc(schema.firewallBans.createdAt)).limit(200),
  ]);
  return {
    policy: (await settings()).firewall,
    disabledByEnv: process.env.FIREWALL === "off",
    originSecretSet: !!cfg("CLOUDFLARE_ORIGIN_SECRET"),
    originLastSeen: originSeen.at ? new Date(originSeen.at).toISOString() : null,
    day: { blocked: totals?.blocked ?? 0, logged: totals?.logged ?? 0 },
    week: weekTotal?.n ?? 0,
    byGroup,
    byRule,
    topIps,
    topPaths,
    timeline,
    bans,
  };
}

export async function firewallEvents(q: { ip?: string; grp?: string; action?: string; before?: number; limit?: number }) {
  const ev = schema.firewallEvents;
  const where = [
    q.ip ? eq(ev.ip, q.ip) : undefined,
    q.grp ? eq(ev.grp, q.grp) : undefined,
    q.action === "block" || q.action === "log" ? eq(ev.action, q.action) : undefined,
    q.before ? lt(ev.id, q.before) : undefined,
  ].filter(Boolean);
  return db.select().from(ev).where(where.length ? and(...where) : undefined).orderBy(desc(ev.id)).limit(Math.min(500, q.limit ?? 100));
}

export async function banIp(adminId: string, input: { ip: string; minutes: number | null; reason: string }) {
  const ip = cleanIp(input.ip);
  if (!ip) throw new ApiError("validation_failed", "Enter a valid IP address");
  if (input.minutes !== null && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 525_600)) throw new ApiError("validation_failed", "Ban for 1 minute to a year, or until removed");
  const until = input.minutes === null ? null : new Date(Date.now() + input.minutes * 60_000);
  await db.insert(schema.firewallBans).values({ ip, reason: input.reason.slice(0, 300), source: "manual", until, createdBy: adminId }).onConflictDoUpdate({ target: schema.firewallBans.ip, set: { reason: input.reason.slice(0, 300), source: "manual", until, createdBy: adminId } });
  clearFirewallCache();
  await audit({ actorId: adminId, action: "platform.firewall_ban", targetType: "ip", targetId: ip, metadata: { minutes: input.minutes, reason: input.reason } });
  await pushBanToCloudflare(ip, `Cloudesk ban: ${input.reason}`.slice(0, 100)).catch(() => {});
  return { ip, until };
}

export async function unbanIp(adminId: string, raw: string) {
  const ip = cleanIp(raw);
  if (!ip) throw new ApiError("validation_failed", "Enter a valid IP address");
  const [gone] = await db.delete(schema.firewallBans).where(eq(schema.firewallBans.ip, ip)).returning();
  if (!gone) throw new ApiError("not_found", "That address isn't banned");
  fw().strikes.delete(ip);
  clearFirewallCache();
  if (gone.cloudflareRuleId) {
    const { cloudflareUnblock } = await import("./cloudflare");
    await cloudflareUnblock(gone.cloudflareRuleId).catch(() => {});
  }
  await audit({ actorId: adminId, action: "platform.firewall_unban", targetType: "ip", targetId: ip });
}

/** Events older than 30 days and expired bans go. */
export async function pruneFirewall() {
  await db.delete(schema.firewallEvents).where(lt(schema.firewallEvents.at, new Date(Date.now() - 30 * 86_400_000)));
  await db.delete(schema.firewallBans).where(and(sql`${schema.firewallBans.until} is not null`, lt(schema.firewallBans.until, new Date())));
}

/** Test hook: forget counters and cached policy. */
export function resetFirewall() {
  const f = fw();
  f.state = null;
  f.hits.clear();
  f.strikes.clear();
  f.queue.length = 0;
}
