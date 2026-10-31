"use client";

// Scalability insights: live traffic and latency across all servers, which
// areas are slow or failing, the servers serving right now, database headroom
// and growth with a projection, job throughput, and recommendations.
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { Result } from "@/components/bi/chart";
import { ChartView } from "@/components/bi/chart";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { bytes, duration, num, Section, Stat, useAdmin } from "./common";

type Scale = {
  thisNode: string;
  traffic: { last24h: number; errors24h: number; errorRate: number; p50: number | null; p95: number | null; p99: number | null; peakPerMinute24h: number; peakPerMinute7d: number; series: { t: string; requests: number; errors: number; avgMs: number }[]; histogram: { upTo: number | null; count: number }[] };
  areas: { area: string; requests: number; errorRate: number; clientErrorRate: number; avgMs: number; p50: number | null; p95: number | null; p99: number | null; maxMs: number }[];
  nodes: { node: string; requests15m: number; lastSeen: string }[];
  database: { bytes: number; connections: number; maxConnections: number; activeQueries: number; cacheHitPct: number | null; history: { day: string; value: number }[]; projection: { perDayBytes: number; in90Days: number; in365Days: number } | null; tables: { name: string; bytes: number; growth7d: number | null }[] };
  growth: Record<string, { day: string; value: number }[]>;
  jobs: { perHour: { hour: string; done: number; failed: number }[]; ready: number; oldestSec: number | null };
  recommendations: { level: "ok" | "info" | "warn" | "critical"; title: string; detail: string }[];
};

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 && x > 0 ? 2 : 1)}%`;
const ms = (x: number | null) => (x === null ? "—" : x >= 5000 ? ">5 s" : `≤${x} ms`);
const LEVEL = {
  critical: { icon: <OctagonAlert className="size-4 text-danger" />, tone: "danger" as const },
  warn: { icon: <AlertTriangle className="size-4 text-warning" />, tone: "warning" as const },
  info: { icon: <Info className="size-4 text-accent" />, tone: "accent" as const },
  ok: { icon: <CheckCircle2 className="size-4 text-success" />, tone: "success" as const },
};

function series(cols: { key: string; label: string }[], data: (string | number)[][], kind: "line" | "bar" | "area" = "line", bucket: "time" | "day" = "time") {
  // Times of day are labelled as HH:MM text; days use the report's date labels.
  const rows = bucket === "time" ? data.map(([t, ...rest]) => [String(t).slice(11, 16), ...rest]) : data;
  const r: Result = { dims: 1, columns: [bucket === "time" ? { key: "t", label: "Time", type: "text" } : { key: "t", label: "Day", type: "date", bucket: "day" }, ...cols.map((c) => ({ key: c.key, label: c.label, type: "count" as const }))], rows, totals: [null, ...cols.map((_, i) => rows.reduce((a, x) => a + Number(x[i + 1] ?? 0), 0))], range: { from: String(rows[0]?.[0] ?? ""), to: String(rows[rows.length - 1]?.[0] ?? "") }, truncated: false };
  return <ChartView r={r} kind={kind} compact />;
}

export function ScalabilityPanel() {
  const q = useAdmin<Scale>("scalability", { refetchInterval: 30_000 });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { traffic: t, database: d, jobs: j } = q.data;
  const connPct = d.maxConnections ? d.connections / d.maxConnections : 0;
  return (
    <div className="space-y-8">
      <Section title="Recommendations" sub="Worked out from the numbers below; re-checked every 30 seconds">
        <Card className="divide-y divide-border">
          {q.data.recommendations.map((r, i) => (
            <div key={i} className="flex gap-3 px-4 py-3 text-[13px]" data-testid={`rec-${r.level}`}>
              <span className="mt-0.5">{LEVEL[r.level].icon}</span>
              <div><p className="font-medium">{r.title}</p><p className="text-muted">{r.detail}</p></div>
            </div>
          ))}
        </Card>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requests (24 h)" value={num(t.last24h)} sub={`peak ${num(t.peakPerMinute24h)}/min · 7-day peak ${num(t.peakPerMinute7d)}/min`} />
        <Stat label="Server errors" value={pct(t.errorRate)} sub={`${num(t.errors24h)} in 24 h`} tone={t.errorRate > 0.01 ? "danger" : t.errorRate > 0.002 ? "warning" : "success"} />
        <Stat label="Response time (95%)" value={ms(t.p95)} sub={`half within ${ms(t.p50)} · 99% ${ms(t.p99)}`} tone={(t.p95 ?? 0) >= 1000 ? "warning" : undefined} />
        <Stat label="Servers serving" value={num(q.data.nodes.length)} sub="seen in the last 15 minutes" tone={q.data.nodes.length < 2 && t.last24h > 0 ? "warning" : undefined} />
        <Stat label="Database" value={bytes(d.bytes)} sub={d.projection ? `≈ ${bytes(d.projection.in365Days)} in a year` : "projection needs 3 days of history"} />
        <Stat label="Connections" value={`${d.connections} / ${d.maxConnections}`} sub={`${Math.round(connPct * 100)}% · ${d.activeQueries} running now`} tone={connPct > 0.8 ? "danger" : connPct > 0.6 ? "warning" : undefined} />
        <Stat label="Cache hit ratio" value={d.cacheHitPct === null ? "—" : `${d.cacheHitPct}%`} sub="reads served from memory" tone={d.cacheHitPct !== null && d.cacheHitPct < 95 ? "warning" : undefined} />
        <Stat label="Jobs ready to run" value={num(j.ready)} sub={j.oldestSec ? `oldest waiting ${duration(j.oldestSec)}` : "nothing waiting"} tone={j.ready > 50 ? "warning" : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">Traffic</h3>
          <p className="mb-2 text-[12px] text-muted">Requests and server errors per 5 minutes, all servers, last 24 hours</p>
          {t.series.length ? series([{ key: "r", label: "Requests" }, { key: "e", label: "Server errors" }], t.series.map((s) => [s.t, s.requests, s.errors]), "area") : <p className="py-10 text-center text-[13px] text-muted">No traffic recorded yet.</p>}
        </Card>
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">Response times</h3>
          <p className="mb-2 text-[12px] text-muted">How many requests finished within each time, last 24 hours</p>
          <ul className="grid gap-1.5 pt-1">
            {t.histogram.map((h, i) => {
              const max = Math.max(1, ...t.histogram.map((x) => x.count));
              return (
                <li key={i} className="grid grid-cols-[5rem_1fr_4rem] items-center gap-2 text-[12.5px]">
                  <span className="text-muted">{h.upTo === null ? "> 5 s" : `≤ ${h.upTo} ms`}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className={clsx("block h-full rounded-full", h.upTo === null || h.upTo > 1000 ? "bg-[var(--viz-2)]" : "bg-[var(--viz-1)]")} style={{ width: `${(h.count / max) * 100}%` }} /></span>
                  <span className="text-right tabular-nums">{num(h.count)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Section title="By area" sub="Last 24 hours. Slow or failing areas are where to look first.">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2 font-medium">Area</th><th className="px-4 py-2 text-right font-medium">Requests</th><th className="px-4 py-2 text-right font-medium">Server errors</th><th className="px-4 py-2 text-right font-medium">Refused (4xx)</th><th className="px-4 py-2 text-right font-medium">Average</th><th className="px-4 py-2 text-right font-medium">95%</th><th className="px-4 py-2 text-right font-medium">Slowest</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.areas.map((a) => (
                <tr key={a.area}>
                  <td className="px-4 py-2 font-medium">{a.area}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(a.requests)}</td>
                  <td className={clsx("px-4 py-2 text-right tabular-nums", a.errorRate > 0.01 && "text-danger")}>{pct(a.errorRate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{pct(a.clientErrorRate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{a.avgMs} ms</td>
                  <td className={clsx("px-4 py-2 text-right tabular-nums", (a.p95 ?? 0) >= 1000 && "text-warning")}>{ms(a.p95)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{a.maxMs} ms</td>
                </tr>
              ))}
              {!q.data.areas.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No requests recorded in the last 24 hours.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Servers" sub="Each server writes its counts once a minute">
          <Card className="divide-y divide-border text-[13px]">
            {q.data.nodes.map((n) => (
              <div key={n.node} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0 truncate font-mono text-[12px]">{n.node}{n.node === q.data!.thisNode && <Badge tone="accent" className="ml-1.5">this one</Badge>}</span>
                <span className="shrink-0 text-muted">{num(n.requests15m)} req · {dateTime(n.lastSeen)}</span>
              </div>
            ))}
            {!q.data.nodes.length && <p className="px-4 py-6 text-center text-muted">No server has reported in the last 15 minutes.</p>}
          </Card>
        </Section>
        <Section title="Background jobs" sub="Finished per hour, last 24 hours">
          <Card className="min-w-0 p-4">
            {j.perHour.length ? series([{ key: "d", label: "Done" }, { key: "f", label: "Failed" }], j.perHour.map((h) => [h.hour, h.done, h.failed]), "bar") : <p className="py-10 text-center text-[13px] text-muted">No jobs finished in the last 24 hours.</p>}
          </Card>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Database growth" sub="Daily size, last 90 days">
          <Card className="min-w-0 p-4">
            {d.history.length >= 2 ? series([{ key: "b", label: "Size (MB)" }], d.history.map((h) => [h.day, Math.round(h.value / 1e6)]), "line", "day") : <p className="py-10 text-center text-[13px] text-muted">History builds up from today ({d.history.length} day so far).</p>}
            {d.projection && <p className="mt-2 text-[12.5px] text-muted">Growing about {bytes(Math.max(0, d.projection.perDayBytes))} a day → about {bytes(d.projection.in90Days)} in 90 days and {bytes(d.projection.in365Days)} in a year, at this pace.</p>}
          </Card>
        </Section>
        <Section title="Largest tables" sub="With growth over the last 7 days">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-[13px]">
              <tbody className="divide-y divide-border">
                {d.tables.map((x) => <tr key={x.name}><td className="px-4 py-2 font-mono text-[12px]">{x.name}</td><td className="px-4 py-2 text-right tabular-nums">{bytes(x.bytes)}</td><td className="px-4 py-2 text-right tabular-nums text-muted">{x.growth7d === null ? "—" : `${x.growth7d >= 0 ? "+" : ""}${bytes(Math.abs(x.growth7d))}`}</td></tr>)}
                {!d.tables.length && <tr><td className="px-4 py-6 text-center text-muted">The first snapshot is taken a minute after a worker starts.</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>
      </div>
    </div>
  );
}
