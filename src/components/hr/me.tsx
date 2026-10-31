"use client";

// Me: your own HR — check in, leave balances and requests, this month's
// attendance, payslips, claims and contact details.
import { CalendarPlus, Clock, LogIn, LogOut, Pencil, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { ApplyLeaveDialog, LeaveList } from "./leave";
import { ClaimDialog, ClaimList } from "./payroll";
import { Empty, Section, StatusPill, fmt, hours, inr, monthLabel, timeOf, todayIst, useHr, useHrAction, useHrParts, useHrQuery } from "./shared";

export type Balance = { typeId: string; name: string; code: string; color: string; paid: boolean; available: number | null; used: number; pending: number; accrued: number; unlimited: boolean; allowHalf: boolean };
type Att = { checkIn: string | null; checkOut: string | null; minutes: number; status: string; late: boolean; source: string } | null;

/** Check in / out — the first thing on Home and Me. */
export function CheckInCard({ attendance }: { attendance: Att }) {
  const { meta } = useHr();
  const inn = useHrAction(() => ({ path: "attendance/check-in" }), { success: "Checked in — have a good day" });
  const out = useHrAction(() => ({ path: "attendance/check-out" }), { success: "Checked out" });
  const a = attendance;
  const self = meta.settings.attendance.selfCheckIn;
  const state = !a?.checkIn ? "out" : a.checkOut ? "done" : "in";
  return (
    <section className={cx("flex flex-wrap items-center gap-4 rounded-[22px] border p-5 shadow-sm", state === "in" ? "border-success/30 bg-success-soft/40" : "border-border bg-surface")}>
      <span className={cx("grid size-12 place-items-center rounded-[16px] [&_svg]:size-5", state === "in" ? "bg-success text-white" : "bg-surface-2 text-muted")}>
        <Clock />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold tracking-[0.1em] text-subtle uppercase">Today · {fmt(todayIst(), { weekday: "long", day: "numeric", month: "short" })}</p>
        <p className="text-[17px] font-semibold">
          {state === "out" ? "You haven't checked in yet" : state === "in" ? `In since ${timeOf(a!.checkIn)}${a!.late ? " · late" : ""}` : `${timeOf(a!.checkIn)} – ${timeOf(a!.checkOut)} · ${hours(a!.minutes)}`}
        </p>
        <p className="text-[12.5px] text-muted">
          Shift {meta.settings.shift.start}–{meta.settings.shift.end}
          {a?.source === "horeca" ? " · from the restaurant till" : ""}
        </p>
      </div>
      {self && state === "out" && (
        <Button variant="primary" icon={<LogIn className="size-4" />} loading={inn.isPending} onClick={() => inn.mutate()}>
          Check in
        </Button>
      )}
      {self && state === "in" && (
        <Button icon={<LogOut className="size-4" />} loading={out.isPending} onClick={() => out.mutate()}>
          Check out
        </Button>
      )}
      {!self && state === "out" && <span className="text-[12.5px] text-muted">HR marks attendance here.</span>}
    </section>
  );
}

export function Balances({ items, onApply }: { items: Balance[]; onApply?: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((b) => (
        <div key={b.typeId} className="rounded-[16px] border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <span className="size-2 rounded-full" style={{ background: b.color }} />
            {b.name}
          </p>
          <p className="mt-1 text-[22px] leading-none font-semibold tabular-nums">{b.unlimited ? "—" : b.available}</p>
          <p className="mt-1 text-[11px] text-subtle">{b.unlimited ? `${b.used} taken` : `of ${b.accrued} so far · ${b.used} taken${b.pending ? ` · ${b.pending} waiting` : ""}`}</p>
        </div>
      ))}
      {onApply && (
        <button type="button" onClick={onApply} className="grid place-items-center rounded-[16px] border border-dashed border-border p-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <span className="flex items-center gap-1.5">
            <CalendarPlus className="size-4" /> Apply for leave
          </span>
        </button>
      )}
    </div>
  );
}

