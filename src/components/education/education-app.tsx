"use client";

// Education: the overview, students (with their fees, payments, attendance
// and exams), classes, fees (dues, plans, taking payments), attendance by
// class and day, exams with a marks sheet and report cards, and settings.
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ClipboardList, GraduationCap, Home, IndianRupee, Plus, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import type { EduSettings } from "@/lib/education/model";
import { target } from "@/lib/import/targets";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Cls = { id: string; name: string; section: string; year: string; label: string; teacher: string | null; teacherId: string | null; students: number; capacity: number };
type Meta = { me: { write: boolean; manage: boolean }; settings: EduSettings; classes: Cls[]; team: { id: string; name: string }[]; accounts: { id: string; name: string }[] };
type Student = { id: string; admissionNo: string; name: string; classId: string | null; rollNo: number | null; guardianName: string; guardianPhone: string; guardianEmail: string; concessionPct: number; concessionNote: string; status: string; dob: string | null; gender: string; address: string; due: number; overdue: number };
type Fee = { id: string; number: string; label: string; dueDate: string; amount: number; tax: number; paid: number; status: string; waivedReason: string; student?: string; admissionNo?: string; guardianPhone?: string; left?: number; overdue?: boolean; studentId: string };

const useEdu = () => useModule<Meta>();
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const date = (d: string | null) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;

export function EducationApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="education"
      base="school"
      title="Education"
      icon={<GraduationCap />}
      section={section}
      nav={(m) => [
        { id: "", label: "Overview", icon: <Home /> },
        { id: "students", label: "Students", icon: <Users /> },
        { id: "classes", label: "Classes", icon: <GraduationCap /> },
        { id: "fees", label: "Fees", icon: <IndianRupee /> },
        { id: "attendance", label: "Attendance", icon: <CalendarCheck /> },
        { id: "exams", label: "Exams", icon: <ClipboardList /> },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        if (section === "students") return isId(id) ? <StudentPage key={id} id={id!} /> : <StudentsView />;
        if (section === "classes") return <ClassesView />;
        if (section === "fees") return <FeesView />;
        if (section === "attendance") return <AttendanceView />;
        if (section === "exams") return isId(id) ? <ExamSheet key={id} id={id!} /> : <ExamsView />;
        if (section === "settings") return <SettingsView />;
        return <HomeView />;
      }}
    />
  );
}

function HomeView() {
  const q = useModuleQuery<{ students: number; due: number; overdue: number; collectedThisMonth: number; today: { marked: number; pct: number | null } }>("home");
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const h = q.data;
  const tile = (label: string, value: string, href: string, bad?: boolean) => <Link href={href} className="rounded-[18px] border border-border bg-surface p-4 hover:bg-surface-2"><p className="text-[12px] text-muted">{label}</p><p className={cx("mt-1 text-xl font-semibold tabular-nums", bad && "text-danger")}>{value}</p></Link>;
  return (
    <div className="space-y-5">
      <PageHeader title="Education" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tile("Students", String(h.students), "/school/students")}
        {tile("Fees to collect", inr(h.due), "/school/fees")}
        {tile("Overdue", inr(h.overdue), "/school/fees", h.overdue > 0)}
        {tile("Collected this month", inr(h.collectedThisMonth), "/school/fees")}
        {tile("Attendance today", h.today.pct === null ? "Not marked" : `${h.today.pct}%`, "/school/attendance")}
      </div>
    </div>
  );
}

// ── Students ────────────────────────────────────────────────────────────────

