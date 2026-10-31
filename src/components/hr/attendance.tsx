"use client";

// Attendance: who's in today, the month sheet for everyone, marking days by
// hand, and corrections ("I forgot to check out") to approve.
import { Check, ChevronLeft, ChevronRight, Download, PenLine, X } from "lucide-react";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { csvEscape } from "@/lib/data/model";
import { cellLabel, cellStyle } from "./me";
import { Avatar, Empty, Section, Stat, deptName, fmt, monthLabel, timeOf, todayIst, useHr, useHrAction, useHrQuery } from "./shared";

type Board = { date: string; off: boolean; people: { id: string; name: string; designation: string; departmentId: string | null; checkIn: string | null; checkOut: string | null; status: string; late: boolean; leave: string | null; source: string | null }[] };
type Sheet = { month: string; days: { date: string; off: boolean; holiday: string | null }[]; people: { id: string; name: string; designation: string; cells: string[]; summary: { present: number; late: number; absent: number; leave: number } }[] };

const STATE: Record<string, [string, string]> = { in: ["In", "bg-success-soft text-success"], out: ["Gone home", "bg-surface-2 text-muted"], leave: ["On leave", "bg-[#e0f2fe] text-[#075985]"], not_in: ["Not in yet", "bg-warning-soft text-warning"], absent: ["Absent", "bg-danger-soft text-danger"], off: ["Day off", "bg-surface-2 text-muted"] };

export function AttendanceView() {
  const { meta } = useHr();
  const team = meta.me.manage || meta.me.isManager || meta.me.payroll;
  const [tab, setTab] = useState<"today" | "month" | "corrections">(team ? "today" : "month");
  const [marking, setMarking] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  return (
    <div>
      <PageHeader
        title="Attendance"
        description={`Shift ${meta.settings.shift.start}–${meta.settings.shift.end} · late after ${meta.settings.shift.graceMin} minutes · a full day is ${meta.settings.shift.fullDayHours} hours`}
        actions={
          <div className="flex gap-2">
            {meta.me.employeeId && (
              <Button size="sm" icon={<PenLine className="size-3.5" />} onClick={() => setCorrecting(true)}>
                Correct a day
              </Button>
            )}
            {(meta.me.manage || meta.me.isManager) && (
              <Button size="sm" variant="primary" onClick={() => setMarking(true)}>
                Mark attendance
              </Button>
            )}
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[...(team ? [{ value: "today" as const, label: "Today" }] : []), { value: "month", label: "Month" }, { value: "corrections", label: "Corrections" }]} />
      {tab === "today" && <TodayBoard />}
      {tab === "month" && <MonthSheet />}
      {tab === "corrections" && <Corrections />}
      {marking && <MarkDialog onClose={() => setMarking(false)} />}
      {correcting && <CorrectDialog onClose={() => setCorrecting(false)} />}
    </div>
  );
}

