"use client";

// HR settings: company details (for payslips and letters), departments and
// locations, the work week and shift, leave types, payroll rules, joining and
// leaving checklists, letter templates, and the expense policy.
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { CLAIM_CATEGORIES, type HrSettings } from "@/lib/hr/model";
import { Section, useHr, useHrAction, type LeaveType } from "./shared";

const TABS = [
  { value: "company", label: "Company" },
  { value: "teams", label: "Teams & places" },
  { value: "time", label: "Work week & shift" },
  { value: "leave", label: "Leave types" },
  { value: "payroll", label: "Payroll" },
  { value: "expenses", label: "Expenses & travel" },
  { value: "checklists", label: "Checklists" },
  { value: "letters", label: "Letters" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function SettingsView({ tab }: { tab?: string }) {
  const { go } = useHr();
  const t = (TABS.some((x) => x.value === tab) ? tab : "company") as Tab;
  return (
    <div>
      <PageHeader title="HR settings" description="How HR and payroll work for your company." />
      <Tabs value={t} onChange={(v) => go(`settings/${v}`)} tabs={TABS.map((x) => ({ ...x }))} className="mb-5" />
      {t === "company" && <Company />}
      {t === "teams" && <Teams />}
      {t === "time" && <Time />}
      {t === "leave" && <LeaveTypes />}
      {t === "payroll" && <Payroll />}
      {t === "expenses" && <Expenses />}
      {t === "checklists" && <Checklists />}
      {t === "letters" && <Letters />}
    </div>
  );
}

function useSave() {
  return useHrAction<Partial<HrSettings>>((p) => ({ path: "settings", method: "PUT", body: p }), { success: "Saved" });
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-medium">{label}</b>
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Company() {
  const { meta } = useHr();
  const save = useSave();
  const [c, setC] = useState(meta.settings.company);
  return (
    <Section title="Company details" className="max-w-3xl">
      <p className="mb-4 text-[12.5px] text-muted">On payslips and letters.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name">{(a) => <Input {...a} value={c.legalName} onChange={(e) => setC({ ...c, legalName: e.target.value })} maxLength={160} />}</Field>
        <Field label="PAN">{(a) => <Input {...a} value={c.pan} onChange={(e) => setC({ ...c, pan: e.target.value.toUpperCase() })} maxLength={10} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} maxLength={400} />}</Field>
        <Field label="TAN (for TDS)">{(a) => <Input {...a} value={c.tan} onChange={(e) => setC({ ...c, tan: e.target.value.toUpperCase() })} maxLength={10} />}</Field>
        <Field label="PF establishment code">{(a) => <Input {...a} value={c.pfCode} onChange={(e) => setC({ ...c, pfCode: e.target.value })} maxLength={30} />}</Field>
        <Field label="ESI code">{(a) => <Input {...a} value={c.esiCode} onChange={(e) => setC({ ...c, esiCode: e.target.value })} maxLength={30} />}</Field>
        <div />
        <Field label="Letters signed by">{(a) => <Input {...a} value={c.signatory} onChange={(e) => setC({ ...c, signatory: e.target.value })} maxLength={80} />}</Field>
        <Field label="Their title">{(a) => <Input {...a} value={c.signatoryTitle} onChange={(e) => setC({ ...c, signatoryTitle: e.target.value })} maxLength={80} placeholder="Director" />}</Field>
      </div>
      <Button variant="primary" className="mt-4" loading={save.isPending} onClick={() => save.mutate({ company: c })}>
        Save
      </Button>
    </Section>
  );
}

function Teams() {
  const { meta } = useHr();
  const [dept, setDept] = useState("");
  const [loc, setLoc] = useState({ name: "", state: "MH" });
  const addD = useHrAction(() => ({ path: "departments", body: { name: dept } }), { success: "Added", onDone: () => setDept("") });
  const addL = useHrAction(() => ({ path: "locations", body: loc }), { success: "Added", onDone: () => setLoc({ name: "", state: loc.state }) });
  const delD = useHrAction<string>((id) => ({ path: `departments/${id}`, method: "DELETE" }), { success: "Removed" });
  const delL = useHrAction<string>((id) => ({ path: `locations/${id}`, method: "DELETE" }), { success: "Removed" });
  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <Section title="Departments">
        <ul className="mb-3 divide-y divide-border">
          {meta.departments.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-[13.5px]">
              <b className="flex-1 font-medium">{d.name}</b>
              <span className="text-[12px] text-muted">{d.people} people</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${d.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => delD.mutate(d.id)} />
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), dept.trim() && addD.mutate())}>
          <Input aria-label="Department name" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Sales" maxLength={80} />
          <Button type="submit" disabled={!dept.trim()}>
            Add
          </Button>
        </form>
      </Section>
      <Section title="Locations">
        <ul className="mb-3 divide-y divide-border">
          {meta.locations.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-[13.5px]">
              <b className="flex-1 font-medium">{l.name}</b>
              <span className="text-[12px] text-muted">{l.state || "—"}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${l.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => delL.mutate(l.id)} />
            </li>
          ))}
        </ul>
        <form className="grid grid-cols-[1fr_110px_auto] gap-2" onSubmit={(e) => (e.preventDefault(), loc.name.trim() && addL.mutate())}>
          <Input aria-label="Location name" value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} placeholder="Pune office" maxLength={80} />
          <Select aria-label="State" value={loc.state} onChange={(e) => setLoc({ ...loc, state: e.target.value })}>
            {meta.ptStates.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
            <option value="">Other</option>
          </Select>
          <Button type="submit" disabled={!loc.name.trim()}>
            Add
          </Button>
        </form>
        <p className="mt-2 text-[11.5px] text-subtle">The state decides professional tax for people based there.</p>
      </Section>
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function Time() {
  const { meta } = useHr();
  const save = useSave();
  const [w, setW] = useState(meta.settings.workWeek);
  const [s, setS] = useState(meta.settings.shift);
  const [a, setA] = useState(meta.settings.attendance);
  return (
    <div className="grid max-w-3xl gap-5">
      <Section title="Work week">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={w.includes(i)} onClick={() => setW(w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort())} className={cx("h-9 w-14 rounded-full border text-[13px] font-medium", w.includes(i) ? "border-fg bg-fg text-bg" : "border-border text-muted")}>
              {d}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Leave isn&apos;t counted on the other days.</p>
      </Section>
      <Section title="Shift">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts">{(x) => <Input {...x} type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} />}</Field>
          <Field label="Ends">{(x) => <Input {...x} type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} />}</Field>
          <Field label="Late after (minutes)">{(x) => <Input {...x} inputMode="numeric" value={String(s.graceMin)} onChange={(e) => setS({ ...s, graceMin: Number(e.target.value.replace(/\D/g, "")) || 0 })} />}</Field>
          <Field label="Full day (hours)">{(x) => <Input {...x} inputMode="decimal" value={String(s.fullDayHours)} onChange={(e) => setS({ ...s, fullDayHours: Number(e.target.value) || 8 })} />}</Field>
          <Field label="Half day (hours)">{(x) => <Input {...x} inputMode="decimal" value={String(s.halfDayHours)} onChange={(e) => setS({ ...s, halfDayHours: Number(e.target.value) || 4 })} />}</Field>
        </div>
      </Section>
      <Section title="Attendance">
        <Toggle checked={a.selfCheckIn} onChange={(v) => setA({ ...a, selfCheckIn: v })} label="People check themselves in" hint="From HR on their phone or computer." />
        <Toggle checked={a.horeca} onChange={(v) => setA({ ...a, horeca: v })} label="Restaurant till unlocks count" hint="For people linked to a Horeca till login." />
        <Toggle checked={a.absentIfNoCheckIn} onChange={(v) => setA({ ...a, absentIfNoCheckIn: v })} label="No check-in means absent" hint="Off by default — only days marked absent or unpaid leave cut pay." />
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate({ workWeek: w, shift: s, attendance: a })}>
        Save
      </Button>
    </div>
  );
}

