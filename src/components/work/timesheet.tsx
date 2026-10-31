"use client";

// Time: the weekly timesheet (type 1:30, 1.5 or 90m into any day), a timer,
// logging time by hand, sending the week for approval, and the approvals queue
// for owners and admins. Days of approved HR leave are marked and come off the
// week's capacity.
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play, Plus, Send, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { Bar, Empty, Section, StatusPill, addDays, fmt, hm, hrs, parseDuration, tint, todayIst, useWork, useWorkAction, useWorkQuery, weekOf, workApi, type ProjectRow, type Task } from "./shared";

type Week = {
  week: string;
  days: string[];
  userId: string;
  rows: { projectId: string; taskId: string | null; project: string; code: string; tint: string; task: string | null; taskNumber: number | null; closed: boolean; days: Record<string, number>; locked: Record<string, boolean>; total: number }[];
  totals: Record<string, number>;
  total: number;
  capacity: number;
  leave: Record<string, number>;
  status: "empty" | "draft" | "submitted" | "approved" | "rejected";
  rejected: string;
  approval: boolean;
  entries: { id: string; date: string; minutes: number; note: string; status: string; project: string; code: string; task: string | null; invoiceId: string | null }[];
  timer: Timer | null;
};
type Timer = { id: string; date: string; minutes: number; startedAt: string; note: string; projectId: string; taskId: string | null; project: string; task: string | null };

const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