function TodayBoard() {
  const { meta } = useHr();
  const q = useHrQuery<Board>("attendance/today", { refetchInterval: 60_000 });
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  const p = q.data.people;
  const count = (s: string) => p.filter((x) => x.status === s).length;
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In" value={count("in") + count("out")} sub={`of ${p.length}`} tone="good" />
        <Stat label="Late" value={p.filter((x) => x.late).length} tone={p.some((x) => x.late) ? "warn" : undefined} />
        <Stat label="On leave" value={count("leave")} />
        <Stat label="Not in yet" value={count("not_in")} tone={count("not_in") ? "warn" : undefined} />
      </div>
      {q.data.off && <p className="mb-4 rounded-[14px] bg-surface-2 px-4 py-3 text-[13px] text-muted">Today is a weekly off or holiday.</p>}
      {!p.length ? (
        <Empty>No one to show.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">In</th>
                <th className="px-4 py-2.5 font-medium">Out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.map((x) => {
                const [label, tone] = STATE[x.status] ?? [x.status, ""];
                return (
                  <tr key={x.id}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={x.name} size={28} />
                        <span>
                          <b className="block font-medium">{x.name}</b>
                          <span className="text-[12px] text-muted">{deptName(meta, x.departmentId)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold", tone)}>{label}</span>
                      {x.late && <span className="ml-1.5 inline-flex h-[22px] items-center rounded-full bg-warning-soft px-2 text-[11.5px] font-semibold text-warning">Late</span>}
                      {x.leave && <span className="ml-1.5 text-[12px] text-muted">{x.leave}</span>}
                      {x.source === "horeca" && <span className="ml-1.5 text-[11.5px] text-subtle">via till</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{timeOf(x.checkIn)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{timeOf(x.checkOut)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthSheet() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const q = useHrQuery<Sheet>(`attendance/month?month=${month}`, { keepPrevious: true });
  const shift = (n: number) => setMonth(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7));
  const download = () => {
    if (!q.data) return;
    const head = ["Name", ...q.data.days.map((d) => d.date.slice(8)), "Present", "Late", "Leave", "Absent"];
    const lines = [head, ...q.data.people.map((p) => [p.name, ...p.cells, p.summary.present, p.summary.late, p.summary.leave, p.summary.absent])].map((r) => r.map(csvEscape).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Section
      title={monthLabel(month)}
      action={
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={download}>
            CSV
          </Button>
          <Button size="sm" variant="ghost" aria-label="Previous month" icon={<ChevronLeft className="size-4" />} onClick={() => shift(-1)} />
          <Button size="sm" variant="ghost" aria-label="Next month" icon={<ChevronRight className="size-4" />} onClick={() => shift(1)} />
        </span>
      }
    >
      {!q.data ? (
        <Skeleton className="h-64 rounded-[16px]" />
      ) : !q.data.people.length ? (
        <Empty>No one to show.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-44 bg-surface pb-1.5 text-left text-[12px] font-medium text-muted">Person</th>
                {q.data.days.map((d) => (
                  <th key={d.date} title={d.holiday ?? undefined} className={cx("pb-1.5 text-center font-medium", d.off || d.holiday ? "text-subtle" : "text-muted", d.date === todayIst() && "text-fg")}>
                    {Number(d.date.slice(8))}
                  </th>
                ))}
                <th className="px-2 pb-1.5 text-right text-[11.5px] font-medium text-muted">P</th>
                <th className="px-2 pb-1.5 text-right text-[11.5px] font-medium text-muted">L</th>
                <th className="px-2 pb-1.5 text-right text-[11.5px] font-medium text-muted">A</th>
              </tr>
            </thead>
            <tbody>
              {q.data.people.map((p) => (
                <tr key={p.id}>
                  <td className="sticky left-0 z-10 truncate bg-surface py-0.5 pr-2 text-[12.5px] font-medium">{p.name}</td>
                  {p.cells.map((c, i) => (
                    <td key={i} className="p-[1.5px]">
                      <span title={`${fmt(q.data!.days[i].date, { day: "numeric", month: "short" })} · ${c || "—"}`} className={cx("grid h-7 min-w-6 place-items-center rounded-[6px] font-semibold", cellStyle(c))}>
                        {cellLabel(c)}
                      </span>
                    </td>
                  ))}
                  <td className="px-2 text-right font-semibold tabular-nums">{p.summary.present}</td>
                  <td className="px-2 text-right tabular-nums">{p.summary.leave}</td>
                  <td className={cx("px-2 text-right tabular-nums", p.summary.absent && "font-semibold text-danger")}>{p.summary.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-subtle">P present (amber = late) · H half day · A absent · leave in blue (½ = half day) · purple H = holiday · grey = weekly off · — no record</p>
        </div>
      )}
    </Section>
  );
}

function Corrections() {
  const q = useHrQuery<{ requests: { id: string; name: string; date: string; checkIn: string; checkOut: string; reason: string; canDecide: boolean }[] }>("attendance/corrections");
  const act = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `corrections/${b.id}/decide`, body: { approve: b.approve } }), { success: "Done" });
  if (!q.data) return <Skeleton className="h-32 rounded-[20px]" />;
  if (!q.data.requests.length) return <Empty>No corrections waiting.</Empty>;
  return (
    <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 shadow-sm">
      {q.data.requests.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
          <Avatar name={r.name} size={32} />
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px]">{r.name}</b>
            <span className="text-[12.5px] text-muted">
              {fmt(r.date, { day: "numeric", month: "short" })} · {timeOf(r.checkIn)} – {timeOf(r.checkOut)} · “{r.reason}”
            </span>
          </span>
          {r.canDecide ? (
            <span className="flex gap-1.5">
              <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => act.mutate({ id: r.id, approve: true })}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" aria-label="Decline" icon={<X className="size-4" />} onClick={() => act.mutate({ id: r.id, approve: false })} />
            </span>
          ) : (
            <span className="text-[12px] text-muted">Waiting for your manager</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function MarkDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const mine = meta.people.filter((p) => p.status !== "exited" && (meta.me.manage || meta.me.reports.includes(p.id)));
  const [f, setF] = useState({ date: todayIst(), status: "present", note: "" });
  const [ids, setIds] = useState<Set<string>>(new Set());
  const save = useHrAction<void, { count: number }>(() => ({ path: "attendance/mark", body: { ...f, employeeIds: [...ids] } }), { success: (r) => `Marked ${r.count}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title="Mark attendance" description="For days people couldn't check in — field work, a lost phone, a site visit." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!ids.size} onClick={() => save.mutate()}>Mark {ids.size || ""}</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label="Day">{(a) => <Input {...a} type="date" max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="As">
            {(a) => (
              <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="present">Present</option>
                <option value="half_day">Half day</option>
                <option value="absent">Absent (loss of pay)</option>
              </Select>
            )}
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-[12.5px]">
            <span className="text-muted">{ids.size} chosen</span>
            <button type="button" className="font-medium underline" onClick={() => setIds(ids.size === mine.length ? new Set() : new Set(mine.map((p) => p.id)))}>
              {ids.size === mine.length ? "None" : "Everyone"}
            </button>
          </div>
          <ul className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {mine.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13px] hover:bg-surface-2">
                  <input type="checkbox" checked={ids.has(p.id)} onChange={(e) => setIds((s) => (e.target.checked ? new Set(s).add(p.id) : new Set([...s].filter((x) => x !== p.id))))} />
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <Input aria-label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Note (optional)" maxLength={200} />
      </div>
    </Dialog>
  );
}

function CorrectDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ date: todayIst(), in: "09:30", out: "18:30", reason: "" });
  const iso = (t: string) => new Date(`${f.date}T${t}:00+05:30`).toISOString();
  const save = useHrAction(() => ({ path: "attendance/correct", body: { date: f.date, checkIn: iso(f.in), checkOut: iso(f.out), reason: f.reason } }), { success: "Sent to your manager", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title="Correct a day" description="Forgot to check in or out? Your manager approves the times." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={f.reason.trim().length < 3} onClick={() => save.mutate()}>Send</Button></>}>
      <div className="grid gap-3">
        <Field label="Day">{(a) => <Input {...a} type="date" max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="In">{(a) => <Input {...a} type="time" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} />}</Field>
          <Field label="Out">{(a) => <Input {...a} type="time" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} />}</Field>
        </div>
        <Field label="What happened?">{(a) => <Textarea {...a} rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} placeholder="Phone battery died at the client site" />}</Field>
      </div>
    </Dialog>
  );
}
