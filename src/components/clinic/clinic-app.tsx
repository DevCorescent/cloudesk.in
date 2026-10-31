"use client";

// Clinic: today's queue by doctor (book, arrive, start, done), patients and
// their page (details, appointments, consultations for clinicians, bills),
// the consultation form (vitals, notes, diagnosis, prescription, follow-up;
// signed, then only added to), a printable prescription, and settings.
import { CalendarClock, Home, Plus, Printer, Settings, Stethoscope, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { bmi, flags, type ClinicSettings } from "@/lib/clinic/model";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Doctor = { id: string; name: string; fee: number | null };
type Meta = { me: { id: string; write: boolean; manage: boolean; clinician: boolean }; settings: ClinicSettings; doctors: Doctor[]; accounts: { id: string; name: string }[]; team: { id: string; name: string }[] };
type Appt = { id: string; patientId: string; patient: string; mrn: string; phone: string; doctor: string | null; doctorId: string; date: string; time: string | null; token: number; status: string; type: string; reason: string };
type Vitals = { systolic: number | null; diastolic: number | null; pulse: number | null; tempC: number | null; spo2: number | null; weightKg: number | null; heightCm: number | null };
type Rx = { drug: string; strength: string; dose: string; days: number; instructions: string };
type Visit = { id: string; patientId: string; appointmentId: string | null; doctor: string | null; doctorId: string | null; vitals: Vitals; complaints: string; findings: string; diagnosis: string; icd10: string; prescription: Rx[]; advice: string; tests: string; followUp: string | null; signedAt: string | null; addenda: { at: string; by: string; text: string }[]; createdAt: string; bmi: { value: number; band: string } | null; flags: string[] };
type Bill = { id: string; number: string; date: string; items: { name: string; qty: number; rate: number }[]; discount: number; total: number; paid: number; status: string };

const useClinic = () => useModule<Meta>();
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "warning" | "success" | "danger" }> = { booked: { label: "Booked", tone: "neutral" }, arrived: { label: "Waiting", tone: "warning" }, in_consultation: { label: "With doctor", tone: "accent" }, done: { label: "Done", tone: "success" }, no_show: { label: "No-show", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" } };
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;

export function ClinicApp({ path }: { path: string[] }) {
  const [section = "", id, sub] = path;
  return (
    <ModuleFrame<Meta>
      api="clinic"
      base="clinic"
      title="Clinic"
      icon={<Stethoscope />}
      section={section === "visits" ? "patients" : section}
      nav={(m) => [
        { id: "", label: "Today", icon: <Home /> },
        { id: "patients", label: "Patients", icon: <Users /> },
        { id: "appointments", label: "Appointments", icon: <CalendarClock /> },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        if (section === "patients") return isId(id) ? <PatientPage key={id} id={id!} /> : <PatientsView />;
        if (section === "visits" && isId(id) && sub === "print") return <PrescriptionPrint id={id!} />;
        if (section === "appointments") return <QueueView pickDate />;
        if (section === "settings") return <SettingsView />;
        return <TodayView />;
      }}
    />
  );
}

function TodayView() {
  const { meta } = useClinic();
  const h = useModuleQuery<{ today: { booked: number; waiting: number; inRoom: number; done: number }; month: { billed: number; due: number }; followUps: { id: string; patientId: string; patient: string }[] }>("home");
  return (
    <div className="space-y-5">
      <PageHeader title="Today" />
      {!meta.doctors.length && <Notice tone="warning" title="No doctors yet">Choose the clinicians in Settings — only they can be booked and see clinical notes.</Notice>}
      {h.data && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([["Booked", h.data.today.booked], ["Waiting", h.data.today.waiting], ["With doctor", h.data.today.inRoom], ["Seen", h.data.today.done]] as const).map(([l, v]) => <div key={l} className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></div>)}
          <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">Billed this month</p><p className="text-xl font-semibold tabular-nums">{inr(h.data.month.billed)}</p></div>
          <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">Still to collect</p><p className="text-xl font-semibold tabular-nums">{inr(h.data.month.due)}</p></div>
        </div>
      )}
      {!!h.data?.followUps.length && <Notice title="Follow-ups due today">{h.data.followUps.map((f) => <Link key={f.id} className="mr-3 underline" href={`/clinic/patients/${f.patientId}`}>{f.patient}</Link>)}</Notice>}
      <QueueView />
    </div>
  );
}

