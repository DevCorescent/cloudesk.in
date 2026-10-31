"use client";

// Governance, risk & compliance: the overview (policies to acknowledge, the
// risk heat map, what's due), the risk register and controls, the compliance
// calendar, policies, incidents, internal audits, checks on duties and fraud
// indicators, and emissions.
import { AlertTriangle, BookCheck, CalendarClock, ClipboardCheck, FileWarning, Gauge, Leaf, Plus, ScanSearch, ShieldAlert, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { useState } from "react";
import { ChartView, type Result } from "@/components/bi/chart";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { CONTROL_TYPES, FACTOR_LABEL, FREQUENCIES, INCIDENT_STATUSES, INCIDENT_TYPES, RISK_CATEGORIES, RISK_STATUSES, SEVERITIES, TREATMENTS, rating, score, type FactorKey, type GrcSettings } from "@/lib/grc/model";

type Member = { id: string; name: string; role: string };
type Meta = { me: { id: string; role: string; registers: boolean; write: boolean; manage: boolean; finance: boolean }; settings: GrcSettings; members: Member[]; parts: Record<string, boolean>; pack: { key: string; title: string; authority: string; notes: string }[] };
const useGrc = () => useModule<Meta>();
const cap = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");
const date = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const RATING_TONE = { low: "success", medium: "warning", high: "danger", critical: "danger" } as const;
const SEV_TONE = { low: "neutral", medium: "warning", high: "danger", critical: "danger" } as const;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const Box = ({ title, children, action, className }: { title?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) => (
  <section className={cx("space-y-3 rounded-[20px] border border-border bg-surface p-5", className)}>
    {(title || action) && <div className="flex items-center justify-between gap-2">{title && <h2 className="text-[15px] font-semibold">{title}</h2>}{action}</div>}
    {children}
  </section>
);
const MemberSelect = ({ value, onChange, label = "Owner" }: { value: string | null; onChange: (v: string | null) => void; label?: string }) => {
  const { meta } = useGrc();
  return <Field label={label}>{(a) => <Select {...a} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">Nobody</option>{meta.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>;
};

export function GrcApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="grc"
      base="compliance"
      title="Compliance"
      icon={<ShieldAlert />}
      section={section}
      nav={(m) => [
        { id: "", label: "Overview", icon: <Gauge /> },
        { id: "risks", label: "Risks", icon: <AlertTriangle />, group: "Registers", hidden: !m.me.registers || !m.parts.risks },
        { id: "controls", label: "Controls", icon: <ShieldCheck />, hidden: !m.me.registers || !m.parts.risks },
        { id: "calendar", label: "Calendar", icon: <CalendarClock />, hidden: !m.me.registers || !m.parts.calendar },
        { id: "policies", label: "Policies", icon: <BookCheck /> },
        { id: "incidents", label: "Incidents", icon: <FileWarning /> },
        { id: "audits", label: "Internal audits", icon: <ClipboardCheck />, hidden: !m.me.registers || !m.parts.audits },
        { id: "checks", label: "Checks", icon: <ScanSearch />, group: "Analysis", hidden: !m.me.finance },
        { id: "esg", label: "Emissions", icon: <Leaf />, hidden: !m.me.registers || !m.parts.esg },
      ]}
      render={() => {
        if (section === "risks") return isId(id) ? <RiskPage key={id} id={id!} /> : <RisksView />;
        if (section === "controls") return isId(id) ? <ControlPage key={id} id={id!} /> : <ControlsView />;
        if (section === "calendar") return <CalendarView />;
        if (section === "policies") return isId(id) ? <PolicyPage key={id} id={id!} /> : <PoliciesView />;
        if (section === "incidents") return id === "new" ? <ReportIncident /> : isId(id) ? <IncidentPage key={id} id={id!} /> : <IncidentsView />;
        if (section === "audits") return isId(id) ? <AuditPage key={id} id={id!} /> : <AuditsView />;
        if (section === "checks") return <ChecksView />;
        if (section === "esg") return <EsgView />;
        return <Home />;
      }}
    />
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

type HomeData = { registers: boolean; policiesToAck: { id: string; title: string; version: number }[]; risks?: { open: number; byRating: Record<string, number>; heat: number[][] }; controls?: { overdue: number; failing: number }; incidents?: { open: number; critical: number }; findings?: { open: number; overdue: number }; calendar?: { overdue: number; week: number }; risksToReview?: number; policiesToReview?: number };

function Home() {
  const q = useModuleQuery<HomeData>("home");
  if (!q.data) return <Skeleton className="h-80 rounded-[24px]" />;
  const h = q.data;
  const tile = (label: string, value: number | undefined, href: string, bad?: boolean) => (
    <Link href={href} className="rounded-[18px] border border-border bg-surface p-4 hover:bg-surface-2"><p className="text-[12px] text-muted">{label}</p><p className={cx("mt-1 text-xl font-semibold tabular-nums", bad && value ? "text-danger" : "")}>{value ?? 0}</p></Link>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Governance, risk & compliance" />
      {!!h.policiesToAck.length && (
        <Notice tone="warning" title="Policies for you to read and acknowledge">
          <ul className="mt-1 space-y-0.5">{h.policiesToAck.map((p) => <li key={p.id}><Link className="font-medium underline" href={`/compliance/policies/${p.id}`}>{p.title}</Link> (version {p.version})</li>)}</ul>
        </Notice>
      )}
      {!h.registers ? (
        <Box title="Report something"><p className="text-[13.5px] text-muted">Seen a security problem, a safety issue, data shared by mistake or something that doesn&apos;t look right? Report it — it goes straight to the people who look after this.</p><Link href="/compliance/incidents/new" className="inline-flex h-8 items-center rounded-full bg-fg px-4 text-[13px] font-medium text-bg">Report an incident</Link></Box>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tile("Filings overdue", h.calendar?.overdue, "/compliance/calendar", true)}
            {tile("Filings due this week", h.calendar?.week, "/compliance/calendar")}
            {tile("Open incidents", h.incidents?.open, "/compliance/incidents", !!h.incidents?.critical)}
            {tile("Control tests overdue", h.controls?.overdue, "/compliance/controls", true)}
            {tile("Open audit findings", h.findings?.open, "/compliance/audits", !!h.findings?.overdue)}
            {tile("Risks to review", h.risksToReview, "/compliance/risks", true)}
          </div>
          {h.risks && (
            <Box title={`Open risks · ${h.risks.open}`}>
              <div className="grid items-start gap-6 lg:grid-cols-[auto_1fr]">
                <HeatMap grid={h.risks.heat} />
                <div className="space-y-2 text-[13.5px]">
                  {(["critical", "high", "medium", "low"] as const).map((r) => <p key={r} className="flex items-center gap-2"><Badge tone={RATING_TONE[r]}>{cap(r)}</Badge><span className="tabular-nums">{h.risks!.byRating[r] ?? 0}</span></p>)}
                  <p className="text-[12.5px] text-muted">Where risks stand now — after their controls where that&apos;s been assessed. Score = likelihood × impact (1–25).</p>
                </div>
              </div>
            </Box>
          )}
        </>
      )}
    </div>
  );
}

const CELL = { low: "bg-success-soft", medium: "bg-warning-soft", high: "bg-danger-soft", critical: "bg-danger text-white" } as const;

/** The 5×5 grid: impact up the side, likelihood along the bottom; each cell's band is also its position, and counts are printed. */
function HeatMap({ grid }: { grid: number[][] }) {
  return (
    <figure aria-label="Risk heat map" className="inline-block">
      <div className="flex">
        <div className="mr-1 flex flex-col justify-around text-[11px] text-muted">{[5, 4, 3, 2, 1].map((i) => <span key={i} className="flex h-10 items-center">{i}</span>)}</div>
        <div className="grid grid-cols-5 gap-0.5">
          {grid.flatMap((row, ri) => row.map((n, ci) => {
            const impact = 5 - ri;
            const likelihood = ci + 1;
            const band = rating(score(likelihood, impact));
            return <div key={`${ri}-${ci}`} title={`Likelihood ${likelihood}, impact ${impact}: ${n} risk(s)`} className={cx("grid size-10 place-items-center rounded-[6px] text-[13px] font-medium tabular-nums", CELL[band])}>{n || ""}</div>;
          }))}
        </div>
      </div>
      <div className="mt-1 ml-4 grid grid-cols-5 gap-0.5 text-center text-[11px] text-muted">{[1, 2, 3, 4, 5].map((i) => <span key={i} className="w-10">{i}</span>)}</div>
      <figcaption className="mt-1 ml-4 text-[11px] text-muted">Likelihood → · Impact ↑</figcaption>
    </figure>
  );
}

// ── Risks ───────────────────────────────────────────────────────────────────

type Risk = { id: string; number: string; title: string; description: string; category: string; ownerId: string | null; likelihood: number; impact: number; residualLikelihood: number | null; residualImpact: number | null; treatment: string; plan: string; status: string; reviewDate: string | null; controlIds: string[]; inherent: number; inherentRating: keyof typeof RATING_TONE; residual: number | null; residualRating: keyof typeof RATING_TONE | null; reviewDue?: boolean };
type Control = { id: string; code: string; name: string; description: string; ownerId: string | null; type: string; frequency: string; nextTestDue: string | null; lastResult: string | null; lastTestedOn: string | null; active: boolean; risks?: number; overdue?: boolean };

function RisksView() {
  const { meta, go, orgId } = useGrc();
  const qc = useQueryClient();
  const q = useModuleQuery<{ risks: Risk[] }>("risks");
  const [edit, setEdit] = useState<Partial<Risk> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Risk register" description="Highest risks first. Inherent is before controls; residual is what's left with them." actions={<div className="flex gap-2">{meta.me.write && <ImportButton target={target("grc.risks")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/grc/risks/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["grc", orgId] })} />}<ExportMenu name="risk-register" rows={q.data?.risks.map((r) => ({ ...r, owner: meta.members.find((m) => m.id === r.ownerId)?.name ?? "" }))} columns={[{ key: "number", label: "Number" }, { key: "title", label: "Risk" }, { key: "category", label: "Category" }, { key: "likelihood", label: "Likelihood" }, { key: "impact", label: "Impact" }, { key: "inherent", label: "Inherent" }, { key: "residual", label: "Residual" }, { key: "treatment", label: "Treatment" }, { key: "status", label: "Status" }, { key: "owner", label: "Owner" }, { key: "reviewDate", label: "Review" }, { key: "plan", label: "Plan" }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>New risk</Button>}</div>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.risks.length ? <Empty>No risks recorded yet.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-4 py-2 font-medium">Risk</th><th className="px-4 py-2 font-medium">Inherent</th><th className="px-4 py-2 font-medium">Residual</th><th className="px-4 py-2 font-medium">Owner</th><th className="px-4 py-2 font-medium">Review</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.risks.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-2" onClick={() => go(`risks/${r.id}`)}>
                  <td className="px-4 py-2"><b className="font-medium">{r.title}</b><span className="block text-[12px] text-muted">{r.number} · {cap(r.category)} · {cap(r.status)}</span></td>
                  <td className="px-4 py-2"><Badge tone={RATING_TONE[r.inherentRating]}>{r.inherent} {r.inherentRating}</Badge></td>
                  <td className="px-4 py-2">{r.residual === null ? "—" : <Badge tone={RATING_TONE[r.residualRating!]}>{r.residual} {r.residualRating}</Badge>}</td>
                  <td className="px-4 py-2 text-muted">{meta.members.find((m) => m.id === r.ownerId)?.name ?? "—"}</td>
                  <td className={cx("px-4 py-2", r.reviewDue && "font-medium text-danger")}>{date(r.reviewDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <RiskDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RiskDialog({ init, onClose }: { init: Partial<Risk>; onClose: () => void }) {
  const ctl = useModuleQuery<{ controls: Control[] }>("controls");
  const [f, setF] = useState({ title: init.title ?? "", description: init.description ?? "", category: init.category ?? "operational", ownerId: init.ownerId ?? null, likelihood: init.likelihood ?? 3, impact: init.impact ?? 3, residualLikelihood: init.residualLikelihood ?? null, residualImpact: init.residualImpact ?? null, treatment: init.treatment ?? "reduce", plan: init.plan ?? "", status: init.status ?? "open", reviewDate: init.reviewDate ?? null, controlIds: init.controlIds ?? [] });
  const save = useModuleAction<void>(() => ({ path: init.id ? `risks/${init.id}` : "risks", method: init.id ? "PUT" : "POST", body: f }), { success: "Risk saved", onDone: onClose });
  const lvl = (label: string, v: number | null, set: (n: number | null) => void, optional = false) => (
    <Field label={label}>{(a) => <Select {...a} value={v ?? ""} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)}>{optional && <option value="">Not assessed</option>}{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
  );
  const inh = score(f.likelihood, f.impact);
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? `Edit ${init.number}` : "New risk"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Risk" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Category">{(a) => <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{RISK_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</Select>}</Field>
        <MemberSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        {lvl("Likelihood (1–5)", f.likelihood, (n) => setF({ ...f, likelihood: n ?? 3 }))}
        {lvl("Impact (1–5)", f.impact, (n) => setF({ ...f, impact: n ?? 3 }))}
        <p className="text-[13px] text-muted sm:col-span-2">Inherent score {inh} — {rating(inh)}</p>
        {lvl("Residual likelihood", f.residualLikelihood, (n) => setF({ ...f, residualLikelihood: n }), true)}
        {lvl("Residual impact", f.residualImpact, (n) => setF({ ...f, residualImpact: n }), true)}
        <Field label="Treatment">{(a) => <Select {...a} value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })}>{TREATMENTS.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
        <Field label="Status">{(a) => <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{RISK_STATUSES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
        <Field label="Plan" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} />}</Field>
        <Field label="Next review">{(a) => <Input {...a} type="date" value={f.reviewDate ?? ""} onChange={(e) => setF({ ...f, reviewDate: e.target.value || null })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-[13px] font-medium">Controls</p>
          <div className="flex flex-wrap gap-2">
            {ctl.data?.controls.map((c) => {
              const on = f.controlIds.includes(c.id);
              return <button key={c.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, controlIds: on ? f.controlIds.filter((x) => x !== c.id) : [...f.controlIds, c.id] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{c.code} {c.name}</button>;
            })}
            {!ctl.data?.controls.length && <span className="text-[12.5px] text-muted">No controls yet — add them under Controls.</span>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function RiskPage({ id }: { id: string }) {
  const { meta } = useGrc();
  const q = useModuleQuery<{ risk: Risk; controls: Control[]; incidents: { id: string; number: string; title: string; status: string }[] }>(`risks/${id}`);
  const [edit, setEdit] = useState(false);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const { risk: r, controls, incidents } = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={r.title} description={`${r.number} · ${cap(r.category)} · ${cap(r.status)} · owner ${meta.members.find((m) => m.id === r.ownerId)?.name ?? "nobody"}`} actions={meta.me.write && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Box title="Inherent"><Badge tone={RATING_TONE[r.inherentRating]}>{r.inherent} {r.inherentRating}</Badge><p className="text-[13px] text-muted">Likelihood {r.likelihood} × impact {r.impact}</p></Box>
        <Box title="Residual">{r.residual === null ? <p className="text-[13px] text-muted">Not assessed</p> : <><Badge tone={RATING_TONE[r.residualRating!]}>{r.residual} {r.residualRating}</Badge><p className="text-[13px] text-muted">Likelihood {r.residualLikelihood} × impact {r.residualImpact}</p></>}</Box>
        <Box title="Treatment"><p className="text-[13.5px]">{cap(r.treatment)} · review {date(r.reviewDate)}</p></Box>
      </div>
      {(r.description || r.plan) && <Box>{r.description && <p className="text-[13.5px] whitespace-pre-wrap">{r.description}</p>}{r.plan && <p className="text-[13.5px] whitespace-pre-wrap"><b className="font-medium">Plan:</b> {r.plan}</p>}</Box>}
      <Box title="Controls">{controls.length ? <ul className="space-y-1 text-[13.5px]">{controls.map((c) => <li key={c.id}><Link className="underline" href={`/compliance/controls/${c.id}`}>{c.code} {c.name}</Link> — {c.lastResult ? cap(c.lastResult) : "not tested"}</li>)}</ul> : <p className="text-[13px] text-muted">None linked.</p>}</Box>
      {!!incidents.length && <Box title="Incidents">{incidents.map((i) => <p key={i.id} className="text-[13.5px]"><Link className="underline" href={`/compliance/incidents/${i.id}`}>{i.number} {i.title}</Link> ({i.status})</p>)}</Box>}
      {edit && <RiskDialog init={r} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function ControlsView() {
  const { meta, go } = useGrc();
  const q = useModuleQuery<{ controls: Control[] }>("controls");
  const [edit, setEdit] = useState<Partial<Control> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Controls" description="What keeps each risk in check, and how often it's tested." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>New control</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.controls.length ? <Empty>No controls yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.controls.map((c) => (
            <li key={c.id} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`controls/${c.id}`)}>
              <span><b className="font-medium">{c.code} · {c.name}</b><span className="block text-[12px] text-muted">{cap(c.type)} · {cap(c.frequency)} · {c.risks} risk(s){!c.active && " · inactive"}</span></span>
              <span className="flex items-center gap-2">{c.lastResult && <Badge tone={c.lastResult === "effective" ? "success" : c.lastResult === "partly" ? "warning" : "danger"}>{cap(c.lastResult)}</Badge>}<span className={cx("text-[12.5px]", c.overdue ? "font-medium text-danger" : "text-muted")}>{c.nextTestDue ? `test by ${date(c.nextTestDue)}` : "ad hoc"}</span></span>
            </li>
          ))}
        </ul>
      )}
      {edit && <ControlDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ControlDialog({ init, onClose }: { init: Partial<Control>; onClose: () => void }) {
  const [f, setF] = useState({ code: init.code ?? "", name: init.name ?? "", description: init.description ?? "", ownerId: init.ownerId ?? null, type: init.type ?? "preventive", frequency: init.frequency ?? "quarterly", nextTestDue: init.nextTestDue ?? null, active: init.active ?? true });
  const save = useModuleAction<void>(() => ({ path: init.id ? `controls/${init.id}` : "controls", method: init.id ? "PUT" : "POST", body: f }), { success: "Control saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={init.id ? `Edit ${init.code}` : "New control"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="AP-01" />}</Field>
        <MemberSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        <Field label="Control" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="How it works" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Type">{(a) => <Select {...a} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{CONTROL_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
        <Field label="Test">{(a) => <Select {...a} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>{FREQUENCIES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
        <Field label="Next test due">{(a) => <Input {...a} type="date" value={f.nextTestDue ?? ""} onChange={(e) => setF({ ...f, nextTestDue: e.target.value || null })} />}</Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /> Active</label>
      </div>
    </Dialog>
  );
}

function ControlPage({ id }: { id: string }) {
  const { meta } = useGrc();
  const q = useModuleQuery<{ control: Control; tests: { id: string; testedOn: string; result: string; notes: string; by: string | null }[]; risks: { id: string; number: string; title: string }[] }>(`controls/${id}`);
  const [edit, setEdit] = useState(false);
  const [t, setT] = useState({ testedOn: todayIst(), result: "effective", notes: "" });
  const test = useModuleAction<void>(() => ({ path: `controls/${id}/tests`, body: t }), { success: "Test recorded", onDone: () => setT({ ...t, notes: "" }) });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const c = q.data.control;
  return (
    <div className="space-y-4">
      <PageHeader title={`${c.code} · ${c.name}`} description={`${cap(c.type)} · tested ${c.frequency.replace("_", "-")} · next test ${date(c.nextTestDue)}`} actions={meta.me.write && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>} />
      {c.description && <Box><p className="text-[13.5px] whitespace-pre-wrap">{c.description}</p></Box>}
      {meta.me.write && (
        <Box title="Record a test">
          <div className="grid gap-3 sm:grid-cols-[160px_180px_1fr_auto] sm:items-end">
            <Field label="Tested on">{(a) => <Input {...a} type="date" value={t.testedOn} onChange={(e) => setT({ ...t, testedOn: e.target.value })} />}</Field>
            <Field label="Result">{(a) => <Select {...a} value={t.result} onChange={(e) => setT({ ...t, result: e.target.value })}><option value="effective">Effective</option><option value="partly">Partly effective</option><option value="ineffective">Ineffective</option></Select>}</Field>
            <Field label="What was checked">{(a) => <Input {...a} value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} />}</Field>
            <Button variant="primary" loading={test.isPending} onClick={() => test.mutate()}>Record</Button>
          </div>
        </Box>
      )}
      <Box title="Tests">{q.data.tests.length ? <ul className="space-y-1 text-[13.5px]">{q.data.tests.map((x) => <li key={x.id}>{date(x.testedOn)} · <Badge tone={x.result === "effective" ? "success" : x.result === "partly" ? "warning" : "danger"}>{cap(x.result)}</Badge> {x.notes} <span className="text-muted">— {x.by}</span></li>)}</ul> : <p className="text-[13px] text-muted">Not tested yet.</p>}</Box>
      <Box title="Risks it covers">{q.data.risks.length ? q.data.risks.map((r) => <p key={r.id} className="text-[13.5px]"><Link className="underline" href={`/compliance/risks/${r.id}`}>{r.number} {r.title}</Link></p>) : <p className="text-[13px] text-muted">Not linked to a risk.</p>}</Box>
      {edit && <ControlDialog init={c} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

type Filing = { id: string; title: string; authority: string; category: string; label: string; dueDate: string; status: string; reference: string; note: string; owner: string | null; overdue: boolean; dueSoon: boolean };

function CalendarView() {
  const { meta } = useGrc();
  const [view, setView] = useState<"pending" | "window">("pending");
  const q = useModuleQuery<{ filings: Filing[] }>(view === "pending" ? "filings?status=pending" : "filings", { keepPrevious: true });
  const obl = useModuleQuery<{ obligations: { id: string; title: string; packKey: string | null }[] }>("obligations");
  const pack = useModuleAction<void, { added: number }>(() => ({ path: "obligations/pack", body: {} }), { success: (r) => `${r.added} obligations added` });
  const [marking, setMarking] = useState<Filing | null>(null);
  const [adding, setAdding] = useState(false);
  const haveAll = obl.data && meta.pack.every((p) => obl.data!.obligations.some((o) => o.packKey === p.key));
  return (
    <div className="space-y-4">
      <PageHeader title="Compliance calendar" description="Every recurring filing and its due dates. Owners are reminded before each one, and again if it goes overdue." actions={meta.me.write && <div className="flex gap-2">{!haveAll && <Button size="sm" loading={pack.isPending} onClick={() => pack.mutate()}>Add Indian statutory dates</Button>}<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Obligation</Button></div>} />
      {!haveAll && <Notice>The Indian pack adds GST returns (GSTR-1, 3B, 9), TDS deposit and returns, Form 16, advance tax, tax audit and ITR, PF, ESI and ROC filings at their standard due dates. Dates are often extended and some depend on turnover, state or your AGM — edit them to fit.</Notice>}
      <Tabs value={view} onChange={setView} tabs={[{ value: "pending", label: "To do" }, { value: "window", label: "Last 30 and next 60 days" }]} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.filings.length ? <Empty>Nothing due.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.filings.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <span className="min-w-0"><b className="font-medium">{f.title}</b> <span className="text-muted">· {f.label}</span><span className="block text-[12px] text-muted">{f.authority}{f.owner ? ` · ${f.owner}` : ""}{f.reference ? ` · ${f.reference}` : ""}{f.status === "waived" ? ` · waived: ${f.note}` : ""}</span></span>
              <span className="flex items-center gap-2">
                <span className={cx("text-[12.5px] tabular-nums", f.overdue ? "font-medium text-danger" : f.dueSoon ? "font-medium" : "text-muted")}>{f.overdue ? "Overdue · " : ""}{date(f.dueDate)}</span>
                {f.status === "pending" ? meta.me.write && <Button size="sm" onClick={() => setMarking(f)}>Mark</Button> : <Badge tone={f.status === "done" ? "success" : "neutral"}>{cap(f.status)}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {marking && <MarkDialog f={marking} onClose={() => setMarking(null)} />}
      {adding && <ObligationDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function MarkDialog({ f, onClose }: { f: Filing; onClose: () => void }) {
  const [v, setV] = useState({ status: "done", reference: "", note: "" });
  const save = useModuleAction<void>(() => ({ path: `filings/${f.id}`, method: "PUT", body: v }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`${f.title} · ${f.label}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={v.status === "waived" && !v.note.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Status">{(a) => <Select {...a} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="done">Done / filed</option><option value="waived">Doesn&apos;t apply this time</option></Select>}</Field>
        {v.status === "done" && <Field label="Reference (ARN, challan or acknowledgement no.)">{(a) => <Input {...a} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />}</Field>}
        <Field label={v.status === "waived" ? "Why it doesn't apply" : "Note"}>{(a) => <Input {...a} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function ObligationDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ title: "", authority: "", category: "other", ownerId: null as string | null, remindDays: 5, kind: "monthly", day: 15, dates: "", once: "" });
  const recurrence = f.kind === "monthly" ? { freq: "monthly", day: f.day, nextMonth: true } : f.kind === "dates" ? { freq: "dates", dates: f.dates.split(/[\s,]+/).filter(Boolean) } : { freq: "once", date: f.once };
  const save = useModuleAction<void>(() => ({ path: "obligations", body: { title: f.title, authority: f.authority, category: f.category, ownerId: f.ownerId, remindDays: f.remindDays, recurrence } }), { success: "Obligation added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="New obligation" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What has to be done" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Professional tax return" />}</Field>
        <Field label="Authority">{(a) => <Input {...a} value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} />}</Field>
        <MemberSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        <Field label="Repeats">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="monthly">Monthly, for the month before</option><option value="dates">On dates each year</option><option value="once">Once</option></Select>}</Field>
        {f.kind === "monthly" && <Field label="Due on day">{(a) => <Input {...a} type="number" min={1} max={31} value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })} />}</Field>}
        {f.kind === "dates" && <Field label="Dates (MM-DD, comma separated)">{(a) => <Input {...a} value={f.dates} onChange={(e) => setF({ ...f, dates: e.target.value })} placeholder="06-15, 09-15" />}</Field>}
        {f.kind === "once" && <Field label="Date">{(a) => <Input {...a} type="date" value={f.once} onChange={(e) => setF({ ...f, once: e.target.value })} />}</Field>}
        <Field label="Remind days before">{(a) => <Input {...a} type="number" min={0} max={60} value={f.remindDays} onChange={(e) => setF({ ...f, remindDays: Number(e.target.value) })} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Policies ────────────────────────────────────────────────────────────────

type Policy = { id: string; title: string; body?: string; version: number; status: string; ownerId: string | null; effectiveDate: string | null; reviewDate: string | null; audience: string[]; forMe?: boolean; acknowledged?: boolean; progress?: { done: number; of: number } | null };
const ROLES = ["owner", "admin", "billing", "developer", "designer", "editor", "viewer", "employee"];

function PoliciesView() {
  const { meta, go } = useGrc();
  const q = useModuleQuery<{ policies: Policy[] }>("policies");
  const [edit, setEdit] = useState<Partial<Policy> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Policies" description="Published policies are acknowledged by everyone they apply to — again when a new version is published." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>New policy</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.policies.length ? <Empty>No policies yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.policies.map((p) => (
            <li key={p.id} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`policies/${p.id}`)}>
              <span><b className="font-medium">{p.title}</b> <span className="text-muted">v{p.version}</span>{p.reviewDate && <span className="block text-[12px] text-muted">Review {date(p.reviewDate)}</span>}</span>
              <span className="flex items-center gap-2">
                {p.progress && <span className="text-[12.5px] text-muted tabular-nums">{p.progress.done}/{p.progress.of} acknowledged</span>}
                {p.forMe && (p.acknowledged ? <Badge tone="success">You acknowledged</Badge> : <Badge tone="warning">Please read</Badge>)}
                {p.status !== "published" && <Badge>{cap(p.status)}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {edit && <PolicyDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PolicyDialog({ init, onClose }: { init: Partial<Policy>; onClose: () => void }) {
  const [f, setF] = useState({ title: init.title ?? "", body: init.body ?? "", ownerId: init.ownerId ?? null, effectiveDate: init.effectiveDate ?? null, reviewDate: init.reviewDate ?? null, audience: init.audience ?? [] });
  const save = useModuleAction<void>(() => ({ path: init.id ? `policies/${init.id}` : "policies", method: init.id ? "PUT" : "POST", body: f }), { success: init.status === "published" ? "Saved — a changed text is a new version to acknowledge" : "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? `Edit ${init.title}` : "New policy"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.body.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Policy" className="sm:col-span-2">{(a) => <Textarea {...a} rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <MemberSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        <Field label="Review by">{(a) => <Input {...a} type="date" value={f.reviewDate ?? ""} onChange={(e) => setF({ ...f, reviewDate: e.target.value || null })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-[13px] font-medium">Applies to {f.audience.length ? "" : "everyone"}</p>
          <div className="flex flex-wrap gap-2">{ROLES.map((r) => { const on = f.audience.includes(r); return <button key={r} type="button" aria-pressed={on} onClick={() => setF({ ...f, audience: on ? f.audience.filter((x) => x !== r) : [...f.audience, r] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border text-muted")}>{cap(r)}</button>; })}</div>
        </div>
      </div>
    </Dialog>
  );
}

function PolicyPage({ id }: { id: string }) {
  const { meta } = useGrc();
  const q = useModuleQuery<{ policy: Policy & { body: string }; acknowledgedAt: string | null; pending: { id: string; name: string }[] | null }>(`policies/${id}`);
  const [edit, setEdit] = useState(false);
  const ack = useModuleAction<void>(() => ({ path: `policies/${id}/acknowledge` }), { success: "Thank you — acknowledged" });
  const publish = useModuleAction<void>(() => ({ path: `policies/${id}/publish` }), { success: "Published — everyone it applies to has been asked to acknowledge it" });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const p = q.data.policy;
  const forMe = p.status === "published" && (!p.audience.length || p.audience.includes(meta.me.role));
  return (
    <div className="space-y-4">
      <PageHeader title={p.title} description={`Version ${p.version} · ${cap(p.status)}${p.effectiveDate ? ` · effective ${date(p.effectiveDate)}` : ""}`} actions={meta.me.write && p.status !== "retired" && <div className="flex gap-2"><Button size="sm" onClick={() => setEdit(true)}>Edit</Button>{p.status === "draft" && <Button size="sm" variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}</div>} />
      <Box><div className="text-[14px] leading-relaxed whitespace-pre-wrap">{p.body}</div></Box>
      {forMe && (q.data.acknowledgedAt ? <Notice tone="success">You acknowledged this version on {date(q.data.acknowledgedAt)}.</Notice> : <Button variant="primary" loading={ack.isPending} onClick={() => ack.mutate()}>I have read and understood this policy</Button>)}
      {q.data.pending && <Box title={`Still to acknowledge · ${q.data.pending.length}`}>{q.data.pending.length ? <p className="text-[13.5px] text-muted">{q.data.pending.map((m) => m.name).join(", ")}</p> : <p className="text-[13.5px] text-muted">Everyone has acknowledged this version.</p>}</Box>}
      {edit && <PolicyDialog init={p} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────────

type Incident = { id: string; number: string; title: string; type: string; severity: keyof typeof SEV_TONE; occurredAt: string; description: string; personalData: boolean; status: string; ownerId: string | null; rootCause: string; actions: string; riskId: string | null; resolvedAt: string | null };

function IncidentsView() {
  const { meta, go } = useGrc();
  const q = useModuleQuery<{ incidents: Incident[] }>("incidents");
  return (
    <div className="space-y-4">
      <PageHeader title="Incidents" description={meta.me.registers ? "Everything reported, newest first." : "What you've reported."} actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("incidents/new")}>Report an incident</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.incidents.length ? <Empty>Nothing reported.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.incidents.map((i) => (
            <li key={i.id} className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`incidents/${i.id}`)}>
              <span><b className="font-medium">{i.title}</b><span className="block text-[12px] text-muted">{i.number} · {cap(i.type)} · {new Date(i.occurredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{i.personalData && " · personal data"}</span></span>
              <span className="flex gap-2"><Badge tone={SEV_TONE[i.severity]}>{cap(i.severity)}</Badge><Badge>{cap(i.status)}</Badge></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportIncident() {
  const { go } = useGrc();
  const [f, setF] = useState(() => ({ title: "", type: "security", severity: "medium", occurredAt: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16), description: "", personalData: false }));
  const save = useModuleAction<void, { incident: { id: string } }>(() => ({ path: "incidents", body: { ...f, occurredAt: `${f.occurredAt}:00+05:30` } }), { success: "Reported — thank you", onDone: (r) => go(`incidents/${r.incident.id}`) });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Report an incident" description="Tell us what happened as soon as you can. It goes to the people who look after this." />
      <Box>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What happened" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Kind">{(a) => <Select {...a} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{INCIDENT_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
          <Field label="How serious">{(a) => <Select {...a} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
          <Field label="When (India time)">{(a) => <Input {...a} type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.personalData} onChange={(v) => setF({ ...f, personalData: v })} label="Personal data may be involved" /> Personal data may be involved</label>
          <Field label="Details" className="sm:col-span-2">{(a) => <Textarea {...a} rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        </div>
      </Box>
      <Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.description.trim()} onClick={() => save.mutate()}>Report</Button>
    </div>
  );
}

function IncidentPage({ id }: { id: string }) {
  const { meta } = useGrc();
  const q = useModuleQuery<{ incident: Incident }>(`incidents/${id}`);
  const risks = useModuleQuery<{ risks: { id: string; number: string; title: string }[] }>(meta.me.registers && meta.parts.risks ? "risks" : null);
  const [f, setF] = useState<Partial<Incident> | null>(null);
  const save = useModuleAction<void>(() => ({ path: `incidents/${id}`, method: "PATCH", body: { status: f?.status, severity: f?.severity, ownerId: f?.ownerId, rootCause: f?.rootCause, actions: f?.actions, riskId: f?.riskId } }), { success: "Saved", onDone: () => setF(null) });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const i = q.data.incident;
  const v = f ?? i;
  return (
    <div className="space-y-4">
      <PageHeader title={i.title} description={`${i.number} · ${cap(i.type)} · ${new Date(i.occurredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`} />
      <div className="flex gap-2"><Badge tone={SEV_TONE[i.severity]}>{cap(i.severity)}</Badge><Badge>{cap(i.status)}</Badge>{i.personalData && <Badge tone="warning">Personal data</Badge>}</div>
      {i.personalData && meta.me.registers && <Notice tone="warning">If personal data was exposed, check whether it must be reported to CERT-In (within 6 hours for listed cyber incidents) or the Data Protection Board, and to the people affected.</Notice>}
      <Box><p className="text-[14px] whitespace-pre-wrap">{i.description}</p></Box>
      {meta.me.write ? (
        <Box title="Investigation">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status">{(a) => <Select {...a} value={v.status} onChange={(e) => setF({ ...v, status: e.target.value })}>{INCIDENT_STATUSES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
            <Field label="Severity">{(a) => <Select {...a} value={v.severity} onChange={(e) => setF({ ...v, severity: e.target.value as Incident["severity"] })}>{SEVERITIES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</Select>}</Field>
            <MemberSelect value={v.ownerId ?? null} onChange={(o) => setF({ ...v, ownerId: o })} />
            <Field label="Root cause" className="sm:col-span-3">{(a) => <Textarea {...a} rows={2} value={v.rootCause ?? ""} onChange={(e) => setF({ ...v, rootCause: e.target.value })} />}</Field>
            <Field label="Actions taken" className="sm:col-span-3">{(a) => <Textarea {...a} rows={2} value={v.actions ?? ""} onChange={(e) => setF({ ...v, actions: e.target.value })} />}</Field>
            {risks.data && <Field label="Linked risk" className="sm:col-span-3">{(a) => <Select {...a} value={v.riskId ?? ""} onChange={(e) => setF({ ...v, riskId: e.target.value || null })}><option value="">None</option>{risks.data!.risks.map((r) => <option key={r.id} value={r.id}>{r.number} {r.title}</option>)}</Select>}</Field>}
          </div>
          <Button variant="primary" loading={save.isPending} disabled={!f} onClick={() => save.mutate()}>Save</Button>
        </Box>
      ) : (
        (i.rootCause || i.actions) && <Box title="Investigation"><p className="text-[13.5px] whitespace-pre-wrap">{i.rootCause}</p><p className="text-[13.5px] whitespace-pre-wrap">{i.actions}</p></Box>
      )}
    </div>
  );
}

// ── Audits ──────────────────────────────────────────────────────────────────

type AuditRow = { id: string; number: string; title: string; scope: string; auditorId: string | null; periodFrom: string | null; periodTo: string | null; status: string; findings?: { open: number; total: number } };
type Finding = { id: string; title: string; severity: keyof typeof SEV_TONE; detail: string; recommendation: string; ownerId: string | null; dueDate: string | null; response: string; status: string; overdue: boolean };

function AuditsView() {
  const { meta, go } = useGrc();
  const q = useModuleQuery<{ audits: AuditRow[] }>("audits");
  const [f, setF] = useState<{ title: string; scope: string; periodFrom: string; periodTo: string; auditorId: string | null } | null>(null);
  const save = useModuleAction<void, { audit: { id: string } }>(() => ({ path: "audits", body: { ...f, periodFrom: f?.periodFrom || null, periodTo: f?.periodTo || null } }), { success: "Audit planned", onDone: (r) => go(`audits/${r.audit.id}`) });
  return (
    <div className="space-y-4">
      <PageHeader title="Internal audits" actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setF({ title: "", scope: "", periodFrom: "", periodTo: "", auditorId: null })}>Plan an audit</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.audits.length ? <Empty>No audits yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{q.data.audits.map((a) => <li key={a.id} className="flex cursor-pointer flex-wrap justify-between gap-2 px-4 py-2.5 text-[13.5px] hover:bg-surface-2" onClick={() => go(`audits/${a.id}`)}><span><b className="font-medium">{a.title}</b><span className="block text-[12px] text-muted">{a.number} · {date(a.periodFrom)} – {date(a.periodTo)}</span></span><span className="flex items-center gap-2 text-[12.5px] text-muted">{a.findings?.open ? `${a.findings.open} open finding(s)` : `${a.findings?.total ?? 0} finding(s)`}<Badge>{cap(a.status)}</Badge></span></li>)}</ul>
      )}
      {f && (
        <Dialog open onClose={() => setF(null)} title="Plan an audit" footer={<><Button onClick={() => setF(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Audit" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
            <Field label="Scope" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />}</Field>
            <Field label="Period from">{(a) => <Input {...a} type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} />}</Field>
            <Field label="Period to">{(a) => <Input {...a} type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} />}</Field>
            <MemberSelect label="Auditor" value={f.auditorId} onChange={(v) => setF({ ...f, auditorId: v })} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AuditPage({ id }: { id: string }) {
  const { meta } = useGrc();
  const q = useModuleQuery<{ audit: AuditRow; findings: Finding[] }>(`audits/${id}`);
  const [edit, setEdit] = useState<Partial<Finding> | null>(null);
  const status = useModuleAction<string>((st) => ({ path: `audits/${id}`, method: "PUT", body: { ...q.data!.audit, status: st } }), { success: "Saved" });
  const save = useModuleAction<void>(() => ({ path: edit?.id ? `audits/${id}/findings/${edit.id}` : `audits/${id}/findings`, method: edit?.id ? "PUT" : "POST", body: { title: edit?.title, severity: edit?.severity ?? "medium", detail: edit?.detail ?? "", recommendation: edit?.recommendation ?? "", ownerId: edit?.ownerId ?? null, dueDate: edit?.dueDate || null, response: edit?.response ?? "", status: edit?.status ?? "open" } }), { success: "Finding saved", onDone: () => setEdit(null) });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const a = q.data.audit;
  return (
    <div className="space-y-4">
      <PageHeader title={a.title} description={`${a.number} · ${date(a.periodFrom)} – ${date(a.periodTo)} · auditor ${meta.members.find((m) => m.id === a.auditorId)?.name ?? "—"}`} actions={meta.me.write && <div className="flex gap-2"><Select aria-label="Audit status" className="!w-40" value={a.status} onChange={(e) => status.mutate(e.target.value)}>{["planned", "fieldwork", "reporting", "closed"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>Finding</Button></div>} />
      {a.scope && <Box><p className="text-[13.5px] whitespace-pre-wrap">{a.scope}</p></Box>}
      {!q.data.findings.length ? <Empty>No findings recorded.</Empty> : (
        <ul className="space-y-3">{q.data.findings.map((f) => (
          <li key={f.id} className="rounded-[18px] border border-border bg-surface p-4 text-[13.5px]">
            <div className="flex flex-wrap justify-between gap-2"><b className="font-medium">{f.title}</b><span className="flex gap-2"><Badge tone={SEV_TONE[f.severity]}>{cap(f.severity)}</Badge><Badge tone={f.status === "closed" ? "success" : f.overdue ? "danger" : "neutral"}>{f.status === "closed" ? "Closed" : f.overdue ? "Overdue" : `Due ${date(f.dueDate)}`}</Badge></span></div>
            {f.detail && <p className="mt-1 whitespace-pre-wrap">{f.detail}</p>}
            {f.recommendation && <p className="mt-1 text-muted">Recommendation: {f.recommendation}</p>}
            {f.response && <p className="mt-1">Management: {f.response}</p>}
            {meta.me.write && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEdit(f)}>Edit</Button>}
          </li>
        ))}</ul>
      )}
      {edit && (
        <Dialog open onClose={() => setEdit(null)} size="lg" title={edit.id ? "Edit finding" : "New finding"} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit.title?.trim()} onClick={() => save.mutate()}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Finding" className="sm:col-span-2">{(x) => <Input {...x} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
            <Field label="Severity">{(x) => <Select {...x} value={edit.severity ?? "medium"} onChange={(e) => setEdit({ ...edit, severity: e.target.value as Finding["severity"] })}>{SEVERITIES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select>}</Field>
            <Field label="Due">{(x) => <Input {...x} type="date" value={edit.dueDate ?? ""} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />}</Field>
            <Field label="Detail" className="sm:col-span-2">{(x) => <Textarea {...x} rows={3} value={edit.detail ?? ""} onChange={(e) => setEdit({ ...edit, detail: e.target.value })} />}</Field>
            <Field label="Recommendation" className="sm:col-span-2">{(x) => <Textarea {...x} rows={2} value={edit.recommendation ?? ""} onChange={(e) => setEdit({ ...edit, recommendation: e.target.value })} />}</Field>
            <MemberSelect value={edit.ownerId ?? null} onChange={(v) => setEdit({ ...edit, ownerId: v })} />
            <Field label="Status">{(x) => <Select {...x} value={edit.status ?? "open"} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="open">Open</option><option value="closed">Closed</option></Select>}</Field>
            <Field label="Management response" className="sm:col-span-2">{(x) => <Textarea {...x} rows={2} value={edit.response ?? ""} onChange={(e) => setEdit({ ...edit, response: e.target.value })} />}</Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ── Checks ──────────────────────────────────────────────────────────────────

function ChecksView() {
  const sod = useModuleQuery<{ byRole: { key: string; label: string; members: Member[] }[]; happened: { kind: string; title: string; detail: string; link: string }[]; smallTeam: boolean }>("sod");
  const fraud = useModuleQuery<{ indicators: { kind: string; title: string; detail: string; link: string }[]; payrollChecked: boolean }>("fraud");
  return (
    <div className="space-y-5">
      <PageHeader title="Checks" description="Rules, not guesses: each item is worth a look, not proof of wrongdoing." />
      <Box title="Duties one person holds">
        {!sod.data ? <Skeleton className="h-24 rounded-[14px]" /> : (
          <>
            {sod.data.smallTeam && <p className="text-[12.5px] text-muted">In a team this small, owners and admins usually hold everything — that&apos;s expected. Add a review step (an approval) where you can.</p>}
            {sod.data.byRole.length ? <ul className="space-y-1.5 text-[13.5px]">{sod.data.byRole.map((r) => <li key={r.key}><b className="font-medium">{r.label}:</b> {r.members.map((m) => `${m.name} (${m.role})`).join(", ")}</li>)}</ul> : <p className="text-[13px] text-muted">No role holds both sides of a duty.</p>}
            <h3 className="pt-2 text-[13.5px] font-semibold">In the last 90 days</h3>
            {sod.data.happened.length ? <ul className="space-y-1.5 text-[13.5px]">{sod.data.happened.map((h, i) => <li key={i}><Link className="font-medium underline" href={h.link}>{h.title}</Link> — {h.detail}</li>)}</ul> : <p className="text-[13px] text-muted">Nothing found.</p>}
          </>
        )}
      </Box>
      <Box title="Fraud indicators">
        {!fraud.data ? <Skeleton className="h-24 rounded-[14px]" /> : (
          <>
            {!fraud.data.payrollChecked && <p className="text-[12.5px] text-muted">Matching suppliers to employees&apos; bank accounts and PAN needs payroll access, so it wasn&apos;t checked.</p>}
            {fraud.data.indicators.length ? <ul className="space-y-1.5 text-[13.5px]">{fraud.data.indicators.map((f, i) => <li key={i}><Link className="font-medium underline" href={f.link}>{f.title}</Link> — {f.detail}</li>)}</ul> : <p className="text-[13px] text-muted">Nothing found.</p>}
          </>
        )}
      </Box>
    </div>
  );
}

// ── Emissions ───────────────────────────────────────────────────────────────

type Esg = { entries: { id: string; month: string; metric: FactorKey; quantity: number; note: string }[]; fleet: { month: string; metric: FactorKey; quantity: number }[]; monthly: { month: string; scope1: number; scope2: number; total: number }[]; factors: Record<FactorKey, number>; defaults: Record<FactorKey, number>; labels: typeof FACTOR_LABEL };

function EsgView() {
  const { meta } = useGrc();
  const q = useModuleQuery<Esg>("esg");
  const [f, setF] = useState({ month: todayIst().slice(0, 7), metric: "electricity_kwh" as FactorKey, quantity: "" });
  const add = useModuleAction<void>(() => ({ path: "esg", body: { ...f, quantity: Number(f.quantity) } }), { success: "Added", onDone: () => setF({ ...f, quantity: "" }) });
  const del = useModuleAction<string>((id) => ({ path: `esg/${id}`, method: "DELETE" }), { success: "Removed" });
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const r: Result = { dims: 1, columns: [{ key: "month", label: "Month", type: "text" }, { key: "s1", label: "Scope 1 (fuel), kg CO₂", type: "number" }, { key: "s2", label: "Scope 2 (electricity), kg CO₂", type: "number" }], rows: q.data.monthly.map((m) => [m.month, m.scope1, m.scope2]), totals: [null, q.data.monthly.reduce((n, m) => n + m.scope1, 0), q.data.monthly.reduce((n, m) => n + m.scope2, 0)], range: { from: null, to: null }, truncated: false };
  return (
    <div className="space-y-5">
      <PageHeader title="Emissions" description="Electricity and fuel turned into CO₂. Diesel and petrol from the Logistics fuel log are counted automatically." />
      <Box title="By month">{q.data.monthly.length ? <ChartView r={r} kind="bar" /> : <p className="text-[13px] text-muted">Nothing recorded yet.</p>}</Box>
      {meta.me.write && (
        <Box title="Add a reading">
          <div className="grid gap-3 sm:grid-cols-[150px_200px_1fr_auto] sm:items-end">
            <Field label="Month">{(a) => <Input {...a} type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />}</Field>
            <Field label="What">{(a) => <Select {...a} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as FactorKey })}>{(Object.keys(q.data!.labels) as FactorKey[]).map((k) => <option key={k} value={k}>{q.data!.labels[k].label} ({q.data!.labels[k].unit})</option>)}</Select>}</Field>
            <Field label="Quantity">{(a) => <Input {...a} type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />}</Field>
            <Button variant="primary" loading={add.isPending} disabled={!f.quantity} onClick={() => add.mutate()}>Add</Button>
          </div>
        </Box>
      )}
      <Box title="Readings">
        {!q.data.entries.length && !q.data.fleet.length ? <p className="text-[13px] text-muted">None yet.</p> : (
          <ul className="divide-y divide-border text-[13.5px]">
            {q.data.entries.map((e) => <li key={e.id} className="flex justify-between py-1.5"><span>{e.month} · {q.data!.labels[e.metric].label} · {e.quantity.toLocaleString("en-IN")} {q.data!.labels[e.metric].unit}</span>{meta.me.write && <button type="button" className="text-[12.5px] text-muted underline" onClick={() => del.mutate(e.id)}>Remove</button>}</li>)}
            {q.data.fleet.map((e, i) => <li key={`f${i}`} className="py-1.5 text-muted">{e.month} · {q.data!.labels[e.metric].label} · {Math.round(e.quantity).toLocaleString("en-IN")} {q.data!.labels[e.metric].unit} (Logistics fuel log)</li>)}
          </ul>
        )}
      </Box>
      <p className="text-[12.5px] text-muted">Factors (kg CO₂ per unit): {(Object.keys(q.data.factors) as FactorKey[]).map((k) => `${q.data!.labels[k].label} ${q.data!.factors[k]}`).join(" · ")}. Defaults are commonly used figures (India&apos;s grid from the CEA CO₂ database, fuels from IPCC); owners can change them. Scope 3 isn&apos;t covered.</p>
    </div>
  );
}
