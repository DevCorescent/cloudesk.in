"use client";

// HR reports: headcount and its make-up, joiners and leavers, attrition,
// payroll cost and leave taken.
import { useState } from "react";
import { PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { Section, Stat, fmt, inr, lakh, todayIst } from "./shared";
import { useHrQuery } from "./shared";

type R = {
  year: number;
  headcount: number;
  attrition: number | null;
  avgTenureYears: number;
  flow: { month: string; joined: number; left: number; headcount: number | null }[];
  byDepartment: { name: string; count: number }[];
  byLocation: { name: string; count: number }[];
  byType: { name: string; count: number }[];
  payroll: { month: string; status: string; gross?: number; net?: number; cost?: number; employees?: number }[];
  leave: { type: string; color: string; days: number }[];
  exits: { id: string; name: string; exitDate: string; reason: string }[];
};

export function ReportsView() {
  const now = Number(todayIst().slice(0, 4));
  const [year, setYear] = useState(now);
  const q = useHrQuery<R>(`reports?year=${year}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="HR reports"
        description="People, movement, pay and time off."
        actions={
          <Select aria-label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="!w-auto">
            {[now, now - 1, now - 2].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        }
      />
      {!d ? (
        <Skeleton className="h-[70vh] rounded-[24px]" />
      ) : (
        <div className={cx("grid gap-5", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="People now" value={d.headcount} />
            <Stat label={`Joined in ${year}`} value={d.flow.reduce((a, f) => a + f.joined, 0)} tone="good" />
            <Stat label={`Left in ${year}`} value={d.flow.reduce((a, f) => a + f.left, 0)} sub={d.attrition === null ? "" : `${d.attrition}% attrition`} tone={d.attrition && d.attrition > 20 ? "warn" : undefined} />
            <Stat label="Average tenure" value={`${d.avgTenureYears} yrs`} />
          </div>
          <Section title={`Headcount through ${year}`}>
            <Bars rows={d.flow.map((f) => ({ label: new Date(`${f.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), value: f.headcount ?? 0, tip: `${f.month}: ${f.headcount ?? "—"} people · ${f.joined} joined · ${f.left} left`, faded: f.headcount === null }))} fmt={(n) => String(n)} />
          </Section>
          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="By department">
              <HBars rows={d.byDepartment} />
            </Section>
            <Section title="By location">
              <HBars rows={d.byLocation} />
            </Section>
            <Section title="By type">
              <HBars rows={d.byType} />
            </Section>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {d.payroll.length > 0 && (
              <Section title="Payroll cost by month">
                <Bars rows={d.payroll.map((p) => ({ label: new Date(`${p.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), value: p.cost ?? 0, tip: `${p.month}: ${inr(p.cost ?? 0)} cost · ${inr(p.net ?? 0)} net · ${p.employees ?? 0} people` }))} fmt={(n) => lakh(n)} />
              </Section>
            )}
            <Section title="Leave taken">
              {!d.leave.length ? (
                <p className="text-[13px] text-muted">No approved leave in {year}.</p>
              ) : (
                <ul className="grid gap-2">
                  {d.leave.map((l) => (
                    <li key={l.type} className="grid grid-cols-[140px_minmax(0,1fr)_60px] items-center gap-3 text-[12.5px]">
                      <span className="flex items-center gap-1.5 truncate text-muted">
                        <span className="size-2 rounded-full" style={{ background: l.color }} />
                        {l.type}
                      </span>
                      <span className="h-4 overflow-hidden rounded-[5px] bg-surface-2">
                        <span className="block h-full rounded-r-[4px] bg-[var(--chart)]" style={{ width: `${(l.days / Math.max(...d.leave.map((x) => x.days))) * 100}%` }} />
                      </span>
                      <b className="text-right tabular-nums">{l.days} d</b>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          {d.exits.length > 0 && (
            <Section title={`Who left in ${year}`}>
              <ul className="divide-y divide-border text-[13px]">
                {d.exits.map((x) => (
                  <li key={x.id} className="flex justify-between gap-3 py-2">
                    <b className="font-medium">{x.name}</b>
                    <span className="text-muted">
                      {fmt(x.exitDate)}
                      {x.reason ? ` · ${x.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function HBars({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-[13px] text-muted">No one yet.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${r.count}`} className="grid grid-cols-[110px_minmax(0,1fr)_36px] items-center gap-3 text-[12.5px]">
          <span className="truncate text-muted">{r.name}</span>
          <span className="h-4 overflow-hidden rounded-[5px] bg-surface-2">
            <span className="block h-full rounded-r-[4px] bg-[var(--chart)]" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <b className="text-right tabular-nums">{r.count}</b>
        </li>
      ))}
    </ul>
  );
}

function Bars({ rows, fmt: f }: { rows: { label: string; value: number; tip: string; faded?: boolean }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 border-b border-border">
        {rows.map((r) => (
          <div key={r.label} className="group relative flex h-full min-w-0 flex-1 items-end justify-center" title={r.tip}>
            <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-fg px-2 py-1 text-[11px] whitespace-nowrap text-bg opacity-0 transition-opacity group-hover:opacity-100">{r.tip}</span>
            <span className={cx("w-full max-w-[40px] rounded-t-[4px] bg-[var(--chart)]", r.faded && "opacity-20")} style={{ height: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
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
      <p className="mt-1 text-right text-[10.5px] text-subtle">Highest: {f(max)}</p>
    </div>
  );
}
