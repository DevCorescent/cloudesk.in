"use client";

// Projects home: the timer, your week's hours against your capacity, what's
// on your plate, projects that need a look, and what's waiting for you to
// approve or bill.
import { AlertTriangle, ArrowRight, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, PageHeader, Skeleton, cx } from "@/components/ui/primitives";
import { ProjectDialog } from "./projects";
import { TimerBar } from "./timesheet";
import { Bar, Empty, PriorityFlag, Section, Stat, fmt, hm, hrs, pct, tint, todayIst, useWork, useWorkQuery, type ProjectRow, type Task } from "./shared";

type Home = {
  tasks: Task[];
  counts: { open: number; overdue: number; dueToday: number };
  week: { days: string[]; logged: Record<string, number>; total: number; capacity: number };
  projects: ProjectRow[];
  atRisk: { id: string; name: string; code: string; burn: number | null; overdue: number; late: boolean }[];
  approvals: number;
  activeProjects: number;
};
type TimerQ = { timer: Parameters<typeof TimerBar>[0]["timer"] };

export function HomeView() {
  const { meta, go } = useWork();
  const q = useWorkQuery<Home>("home", { refetchInterval: 60_000 });
  const timer = useWorkQuery<TimerQ>(meta.parts.timesheets ? "timer" : null);
  const [adding, setAdding] = useState(false);
  const d = q.data;
  const today = todayIst();
  return (
    <div>
      <PageHeader
        title="Projects & time"
        description="Your tasks, your week and the projects you're on."
        actions={
          meta.me.write && (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
              New project
            </Button>
          )
        }
      />
      {meta.parts.timesheets && <TimerBar timer={timer.data?.timer ?? null} />}
      {!d ? (
        <Skeleton className="mt-5 h-[60vh] rounded-[24px]" />
      ) : (
        <div className="mt-5 grid gap-5">
          {d.activeProjects === 0 && !d.projects.length && (
            <Section title="Get started">
              <button type="button" onClick={() => (meta.me.write ? setAdding(true) : go("projects"))} className="flex w-full items-start gap-3 rounded-[16px] border border-border p-4 text-left hover:bg-surface-2">
                <FolderKanban className="mt-0.5 size-5 text-muted" />
                <span>
                  <b className="block text-[14px]">Start your first project</b>
                  <span className="text-[12.5px] text-muted">Add tasks to its board, log time against them, and bill the client from your invoicing books. Already tracking work elsewhere? Import projects, tasks and time from a spreadsheet.</span>
                </span>
              </button>
            </Section>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="My open tasks" value={d.counts.open} sub={d.counts.dueToday ? `${d.counts.dueToday} due today` : "across every project"} onClick={() => go("tasks")} />
            <Stat label="Overdue" value={d.counts.overdue} sub="assigned to you" tone={d.counts.overdue ? "warn" : undefined} onClick={() => go("tasks")} />
            {meta.parts.timesheets && <Stat label="This week" value={hrs(d.week.total)} sub={`of ${hrs(d.week.capacity)} · ${pct(d.week.capacity ? d.week.total / d.week.capacity : null)}`} onClick={() => go("timesheet")} />}
            {meta.me.manage && meta.parts.timesheets ? (
              <Stat label="Waiting for approval" value={d.approvals} sub={d.approvals === 1 ? "week" : "weeks"} tone={d.approvals ? "warn" : undefined} onClick={() => go("approvals")} />
            ) : (
              <Stat label="Active projects" value={d.activeProjects} onClick={() => go("projects")} />
            )}
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] [&>*]:min-w-0">
            <div className="grid content-start gap-5">
              <Section title="On your plate" action={<Link href="/work/tasks" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All <ArrowRight className="size-3.5" /></Link>}>
                {!d.tasks.length ? (
                  <Empty>Nothing assigned to you. Enjoy it while it lasts.</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.tasks.map((t) => (
                      <li key={t.id}>
                        <Link href={`/work/tasks/${t.id}`} className="flex items-center gap-3 py-2.5 text-[13px] hover:opacity-80">
                          <span className={cx("shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold", tint(t.project?.tint))}>{t.project?.code}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                          <PriorityFlag priority={t.priority} />
                          <span className={cx("w-16 shrink-0 text-right text-[12px] tabular-nums", t.overdue ? "font-semibold text-danger" : t.dueDate === today ? "font-semibold" : "text-muted")}>{t.dueDate ? (t.dueDate === today ? "Today" : fmt(t.dueDate, { day: "numeric", month: "short" })) : ""}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Your projects" action={<Link href="/work/projects" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All <ArrowRight className="size-3.5" /></Link>}>
                {!d.projects.length ? (
                  <Empty>You&apos;re not on any open projects.</Empty>
                ) : (
                  <ul className="grid gap-2.5">
                    {d.projects.map((p) => (
                      <li key={p.id}>
                        <Link href={`/work/projects/${p.id}`} className="grid grid-cols-[minmax(0,1fr)_120px_60px] items-center gap-3 text-[13px] hover:opacity-80">
                          <span className="min-w-0">
                            <b className="block truncate font-semibold">{p.name}</b>
                            <span className="text-[12px] text-muted">{p.code} · {p.clientName || "In-house"}</span>
                          </span>
                          <Bar plain value={p.stats.tasks ? p.stats.done / p.stats.tasks : 0} />
                          <span className="text-right text-[12px] text-muted tabular-nums">{p.stats.done}/{p.stats.tasks}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            <div className="grid content-start gap-5">
              {meta.parts.timesheets && (
                <Section title="Your week" action={<Link href="/work/timesheet" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">Timesheet <ArrowRight className="size-3.5" /></Link>}>
                  <WeekBars days={d.week.days} logged={d.week.logged} target={meta.settings.dailyHours * 60} workDays={meta.settings.workDays} />
                </Section>
              )}
              <Section title="Needs a look">
                {!d.atRisk.length ? (
                  <Empty>Every open project is on time and inside its budget.</Empty>
                ) : (
                  <ul className="grid gap-2">
                    {d.atRisk.map((p) => (
                      <li key={p.id}>
                        <Link href={`/work/projects/${p.id}`} className="flex items-start gap-2.5 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px] hover:opacity-80">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                          <span className="min-w-0">
                            <b className="block truncate font-semibold">{p.code} · {p.name}</b>
                            <span className="text-[12px] text-muted">{[p.late && "past its due date", p.overdue > 0 && `${p.overdue} overdue task${p.overdue === 1 ? "" : "s"}`, (p.burn ?? 0) >= 0.9 && `${pct(p.burn)} of budget used`].filter(Boolean).join(" · ")}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
      {adding && <ProjectDialog onClose={() => setAdding(false)} onSaved={(id) => go(`projects/${id}`)} />}
    </div>
  );
}

/** Hours per day this week, one bar each, with the day's target as a line. */
function WeekBars({ days, logged, target, workDays }: { days: string[]; logged: Record<string, number>; target: number; workDays: number[] }) {
  const max = Math.max(target, ...days.map((d) => logged[d] ?? 0)) || 1;
  const today = todayIst();
  return (
    <div className="grid grid-cols-7 items-end gap-2" role="list" aria-label="Hours logged each day this week">
      {days.map((d, i) => {
        const m = logged[d] ?? 0;
        const working = workDays.includes(i + 1);
        return (
          <div key={d} role="listitem" className="group grid justify-items-center gap-1.5" title={`${fmt(d, { weekday: "long", day: "numeric", month: "short" })}: ${hm(m)}`}>
            <div className="relative flex h-28 w-full items-end justify-center rounded-[10px] bg-surface-2/60">
              {working && <span aria-hidden className="absolute inset-x-1 border-t border-dashed border-border" style={{ bottom: `${(target / max) * 100}%` }} />}
              <span className={cx("w-3/5 rounded-t-[4px]", m > target ? "bg-warning" : "bg-accent", !m && "opacity-0")} style={{ height: `${Math.max(2, (m / max) * 100)}%` }} />
            </div>
            <span className={cx("text-[11px]", d === today ? "font-semibold text-fg" : "text-muted")}>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" })}</span>
            <span className="text-[11px] tabular-nums text-muted">{m ? hm(m) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}
