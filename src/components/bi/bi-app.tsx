"use client";

// Reports & dashboards: home (dashboards and recent reports), the report
// builder (pick the data, group, measure, filter, choose the dates and the
// chart, run it), saved reports, dashboards of reports and KPIs, and
// schedules that email a report.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Download, Home, LayoutDashboard, PieChart, Play, Plus, Table2, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Section } from "@/components/crm/shared";
import { ExportMenu } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { AGGS, AGG_LABEL, BUCKETS, CHARTS, OPS, OP_LABEL, PRESETS, PRESET_LABEL, type Spec } from "@/lib/bi/model";
import { ChartView, fmtValue, type ChartKind, type Result } from "./chart";

type FieldDef = { key: string; label: string; type: "date" | "text" | "number" | "money" | "bool" };
type DatasetDef = { id: string; label: string; group: string; dateField: string | null; fields: FieldDef[] };
type Meta = { me: { id: string; write: boolean; manage: boolean }; datasets: DatasetDef[]; people: { id: string; name: string }[]; fyStartMonth: number };
type Report = { id: string; name: string; description: string; dataset: string; spec: Spec; shared: boolean; createdBy: string | null; by?: string | null; dataLabel?: string; open?: boolean; mine?: boolean; updatedAt: string };
type Run = Result & { compare: { previous: number | null; change: number | null } | null };

const useBi = () => useModule<Meta>();
const CHART_LABEL: Record<(typeof CHARTS)[number], string> = { table: "Table", bar: "Bars", line: "Line", area: "Area", pie: "Donut", number: "Single number" };
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const rangeText = (r: { from: string | null; to: string | null }) => (r.from ? `${fmtValue(r.from, { type: "date" })} – ${fmtValue(r.to, { type: "date" })}` : "All time");

export function BiApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="bi"
      base="reports"
      title="Reports"
      icon={<PieChart />}
      section={isId(section) || section === "new" ? "list" : section}
      nav={() => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "list", label: "Reports", icon: <Table2 />, group: "Analyse" },
        { id: "dashboards", label: "Dashboards", icon: <LayoutDashboard /> },
        { id: "schedules", label: "Scheduled emails", icon: <CalendarClock /> },
      ]}
      render={() => {
        if (section === "new") return <Builder />;
        if (isId(section)) return id === "edit" ? <Builder key={section} id={section} /> : <ReportPage key={section} id={section} />;
        switch (section) {
          case "list":
            return <ReportsView />;
          case "dashboards":
            return isId(id) ? <DashboardPage key={id} id={id!} /> : <DashboardsView />;
          case "schedules":
            return <SchedulesView />;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}

// ── Home & lists ────────────────────────────────────────────────────────────

function HomeView() {
  const { meta, go } = useBi();
  const q = useModuleQuery<{ reports: Report[]; dashboards: { id: string; name: string; widgets: unknown[] }[]; schedules: number; datasets: number }>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Reports & dashboards" description={`Ask any question of the ${d?.datasets ?? "…"} kinds of data open to you, and keep the answers on dashboards.`} actions={meta.me.write ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => go("new")}>New report</Button> : undefined} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Dashboards">{!d.dashboards.length ? <Empty>Put your reports and KPIs on a dashboard.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.dashboards.map((x) => <li key={x.id}><Link href={`/reports/dashboards/${x.id}`} className="flex justify-between py-2 hover:underline"><span>{x.name}</span><span className="text-muted">{x.widgets.length} item{x.widgets.length === 1 ? "" : "s"}</span></Link></li>)}</ul>}</Section>
          <Section title="Reports">{!d.reports.length ? <Empty>No reports yet.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.reports.map((r) => <li key={r.id}><Link href={`/reports/${r.id}`} className="flex justify-between gap-3 py-2 hover:underline"><span className="min-w-0 truncate">{r.name}</span><span className="shrink-0 text-muted">{r.dataLabel}</span></Link></li>)}</ul>}</Section>
        </div>
      )}
    </div>
  );
}

