"use client";

// Reports: results (won, lost, win rate, deal size, cycle), the pipeline and
// its weighted forecast, where leads come from and how they convert, why deals
// are lost, and how each person on the team is doing.
import { useState } from "react";
import { PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { LIFECYCLE_LABEL, SOURCE_LABEL, type Lifecycle } from "@/lib/crm/model";
import { Avatar, Section, Stat, useCrm, useCrmParts, useCrmQuery, useShortMoney } from "./shared";

type Report = {
  pipelines: { id: string; name: string }[];
  totals: { won: number; wonValue: number; lost: number; lostValue: number; winRate: number | null; avgDeal: number; cycleDays: number; created: number; createdValue: number; open: number; pipeline: number; weighted: number };
  byStage: { stage: string; probability: number; count: number; total: number; weighted: number }[];
  forecast: { month: string; total: number; weighted: number; count: number }[];
  lostReasons: { reason: string; count: number }[];
  reps: { ownerId: string | null; name: string; won: number; wonValue: number; lost: number; winRate: number | null; open: number; pipeline: number; calls: number; emails: number; meetings: number; notes: number; tasks: number }[];
  sources: { source: string; leads: number; customers: number; rate: number }[];
  funnel: { lifecycle: string; count: number }[];
  weekly: { week: string; leads: number; won: number }[];
};

// Dates are worked out on the IST calendar, which is how the server reads them.
const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeFor(k: string) {
  const to = new Date(Date.now() + 5.5 * 3600_000);
  const from = new Date(to);
  if (k === "30") from.setUTCDate(from.getUTCDate() - 29);
  else if (k === "90") from.setUTCDate(from.getUTCDate() - 89);
  else if (k === "month") from.setUTCDate(1);
  else if (k === "quarter") from.setUTCMonth(Math.floor(from.getUTCMonth() / 3) * 3, 1);
  else if (k === "year") from.setUTCMonth(from.getUTCMonth() < 3 ? -9 : 3, 1); // Indian financial year from April
  return { from: iso(from), to: iso(to) };
}
const RANGES = [
  { k: "30", label: "Last 30 days" },
  { k: "90", label: "Last 90 days" },
  { k: "month", label: "This month" },
  { k: "quarter", label: "This quarter" },
  { k: "year", label: "This financial year" },
];

export function ReportsView() {
  const { meta } = useCrm();
  const short = useShortMoney();
  const deals = useCrmParts()("deals");
  const [range, setRange] = useState("90");
  const [pipelineId, setPipeline] = useState("");
  const r = rangeFor(range);
  const q = useCrmQuery<Report>(`reports?from=${r.from}&to=${r.to}${pipelineId ? `&pipelineId=${pipelineId}` : ""}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Results for deals closed in the range; the pipeline and forecast are as of now."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.pipelines.length > 1 && (
              <Select aria-label="Pipeline" value={pipelineId} onChange={(e) => setPipeline(e.target.value)} className="!w-auto">
                <option value="">All pipelines</option>
                {meta.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)} className="!w-auto">
              {RANGES.map((x) => (
                <option key={x.k} value={x.k}>
                  {x.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {!d ? (
        <Skeleton className="h-[70vh] rounded-[24px]" />
      ) : (
        <div className={cx("grid gap-5 transition-opacity", q.isFetching && "opacity-70")}>
          {deals && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Won" value={short(d.totals.wonValue)} sub={`${d.totals.won} deal${d.totals.won === 1 ? "" : "s"}`} tone={d.totals.wonValue ? "good" : undefined} />
            <Stat label="Win rate" value={d.totals.winRate === null ? "—" : `${d.totals.winRate}%`} sub={`${d.totals.won} won · ${d.totals.lost} lost`} />
            <Stat label="Average deal" value={d.totals.avgDeal ? short(d.totals.avgDeal) : "—"} sub="of deals won" />
            <Stat label="Sales cycle" value={!d.totals.won ? "—" : d.totals.cycleDays ? `${d.totals.cycleDays} days` : "Same day"} sub="created to won, on average" />
          </div>}
          {deals && <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Pipeline by stage" action={<Legend items={[["Total", "bg-[var(--chart-soft)]"], ["Weighted", "bg-[var(--chart)]"]]} />}>
              <p className="mb-3 text-[12.5px] text-muted">
                <b className="text-fg tabular-nums">{short(d.totals.pipeline)}</b> open across {d.totals.open} deals · <b className="text-fg tabular-nums">{short(d.totals.weighted)}</b> weighted by each stage&apos;s chance.
              </p>
              <HBars rows={d.byStage.map((s) => ({ label: s.stage, sub: `${s.probability}%`, a: s.total, b: s.weighted, right: `${short(s.total)} · ${s.count}`, tip: `${s.stage}: ${short(s.total)} in ${s.count} deals, ${short(s.weighted)} weighted at ${s.probability}%` }))} />
            </Section>
            <Section title="Forecast by expected close" action={<Legend items={[["Total", "bg-[var(--chart-soft)]"], ["Weighted", "bg-[var(--chart)]"]]} />}>
              {!d.forecast.length ? <p className="text-[13px] text-muted">No open deals.</p> : <Columns rows={d.forecast.map((f) => ({ label: f.month === "none" ? "No date" : new Date(`${f.month}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), a: f.total, b: f.weighted, tip: `${f.month === "none" ? "No close date" : f.month}: ${short(f.total)} in ${f.count} deals · ${short(f.weighted)} expected` }))} fmt={short} />}
            </Section>
          </div>}
          <div className="grid gap-5">
            <Section title="Team">
              {!d.reps.length ? (
                <p className="text-[13px] text-muted">No activity in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-[13px]">
                    <thead className="text-left text-[11.5px] text-muted">
                      <tr>
                        <th className="pb-2 font-medium">Person</th>
                        <th className="pb-2 text-right font-medium">Won</th>
                        <th className="pb-2 text-right font-medium">Win rate</th>
                        <th className="pb-2 text-right font-medium">Open</th>
                        <th className="pb-2 text-right font-medium">Calls</th>
                        <th className="pb-2 text-right font-medium">Emails</th>
                        <th className="pb-2 text-right font-medium">Meetings</th>
                        <th className="pb-2 text-right font-medium">Tasks done</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.reps.map((p) => (
                        <tr key={p.ownerId ?? "none"}>
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <Avatar name={p.name} size={24} />
                              {p.name}
                            </span>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            <b>{short(p.wonValue)}</b> <span className="text-subtle">· {p.won}</span>
                          </td>
                          <td className="py-2 text-right tabular-nums">{p.winRate === null ? "—" : `${p.winRate}%`}</td>
                          <td className="py-2 text-right tabular-nums">{p.open ? short(p.pipeline) : "—"}</td>
                          <td className="py-2 text-right tabular-nums">{p.calls}</td>
                          <td className="py-2 text-right tabular-nums">{p.emails}</td>
                          <td className="py-2 text-right tabular-nums">{p.meetings}</td>
                          <td className="py-2 text-right tabular-nums">{p.tasks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            {deals && <Section title="Why deals were lost">
              {!d.lostReasons.length ? <p className="text-[13px] text-muted">No lost deals in this range.</p> : <HBars rows={d.lostReasons.map((x) => ({ label: x.reason, a: x.count, right: String(x.count), tip: `${x.reason}: ${x.count}` }))} single />}
            </Section>}
            <Section title="New leads per week">
              {!d.weekly.length ? <p className="text-[13px] text-muted">No new contacts in this range.</p> : <Columns rows={d.weekly.map((w) => ({ label: new Date(w.week).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), a: w.leads, tip: `Week of ${w.week}: ${w.leads} new` }))} fmt={(n) => String(n)} single />}
            </Section>
            <Section title="Lifecycle">
              <HBars rows={d.funnel.filter((f) => f.count).map((f) => ({ label: LIFECYCLE_LABEL[f.lifecycle as Lifecycle] ?? f.lifecycle, a: f.count, right: f.count.toLocaleString("en-IN"), tip: `${f.count} at ${f.lifecycle}` }))} single />
            </Section>
          </div>
          <Section title="Where leads come from">
            {!d.sources.length ? (
              <p className="text-[13px] text-muted">No new contacts in this range.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11.5px] text-muted">
                  <tr>
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 text-right font-medium">New contacts</th>
                    <th className="pb-2 text-right font-medium">Now customers</th>
                    <th className="w-1/3 pb-2 pl-4 font-medium">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.sources.map((s) => (
                    <tr key={s.source}>
                      <td className="py-2">{SOURCE_LABEL[s.source] ?? s.source}</td>
                      <td className="py-2 text-right tabular-nums">{s.leads}</td>
                      <td className="py-2 text-right tabular-nums">{s.customers}</td>
                      <td className="py-2 pl-4">
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span className="block h-full rounded-full bg-[var(--chart)]" style={{ width: `${s.rate}%` }} />
                          </span>
                          <b className="w-10 text-right tabular-nums">{s.rate}%</b>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <span className="flex gap-3 text-[11.5px] text-muted">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cx("size-2.5 rounded-[3px]", c)} />
          {l}
        </span>
      ))}
    </span>
  );
}

/** Horizontal bars; `b` (when given) is drawn over `a` as the darker part. */
function HBars({ rows, single }: { rows: { label: string; sub?: string; a: number; b?: number; right: string; tip: string }[]; single?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.a));
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.label} title={r.tip} className="grid grid-cols-[minmax(80px,140px)_minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate text-muted">
            {r.label} {r.sub && <span className="text-subtle">· {r.sub}</span>}
          </span>
          <span className="relative h-5 overflow-hidden rounded-[6px] bg-surface-2">
            <span className={cx("absolute inset-y-0 left-0 rounded-r-[4px]", single ? "bg-[var(--chart)]" : "bg-[var(--chart-soft)]")} style={{ width: `${r.a ? Math.max(2, (r.a / max) * 100) : 0}%` }} />
            {r.b !== undefined && <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--chart)]" style={{ width: `${r.b ? Math.max(1, (r.b / max) * 100) : 0}%` }} />}
          </span>
          <span className="text-right font-medium tabular-nums">{r.right}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars with a hover label. */
function Columns({ rows, fmt, single }: { rows: { label: string; a: number; b?: number; tip: string }[]; fmt: (n: number) => string; single?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.a));
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5 border-b border-border">
        {rows.map((r) => (
          <div key={r.label} className="group relative flex h-full min-w-0 flex-1 items-end justify-center" title={r.tip}>
            <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-fg px-2 py-1 text-[11px] whitespace-nowrap text-bg opacity-0 transition-opacity group-hover:opacity-100">{r.tip}</span>
            <span className={cx("relative w-full max-w-[42px] rounded-t-[4px]", single ? "bg-[var(--chart)]" : "bg-[var(--chart-soft)]")} style={{ height: `${r.a ? Math.max(2, (r.a / max) * 100) : 0}%` }}>
              {r.b !== undefined && <span className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-[var(--chart)]" style={{ height: `${r.a ? (r.b / r.a) * 100 : 0}%` }} />}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {rows.map((r) => (
          <span key={r.label} className="min-w-0 flex-1 truncate text-center text-[10.5px] text-subtle">
            {r.label}
          </span>
        ))}
      </div>
      <p className="mt-1 text-right text-[10.5px] text-subtle">Highest: {fmt(max)}</p>
    </div>
  );
}
