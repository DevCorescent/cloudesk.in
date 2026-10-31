"use client";

// People: the directory, adding someone, their profile (details, job and pay,
// time off, payslips, letters, history) and the org chart.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { ArrowLeft, Check, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Link2, LogOut, Mail, Pencil, Phone, Plus, Printer, Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Dialog, Menu, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { ExportMenu } from "@/components/import/buttons";
import { SmartImport } from "@/components/import/smart-import";
import { api, errorMessage } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { EMPLOYMENT_LABEL, EMPLOYMENT_TYPES } from "@/lib/hr/model";
import { Balances, type Balance } from "./me";
import { Avatar, Empty, Section, StatusPill, deptName, hrApi, fmt, fromPaise, inr, lakh, locName, monthLabel, personName, toPaise, todayIst, useHr, useHrAction, useHrParts, useHrQuery } from "./shared";
import { LinkedDocuments } from "@/components/documents/linked";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Row = { id: string; empNo: string; name: string; email: string; phone: string; designation: string; departmentId: string | null; locationId: string | null; managerId: string | null; employmentType: string; joinDate: string; status: string; userId: string | null; ctc?: number };

export function PeopleView() {
  const { meta, go, orgId } = useHr();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useHrQuery<{ people: Row[] }>(`people?${new URLSearchParams({ q, ...(dept ? { departmentId: dept } : {}), ...(status ? { status } : {}) })}`, { keepPrevious: true });
  const importHoreca = useHrAction<void, { created: number; total: number }>(() => ({ path: "people/import-horeca" }), { success: (r) => (r.created ? `Added ${r.created} from the Horeca till` : "Everyone at the till is already here") });
  const rows = list.data?.people ?? [];
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();
  return (
    <div>
      <PageHeader
        title="People"
        description={list.data ? `${rows.length} ${status === "exited" ? "who've left" : "people"}` : "Everyone who works here."}
        actions={
          meta.me.manage ? (
            <div className="flex gap-2">
              <Menu
                label="More"
                trigger={(p) => (
                  <Button {...p} size="sm">
                    Import
                  </Button>
                )}
                items={[
                  { label: "From a spreadsheet (Excel or CSV)", icon: <FileSpreadsheet className="size-4" />, onSelect: () => setImporting(true) },
                  { label: "From the Horeca till staff", icon: <Users className="size-4" />, onSelect: () => importHoreca.mutate() },
                ]}
              />
              <ExportMenu
                name="people"
                rows={rows}
                columns={[
                  { key: "empNo", label: "Employee no" },
                  { key: "name", label: "Name" },
                  { key: "email", label: "Work email" },
                  { key: "phone", label: "Phone" },
                  { key: "designation", label: "Designation" },
                  { key: "departmentId", label: "Department", format: (v) => deptName(meta, v as string | null) },
                  { key: "locationId", label: "Location", format: (v) => locName(meta, v as string | null) },
                  { key: "managerId", label: "Reports to", format: (v) => personName(meta, v as string | null) },
                  { key: "employmentType", label: "Type" },
                  { key: "joinDate", label: "Joining date" },
                  { key: "status", label: "Status" },
                  ...(meta.me.payroll ? [{ key: "ctc", label: "CTC (yearly)", money: true }] : []),
                ]}
              />
              <Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
                Add person
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Find someone" className="!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, role or employee no" />
        </div>
        <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {meta.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Current</option>
          <option value="exited">Left</option>
          <option value="all">Everyone</option>
        </Select>
      </div>
      {!list.data ? (
        <Skeleton className="h-64 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<Users />} title={q || dept ? "No one matches" : "No one here yet"} description="Add the people who work for you — their job, salary and bank details power attendance, leave and payroll." action={meta.me.manage && !q ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add the first person</Button> : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <button key={p.id} type="button" onClick={() => go(`people/${p.id}`)} className="flex items-center gap-3 rounded-[18px] border border-border bg-surface p-3.5 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md">
              <Avatar name={p.name} size={44} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14px]">{p.name}</b>
                <span className="block truncate text-[12.5px] text-muted">{p.designation || "—"}</span>
                <span className="block truncate text-[11.5px] text-subtle">
                  {deptName(meta, p.departmentId)} · {p.empNo}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {p.status !== "active" && <StatusPill status={p.status} />}
                {meta.me.payroll && p.ctc !== undefined && <span className="text-[11.5px] text-muted tabular-nums">{p.ctc ? `${lakh(p.ctc)}/yr` : "No salary"}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {importing && <SmartImport target={target("hr.people")} onClose={() => setImporting(false)} onImport={(r, mode) => api(hrApi(orgId, "people/import"), { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["hr"] })} />}
      {adding && <PersonDialog onClose={() => setAdding(false)} onSaved={(id) => go(`people/${id}`)} />}
    </div>
  );
}

type Full = Row & { personalEmail: string; dob: string | null; gender: string; address: string; emergency: { name?: string; phone?: string; relation?: string }; probationEnd: string | null; noticeFrom: string | null; exitDate: string | null; exitReason: string; ctc: number | null; salary: Record<string, number>; bank: { name?: string; account?: string; ifsc?: string }; ids: { pan?: string; uan?: string; esic?: string; aadhaarLast4?: string }; canSeePay: boolean };
type Profile = {
  employee: Full;
  limited: boolean;
  structure: { monthlyCtc: number; basic: number; hra: number; special: number; gross: number; employerPf: number; employerEsi: number; esiApplies: boolean } | null;
  events: { id: string; kind: string; subject: string; createdAt: string; meta: Record<string, unknown> }[];
  checklists: { id: string; kind: string; items: { id: string; title: string; owner: string; done: boolean; doneAt: string | null }[] }[];
  assets: { id: string; name: string; tag: string; category: string }[];
  manager: { id: string; name: string; designation: string } | null;
  reports: { id: string; name: string; designation: string }[];
};

export function PersonPage({ id, tab }: { id: string; tab?: string }) {
  const { meta, go } = useHr();
  const part = useHrParts();
  const q = useHrQuery<Profile>(`people/${id}`);
  const [editing, setEditing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const t = (["overview", "pay", "time", "payslips"].includes(tab ?? "") ? tab : "overview") as "overview" | "pay" | "time" | "payslips";
  const invite = useHrAction(() => ({ path: `people/${id}/invite` }), { success: "Invitation sent — they're linked when they accept" });
  const stay = useHrAction(() => ({ path: `people/${id}/stay` }), { success: "Exit withdrawn" });
  const tick = useHrAction<{ kind: string; itemId: string; done: boolean }>((b) => ({ path: `people/${id}/checklist`, body: b }));
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const e = q.data.employee;
  const back = (
    <Link href="/hr/people" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
      <ArrowLeft className="size-3.5" /> People
    </Link>
  );
  if (q.data.limited)
    return (
      <div>
        {back}
        <section className="flex flex-wrap items-center gap-4 rounded-[24px] border border-border bg-surface p-6 shadow-sm">
          <Avatar name={e.name} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{e.name}</h1>
            <p className="text-[14px] text-muted">{[e.designation, deptName(meta, e.departmentId), locName(meta, e.locationId)].filter((x) => x && x !== "—").join(" · ")}</p>
            <p className="mt-2 flex flex-wrap gap-4 text-[13px]">
              {e.email && <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3.5" />{e.email}</a>}
              {e.phone && <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" />{e.phone}</a>}
              {e.managerId && <span className="text-muted">Reports to {personName(meta, e.managerId)}</span>}
            </p>
          </div>
        </section>
      </div>
    );
  const onboarding = q.data.checklists.find((c) => c.kind === "onboarding");
  const offboarding = q.data.checklists.find((c) => c.kind === "offboarding");
  return (
    <div>
      {back}
      <header className="mb-5 rounded-[24px] border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={e.name} size={60} />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-[24px] leading-tight font-semibold tracking-[-0.02em]">
              {e.name} {e.status !== "active" && <StatusPill status={e.status} />}
            </h1>
            <p className="mt-0.5 text-[13.5px] text-muted">
              {[e.designation || "—", deptName(meta, e.departmentId), locName(meta, e.locationId)].join(" · ")}
            </p>
            <p className="mt-1 text-[12.5px] text-subtle">
              {e.empNo} · {EMPLOYMENT_LABEL[e.employmentType]} · joined {fmt(e.joinDate)}
              {e.exitDate ? ` · last day ${fmt(e.exitDate)}` : ""}
              {q.data.manager ? ` · reports to ${q.data.manager.name}` : ""}
            </p>
          </div>
          {e.email && <EmailButton to={[e]} title={`Email ${e.name}`} />}
          <ShareToChatButton card={{ kind: "employees", id: e.id, title: e.name, sub: [e.designation, e.empNo].filter(Boolean).join(" · "), link: `/hr/people/${e.id}`, module: "Person", fields: [{ label: "Type", value: e.employmentType }, { label: "Joined", value: e.joinDate }, { label: "Status", value: e.status }] }} />
          {meta.me.manage && (
            <div className="flex flex-wrap gap-2">
              {!e.userId && e.email && (
                <Button size="sm" icon={<Mail className="size-3.5" />} loading={invite.isPending} onClick={() => invite.mutate()}>
                  Invite to self-service
                </Button>
              )}
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Menu
                label="More"
                trigger={(p) => (
                  <Button {...p} size="sm">
                    More
                  </Button>
                )}
                items={[
                  { label: e.userId ? "Change linked account" : "Link an existing account", icon: <Link2 className="size-4" />, onSelect: () => setLinking(true) },
                  ...meta.settings.letters.map((l) => ({ label: l.name, icon: <FileText className="size-4" />, onSelect: () => setLetter(l.id) })),
                  "separator" as const,
                  e.status === "active" ? { label: "Start exit (resignation)", icon: <LogOut className="size-4" />, danger: true, onSelect: () => setExiting(true) } : { label: "Withdraw exit", icon: <Check className="size-4" />, onSelect: () => stay.mutate() },
                ]}
              />
            </div>
          )}
        </div>
        {!e.userId && meta.me.manage && <p className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-muted">Not linked to a sign-in yet, so they can&apos;t check in or see payslips. {e.email ? "Invite them — they join as an Employee and see only their own HR." : "Add their work email to invite them."}</p>}
      </header>
      <CustomFieldsCard entity="hr.employee" id={id} className="mb-5" />
      <Tabs
        value={t}
        onChange={(v) => go(`people/${id}/${v}`)}
        className="mb-5"
        tabs={[
          { value: "overview", label: "Overview" },
          ...(e.canSeePay ? [{ value: "pay" as const, label: "Job & pay" }] : []),
          ...(part("attendance") || part("leave") ? [{ value: "time" as const, label: "Time off & attendance" }] : []),
          ...(e.canSeePay && part("payroll") ? [{ value: "payslips" as const, label: "Payslips" }] : []),
        ]}
      />
      {t === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-5">
            {offboarding && <Checklist title="Leaving checklist" kind="offboarding" items={offboarding.items} onTick={(itemId, done) => tick.mutate({ kind: "offboarding", itemId, done })} />}
            {onboarding && <Checklist title="Joining checklist" kind="onboarding" items={onboarding.items} onTick={(itemId, done) => tick.mutate({ kind: "onboarding", itemId, done })} />}
            <Section title="History">
              {!q.data.events.length ? (
                <Empty>Nothing yet.</Empty>
              ) : (
                <ol className="grid gap-3">
                  {q.data.events.map((ev) => (
                    <li key={ev.id} className="flex gap-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                      <span className="min-w-0 flex-1">
                        <b className="block text-[13.5px] font-medium">{ev.subject}</b>
                        <span className="text-[11.5px] text-subtle">{fmt(ev.createdAt.slice(0, 10))}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
          <div className="grid content-start gap-5">
            <Section title="Details">
              <dl className="grid gap-2 text-[13px]">
                <Row label="Work email">{e.email || "—"}</Row>
                <Row label="Phone">{e.phone || "—"}</Row>
                <Row label="Personal email">{e.personalEmail || "—"}</Row>
                <Row label="Birthday">{e.dob ? fmt(e.dob, { day: "numeric", month: "long" }) : "—"}</Row>
                <Row label="Address">{e.address || "—"}</Row>
                <Row label="Emergency">{e.emergency?.name ? `${e.emergency.name}${e.emergency.relation ? ` (${e.emergency.relation})` : ""} · ${e.emergency.phone ?? ""}` : "—"}</Row>
                <Row label="Probation">{e.probationEnd ? `until ${fmt(e.probationEnd)}` : "—"}</Row>
                {e.exitReason && <Row label="Leaving">{e.exitReason}</Row>}
              </dl>
            </Section>
            <Section title={q.data.reports.length ? `Reporting line · ${q.data.reports.length} direct` : "Reporting line"}>
              {q.data.manager && (
                <Link href={`/hr/people/${q.data.manager.id}`} className="mb-2 flex items-center gap-2.5 rounded-[12px] p-1.5 hover:bg-surface-2">
                  <Avatar name={q.data.manager.name} size={28} />
                  <span className="text-[13px]">
                    <b className="font-medium">{q.data.manager.name}</b> <span className="text-muted">· manager</span>
                  </span>
                </Link>
              )}
              {q.data.reports.map((r) => (
                <Link key={r.id} href={`/hr/people/${r.id}`} className="flex items-center gap-2.5 rounded-[12px] p-1.5 hover:bg-surface-2">
                  <Avatar name={r.name} size={28} />
                  <span className="text-[13px]">
                    <b className="font-medium">{r.name}</b> <span className="text-muted">· {r.designation}</span>
                  </span>
                </Link>
              ))}
              {!q.data.manager && !q.data.reports.length && <p className="text-[13px] text-muted">No manager or reports set.</p>}
            </Section>
            {q.data.assets.length > 0 && (
              <Section title="Assets">
                <ul className="grid gap-1 text-[13px]">
                  {q.data.assets.map((a) => (
                    <li key={a.id}>
                      {a.name} {a.tag && <span className="text-muted">· {a.tag}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {meta.me.manage && <LinkedDocuments type="hr_employee" id={id} />}
          </div>
        </div>
      )}
      {t === "pay" && <PayTab profile={q.data} />}
      {t === "time" && <TimeTab id={id} />}
      {t === "payslips" && <PayslipsTab id={id} />}
      {editing && <PersonDialog init={e} onClose={() => setEditing(false)} />}
      {exiting && <ExitDialog id={id} name={e.name} onClose={() => setExiting(false)} />}
      {linking && <LinkDialog id={id} current={e.userId} onClose={() => setLinking(false)} />}
      {letter && <LetterDialog id={id} template={letter} onClose={() => setLetter(null)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const OWNER: Record<string, string> = { hr: "HR", manager: "Manager", employee: "Them", it: "IT" };
function Checklist({ title, items, onTick }: { title: string; kind: string; items: { id: string; title: string; owner: string; done: boolean; doneAt: string | null }[]; onTick: (id: string, done: boolean) => void }) {
  const done = items.filter((i) => i.done).length;
  return (
    <Section title={`${title} · ${done}/${items.length}`}>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-success" style={{ width: `${(done / Math.max(1, items.length)) * 100}%` }} />
      </div>
      <ul className="grid gap-1">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" checked={i.done} onChange={(e) => onTick(i.id, e.target.checked)} />
              <span className={cx("flex-1 text-[13.5px]", i.done && "text-subtle line-through")}>{i.title}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{OWNER[i.owner] ?? i.owner}</span>
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PayTab({ profile }: { profile: Profile }) {
  const e = profile.employee;
  const s = profile.structure;
  const ids = e.ids ?? {};
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Section title={`Salary · ${e.ctc ? `${inr(e.ctc)} a year` : "not set"}`}>
        {!s ? (
          <Empty>No salary yet — edit to set their CTC. They won&apos;t be in payroll until it&apos;s set.</Empty>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="pb-2 font-medium">Component</th>
                <th className="pb-2 text-right font-medium">Monthly</th>
                <th className="pb-2 text-right font-medium">Yearly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Basic", s.basic],
                ["House rent allowance", s.hra],
                ["Special allowance", s.special],
              ].map(([l, v]) => (
                <tr key={l as string}>
                  <td className="py-2">{l}</td>
                  <td className="py-2 text-right tabular-nums">{inr(v as number)}</td>
                  <td className="py-2 text-right tabular-nums">{inr((v as number) * 12)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2">Gross</td>
                <td className="py-2 text-right tabular-nums">{inr(s.gross)}</td>
                <td className="py-2 text-right tabular-nums">{inr(s.gross * 12)}</td>
              </tr>
              {s.employerPf > 0 && (
                <tr className="text-muted">
                  <td className="py-2">Employer PF</td>
                  <td className="py-2 text-right tabular-nums">{inr(s.employerPf)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(s.employerPf * 12)}</td>
                </tr>
              )}
              {s.employerEsi > 0 && (
                <tr className="text-muted">
                  <td className="py-2">Employer ESI</td>
                  <td className="py-2 text-right tabular-nums">{inr(s.employerEsi)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(s.employerEsi * 12)}</td>
                </tr>
              )}
              <tr className="font-semibold">
                <td className="py-2">Cost to company</td>
                <td className="py-2 text-right tabular-nums">{inr(s.monthlyCtc)}</td>
                <td className="py-2 text-right tabular-nums">{inr(e.ctc ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {s?.esiApplies && <p className="mt-3 text-[12px] text-muted">ESI applies (gross up to ₹21,000 a month).</p>}
      </Section>
      <div className="grid content-start gap-5">
        <Section title="Bank">
          <dl className="grid gap-2 text-[13px]">
            <Row label="Account name">{e.bank?.name || "—"}</Row>
            <Row label="Account">{e.bank?.account || "—"}</Row>
            <Row label="IFSC">{e.bank?.ifsc || "—"}</Row>
          </dl>
        </Section>
        <Section title="Statutory">
          <dl className="grid gap-2 text-[13px]">
            <Row label="PAN">{ids.pan || "—"}</Row>
            <Row label="UAN (PF)">{ids.uan || "—"}</Row>
            <Row label="ESIC no">{ids.esic || "—"}</Row>
            <Row label="Aadhaar">{ids.aadhaarLast4 ? `•••• ${ids.aadhaarLast4}` : "—"}</Row>
          </dl>
          <p className="mt-2 text-[11.5px] text-subtle">Only the last four digits of Aadhaar are kept.</p>
        </Section>
      </div>
    </div>
  );
}

function TimeTab({ id }: { id: string }) {
  const { meta } = useHr();
  const bal = useHrQuery<{ balances: Balance[] }>(`people/${id}/balances`);
  const [adjust, setAdjust] = useState(false);
  return (
    <div className="grid gap-5">
      <Section title="Leave balances" action={meta.me.manage ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdjust(true)}>Adjust</Button> : undefined}>
        {bal.data ? <Balances items={bal.data.balances} /> : <Skeleton className="h-24 rounded-[16px]" />}
      </Section>
      <Notice>The month&apos;s attendance for everyone is on Attendance; requests are on Leave.</Notice>
      {adjust && <AdjustLeave id={id} onClose={() => setAdjust(false)} />}
    </div>
  );
}

function AdjustLeave({ id, onClose }: { id: string; onClose: () => void }) {
  const { meta } = useHr();
  const types = meta.leaveTypes.filter((t) => t.active && t.accrual !== "none");
  const [f, setF] = useState({ leaveTypeId: types[0]?.id ?? "", days: "", reason: "" });
  const save = useHrAction(() => ({ path: "leave/adjust", body: { employeeId: id, leaveTypeId: f.leaveTypeId, days: Number(f.days), reason: f.reason } }), { success: "Balance adjusted", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title="Adjust leave" description="Add days (or take them away with a minus) for this year." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!Number(f.days)} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Select aria-label="Type" value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input aria-label="Days" inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} placeholder="2 or -1" />
        <Input aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Comp-off for Saturday event" maxLength={200} />
      </div>
    </Dialog>
  );
}

function PayslipsTab({ id }: { id: string }) {
  const q = useHrQuery<{ payslips: { id: string; month: string; status: string; gross: number; net: number }[] }>(`people/${id}/payslips`);
  if (!q.data) return <Skeleton className="h-32 rounded-[20px]" />;
  if (!q.data.payslips.length) return <Empty>No payslips yet.</Empty>;
  return (
    <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 shadow-sm">
      {q.data.payslips.map((p) => (
        <li key={p.id}>
          <Link href={`/hr/payslips/${p.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
            <b className="text-[13.5px] font-medium">{monthLabel(p.month)}</b>
            <span className="flex items-center gap-4 text-[13px] tabular-nums">
              <span className="text-muted">gross {inr(p.gross)}</span>
              <b>{inr(p.net)}</b>
              <StatusPill status={p.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PersonDialog({ init, onClose, onSaved }: { init?: Partial<Full>; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useHr();
  const editing = !!init?.id;
  const [step, setStep] = useState<"basics" | "job" | "pay">("basics");
  const [f, setF] = useState({
    name: init?.name ?? "",
    email: init?.email ?? "",
    phone: init?.phone ?? "",
    personalEmail: init?.personalEmail ?? "",
    dob: init?.dob ?? "",
    gender: init?.gender ?? "",
    address: init?.address ?? "",
    designation: init?.designation ?? "",
    departmentId: init?.departmentId ?? "",
    locationId: init?.locationId ?? "",
    costCentreId: (init as { costCentreId?: string | null } | undefined)?.costCentreId ?? "",
    managerId: init?.managerId ?? "",
    employmentType: init?.employmentType ?? "full_time",
    joinDate: init?.joinDate ?? todayIst(),
    probationEnd: init?.probationEnd ?? "",
    ctc: fromPaise(init?.ctc ?? 0),
    bank: { name: init?.bank?.name ?? "", account: init?.bank?.account ?? "", ifsc: init?.bank?.ifsc ?? "" },
    ids: { pan: init?.ids?.pan ?? "", uan: init?.ids?.uan ?? "", esic: init?.ids?.esic ?? "", aadhaarLast4: init?.ids?.aadhaarLast4 ?? "" },
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = useMemo(() => {
    const b: Record<string, unknown> = { ...f, dob: f.dob || null, probationEnd: f.probationEnd || null, departmentId: f.departmentId || null, locationId: f.locationId || null, costCentreId: f.costCentreId || null, managerId: f.managerId || null, ctc: toPaise(f.ctc) };
    if (!meta.me.payroll) {
      delete b.ctc;
      delete b.bank;
    }
    return b;
  }, [f, meta.me.payroll]);
  const save = useHrAction<void, { employee: { id: string } }>(() => ({ path: editing ? `people/${init!.id}` : "people", method: editing ? "PUT" : "POST", body }), { success: editing ? "Saved" : "Added — their joining checklist is ready", onDone: (r) => (onClose(), onSaved?.(r.employee.id)) });
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${init?.name}` : "Add a person"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!editing && step !== "pay" ? (
            <Button variant="primary" disabled={!f.name.trim()} onClick={() => setStep(step === "basics" ? "job" : "pay")}>
              Next
            </Button>
          ) : (
            <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.joinDate} onClick={() => save.mutate()}>
              {editing ? "Save" : "Add person"}
            </Button>
          )}
        </>
      }
    >
      <Tabs
        value={step}
        onChange={setStep}
        className="mb-4"
        tabs={[
          { value: "basics", label: "1 · About them" },
          { value: "job", label: "2 · Job" },
          { value: "pay", label: "3 · Pay & bank" },
        ]}
      />
      {step === "basics" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">{(a) => <Input {...a} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoFocus />}</Field>
          <Field label="Work email" hint="They're invited with this — and linked when they accept.">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />}</Field>
          <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} />}</Field>
          <Field label="Personal email">{(a) => <Input {...a} type="email" value={f.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} maxLength={200} />}</Field>
          <Field label="Date of birth">{(a) => <Input {...a} type="date" value={f.dob ?? ""} onChange={(e) => set("dob", e.target.value)} />}</Field>
          <Field label="Gender" hint="Some states' professional tax depends on it.">
            {(a) => (
              <Select {...a} value={f.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Address" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={400} />}</Field>
        </div>
      )}
      {step === "job" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Designation">{(a) => <Input {...a} value={f.designation} onChange={(e) => set("designation", e.target.value)} maxLength={120} placeholder="Sales Executive" />}</Field>
          <Field label="Type">
            {(a) => (
              <Select {...a} value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYMENT_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Department">
            {(a) => (
              <Select {...a} value={f.departmentId ?? ""} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">—</option>
                {meta.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Location">
            {(a) => (
              <Select {...a} value={f.locationId ?? ""} onChange={(e) => set("locationId", e.target.value)}>
                <option value="">—</option>
                {meta.locations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(meta.units?.length ?? 0) > 0 && (
            <Field label="Cost centre" hint="Where their pay is charged in the books">
              {(a) => (
                <Select {...a} value={f.costCentreId} onChange={(e) => set("costCentreId", e.target.value)}>
                  <option value="">—</option>
                  {meta.units!.map((u) => (
                    <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Reports to">
            {(a) => (
              <Select {...a} value={f.managerId ?? ""} onChange={(e) => set("managerId", e.target.value)}>
                <option value="">Nobody</option>
                {meta.people
                  .filter((p) => p.id !== init?.id && p.status !== "exited")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Joining date">{(a) => <Input {...a} type="date" value={f.joinDate} onChange={(e) => set("joinDate", e.target.value)} />}</Field>
          <Field label="Probation until">{(a) => <Input {...a} type="date" value={f.probationEnd ?? ""} onChange={(e) => set("probationEnd", e.target.value)} />}</Field>
        </div>
      )}
      {step === "pay" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {meta.me.payroll ? (
            <>
              <Field label="CTC per year (₹)" hint="Cost to company, including employer PF.">{(a) => <Input {...a} inputMode="decimal" value={f.ctc} onChange={(e) => set("ctc", e.target.value)} placeholder="600000" />}</Field>
              <div className="self-end rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{toPaise(f.ctc) ? `${inr(Math.round(toPaise(f.ctc) / 12))} a month before deductions and employer PF` : "Leave blank to keep them out of payroll"}</div>
              <Field label="Bank account name">{(a) => <Input {...a} value={f.bank.name} onChange={(e) => set("bank", { ...f.bank, name: e.target.value })} />}</Field>
              <Field label="Account number">{(a) => <Input {...a} inputMode="numeric" value={f.bank.account} onChange={(e) => set("bank", { ...f.bank, account: e.target.value.replace(/\s/g, "") })} />}</Field>
              <Field label="IFSC">{(a) => <Input {...a} value={f.bank.ifsc} onChange={(e) => set("bank", { ...f.bank, ifsc: e.target.value.toUpperCase() })} maxLength={11} />}</Field>
            </>
          ) : (
            <p className="text-[13px] text-muted sm:col-span-2">Salary and bank details are set by payroll (owners, admins and billing).</p>
          )}
          <Field label="PAN">{(a) => <Input {...a} value={f.ids.pan} onChange={(e) => set("ids", { ...f.ids, pan: e.target.value.toUpperCase() })} maxLength={10} />}</Field>
          <Field label="UAN (PF)">{(a) => <Input {...a} value={f.ids.uan} onChange={(e) => set("ids", { ...f.ids, uan: e.target.value })} maxLength={12} />}</Field>
          <Field label="ESIC number">{(a) => <Input {...a} value={f.ids.esic} onChange={(e) => set("ids", { ...f.ids, esic: e.target.value })} maxLength={17} />}</Field>
          <Field label="Aadhaar — last 4 digits">{(a) => <Input {...a} inputMode="numeric" value={f.ids.aadhaarLast4} onChange={(e) => set("ids", { ...f.ids, aadhaarLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />}</Field>
        </div>
      )}
    </Dialog>
  );
}

function ExitDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [f, setF] = useState({ lastDay: "", reason: "" });
  const save = useHrAction(() => ({ path: `people/${id}/exit`, body: f }), { success: "Exit started — their leaving checklist is ready", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`${name} is leaving`} description="They stay active (on notice) until their last day, then move to Left. Payroll pays them up to the last day." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={save.isPending} disabled={!f.lastDay} onClick={() => save.mutate()}>Start exit</Button></>}>
      <div className="grid gap-4">
        <Field label="Last working day">{(a) => <Input {...a} type="date" value={f.lastDay} onChange={(e) => setF({ ...f, lastDay: e.target.value })} />}</Field>
        <Field label="Reason">{(a) => <Input {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Resigned — moving cities" maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

function LinkDialog({ id, current, onClose }: { id: string; current: string | null; onClose: () => void }) {
  const { meta } = useHr();
  const [userId, setUser] = useState(current ?? "");
  const save = useHrAction(() => ({ path: `people/${id}/link`, body: { userId: userId || null } }), { success: "Linked", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="sm" title="Link a sign-in" description="Someone already in this workspace. They'll see their own HR on the HR page." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <Select aria-label="Member" value={userId} onChange={(e) => setUser(e.target.value)}>
        <option value="">Not linked</option>
        {meta.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {m.email}
          </option>
        ))}
      </Select>
    </Dialog>
  );
}

function LetterDialog({ id, template, onClose }: { id: string; template: string; onClose: () => void }) {
  const q = useHrQuery<{ title: string; company: string; address: string; text: string }>(`people/${id}/letter?template=${template}`);
  const print = () => {
    if (!q.data) return;
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    w.document.write(`<!doctype html><title>${esc(q.data.title)}</title><style>body{font:15px/1.65 Georgia,serif;max-width:680px;margin:48px auto;padding:0 24px;color:#18181b}h1{font:600 20px system-ui;margin:0}p.addr{font:13px system-ui;color:#71717a;white-space:pre-wrap;margin:4px 0 40px}div{white-space:pre-wrap}</style><h1>${esc(q.data.company)}</h1><p class="addr">${esc(q.data.address)}</p><div>${esc(q.data.text)}</div>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={q.data?.title ?? "Letter"} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={<Printer className="size-4" />} disabled={!q.data} onClick={print}>Print or save as PDF</Button></>}>
      {!q.data ? <Skeleton className="h-64 rounded-[16px]" /> : <pre className="max-h-[60vh] overflow-y-auto rounded-[14px] bg-surface-2 p-4 font-serif text-[14px] leading-relaxed whitespace-pre-wrap">{q.data.text}</pre>}
    </Dialog>
  );
}

// ─── Org chart ───

export function OrgChart() {
  const q = useHrQuery<{ people: { id: string; name: string; designation: string; managerId: string | null; departmentId: string | null; status: string }[] }>("people/chart");
  const { meta } = useHr();
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const people = q.data.people;
  const ids = new Set(people.map((p) => p.id));
  const roots = people.filter((p) => !p.managerId || !ids.has(p.managerId));
  const kids = (id: string) => people.filter((p) => p.managerId === id);
  return (
    <div>
      <PageHeader title="Org chart" description={`${people.length} people · who reports to whom`} />
      {!people.length ? (
        <Empty>Add people and set who they report to.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-[24px] border border-border bg-surface p-5 shadow-sm">
          <ul className="grid gap-2">
            {roots.map((r) => (
              <Node key={r.id} p={r} kids={kids} depth={0} dept={(id) => deptName(meta, id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Node({ p, kids, depth, dept }: { p: { id: string; name: string; designation: string; departmentId: string | null; status: string }; kids: (id: string) => { id: string; name: string; designation: string; departmentId: string | null; status: string; managerId: string | null }[]; depth: number; dept: (id: string | null) => string }) {
  const [open, setOpen] = useState(depth < 2);
  const children = kids(p.id);
  return (
    <li>
      <div className="flex items-center gap-2" style={{ paddingLeft: depth * 28 }}>
        <button type="button" aria-label={open ? "Collapse" : "Expand"} disabled={!children.length} onClick={() => setOpen(!open)} className="grid size-6 place-items-center rounded-full text-muted disabled:opacity-0">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Link href={`/hr/people/${p.id}`} className="flex min-w-[260px] items-center gap-3 rounded-[14px] border border-border bg-surface px-3 py-2 hover:bg-surface-2">
          <Avatar name={p.name} size={32} />
          <span className="min-w-0">
            <b className="block truncate text-[13.5px]">{p.name}</b>
            <span className="block truncate text-[12px] text-muted">
              {p.designation || "—"}
              {dept(p.departmentId) !== "—" ? ` · ${dept(p.departmentId)}` : ""}
            </span>
          </span>
          {children.length > 0 && <span className="ml-auto rounded-full bg-surface-2 px-2 text-[11px] text-muted tabular-nums">{children.length}</span>}
          {p.status === "notice" && <StatusPill status="notice" />}
        </Link>
      </div>
      {open && children.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {children.map((c) => (
            <Node key={c.id} p={c} kids={kids} depth={depth + 1} dept={dept} />
          ))}
        </ul>
      )}
    </li>
  );
}