export function TimesheetView({ userId, weekStart, onBack }: { userId?: string; weekStart?: string; onBack?: () => void } = {}) {
  const { meta, orgId } = useWork();
  const fromUrl = useSearchParams().get("week");
  const [week, setWeek] = useState(weekStart ?? weekOf(fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) ? fromUrl : todayIst()));
  const path = `timesheet?week=${week}${userId ? `&userId=${userId}` : ""}`;
  const q = useWorkQuery<Week>(path, { keepPrevious: true });
  const [adding, setAdding] = useState(false);
  const [extra, setExtra] = useState<Week["rows"]>([]);
  const cell = useWorkAction<{ projectId: string; taskId: string | null; date: string; minutes: number }>((b) => ({ path: "timesheet/cell", method: "PUT", body: { ...b, userId } }));
  const submit = useWorkAction<void, { status: string }>(() => ({ path: "timesheet/submit", body: { week } }), { success: (r) => (r.status === "approved" ? "Week saved" : "Sent for approval") });
  const recall = useWorkAction<void>(() => ({ path: "timesheet/recall", body: { week } }), { success: "Taken back — you can change it now" });
  const own = !userId || userId === meta.me.id;
  const d = q.data;
  const rows = d ? [...d.rows, ...extra.filter((x) => !d.rows.some((r) => r.projectId === x.projectId && r.taskId === x.taskId))] : [];
  const qc = useQueryClient();
  const exportRows = (d?.entries ?? []).filter((e) => e.minutes > 0).map((e) => ({ ...e, task: e.task ?? "", hours: Number((e.minutes / 60).toFixed(2)) }));
  return (
    <div>
      <PageHeader
        title={own ? "Timesheet" : "Timesheet review"}
        description={own ? "Type hours into any day — 1:30, 1.5 and 90m all work." : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onBack && <Button size="sm" onClick={onBack}>Back to approvals</Button>}
            {own && (
              <ImportButton
                target={target("work.time")}
                label="Import"
                onImport={(rows, mode) => api(workApi(orgId, "time/import"), { method: "POST", body: { rows, mode } })}
                onDone={() => qc.invalidateQueries({ queryKey: ["work", orgId] })}
              />
            )}
            <ExportMenu
              name={`timesheet-${week}`}
              columns={[
                { key: "date", label: "Date" },
                { key: "code", label: "Project code" },
                { key: "project", label: "Project" },
                { key: "task", label: "Task" },
                { key: "hours", label: "Hours" },
                { key: "note", label: "Note" },
                { key: "status", label: "Status" },
              ]}
              rows={exportRows}
            />
          </div>
        }
      />
      {own && <TimerBar timer={d?.timer ?? null} />}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous week" icon={<ChevronLeft className="size-4" />} onClick={() => (setWeek(addDays(week, -7)), setExtra([]))} />
          <p className="min-w-[180px] text-center text-[14px] font-semibold">
            {fmt(week, { day: "numeric", month: "short" })} – {fmt(addDays(week, 6), { day: "numeric", month: "short", year: "numeric" })}
          </p>
          <Button size="sm" variant="ghost" aria-label="Next week" icon={<ChevronRight className="size-4" />} onClick={() => (setWeek(addDays(week, 7)), setExtra([]))} />
          {week !== weekOf(todayIst()) && <Button size="sm" variant="ghost" onClick={() => setWeek(weekOf(todayIst()))}>This week</Button>}
        </div>
        {d && <StatusPill status={d.status} label={!d.approval && d.status === "approved" ? "Saved" : undefined} />}
      </div>
      {d?.status === "rejected" && d.rejected && <div className="mt-3"><Notice tone="danger" title="Sent back">{d.rejected}</Notice></div>}
      {!d ? (
        <Skeleton className="mt-4 h-[40vh] rounded-[24px]" />
      ) : (
        <Section title={<span>Week <span className="font-normal text-muted">· {hrs(d.total)} of {hrs(d.capacity)}</span></span>} className="mt-4" action={<Bar value={d.capacity ? d.total / d.capacity : null} className="w-32" />}>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-2 pr-3 font-medium">Project · task</th>
                  {d.days.map((day) => (
                    <th key={day} className={cx("w-[72px] px-1 py-2 text-center font-medium", day === todayIst() && "text-fg")}>
                      {dayName(day)}
                      <span className="block text-[11px] font-normal">{fmt(day, { day: "numeric" })}</span>
                      {d.leave[day] && <span className="block text-[10.5px] font-semibold text-warning">{d.leave[day] === 0.5 ? "½ leave" : "Leave"}</span>}
                    </th>
                  ))}
                  <th className="w-[64px] py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={`${r.projectId}|${r.taskId}`}>
                    <td className="max-w-[240px] py-1.5 pr-3">
                      <span className={cx("mr-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium", tint(r.tint))}>{r.code}</span>
                      <span className="font-medium">{r.project}</span>
                      <span className="block truncate text-[12px] text-muted">{r.task ? `#${r.taskNumber} ${r.task}` : "General"}</span>
                    </td>
                    {d.days.map((day) => (
                      <td key={day} className="px-1 py-1.5">
                        <CellInput
                          key={r.days[day] ?? 0}
                          label={`${r.project}${r.task ? `, ${r.task}` : ""}, ${dayName(day)} ${fmt(day, { day: "numeric", month: "short" })}`}
                          minutes={r.days[day] ?? 0}
                          disabled={r.locked[day] || r.closed || (!own && !meta.me.manage)}
                          onSave={(minutes) => cell.mutate({ projectId: r.projectId, taskId: r.taskId, date: day, minutes })}
                        />
                      </td>
                    ))}
                    <td className="py-1.5 text-right font-semibold tabular-nums">{hm(r.total)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted">Nothing logged this week yet. Add a row, start the timer, or log time from a task.</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-border text-[12.5px] font-semibold">
                  <td className="py-2 pr-3">
                    {(own || meta.me.manage) && (
                      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                        Add a row
                      </Button>
                    )}
                  </td>
                  {d.days.map((day) => (
                    <td key={day} className="px-1 py-2 text-center tabular-nums">{d.totals[day] ? hm(d.totals[day]) : "—"}</td>
                  ))}
                  <td className="py-2 text-right tabular-nums">{hm(d.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {own && (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              {d.status === "submitted" && <Button size="sm" icon={<Undo2 className="size-3.5" />} loading={recall.isPending} onClick={() => recall.mutate()}>Take back</Button>}
              {(d.status === "draft" || d.status === "rejected") && (
                <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={submit.isPending} onClick={() => submit.mutate()}>
                  {d.approval ? "Send for approval" : "Save week"}
                </Button>
              )}
            </div>
          )}
        </Section>
      )}
      {adding && <AddRowDialog onClose={() => setAdding(false)} onPick={(row) => (setExtra((x) => [...x, row]), setAdding(false))} />}
    </div>
  );
}

function CellInput({ minutes, onSave, disabled, label }: { minutes: number; onSave: (m: number) => void; disabled?: boolean; label: string }) {
  // Keyed by the saved minutes, so a new value from the server starts it afresh.
  const [v, setV] = useState(minutes ? hm(minutes) : "");
  const [bad, setBad] = useState(false);
  const commit = () => {
    const m = parseDuration(v);
    if (m === null) return setBad(true);
    setBad(false);
    if (m !== minutes) onSave(m);
    setV(m ? hm(m) : "");
  };
  return (
    <input
      aria-label={label}
      value={v}
      disabled={disabled}
      inputMode="decimal"
      placeholder="—"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={cx("h-8 w-full rounded-[9px] border bg-transparent px-1 text-center tabular-nums outline-none", bad ? "border-danger" : "border-border focus:border-accent", disabled && "cursor-not-allowed border-transparent bg-surface-2/60 text-muted")}
    />
  );
}

/** Pick a project (and a task) to add as a row in the week. */
function AddRowDialog({ onClose, onPick }: { onClose: () => void; onPick: (r: Week["rows"][number]) => void }) {
  const projects = useWorkQuery<{ projects: ProjectRow[] }>("projects?status=open");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const tasks = useWorkQuery<{ tasks: Task[] }>(projectId ? `tasks?projectId=${projectId}&status=open` : null);
  const p = projects.data?.projects.find((x) => x.id === projectId);
  const t = tasks.data?.tasks.find((x) => x.id === taskId);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a row"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!p} onClick={() => p && onPick({ projectId: p.id, taskId: t?.id ?? null, project: p.name, code: p.code, tint: p.tint, task: t?.title ?? null, taskNumber: t?.number ?? null, closed: false, days: {}, locked: {}, total: 0 })}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <ProjectTaskPicker projects={projects.data?.projects ?? []} tasks={tasks.data?.tasks ?? []} projectId={projectId} taskId={taskId} onProject={(id) => (setProjectId(id), setTaskId(""))} onTask={setTaskId} />
      </div>
    </Dialog>
  );
}