function QueueView({ pickDate }: { pickDate?: boolean }) {
  const { meta } = useClinic();
  const [date, setDate] = useState(today());
  const [doctorId, setDoctorId] = useState("");
  const q = useModuleQuery<{ appointments: Appt[] }>(`queue?${new URLSearchParams({ date, doctorId })}`, { keepPrevious: true });
  const status = useModuleAction<{ id: string; status: string }>((x) => ({ path: `appointments/${x.id}/status`, body: { status: x.status } }));
  const [booking, setBooking] = useState(false);
  const act = (a: Appt) => {
    const next: [string, string][] = a.status === "booked" ? [["arrived", "Arrived"], ["no_show", "No-show"]] : a.status === "arrived" ? (meta.me.clinician ? [["in_consultation", "Start"]] : []) : a.status === "no_show" ? [["arrived", "Arrived"]] : [];
    return next.map(([st, label]) => <Button key={st} size="sm" variant={st === "in_consultation" ? "primary" : "ghost"} onClick={() => status.mutate({ id: a.id, status: st })}>{label}</Button>);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2">{pickDate && <Input aria-label="Day" type="date" className="!w-44" value={date} onChange={(e) => setDate(e.target.value)} />}<Select aria-label="Doctor" className="!w-52" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">All doctors</option>{meta.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
        {meta.me.write && meta.doctors.length > 0 && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setBooking(true)}>Book</Button>}
      </div>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.appointments.length ? <Empty>No appointments.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.appointments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold tabular-nums">{a.token}</span><span><Link href={`/clinic/patients/${a.patientId}`} className="font-medium hover:underline">{a.patient}</Link><span className="block text-[12px] text-muted">{a.mrn} · {a.doctor}{a.time ? ` · ${a.time}` : ""} · {a.type.replace("_", " ")}{a.reason ? ` · ${a.reason}` : ""}</span></span></span>
              <span className="flex items-center gap-2"><Badge tone={STATUS[a.status]?.tone ?? "neutral"}>{STATUS[a.status]?.label ?? a.status}</Badge>{meta.me.write && act(a)}</span>
            </li>
          ))}
        </ul>
      )}
      {booking && <BookDialog date={date} onClose={() => setBooking(false)} />}
    </div>
  );
}

