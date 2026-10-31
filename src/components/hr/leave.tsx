"use client";

// Leave: requests to approve, everyone's requests, who's off when, holidays —
// and the apply dialog used everywhere.
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { eachDay, leaveDays, weekday } from "@/lib/hr/model";
import type { Balance } from "./me";
import { Avatar, Empty, Section, StatusPill, fmt, monthLabel, todayIst, useHr, useHrAction, useHrQuery } from "./shared";

type Req = { id: string; employeeId: string; name: string; type: string; code: string; color: string; fromDate: string; toDate: string; half: string; days: number; reason: string; status: string; decisionNote: string; createdAt: string; canDecide: boolean };

export function LeaveView() {
  const { meta } = useHr();
  const approver = meta.me.manage || meta.me.isManager;
  const [tab, setTab] = useState<"approve" | "all" | "calendar" | "holidays">(approver ? "approve" : "calendar");
  const [applying, setApplying] = useState(false);
  const [forSomeone, setForSomeone] = useState(false);
  const [closing, setClosing] = useState(false);
  const bal = useHrQuery<{ balances: Balance[] }>(meta.me.employeeId ? `people/${meta.me.employeeId}/balances` : null);
  const year = Number(todayIst().slice(0, 4));
  const close = useHrAction<void, { people: number; carried: number }>(() => ({ path: "leave/close-year", body: { year: year - 1 } }), { success: (r) => `Carried forward balances for ${r.people} people`, onDone: () => setClosing(false) });
  const tabs = [
    ...(approver ? [{ value: "approve" as const, label: "To approve" }] : []),
    { value: "all" as const, label: approver ? "All requests" : "My requests" },
    { value: "calendar" as const, label: "Who's off" },
    { value: "holidays" as const, label: "Holidays" },
  ];
  return (
    <div>
      <PageHeader
        title="Leave"
        description="Requests, approvals, the team calendar and holidays."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.manage && (
              <>
                <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setClosing(true)}>
                  Close {year - 1}
                </Button>
                <Button size="sm" onClick={() => setForSomeone(true)}>
                  Add for someone
                </Button>
              </>
            )}
            {meta.me.employeeId && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setApplying(true)}>
                Apply
              </Button>
            )}
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} className="mb-5" />
      {tab === "approve" && <LeaveList status="pending" decide />}
      {tab === "all" && <LeaveList mine={!approver} decide={approver} />}
      {tab === "calendar" && <LeaveCalendar />}
      {tab === "holidays" && <Holidays />}
      {applying && <ApplyLeaveDialog balances={bal.data?.balances ?? []} onClose={() => setApplying(false)} />}
      {forSomeone && <ApplyLeaveDialog balances={[]} forSomeone onClose={() => setForSomeone(false)} />}
      <ConfirmDialog open={closing} onClose={() => setClosing(false)} onConfirm={() => close.mutate()} loading={close.isPending} title={`Close leave year ${year - 1}?`} description={`What each person has left (up to each type's carry-forward limit) becomes their opening balance for ${year}. Safe to run again.`} confirmLabel="Carry forward" />
    </div>
  );
}

