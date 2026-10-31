"use client";

// HR+: the weekly roster and shifts, overtime, full and final settlements,
// documents, training, grievance and disciplinary cases, and the workforce plan.
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { CASE_ACTIONS, DOC_KINDS, TRAINING_KINDS } from "@/lib/hr/model";
import { Empty, Section, Stat, fmt, fromPaise, hours, inr, toPaise, todayIst, useHr, useHrAction, useHrQuery } from "./shared";

// ── Roster ──────────────────────────────────────────────────────────────────

type Shift = { id: string; name: string; start: string; end: string; breakMinutes: number; graceMin: number; color: string; active: boolean };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export function RosterView() {
  const { meta } = useHr();
  const [from, setFrom] = useState(() => monday(todayIst()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const q = useHrQuery<{ roster: { employeeId: string; date: string; shiftId: string | null }[]; shifts: Shift[] }>(`roster?from=${from}&to=${days[6]}`, { keepPrevious: true });
  const set = useHrAction<{ employeeId: string; date: string; shiftId: string | null }[]>((entries) => ({ path: "roster", body: { entries } }));
  const copy = useHrAction<void, { copied: number }>(() => ({ path: "roster-copy", body: { from, days: 7, offset: 7 } }), { success: (r) => `${r.copied} shift${r.copied === 1 ? "" : "s"} copied to next week` });
  const [adding, setAdding] = useState(false);
  const me = meta.me;
  const people = meta.people.filter((p) => p.status !== "exited" && (me.manage || me.reports.includes(p.id) || p.id === me.employeeId));
  const at = (e: string, d: string) => q.data?.roster.find((r) => r.employeeId === e && r.date === d);
  const shifts = q.data?.shifts.filter((s) => s.active) ?? [];
  const canEdit = (id: string) => me.manage || me.reports.includes(id);
  return (
    <div>
      <PageHeader title="Roster" description="Who works which shift each day. Lateness is checked against the shift; time past it is overtime." actions={<div className="flex items-center gap-2"><Button size="sm" variant="ghost" aria-label="Previous week" icon={<ChevronLeft className="size-4" />} onClick={() => setFrom(addDays(from, -7))} /><span className="text-[13px] font-medium">{fmt(from, { day: "numeric", month: "short" })} – {fmt(days[6], { day: "numeric", month: "short" })}</span><Button size="sm" variant="ghost" aria-label="Next week" icon={<ChevronRight className="size-4" />} onClick={() => setFrom(addDays(from, 7))} />{me.manage && <><Button size="sm" onClick={() => copy.mutate()}>Copy to next week</Button><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Shift</Button></>}</div>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !shifts.length ? <EmptyState title="No shifts yet" description="Add the shifts people work — day, evening, night — then plan the week." action={me.manage ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add a shift</Button> : undefined} /> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead className="border-b border-border text-[12px] text-muted"><tr><th className="px-3 py-2 text-left font-medium">Person</th>{days.map((d) => <th key={d} className="px-1 py-2 font-medium">{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" })}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap">{p.name}</td>
                  {days.map((d) => {
                    const r = at(p.id, d);
                    const sh = shifts.find((x) => x.id === r?.shiftId);
                    return (
                      <td key={d} className="px-1 py-1">
                        <select aria-label={`${p.name} on ${d}`} disabled={!canEdit(p.id)} value={r ? (r.shiftId ?? "off") : ""} onChange={(e) => set.mutate([{ employeeId: p.id, date: d, shiftId: e.target.value === "off" ? null : e.target.value || null }])} className="h-8 w-full rounded-[8px] border border-border bg-surface px-1 text-[12px]" style={sh ? { borderColor: sh.color, color: sh.color } : undefined}>
                          <option value="">Usual</option>
                          <option value="off">Off</option>
                          {shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[12px] text-muted">&ldquo;Usual&rdquo; is the workspace&apos;s working week and hours ({meta.settings.shift.start}–{meta.settings.shift.end}). Shifts: {shifts.map((x) => `${x.name} ${x.start}–${x.end}`).join(" · ")}</p>
        </div>
      )}
      {adding && <ShiftDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ShiftDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", start: "09:00", end: "17:00", breakMinutes: "30", graceMin: "15", color: "#2a78d6" });
  const save = useHrAction(() => ({ path: "shifts", body: { ...f, breakMinutes: Number(f.breakMinutes) || 0, graceMin: Number(f.graceMin) || 0 } }), { success: "Shift added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="New shift" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-3">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="Night" />}</Field>
        <Field label="Starts">{(a) => <Input {...a} type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
        <Field label="Ends" hint="Past midnight is fine">{(a) => <Input {...a} type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
        <Field label="Break (min)">{(a) => <Input {...a} inputMode="numeric" value={f.breakMinutes} onChange={(e) => setF({ ...f, breakMinutes: e.target.value })} />}</Field>
        <Field label="Grace (min)">{(a) => <Input {...a} inputMode="numeric" value={f.graceMin} onChange={(e) => setF({ ...f, graceMin: e.target.value })} />}</Field>
        <Field label="Colour">{(a) => <Input {...a} type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Overtime ────────────────────────────────────────────────────────────────

type Ot = { id: string; employeeId: string; name: string; date: string; minutes: number; source: string; status: string; note: string; payrollRunId: string | null };

export function OvertimeView() {
  const { meta } = useHr();
  const [tab, setTab] = useState<"pending" | "">("pending");
  const q = useHrQuery<{ overtime: Ot[] }>(`overtime${tab ? `?status=${tab}` : ""}`, { keepPrevious: true });
  const decide = useHrAction<{ id: string; approve: boolean }>((b) => ({ path: `overtime/${b.id}/decide`, body: { approve: b.approve } }), { success: "Done" });
  const [adding, setAdding] = useState(false);
  const ot = meta.settings.overtime;
  return (
    <div>
      <PageHeader title="Overtime" description={ot?.enabled ? `Time past someone's shift (all of a day off), from ${ot.minMinutes} minutes, paid at ${ot.multiplier}× the hourly rate through payroll once approved.` : "Overtime is off — switch it on in Settings."} actions={(meta.me.manage || meta.me.isManager) && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Add overtime</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "pending", label: "To approve" }, { value: "", label: "All" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.overtime.length ? <Empty>Nothing here.</Empty> : (
        <ul className="divide-y divide-border rounded-[18px] border border-border bg-surface px-4 text-[13px]">
          {q.data.overtime.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span><b className="font-medium">{o.name}</b> <span className="text-muted">· {fmt(o.date)} · {hours(o.minutes)}{o.source === "manual" ? " · added by hand" : ""}{o.payrollRunId ? " · paid" : ""}</span></span>
              {o.status === "pending" && (meta.me.manage || meta.me.reports.includes(o.employeeId)) ? <span className="flex gap-2"><Button size="sm" onClick={() => decide.mutate({ id: o.id, approve: false })}>Reject</Button><Button size="sm" variant="primary" onClick={() => decide.mutate({ id: o.id, approve: true })}>Approve</Button></span> : <span className={cx("text-[12px] font-semibold", o.status === "approved" ? "text-success" : o.status === "rejected" ? "text-danger" : "text-warning")}>{o.status[0].toUpperCase() + o.status.slice(1)}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && <OtDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function OtDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const people = meta.people.filter((p) => p.status !== "exited" && (meta.me.manage || meta.me.reports.includes(p.id)));
  const [f, setF] = useState({ employeeId: people[0]?.id ?? "", date: todayIst(), hours: "", note: "" });
  const save = useHrAction(() => ({ path: "overtime", body: { employeeId: f.employeeId, date: f.date, minutes: Math.round((Number(f.hours) || 0) * 60), note: f.note } }), { success: "Overtime added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Add overtime" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.employeeId || !(Number(f.hours) > 0)} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Who">{(a) => <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <Field label="Day">{(a) => <Input {...a} type="date" max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Hours">{(a) => <Input {...a} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder="1.5" />}</Field>
        <Field label="Why" className="sm:col-span-3">{(a) => <Input {...a} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Full and final ──────────────────────────────────────────────────────────

type SLine = { code: string; label: string; kind: "earning" | "recovery"; amount: number; note: string };
type Settlement = { id: string; employeeId: string; name: string; empNo: string; lastDay: string; lines: SLine[]; earnings: number; recoveries: number; net: number; status: string; paidOn: string | null };

export function SettlementsView() {
  const { meta } = useHr();
  const q = useHrQuery<{ settlements: Settlement[] }>("settlements");
  const leaving = meta.people.filter((p) => p.status !== "active");
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const draft = useHrAction<string, { settlement: Settlement; assetsNotReturned: { name: string }[] }>((employeeId) => ({ path: "settlements", body: { employeeId } }), { success: (r) => (r.assetsNotReturned.length ? `Worked out — ${r.assetsNotReturned.length} asset(s) not returned: ${r.assetsNotReturned.map((a) => a.name).join(", ")}` : "Worked out"), onDone: (r) => setOpen(r.settlement.id) });
  const rows = q.data?.settlements ?? [];
  const current = rows.find((r) => r.id === open);
  return (
    <div>
      <PageHeader title="Full and final" description="What's owed to (and by) someone who's leaving: leave encashment, gratuity, notice not served, and anything else — approved, paid and posted. Their last month's salary is paid by payroll." actions={meta.me.payroll && leaving.length > 0 && <div className="flex gap-2"><Select aria-label="Person leaving" className="!w-56" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Someone leaving…</option>{leaving.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Button size="sm" variant="primary" disabled={!pick} loading={draft.isPending} onClick={() => draft.mutate(pick)}>Work it out</Button></div>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No settlements yet. Start someone&apos;s exit in People, then work out their settlement here.</Empty> : (
        <ul className="grid gap-2">
          {rows.map((r) => <li key={r.id}><button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center justify-between gap-3 rounded-[16px] border border-border bg-surface px-4 py-3 text-left text-[13px] hover:bg-surface-2"><span><b className="font-medium">{r.name}</b> <span className="text-muted">· last day {fmt(r.lastDay)}</span></span><span className="flex items-center gap-3"><b className="tabular-nums">{inr(r.net)}</b><span className="text-[12px] text-muted">{r.status.replace("_", " ")}</span></span></button></li>)}
        </ul>
      )}
      {current && <SettlementDialog key={current.id + current.status} s={current} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SettlementDialog({ s, onClose }: { s: Settlement; onClose: () => void }) {
  const [lines, setLines] = useState(s.lines.map((l) => ({ ...l, rupees: fromPaise(l.amount) })));
  const [pay, setPay] = useState({ accountId: "", date: todayIst() });
  const banks = useHrQuery<{ accounts: { id: string; name: string; subtype: string }[] }>(s.status === "approved" ? "bank-accounts" : null);
  const save = useHrAction(() => ({ path: `settlements/${s.id}`, method: "PUT", body: { lines: lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, amount: toPaise(l.rupees), note: l.note })) } }), { success: "Saved" });
  const submit = useHrAction<void, { status: string }>(() => ({ path: `settlements/${s.id}/submit` }), { success: (r) => (r.status === "approved" ? "Approved" : "Sent for approval"), onDone: onClose });
  const paid = useHrAction(() => ({ path: `settlements/${s.id}/pay`, body: pay }), { success: "Marked paid — posted to the books", onDone: onClose });
  const draft = s.status === "draft";
  const e = lines.filter((l) => l.kind === "earning").reduce((a, l) => a + toPaise(l.rupees), 0);
  const r = lines.filter((l) => l.kind === "recovery").reduce((a, l) => a + toPaise(l.rupees), 0);
  return (
    <Dialog open onClose={onClose} size="lg" title={`Full and final · ${s.name}`} description={`Last day ${fmt(s.lastDay)}`} footer={<>{draft ? <><Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button><Button variant="primary" loading={submit.isPending} onClick={() => save.mutateAsync(undefined).then(() => submit.mutate())}>Send for approval</Button></> : s.status === "approved" ? <Button variant="primary" disabled={!pay.accountId} loading={paid.isPending} onClick={() => paid.mutate(undefined)}>Mark paid</Button> : <Button onClick={onClose}>Close</Button>}</>}>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_120px_32px] items-center gap-2 text-[13px]">
            <span><Input aria-label="Line" value={l.label} disabled={!draft} onChange={(e2) => setLines(lines.map((x, j) => (j === i ? { ...x, label: e2.target.value } : x)))} />{l.note && <span className="mt-0.5 block text-[11.5px] text-muted">{l.note}</span>}</span>
            <Select aria-label="Kind" value={l.kind} disabled={!draft} onChange={(e2) => setLines(lines.map((x, j) => (j === i ? { ...x, kind: e2.target.value as SLine["kind"] } : x)))}><option value="earning">Pay them</option><option value="recovery">Recover</option></Select>
            <Input aria-label={`Amount for ${l.label}`} inputMode="decimal" value={l.rupees} disabled={!draft} onChange={(e2) => setLines(lines.map((x, j) => (j === i ? { ...x, rupees: e2.target.value } : x)))} />
            {draft && <Button size="sm" variant="ghost" aria-label="Remove line" icon={<Trash2 className="size-3.5" />} onClick={() => setLines(lines.filter((_, j) => j !== i))} />}
          </div>
        ))}
        {draft && <button type="button" className="justify-self-start text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setLines([...lines, { code: `X${lines.length}`, label: "", kind: "earning", amount: 0, note: "", rupees: "" }])}>+ Add a line (bonus, advance, asset not returned…)</button>}
        <dl className="mt-2 ml-auto grid w-64 gap-1 text-[13px]"><div className="flex justify-between"><dt className="text-muted">To pay</dt><dd className="tabular-nums">{inr(e)}</dd></div><div className="flex justify-between"><dt className="text-muted">To recover</dt><dd className="tabular-nums">−{inr(r)}</dd></div><div className="flex justify-between font-semibold"><dt>{e - r >= 0 ? "Net to pay" : "Net they owe"}</dt><dd className="tabular-nums">{inr(Math.abs(e - r))}</dd></div></dl>
        {s.status === "approved" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paid from">{(a) => <Select {...a} value={pay.accountId} onChange={(e2) => setPay({ ...pay, accountId: e2.target.value })}><option value="">Choose…</option>{(banks.data?.accounts ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            <Field label="On">{(a) => <Input {...a} type="date" value={pay.date} onChange={(e2) => setPay({ ...pay, date: e2.target.value })} />}</Field>
          </div>
        )}
        {s.status === "pending_approval" && <Notice title="Waiting for approval">It follows your approval rule for full and final settlements; decide it in My work.</Notice>}
      </div>
    </Dialog>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

type Doc = { id: string; employeeId: string; name: string; kind: keyof typeof DOC_KINDS; title: string; number: string; issuedOn: string | null; validTo: string | null; link: string; expired: boolean };

export function DocumentsView() {
  const { meta } = useHr();
  const [expiring, setExpiring] = useState(false);
  const q = useHrQuery<{ documents: Doc[] }>(`documents${expiring ? "?expiring=1" : ""}`, { keepPrevious: true });
  const [adding, setAdding] = useState(false);
  const del = useHrAction<string>((id) => ({ path: `documents/${id}`, method: "DELETE" }), { success: "Removed" });
  return (
    <div>
      <PageHeader title="Documents" description="Contracts, IDs, certificates and permits for each person, with when they expire." actions={<div className="flex items-center gap-3"><label className="flex items-center gap-2 text-[13px]"><Switch checked={expiring} onChange={setExpiring} label="Expiring in 30 days" /> Expiring soon</label>{meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Document</Button>}</div>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.documents.length ? <Empty>{expiring ? "Nothing expires in the next 30 days." : "No documents yet."}</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13px]">
            <tbody className="divide-y divide-border">
              {q.data.documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5"><b className="font-medium">{d.title}</b><span className="block text-[12px] text-muted">{DOC_KINDS[d.kind]}{d.number ? ` · ${d.number}` : ""}</span></td>
                  <td className="px-4 py-2.5">{d.name}</td>
                  <td className={cx("px-4 py-2.5", d.expired ? "font-medium text-danger" : d.validTo && d.validTo <= addDays(todayIst(), 30) ? "text-warning" : "text-muted")}>{d.validTo ? `${d.expired ? "Expired" : "Valid to"} ${fmt(d.validTo)}` : "No expiry"}</td>
                  <td className="px-4 py-2.5 text-right">{d.link && <a href={d.link} target="_blank" rel="noreferrer" className="mr-3 text-[12.5px] underline">Open</a>}{meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${d.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(d.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <DocDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function DocDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ employeeId: meta.people[0]?.id ?? "", kind: "contract", title: "", number: "", issuedOn: "", validTo: "", link: "" });
  const save = useHrAction(() => ({ path: "documents", body: { ...f, issuedOn: f.issuedOn || null, validTo: f.validTo || null } }), { success: "Added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Add a document" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.employeeId} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person">{(a) => <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>{meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <Field label="Kind">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(DOC_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} />}</Field>
        <Field label="Number">{(a) => <Input {...a} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} maxLength={60} />}</Field>
        <Field label="Issued">{(a) => <Input {...a} type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} />}</Field>
        <Field label="Valid to">{(a) => <Input {...a} type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />}</Field>
        <Field label="Link to the file" className="sm:col-span-2" hint="Where it's kept (Drive, SharePoint…) — files aren't stored in Cloudesk">{(a) => <Input {...a} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://" />}</Field>
      </div>
    </Dialog>
  );
}

// ── Training ────────────────────────────────────────────────────────────────

type Training = { id: string; title: string; kind: keyof typeof TRAINING_KINDS; provider: string; hours: number; costPerPerson: number; validMonths: number; mandatory: boolean; departmentIds: string[]; assigned: number; completed: number; missing: number; required: number };

export function TrainingView() {
  const { meta } = useHr();
  const q = useHrQuery<{ trainings: Training[] }>("trainings");
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState<Training | null>(null);
  return (
    <div>
      <PageHeader title="Training" description="Courses, certifications and mandatory training (with refreshers), who's done them and who still needs to." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Training</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.trainings.length ? <Empty>No training yet.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.trainings.map((t) => (
            <li key={t.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <span className="flex items-center justify-between gap-2"><b className="font-semibold">{t.title}</b><span className="text-[11.5px] text-muted">{TRAINING_KINDS[t.kind]}{t.mandatory ? " · mandatory" : ""}</span></span>
              <span className="mt-1 block text-[12.5px] text-muted">{[t.provider, t.hours ? `${t.hours} h` : "", t.costPerPerson ? `${inr(t.costPerPerson)} each` : "", t.validMonths ? `refresh every ${t.validMonths} months` : ""].filter(Boolean).join(" · ") || "—"}</span>
              <span className="mt-2 flex items-center justify-between text-[12.5px]"><span>{t.completed} done · {t.assigned} assigned{t.mandatory ? <span className={cx(" font-semibold", t.missing ? "text-danger" : "text-success")}> · {t.missing ? `${t.missing} of ${t.required} still need it` : "everyone covered"}</span> : null}</span>{(meta.me.manage || meta.me.isManager) && <Button size="sm" onClick={() => setRecording(t)}>Record</Button>}</span>
            </li>
          ))}
        </ul>
      )}
      {adding && <TrainingDialog onClose={() => setAdding(false)} />}
      {recording && <RecordDialog t={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

function TrainingDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ title: "", kind: "course", provider: "", hours: "", cost: "", validMonths: "", mandatory: false, departmentIds: [] as string[] });
  const save = useHrAction(() => ({ path: "trainings", body: { title: f.title, kind: f.kind, provider: f.provider, hours: Number(f.hours) || 0, costPerPerson: toPaise(f.cost), validMonths: Number(f.validMonths) || 0, mandatory: f.mandatory, departmentIds: f.departmentIds } }), { success: "Added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="New training" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder="Fire safety" />}</Field>
        <Field label="Kind">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(TRAINING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Provider">{(a) => <Input {...a} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />}</Field>
        <Field label="Hours">{(a) => <Input {...a} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}</Field>
        <Field label="Cost per person (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>
        <Field label="Refresh every (months)" hint="0: once is enough">{(a) => <Input {...a} inputMode="numeric" value={f.validMonths} onChange={(e) => setF({ ...f, validMonths: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.mandatory} onChange={(v) => setF({ ...f, mandatory: v })} label="Mandatory" /> Mandatory</label>
        {f.mandatory && meta.departments.length > 0 && <Field label="For departments" className="sm:col-span-2" hint="None picked: everyone">{() => <span className="flex flex-wrap gap-2">{meta.departments.map((d) => { const on = f.departmentIds.includes(d.id); return <button key={d.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, departmentIds: on ? f.departmentIds.filter((x) => x !== d.id) : [...f.departmentIds, d.id] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border")}>{d.name}</button>; })}</span>}</Field>}
      </div>
    </Dialog>
  );
}

function RecordDialog({ t, onClose }: { t: Training; onClose: () => void }) {
  const { meta } = useHr();
  const people = meta.people.filter((p) => p.status === "active" && (meta.me.manage || meta.me.reports.includes(p.id)));
  const [f, setF] = useState({ employeeIds: [] as string[], status: "completed", completedOn: todayIst(), due: "", score: "" });
  const save = useHrAction(() => ({ path: `trainings/${t.id}/record`, body: { employeeIds: f.employeeIds, status: f.status, completedOn: f.status === "completed" ? f.completedOn : null, due: f.due || null, score: f.score ? Number(f.score) : null } }), { success: "Recorded", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Record ${t.title}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.employeeIds.length} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{people.map((p) => { const on = f.employeeIds.includes(p.id); return <button key={p.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, employeeIds: on ? f.employeeIds.filter((x) => x !== p.id) : [...f.employeeIds, p.id] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border")}>{p.name}</button>; })}</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="What">{(a) => <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="completed">Completed</option><option value="assigned">Assign</option></Select>}</Field>
          {f.status === "completed" ? <><Field label="On">{(a) => <Input {...a} type="date" value={f.completedOn} onChange={(e) => setF({ ...f, completedOn: e.target.value })} />}</Field><Field label="Score %">{(a) => <Input {...a} inputMode="decimal" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />}</Field></> : <Field label="By">{(a) => <Input {...a} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>}
        </div>
      </div>
    </Dialog>
  );
}

// ── Cases ───────────────────────────────────────────────────────────────────

type Case = { id: string; number: string; kind: "grievance" | "disciplinary"; employeeId: string | null; name: string | null; anonymous: boolean; category: string; subject: string; description: string; status: string; assignedTo: string | null; action: keyof typeof CASE_ACTIONS; outcome: string; timeline: { at: string; by: string; note: string }[]; createdAt: string };

export function CasesView() {
  const { meta } = useHr();
  const [kind, setKind] = useState<"grievance" | "disciplinary">("grievance");
  const q = useHrQuery<{ cases: Case[] }>(`cases?kind=${kind}`, { keepPrevious: true });
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<Case | null>(null);
  return (
    <div>
      <PageHeader title="Grievances & discipline" description="Grievances are seen only by HR, the person who raised them and whoever investigates. Disciplinary cases are opened by HR." actions={(kind === "grievance" ? !!meta.me.employeeId || meta.me.manage : meta.me.manage) && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRaising(true)}>{kind === "grievance" ? "Raise a grievance" : "Open a case"}</Button>} />
      <Tabs value={kind} onChange={setKind} className="mb-4" tabs={[{ value: "grievance", label: "Grievances" }, { value: "disciplinary", label: "Disciplinary" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.cases.length ? <Empty>Nothing here.</Empty> : (
        <ul className="grid gap-2">
          {q.data.cases.map((c) => <li key={c.id}><button type="button" onClick={() => setOpen(c)} className="flex w-full items-center justify-between gap-3 rounded-[16px] border border-border bg-surface px-4 py-3 text-left text-[13px] hover:bg-surface-2"><span><b className="font-medium">{c.number} · {c.subject}</b><span className="block text-[12px] text-muted">{c.anonymous ? "Anonymous" : c.name ?? "—"}{c.category ? ` · ${c.category}` : ""} · {fmt(c.createdAt)}</span></span><span className="text-[12px] font-semibold text-muted">{c.status}</span></button></li>)}
        </ul>
      )}
      {raising && <CaseDialog kind={kind} onClose={() => setRaising(false)} />}
      {open && <CasePanel c={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CaseDialog({ kind, onClose }: { kind: "grievance" | "disciplinary"; onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ employeeId: "", anonymous: false, category: "", subject: "", description: "" });
  const save = useHrAction(() => ({ path: "cases", body: { kind, ...f, employeeId: f.employeeId || null } }), { success: "Opened", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={kind === "grievance" ? "Raise a grievance" : "Open a disciplinary case"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.subject.trim() || (kind === "disciplinary" && !f.employeeId)} onClick={() => save.mutate(undefined)}>Open</Button></>}>
      <div className="grid gap-4">
        {kind === "disciplinary" && <Field label="About">{(a) => <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>}
        <Field label="Subject">{(a) => <Input {...a} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={160} />}</Field>
        <Field label="Category">{(a) => <Input {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={60} placeholder={kind === "grievance" ? "Pay, workload, conduct…" : "Attendance, conduct…"} />}</Field>
        <Field label="What happened">{(a) => <Textarea {...a} rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} />}</Field>
        {kind === "grievance" && <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.anonymous} onChange={(v) => setF({ ...f, anonymous: v })} label="Anonymous" /> Hide my name from everyone but HR admins</label>}
      </div>
    </Dialog>
  );
}

function CasePanel({ c, onClose }: { c: Case; onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ status: c.status, action: c.action, outcome: c.outcome, note: "", assignedTo: c.assignedTo ?? "" });
  const save = useHrAction(() => ({ path: `cases/${c.id}`, method: "PUT", body: { ...(meta.me.manage || c.assignedTo === meta.me.userId ? { status: f.status, outcome: f.outcome, ...(c.kind === "disciplinary" ? { action: f.action } : {}) } : {}), ...(meta.me.manage ? { assignedTo: f.assignedTo || null } : {}), note: f.note } }), { success: "Saved", onDone: onClose });
  const runs = meta.me.manage || c.assignedTo === meta.me.userId;
  return (
    <Dialog open onClose={onClose} size="lg" title={`${c.number} · ${c.subject}`} description={c.description} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4">
        <ol className="grid gap-1.5 text-[12.5px]">{c.timeline.map((t, i) => <li key={i}><span className="text-muted">{new Date(t.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · </span>{t.note}</li>)}</ol>
        {runs && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status">{(a) => <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{["open", "investigating", "resolved", "closed"].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</Select>}</Field>
            {c.kind === "disciplinary" && <Field label="Action">{(a) => <Select {...a} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as Case["action"] })}>{Object.entries(CASE_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>}
            {meta.me.manage && <Field label="Investigated by">{(a) => <Select {...a} value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}><option value="">—</option>{meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>}
            <Field label="Outcome" className="sm:col-span-3">{(a) => <Textarea {...a} rows={2} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} maxLength={4000} />}</Field>
          </div>
        )}
        <Field label="Add a note">{(a) => <Textarea {...a} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Workforce plan ──────────────────────────────────────────────────────────

type Workforce = { positions: { id: string; title: string; departmentId: string | null; department: string; planned: number; filled: number; leaving: number; open: number; budgetCtc: number; plannedCtc: number; actualCtc: number; byDate: string | null; jobId: string | null }[]; departments: { id: string; name: string; planned: number; actual: number }[]; totals: { planned: number; actual: number; open: number; plannedCtc: number; actualCtc: number } };

export function WorkforceView() {
  const { go } = useHr();
  const q = useHrQuery<Workforce>("workforce");
  const [adding, setAdding] = useState(false);
  const hire = useHrAction<string>((id) => ({ path: `positions/${id}/hire` }), { success: "Hiring role opened", onDone: () => go("hiring") });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Workforce plan" description="The roles each department should have and their budget, against who's here now (people match by department and designation)." actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Position</Button>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Planned" value={d.totals.planned} sub={`${d.totals.actual} here now`} />
            <Stat label="Open places" value={d.totals.open} tone={d.totals.open ? "warn" : undefined} />
            <Stat label="Planned cost" value={inr(d.totals.plannedCtc)} sub="a year" />
            <Stat label="Cost now" value={inr(d.totals.actualCtc)} sub="a year, everyone" />
          </div>
          <Section title="Positions">
            {!d.positions.length ? <Empty>No positions planned.</Empty> : (
              <table className="w-full text-[13px]">
                <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Role</th><th className="py-1.5 font-medium">Planned</th><th className="py-1.5 font-medium">Here</th><th className="py-1.5 font-medium">Open</th><th className="py-1.5 font-medium">Budget</th><th className="py-1.5 font-medium">Actual</th><th className="w-28" /></tr></thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.positions.map((p) => <tr key={p.id}><td className="py-2 text-left">{p.title}<span className="block text-[12px] text-muted">{p.department}{p.byDate ? ` · by ${fmt(p.byDate)}` : ""}</span></td><td className="py-2">{p.planned}</td><td className="py-2">{p.filled}{p.leaving ? <span className="text-warning"> ({p.leaving} leaving)</span> : ""}</td><td className={cx("py-2 font-semibold", p.open && "text-warning")}>{p.open}</td><td className="py-2">{inr(p.plannedCtc)}</td><td className={cx("py-2", p.actualCtc > p.plannedCtc && "text-danger")}>{inr(p.actualCtc)}</td><td className="py-2">{p.open > 0 && !p.jobId && <Button size="sm" onClick={() => hire.mutate(p.id)}>Hire</Button>}</td></tr>)}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
      {adding && <PositionDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function PositionDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ departmentId: meta.departments[0]?.id ?? "", title: "", planned: "1", budget: "", byDate: "" });
  const save = useHrAction(() => ({ path: "positions", body: { departmentId: f.departmentId || null, title: f.title, planned: Number(f.planned) || 0, budgetCtc: toPaise(f.budget), byDate: f.byDate || null } }), { success: "Added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Plan a position" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role" hint="Matched to people's designation">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} />}</Field>
        <Field label="Department">{(a) => <Select {...a} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">None</option>{meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="How many">{(a) => <Input {...a} inputMode="numeric" value={f.planned} onChange={(e) => setF({ ...f, planned: e.target.value })} />}</Field>
        <Field label="Budget CTC each (₹ a year)">{(a) => <Input {...a} inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />}</Field>
        <Field label="By">{(a) => <Input {...a} type="date" value={f.byDate} onChange={(e) => setF({ ...f, byDate: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