function ProjectTaskPicker({ projects, tasks, projectId, taskId, onProject, onTask }: { projects: ProjectRow[]; tasks: Task[]; projectId: string; taskId: string; onProject: (id: string) => void; onTask: (id: string) => void }) {
  return (
    <>
      <Field label="Project">
        {(p) => (
          <Select {...p} value={projectId} onChange={(e) => onProject(e.target.value)}>
            <option value="">Pick a project</option>
            {projects.filter((x) => x.status !== "done" && x.status !== "cancelled").map((x) => (
              <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Task">
        {(p) => (
          <Select {...p} value={taskId} disabled={!projectId} onChange={(e) => onTask(e.target.value)}>
            <option value="">General work on the project</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>#{t.number} {t.title}</option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

/** Start, watch and stop the timer. */
export function TimerBar({ timer }: { timer: Timer | null }) {
  const { meta } = useWork();
  const [now, setNow] = useState(() => Date.now());
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer]);
  const stop = useWorkAction<void, { minutes: number }>(() => ({ path: "timer/stop" }), { success: (r) => `Logged ${hm(r.minutes)}` });
  if (!meta.parts.timesheets) return null;
  const secs = timer ? Math.max(0, Math.floor((now - Date.parse(timer.startedAt)) / 1000)) + timer.minutes * 60 : 0;
  const clock = `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className={cx("flex flex-wrap items-center gap-3 rounded-[18px] border px-4 py-3", timer ? "border-accent/40 bg-accent-soft/40" : "border-border bg-surface")}>
      {timer ? (
        <>
          <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-accent" /></span>
          <span className="min-w-0 flex-1 text-[13px]">
            <b className="font-semibold">{timer.project}</b>
            <span className="text-muted">{timer.task ? ` · ${timer.task}` : ""}{timer.note ? ` · ${timer.note}` : ""}</span>
          </span>
          <b className="font-mono text-[18px] tabular-nums" aria-live="off">{clock}</b>
          <Button size="sm" variant="primary" icon={<Pause className="size-3.5" />} loading={stop.isPending} onClick={() => stop.mutate()}>Stop</Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-[13px] text-muted">No timer running.</span>
          <Button size="sm" icon={<Play className="size-3.5" />} onClick={() => setPicking(true)}>Start a timer</Button>
        </>
      )}
      {picking && <StartTimerDialog onClose={() => setPicking(false)} />}
    </div>
  );
}

function StartTimerDialog({ onClose }: { onClose: () => void }) {
  const projects = useWorkQuery<{ projects: ProjectRow[] }>("projects?status=open");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const tasks = useWorkQuery<{ tasks: Task[] }>(projectId ? `tasks?projectId=${projectId}&status=open` : null);
  const start = useWorkAction<void>(() => ({ path: "timer/start", body: { projectId, taskId: taskId || null, note } }), { success: "Timer started", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Start a timer"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Play className="size-3.5" />} disabled={!projectId} loading={start.isPending} onClick={() => start.mutate()}>Start</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <ProjectTaskPicker projects={projects.data?.projects ?? []} tasks={tasks.data?.tasks ?? []} projectId={projectId} taskId={taskId} onProject={(id) => (setProjectId(id), setTaskId(""))} onTask={setTaskId} />
        <Field label="What are you working on?">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />}</Field>
      </div>
    </Dialog>
  );
}

/** Log time by hand, on a project and (optionally) a task. */
export function LogTimeDialog({ projectId: fixedProject, taskId: fixedTask, onClose }: { projectId?: string; taskId?: string; onClose: () => void }) {
  const projects = useWorkQuery<{ projects: ProjectRow[] }>(fixedProject ? null : "projects?status=open");
  const [projectId, setProjectId] = useState(fixedProject ?? "");
  const [taskId, setTaskId] = useState(fixedTask ?? "");
  const [date, setDate] = useState(todayIst());
  const [dur, setDur] = useState("");
  const [note, setNote] = useState("");
  const [billable, setBillable] = useState(true);
  const tasks = useWorkQuery<{ tasks: Task[] }>(!fixedTask && projectId ? `tasks?projectId=${projectId}&status=open` : null);
  const minutes = parseDuration(dur);
  const save = useWorkAction<void>(() => ({ path: "time", body: { projectId, taskId: taskId || null, date, minutes, note, billable } }), { success: "Time logged", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log time"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!projectId || !minutes} loading={save.isPending} onClick={() => save.mutate()}>Log {minutes ? hm(minutes) : ""}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!fixedProject && (
          <div className="grid gap-3 sm:col-span-2">
            <ProjectTaskPicker projects={projects.data?.projects ?? []} tasks={tasks.data?.tasks ?? []} projectId={projectId} taskId={taskId} onProject={(id) => (setProjectId(id), setTaskId(""))} onTask={setTaskId} />
          </div>
        )}
        <Field label="Date">{(p) => <Input {...p} type="date" value={date} max={addDays(todayIst(), 7)} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="How long" hint="1:30, 1.5 or 90m" error={dur && minutes === null ? "That isn't a duration" : undefined}>{(p) => <Input {...p} autoFocus value={dur} onChange={(e) => setDur(e.target.value)} placeholder="1:30" />}</Field>
        <Field label="Note" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} className="accent-[var(--accent)]" />
          Billable
        </label>
      </div>
    </Dialog>
  );
}

type Waiting = { userId: string; name: string; week: string; minutes: number; billable: number; entries: number; projects: string[] };
export function ApprovalsView() {
  const q = useWorkQuery<{ weeks: Waiting[] }>("approvals");
  const [open, setOpen] = useState<Waiting | null>(null);
  const [sending, setSending] = useState<Waiting | null>(null);
  const [note, setNote] = useState("");
  const decide = useWorkAction<{ w: Waiting; approve: boolean }>(({ w, approve }) => ({ path: "approvals", body: { userId: w.userId, week: w.week, approve, note: approve ? "" : note } }), {
    success: "Done",
    onDone: () => (setSending(null), setNote(""), setOpen(null)),
  });
  if (open) return <TimesheetView userId={open.userId} weekStart={open.week} onBack={() => setOpen(null)} />;
  return (
    <div>
      <PageHeader title="Approvals" description="Weeks people have sent in. Approved time can be billed; sent-back weeks go to the person with your note." />
      {!q.data ? (
        <Skeleton className="h-[40vh] rounded-[24px]" />
      ) : !q.data.weeks.length ? (
        <Empty>Nothing is waiting for approval.</Empty>
      ) : (
        <Section title={`${q.data.weeks.length} waiting`}>
          <ul className="divide-y divide-border">
            {q.data.weeks.map((w) => (
              <li key={`${w.userId}-${w.week}`} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b className="block font-semibold">{w.name}</b>
                  <span className="text-[12px] text-muted">Week of {fmt(w.week, { day: "numeric", month: "short" })} · {w.projects.join(", ")}</span>
                </span>
                <span className="text-right tabular-nums">
                  <b>{hrs(w.minutes)}</b>
                  <span className="block text-[11.5px] text-muted">{hrs(w.billable)} billable</span>
                </span>
                <Button size="sm" onClick={() => setOpen(w)}>Review</Button>
                <Button size="sm" onClick={() => setSending(w)}>Send back</Button>
                <Button size="sm" variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ w, approve: true })}>Approve</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {sending && (
        <Dialog
          open
          onClose={() => setSending(null)}
          title={`Send back ${sending.name}'s week`}
          footer={
            <>
              <Button onClick={() => setSending(null)}>Cancel</Button>
              <Button variant="primary" disabled={!note.trim()} loading={decide.isPending} onClick={() => decide.mutate({ w: sending, approve: false })}>Send back</Button>
            </>
          }
        >
          <Field label="What needs changing?">{(p) => <Textarea {...p} rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </Dialog>
      )}
    </div>
  );
}
