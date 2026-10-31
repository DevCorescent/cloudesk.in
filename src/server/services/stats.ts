import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "@/db";
import { log } from "../log";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch/i;

export const isBot = (ua: string | null) => !ua || BOT.test(ua);

const today = () => new Date().toISOString().slice(0, 10);

/** Increments a daily counter. Failures never break page delivery. */
export type StatKind = "view" | "submit" | "cart_add" | "checkout" | "order";

export async function recordStat(projectId: string, path: string, kind: StatKind, experiment = "", variant = "") {
  try {
    await db
      .insert(schema.siteStats)
      .values({ projectId, day: today(), path, kind, experiment, variant, count: 1 })
      .onConflictDoUpdate({
        target: [schema.siteStats.projectId, schema.siteStats.day, schema.siteStats.path, schema.siteStats.kind, schema.siteStats.experiment, schema.siteStats.variant],
        set: { count: sql`${schema.siteStats.count} + 1` },
      });
  } catch (err) {
    log.warn("stat_failed", { error: (err as Error).message });
  }
}

/**
 * Assigns a visitor to A or B without cookies or storage: a hash of network
 * address, browser and the current day. Stable for a visitor within a day.
 */
export function abBucket(ip: string | null, ua: string | null, experiment: string): "A" | "B" {
  const h = createHash("sha256").update(`${ip ?? ""}|${ua ?? ""}|${today()}|${experiment}`).digest();
  return h[0] % 2 === 0 ? "A" : "B";
}

export async function projectStats(projectId: string, days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ day: schema.siteStats.day, path: schema.siteStats.path, kind: schema.siteStats.kind, experiment: schema.siteStats.experiment, variant: schema.siteStats.variant, count: schema.siteStats.count })
    .from(schema.siteStats)
    .where(and(eq(schema.siteStats.projectId, projectId), gte(schema.siteStats.day, since)));
  const byDay = new Map<string, { views: number; submits: number }>();
  for (let i = 0; i < days; i++) byDay.set(new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString().slice(0, 10), { views: 0, submits: 0 });
  const byPath = new Map<string, { views: number; submits: number }>();
  const experiments = new Map<string, Record<"A" | "B", { views: number; submits: number }>>();
  for (const r of rows) {
    const d = byDay.get(String(r.day));
    if (r.kind !== "view" && r.kind !== "submit") continue;
    const key = r.kind === "view" ? "views" : "submits";
    if (d) d[key] += r.count;
    const p = byPath.get(r.path) ?? { views: 0, submits: 0 };
    p[key] += r.count;
    byPath.set(r.path, p);
    // Autopilot experiments ("g:<id>") are reported on the Growth page.
    if (r.experiment && !r.experiment.startsWith("g:") && (r.variant === "A" || r.variant === "B")) {
      const e = experiments.get(r.experiment) ?? { A: { views: 0, submits: 0 }, B: { views: 0, submits: 0 } };
      e[r.variant][key] += r.count;
      experiments.set(r.experiment, e);
    }
  }
  return {
    days: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
    pages: [...byPath.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.views - a.views),
    experiments: [...experiments.entries()].map(([path, v]) => ({ path, ...v, ...significance(v.A, v.B) })),
  };
}

/**
 * Two-proportion z-test on conversion (submissions per view). Reported as a
 * confidence that B differs from A; small samples are labelled as such.
 */
export function significance(a: { views: number; submits: number }, b: { views: number; submits: number }) {
  const minSample = 100;
  const ra = a.views ? a.submits / a.views : 0;
  const rb = b.views ? b.submits / b.views : 0;
  if (a.views < minSample || b.views < minSample) return { rateA: ra, rateB: rb, confidence: null as number | null, verdict: "Not enough visitors yet (need 100+ per variant)" };
  const p = (a.submits + b.submits) / (a.views + b.views);
  const se = Math.sqrt(p * (1 - p) * (1 / a.views + 1 / b.views));
  if (se === 0) return { rateA: ra, rateB: rb, confidence: null, verdict: "No conversions recorded yet" };
  const z = Math.abs(rb - ra) / se;
  const confidence = erf(z / Math.SQRT2);
  const winner = rb > ra ? "B" : "A";
  return { rateA: ra, rateB: rb, confidence, verdict: confidence >= 0.95 ? `${winner} is performing better (≥95% confidence)` : "No clear winner yet" };
}

function erf(x: number) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ─── Experiment attribution for store events ─────────────────────────────────

// Running experiments per production deployment: [{ path, key }]. Small cache; deployments are immutable.
const expCache = new Map<string, { path: string; key: string }[]>();

async function liveExperiments(projectId: string) {
  const [p] = await db.select({ prod: schema.projects.productionDeploymentId }).from(schema.projects).where(and(eq(schema.projects.id, projectId), isNotNull(schema.projects.productionDeploymentId)));
  if (!p?.prod) return [];
  const hit = expCache.get(p.prod);
  if (hit) return hit;
  const [dep] = await db.select({ artifact: schema.deployments.artifact }).from(schema.deployments).where(eq(schema.deployments.id, p.prod));
  const artifact = (dep?.artifact ?? {}) as Record<string, string>;
  const list = Object.keys(artifact)
    .filter((k) => k.endsWith("#exp"))
    .map((k) => ({ path: k.slice(0, -4), key: artifact[k] }));
  if (expCache.size > 200) expCache.clear();
  expCache.set(p.prod, list);
  return list;
}

/**
 * Credits a store conversion (add to cart, checkout, order) to the visitor's
 * group in every running experiment. Buckets are recomputed from the same
 * cookie-free hash used when the page was served, so a visitor lands in the
 * same group. Visitors who never saw the tested page are spread evenly across
 * both groups, which dilutes but does not bias the comparison.
 */
export async function attributeConversion(projectId: string, kind: "cart_add" | "checkout" | "order", ip: string | null, ua: string | null) {
  if (isBot(ua)) return;
  try {
    for (const e of await liveExperiments(projectId)) await recordStat(projectId, e.path, kind, e.key, abBucket(ip, ua, e.key));
  } catch (err) {
    log.warn("attribution_failed", { error: (err as Error).message });
  }
}

/** Per-variant counts for one experiment key since a day (inclusive). */
export async function experimentCounts(projectId: string, key: string, sinceDay: string) {
  const rows = await db
    .select({ kind: schema.siteStats.kind, variant: schema.siteStats.variant, n: sql<number>`sum(${schema.siteStats.count})::int` })
    .from(schema.siteStats)
    .where(and(eq(schema.siteStats.projectId, projectId), eq(schema.siteStats.experiment, key), gte(schema.siteStats.day, sinceDay)))
    .groupBy(schema.siteStats.kind, schema.siteStats.variant);
  const zero = () => ({ view: 0, submit: 0, cart_add: 0, checkout: 0, order: 0 });
  const out = { A: zero(), B: zero() };
  for (const r of rows) if ((r.variant === "A" || r.variant === "B") && r.kind in out.A) out[r.variant][r.kind as keyof ReturnType<typeof zero>] += Number(r.n);
  return out;
}

/** Page views per path over the last N days (for prioritising pages). */
export async function pageViews(projectId: string, days: number) {
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ path: schema.siteStats.path, n: sql<number>`sum(${schema.siteStats.count})::int` })
    .from(schema.siteStats)
    .where(and(eq(schema.siteStats.projectId, projectId), eq(schema.siteStats.kind, "view"), gte(schema.siteStats.day, since)))
    .groupBy(schema.siteStats.path)
    .orderBy(desc(sql`2`));
  return new Map(rows.map((r) => [r.path, Number(r.n)]));
}
