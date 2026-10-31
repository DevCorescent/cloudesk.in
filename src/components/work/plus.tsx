"use client";

// Projects+: a project's schedule (Gantt with the critical path and what each
// task waits on), its expenses, its risks, change requests and documents, and
// the team's bookings against their capacity.
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarRange, ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { EXPENSE_CATEGORIES } from "@/lib/work/model";
import { Avatar, Bar, Empty, Section, Stat, StatusPill, addDays, fmt, fromPaise, inr, pct, todayIst, toPaise, useWork, useWorkAction, useWorkQuery, workApi, type Project } from "./shared";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const dm = (d: string | null) => fmt(d, { day: "numeric", month: "short" });

// ── Schedule ────────────────────────────────────────────────────────────────

type SchedTask = { id: string; number: number; title: string; status: string; startDate: string | null; dueDate: string | null; assigneeId: string | null; parentId: string | null; estimateHours: number };
type Link = { id: string; fromId: string; toId: string; type: "FS" | "SS"; lagDays: number };
type Schedule = { project: { startDate: string | null; dueDate: string | null }; tasks: SchedTask[]; links: Link[]; critical: string[]; finish: string | null; late: boolean; conflicts: string[] };

export function ScheduleView({ projectId }: { projectId: string }) {
  const { meta } = useWork();
  const q = useWorkQuery<Schedule>(`projects/${projectId}/schedule`);
  const [linking, setLinking] = useState(false);
  const fix = useWorkAction<void, { moved: unknown[] }>(() => ({ path: `projects/${projectId}/reschedule` }), { success: (r) => (r.moved.length ? `Moved ${r.moved.length} task${r.moved.length === 1 ? "" : "s"}` : "Already in order") });
  const unlink = useWorkAction<string>((id) => ({ path: `links/${id}`, method: "DELETE" }), { success: "Link removed" });
  if (!q.data) return <Skeleton className="h-80 rounded-[24px]" />;
  const d = q.data;
  const dated = d.tasks.filter((t) => t.startDate || t.dueDate);
  const name = (id: string) => {
    const t = d.tasks.find((x) => x.id === id);
    return t ? `#${t.number} ${t.title}` : "—";
  };
  return (
    <div className="grid gap-5">
      {d.conflicts.length > 0 && (
        <Notice tone="warning" title={`${d.conflicts.length} task${d.conflicts.length === 1 ? " starts" : "s start"} before what ${d.conflicts.length === 1 ? "it waits" : "they wait"} on allows`} action={meta.me.write ? <Button size="sm" loading={fix.isPending} onClick={() => fix.mutate()}>Push them later</Button> : undefined}>
          Pushing keeps each task&apos;s length and moves the tasks after it too. Nothing is moved earlier.
        </Notice>
      )}
      {d.late && <Notice tone="danger" title="The schedule runs past the due date">The last task finishes {dm(d.finish)}, after the project is due {dm(d.project.dueDate)}. Shorten tasks on the critical path or raise a change request.</Notice>}
      <Section
        title="Schedule"
        action={
          <span className="flex items-center gap-3 text-[12px] text-muted">
            <span className="flex items-center gap-1.5"><i className="block h-2 w-4 rounded-full bg-danger" />Critical path</span>
            <span className="flex items-center gap-1.5"><i className="block h-2 w-4 rounded-full bg-accent" />Has slack</span>
            {d.finish && <span>Finishes <b className="text-fg">{dm(d.finish)}</b></span>}
          </span>
        }
      >
        {!dated.length ? <Empty>Give tasks a start and due date to see them on the chart.</Empty> : <Gantt tasks={dated} links={d.links} critical={d.critical} conflicts={d.conflicts} due={d.project.dueDate} />}
      </Section>
      <Section title="What waits on what" action={meta.me.write && d.tasks.length > 1 ? <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => setLinking(true)}>Link tasks</Button> : undefined}>
        {!d.links.length ? (
          <Empty>Link tasks so one starts when another finishes. The critical path is the chain with no room to slip.</Empty>
        ) : (
          <ul className="divide-y divide-border text-[13px]">
            {d.links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{name(l.toId)}</span>
                <span className="text-muted">{l.type === "FS" ? "starts after" : "starts with"}</span>
                <span className="min-w-0 flex-1 truncate">{name(l.fromId)}{l.lagDays ? <span className="text-muted"> {l.lagDays > 0 ? "+" : ""}{l.lagDays}d</span> : null}</span>
                {meta.me.write && <Button size="sm" variant="ghost" aria-label={`Unlink ${name(l.toId)}`} icon={<Trash2 className="size-3.5" />} onClick={() => unlink.mutate(l.id)} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {linking && <LinkDialog tasks={d.tasks} onClose={() => setLinking(false)} />}
    </div>
  );
}

function Gantt({ tasks, links, critical, conflicts, due }: { tasks: SchedTask[]; links: Link[]; critical: string[]; conflicts: string[]; due: string | null }) {
  const { start, span, ticks } = useMemo(() => {
    const all = tasks.flatMap((t) => [t.startDate ?? t.dueDate!, t.dueDate ?? t.startDate!]).concat(due ? [due] : []);
    const lo = all.reduce((a, b) => (a < b ? a : b));
    const hi = all.reduce((a, b) => (a > b ? a : b));
    const span = day(hi) - day(lo) + 1;
    const step = span > 120 ? 28 : span > 40 ? 7 : span > 14 ? 3 : 1;
    const ticks: string[] = [];
    for (let i = 0; i < span; i += step) ticks.push(addDays(lo, i));
    return { start: lo, span, ticks };
  }, [tasks, due]);
  const at = (d: string) => ((day(d) - day(start)) / span) * 100;
  const waits = (id: string) => links.filter((l) => l.toId === id).length;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <div className="min-w-[720px]" role="table" aria-label="Gantt chart">
        <div className="grid grid-cols-[220px_1fr] border-b border-border pb-1 text-[11px] text-muted" role="row">
          <span role="columnheader">Task</span>
          <span className="relative h-4" role="columnheader">
            {ticks.map((t) => (
              <span key={t} className="absolute whitespace-nowrap" style={{ left: `${at(t)}%` }}>{dm(t)}</span>
            ))}
          </span>
        </div>
        {tasks.map((t) => {
          const s = t.startDate ?? t.dueDate!;
          const e = t.dueDate ?? t.startDate!;
          const crit = critical.includes(t.id);
          return (
            <div key={t.id} role="row" className="grid grid-cols-[220px_1fr] items-center border-b border-border/60 py-1.5 text-[12.5px]">
              <span role="cell" className={cx("truncate pr-3", t.parentId && "pl-4 text-muted")}>
                <span className="text-muted tabular-nums">#{t.number}</span> {t.title}
                {conflicts.includes(t.id) && <AlertTriangle aria-label="Starts too early" className="ml-1 inline size-3.5 text-warning" />}
              </span>
              <span role="cell" className="relative h-5" title={`${dm(s)} – ${dm(e)}${waits(t.id) ? ` · waits on ${waits(t.id)}` : ""}`}>
                {ticks.map((x) => <i key={x} className="absolute inset-y-0 border-l border-border/50" style={{ left: `${at(x)}%` }} />)}
                {due && <i className="absolute inset-y-[-6px] border-l-2 border-dashed border-danger/60" style={{ left: `${at(due) + 100 / span}%` }} />}
                <span
                  aria-label={`${t.title}: ${dm(s)} to ${dm(e)}${crit ? ", critical" : ""}`}
                  className={cx("absolute top-0.5 h-4 rounded-full", t.status === "done" ? "bg-success/70" : crit ? "bg-danger" : "bg-accent")}
                  style={{ left: `${at(s)}%`, width: `max(6px, ${((day(e) - day(s) + 1) / span) * 100}%)` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkDialog({ tasks, onClose }: { tasks: SchedTask[]; onClose: () => void }) {
  const [toId, setTo] = useState(tasks[1]?.id ?? "");
  const [fromId, setFrom] = useState(tasks[0]?.id ?? "");
  const [type, setType] = useState<"FS" | "SS">("FS");
  const [lag, setLag] = useState("0");
  const save = useWorkAction<void>(() => ({ path: "links", body: { fromId, toId, type, lagDays: Number(lag) || 0 } }), { success: "Tasks linked", onDone: onClose });
  const opts = tasks.map((t) => <option key={t.id} value={t.id}>#{t.number} {t.title}</option>);
  return (
    <Dialog open onClose={onClose} title="Link tasks" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!fromId || !toId || fromId === toId} loading={save.isPending} onClick={() => save.mutate()}>Link</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="This task" className="sm:col-span-2">{(p) => <Select {...p} value={toId} onChange={(e) => setTo(e.target.value)}>{opts}</Select>}</Field>
        <Field label="Starts">{(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value as "FS" | "SS")}><option value="FS">After it finishes</option><option value="SS">When it starts</option></Select>}</Field>
        <Field label="Lag (days)" hint="Days to wait in between">{(p) => <Input {...p} inputMode="numeric" value={lag} onChange={(e) => setLag(e.target.value)} />}</Field>
        <Field label="Waits on" className="sm:col-span-2">{(p) => <Select {...p} value={fromId} onChange={(e) => setFrom(e.target.value)}>{opts}</Select>}</Field>
      </div>
    </Dialog>
  );
}

// ── Expenses ────────────────────────────────────────────────────────────────

type Expense = { id: string; date: string; category: string; description: string; vendor: string; amount: number; billable: boolean; markupPct: number; receiptLink: string; invoiceId: string | null; charge: number };

export function ExpensesView({ project }: { project: Project }) {
  const { meta, orgId } = useWork();
  const qc = useQueryClient();
  const q = useWorkQuery<{ expenses: Expense[]; totals: { spent: number; billable: number; toBill: number } }>(`projects/${project.id}/expenses`);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const del = useWorkAction<string>((id) => ({ path: `expenses/${id}`, method: "DELETE" }), { success: "Expense removed" });
  if (!q.data) return <Skeleton className="h-60 rounded-[24px]" />;
  const { expenses, totals } = q.data;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Spent" value={inr(totals.spent)} sub="counted in the project's cost" />
        {project.billing !== "none" && <Stat label="To re-charge" value={inr(totals.billable)} sub="billable, with markup" />}
        {project.billing !== "none" && <Stat label="Not invoiced yet" value={inr(totals.toBill)} sub="goes on the next invoice" />}
      </div>
      <Section
        title="Expenses"
        action={
          <span className="flex flex-wrap gap-2">
            <ExportMenu name={`${project.code}-expenses`} columns={[{ key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "vendor", label: "Vendor" }, { key: "amount", label: "Amount", money: true }, { key: "billable", label: "Billable" }, { key: "markupPct", label: "Markup %" }, { key: "charge", label: "Charge", money: true }, { key: "invoiced", label: "Invoiced" }, { key: "receiptLink", label: "Receipt link" }]} rows={expenses.map((e) => ({ ...e, billable: e.billable ? "yes" : "no", invoiced: e.invoiceId ? "yes" : "no" }))} />
            {meta.me.write && <ImportButton target={target("work.expenses")} onImport={(rows, mode) => api(workApi(orgId, "expenses/import"), { method: "POST", body: { rows, mode, projectId: project.id } })} onDone={() => qc.invalidateQueries({ queryKey: ["work", orgId] })} />}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Expense</Button>}
          </span>
        }
      >
        {!expenses.length ? (
          <Empty>Travel, software, printing, subcontractors — anything spent on this project. Billable ones go on its next invoice with your markup.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 text-right font-medium">Spent</th>
                  <th className="py-2 pr-3 text-right font-medium">Charge</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{dm(e.date)}</td>
                    <td className="max-w-[320px] py-2 pr-3">
                      <b className="block truncate font-medium">{e.category}{e.description ? `: ${e.description}` : ""}</b>
                      <span className="block truncate text-[12px] text-muted">
                        {e.vendor}
                        {e.receiptLink && <a href={e.receiptLink} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 underline">receipt<ExternalLink className="size-3" /></a>}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{inr(e.amount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.billable ? <>{inr(e.charge)}{e.markupPct ? <span className="block text-[11.5px] text-muted">+{e.markupPct}%</span> : null}</> : <span className="text-muted">not billable</span>}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {e.invoiceId ? <StatusPill status="billed" /> : meta.me.write && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>
                          <Button size="sm" variant="ghost" aria-label={`Remove ${e.category} expense`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(e.id)} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing && <ExpenseDialog projectId={project.id} e={editing === "new" ? undefined : editing} billable={project.billing !== "none"} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExpenseDialog({ projectId, e, billable: canBill, onClose }: { projectId: string; e?: Expense; billable: boolean; onClose: () => void }) {
  const [f, setF] = useState({ date: e?.date ?? todayIst(), category: e?.category ?? "Travel", description: e?.description ?? "", vendor: e?.vendor ?? "", amount: fromPaise(e?.amount), billable: e?.billable ?? canBill, markupPct: e?.markupPct ? String(e.markupPct) : "", receiptLink: e?.receiptLink ?? "" });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });
  const save = useWorkAction<void>(() => ({ path: e ? `expenses/${e.id}` : "expenses", method: e ? "PUT" : "POST", body: { ...f, projectId, amount: toPaise(f.amount), markupPct: Number(f.markupPct) || 0 } }), { success: "Expense saved", onDone: onClose });
  const charge = Math.round(toPaise(f.amount) * (1 + (Number(f.markupPct) || 0) / 100));
  return (
    <Dialog open onClose={onClose} title={e ? "Edit expense" : "New expense"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={toPaise(f.amount) <= 0} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={set("date")} />}</Field>
        <Field label="Amount (₹)">{(p) => <Input {...p} autoFocus inputMode="decimal" value={f.amount} onChange={set("amount")} />}</Field>
        <Field label="Category">{(p) => <Select {...p} value={f.category} onChange={set("category")}>{[...new Set([...EXPENSE_CATEGORIES, f.category])].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Vendor">{(p) => <Input {...p} value={f.vendor} onChange={set("vendor")} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={set("description")} placeholder="e.g. Flights to Pune for the workshop" />}</Field>
        <Field label="Receipt link" className="sm:col-span-2" hint="Where the receipt is kept (Drive, email)">{(p) => <Input {...p} value={f.receiptLink} onChange={set("receiptLink")} placeholder="https://" />}</Field>
        {canBill && (
          <>
            <div className="flex items-center sm:col-span-1"><Switch checked={f.billable} onChange={(v) => setF({ ...f, billable: v })} label="Bill it to the client" /></div>
            {f.billable && <Field label="Markup %" hint={toPaise(f.amount) ? `Charged ${inr(charge)}` : undefined}>{(p) => <Input {...p} inputMode="decimal" value={f.markupPct} onChange={set("markupPct")} placeholder="0" />}</Field>}
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Risks, changes & documents ──────────────────────────────────────────────

type Risk = { id: string; kind: "risk" | "issue"; title: string; probability: number; impact: number; ownerId: string | null; owner: string | null; mitigation: string; due: string | null; status: "open" | "watching" | "closed"; score: number; level: "low" | "medium" | "high"; overdue: boolean };
type Change = { id: string; number: string; title: string; description: string; hours: number; fee: number; days: number; status: "draft" | "pending" | "approved" | "rejected"; by: string | null; createdAt: string };
type Doc = { id: string; title: string; url: string; by: string | null; createdAt: string };
const LEVEL: Record<string, string> = { high: "bg-danger-soft text-danger", medium: "bg-warning-soft text-warning", low: "bg-surface-2 text-muted" };

export function ControlView({ project }: { project: Project }) {
  return (
    <div className="grid gap-5">
      <Risks project={project} />
      <Changes project={project} />
      <Docs projectId={project.id} />
    </div>
  );
}

function Risks({ project }: { project: Project }) {
  const { meta } = useWork();
  const q = useWorkQuery<{ risks: Risk[] }>(`projects/${project.id}/risks`);
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const rows = (q.data?.risks ?? []).filter((r) => showClosed || r.status !== "closed");
  return (
    <Section
      title="Risks & issues"
      action={
        <span className="flex flex-wrap items-center gap-2">
          <Switch checked={showClosed} onChange={setShowClosed} label="Show closed" />
          <ExportMenu name={`${project.code}-risks`} columns={[{ key: "kind", label: "Kind" }, { key: "title", label: "Title" }, { key: "probability", label: "Probability" }, { key: "impact", label: "Impact" }, { key: "score", label: "Score" }, { key: "level", label: "Level" }, { key: "owner", label: "Owner" }, { key: "mitigation", label: "Mitigation" }, { key: "due", label: "Due" }, { key: "status", label: "Status" }]} rows={(q.data?.risks ?? []).map((r) => ({ ...r, owner: r.owner ?? "" }))} />
          {meta.me.write && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Risk or issue</Button>}
        </span>
      }
    >
      {!q.data ? (
        <Skeleton className="h-32 rounded-[16px]" />
      ) : !rows.length ? (
        <Empty>Log what might go wrong (risks) and what has (issues), who owns each and what&apos;s being done. Scored by probability × impact.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" disabled={!meta.me.write} onClick={() => setEditing(r)} className="flex w-full items-center gap-3 py-2.5 text-left text-[13px] disabled:cursor-default">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-[10px] text-[12px] font-bold tabular-nums", LEVEL[r.level])} title={`${r.probability} × ${r.impact}`}>{r.score}</span>
                <span className="min-w-0 flex-1">
                  <b className={cx("block truncate font-semibold", r.status === "closed" && "text-muted line-through")}>{r.title}</b>
                  <span className="block truncate text-[12px] text-muted">{r.kind === "issue" ? "Issue" : "Risk"} · {r.owner ?? "No owner"}{r.mitigation ? ` · ${r.mitigation}` : ""}</span>
                </span>
                {r.due && <span className={cx("text-[12px] tabular-nums", r.overdue ? "font-semibold text-danger" : "text-muted")}>{dm(r.due)}</span>}
                {r.status === "watching" && <StatusPill status="watching" label="Watching" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <RiskDialog projectId={project.id} r={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function RiskDialog({ projectId, r, onClose }: { projectId: string; r?: Risk; onClose: () => void }) {
  const { meta } = useWork();
  const [f, setF] = useState({ kind: r?.kind ?? "risk", title: r?.title ?? "", probability: r?.probability ?? 3, impact: r?.impact ?? 3, ownerId: r?.ownerId ?? "", mitigation: r?.mitigation ?? "", due: r?.due ?? "", status: r?.status ?? "open" });
  const save = useWorkAction<void>(() => ({ path: r ? `risks/${r.id}` : "risks", method: r ? "PUT" : "POST", body: { ...f, projectId, ownerId: f.ownerId || null, due: f.due || null } }), { success: "Saved", onDone: onClose });
  const del = useWorkAction<void>(() => ({ path: `risks/${r!.id}`, method: "DELETE" }), { success: "Removed", onDone: onClose });
  const scale = (label: string, k: "probability" | "impact") => (
    <Field label={label}>{(p) => <Select {...p} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {["Very low", "Low", "Medium", "High", "Very high"][n - 1]}</option>)}</Select>}</Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={r ? "Edit" : "New risk or issue"}
      footer={<>{r && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()} className="mr-auto">Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "risk" | "issue" })}><option value="risk">Risk — might happen</option><option value="issue">Issue — has happened</option></Select>}</Field>
        <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Risk["status"] })}><option value="open">Open</option><option value="watching">Watching</option><option value="closed">Closed</option></Select>}</Field>
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Client slow to give feedback" />}</Field>
        {scale("Probability", "probability")}
        {scale("Impact", "impact")}
        <Field label="Owner">{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Nobody yet</option>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Review by">{(p) => <Input {...p} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>
        <Field label="What's being done" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Changes({ project }: { project: Project }) {
  const { meta } = useWork();
  const q = useWorkQuery<{ changes: Change[] }>(`projects/${project.id}/changes`);
  const [editing, setEditing] = useState<Change | "new" | null>(null);
  const submit = useWorkAction<string, { status: string }>((id) => ({ path: `changes/${id}/submit` }), { success: (r) => (r.status === "approved" ? "Change approved — the project is updated" : "Sent for approval") });
  const decide = useWorkAction<{ id: string; approve: boolean }>((b) => ({ path: `changes/${b.id}/decide`, body: { approve: b.approve } }), { success: "Decided" });
  const del = useWorkAction<string>((id) => ({ path: `changes/${id}`, method: "DELETE" }), { success: "Removed" });
  const effect = (c: Change) =>
    [c.hours ? `${c.hours > 0 ? "+" : ""}${c.hours}h budget` : "", c.fee && meta.me.write ? `${c.fee > 0 ? "+" : "−"}${inr(Math.abs(c.fee))} fee` : "", c.days ? `${c.days > 0 ? "+" : ""}${c.days} days` : ""].filter(Boolean).join(" · ") || "No change to budget, fee or dates";
  return (
    <Section title="Change requests" action={meta.me.write ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Change request</Button> : undefined}>
      {!q.data ? (
        <Skeleton className="h-32 rounded-[16px]" />
      ) : !q.data.changes.length ? (
        <Empty>When the scope changes, raise a change request. Once approved it adds to the budget hours, the fee and the due date.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
              <span className="w-14 text-[12px] font-semibold text-muted tabular-nums">{c.number}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold">{c.title}</b>
                <span className="block truncate text-[12px] text-muted">{effect(c)}{c.by ? ` · by ${c.by}` : ""}</span>
              </span>
              <StatusPill status={c.status === "pending" ? "submitted" : c.status} />
              {meta.me.write && (c.status === "draft" || c.status === "rejected") && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${c.number}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(c.id)} />
                  <Button size="sm" icon={<ArrowRight className="size-3.5" />} loading={submit.isPending} onClick={() => submit.mutate(c.id)}>{meta.me.manage ? "Approve" : "Send"}</Button>
                </span>
              )}
              {meta.me.manage && c.status === "pending" && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: c.id, approve: false })}>Send back</Button>
                  <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: c.id, approve: true })}>Approve {c.number}</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ChangeDialog projectId={project.id} c={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function ChangeDialog({ projectId, c, onClose }: { projectId: string; c?: Change; onClose: () => void }) {
  const [f, setF] = useState({ title: c?.title ?? "", description: c?.description ?? "", hours: c?.hours ? String(c.hours) : "", fee: c?.fee ? String(c.fee / 100) : "", days: c?.days ? String(c.days) : "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useWorkAction<void>(() => ({ path: c ? `changes/${c.id}` : "changes", method: c ? "PUT" : "POST", body: { projectId, title: f.title, description: f.description, hours: Number(f.hours) || 0, fee: Math.round((Number(f.fee) || 0) * 100), days: Math.round(Number(f.days) || 0) } }), { success: "Saved as a draft", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={c ? `Edit ${c.number}` : "New change request"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What's changing" className="sm:col-span-3">{(p) => <Input {...p} autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Add a blog section" />}</Field>
        <Field label="Details" className="sm:col-span-3">{(p) => <Textarea {...p} rows={3} value={f.description} onChange={set("description")} />}</Field>
        <Field label="Budget hours" hint="+ or −">{(p) => <Input {...p} inputMode="decimal" value={f.hours} onChange={set("hours")} placeholder="0" />}</Field>
        <Field label="Fee (₹)" hint="+ or −">{(p) => <Input {...p} inputMode="decimal" value={f.fee} onChange={set("fee")} placeholder="0" />}</Field>
        <Field label="Due date moves (days)" hint="+ or −">{(p) => <Input {...p} inputMode="numeric" value={f.days} onChange={set("days")} placeholder="0" />}</Field>
      </div>
    </Dialog>
  );
}

function Docs({ projectId }: { projectId: string }) {
  const { meta } = useWork();
  const q = useWorkQuery<{ docs: Doc[] }>(`projects/${projectId}/docs`);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const add = useWorkAction<void>(() => ({ path: "docs", body: { projectId, title, url } }), { success: "Link added", onDone: () => (setTitle(""), setUrl("")) });
  const del = useWorkAction<string>((id) => ({ path: `docs/${id}`, method: "DELETE" }), { success: "Link removed" });
  return (
    <Section title="Documents">
      {q.data && !q.data.docs.length && <Empty>Keep links to the contract, brief and shared folders here.</Empty>}
      <ul className="divide-y divide-border">
        {q.data?.docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2 text-[13px]">
            <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline">{d.title}<ExternalLink className="ml-1 inline size-3" /></a>
            <span className="text-[12px] text-muted">{d.by}</span>
            {meta.me.write && <Button size="sm" variant="ghost" aria-label={`Remove ${d.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(d.id)} />}
          </li>
        ))}
      </ul>
      {meta.me.write && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input aria-label="Document name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Signed contract" className="h-8 !w-56 text-[13px]" />
          <Input aria-label="Document link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="h-8 min-w-0 flex-1 text-[13px]" />
          <Button size="sm" disabled={!title.trim() || !url.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add link</Button>
        </div>
      )}
    </Section>
  );
}

// ── Resources ───────────────────────────────────────────────────────────────

type Alloc = { id: string; projectId: string; userId: string; from: string; to: string; hoursPerDay: number; code: string; project: string; tint: string };
type Res = { from: string; to: string; people: { userId: string; name: string; capacity: number; booked: number; free: number; load: number | null; overWeeks: string[]; allocations: Alloc[] }[] };

export function ResourcesView() {
  const { meta } = useWork();
  const [from, setFrom] = useState(todayIst());
  const [weeks, setWeeks] = useState(4);
  const to = addDays(from, weeks * 7 - 1);
  const q = useWorkQuery<Res>(`resources?from=${from}&to=${to}`, { keepPrevious: true });
  const projects = useWorkQuery<{ projects: { id: string; code: string; name: string }[] }>("projects?status=open");
  const [editing, setEditing] = useState<Partial<Alloc> | null>(null);
  const del = useWorkAction<string>((id) => ({ path: `allocations/${id}`, method: "DELETE" }), { success: "Booking removed" });
  const rows = q.data?.people ?? [];
  const over = rows.filter((r) => r.overWeeks.length);
  return (
    <div>
      <PageHeader
        title="Resources"
        description="Who's booked on which project, against the hours they can work (working days less approved leave)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 !w-40 text-[13px]" />
            <Select aria-label="Weeks" value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))} className="h-8 !w-28 text-[13px]">
              {[2, 4, 8, 13].map((n) => <option key={n} value={n}>{n} weeks</option>)}
            </Select>
            <ExportMenu name="resources" columns={[{ key: "name", label: "Person" }, { key: "capacity", label: "Capacity (h)" }, { key: "booked", label: "Booked (h)" }, { key: "free", label: "Free (h)" }, { key: "load", label: "Load %" }, { key: "over", label: "Over-booked weeks" }]} rows={rows.map((r) => ({ ...r, load: r.load === null ? "" : Math.round(r.load * 100), over: r.overWeeks.join(", ") }))} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<CalendarRange className="size-3.5" />} onClick={() => setEditing({ from, to })}>Book someone</Button>}
          </div>
        }
      />
      {over.length > 0 && (
        <div className="mb-4">
          <Notice tone="warning" title={`${over.length} ${over.length === 1 ? "person is" : "people are"} booked past their capacity`}>{over.map((r) => `${r.name} (week of ${r.overWeeks.map((w) => dm(w)).join(", ")})`).join("; ")}</Notice>
        </div>
      )}
      {!q.data ? (
        <Skeleton className="h-80 rounded-[24px]" />
      ) : (
        <Section title={`${dm(q.data.from)} – ${dm(q.data.to)}`}>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.userId} className="py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={r.name} size={28} />
                  <b className="min-w-0 flex-1 truncate font-semibold">{r.name}</b>
                  <span className="text-[12px] text-muted tabular-nums">{r.booked}h of {r.capacity}h</span>
                  <span className={cx("w-24 text-right text-[12px] font-semibold tabular-nums", r.free < 0 ? "text-danger" : "text-muted")}>{r.free < 0 ? `${-r.free}h over` : `${r.free}h free`}</span>
                  <Bar value={r.load} className="w-28" />
                  <span className="w-10 text-right text-[12px] tabular-nums">{pct(r.load)}</span>
                </div>
                {r.allocations.length > 0 && (
                  <ul className="mt-2 grid gap-1 pl-10">
                    {r.allocations.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", `tint-${a.tint} tint-chip`)}>{a.code}</span>
                        <span className="min-w-0 flex-1 truncate">{a.project}</span>
                        <span className="text-muted tabular-nums">{dm(a.from)} – {dm(a.to)} · {a.hoursPerDay}h/day</span>
                        {meta.me.write && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                            <Button size="sm" variant="ghost" aria-label={`Remove ${r.name} from ${a.code}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(a.id)} />
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {editing && <AllocationDialog a={editing} projects={projects.data?.projects ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AllocationDialog({ a, projects, onClose }: { a: Partial<Alloc>; projects: { id: string; code: string; name: string }[]; onClose: () => void }) {
  const { meta } = useWork();
  const [f, setF] = useState({ projectId: a.projectId ?? projects[0]?.id ?? "", userId: a.userId ?? meta.people[0]?.id ?? "", from: a.from ?? todayIst(), to: a.to ?? addDays(todayIst(), 6), hoursPerDay: a.hoursPerDay ? String(a.hoursPerDay) : String(meta.settings.dailyHours) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // The project list may arrive after the dialog opens.
  const projectId = f.projectId || projects[0]?.id || "";
  const save = useWorkAction<void>(() => ({ path: a.id ? `allocations/${a.id}` : "allocations", method: a.id ? "PUT" : "POST", body: { ...f, projectId, hoursPerDay: Number(f.hoursPerDay) } }), { success: "Booked", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={a.id ? "Edit booking" : "Book someone on a project"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!projectId || !f.userId || !(Number(f.hoursPerDay) > 0)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Person">{(p) => <Select {...p} value={f.userId} onChange={set("userId")}>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Project">{(p) => <Select {...p} value={projectId} onChange={set("projectId")}>{projects.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}</Field>
        <Field label="From">{(p) => <Input {...p} type="date" value={f.from} onChange={set("from")} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={f.to} onChange={set("to")} />}</Field>
        <Field label="Hours a day" hint={`On working days; a full day is ${meta.settings.dailyHours}h`}>{(p) => <Input {...p} inputMode="decimal" value={f.hoursPerDay} onChange={set("hoursPerDay")} />}</Field>
      </div>
    </Dialog>
  );
}