export function LeaveList({ status, mine, decide, compact }: { status?: string; mine?: boolean; decide?: boolean; compact?: boolean }) {
  const { meta } = useHr();
  const q = useHrQuery<{ requests: Req[] }>(`leave?${new URLSearchParams({ ...(status ? { status } : {}), ...(mine ? { mine: "1" } : {}) })}`);
  const act = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `leave/${b.id}/decide`, body: { approve: b.approve } }), { success: "Done" });
  const cancel = useHrAction<string>((id) => ({ path: `leave/${id}/cancel` }), { success: "Cancelled" });
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  const rows = q.data.requests;
  if (!rows.length) return <Empty>{status === "pending" ? "Nothing waiting for your OK." : "No leave requests yet."}</Empty>;
  return (
    <ul className={cx("divide-y divide-border", !compact && "rounded-[20px] border border-border bg-surface px-4 shadow-sm")}>
      {rows.slice(0, compact ? 6 : 200).map((r) => {
        const mineRow = r.employeeId === meta.me.employeeId;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            {!compact && <Avatar name={r.name} size={32} />}
            <span className="min-w-0 flex-1">
              {!compact && <b className="block text-[13.5px]">{r.name}</b>}
              <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                <span className="size-2 rounded-full" style={{ background: r.color }} />
                <b className="font-medium text-fg/80">{r.type}</b> · {r.days} day{r.days === 1 ? "" : "s"} · {fmt(r.fromDate, { day: "numeric", month: "short" })}
                {r.toDate !== r.fromDate ? ` – ${fmt(r.toDate, { day: "numeric", month: "short" })}` : r.half !== "none" ? ` (${r.half} half)` : ""}
                {r.reason && <span className="truncate"> · “{r.reason}”</span>}
              </span>
            </span>
            <StatusPill status={r.status} />
            {decide && r.canDecide && (
              <span className="flex gap-1.5">
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={act.isPending} onClick={() => act.mutate({ id: r.id, approve: true })}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" aria-label="Decline" icon={<X className="size-4" />} onClick={() => act.mutate({ id: r.id, approve: false })} />
              </span>
            )}
            {((mineRow && (r.status === "pending" || (r.status === "approved" && r.fromDate > todayIst()))) || (meta.me.manage && ["pending", "approved"].includes(r.status) && !r.canDecide)) && (
              <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                Cancel
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ApplyLeaveDialog({ balances, onClose, forSomeone }: { balances: Balance[]; onClose: () => void; forSomeone?: boolean }) {
  const { meta } = useHr();
  const types = meta.leaveTypes.filter((t) => t.active);
  const [f, setF] = useState({ employeeId: "", leaveTypeId: types[0]?.id ?? "", fromDate: todayIst(), toDate: todayIst(), half: "none", reason: "" });
  const t = types.find((x) => x.id === f.leaveTypeId);
  const b = balances.find((x) => x.typeId === f.leaveTypeId);
  const single = f.fromDate === f.toDate;
  // A preview of the days (weekly offs excluded; holidays are checked when you submit).
  const days = useMemo(() => (f.fromDate && f.toDate && f.toDate >= f.fromDate ? leaveDays(f.fromDate, f.toDate, single ? f.half : "none", meta.settings.workWeek, new Set()) : 0), [f.fromDate, f.toDate, f.half, single, meta.settings.workWeek]);
  const left = b && !b.unlimited ? (b.available ?? 0) - b.pending : null;
  const save = useHrAction(() => ({ path: "leave", body: { ...f, half: single ? f.half : "none", ...(forSomeone ? { employeeId: f.employeeId } : {}) } }), { success: forSomeone ? "Leave added" : "Request sent — your manager has been told", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={forSomeone ? "Add leave for someone" : "Apply for leave"}
      description={forSomeone ? "It's approved straight away." : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.leaveTypeId || !days || (forSomeone && !f.employeeId)} onClick={() => save.mutate()}>
            {forSomeone ? "Add leave" : `Request ${days || ""} day${days === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {forSomeone && (
          <Field label="Person" className="sm:col-span-2">
            {(a) => (
              <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
                <option value="">Choose…</option>
                {meta.people
                  .filter((p) => p.status !== "exited")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Type" className="sm:col-span-2">
          {(a) => (
            <Select {...a} value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}>
              {types.map((x) => {
                const bb = balances.find((y) => y.typeId === x.id);
                return (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {bb && !bb.unlimited ? ` — ${bb.available} left` : !x.paid ? " — unpaid" : ""}
                  </option>
                );
              })}
            </Select>
          )}
        </Field>
        <Field label="From">{(a) => <Input {...a} type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" value={f.toDate} min={f.fromDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />}</Field>
        {single && t?.allowHalf && (
          <div className="flex gap-1.5 sm:col-span-2">
            {[
              ["none", "Full day"],
              ["first", "First half"],
              ["second", "Second half"],
            ].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={f.half === v} onClick={() => setF({ ...f, half: v })} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-medium", f.half === v ? "border-fg bg-fg text-bg" : "border-border")}>
                {l}
              </button>
            ))}
          </div>
        )}
        <Field label="Reason (optional)" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} />}</Field>
        <p className={cx("rounded-[12px] px-3 py-2 text-[12.5px] sm:col-span-2", left !== null && days > left ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>
          {days ? `${days} working day${days === 1 ? "" : "s"}` : "No working days in these dates"}
          {left !== null ? ` · ${left} left${days > left ? " — not enough" : ""}` : t && !t.paid ? " · unpaid (taken from salary)" : ""}
        </p>
      </div>
    </Dialog>
  );
}

function LeaveCalendar() {
  const { meta } = useHr();
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const days = eachDay(`${month}-01`, `${month}-${String(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`);
  const q = useHrQuery<{ leaves: { id: string; employeeId: string; name: string; fromDate: string; toDate: string; half: string; status: string; code: string; color: string }[]; holidays: { date: string; name: string; optional: boolean }[] }>(`leave/calendar?from=${days[0]}&to=${days[days.length - 1]}`, { keepPrevious: true });
  const shift = (n: number) => {
    const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const people = [...new Map((q.data?.leaves ?? []).map((l) => [l.employeeId, l.name])).entries()];
  return (
    <Section
      title={monthLabel(month)}
      action={
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous month" icon={<ChevronLeft className="size-4" />} onClick={() => shift(-1)} />
          <Button size="sm" variant="ghost" aria-label="Next month" icon={<ChevronRight className="size-4" />} onClick={() => shift(1)} />
        </span>
      }
    >
      {!q.data ? (
        <Skeleton className="h-40 rounded-[16px]" />
      ) : !people.length && !q.data.holidays.length ? (
        <Empty>No one is off this month.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-40 bg-surface pb-1 text-left text-[12px] font-medium text-muted">Person</th>
                {days.map((d) => (
                  <th key={d} className={cx("pb-1 text-center font-medium", !meta.settings.workWeek.includes(weekday(d)) ? "text-subtle" : "text-muted", d === todayIst() && "text-fg")}>
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.holidays.length > 0 && (
                <tr>
                  <td className="sticky left-0 z-10 bg-surface py-1 pr-2 text-[12px] text-muted">Holidays</td>
                  {days.map((d) => {
                    const h = q.data!.holidays.find((x) => String(x.date) === d);
                    return <td key={d} title={h?.name} className="p-0.5">{h && <span className="block h-6 rounded-[6px] bg-[#ede9fe]" />}</td>;
                  })}
                </tr>
              )}
              {people.map(([id, name]) => (
                <tr key={id}>
                  <td className="sticky left-0 z-10 truncate bg-surface py-1 pr-2 text-[12.5px] font-medium">{name}</td>
                  {days.map((d) => {
                    const l = q.data!.leaves.find((x) => x.employeeId === id && x.fromDate <= d && x.toDate >= d);
                    const off = !meta.settings.workWeek.includes(weekday(d));
                    return (
                      <td key={d} className="p-0.5" title={l ? `${l.code}${l.status === "pending" ? " (waiting)" : ""}` : undefined}>
                        {l && !off ? <span className={cx("grid h-6 place-items-center rounded-[6px] font-semibold text-white", l.status === "pending" && "opacity-50")} style={{ background: l.color }}>{l.half !== "none" ? "½" : l.code}</span> : <span className={cx("block h-6 rounded-[6px]", off ? "bg-surface-2" : "")} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-subtle">Faded = waiting for approval · grey = weekly off · purple = holiday</p>
        </div>
      )}
    </Section>
  );
}

function Holidays() {
  const { meta } = useHr();
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const q = useHrQuery<{ holidays: { id: string; date: string; name: string; optional: boolean }[] }>(`holidays?year=${year}`);
  const [f, setF] = useState({ date: "", name: "", optional: false });
  const add = useHrAction(() => ({ path: "holidays", body: f }), { success: "Holiday added", onDone: () => setF({ date: "", name: "", optional: false }) });
  const del = useHrAction<string>((id) => ({ path: `holidays/${id}`, method: "DELETE" }), { success: "Removed" });
  return (
    <Section
      title={`Holidays ${year}`}
      action={
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous year" icon={<ChevronLeft className="size-4" />} onClick={() => setYear(year - 1)} />
          <Button size="sm" variant="ghost" aria-label="Next year" icon={<ChevronRight className="size-4" />} onClick={() => setYear(year + 1)} />
        </span>
      }
    >
      {!q.data ? (
        <Skeleton className="h-32 rounded-[16px]" />
      ) : !q.data.holidays.length ? (
        <Empty>No holidays added for {year}.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
              <CalendarDays className="size-4 text-muted" />
              <b className="flex-1 font-medium">
                {h.name}
                {h.optional && <span className="ml-2 text-[12px] font-normal text-muted">optional</span>}
              </b>
              <span className="text-muted">{fmt(h.date, { weekday: "short", day: "numeric", month: "short" })}</span>
              {meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${h.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(h.id)} />}
            </li>
          ))}
        </ul>
      )}
      {meta.me.manage && (
        <div className="mt-4 grid gap-2 sm:grid-cols-[160px_1fr_auto_auto] sm:items-center">
          <Input aria-label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Input aria-label="Holiday name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali" maxLength={80} />
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" checked={f.optional} onChange={(e) => setF({ ...f, optional: e.target.checked })} /> Optional
          </label>
          <Button variant="primary" loading={add.isPending} disabled={!f.date || !f.name.trim()} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      )}
    </Section>
  );
}