function LeaveTypes() {
  const { meta } = useHr();
  const [edit, setEdit] = useState<Partial<LeaveType> | null>(null);
  return (
    <Section title="Leave types" className="max-w-3xl" action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>Type</Button>}>
      <ul className="divide-y divide-border">
        {meta.leaveTypes.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setEdit(t)} className={cx("flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80", !t.active && "opacity-50")}>
              <span className="size-3 rounded-full" style={{ background: t.color }} />
              <b className="flex-1 text-[13.5px] font-medium">
                {t.name} <span className="text-[12px] font-normal text-muted">{t.code}</span>
              </b>
              <span className="text-[12.5px] text-muted">{t.accrual === "none" ? "No limit" : `${t.quota} days a year, ${t.accrual === "monthly" ? "monthly" : "at the start"}`}{t.carryForward ? ` · carry ${t.carryForward}` : ""}{!t.paid ? " · unpaid" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {edit && <LeaveTypeDialog init={edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function LeaveTypeDialog({ init, onClose }: { init: Partial<LeaveType>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", code: init.code ?? "", quota: String(init.quota ?? 12), accrual: init.accrual ?? "yearly", carryForward: String(init.carryForward ?? 0), paid: init.paid ?? true, allowHalf: init.allowHalf ?? true, color: init.color ?? "#2a78d6", active: init.active ?? true });
  const save = useHrAction(() => ({ path: init.id ? `leave-types/${init.id}` : "leave-types", method: init.id ? "PUT" : "POST", body: { ...f, quota: Number(f.quota) || 0, carryForward: Number(f.carryForward) || 0 } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={init.id ? init.name! : "New leave type"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.code.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Maternity leave" maxLength={60} />}</Field>
        <Field label="Short code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={6} placeholder="ML" />}</Field>
        <Field label="How it builds up">
          {(a) => (
            <Select {...a} value={f.accrual} onChange={(e) => setF({ ...f, accrual: e.target.value })}>
              <option value="yearly">All at the start of the year</option>
              <option value="monthly">A twelfth each month</option>
              <option value="none">No limit (track only)</option>
            </Select>
          )}
        </Field>
        <Field label="Days a year">{(a) => <Input {...a} inputMode="decimal" disabled={f.accrual === "none"} value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} />}</Field>
        <Field label="Carry forward up to (days)">{(a) => <Input {...a} inputMode="decimal" value={f.carryForward} onChange={(e) => setF({ ...f, carryForward: e.target.value })} />}</Field>
        <Field label="Colour">{(a) => <Input {...a} type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="!h-9 !p-1" />}</Field>
        <div className="sm:col-span-2">
          <Toggle checked={f.paid} onChange={(v) => setF({ ...f, paid: v })} label="Paid" hint="Unpaid leave is deducted from salary." />
          <Toggle checked={f.allowHalf} onChange={(v) => setF({ ...f, allowHalf: v })} label="Half days allowed" />
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" />
        </div>
      </div>
    </Dialog>
  );
}

function Payroll() {
  const { meta } = useHr();
  const save = useSave();
  const [p, setP] = useState(meta.settings.payroll);
  const [ot, setOt] = useState(meta.settings.overtime);
  const [fs, setFs] = useState(meta.settings.settlement);
  return (
    <div className="grid max-w-3xl gap-5">
      <Section title="Salary structure">
        <p className="mb-3 text-[12.5px] text-muted">How CTC splits into components. Basic is a share of the monthly CTC; HRA a share of Basic; the rest is special allowance after employer PF (and ESI).</p>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Basic (% of CTC)">{(a) => <Input {...a} inputMode="decimal" value={String(p.basicPct)} onChange={(e) => setP({ ...p, basicPct: Number(e.target.value) || 50 })} />}</Field>
          <Field label="HRA (% of Basic)" hint="40% outside metro cities, 50% in them.">{(a) => <Input {...a} inputMode="decimal" value={String(p.hraPct)} onChange={(e) => setP({ ...p, hraPct: Number(e.target.value) || 0 })} />}</Field>
        </div>
      </Section>
      <Section title="Statutory deductions">
        <Toggle checked={p.pf} onChange={(v) => setP({ ...p, pf: v })} label="Provident fund" hint="12% from the employee and 12% from you, on Basic." />
        {p.pf && <Toggle checked={!p.pfOnFullBasic} onChange={(v) => setP({ ...p, pfOnFullBasic: !v })} label="Cap PF wages at ₹15,000" hint="The usual choice. Off = 12% of the full Basic." />}
        <Toggle checked={p.esi} onChange={(v) => setP({ ...p, esi: v })} label="ESI" hint="For gross up to ₹21,000 a month: 0.75% employee, 3.25% employer." />
        <Toggle checked={p.pt} onChange={(v) => setP({ ...p, pt: v })} label="Professional tax" hint="By the state of each person's location (or the default below)." />
        {p.pt && (
          <Field label="Default state">
            {(a) => (
              <Select {...a} value={p.ptState} onChange={(e) => setP({ ...p, ptState: e.target.value })} className="max-w-xs">
                {meta.ptStates.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
                <option value="">No professional tax</option>
              </Select>
            )}
          </Field>
        )}
        <Toggle checked={p.tds} onChange={(v) => setP({ ...p, tds: v })} label="Income tax (TDS) estimate" hint="New regime, spread evenly over the year. Doesn't know about other income or declarations — check with your accountant." />
      </Section>
      <Section title="Overtime">
        <Toggle checked={ot.enabled} onChange={(v) => setOt({ ...ot, enabled: v })} label="Pay overtime" hint="Time past someone's shift (all of a day off or holiday) is found at check-out and paid through payroll once approved." />
        {ot.enabled && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Rate (× hourly)" hint="The Factories Act's double rate is 2">{(a) => <Input {...a} inputMode="decimal" value={String(ot.multiplier)} onChange={(e) => setOt({ ...ot, multiplier: Number(e.target.value) || 1 })} />}</Field>
            <Field label="Counts from (minutes)">{(a) => <Input {...a} inputMode="numeric" value={String(ot.minMinutes)} onChange={(e) => setOt({ ...ot, minMinutes: Number(e.target.value) || 0 })} />}</Field>
            <Toggle checked={ot.requireApproval} onChange={(v) => setOt({ ...ot, requireApproval: v })} label="Needs approval" />
          </div>
        )}
        <p className="text-[12px] text-muted">Hourly rate = monthly Basic ÷ 26 days ÷ the full day&apos;s hours.</p>
      </Section>
      <Section title="Full and final">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Notice period (days)">{(a) => <Input {...a} inputMode="numeric" value={String(fs.noticeDays)} onChange={(e) => setFs({ ...fs, noticeDays: Number(e.target.value) || 0 })} />}</Field>
          <Field label="Gratuity after (years)" hint="5 under the Act">{(a) => <Input {...a} inputMode="decimal" value={String(fs.gratuityYears)} onChange={(e) => setFs({ ...fs, gratuityYears: Number(e.target.value) || 0 })} />}</Field>
          <Field label="Encash leave types" hint="Codes, like EL">{(a) => <Input {...a} value={fs.encashCodes.join(", ")} onChange={(e) => setFs({ ...fs, encashCodes: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 20) })} />}</Field>
        </div>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate({ payroll: p, overtime: ot, settlement: fs })}>
        Save
      </Button>
    </div>
  );
}

const rs = (p: number) => (p ? String(p / 100) : "");
const ps = (v: string) => Math.round((Number(v.replace(/[^\d.]/g, "")) || 0) * 100);

function Expenses() {
  const { meta } = useHr();
  const save = useSave();
  const [x, setX] = useState(meta.settings.expenses);
  const setLimit = (i: number, patch: Partial<HrSettings["expenses"]["limits"][number]>) => setX({ ...x, limits: x.limits.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const unused = CLAIM_CATEGORIES.filter((c) => !x.limits.some((l) => l.category === c) && !["Mileage", "Per diem"].includes(c));
  return (
    <div className="grid max-w-3xl gap-5">
      <Section title="Limits by category">
        <p className="mb-3 text-[12.5px] text-muted">Claims over a limit, or without a receipt above the amount set, need a reason the approver sees. Leave a box empty for no limit.</p>
        {x.limits.length > 0 && (
          <table className="mb-3 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="py-1.5 pr-2 font-medium">Category</th>
                <th className="py-1.5 pr-2 font-medium">Per claim (₹)</th>
                <th className="py-1.5 pr-2 font-medium">Per day (₹)</th>
                <th className="py-1.5 pr-2 font-medium">Receipt above (₹)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {x.limits.map((l, i) => (
                <tr key={l.category}>
                  <td className="py-1 pr-2 font-medium">{l.category}</td>
                  <td className="py-1 pr-2"><Input aria-label={`${l.category} limit per claim`} inputMode="decimal" value={rs(l.perClaim)} onChange={(e) => setLimit(i, { perClaim: ps(e.target.value) })} className="h-8" /></td>
                  <td className="py-1 pr-2"><Input aria-label={`${l.category} limit per day`} inputMode="decimal" value={rs(l.perDay)} onChange={(e) => setLimit(i, { perDay: ps(e.target.value) })} className="h-8" /></td>
                  <td className="py-1 pr-2"><Input aria-label={`${l.category} receipt above`} inputMode="decimal" value={rs(l.receiptAbove)} onChange={(e) => setLimit(i, { receiptAbove: ps(e.target.value) })} className="h-8" /></td>
                  <td className="py-1"><Button size="sm" variant="ghost" aria-label={`Remove ${l.category} limit`} icon={<X className="size-3.5" />} onClick={() => setX({ ...x, limits: x.limits.filter((_, j) => j !== i) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {unused.length > 0 && (
          <Select aria-label="Add a limit" value="" onChange={(e) => e.target.value && setX({ ...x, limits: [...x.limits, { category: e.target.value, perClaim: 0, perDay: 0, receiptAbove: 0 }] })} className="h-8 max-w-xs text-[13px]">
            <option value="">Add a limit for…</option>
            {unused.map((c) => <option key={c}>{c}</option>)}
          </Select>
        )}
        <Toggle checked={x.blockOverLimit} onChange={(v) => setX({ ...x, blockOverLimit: v })} label="Refuse claims over a limit" hint="Off: they can be sent with a reason, and are flagged for the approver." />
      </Section>
      <Section title="Mileage and per diem">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Car (₹ per km)">{(a) => <Input {...a} inputMode="decimal" value={rs(x.mileage.car)} onChange={(e) => setX({ ...x, mileage: { ...x.mileage, car: ps(e.target.value) } })} />}</Field>
          <Field label="Two-wheeler (₹ per km)">{(a) => <Input {...a} inputMode="decimal" value={rs(x.mileage.bike)} onChange={(e) => setX({ ...x, mileage: { ...x.mileage, bike: ps(e.target.value) } })} />}</Field>
          <Field label="Per diem in India (₹ a day)">{(a) => <Input {...a} inputMode="decimal" value={rs(x.perDiem.domestic)} onChange={(e) => setX({ ...x, perDiem: { ...x.perDiem, domestic: ps(e.target.value) } })} />}</Field>
          <Field label="Per diem abroad (₹ a day)">{(a) => <Input {...a} inputMode="decimal" value={rs(x.perDiem.international)} onChange={(e) => setX({ ...x, perDiem: { ...x.perDiem, international: ps(e.target.value) } })} />}</Field>
          <Field label="Trip numbers start with">{(a) => <Input {...a} value={x.tripPrefix} onChange={(e) => setX({ ...x, tripPrefix: e.target.value })} />}</Field>
        </div>
        <p className="text-[12px] text-muted">Empty rates mean mileage or per diem can&apos;t be claimed. Per diem counts the day of departure and the day back.</p>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate({ expenses: x })}>
        Save
      </Button>
    </div>
  );
}

function Checklists() {
  const { meta } = useHr();
  const save = useSave();
  const [on, setOn] = useState(meta.settings.onboarding);
  const [off, setOff] = useState(meta.settings.offboarding);
  const list = (title: string, items: typeof on, set: (v: typeof on) => void) => (
    <Section title={title}>
      <ul className="grid gap-2">
        {items.map((it, i) => (
          <li key={i} className="grid grid-cols-[1fr_120px_32px] gap-2">
            <Input aria-label="Step" value={it.title} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} maxLength={120} />
            <Select aria-label="Who" value={it.owner} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, owner: e.target.value as typeof it.owner } : x)))}>
              <option value="hr">HR</option>
              <option value="manager">Manager</option>
              <option value="employee">Them</option>
              <option value="it">IT</option>
            </Select>
            <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-4" />} onClick={() => set(items.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => set([...items, { title: "", owner: "hr" }])}>
        Add a step
      </Button>
    </Section>
  );
  return (
    <div className="grid max-w-3xl gap-5">
      {list("When someone joins", on, setOn)}
      {list("When someone leaves", off, setOff)}
      <p className="text-[12px] text-muted">New joiners and leavers get these lists. Changes apply to people added after you save.</p>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate({ onboarding: on.filter((x) => x.title.trim()), offboarding: off.filter((x) => x.title.trim()) })}>
        Save
      </Button>
    </div>
  );
}

function Letters() {
  const { meta } = useHr();
  const save = useSave();
  const [list, setList] = useState(meta.settings.letters);
  const [edit, setEdit] = useState<(typeof list)[number] | null>(null);
  const put = (l: (typeof list)[number]) => {
    const next = list.some((x) => x.id === l.id) ? list.map((x) => (x.id === l.id ? l : x)) : [...list, l];
    setList(next);
    save.mutate({ letters: next }, { onSuccess: () => setEdit(null) });
  };
  return (
    <Section title="Letter templates" className="max-w-3xl" action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ id: `l${Date.now()}`, name: "", body: "" })}>Template</Button>}>
      <p className="mb-3 text-[12.5px] text-muted">Issue them from a person&apos;s profile (More → the letter). Fields: {"{{name}} {{designation}} {{department}} {{join_date}} {{exit_date}} {{probation_end}} {{ctc}} {{emp_no}} {{company}} {{signatory}} {{signatory_title}} {{date}}"}</p>
      <ul className="divide-y divide-border">
        {list.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2.5">
            <b className="flex-1 text-[13.5px] font-medium">{l.name}</b>
            <Button size="sm" onClick={() => setEdit(l)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Remove ${l.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => { const next = list.filter((x) => x.id !== l.id); setList(next); save.mutate({ letters: next }); }} />
          </li>
        ))}
      </ul>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.name || "New template"} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit.name.trim() || !edit.body.trim()} onClick={() => put(edit)}>Save</Button></>}>
          <div className="grid gap-3">
            <Field label="Name">{(a) => <Input {...a} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} placeholder="Confirmation letter" />}</Field>
            <Field label="Letter">{(a) => <Textarea {...a} rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="font-serif" />}</Field>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