function StudentsView() {
  const { meta, go, orgId } = useEdu();
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");
  const [q, setQ] = useState("");
  const list = useModuleQuery<{ students: Student[] }>(`students?${new URLSearchParams({ classId, q })}`, { keepPrevious: true });
  const [edit, setEdit] = useState<Partial<Student> | null>(null);
  const cls = (id: string | null) => meta.classes.find((c) => c.id === id)?.label ?? "—";
  return (
    <div className="space-y-4">
      <PageHeader title="Students" actions={<div className="flex flex-wrap gap-2">{meta.me.write && <ImportButton target={target("education.students")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/education/students/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["education", orgId] })} />}<ExportMenu name="students" rows={list.data?.students.map((s) => ({ ...s, class: cls(s.classId) }))} columns={[{ key: "admissionNo", label: "Admission no." }, { key: "name", label: "Name" }, { key: "class", label: "Class" }, { key: "rollNo", label: "Roll no." }, { key: "guardianName", label: "Guardian" }, { key: "guardianPhone", label: "Phone" }, { key: "guardianEmail", label: "Email" }, { key: "concessionPct", label: "Concession %" }, { key: "due", label: "Fees due", money: true }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ classId: classId || null })}>Add a student</Button>}</div>} />
      <div className="flex flex-wrap gap-2"><Select aria-label="Class" className="!w-48" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.year})</option>)}</Select><Input aria-label="Search students" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, admission no., guardian" /></div>
      {!list.data ? <Skeleton className="h-60 rounded-[20px]" /> : !list.data.students.length ? <Empty>No students yet.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-4 py-2.5 font-medium">Student</th><th className="px-4 py-2.5 font-medium">Class</th><th className="px-4 py-2.5 font-medium">Guardian</th><th className="px-4 py-2.5 text-right font-medium">Fees due</th></tr></thead>
            <tbody className="divide-y divide-border">{list.data.students.map((s) => <tr key={s.id} className="cursor-pointer hover:bg-surface-2" onClick={() => go(`students/${s.id}`)}><td className="px-4 py-2.5"><b className="font-medium">{s.name}</b><span className="block text-[12px] text-muted">{s.admissionNo}{s.rollNo !== null ? ` · roll ${s.rollNo}` : ""}{s.concessionPct ? ` · ${s.concessionPct}% concession` : ""}</span></td><td className="px-4 py-2.5">{cls(s.classId)}</td><td className="px-4 py-2.5">{s.guardianName || "—"}<span className="block text-[12px] text-muted">{s.guardianPhone}</span></td><td className={cx("px-4 py-2.5 text-right tabular-nums", s.overdue && "font-medium text-danger")}>{s.due ? inr(s.due) : "—"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {edit && <StudentDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function StudentDialog({ init, onClose }: { init: Partial<Student>; onClose: () => void }) {
  const { meta } = useEdu();
  const [f, setF] = useState({ admissionNo: init.admissionNo ?? "", name: init.name ?? "", classId: init.classId ?? "", rollNo: init.rollNo?.toString() ?? "", dob: init.dob ?? "", gender: init.gender ?? "", guardianName: init.guardianName ?? "", guardianPhone: init.guardianPhone ?? "", guardianEmail: init.guardianEmail ?? "", address: init.address ?? "", concessionPct: String(init.concessionPct ?? 0), concessionNote: init.concessionNote ?? "", status: init.status ?? "active" });
  const save = useModuleAction<void>(() => ({ path: init.id ? `students/${init.id}` : "students", method: init.id ? "PUT" : "POST", body: { ...f, classId: f.classId || null, rollNo: f.rollNo ? Number(f.rollNo) : null, dob: f.dob || null, concessionPct: Number(f.concessionPct) || 0 } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? `Edit ${init.name}` : "Add a student"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Admission no." hint={init.id ? undefined : "Blank for the next number"}>{(a) => <Input {...a} value={f.admissionNo} onChange={(e) => setF({ ...f, admissionNo: e.target.value })} />}</Field>
        <Field label="Class">{(a) => <Select {...a} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">None</option>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.year})</option>)}</Select>}</Field>
        <Field label="Roll no.">{(a) => <Input {...a} type="number" value={f.rollNo} onChange={(e) => setF({ ...f, rollNo: e.target.value })} />}</Field>
        <Field label="Date of birth">{(a) => <Input {...a} type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} />}</Field>
        <Field label="Gender">{(a) => <Select {...a} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>}</Field>
        <Field label="Guardian">{(a) => <Input {...a} value={f.guardianName} onChange={(e) => setF({ ...f, guardianName: e.target.value })} />}</Field>
        <Field label="Guardian phone">{(a) => <Input {...a} value={f.guardianPhone} onChange={(e) => setF({ ...f, guardianPhone: e.target.value })} />}</Field>
        <Field label="Guardian email" hint="Fee reminders go here">{(a) => <Input {...a} type="email" value={f.guardianEmail} onChange={(e) => setF({ ...f, guardianEmail: e.target.value })} />}</Field>
        <Field label="Status">{(a) => <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Studying</option><option value="left">Left</option><option value="alumni">Passed out</option></Select>}</Field>
        <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}</Field>
        {meta.me.manage && <><Field label="Fee concession %">{(a) => <Input {...a} type="number" min={0} max={100} value={f.concessionPct} onChange={(e) => setF({ ...f, concessionPct: e.target.value })} />}</Field><Field label="Why">{(a) => <Input {...a} value={f.concessionNote} onChange={(e) => setF({ ...f, concessionNote: e.target.value })} placeholder="Sibling, merit, staff ward" />}</Field></>}
      </div>
    </Dialog>
  );
}

function StudentPage({ id }: { id: string }) {
  const { meta } = useEdu();
  const q = useModuleQuery<{ student: Student; class: Cls | null; fees: Fee[]; payments: { id: string; receiptNo: string; amount: number; method: string; paidOn: string; reference: string; feeId: string }[]; attendance: { days: number; pct: number | null }; exams: { id: string; name: string; date: string | null }[] }>(`students/${id}`);
  const [edit, setEdit] = useState(false);
  const [paying, setPaying] = useState<Fee | null>(null);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { student: s, fees, payments, attendance, exams } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={s.name} description={`${s.admissionNo} · ${q.data.class ? `${q.data.class.name}${q.data.class.section ? ` – ${q.data.class.section}` : ""}` : "No class"}${s.rollNo !== null ? ` · roll ${s.rollNo}` : ""} · ${s.guardianName || "no guardian"} ${s.guardianPhone}`} actions={meta.me.write && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>} />
      <CustomFieldsCard entity="education.student" id={id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">Fees due</p><p className="text-xl font-semibold">{inr(fees.filter((f) => ["due", "partial"].includes(f.status)).reduce((n, f) => n + f.amount + f.tax - f.paid, 0))}</p></div>
        <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">Attendance</p><p className="text-xl font-semibold">{attendance.pct === null ? "—" : `${attendance.pct}%`}</p><p className="text-[12px] text-muted">{attendance.days} day(s) marked</p></div>
        <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">Concession</p><p className="text-xl font-semibold">{s.concessionPct ? `${s.concessionPct}%` : "None"}</p><p className="text-[12px] text-muted">{s.concessionNote}</p></div>
      </div>
      <section className="rounded-[20px] border border-border bg-surface p-4">
        <h2 className="mb-2 text-[15px] font-semibold">Fees</h2>
        {!fees.length ? <p className="text-[13px] text-muted">No fees raised.</p> : <ul className="divide-y divide-border text-[13.5px]">{fees.map((f) => <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{f.label} · {f.number}<span className="block text-[12px] text-muted">Due {date(f.dueDate)} · {inr(f.amount + f.tax)}{f.tax ? ` incl. GST ${inr(f.tax)}` : ""}{f.paid ? ` · paid ${inr(f.paid)}` : ""}{f.waivedReason ? ` · waived: ${f.waivedReason}` : ""}</span></span><span className="flex items-center gap-2"><Badge tone={f.status === "paid" ? "success" : f.status === "waived" ? "neutral" : f.dueDate < today() ? "danger" : "warning"}>{f.status === "paid" ? "Paid" : f.status === "waived" ? "Waived" : f.dueDate < today() ? "Overdue" : f.status === "partial" ? "Part paid" : "Due"}</Badge>{meta.me.write && ["due", "partial"].includes(f.status) && <Button size="sm" onClick={() => setPaying(f)}>Take payment</Button>}</span></li>)}</ul>}
      </section>
      {!!payments.length && <section className="rounded-[20px] border border-border bg-surface p-4"><h2 className="mb-2 text-[15px] font-semibold">Receipts</h2><ul className="space-y-1 text-[13.5px]">{payments.map((p) => <li key={p.id}>{p.receiptNo} · {date(p.paidOn)} · {inr(p.amount)} by {p.method}{p.reference ? ` (${p.reference})` : ""}</li>)}</ul></section>}
      {!!exams.length && <section className="rounded-[20px] border border-border bg-surface p-4"><h2 className="mb-2 text-[15px] font-semibold">Exams</h2><ul className="space-y-1 text-[13.5px]">{exams.map((e) => <li key={e.id}><Link className="underline" href={`/school/exams/${e.id}`}>{e.name}</Link> · {date(e.date)}</li>)}</ul></section>}
      {edit && <StudentDialog init={s} onClose={() => setEdit(false)} />}
      {paying && <PayDialog fee={paying} who={s.name} onClose={() => setPaying(null)} />}
    </div>
  );
}

function PayDialog({ fee, who, onClose }: { fee: Fee; who: string; onClose: () => void }) {
  const { meta } = useEdu();
  const left = fee.amount + fee.tax - fee.paid;
  const [f, setF] = useState({ amount: String(left / 100), method: "upi", paidOn: today(), reference: "", accountId: "" });
  const save = useModuleAction<void, { payment: { receiptNo: string } }>(() => ({ path: `fees/${fee.id}/payments`, body: { amount: Math.round(Number(f.amount) * 100), method: f.method, paidOn: f.paidOn, reference: f.reference, accountId: f.accountId || null } }), { success: (r) => `Received — receipt ${r.payment.receiptNo}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Fee from ${who}`} description={`${fee.label} · ${fee.number} · ${inr(left)} due`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!Number(f.amount)} onClick={() => save.mutate()}>Record payment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)">{(a) => <Input {...a} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Paid by">{(a) => <Select {...a} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option></Select>}</Field>
        <Field label="On">{(a) => <Input {...a} type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />}</Field>
        <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UTR, cheque no." />}</Field>
        {!!meta.accounts.length && <Field label="Into account" className="sm:col-span-2">{(a) => <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">{f.method === "cash" ? "Cash in hand" : "The default bank account"}</option>{meta.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
      </div>
    </Dialog>
  );
}

// ── Classes ─────────────────────────────────────────────────────────────────

function ClassesView() {
  const { meta } = useEdu();
  const [edit, setEdit] = useState<Partial<Cls> | null>(null);
  const year = (() => {
    const t = today();
    const [y, m] = t.split("-").map(Number);
    const start = m >= meta.settings.yearStartMonth ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  })();
  const save = useModuleAction<void>(() => ({ path: edit?.id ? `classes/${edit.id}` : "classes", method: edit?.id ? "PUT" : "POST", body: { name: edit?.name, section: edit?.section ?? "", year: edit?.year ?? year, teacherId: edit?.teacherId || null, capacity: Number(edit?.capacity) || 0 } }), { success: "Saved", onDone: () => setEdit(null) });
  return (
    <div className="space-y-4">
      <PageHeader title="Classes" actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ year })}>Add a class</Button>} />
      {!meta.classes.length ? <Empty>No classes yet.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{meta.classes.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]"><span><b className="font-medium">{c.label}</b> <span className="text-muted">· {c.year} · {c.students} student(s){c.capacity ? ` of ${c.capacity}` : ""}{c.teacher ? ` · ${c.teacher}` : ""}</span></span>{meta.me.manage && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button>}</li>)}</ul>}
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.id ? "Edit class" : "Add a class"} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit.name?.trim()} onClick={() => save.mutate()}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class">{(a) => <Input {...a} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Class 5" />}</Field>
            <Field label="Section">{(a) => <Input {...a} value={edit.section ?? ""} onChange={(e) => setEdit({ ...edit, section: e.target.value })} placeholder="A" />}</Field>
            <Field label="Year">{(a) => <Input {...a} value={edit.year ?? year} onChange={(e) => setEdit({ ...edit, year: e.target.value })} />}</Field>
            <Field label="Class teacher">{(a) => <Select {...a} value={edit.teacherId ?? ""} onChange={(e) => setEdit({ ...edit, teacherId: e.target.value || null })}><option value="">—</option>{meta.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
            <Field label="Seats">{(a) => <Input {...a} type="number" min={0} value={edit.capacity ?? 0} onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })} />}</Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ── Fees ────────────────────────────────────────────────────────────────────

type Plan = { id: string; name: string; year: string; classIds: string[]; heads: { name: string; amount: number; concession: boolean }[]; installments: { label: string; dueDate: string; pct: number }[]; gstRate: number };

function FeesView() {
  const { meta } = useEdu();
  const [tab, setTab] = useState<"due" | "plans" | "collections">("due");
  const [view, setView] = useState("");
  const dues = useModuleQuery<{ fees: (Fee & { left: number; overdue: boolean; student: string; admissionNo: string; guardianPhone: string })[]; total: number; overdue: number }>(`fees?view=${view}`, { keepPrevious: true });
  const plans = useModuleQuery<{ plans: Plan[] }>("plans");
  const coll = useModuleQuery<{ total: number; byMethod: Record<string, number>; payments: { id: string; receiptNo: string; amount: number; method: string; paidOn: string; student: string; label: string }[] }>("collections");
  const [paying, setPaying] = useState<(Fee & { student: string }) | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const raise = useModuleAction<string, { raised: number; total: number }>((id) => ({ path: `plans/${id}/raise` }), { success: (r) => (r.raised ? `${r.raised} fee(s) raised, ${inr(r.total)}` : "Nothing new to raise") });
  return (
    <div className="space-y-4">
      <PageHeader title="Fees" actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setNewPlan(true)}>New fee plan</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "due", label: "To collect" }, { value: "plans", label: "Fee plans" }, { value: "collections", label: "Collected this month" }]} />
      {tab === "due" && (!dues.data ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[13.5px]"><span>To collect <b className="tabular-nums">{inr(dues.data.total)}</b></span><span className="text-danger">Overdue <b className="tabular-nums">{inr(dues.data.overdue)}</b></span><Select aria-label="Show" className="!w-40" value={view} onChange={(e) => setView(e.target.value)}><option value="">Everything due</option><option value="overdue">Overdue only</option></Select><ExportMenu name="fees-due" rows={dues.data.fees} columns={[{ key: "number", label: "Fee" }, { key: "student", label: "Student" }, { key: "admissionNo", label: "Admission no." }, { key: "label", label: "Instalment" }, { key: "dueDate", label: "Due" }, { key: "left", label: "To collect", money: true }, { key: "guardianPhone", label: "Guardian phone" }]} /></div>
          {!dues.data.fees.length ? <Empty>Nothing to collect.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{dues.data.fees.map((f) => <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]"><span><Link className="font-medium hover:underline" href={`/school/students/${f.studentId}`}>{f.student}</Link> <span className="text-muted">· {f.admissionNo} · {f.label} · {f.number}</span></span><span className="flex items-center gap-3"><span className={cx("text-[12.5px]", f.overdue ? "font-medium text-danger" : "text-muted")}>{f.overdue ? "Overdue · " : ""}{date(f.dueDate)}</span><b className="tabular-nums">{inr(f.left)}</b>{meta.me.write && <Button size="sm" onClick={() => setPaying(f)}>Take payment</Button>}</span></li>)}</ul>}
        </>
      ))}
      {tab === "plans" && (!plans.data ? <Skeleton className="h-40 rounded-[20px]" /> : !plans.data.plans.length ? <Empty>No fee plans yet.</Empty> : <ul className="space-y-3">{plans.data.plans.map((p) => <li key={p.id} className="rounded-[18px] border border-border bg-surface p-4 text-[13.5px]"><div className="flex flex-wrap items-center justify-between gap-2"><b className="font-medium">{p.name} <span className="text-muted">· {p.year}</span></b>{meta.me.write && <Button size="sm" loading={raise.isPending} onClick={() => raise.mutate(p.id)}>Raise fees</Button>}</div><p className="text-muted">{p.heads.map((h) => `${h.name} ${inr(h.amount)}${h.concession ? "" : " (no concession)"}`).join(" · ")}{p.gstRate ? ` · GST ${p.gstRate}%` : ""}</p><p className="text-muted">{p.installments.map((i) => `${i.label} ${i.pct}% by ${date(i.dueDate)}`).join(" · ")}</p><p className="text-muted">For {p.classIds.map((id) => meta.classes.find((c) => c.id === id)?.label ?? "?").join(", ")}</p></li>)}</ul>)}
      {tab === "collections" && (!coll.data ? <Skeleton className="h-40 rounded-[20px]" /> : <><p className="text-[13.5px]">Collected <b>{inr(coll.data.total)}</b> {Object.entries(coll.data.byMethod).map(([m, v]) => `· ${m} ${inr(v)}`).join(" ")}</p><ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{coll.data.payments.map((p) => <li key={p.id} className="flex justify-between px-4 py-2 text-[13.5px]"><span>{p.receiptNo} · {date(p.paidOn)} · {p.student} · {p.label}</span><b className="tabular-nums">{inr(p.amount)}</b></li>)}</ul></>)}
      {paying && <PayDialog fee={paying} who={paying.student} onClose={() => setPaying(null)} />}
      {newPlan && <PlanDialog onClose={() => setNewPlan(false)} />}
    </div>
  );
}

function PlanDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useEdu();
  const [f, setF] = useState({ name: "", year: meta.classes[0]?.year ?? "", classIds: [] as string[], gstRate: "0", heads: [{ name: "Tuition", amount: "", concession: true }], installments: [{ label: "Term 1", dueDate: "", pct: "50" }, { label: "Term 2", dueDate: "", pct: "50" }] });
  const save = useModuleAction<void>(() => ({ path: "plans", body: { name: f.name, year: f.year, classIds: f.classIds, gstRate: Number(f.gstRate) || 0, heads: f.heads.filter((h) => h.name && h.amount).map((h) => ({ name: h.name, amount: Math.round(Number(h.amount) * 100), concession: h.concession })), installments: f.installments.map((i) => ({ label: i.label, dueDate: i.dueDate, pct: Number(i.pct) })) } }), { success: "Fee plan saved — raise it when ready", onDone: onClose });
  const pctTotal = f.installments.reduce((n, i) => n + (Number(i.pct) || 0), 0);
  return (
    <Dialog open onClose={onClose} size="lg" title="New fee plan" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || !f.classIds.length || Math.abs(pctTotal - 100) > 0.001} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Plan">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Annual fees" />}</Field><Field label="Year">{(a) => <Input {...a} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} placeholder="2026-27" />}</Field><Field label="GST %">{(a) => <Select {...a} value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: e.target.value })}><option value="0">None (school education)</option><option value="18">18% (coaching, training)</option></Select>}</Field></div>
        <div><p className="mb-1 text-[13px] font-medium">Classes</p><div className="flex flex-wrap gap-2">{meta.classes.map((c) => { const on = f.classIds.includes(c.id); return <button key={c.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{c.label}</button>; })}</div></div>
        <div className="space-y-2"><p className="text-[13px] font-medium">Fee heads (₹ a year)</p>{f.heads.map((h, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]"><Input aria-label={`Head ${i + 1}`} value={h.name} onChange={(e) => setF({ ...f, heads: f.heads.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /><Input aria-label={`Amount ${i + 1}`} type="number" value={h.amount} onChange={(e) => setF({ ...f, heads: f.heads.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} /><label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={h.concession} onChange={(e) => setF({ ...f, heads: f.heads.map((x, j) => (j === i ? { ...x, concession: e.target.checked } : x)) })} /> concession applies</label></div>)}<Button size="sm" variant="ghost" onClick={() => setF({ ...f, heads: [...f.heads, { name: "", amount: "", concession: true }] })}>Add a head</Button></div>
        <div className="space-y-2"><p className="text-[13px] font-medium">Instalments ({pctTotal}% of 100%)</p>{f.installments.map((x, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_160px_100px]"><Input aria-label={`Instalment ${i + 1}`} value={x.label} onChange={(e) => setF({ ...f, installments: f.installments.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} /><Input aria-label={`Due ${i + 1}`} type="date" value={x.dueDate} onChange={(e) => setF({ ...f, installments: f.installments.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)) })} /><Input aria-label={`Share ${i + 1}`} type="number" value={x.pct} onChange={(e) => setF({ ...f, installments: f.installments.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)) })} /></div>)}<Button size="sm" variant="ghost" onClick={() => setF({ ...f, installments: [...f.installments, { label: `Term ${f.installments.length + 1}`, dueDate: "", pct: "0" }] })}>Add an instalment</Button></div>
      </div>
    </Dialog>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────

function AttendanceView() {
  const { meta } = useEdu();
  const [classId, setClassId] = useState(meta.classes[0]?.id ?? "");
  const [day, setDay] = useState(today());
  const q = useModuleQuery<{ students: { id: string; name: string; rollNo: number | null; status: string | null }[] }>(classId ? `attendance/${classId}?date=${day}` : null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState("");
  // Load what's saved when the class or day changes — not on every refetch, which would wipe unsaved marks.
  const key = `${classId}|${day}`;
  if (q.data && loadedFor !== key) {
    setLoadedFor(key);
    setMarks(Object.fromEntries(q.data.students.map((s) => [s.id, s.status ?? ""])));
  }
  const save = useModuleAction<void>(() => ({ path: `attendance/${classId}`, body: { date: day, marks: Object.entries(marks).filter(([, v]) => v).map(([studentId, status]) => ({ studentId, status })) } }), { success: "Attendance saved" });
  if (!meta.classes.length) return <Empty>Add a class first.</Empty>;
  return (
    <div className="space-y-4">
      <PageHeader title="Attendance" />
      <div className="flex flex-wrap items-end gap-2"><Field label="Class">{(a) => <Select {...a} value={classId} onChange={(e) => setClassId(e.target.value)}>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.year})</option>)}</Select>}</Field><Field label="Day">{(a) => <Input {...a} type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} />}</Field>{meta.me.write && <Button disabled={!q.data?.students.length} onClick={() => q.data && setMarks(Object.fromEntries(q.data.students.map((s) => [s.id, "present"])))}>Everyone present</Button>}</div>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.students.length ? <Empty>No students in this class.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.students.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13.5px]">
              <span>{s.rollNo !== null && <span className="mr-2 text-muted tabular-nums">{s.rollNo}</span>}{s.name}</span>
              <span className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                {(["present", "absent", "late", "leave"] as const).map((st) => <button key={st} type="button" role="radio" aria-checked={marks[s.id] === st} disabled={!meta.me.write} onClick={() => setMarks({ ...marks, [s.id]: st })} className={cx("rounded-full border px-2.5 py-0.5 text-[12px] capitalize", marks[s.id] === st ? (st === "absent" ? "border-danger bg-danger text-white" : "border-fg bg-fg text-bg") : "border-border text-muted")}>{st}</button>)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {meta.me.write && <Button variant="primary" loading={save.isPending} disabled={!Object.values(marks).some(Boolean)} onClick={() => save.mutate()}>Save attendance</Button>}
    </div>
  );
}

// ── Exams ───────────────────────────────────────────────────────────────────

type Exam = { id: string; name: string; classId: string; date: string | null; subjects: { name: string; max: number }[] };

function ExamsView() {
  const { meta, go } = useEdu();
  const q = useModuleQuery<{ exams: Exam[] }>("exams");
  const [f, setF] = useState<{ name: string; classId: string; date: string; subjects: { name: string; max: string }[] } | null>(null);
  const save = useModuleAction<void, { exam: { id: string } }>(() => ({ path: "exams", body: { name: f?.name, classId: f?.classId, date: f?.date || null, subjects: f?.subjects.filter((x) => x.name).map((x) => ({ name: x.name, max: Number(x.max) || 100 })) } }), { success: "Exam added", onDone: (r) => go(`exams/${r.exam.id}`) });
  return (
    <div className="space-y-4">
      <PageHeader title="Exams" actions={meta.me.write && meta.classes.length > 0 && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setF({ name: "", classId: meta.classes[0].id, date: today(), subjects: [{ name: "Maths", max: "100" }, { name: "English", max: "100" }] })}>Add an exam</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.exams.length ? <Empty>No exams yet.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{q.data.exams.map((e) => <li key={e.id} className="flex cursor-pointer justify-between px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`exams/${e.id}`)}><span><b className="font-medium">{e.name}</b> <span className="text-muted">· {meta.classes.find((c) => c.id === e.classId)?.label} · {e.subjects.length} subject(s)</span></span><span className="text-muted">{date(e.date)}</span></li>)}</ul>}
      {f && (
        <Dialog open onClose={() => setF(null)} title="Add an exam" footer={<><Button onClick={() => setF(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Add</Button></>}>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3"><Field label="Exam">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Half-yearly" />}</Field><Field label="Class">{(a) => <Select {...a} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>{meta.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field><Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field></div>
            {f.subjects.map((x, i) => <div key={i} className="grid grid-cols-[1fr_120px] gap-2"><Input aria-label={`Subject ${i + 1}`} value={x.name} onChange={(e) => setF({ ...f, subjects: f.subjects.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} /><Input aria-label={`Out of ${i + 1}`} type="number" value={x.max} onChange={(e) => setF({ ...f, subjects: f.subjects.map((y, j) => (j === i ? { ...y, max: e.target.value } : y)) })} /></div>)}
            <Button size="sm" variant="ghost" onClick={() => setF({ ...f, subjects: [...f.subjects, { name: "", max: "100" }] })}>Add a subject</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

type SheetRow = { id: string; name: string; rollNo: number | null; admissionNo: string; marks: Record<string, number | null>; rank: number | null; card: { rows: { subject: string; marks: number | null; max: number; pct: number | null; grade: string | null; passed: boolean | null }[]; total: number; max: number; pct: number | null; grade: string | null; result: string | null } };

function ExamSheet({ id }: { id: string }) {
  const { meta } = useEdu();
  const q = useModuleQuery<{ exam: Exam; students: SheetRow[] }>(`exams/${id}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [card, setCard] = useState<SheetRow | null>(null);
  const save = useModuleAction<void>(() => ({ path: `exams/${id}/marks`, body: { marks: Object.entries(edits).map(([k, v]) => { const [studentId, subject] = k.split("|"); return { studentId, subject, marks: v === "" ? null : Number(v) }; }) } }), { success: "Marks saved", onDone: () => setEdits({}) });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { exam, students } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={exam.name} description={`${meta.classes.find((c) => c.id === exam.classId)?.label ?? ""} · ${date(exam.date)}`} actions={meta.me.write && <Button variant="primary" loading={save.isPending} disabled={!Object.keys(edits).length} onClick={() => save.mutate()}>Save marks</Button>} />
      <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-3 py-2 font-medium">Student</th>{exam.subjects.map((s) => <th key={s.name} className="px-3 py-2 font-medium">{s.name} <span className="text-subtle">/{s.max}</span></th>)}<th className="px-3 py-2 text-right font-medium">%</th><th className="px-3 py-2 font-medium">Grade</th><th className="px-3 py-2 font-medium">Rank</th></tr></thead>
          <tbody className="divide-y divide-border">
            {students.map((st) => (
              <tr key={st.id}>
                <td className="px-3 py-1.5"><button type="button" className="text-left hover:underline" onClick={() => setCard(st)}>{st.name}</button></td>
                {exam.subjects.map((s) => { const k = `${st.id}|${s.name}`; return <td key={s.name} className="px-3 py-1.5"><Input aria-label={`${s.name} for ${st.name}`} className="!h-8 !w-20" type="number" min={0} max={s.max} disabled={!meta.me.write} value={edits[k] ?? (st.marks[s.name] ?? "")} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} /></td>; })}
                <td className="px-3 py-1.5 text-right tabular-nums">{st.card.pct ?? "—"}</td>
                <td className="px-3 py-1.5">{st.card.grade ?? "—"}{st.card.result === "fail" && <Badge tone="danger" className="ml-1">Fail</Badge>}</td>
                <td className="px-3 py-1.5 tabular-nums">{st.rank ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card && (
        <Dialog open onClose={() => setCard(null)} title={`Report card · ${card.name}`} description={`${exam.name} · ${card.admissionNo}${card.rollNo !== null ? ` · roll ${card.rollNo}` : ""}`} footer={<><Button onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={() => setCard(null)}>Close</Button></>}>
          <table className="w-full text-[13.5px]"><thead className="text-left text-muted"><tr><th className="py-1 font-medium">Subject</th><th className="py-1 text-right font-medium">Marks</th><th className="py-1 text-right font-medium">%</th><th className="py-1 font-medium">Grade</th></tr></thead><tbody>{card.card.rows.map((r) => <tr key={r.subject}><td className="py-1">{r.subject}</td><td className="py-1 text-right tabular-nums">{r.marks ?? "—"}/{r.max}</td><td className="py-1 text-right tabular-nums">{r.pct ?? "—"}</td><td className="py-1">{r.grade ?? "—"}</td></tr>)}<tr className="border-t border-border font-medium"><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{card.card.total}/{card.card.max}</td><td className="py-1 text-right tabular-nums">{card.card.pct ?? "—"}</td><td className="py-1">{card.card.grade ?? "—"}</td></tr></tbody></table>
          <p className="mt-3 text-[13.5px]">Result: <b>{card.card.result === "pass" ? "Pass" : card.card.result === "fail" ? "Needs improvement" : card.card.result === "incomplete" ? "Marks not complete" : "—"}</b>{card.rank ? ` · Rank ${card.rank}` : ""}</p>
        </Dialog>
      )}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsView() {
  const { meta } = useEdu();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: f }), { success: "Settings saved" });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Education settings" />
      <div className="grid gap-3 rounded-[20px] border border-border bg-surface p-5 sm:grid-cols-2">
        <Field label="Academic year starts in">{(a) => <Select {...a} value={f.yearStartMonth} onChange={(e) => setF({ ...f, yearStartMonth: Number(e.target.value) })}>{["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}</Field>
        <Field label="Remind guardians (days before due)">{(a) => <Input {...a} type="number" min={0} max={30} value={f.remindDays} onChange={(e) => setF({ ...f, remindDays: Number(e.target.value) })} />}</Field>
        <Field label="Fee number prefix">{(a) => <Input {...a} value={f.feePrefix} onChange={(e) => setF({ ...f, feePrefix: e.target.value })} />}</Field>
        <Field label="Receipt prefix">{(a) => <Input {...a} value={f.receiptPrefix} onChange={(e) => setF({ ...f, receiptPrefix: e.target.value })} />}</Field>
        <Field label="Pass mark (%)">{(a) => <Input {...a} type="number" min={0} max={100} value={f.passPct} onChange={(e) => setF({ ...f, passPct: Number(e.target.value) })} />}</Field>
      </div>
      <Notice>Grades: {f.grades.map((g) => `${g.grade} ≥ ${g.min}%`).join(", ")}</Notice>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
