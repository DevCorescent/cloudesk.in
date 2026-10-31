"use client";

// Billing (what's ready to invoice on every project), cost & profit, reports
// (hours, utilisation, budgets) and settings.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu } from "@/components/import/buttons";
import { LabeledSwitch } from "@/components/crm/shared";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { BILLING_LABEL, TASK_STATUSES, type WorkSettings } from "@/lib/work/model";
import { Bar, Empty, Section, Stat, StatusPill, addDays, fmt, fromPaise, hm, hrs, inr, pct, short, toPaise, todayIst, useWork, useWorkAction, useWorkQuery } from "./shared";

type BillRow = { id: string; code: string; name: string; client: string; billing: string; hasClient: boolean; readyMinutes: number; readyAmount: number; waitingMinutes: number; milestones: number; expenses: number };
export function BillingView() {
  const q = useWorkQuery<{ projects: BillRow[] }>("billing");
  const rows = q.data?.projects ?? [];
  const ready = rows.reduce((n, r) => n + r.readyAmount + r.milestones + r.expenses, 0);
  return (
    <div>
      <PageHeader title="Billing" description="Approved, billable time, reached milestones and billable expenses that haven't been invoiced yet." />
      {!q.data ? (
        <Skeleton className="h-[40vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Ready to bill" value={short(ready)} sub="before tax" />
            <Stat label="Hours ready" value={hrs(rows.reduce((n, r) => n + r.readyMinutes, 0))} sub="approved" />
            <Stat label="Waiting for approval" value={hrs(rows.reduce((n, r) => n + r.waitingMinutes, 0))} tone={rows.some((r) => r.waitingMinutes) ? "warn" : undefined} />
          </div>
          <Section title="By project">
            {!rows.length ? (
              <Empty>Nothing to bill. When approved time or reached milestones are waiting, they show up here.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`/work/projects/${r.id}/billing`} className="flex flex-wrap items-center gap-3 py-3 text-[13px] hover:opacity-80">
                      <span className="min-w-0 flex-1">
                        <b className="block font-semibold">{r.code} · {r.name}</b>
                        <span className="text-[12px] text-muted">{r.client || "No client"} · {BILLING_LABEL[r.billing as keyof typeof BILLING_LABEL]}{!r.hasClient && <span className="text-warning"> · pick a client to bill</span>}</span>
                      </span>
                      <span className="text-right tabular-nums">
                        <b className="block">{inr(r.readyAmount + r.milestones + r.expenses)}</b>
                        <span className="text-[11.5px] text-muted">{r.readyMinutes ? `${hrs(r.readyMinutes)} ready` : ""}{r.waitingMinutes ? ` · ${hrs(r.waitingMinutes)} waiting` : ""}{r.expenses ? ` · ${inr(r.expenses)} expenses` : ""}</span>
                      </span>
                      <ArrowRight className="size-4 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

type Profit = { projects: { id: string; code: string; name: string; client: string; status: string; billing: string; minutes: number; billed: number; toBill: number; revenue: number; cost: number; expenses: number; profit: number; margin: number | null; effectiveRate: number | null }[]; usesHr: boolean; missingCost: { id: string; name: string }[] };
export function ProfitView() {
  const q = useWorkQuery<Profit>("profit");
  const d = q.data;
  const sum = (k: "revenue" | "cost" | "profit") => d?.projects.reduce((n, p) => n + p[k], 0) ?? 0;
  return (
    <div>
      <PageHeader title="Cost & profit" description="What each project earns against what its hours cost." actions={d && <ExportMenu name="project-profit" columns={[{ key: "code", label: "Code" }, { key: "name", label: "Project" }, { key: "client", label: "Client" }, { key: "hours", label: "Hours" }, { key: "billed", label: "Invoiced", money: true }, { key: "toBill", label: "Still to bill", money: true }, { key: "revenue", label: "Revenue", money: true }, { key: "cost", label: "Cost", money: true }, { key: "expenses", label: "of which expenses", money: true }, { key: "profit", label: "Profit", money: true }, { key: "margin", label: "Margin %" }]} rows={d.projects.map((p) => ({ ...p, hours: Number((p.minutes / 60).toFixed(2)), margin: p.margin === null ? "" : Math.round(p.margin * 100) }))} />} />
      {!d ? (
        <Skeleton className="h-[40vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          <Notice title="How this is worked out">
            Revenue is what&apos;s been invoiced from a project (before tax, not counting voided invoices) plus billable time still to bill at its rates; fixed-fee projects count their fee. Billable expenses count at what they&apos;re re-charged. Cost is each person&apos;s hours at their cost rate on the project{d.usesHr ? ", or from their salary in HR (yearly CTC spread over your working hours)" : ""}, plus everything spent on it.
          </Notice>
          {d.missingCost.length > 0 && (
            <Notice tone="warning" title="Some hours have no cost">
              {d.missingCost.map((m) => m.name).join(", ")} {d.missingCost.length === 1 ? "has" : "have"} no cost rate{d.usesHr ? " or salary in HR" : ""}, so their hours count as free. Set a cost on each project&apos;s team.
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Revenue" value={short(sum("revenue"))} />
            <Stat label="Cost" value={short(sum("cost"))} />
            <Stat label="Profit" value={short(sum("profit"))} sub={sum("revenue") ? `${pct(sum("profit") / sum("revenue"))} margin` : undefined} tone={sum("profit") < 0 ? "warn" : "good"} />
          </div>
          <Section title="By project">
            {!d.projects.length ? (
              <Empty>No time or invoices yet.</Empty>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr className="text-right text-[12px] text-muted">
                      <th className="py-2 pr-3 text-left font-medium">Project</th>
                      <th className="py-2 pr-3 font-medium">Hours</th>
                      <th className="py-2 pr-3 font-medium">Revenue</th>
                      <th className="py-2 pr-3 font-medium">Cost</th>
                      <th className="py-2 pr-3 font-medium">Profit</th>
                      <th className="py-2 pr-3 font-medium">Margin</th>
                      <th className="py-2 font-medium">Per hour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-right tabular-nums">
                    {d.projects.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-3 text-left"><Link href={`/work/projects/${p.id}`} className="font-medium hover:underline">{p.code} · {p.name}</Link><span className="block text-[12px] text-muted">{p.client || "In-house"}{p.toBill ? ` · ${short(p.toBill)} still to bill` : ""}</span></td>
                        <td className="py-2 pr-3">{hrs(p.minutes)}</td>
                        <td className="py-2 pr-3">{short(p.revenue)}</td>
                        <td className="py-2 pr-3">{short(p.cost)}{p.expenses ? <span className="block text-[11.5px] text-muted">{short(p.expenses)} expenses</span> : null}</td>
                        <td className={cx("py-2 pr-3 font-semibold", p.profit < 0 && "text-danger")}>{short(p.profit)}</td>
                        <td className={cx("py-2 pr-3", (p.margin ?? 0) < 0 && "text-danger")}>{pct(p.margin)}</td>
                        <td className="py-2">{p.effectiveRate !== null && p.minutes ? short(p.effectiveRate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

type Reports = {
  from: string;
  to: string;
  totals: { minutes: number; billable: number };
  byProject: { id: string; code: string; name: string; client: string; minutes: number; billable: number }[];
  byPerson: { userId: string; name: string; minutes: number; billable: number; capacity: number; leaveDays: number; utilisation: number | null; billableShare: number | null }[];
  budgets: { id: string; code: string; name: string; budgetHours: number; budgetAmount: number; minutes: number; used: number; burn: number | null; tasks: number; done: number; dueDate: string | null }[];
  daily: { date: string; minutes: number; billable: number }[];
  everyone: boolean;
};
export function ReportsView() {
  const [range, setRange] = useState({ from: addDays(todayIst(), -29), to: todayIst() });
  const q = useWorkQuery<Reports>(`reports?from=${range.from}&to=${range.to}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Reports" description={d && !d.everyone ? "Your own time." : "Where the team's time goes."} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Input aria-label="From" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 !w-40" />
        <span className="text-muted">to</span>
        <Input aria-label="To" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 !w-40" />
        {[["Last 30 days", 29], ["Last 7 days", 6], ["Last 90 days", 89]].map(([l, n]) => (
          <Button key={l} size="sm" variant="ghost" onClick={() => setRange({ from: addDays(todayIst(), -Number(n)), to: todayIst() })}>{l}</Button>
        ))}
      </div>
      {!d ? (
        <Skeleton className="h-[50vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hours logged" value={hrs(d.totals.minutes)} sub={`${fmt(d.from, { day: "numeric", month: "short" })} – ${fmt(d.to, { day: "numeric", month: "short" })}`} />
            <Stat label="Billable" value={hrs(d.totals.billable)} sub={pct(d.totals.minutes ? d.totals.billable / d.totals.minutes : null)} />
            <Stat label="Projects" value={d.byProject.length} sub="with time" />
            <Stat label="Over budget" value={d.budgets.filter((b) => (b.burn ?? 0) > 1).length} tone={d.budgets.some((b) => (b.burn ?? 0) > 1) ? "warn" : undefined} />
          </div>
          <Section title="Hours per day">
            <Daily rows={d.daily} from={d.from} to={d.to} />
          </Section>
          <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <Section title="By project" action={<ExportMenu name="hours-by-project" columns={[{ key: "code", label: "Code" }, { key: "name", label: "Project" }, { key: "client", label: "Client" }, { key: "hours", label: "Hours" }, { key: "billableHours", label: "Billable hours" }]} rows={d.byProject.map((p) => ({ ...p, hours: Number((p.minutes / 60).toFixed(2)), billableHours: Number((p.billable / 60).toFixed(2)) }))} />}>
              {!d.byProject.length ? (
                <Empty>No time in these dates.</Empty>
              ) : (
                <ul className="grid gap-2.5">
                  {d.byProject.map((p) => (
                    <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,160px)_56px] items-center gap-3 text-[13px]">
                      <Link href={`/work/projects/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.code} · {p.name}</Link>
                      <Bar plain value={d.byProject[0].minutes ? p.minutes / d.byProject[0].minutes : 0} />
                      <span className="text-right tabular-nums">{hrs(p.minutes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={d.everyone ? "By person" : "You"} action={<ExportMenu name="utilisation" columns={[{ key: "name", label: "Person" }, { key: "hours", label: "Hours" }, { key: "billableHours", label: "Billable hours" }, { key: "capacityHours", label: "Capacity (hours)" }, { key: "leaveDays", label: "Leave (days)" }, { key: "utilisation", label: "Utilisation %" }]} rows={d.byPerson.map((p) => ({ ...p, hours: Number((p.minutes / 60).toFixed(2)), billableHours: Number((p.billable / 60).toFixed(2)), capacityHours: p.capacity / 60, utilisation: p.utilisation === null ? "" : Math.round(p.utilisation * 100) }))} />}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[12px] text-muted">
                    <th className="py-2 pr-3 text-left font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium">Hours</th>
                    <th className="py-2 pr-3 font-medium">Billable</th>
                    <th className="py-2 font-medium">Of capacity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.byPerson.map((p) => (
                    <tr key={p.userId}>
                      <td className="py-2 pr-3 text-left font-medium">{p.name}{p.leaveDays > 0 && <span className="block text-[11.5px] font-normal text-muted">{p.leaveDays} day{p.leaveDays === 1 ? "" : "s"} on leave</span>}</td>
                      <td className="py-2 pr-3">{hrs(p.minutes)}</td>
                      <td className="py-2 pr-3">{pct(p.billableShare)}</td>
                      <td className={cx("py-2", (p.utilisation ?? 0) > 1 && "font-semibold text-warning")}>{pct(p.utilisation)}<span className="block text-[11.5px] text-muted">of {hrs(p.capacity)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
          <Section title="Budgets on open projects">
            {!d.budgets.length ? (
              <Empty>No open project has a budget. Give one an hours or ₹ budget to track it here.</Empty>
            ) : (
              <ul className="grid gap-3">
                {d.budgets.map((b) => (
                  <li key={b.id} className="grid gap-1.5 text-[13px]">
                    <span className="flex items-center justify-between gap-3">
                      <Link href={`/work/projects/${b.id}`} className="font-medium hover:underline">{b.code} · {b.name}</Link>
                      <span className={cx("tabular-nums", (b.burn ?? 0) > 1 ? "font-semibold text-danger" : "text-muted")}>{pct(b.burn)} · {b.budgetAmount ? `${short(b.used)} of ${short(b.budgetAmount)}` : `${hrs(b.minutes)} of ${b.budgetHours}h`}</span>
                    </span>
                    <Bar value={b.burn} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/** One thin bar per day; billable hours sit on the bottom of each bar in a stronger tone. */
function Daily({ rows, from, to }: { rows: Reports["daily"]; from: string; to: string }) {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 92; d = addDays(d, 1)) days.push(d);
  const by = new Map(rows.map((r) => [r.date, r]));
  const max = Math.max(60, ...rows.map((r) => r.minutes));
  const [hover, setHover] = useState<string | null>(null);
  const h = hover ? by.get(hover) : null;
  return (
    <div>
      <div className="flex items-center gap-4 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-accent" />Billable</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-accent/35" />Not billable</span>
        <span className="ml-auto tabular-nums" aria-live="polite">{hover ? `${fmt(hover, { weekday: "short", day: "numeric", month: "short" })}: ${hm(h?.minutes ?? 0)}${h ? ` (${hm(h.billable)} billable)` : ""}` : ""}</span>
      </div>
      <div className="mt-3 flex h-36 items-end gap-[2px]" role="img" aria-label={`Hours logged each day from ${fmt(from)} to ${fmt(to)}`}>
        {days.map((d) => {
          const r = by.get(d);
          const total = r?.minutes ?? 0;
          const bill = r?.billable ?? 0;
          return (
            <div key={d} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)} className="flex h-full flex-1 flex-col justify-end">
              {total > 0 && (
                <>
                  <span className="block rounded-t-[4px] bg-accent/35" style={{ height: `${((total - bill) / max) * 100}%` }} />
                  <span className={cx("block bg-accent", total === bill && "rounded-t-[4px]")} style={{ height: `${(bill / max) * 100}%` }} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{fmt(from, { day: "numeric", month: "short" })}</span>
        <span>{fmt(to, { day: "numeric", month: "short" })}</span>
      </div>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function SettingsView() {
  const { meta } = useWork();
  const [s, setS] = useState<WorkSettings>(meta.settings);
  const [rate, setRate] = useState(fromPaise(meta.settings.defaultRate));
  const save = useWorkAction<void>(() => ({ path: "settings", method: "PUT", body: { ...s, defaultRate: toPaise(rate) } }), { success: "Settings saved" });
  const set = (p: Partial<WorkSettings>) => setS((x) => ({ ...x, ...p }));
  return (
    <div>
      <PageHeader title="Settings" description="How boards, timesheets and billing work in this workspace." actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Board columns">
          <div className="grid gap-3 sm:grid-cols-2">
            {TASK_STATUSES.map((k) => (
              <Field key={k} label={k === "todo" ? "First" : k === "done" ? "Finished" : k === "doing" ? "Working" : "Checking"}>
                {(p) => <Input {...p} value={s.columns[k]} onChange={(e) => set({ columns: { ...s.columns, [k]: e.target.value } })} />}
              </Field>
            ))}
          </div>
        </Section>
        <Section title="Working time">
          <div className="grid gap-3">
            <Field label="Hours in a working day" hint="For capacity, utilisation and costs from HR salaries">{(p) => <Input {...p} type="number" min={1} max={16} step={0.5} value={s.dailyHours} onChange={(e) => set({ dailyHours: Number(e.target.value) || 8 })} className="max-w-[120px]" />}</Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Working days</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w, i) => {
                  const on = s.workDays.includes(i + 1);
                  return (
                    <button key={w} type="button" aria-pressed={on} onClick={() => set({ workDays: on ? s.workDays.filter((d) => d !== i + 1) : [...s.workDays, i + 1].sort() })} className={cx("h-8 rounded-full px-3 text-[12.5px] font-medium", on ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>
        <Section title="Timesheets">
          <div className="grid gap-3">
            <LabeledSwitch checked={s.approval} onChange={(v) => set({ approval: v })} label="Weeks need approval before they can be billed" />
            <p className="text-[12px] text-muted">{s.approval ? "People send in their week; an owner or admin approves it or sends it back with a note." : "Time counts as approved as soon as it's logged."}</p>
          </div>
        </Section>
        <Section title="Billing">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Default rate per hour (₹)" hint="For new projects">{(p) => <Input {...p} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
            <Field label="Round each entry up to" hint="Only on invoices; logged time stays exact">
              {(p) => (
                <Select {...p} value={s.roundTo} onChange={(e) => set({ roundTo: Number(e.target.value) as WorkSettings["roundTo"] })}>
                  <option value={0}>Exact minutes</option>
                  <option value={6}>6 minutes (0.1h)</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                </Select>
              )}
            </Field>
            <Field label="Project code prefix">{(p) => <Input {...p} value={s.projectPrefix} maxLength={8} onChange={(e) => set({ projectPrefix: e.target.value })} />}</Field>
          </div>
        </Section>
      </div>
      <div className="mt-5">
        <StatusPill status="draft" label={`Codes look like ${s.projectPrefix || ""}0001`} />
      </div>
    </div>
  );
}