function BookDialog({ date, patientId, onClose }: { date: string; patientId?: string; onClose: () => void }) {
  const { meta } = useClinic();
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ patients: { id: string; name: string; mrn: string; phone: string }[] }>(patientId ? null : `patients?q=${encodeURIComponent(q)}`, { keepPrevious: true });
  const [f, setF] = useState({ patientId: patientId ?? "", doctorId: meta.doctors[0]?.id ?? "", date, time: "", type: "consultation", reason: "" });
  const save = useModuleAction<void, { appointment: { token: number } }>(() => ({ path: "appointments", body: { ...f, time: f.time || null, minutes: meta.settings.slotMinutes } }), { success: (r) => `Booked — token ${r.appointment.token}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Book an appointment" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.patientId || !f.doctorId} onClick={() => save.mutate()}>Book</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!patientId && (
          <div className="sm:col-span-2">
            <Field label="Patient">{(a) => <Input {...a} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, MRN or phone" />}</Field>
            <ul className="mt-1 max-h-40 overflow-y-auto text-[13px]">{list.data?.patients.slice(0, 8).map((p) => <li key={p.id}><button type="button" className={cx("w-full rounded-[10px] px-2 py-1 text-left hover:bg-surface-2", f.patientId === p.id && "bg-accent-soft")} onClick={() => setF({ ...f, patientId: p.id })}>{p.name} <span className="text-muted">· {p.mrn} · {p.phone}</span></button></li>)}</ul>
          </div>
        )}
        <Field label="Doctor">{(a) => <Select {...a} value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}>{meta.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <Field label="Type">{(a) => <Select {...a} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="consultation">Consultation</option><option value="follow_up">Follow-up</option><option value="procedure">Procedure</option></Select>}</Field>
        <Field label="Day">{(a) => <Input {...a} type="date" min={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Time (optional)">{(a) => <Input {...a} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        <Field label="Reason" className="sm:col-span-2">{(a) => <Input {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Patients ────────────────────────────────────────────────────────────────

function PatientsView() {
  const { meta, go } = useClinic();
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ patients: { id: string; name: string; mrn: string; phone: string; gender: string; ageYears: number | null; dob: string | null }[] }>(`patients?q=${encodeURIComponent(q)}`, { keepPrevious: true });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title="Patients" actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Register a patient</Button>} />
      <Input aria-label="Search patients" className="!w-72" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, MRN or phone" />
      {!list.data ? <Skeleton className="h-40 rounded-[20px]" /> : !list.data.patients.length ? <Empty>No patients found.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{list.data.patients.map((p) => <li key={p.id} className="flex cursor-pointer justify-between px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`patients/${p.id}`)}><span><b className="font-medium">{p.name}</b> <span className="text-muted">· {p.mrn}{p.gender ? ` · ${p.gender}` : ""}</span></span><span className="text-muted">{p.phone}</span></li>)}</ul>}
      {adding && <PatientDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function PatientDialog({ init, onClose }: { init?: Record<string, unknown>; onClose: () => void }) {
  const { go } = useClinic();
  const [f, setF] = useState({ name: String(init?.name ?? ""), ageYears: init?.ageYears ? String(init.ageYears) : "", dob: String(init?.dob ?? ""), gender: String(init?.gender ?? ""), phone: String(init?.phone ?? ""), email: String(init?.email ?? ""), address: String(init?.address ?? ""), bloodGroup: String(init?.bloodGroup ?? ""), allergies: String(init?.allergies ?? ""), conditions: String(init?.conditions ?? ""), emergencyName: String(init?.emergencyName ?? ""), emergencyPhone: String(init?.emergencyPhone ?? ""), consent: !!init?.consentAt });
  const save = useModuleAction<void, { patient: { id: string; mrn: string } }>(() => ({ path: init?.id ? `patients/${init.id}` : "patients", method: init?.id ? "PUT" : "POST", body: { ...f, ageYears: f.ageYears ? Number(f.ageYears) : null, dob: f.dob || null } }), { success: (r) => (init?.id ? "Saved" : `Registered — ${r.patient.mrn}`), onDone: (r) => (onClose(), init?.id ? undefined : go(`patients/${r.patient.id}`)) });
  return (
    <Dialog open onClose={onClose} size="lg" title={init?.id ? "Edit patient" : "Register a patient"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.consent} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="Date of birth">{(a) => <Input {...a} type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} />}</Field>
        <Field label="Or age (years)">{(a) => <Input {...a} type="number" min={0} max={130} value={f.ageYears} onChange={(e) => setF({ ...f, ageYears: e.target.value })} />}</Field>
        <Field label="Gender">{(a) => <Select {...a} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>}</Field>
        <Field label="Blood group">{(a) => <Select {...a} value={f.bloodGroup} onChange={(e) => setF({ ...f, bloodGroup: e.target.value })}><option value="">—</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Emergency contact">{(a) => <Input {...a} value={f.emergencyName} onChange={(e) => setF({ ...f, emergencyName: e.target.value })} />}</Field>
        <Field label="Allergies">{(a) => <Input {...a} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} />}</Field>
        <Field label="Long-term conditions">{(a) => <Input {...a} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}</Field>
        <label className="flex items-start gap-2 text-[13px] sm:col-span-2"><Switch checked={f.consent} onChange={(v) => setF({ ...f, consent: v })} label="The patient agreed to their details being kept for their care" /> The patient agreed to their details and health records being kept and used for their care.</label>
      </div>
    </Dialog>
  );
}

function PatientPage({ id }: { id: string }) {
  const { meta } = useClinic();
  const q = useModuleQuery<{ patient: Record<string, unknown> & { id: string; name: string; mrn: string; phone: string; allergies: string; conditions: string; bloodGroup: string; gender: string }; appointments: Appt[]; bills: Bill[]; visits: Visit[] | null; clinician: boolean }>(`patients/${id}`);
  const [edit, setEdit] = useState(false);
  const [booking, setBooking] = useState(false);
  const [visit, setVisit] = useState<Partial<Visit> | null>(null);
  const [billing, setBilling] = useState<string | null | undefined>(undefined);
  const [paying, setPaying] = useState<Bill | null>(null);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { patient: p, appointments, bills, visits } = q.data;
  const openAppt = appointments.find((a) => ["arrived", "in_consultation"].includes(a.status));
  return (
    <div className="space-y-4">
      <PageHeader title={p.name} description={`${p.mrn}${p.gender ? ` · ${p.gender}` : ""}${p.bloodGroup ? ` · ${p.bloodGroup}` : ""} · ${p.phone}`} actions={<div className="flex gap-2">{meta.me.write && <><Button size="sm" onClick={() => setEdit(true)}>Edit</Button><Button size="sm" onClick={() => setBooking(true)}>Book</Button><Button size="sm" onClick={() => setBilling(null)}>Bill</Button></>}{meta.me.clinician && <Button size="sm" variant="primary" onClick={() => setVisit({ appointmentId: openAppt?.id ?? null })}>New consultation</Button>}</div>} />
      <CustomFieldsCard entity="clinic.patient" id={id} />
      {q.data.clinician && (p.allergies || p.conditions) && <Notice tone="warning" title="Clinical alerts">{p.allergies && <span className="block">Allergies: {p.allergies}</span>}{p.conditions && <span className="block">Conditions: {p.conditions}</span>}</Notice>}
      {visits === null ? <Notice>Consultation notes are visible to the clinic&apos;s clinicians only.</Notice> : (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Consultations</h2>
          {!visits.length ? <Empty>No consultations yet.</Empty> : visits.map((v) => (
            <article key={v.id} className="space-y-2 rounded-[18px] border border-border bg-surface p-4 text-[13.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="font-medium">{when(v.createdAt)} · {v.doctor}</b><span className="flex items-center gap-2">{v.signedAt ? <Badge tone="success">Signed</Badge> : <Badge tone="warning">Draft</Badge>}{v.signedAt ? <Link className="inline-flex items-center gap-1 text-[12.5px] underline" href={`/clinic/visits/${v.id}/print`}><Printer className="size-3.5" />Prescription</Link> : v.doctorId === meta.me.id && <Button size="sm" onClick={() => setVisit(v)}>Continue</Button>}</span></div>
              {v.flags.length > 0 && <p className="text-danger">{v.flags.join(" · ")}</p>}
              <p className="text-muted">{[v.vitals.systolic && `BP ${v.vitals.systolic}/${v.vitals.diastolic}`, v.vitals.pulse && `Pulse ${v.vitals.pulse}`, v.vitals.tempC && `Temp ${v.vitals.tempC}°C`, v.vitals.spo2 && `SpO₂ ${v.vitals.spo2}%`, v.bmi && `BMI ${v.bmi.value} (${v.bmi.band})`].filter(Boolean).join(" · ")}</p>
              {v.complaints && <p><b className="font-medium">Complaints:</b> {v.complaints}</p>}
              {v.diagnosis && <p><b className="font-medium">Diagnosis:</b> {v.diagnosis}{v.icd10 ? ` (${v.icd10})` : ""}</p>}
              {!!v.prescription.length && <ul className="list-disc pl-5">{v.prescription.map((r, i) => <li key={i}>{r.drug} {r.strength} — {r.dose}{r.days ? ` for ${r.days} days` : ""}{r.instructions ? `, ${r.instructions}` : ""}</li>)}</ul>}
              {v.followUp && <p className="text-muted">Follow-up {v.followUp}</p>}
              {v.addenda.map((a, i) => <p key={i} className="rounded-[10px] bg-surface-2 px-3 py-1.5 text-[13px]"><b className="font-medium">{a.by}</b>, {when(a.at)}: {a.text}</p>)}
              {v.signedAt && meta.me.clinician && <Addendum visitId={v.id} />}
            </article>
          ))}
        </section>
      )}
      <section className="space-y-2"><h2 className="text-[15px] font-semibold">Bills</h2>{!bills.length ? <Empty>No bills.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{bills.map((b) => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]"><span>{b.number} · {b.date} · {b.items.map((i) => i.name).join(", ")}</span><span className="flex items-center gap-2"><b className="tabular-nums">{inr(b.total)}</b><Badge tone={b.status === "paid" ? "success" : b.status === "void" ? "neutral" : "warning"}>{b.status === "partial" ? `Paid ${inr(b.paid)}` : b.status}</Badge>{meta.me.write && ["due", "partial"].includes(b.status) && <Button size="sm" onClick={() => setPaying(b)}>Take payment</Button>}</span></li>)}</ul>}</section>
      <section className="space-y-2"><h2 className="text-[15px] font-semibold">Appointments</h2>{!appointments.length ? <Empty>None.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface text-[13.5px]">{appointments.map((a) => <li key={a.id} className="flex justify-between px-4 py-2"><span>{a.date} · token {a.token} · {a.doctor}</span><Badge tone={STATUS[a.status]?.tone ?? "neutral"}>{STATUS[a.status]?.label}</Badge></li>)}</ul>}</section>
      {edit && <PatientDialog init={p} onClose={() => setEdit(false)} />}
      {booking && <BookDialog date={today()} patientId={id} onClose={() => setBooking(false)} />}
      {visit && <VisitDialog patientId={id} init={visit} onClose={() => setVisit(null)} />}
      {billing !== undefined && <BillDialog patientId={id} visitId={visits?.[0]?.id ?? null} onClose={() => setBilling(undefined)} />}
      {paying && <PayDialog bill={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function Addendum({ visitId }: { visitId: string }) {
  const [text, setText] = useState("");
  const add = useModuleAction<void>(() => ({ path: `visits/${visitId}/addendum`, body: { text } }), { success: "Note added", onDone: () => setText("") });
  return <div className="flex gap-2"><Input aria-label="Add a note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note to this signed consultation" /><Button size="sm" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></div>;
}

function VisitDialog({ patientId, init, onClose }: { patientId: string; init: Partial<Visit>; onClose: () => void }) {
  const v0 = init.vitals ?? ({} as Partial<Vitals>);
  const num = (x: string) => (x === "" ? null : Number(x));
  const [vit, setVit] = useState<Record<keyof Vitals, string>>({ systolic: String(v0.systolic ?? ""), diastolic: String(v0.diastolic ?? ""), pulse: String(v0.pulse ?? ""), tempC: String(v0.tempC ?? ""), spo2: String(v0.spo2 ?? ""), weightKg: String(v0.weightKg ?? ""), heightCm: String(v0.heightCm ?? "") });
  const [f, setF] = useState({ complaints: init.complaints ?? "", findings: init.findings ?? "", diagnosis: init.diagnosis ?? "", icd10: init.icd10 ?? "", advice: init.advice ?? "", tests: init.tests ?? "", followUp: init.followUp ?? "" });
  const [rx, setRx] = useState<Rx[]>(init.prescription?.length ? init.prescription : [{ drug: "", strength: "", dose: "", days: 0, instructions: "" }]);
  const [id, setId] = useState(init.id ?? null);
  const vitals = Object.fromEntries(Object.entries(vit).map(([k, x]) => [k, num(x)])) as Vitals;
  const body = { patientId, appointmentId: init.appointmentId ?? null, vitals, ...f, followUp: f.followUp || null, prescription: rx.filter((r) => r.drug.trim()) };
  const save = useModuleAction<void, { visit: { id: string } }>(() => ({ path: id ? `visits/${id}` : "visits", method: id ? "PUT" : "POST", body }), { success: "Saved", onDone: (r) => setId(r.visit.id) });
  const sign = useModuleAction<void>(() => ({ path: `visits/${id}/sign` }), { success: "Signed", onDone: onClose });
  const b = bmi(vitals.weightKg, vitals.heightCm);
  const warn = flags(vitals);
  const v = (k: keyof Vitals, label: string) => <Field label={label}>{(a) => <Input {...a} type="number" value={vit[k]} onChange={(e) => setVit({ ...vit, [k]: e.target.value })} />}</Field>;
  return (
    <Dialog open onClose={onClose} size="xl" title="Consultation" description="Save as you go; sign when done — after that it can only be added to." footer={<><Button onClick={onClose}>Close</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button><Button variant="primary" disabled={!id} loading={sign.isPending} onClick={() => sign.mutate()}>Sign</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">{v("systolic", "BP systolic")}{v("diastolic", "BP diastolic")}{v("pulse", "Pulse")}{v("tempC", "Temp °C")}{v("spo2", "SpO₂ %")}{v("weightKg", "Weight kg")}{v("heightCm", "Height cm")}</div>
        {(b || warn.length > 0) && <p className="text-[13px]">{b && <span className="mr-3">BMI {b.value} ({b.band})</span>}{warn.length > 0 && <span className="text-danger">{warn.join(" · ")}</span>}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Complaints">{(a) => <Textarea {...a} rows={3} value={f.complaints} onChange={(e) => setF({ ...f, complaints: e.target.value })} />}</Field>
          <Field label="Examination">{(a) => <Textarea {...a} rows={3} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} />}</Field>
          <Field label="Diagnosis">{(a) => <Input {...a} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} />}</Field>
          <Field label="ICD-10 (optional)">{(a) => <Input {...a} value={f.icd10} onChange={(e) => setF({ ...f, icd10: e.target.value })} placeholder="J06.9" />}</Field>
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Prescription</p>
          {rx.map((r, i) => <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_80px_2fr]"><Input aria-label={`Medicine ${i + 1}`} placeholder="Medicine" value={r.drug} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, drug: e.target.value } : x)))} /><Input aria-label={`Strength ${i + 1}`} placeholder="500 mg" value={r.strength} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, strength: e.target.value } : x)))} /><Input aria-label={`Dose ${i + 1}`} placeholder="1-0-1" value={r.dose} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)))} /><Input aria-label={`Days ${i + 1}`} type="number" value={r.days || ""} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))} /><Input aria-label={`Instructions ${i + 1}`} placeholder="After food" value={r.instructions} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} /></div>)}
          <Button size="sm" variant="ghost" onClick={() => setRx([...rx, { drug: "", strength: "", dose: "", days: 0, instructions: "" }])}>Add a medicine</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Advice">{(a) => <Textarea {...a} rows={2} value={f.advice} onChange={(e) => setF({ ...f, advice: e.target.value })} />}</Field>
          <Field label="Tests">{(a) => <Textarea {...a} rows={2} value={f.tests} onChange={(e) => setF({ ...f, tests: e.target.value })} />}</Field>
          <Field label="Follow-up on">{(a) => <Input {...a} type="date" value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function BillDialog({ patientId, visitId, onClose }: { patientId: string; visitId: string | null; onClose: () => void }) {
  const { meta } = useClinic();
  const [items, setItems] = useState<{ name: string; qty: string; rate: string }[]>([{ name: meta.settings.services[0]?.name ?? "Consultation", qty: "1", rate: String((meta.settings.services[0]?.fee ?? 0) / 100) }]);
  const [discount, setDiscount] = useState("0");
  const total = items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0) - (Number(discount) || 0);
  const save = useModuleAction<void, { bill: { number: string } }>(() => ({ path: "bills", body: { patientId, visitId, items: items.filter((i) => i.name).map((i) => ({ name: i.name, qty: Number(i.qty) || 1, rate: Math.round(Number(i.rate) * 100) })), discount: Math.round(Number(discount) * 100) } }), { success: (r) => `Bill ${r.bill.number} made`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Bill" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={total <= 0} onClick={() => save.mutate()}>Make bill · ₹{total.toLocaleString("en-IN")}</Button></>}>
      <div className="space-y-2">
        {items.map((it, i) => <div key={i} className="grid grid-cols-[2fr_70px_110px] gap-2"><Select aria-label={`Service ${i + 1}`} value={it.name} onChange={(e) => { const svc = meta.settings.services.find((x) => x.name === e.target.value); setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value, rate: svc ? String(svc.fee / 100) : x.rate } : x))); }}>{meta.settings.services.map((s) => <option key={s.name}>{s.name}</option>)}</Select><Input aria-label={`Qty ${i + 1}`} type="number" min={1} value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /><Input aria-label={`Rate ${i + 1}`} type="number" min={0} value={it.rate} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></div>)}
        <Button size="sm" variant="ghost" onClick={() => setItems([...items, { name: meta.settings.services[0]?.name ?? "", qty: "1", rate: String((meta.settings.services[0]?.fee ?? 0) / 100) }])}>Add a service</Button>
        <Field label="Discount (₹)">{(a) => <Input {...a} type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function PayDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { meta } = useClinic();
  const [f, setF] = useState({ amount: String((bill.total - bill.paid) / 100), method: "upi", paidOn: today(), reference: "", accountId: "" });
  const save = useModuleAction<void>(() => ({ path: `bills/${bill.id}/payments`, body: { ...f, amount: Math.round(Number(f.amount) * 100), accountId: f.accountId || null } }), { success: "Payment recorded", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Payment for ${bill.number}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!Number(f.amount)} onClick={() => save.mutate()}>Record</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)">{(a) => <Input {...a} type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Paid by">{(a) => <Select {...a} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank</option><option value="insurance">Insurance</option></Select>}</Field>
        <Field label="On">{(a) => <Input {...a} type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />}</Field>
        <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
        {!!meta.accounts.length && <Field label="Into account" className="sm:col-span-2">{(a) => <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">{f.method === "cash" ? "Cash in hand" : "The default bank account"}</option>{meta.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
      </div>
    </Dialog>
  );
}

function PrescriptionPrint({ id }: { id: string }) {
  const q = useModuleQuery<{ clinic: string; footer: string; doctor: string; date: string; patient: { name: string; mrn: string; gender: string; dob: string | null; ageYears: number | null }; vitals: Vitals; diagnosis: string; prescription: Rx[]; advice: string; tests: string; followUp: string | null; signed: boolean }>(`visits/${id}/prescription`);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const r = q.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-[12px] border border-border bg-white p-8 text-[14px] text-black print:border-0">
      <div className="flex items-start justify-between border-b border-black/20 pb-3"><div><p className="text-lg font-semibold">{r.clinic}</p><p>{r.doctor}</p></div><Button className="print:hidden" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Print</Button></div>
      <p>{r.patient.name} · {r.patient.mrn}{r.patient.gender ? ` · ${r.patient.gender}` : ""}{r.patient.ageYears ? ` · ${r.patient.ageYears} y` : ""} · {when(r.date)}</p>
      {r.diagnosis && <p><b>Diagnosis:</b> {r.diagnosis}</p>}
      <div><p className="text-xl font-semibold">℞</p><ol className="list-decimal space-y-1 pl-6">{r.prescription.map((x, i) => <li key={i}>{x.drug} {x.strength} — {x.dose}{x.days ? ` × ${x.days} days` : ""}{x.instructions ? ` (${x.instructions})` : ""}</li>)}</ol></div>
      {r.advice && <p><b>Advice:</b> {r.advice}</p>}
      {r.tests && <p><b>Tests:</b> {r.tests}</p>}
      {r.followUp && <p><b>Follow-up:</b> {r.followUp}</p>}
      {!r.signed && <p className="text-red-700">Draft — not yet signed.</p>}
      {r.footer && <p className="border-t border-black/20 pt-3 text-[12px]">{r.footer}</p>}
    </div>
  );
}

function SettingsView() {
  const { meta } = useClinic();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: { ...f, services: f.services.filter((x) => x.name.trim()) } }), { success: "Settings saved" });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Clinic settings" />
      <section className="space-y-2 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Clinicians</h2>
        <p className="text-[13px] text-muted">Only they can be booked as doctors and see clinical notes. With nobody chosen, owners and admins are.</p>
        <div className="flex flex-wrap gap-2">{meta.team.map((t) => { const on = f.clinicians.includes(t.id); return <button key={t.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, clinicians: on ? f.clinicians.filter((x) => x !== t.id) : [...f.clinicians, t.id] })} className={cx("rounded-full border px-3 py-1 text-[13px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{t.name}</button>; })}</div>
      </section>
      <section className="space-y-2 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Services and fees</h2>
        {f.services.map((s, i) => <div key={i} className="grid grid-cols-[2fr_1fr] gap-2"><Input aria-label={`Service ${i + 1}`} value={s.name} onChange={(e) => setF({ ...f, services: f.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /><Input aria-label={`Fee ${i + 1}`} type="number" value={s.fee / 100} onChange={(e) => setF({ ...f, services: f.services.map((x, j) => (j === i ? { ...x, fee: Math.round(Number(e.target.value) * 100) } : x)) })} /></div>)}
        <Button size="sm" variant="ghost" onClick={() => setF({ ...f, services: [...f.services, { name: "", fee: 0 }] })}>Add a service</Button>
        <Field label="Slot length (minutes)">{(a) => <Input {...a} type="number" min={5} max={120} value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: Number(e.target.value) })} />}</Field>
        <Field label="Prescription footer">{(a) => <Input {...a} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} placeholder="Reg. no., address, timings" />}</Field>
      </section>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
