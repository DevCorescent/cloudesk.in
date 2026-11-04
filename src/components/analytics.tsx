"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, FlaskConical } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Card, EmptyState, ErrorState, Skeleton } from "./ui/primitives";

type Day = { day: string; views: number; submits: number };
type Experiment = { path: string; A: { views: number; submits: number }; B: { views: number; submits: number }; rateA: number; rateB: number; confidence: number | null; verdict: string };
type Stats = { days: Day[]; pages: { path: string; views: number; submits: number }[]; experiments: Experiment[] };

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Single-series daily bar chart with a per-bar hover tooltip. */
function DailyBars({ title, data, value }: { title: string; data: Day[]; value: (d: Day) => number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(value));
  const h = 140;
  const total = data.reduce((a, d) => a + value(d), 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="text-xs text-muted tabular-nums">{total.toLocaleString()} in {data.length} days</span>
      </div>
      <div className="relative mt-4" style={{ height: h + 22 }} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((t) => (
          <div key={t} className="absolute right-0 left-7 border-t border-border" style={{ top: h - h * t }}>
            <span className="absolute -top-2 -left-7 w-6 text-right text-[10px] text-subtle tabular-nums">{Math.round(max * t)}</span>
          </div>
        ))}
        <div className="absolute right-0 bottom-[22px] left-7 flex items-end gap-[2px]" style={{ height: h }} role="img" aria-label={`${title}: ${total} over ${data.length} days`}>
          {data.map((d, i) => {
            const v = value(d);
            return (
              <div key={d.day} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                <div className="w-full rounded-t-[4px] bg-accent transition-opacity" style={{ height: v ? Math.max(2, (v / max) * h) : 0, opacity: hover === null || hover === i ? 1 : 0.45 }} />
              </div>
            );
          })}
        </div>
        <div className="absolute right-0 bottom-0 left-7 flex justify-between text-[10px] text-subtle">
          <span>{fmtDay(data[0].day)}</span>
          <span>{fmtDay(data[data.length - 1].day)}</span>
        </div>
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md" style={{ left: `calc(28px + (100% - 28px) * ${(hover + 0.5) / data.length})` }}>
            <p className="text-muted">{fmtDay(data[hover].day)}</p>
            <p className="font-semibold tabular-nums">{value(data[hover]).toLocaleString()}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

export function AnalyticsView({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["analytics", projectId], queryFn: () => api<Stats>(`/api/v1/projects/${projectId}/analytics`) });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const views = q.data.days.reduce((a, d) => a + d.views, 0);
  const submits = q.data.days.reduce((a, d) => a + d.submits, 0);
  if (!views && !submits)
    return (
      <Card>
        <EmptyState icon={<BarChart3 className="size-4" />} title="No visits recorded yet" description="Analytics count visits to your live production site and form submissions. They are anonymous: no cookies, no IP addresses stored, bots excluded." />
      </Card>
    );
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Visits (30 days)" value={views.toLocaleString()} />
        <Tile label="Form submissions" value={submits.toLocaleString()} />
        <Tile label="Conversion rate" value={views ? `${((submits / views) * 100).toFixed(1)}%` : "—"} hint="Submissions per visit" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DailyBars title="Visits per day" data={q.data.days} value={(d) => d.views} />
        <DailyBars title="Form submissions per day" data={q.data.days} value={(d) => d.submits} />
      </div>
      {q.data.experiments.length > 0 && (
        <Card>
          <h3 className="flex items-center gap-1.5 border-b border-border px-4 py-3 text-[13px] font-semibold"><FlaskConical className="size-4 text-muted" /> A/B tests</h3>
          <ul className="divide-y divide-border">
            {q.data.experiments.map((e) => (
              <li key={e.path} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
                <span className="font-mono text-xs">{e.path}</span>
                <span className="tabular-nums">A {(e.rateA * 100).toFixed(1)}% <span className="text-subtle">({e.A.submits}/{e.A.views})</span> · B {(e.rateB * 100).toFixed(1)}% <span className="text-subtle">({e.B.submits}/{e.B.views})</span></span>
                <span className="text-xs text-muted">{e.verdict}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Visits and submissions by page</caption>
          <thead className="border-b border-border text-xs text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">Page</th>
              <th className="px-4 py-2.5 text-right font-medium">Visits</th>
              <th className="px-4 py-2.5 text-right font-medium">Submissions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.data.pages.map((p) => (
              <tr key={p.path}>
                <td className="px-4 py-2.5 font-mono text-xs">{p.path}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.views.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.submits.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-subtle">Counts only real visits to the live production site. Anonymous and cookie-free: no IP addresses or user agents are stored, and known bots are excluded.</p>
    </div>
  );
}