export function MeView() {
  const { meta } = useHr();
  const part = useHrParts();
  const id = meta.me.employeeId;
  const month = todayIst().slice(0, 7);
  const profile = useHrQuery<{ employee: Record<string, unknown> & { name: string; designation: string; empNo: string; email: string; phone: string; personalEmail: string; address: string; emergency: { name?: string; phone?: string; relation?: string }; bank: { name?: string; account?: string; ifsc?: string }; joinDate: string; managerId: string | null } }>(id ? `people/${id}` : null);
  const home = useHrQuery<{ me: { attendance: Att } | null }>("home");
  const bal = useHrQuery<{ balances: Balance[] }>(id && part("leave") ? `people/${id}/balances` : null);
  const sheet = useHrQuery<{ days: { date: string; off: boolean; holiday: string | null }[]; people: { cells: string[]; summary: { present: number; late: number; absent: number; leave: number } }[] }>(id && part("attendance") ? `attendance/month?month=${month}&employeeId=${id}` : null);
  const slips = useHrQuery<{ payslips: { id: string; month: string; net: number; gross: number; status: string }[] }>(id && part("payroll") ? "payslips/mine" : null);
  const [applying, setApplying] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!id) return <Empty>Your account isn&apos;t linked to an employee record yet. Ask HR to link it.</Empty>;
  if (!profile.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const e = profile.data.employee;
  const row = sheet.data?.people[0];
  return (
    <div>
      <PageHeader
        title={`Hi, ${e.name.split(" ")[0]}`}
        description={`${e.designation || "Team member"} · ${e.empNo} · joined ${fmt(e.joinDate)}`}
        actions={
          <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
            My details
          </Button>
        }
      />
      <div className="grid gap-5">
        {part("attendance") && <CheckInCard attendance={home.data?.me?.attendance ?? null} />}
        {part("leave") && <Section title="Leave">{bal.data ? <Balances items={bal.data.balances} onApply={() => setApplying(true)} /> : <Skeleton className="h-24 rounded-[16px]" />}</Section>}
        <div className="grid gap-5 xl:grid-cols-2">
          {part("attendance") && <Section title={`Attendance · ${monthLabel(month)}`}>
            {!sheet.data || !row ? (
              <Skeleton className="h-40 rounded-[16px]" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-4 text-[12.5px]">
                  <span>
                    <b className="tabular-nums">{row.summary.present}</b> present
                  </span>
                  <span>
                    <b className="tabular-nums">{row.summary.late}</b> late
                  </span>
                  <span>
                    <b className="tabular-nums">{row.summary.leave}</b> leave
                  </span>
                  <span>
                    <b className="tabular-nums">{row.summary.absent}</b> absent
                  </span>
                </div>
                <MiniMonth days={sheet.data.days} cells={row.cells} />
              </>
            )}
          </Section>}
          {part("leave") && <Section title="My leave requests" action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setApplying(true)}>Apply</Button>}>
            <LeaveList mine compact />
          </Section>}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          {part("payroll") && <Section title="Payslips">
            {!slips.data?.payslips.length ? (
              <Empty>Your payslips appear here once payroll is run.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {slips.data.payslips.map((p) => (
                  <li key={p.id}>
                    <Link href={`/hr/payslips/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <span className="text-[13.5px] font-medium">{monthLabel(p.month)}</span>
                      <span className="flex items-center gap-3">
                        <b className="tabular-nums">{inr(p.net)}</b>
                        <StatusPill status={p.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>}
          {part("claims") && <Section title="Expense claims" action={<Button size="sm" variant="ghost" icon={<Receipt className="size-3.5" />} onClick={() => setClaiming(true)}>New claim</Button>}>
            <ClaimList mine compact />
          </Section>}
        </div>
      </div>
      {applying && <ApplyLeaveDialog balances={bal.data?.balances ?? []} onClose={() => setApplying(false)} />}
      {claiming && <ClaimDialog onClose={() => setClaiming(false)} />}
      {editing && <MyDetails employee={e} onClose={() => setEditing(false)} />}
    </div>
  );
}

const CODE_STYLE: Record<string, string> = { P: "bg-success-soft text-success", "P*": "bg-warning-soft text-warning", H: "bg-warning-soft text-warning", A: "bg-danger-soft text-danger", O: "bg-surface-2 text-subtle", HO: "bg-[#ede9fe] text-[#5b21b6]", "—": "bg-surface-2 text-subtle", "": "" };
export const cellStyle = (c: string) => (c.startsWith("L:") || c.startsWith("½L") ? "bg-[#e0f2fe] text-[#075985]" : (CODE_STYLE[c] ?? ""));
export const cellLabel = (c: string) => (c === "P*" ? "P" : c.startsWith("L:") ? c.slice(2) : c.startsWith("½L") ? "½" : c === "O" ? "" : c === "HO" ? "H" : c);

function MiniMonth({ days, cells }: { days: { date: string; off: boolean; holiday: string | null }[]; cells: string[] }) {
  const lead = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10.5px] text-subtle">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {days.map((d, i) => (
          <span key={d.date} title={`${fmt(d.date)}${d.holiday ? ` · ${d.holiday}` : ""} · ${cells[i] || "—"}`} className={cx("grid h-10 place-items-center rounded-[10px] text-[11px] font-semibold", cellStyle(cells[i]), d.date === todayIst() && "ring-2 ring-fg/40")}>
            <span className="text-[10px] font-normal opacity-70">{Number(d.date.slice(8))}</span>
            {cellLabel(cells[i]) && <span className="-mt-1">{cellLabel(cells[i])}</span>}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-subtle">P present (amber if late) · H half day · A absent · blue = leave (½ for half) · purple H = holiday</p>
    </div>
  );
}

function MyDetails({ employee: e, onClose }: { employee: { id?: unknown; phone: string; personalEmail: string; address: string; emergency: { name?: string; phone?: string; relation?: string }; bank: { name?: string; account?: string; ifsc?: string } }; onClose: () => void }) {
  const { meta } = useHr();
  const [f, setF] = useState({ phone: e.phone, personalEmail: e.personalEmail, address: e.address, emergency: { name: e.emergency?.name ?? "", phone: e.emergency?.phone ?? "", relation: e.emergency?.relation ?? "" }, bank: { name: e.bank?.name ?? "", account: e.bank?.account ?? "", ifsc: e.bank?.ifsc ?? "" } });
  const save = useHrAction(() => ({ path: `people/${meta.me.employeeId}`, method: "PUT", body: f }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title="My details" description="Keep these up to date — HR uses your bank details for salary." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} maxLength={30} />}</Field>
        <Field label="Personal email">{(a) => <Input {...a} type="email" value={f.personalEmail} onChange={(x) => setF({ ...f, personalEmail: x.target.value })} maxLength={200} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.address} onChange={(x) => setF({ ...f, address: x.target.value })} maxLength={400} />}</Field>
        <Field label="Emergency contact">{(a) => <Input {...a} value={f.emergency.name} onChange={(x) => setF({ ...f, emergency: { ...f.emergency, name: x.target.value } })} placeholder="Name" />}</Field>
        <Field label="Their phone">{(a) => <Input {...a} value={f.emergency.phone} onChange={(x) => setF({ ...f, emergency: { ...f.emergency, phone: x.target.value } })} />}</Field>
        <Field label="Bank account name">{(a) => <Input {...a} value={f.bank.name} onChange={(x) => setF({ ...f, bank: { ...f.bank, name: x.target.value } })} />}</Field>
        <Field label="Account number">{(a) => <Input {...a} inputMode="numeric" value={f.bank.account} onChange={(x) => setF({ ...f, bank: { ...f.bank, account: x.target.value.replace(/\s/g, "") } })} />}</Field>
        <Field label="IFSC">{(a) => <Input {...a} value={f.bank.ifsc} onChange={(x) => setF({ ...f, bank: { ...f.bank, ifsc: x.target.value.toUpperCase() } })} maxLength={11} />}</Field>
      </div>
    </Dialog>
  );
}