function ReportsView() {
  const { meta, orgId, go } = useBi();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const q = useModuleQuery<{ reports: Report[] }>("reports");
  const rows = q.data?.reports ?? [];
  const importFile = async (f: File) => {
    try {
      const r = await api<{ report: Report }>(`/api/v1/orgs/${orgId}/bi/reports/import`, { method: "POST", body: JSON.parse(await f.text()) });
      await qc.invalidateQueries({ queryKey: ["bi", orgId] });
      go(r.report.id);
    } catch (e) {
      toast({ tone: "error", title: e instanceof SyntaxError ? "That file isn't a report" : errorMessage(e) });
    }
  };
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Saved questions, shared with the team or kept to yourself."
        actions={
          meta.me.write ? (
            <div className="flex gap-2">
              <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => file.current?.click()}>Import</Button>
              <input ref={file} type="file" accept="application/json,.json" aria-label="Report file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => go("new")}>New report</Button>
            </div>
          ) : undefined
        }
      />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No reports yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className={cx("flex flex-wrap items-center gap-3 py-2.5 hover:opacity-80", !r.open && "opacity-60")}>
                <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{r.name}</b><span className="text-[12px] text-muted">{r.dataLabel} · {CHART_LABEL[r.spec.chart]}{r.by ? ` · by ${r.by}` : ""}{!r.open ? " · its data isn't open to you" : ""}</span></span>
                {!r.shared && <span className="text-[11.5px] font-semibold text-muted">Private</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Builder ─────────────────────────────────────────────────────────────────

const emptySpec = (d: DatasetDef | undefined): Spec => ({ dims: [], measures: [{ field: null, agg: "count" }], filters: [], range: { field: d?.dateField ?? null, preset: d?.dateField ? "last_30" : "all", from: null, to: null }, sort: { by: null, dir: "desc" }, limit: 200, chart: "table", compare: false });

function Builder({ id }: { id?: string }) {
  const { meta, go } = useBi();
  const existing = useModuleQuery<{ report: Report }>(id ? `reports/${id}` : null);
  const groups = [...new Set(meta.datasets.map((d) => d.group))];
  const [dataset, setDataset] = useState<string>(meta.datasets[0]?.id ?? "");
  const [spec, setSpec] = useState<Spec>(() => emptySpec(meta.datasets[0]));
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<Run | null>(null);
  const [saving, setSaving] = useState(false);
  if (id && existing.data && !loaded) {
    setLoaded(true);
    setDataset(existing.data.report.dataset);
    setSpec(existing.data.report.spec);
  }
  const d = meta.datasets.find((x) => x.id === dataset);
  const run = useModuleAction<void, Run>(() => ({ path: "preview", body: { dataset, spec } }), { onDone: (r) => setResult(r) });
  if (id && !existing.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  if (!meta.datasets.length) return <Empty>No data is open to your role yet. Switch on modules, or ask an owner for access.</Empty>;
  const fields = d?.fields ?? [];
  const field = (k: string | null) => fields.find((f) => f.key === k);
  const set = (patch: Partial<Spec>) => (setSpec({ ...spec, ...patch }), setResult(null));
  const dateFields = fields.filter((f) => f.type === "date");
  const numFields = fields.filter((f) => f.type === "number" || f.type === "money");
  return (
    <div>
      <button type="button" onClick={() => go(id ? id : "list")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />{id ? "Back to the report" : "Reports"}</button>
      <PageHeader title={id ? `Edit ${existing.data?.report.name}` : "New report"} actions={<div className="flex gap-2"><Button size="sm" icon={<Play className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate()}>Run</Button>{meta.me.write && <Button size="sm" variant="primary" onClick={() => setSaving(true)}>Save</Button>}</div>} />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Section title="Data">
            <Select aria-label="Data" value={dataset} onChange={(e) => { const nd = meta.datasets.find((x) => x.id === e.target.value); setDataset(e.target.value); setSpec(emptySpec(nd)); setResult(null); }}>
              {groups.map((g) => <optgroup key={g} label={g}>{meta.datasets.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>)}
            </Select>
          </Section>
          <Section title="Group by">
            <div className="grid gap-2">
              {spec.dims.map((dim, i) => (
                <div key={i} className="flex gap-2">
                  <Select aria-label={`Group ${i + 1}`} value={dim.field} onChange={(e) => set({ dims: spec.dims.map((x, j) => (j === i ? { field: e.target.value, bucket: field(e.target.value)?.type === "date" ? "month" : null } : x)) })} className="h-9 flex-1">{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
                  {field(dim.field)?.type === "date" && <Select aria-label={`Group ${i + 1} by`} value={dim.bucket ?? "day"} onChange={(e) => set({ dims: spec.dims.map((x, j) => (j === i ? { ...x, bucket: e.target.value as (typeof BUCKETS)[number] } : x)) })} className="h-9 !w-28">{BUCKETS.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}</Select>}
                  <Button size="sm" variant="ghost" aria-label={`Remove group ${i + 1}`} icon={<X className="size-3.5" />} onClick={() => set({ dims: spec.dims.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {spec.dims.length < 3 && <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => set({ dims: [...spec.dims, { field: (dateFields[0] ?? fields[0]).key, bucket: dateFields[0] ? "month" : null }] })}>Group</Button>}
            </div>
          </Section>
          <Section title="Measure">
            <div className="grid gap-2">
              {spec.measures.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Select aria-label={`Measure ${i + 1} how`} value={m.agg} onChange={(e) => { const agg = e.target.value as (typeof AGGS)[number]; set({ measures: spec.measures.map((x, j) => (j === i ? { agg, field: agg === "count" ? null : ["sum", "avg"].includes(agg) ? (numFields.find((f) => f.key === x.field)?.key ?? numFields[0]?.key ?? null) : (x.field ?? fields[0]?.key ?? null) } : x)) }); }} className="h-9 !w-36">{AGGS.map((a) => <option key={a} value={a} disabled={["sum", "avg"].includes(a) && !numFields.length}>{AGG_LABEL[a]}</option>)}</Select>
                  {m.agg !== "count" && <Select aria-label={`Measure ${i + 1}`} value={m.field ?? ""} onChange={(e) => set({ measures: spec.measures.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })} className="h-9 flex-1">{(["sum", "avg"].includes(m.agg) ? numFields : fields).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>}
                  {m.agg === "count" && <span className="flex-1 self-center text-[12.5px] text-muted">Number of records</span>}
                  {spec.measures.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove measure ${i + 1}`} icon={<X className="size-3.5" />} onClick={() => set({ measures: spec.measures.filter((_, j) => j !== i) })} />}
                </div>
              ))}
              {spec.measures.length < 6 && <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => set({ measures: [...spec.measures, numFields[0] ? { field: numFields[0].key, agg: "sum" } : { field: null, agg: "count" }] })}>Measure</Button>}
            </div>
          </Section>
          <Section title="Filter">
            <div className="grid gap-2">
              {spec.filters.map((x, i) => {
                const ft = field(x.field)?.type ?? "text";
                const ops = OPS.filter((o) => (ft === "bool" ? ["true", "false"].includes(o) : ft === "text" ? ["eq", "ne", "in", "contains", "empty", "notempty"].includes(o) : ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "notempty"].includes(o)));
                return (
                  <div key={i} className="grid gap-1 rounded-[12px] border border-border p-2">
                    <div className="flex gap-2">
                      <Select aria-label={`Filter ${i + 1} field`} value={x.field} onChange={(e) => set({ filters: spec.filters.map((y, j) => (j === i ? { field: e.target.value, op: field(e.target.value)?.type === "bool" ? "true" : "eq", value: null } : y)) })} className="h-8 flex-1 text-[13px]">{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
                      <Button size="sm" variant="ghost" aria-label={`Remove filter ${i + 1}`} icon={<X className="size-3.5" />} onClick={() => set({ filters: spec.filters.filter((_, j) => j !== i) })} />
                    </div>
                    <div className="flex gap-2">
                      <Select aria-label={`Filter ${i + 1} test`} value={x.op} onChange={(e) => set({ filters: spec.filters.map((y, j) => (j === i ? { ...y, op: e.target.value as (typeof OPS)[number] } : y)) })} className="h-8 !w-32 text-[13px]">{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>
                      {!["empty", "notempty", "true", "false"].includes(x.op) && <Input aria-label={`Filter ${i + 1} value`} type={ft === "date" ? "date" : "text"} value={Array.isArray(x.value) ? x.value.join(", ") : x.value === null ? "" : String(x.value)} onChange={(e) => set({ filters: spec.filters.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })} placeholder={x.op === "in" ? "a, b, c" : ft === "money" ? "₹" : ""} className="h-8 flex-1 text-[13px]" />}
                    </div>
                  </div>
                );
              })}
              {spec.filters.length < 12 && <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => set({ filters: [...spec.filters, { field: fields[0].key, op: fields[0].type === "bool" ? "true" : "eq", value: null }] })}>Filter</Button>}
            </div>
          </Section>
          {dateFields.length > 0 && (
            <Section title="Dates">
              <div className="grid gap-2">
                <div className="flex gap-2">
                  <Select aria-label="Date field" value={spec.range.field ?? d?.dateField ?? ""} onChange={(e) => set({ range: { ...spec.range, field: e.target.value } })} className="h-9 flex-1">{dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
                  <Select aria-label="Dates" value={spec.range.preset} onChange={(e) => set({ range: { ...spec.range, preset: e.target.value as (typeof PRESETS)[number] } })} className="h-9 flex-1">{PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}</Select>
                </div>
                {spec.range.preset === "custom" && <div className="flex gap-2"><Input aria-label="From" type="date" value={spec.range.from ?? ""} onChange={(e) => set({ range: { ...spec.range, from: e.target.value || null } })} className="h-9" /><Input aria-label="To" type="date" value={spec.range.to ?? ""} onChange={(e) => set({ range: { ...spec.range, to: e.target.value || null } })} className="h-9" /></div>}
              </div>
            </Section>
          )}
          <Section title="Show as">
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-1.5">{CHARTS.map((c) => <button key={c} type="button" aria-pressed={spec.chart === c} onClick={() => set({ chart: c })} className={cx("rounded-full border px-3 py-1 text-[12.5px] font-medium", spec.chart === c ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg")}>{CHART_LABEL[c]}</button>)}</div>
              {spec.chart === "number" && <Switch checked={spec.compare} onChange={(v) => set({ compare: v })} label="Compare with the period before" />}
              <div className="flex gap-2">
                <Select aria-label="Sort by" value={spec.sort.by ?? ""} onChange={(e) => set({ sort: { ...spec.sort, by: e.target.value || null } })} className="h-9 flex-1"><option value="">Sort: automatic</option>{spec.dims.map((x, i) => <option key={`d${i}`} value={`d${i}`}>{field(x.field)?.label}</option>)}{spec.measures.map((m, i) => <option key={`m${i}`} value={`m${i}`}>{m.agg === "count" ? "Count" : `${AGG_LABEL[m.agg]} ${field(m.field)?.label.toLowerCase() ?? ""}`}</option>)}</Select>
                <Select aria-label="Sort direction" value={spec.sort.dir} onChange={(e) => set({ sort: { ...spec.sort, dir: e.target.value as "asc" | "desc" } })} className="h-9 !w-28"><option value="desc">High first</option><option value="asc">Low first</option></Select>
              </div>
              <Field label="Up to (rows)">{(p) => <Input {...p} inputMode="numeric" value={String(spec.limit)} onChange={(e) => set({ limit: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} className="h-9" />}</Field>
            </div>
          </Section>
        </div>
        <Section title={result ? `${d?.label} · ${rangeText(result.range)}` : "Result"}>
          {!result ? <Empty>Pick what to look at, then Run.</Empty> : <ChartView r={result} kind={spec.chart as ChartKind} />}
        </Section>
      </div>
      {saving && <SaveDialog id={id} existing={existing.data?.report} dataset={dataset} spec={spec} onClose={() => setSaving(false)} />}
    </div>
  );
}

function SaveDialog({ id, existing, dataset, spec, onClose }: { id?: string; existing?: Report; dataset: string; spec: Spec; onClose: () => void }) {
  const { go } = useBi();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [shared, setShared] = useState(existing?.shared ?? true);
  const save = useModuleAction<void, { report: Report }>(() => ({ path: id ? `reports/${id}` : "reports", method: id ? "PUT" : "POST", body: { name, description, dataset, spec, shared } }), { success: "Report saved", onDone: (r) => (onClose(), go(r.report.id)) });
  return (
    <Dialog open onClose={onClose} title="Save the report" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="What it shows (optional)">{(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Switch checked={shared} onChange={setShared} label="Share with the team (each person still only sees data their role allows)" />
      </div>
    </Dialog>
  );
}

// ── A saved report ──────────────────────────────────────────────────────────

function ReportPage({ id }: { id: string }) {
  const { meta, orgId, go } = useBi();
  const [preset, setPreset] = useState("");
  const q = useModuleQuery<{ report: Report; dataLabel: string; result: Run }>(`reports/${id}${preset ? `?preset=${preset}` : ""}`, { keepPrevious: true });
  const [scheduling, setScheduling] = useState(false);
  const del = useModuleAction<void>(() => ({ path: `reports/${id}`, method: "DELETE" }), { success: "Report deleted", onDone: () => go("list") });
  if (q.isError) return <Empty>{errorMessage(q.error)}</Empty>;
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { report: r, result } = q.data;
  const canEdit = meta.me.write && (r.createdBy === meta.me.id || meta.me.manage);
  const download = async () => {
    const def = await api(`/api/v1/orgs/${orgId}/bi/reports/${id}/export`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(def, null, 2)], { type: "application/json" }));
    a.download = `${r.name.replace(/[^\w-]+/g, "-").toLowerCase()}.report.json`;
    a.click();
  };
  return (
    <div>
      <button type="button" onClick={() => go("list")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Reports</button>
      <PageHeader
        title={r.name}
        description={`${q.data.dataLabel} · ${rangeText(result.range)}${r.description ? ` · ${r.description}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Dates" value={preset} onChange={(e) => setPreset(e.target.value)} className="h-8 !w-44 text-[13px]"><option value="">Saved dates</option>{PRESETS.filter((p) => p !== "custom").map((p) => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}</Select>
            <ExportMenu name={r.name.replace(/[^\w-]+/g, "-").toLowerCase()} columns={result.columns.map((c, i) => ({ key: `c${i}`, label: c.label, money: c.type === "money" }))} rows={result.rows.map((row) => Object.fromEntries(row.map((v, i) => [`c${i}`, result.columns[i].type === "date" ? fmtValue(v, result.columns[i]) : v ?? ""])))} />
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void download()}>Report file</Button>
            {meta.me.write && <Button size="sm" icon={<CalendarClock className="size-3.5" />} onClick={() => setScheduling(true)}>Email it</Button>}
            {canEdit && <Button size="sm" onClick={() => go(`${id}/edit`)}>Edit</Button>}
            {canEdit && <Button size="sm" variant="ghost" aria-label="Delete report" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()} />}
          </div>
        }
      />
      <Section title={r.spec.chart === "number" ? "" : `${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`}>
        <ChartView r={result} kind={r.spec.chart as ChartKind} />
      </Section>
      {scheduling && <ScheduleDialog reportId={id} onClose={() => setScheduling(false)} />}
    </div>
  );
}

// ── Dashboards ──────────────────────────────────────────────────────────────

type Widget = { id: string; reportId: string; size: "s" | "m" | "l"; target: number | null };

function DashboardsView() {
  const { meta, go } = useBi();
  const q = useModuleQuery<{ dashboards: { id: string; name: string; widgets: Widget[]; shared: boolean }[] }>("dashboards");
  const [adding, setAdding] = useState(false);
  const rows = q.data?.dashboards ?? [];
  return (
    <div>
      <PageHeader title="Dashboards" description="Reports and KPIs side by side." actions={meta.me.write ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Dashboard</Button> : undefined} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No dashboards yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((x) => <li key={x.id}><Link href={`/reports/dashboards/${x.id}`} className="flex justify-between gap-3 py-2.5 hover:opacity-80"><b className="font-semibold">{x.name}</b><span className="text-muted">{x.widgets.length} item{x.widgets.length === 1 ? "" : "s"}{x.shared ? "" : " · private"}</span></Link></li>)}
        </ul>
      )}
      {adding && <DashboardDialog onClose={() => setAdding(false)} onSaved={(id) => go(`dashboards/${id}`)} />}
    </div>
  );
}

function DashboardDialog({ dash, onClose, onSaved }: { dash?: { id: string; name: string; widgets: Widget[]; shared: boolean }; onClose: () => void; onSaved?: (id: string) => void }) {
  const reports = useModuleQuery<{ reports: Report[] }>("reports");
  const [name, setName] = useState(dash?.name ?? "");
  const [shared, setShared] = useState(dash?.shared ?? true);
  const [widgets, setWidgets] = useState<Widget[]>(dash?.widgets ?? []);
  const options = (reports.data?.reports ?? []).filter((r) => r.open);
  const save = useModuleAction<void, { dashboard: { id: string } }>(() => ({ path: dash ? `dashboards/${dash.id}` : "dashboards", method: dash ? "PUT" : "POST", body: { name, shared, widgets } }), { success: "Dashboard saved", onDone: (r) => (onClose(), onSaved?.(r.dashboard.id)) });
  return (
    <Dialog open onClose={onClose} size="lg" title={dash ? "Edit dashboard" : "New dashboard"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <p className="text-[12.5px] font-medium">On it</p>
        {widgets.map((w, i) => (
          <div key={w.id} className="flex flex-wrap gap-2">
            <Select aria-label={`Item ${i + 1}`} value={w.reportId} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, reportId: e.target.value } : x)))} className="h-9 min-w-48 flex-1">{options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            <Select aria-label={`Item ${i + 1} size`} value={w.size} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, size: e.target.value as Widget["size"] } : x)))} className="h-9 !w-28"><option value="s">Small</option><option value="m">Medium</option><option value="l">Wide</option></Select>
            {options.find((r) => r.id === w.reportId)?.spec.chart === "number" && <Input aria-label={`Item ${i + 1} target`} inputMode="decimal" value={w.target === null ? "" : String(w.target)} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, target: e.target.value === "" ? null : Number(e.target.value) || 0 } : x)))} placeholder="Target" className="h-9 !w-28" />}
            <Button size="sm" variant="ghost" aria-label={`Remove item ${i + 1}`} icon={<X className="size-3.5" />} onClick={() => setWidgets(widgets.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="justify-self-start" disabled={!options.length} icon={<Plus className="size-3.5" />} onClick={() => setWidgets([...widgets, { id: `w${Date.now().toString(36)}`, reportId: options[0].id, size: "m", target: null }])}>{options.length ? "Add a report" : "Save a report first"}</Button>
        <Switch checked={shared} onChange={setShared} label="Share with the team" />
      </div>
    </Dialog>
  );
}

function DashboardPage({ id }: { id: string }) {
  const { meta, go } = useBi();
  const q = useModuleQuery<{ dashboard: { id: string; name: string; widgets: Widget[]; shared: boolean; createdBy: string | null }; widgets: (Widget & { name: string; chart: string; result: Run | null; error: string | null })[] }>(`dashboards/${id}`);
  const [editing, setEditing] = useState(false);
  const del = useModuleAction<void>(() => ({ path: `dashboards/${id}`, method: "DELETE" }), { success: "Dashboard deleted", onDone: () => go("dashboards") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { dashboard: d, widgets } = q.data;
  const canEdit = meta.me.write && (d.createdBy === meta.me.id || meta.me.manage);
  return (
    <div>
      <button type="button" onClick={() => go("dashboards")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Dashboards</button>
      <PageHeader title={d.name} actions={canEdit ? <div className="flex gap-2"><Button size="sm" onClick={() => setEditing(true)}>Edit</Button><Button size="sm" variant="ghost" aria-label="Delete dashboard" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()} /></div> : undefined} />
      {!widgets.length ? <Empty>Nothing on this dashboard yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {widgets.map((w) => (
            <section key={w.id} className={cx("min-w-0 rounded-[20px] border border-border bg-surface p-4 shadow-sm", w.size === "m" && "xl:col-span-2", w.size === "l" && "md:col-span-2 xl:col-span-3")}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <Link href={`/reports/${w.reportId}`} className="truncate text-[13.5px] font-semibold hover:underline">{w.name || "Report"}</Link>
                {w.result && <span className="shrink-0 text-[11.5px] text-muted">{rangeText(w.result.range)}</span>}
              </div>
              {w.error ? <p className="py-6 text-center text-[12.5px] text-muted">{w.error}</p> : w.result ? <ChartView r={w.result} kind={w.chart as ChartKind} target={w.target} compact={w.size === "s"} /> : null}
            </section>
          ))}
        </div>
      )}
      {editing && <DashboardDialog dash={d} onClose={() => setEditing(false)} />}
    </div>
  );
}

// ── Schedules ───────────────────────────────────────────────────────────────

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function SchedulesView() {
  const q = useModuleQuery<{ schedules: { id: string; reportId: string; report: string; frequency: string; hour: number; weekday: number; monthday: number; recipients: string[]; active: boolean; nextAt: string; lastSentAt: string | null; lastError: string }[] }>("schedules");
  const { meta } = useBi();
  const del = useModuleAction<string>((id) => ({ path: `schedules/${id}`, method: "DELETE" }), { success: "Schedule removed" });
  const rows = q.data?.schedules ?? [];
  return (
    <div>
      <PageHeader title="Scheduled emails" description="Reports emailed on a schedule, as whoever set them up sees them. Set one up from a report's page." />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>None yet. Open a report and choose “Email it”.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1"><Link href={`/reports/${x.reportId}`} className="block truncate font-semibold hover:underline">{x.report}</Link><span className="text-[12px] text-muted">{x.frequency === "daily" ? "Every day" : x.frequency === "weekly" ? `Every ${WEEKDAYS[x.weekday - 1]}` : `On the ${x.monthday}${["st", "nd", "rd"][x.monthday - 1] ?? "th"} of each month`} at {String(x.hour).padStart(2, "0")}:00 · to {x.recipients.map((r) => meta.people.find((p) => p.id === r)?.name ?? "someone").join(", ")}</span>{x.lastError && <span className="block text-[12px] text-danger">Paused: {x.lastError}</span>}</span>
              <span className="text-[12px] text-muted">{x.active ? `next ${when(x.nextAt)}` : "paused"}{x.lastSentAt ? ` · last ${when(x.lastSentAt)}` : ""}</span>
              <Button size="sm" variant="ghost" aria-label={`Stop emailing ${x.report}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(x.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleDialog({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const { meta } = useBi();
  const [f, setF] = useState({ frequency: "weekly", hour: 9, weekday: 1, monthday: 1 });
  const [to, setTo] = useState<string[]>([meta.me.id]);
  const save = useModuleAction<void>(() => ({ path: "schedules", body: { reportId, ...f, recipients: to } }), { success: "It'll be emailed", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Email this report" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!to.length} loading={save.isPending} onClick={() => save.mutate()}>Schedule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How often">{(p) => <Select {...p} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></Select>}</Field>
        <Field label="At (IST)">{(p) => <Select {...p} value={String(f.hour)} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>}</Field>
        {f.frequency === "weekly" && <Field label="On">{(p) => <Select {...p} value={String(f.weekday)} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</Select>}</Field>}
        {f.frequency === "monthly" && <Field label="On day">{(p) => <Select {...p} value={String(f.monthday)} onChange={(e) => setF({ ...f, monthday: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select>}</Field>}
        <fieldset className="grid max-h-44 gap-1 overflow-y-auto rounded-[12px] border border-border p-2 sm:col-span-2">
          <legend className="px-1 text-[12.5px] font-medium">Send to</legend>
          {meta.people.map((x) => <label key={x.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={to.includes(x.id)} onChange={(e) => setTo(e.target.checked ? [...to, x.id] : to.filter((y) => y !== x.id))} className="accent-[var(--accent)]" />{x.name}</label>)}
        </fieldset>
        <p className="text-[12px] text-muted sm:col-span-2">It runs as you, so it never shows more than you can see. Emails carry the top 20 rows and a link.</p>
      </div>
    </Dialog>
  );
}
