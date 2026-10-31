"use client";

// Assets & maintenance: home (what's down, open jobs, service coming up,
// contracts ending), the asset register and each asset's page, work orders
// worked from request to done, preventive plans, contracts, reliability and
// cost, and settings.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, CalendarClock, ClipboardList, FileSignature, Gauge, Home, Plus, Settings, Trash2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Section, Stat } from "@/components/crm/shared";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { ASSET_STATUSES, ASSET_STATUS_LABEL, CONTRACT_KINDS, CONTRACT_KIND_LABEL, CRITICALITY, ORDER_KINDS, ORDER_KIND_LABEL, PRIORITIES, type MntSettings } from "@/lib/maintenance/model";
import { formatPrice } from "@/lib/store/money";
import { LinkedDocuments } from "@/components/documents/linked";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: MntSettings; people: { id: string; name: string }[]; items: { id: string; name: string; sku: string; unit: string }[]; warehouses: { id: string; name: string }[]; links: { inventory: boolean; accounting: boolean } };
type Asset = { id: string; code: string; name: string; category: string; location: string; parentId: string | null; make: string; model: string; serial: string; status: (typeof ASSET_STATUSES)[number]; criticality: string; custodianId: string | null; fixedAssetId: string | null; purchaseDate: string | null; warrantyUntil: string | null; meterUnit: string; meter: number | null; meterAt: string | null; notes: string };
type AssetRow = Asset & { openOrders: number; nextService: string | null; serviceDue: boolean };
type Order = { id: string; number: string; assetId: string; planId: string | null; kind: (typeof ORDER_KINDS)[number]; title: string; description: string; priority: string; status: string; requestedBy: string | null; assigneeId: string | null; dueDate: string | null; downFrom: string | null; downTo: string | null; startedAt: string | null; completedAt: string | null; checklist: { id: string; text: string; done: boolean; note?: string }[]; labour: { userId: string; minutes: number; rate: number; on: string }[]; parts: { itemId: string; qty: number; cost: number }[]; partsCost: number; externalCost: number; externalNote: string; failure: string; cause: string; remedy: string; warehouseId: string | null };
type OrderRow = Order & { asset: { code: string; name: string; criticality: string }; cost: number; overdue: boolean; downMinutes: number };
type Plan = { id: string; assetId: string; title: string; everyDays: number | null; everyMeter: number | null; startOn: string; startMeter: number; leadDays: number; leadMeter: number; checklist: { id: string; text: string }[]; parts: { itemId: string; qty: number }[]; estimateHours: number; assigneeId: string | null; active: boolean; lastDoneOn: string | null; lastDoneMeter: number | null; due: boolean; date: string | null; meter: number | null };
type Contract = { id: string; kind: (typeof CONTRACT_KINDS)[number]; vendor: string; reference: string; assetIds: string[]; startOn: string; endOn: string; cost: number; visits: number; notes: string; state: string; assets?: { id: string; code: string; name: string }[] };

const useMnt = () => useModule<Meta>();
const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatPrice(n, "INR"));
const fmt = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const dm = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { running: "bg-success-soft text-success", down: "bg-danger-soft text-danger", maintenance: "bg-warning-soft text-warning", standby: "bg-surface-2 text-muted", retired: "bg-surface-2 text-muted", requested: "bg-accent-soft text-accent", open: "bg-warning-soft text-warning", in_progress: "bg-accent-soft text-accent", on_hold: "bg-surface-2 text-muted", done: "bg-success-soft text-success", cancelled: "bg-surface-2 text-muted", active: "bg-success-soft text-success", ending: "bg-warning-soft text-warning", expired: "bg-danger-soft text-danger", upcoming: "bg-surface-2 text-muted" };
const LABEL: Record<string, string> = { ...ASSET_STATUS_LABEL, requested: "Requested", open: "Open", in_progress: "In progress", on_hold: "On hold", done: "Done", cancelled: "Cancelled", active: "Active", ending: "Ending soon", expired: "Expired", upcoming: "Not started" };
const Pill = ({ s }: { s: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[s] ?? "bg-surface-2 text-muted")}>{LABEL[s] ?? s}</span>;
const PRIORITY_TONE: Record<string, string> = { urgent: "text-danger", high: "text-warning", normal: "text-muted", low: "text-subtle" };
const nameOf = (m: Meta, id: string | null) => m.people.find((p) => p.id === id)?.name ?? "Nobody";

export function MaintenanceApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="maintenance"
      base="maintenance"
      title="Assets & maintenance"
      icon={<Wrench />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "orders", label: "Work orders", icon: <ClipboardList />, group: "Work" },
        { id: "plans", label: "Preventive plans", icon: <CalendarClock /> },
        { id: "assets", label: "Assets", icon: <Gauge />, group: "Register" },
        { id: "contracts", label: "Contracts", icon: <FileSignature /> },
        { id: "reports", label: "Reliability & cost", icon: <BarChart3 />, group: "Insight" },
        { id: "settings", label: "Settings", icon: <Settings />, group: "Setup", hidden: !m.me.manage },
      ]}
      render={() => {
        switch (section) {
          case "assets":
            return isId(id) ? <AssetPage key={id} id={id!} /> : <AssetsView />;
          case "orders":
            return isId(id) ? <OrderPage key={id} id={id!} /> : <OrdersView startNew={id === "new"} />;
          case "plans":
            return <PlansView />;
          case "contracts":
            return <ContractsView />;
          case "reports":
            return <ReportsView />;
          case "settings":
            return <SettingsView />;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}

// ── Home ────────────────────────────────────────────────────────────────────

type HomeData = { counts: { open: number; overdue: number; requests: number; down: number; assets: number; dueNotRaised: number }; down: { id: string; code: string; name: string; criticality: string }[]; orders: OrderRow[]; upcoming: (Plan & { asset: { id: string; code: string; name: string } })[]; contracts: Contract[]; partsAndOutsideThisMonth: number };

function HomeView() {
  const { go } = useMnt();
  const q = useModuleQuery<HomeData>("home");
  const raise = useModuleAction<void, { raised: unknown[] }>(() => ({ path: "plans/raise" }), { success: (r) => (r.raised.length ? `Raised ${r.raised.length} work order${r.raised.length === 1 ? "" : "s"}` : "Nothing due yet") });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Assets & maintenance" description="What's down, the jobs open, servicing coming up and contracts ending." actions={<Button size="sm" variant="primary" icon={<Wrench className="size-4" />} onClick={() => go("orders/new")}>Report a problem</Button>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Assets down" value={d.counts.down} sub={`of ${d.counts.assets}`} tone={d.counts.down ? "warn" : undefined} />
            <Stat label="Open work orders" value={d.counts.open} sub={d.counts.requests ? `${d.counts.requests} new request${d.counts.requests === 1 ? "" : "s"}` : undefined} />
            <Stat label="Overdue" value={d.counts.overdue} tone={d.counts.overdue ? "warn" : undefined} />
            <Stat label="Parts & outside work" value={inr(d.partsAndOutsideThisMonth)} sub="this month" />
          </div>
          {d.counts.dueNotRaised > 0 && <Notice tone="warning" title={`${d.counts.dueNotRaised} preventive job${d.counts.dueNotRaised === 1 ? " is" : "s are"} due without a work order`} action={<Button size="sm" loading={raise.isPending} onClick={() => raise.mutate()}>Raise them</Button>}>Work orders are raised when a meter reading brings a plan due, or here.</Notice>}
          {d.down.length > 0 && <Section title="Down now"><ul className="divide-y divide-border text-[13px]">{d.down.map((a) => <li key={a.id} className="flex justify-between py-2"><Link href={`/maintenance/assets/${a.id}`} className="font-medium hover:underline">{a.code} · {a.name}</Link><span className={cx("text-[12px] font-semibold", a.criticality === "high" ? "text-danger" : "text-muted")}>{a.criticality} criticality</span></li>)}</ul></Section>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Open work orders">{!d.orders.length ? <Empty>Nothing open.</Empty> : <OrderList rows={d.orders} compact />}</Section>
            <Section title="Servicing in the next 30 days">{!d.upcoming.length ? <Empty>Nothing coming up.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.upcoming.map((p) => <li key={p.id} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate">{p.title} <span className="text-muted">· {p.asset.code} {p.asset.name}</span></span><span className={cx("shrink-0", p.due ? "font-semibold text-warning" : "text-muted")}>{dm(p.date)}</span></li>)}</ul>}</Section>
          </div>
          {d.contracts.length > 0 && <Section title="Contracts ending or ended"><ul className="divide-y divide-border text-[13px]">{d.contracts.map((c) => <li key={c.id} className="flex justify-between py-2"><span>{CONTRACT_KIND_LABEL[c.kind]} · {c.vendor}</span><span className="flex items-center gap-2">{dm(c.endOn)} <Pill s={c.state} /></span></li>)}</ul></Section>}
        </div>
      )}
    </div>
  );
}

// ── Assets ──────────────────────────────────────────────────────────────────

const ASSET_COLUMNS = [{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "location", label: "Location" }, { key: "make", label: "Make" }, { key: "model", label: "Model" }, { key: "serial", label: "Serial" }, { key: "status", label: "Status" }, { key: "criticality", label: "Criticality" }, { key: "purchaseDate", label: "Purchase date" }, { key: "warrantyUntil", label: "Warranty until" }, { key: "meterUnit", label: "Meter unit" }, { key: "meter", label: "Meter reading" }, { key: "nextService", label: "Next service" }, { key: "openOrders", label: "Open work orders" }];

function AssetsView() {
  const { meta, orgId, go } = useMnt();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useModuleQuery<{ assets: AssetRow[] }>(`assets?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}) })}`, { keepPrevious: true });
  const fromFixed = useModuleAction<void, { added: number }>(() => ({ path: "assets/from-fixed" }), { success: (r) => `${r.added} asset${r.added === 1 ? "" : "s"} brought in` });
  const rows = q.data?.assets ?? [];
  return (
    <div>
      <PageHeader
        title="Assets"
        description="Machines, vehicles and equipment you look after."
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportMenu name="assets" columns={ASSET_COLUMNS} rows={rows.map((a) => ({ ...a, meter: a.meter ?? "", status: ASSET_STATUS_LABEL[a.status] }))} />
            {meta.me.write && <ImportButton target={target("maintenance.assets")} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/maintenance/assets/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["maintenance", orgId] })} />}
            {meta.me.manage && meta.links.accounting && <Button size="sm" loading={fromFixed.isPending} onClick={() => fromFixed.mutate()}>From fixed assets</Button>}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Asset</Button>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, serial, location" className="h-9 max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 !w-44">
          <option value="">In use</option>
          {ASSET_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
          <option value="all">All, retired too</option>
        </Select>
      </div>
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !rows.length ? <Empty>No assets yet. Add them one by one, import a spreadsheet, or bring in your fixed-asset register.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface px-4 shadow-sm">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-2.5 pr-3 font-medium">Asset</th><th className="py-2.5 pr-3 font-medium">Location</th><th className="py-2.5 pr-3 font-medium">Meter</th><th className="py-2.5 pr-3 font-medium">Next service</th><th className="py-2.5 pr-3 font-medium">Open jobs</th><th className="py-2.5 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => go(`assets/${a.id}`)}>
                  <td className="py-2.5 pr-3"><Link href={`/maintenance/assets/${a.id}`} className="font-medium hover:underline">{a.code} · {a.name}</Link><span className="block text-[12px] text-muted">{[a.category, a.make, a.model].filter(Boolean).join(" · ")}</span></td>
                  <td className="py-2.5 pr-3">{a.location || "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{a.meter !== null ? `${a.meter} ${a.meterUnit}` : "—"}</td>
                  <td className={cx("py-2.5 pr-3", a.serviceDue && "font-semibold text-warning")}>{dm(a.nextService)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{a.openOrders || ""}</td>
                  <td className="py-2.5"><Pill s={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AssetDialog onClose={() => setAdding(false)} onSaved={(x) => go(`assets/${x}`)} />}
    </div>
  );
}

function AssetDialog({ asset, onClose, onSaved }: { asset?: Asset; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useMnt();
  const all = useModuleQuery<{ assets: AssetRow[] }>("assets?status=all");
  const [f, setF] = useState({ name: asset?.name ?? "", category: asset?.category ?? "", location: asset?.location ?? "", parentId: asset?.parentId ?? "", make: asset?.make ?? "", model: asset?.model ?? "", serial: asset?.serial ?? "", status: asset?.status ?? "running", criticality: asset?.criticality ?? "medium", custodianId: asset?.custodianId ?? "", purchaseDate: asset?.purchaseDate ?? "", warrantyUntil: asset?.warrantyUntil ?? "", meterUnit: asset?.meterUnit ?? "", notes: asset?.notes ?? "", fixedAssetId: asset?.fixedAssetId ?? null });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void, { asset: Asset }>(() => ({ path: asset ? `assets/${asset.id}` : "assets", method: asset ? "PUT" : "POST", body: { ...f, parentId: f.parentId || null, custodianId: f.custodianId || null, purchaseDate: f.purchaseDate || null, warrantyUntil: f.warrantyUntil || null } }), { success: "Asset saved", onDone: (r) => (onClose(), onSaved?.(r.asset.id)) });
  return (
    <Dialog open onClose={onClose} title={asset ? `Edit ${asset.code}` : "New asset"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.name} onChange={set("name")} placeholder="e.g. Diesel generator 250 kVA" />}</Field>
        <Field label="Category">{(p) => <Input {...p} value={f.category} onChange={set("category")} placeholder="Power, HVAC, Vehicles…" />}</Field>
        <Field label="Location">{(p) => <Input {...p} value={f.location} onChange={set("location")} />}</Field>
        <Field label="Make">{(p) => <Input {...p} value={f.make} onChange={set("make")} />}</Field>
        <Field label="Model">{(p) => <Input {...p} value={f.model} onChange={set("model")} />}</Field>
        <Field label="Serial">{(p) => <Input {...p} value={f.serial} onChange={set("serial")} />}</Field>
        <Field label="Part of">{(p) => <Select {...p} value={f.parentId} onChange={set("parentId")}><option value="">Nothing — it stands alone</option>{(all.data?.assets ?? []).filter((a) => a.id !== asset?.id).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>}</Field>
        <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={set("status")}>{ASSET_STATUSES.map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}</Select>}</Field>
        <Field label="Criticality">{(p) => <Select {...p} value={f.criticality} onChange={set("criticality")}>{CRITICALITY.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select>}</Field>
        <Field label="Looked after by">{(p) => <Select {...p} value={f.custodianId} onChange={set("custodianId")}><option value="">Nobody in particular</option>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Meter unit" hint="hours, km, cycles — blank if it has no meter">{(p) => <Input {...p} value={f.meterUnit} onChange={set("meterUnit")} />}</Field>
        <Field label="Purchased">{(p) => <Input {...p} type="date" value={f.purchaseDate} onChange={set("purchaseDate")} />}</Field>
        <Field label="Warranty until">{(p) => <Input {...p} type="date" value={f.warrantyUntil} onChange={set("warrantyUntil")} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={set("notes")} />}</Field>
      </div>
    </Dialog>
  );
}

type AssetDetail = { asset: Asset; parent: { id: string; code: string; name: string } | null; components: { id: string; code: string; name: string; status: string }[]; readings: { id: string; value: number; on: string }[]; perDay: number | null; plans: Plan[]; orders: Order[]; contracts: Contract[]; cost: { labour: number; parts: number; external: number; total: number }; reliability: { failures: number; downHours: number; mtbf: number | null; mttr: number | null; availability: number | null }; fixedAsset: { id: string; code: string; name: string; cost: number; status: string } | null };

function AssetPage({ id }: { id: string }) {
  const { meta, go } = useMnt();
  const q = useModuleQuery<AssetDetail>(`assets/${id}`);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const [planning, setPlanning] = useState<Plan | "new" | null>(null);
  const [reporting, setReporting] = useState(false);
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { asset: a, reliability: r, cost } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("assets")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Assets</button>
      <PageHeader
        title={`${a.code} · ${a.name}`}
        description={[a.category, a.location, [a.make, a.model].filter(Boolean).join(" "), a.serial && `S/N ${a.serial}`].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={a.status} />
            {meta.me.write && a.meterUnit && <Button size="sm" onClick={() => setReading(true)}>Meter reading</Button>}
            {meta.me.write && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            <Button size="sm" variant="primary" icon={<Wrench className="size-3.5" />} onClick={() => setReporting(true)}>Report a problem</Button>
          </div>
        }
      />
      <CustomFieldsCard entity="maintenance.asset" id={id} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Meter" value={a.meter !== null ? `${a.meter} ${a.meterUnit}` : "—"} sub={a.meterAt ? `read ${dm(a.meterAt)}${q.data.perDay ? ` · ~${Math.round(q.data.perDay * 10) / 10}/day` : ""}` : a.meterUnit ? "no readings yet" : "no meter"} />
        <Stat label="Availability (90 days)" value={r.availability === null ? "—" : `${Math.round(r.availability * 1000) / 10}%`} sub={`${r.failures} breakdown${r.failures === 1 ? "" : "s"} · ${r.downHours}h down`} tone={r.availability !== null && r.availability < 0.95 ? "warn" : undefined} />
        <Stat label="MTBF · MTTR" value={r.mtbf === null ? "—" : `${r.mtbf}h`} sub={r.mttr === null ? "no breakdowns" : `${r.mttr}h to repair`} />
        <Stat label="Maintenance cost" value={inr(cost.total)} sub={`parts ${inr(cost.parts)} · outside ${inr(cost.external)}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <Section title="Preventive plans" action={meta.me.manage ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setPlanning("new")}>Plan</Button> : undefined}>
            {!q.data.plans.length ? <Empty>Plan servicing every so many days, every so much on the meter, or both.</Empty> : (
              <ul className="divide-y divide-border text-[13px]">
                {q.data.plans.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1"><b className={cx("block font-semibold", !p.active && "text-muted line-through")}>{p.title}</b><span className="text-[12px] text-muted">{[p.everyDays && `every ${p.everyDays} days`, p.everyMeter && `every ${p.everyMeter} ${a.meterUnit}`].filter(Boolean).join(" or ")}{p.lastDoneOn ? ` · last done ${dm(p.lastDoneOn)}` : ""}</span></span>
                    <span className={cx("text-[12.5px]", p.due ? "font-semibold text-warning" : "text-muted")}>{p.due ? "Due" : "Next"} {dm(p.date)}{p.meter !== null ? ` · ${p.meter} ${a.meterUnit}` : ""}</span>
                    {meta.me.manage && <Button size="sm" variant="ghost" onClick={() => setPlanning(p)}>Edit</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Work orders">{!q.data.orders.length ? <Empty>No work yet.</Empty> : <OrderList rows={q.data.orders.map((o) => ({ ...o, asset: { code: a.code, name: a.name, criticality: a.criticality }, cost: 0, overdue: false, downMinutes: 0 }))} compact hideAsset />}</Section>
        </div>
        <div className="grid content-start gap-5">
          <Section title="About">
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-muted">Criticality</dt><dd className="capitalize">{a.criticality}</dd>
              <dt className="text-muted">Looked after by</dt><dd>{nameOf(meta, a.custodianId)}</dd>
              <dt className="text-muted">Purchased</dt><dd>{fmt(a.purchaseDate)}</dd>
              <dt className="text-muted">Warranty</dt><dd className={cx(a.warrantyUntil && a.warrantyUntil < today() && "text-muted")}>{a.warrantyUntil ? `${a.warrantyUntil < today() ? "ended" : "until"} ${fmt(a.warrantyUntil)}` : "—"}</dd>
              {q.data.parent && <><dt className="text-muted">Part of</dt><dd><Link href={`/maintenance/assets/${q.data.parent.id}`} className="underline">{q.data.parent.code} {q.data.parent.name}</Link></dd></>}
              {q.data.fixedAsset && <><dt className="text-muted">Fixed asset</dt><dd>{q.data.fixedAsset.code} · {inr(q.data.fixedAsset.cost)}</dd></>}
            </dl>
            {a.notes && <p className="mt-3 text-[12.5px] whitespace-pre-wrap text-muted">{a.notes}</p>}
          </Section>
          {q.data.components.length > 0 && <Section title="Components"><ul className="divide-y divide-border text-[13px]">{q.data.components.map((c) => <li key={c.id} className="flex justify-between py-1.5"><Link href={`/maintenance/assets/${c.id}`} className="hover:underline">{c.code} · {c.name}</Link><Pill s={c.status} /></li>)}</ul></Section>}
          <Section title="Contracts">{!q.data.contracts.length ? <p className="text-[12.5px] text-muted">None.</p> : <ul className="divide-y divide-border text-[13px]">{q.data.contracts.map((c) => <li key={c.id} className="flex justify-between gap-2 py-1.5"><span>{CONTRACT_KIND_LABEL[c.kind]} · {c.vendor}</span><span className="flex items-center gap-1.5 text-[12px]">{dm(c.endOn)} <Pill s={c.state} /></span></li>)}</ul>}</Section>
          <LinkedDocuments type="mnt_asset" id={a.id} name={a.name} />
          {a.meterUnit && <Section title="Readings">{!q.data.readings.length ? <p className="text-[12.5px] text-muted">None yet.</p> : <ul className="divide-y divide-border text-[13px]">{q.data.readings.slice(0, 8).map((x) => <li key={x.id} className="flex justify-between py-1.5"><span className="text-muted">{dm(x.on)}</span><b className="tabular-nums">{x.value} {a.meterUnit}</b></li>)}</ul>}</Section>}
        </div>
      </div>
      {editing && <AssetDialog asset={a} onClose={() => setEditing(false)} />}
      {reading && <ReadingDialog asset={a} onClose={() => setReading(false)} />}
      {planning && <PlanDialog assetId={a.id} meterUnit={a.meterUnit} meter={a.meter} plan={planning === "new" ? undefined : planning} onClose={() => setPlanning(null)} />}
      {reporting && <OrderDialog assetId={a.id} onClose={() => setReporting(false)} />}
    </div>
  );
}

function ReadingDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [on, setOn] = useState(today());
  const [reset, setReset] = useState(false);
  const save = useModuleAction<void, { raised: number }>(() => ({ path: `assets/${asset.id}/readings`, body: { value: Number(value), on, reset } }), { success: (r) => (r.raised ? `Reading saved — ${r.raised} service job${r.raised === 1 ? "" : "s"} raised` : "Reading saved"), onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Meter reading · ${asset.code}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={value === "" || !(Number(value) >= 0)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Reading (${asset.meterUnit})`} hint={asset.meter !== null ? `Last: ${asset.meter}` : undefined}>{(p) => <Input {...p} autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
        <Field label="Read on">{(p) => <Input {...p} type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Switch checked={reset} onChange={setReset} label="The meter was replaced or reset" /></div>
      </div>
    </Dialog>
  );
}

function PlanDialog({ assetId, meterUnit, meter, plan, onClose }: { assetId: string; meterUnit: string; meter: number | null; plan?: Plan; onClose: () => void }) {
  const { meta } = useMnt();
  const [f, setF] = useState({ title: plan?.title ?? "", everyDays: plan?.everyDays ? String(plan.everyDays) : "", everyMeter: plan?.everyMeter ? String(plan.everyMeter) : "", startOn: plan?.startOn ?? today(), startMeter: String(plan?.startMeter ?? meter ?? 0), leadDays: String(plan?.leadDays ?? 7), leadMeter: String(plan?.leadMeter ?? 0), checklist: (plan?.checklist ?? []).map((c) => c.text).join("\n"), estimateHours: plan?.estimateHours ? String(plan.estimateHours) : "", assigneeId: plan?.assigneeId ?? "", active: plan?.active ?? true });
  const [parts, setParts] = useState(plan?.parts ?? []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const body = { assetId, title: f.title, everyDays: f.everyDays ? Number(f.everyDays) : null, everyMeter: f.everyMeter ? Number(f.everyMeter) : null, startOn: f.startOn, startMeter: Number(f.startMeter) || 0, leadDays: Number(f.leadDays) || 0, leadMeter: Number(f.leadMeter) || 0, checklist: f.checklist.split("\n").map((t) => t.trim()).filter(Boolean).map((text, i) => ({ id: `c${i + 1}`, text })), parts: parts.filter((p) => p.itemId && p.qty > 0), estimateHours: Number(f.estimateHours) || 0, assigneeId: f.assigneeId || null, active: f.active };
  const save = useModuleAction<void>(() => ({ path: plan ? `plans/${plan.id}` : "plans", method: plan ? "PUT" : "POST", body }), { success: "Plan saved", onDone: onClose });
  const del = useModuleAction<void>(() => ({ path: `plans/${plan!.id}`, method: "DELETE" }), { success: "Plan removed", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={plan ? "Edit plan" : "New preventive plan"} footer={<>{plan && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim() || (!f.everyDays && !f.everyMeter)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Task" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Oil and filter change" />}</Field>
        <Field label="Every (days)">{(p) => <Input {...p} inputMode="numeric" value={f.everyDays} onChange={set("everyDays")} />}</Field>
        {meterUnit ? <Field label={`Every (${meterUnit})`} hint="Whichever comes first">{(p) => <Input {...p} inputMode="decimal" value={f.everyMeter} onChange={set("everyMeter")} />}</Field> : <p className="self-end pb-2 text-[12px] text-muted">Give the asset a meter to plan by usage.</p>}
        <Field label="Counting from" hint="The first service is one interval after">{(p) => <Input {...p} type="date" value={f.startOn} onChange={set("startOn")} />}</Field>
        {meterUnit && <Field label={`Counting from (${meterUnit})`}>{(p) => <Input {...p} inputMode="decimal" value={f.startMeter} onChange={set("startMeter")} />}</Field>}
        <Field label="Raise it early (days)">{(p) => <Input {...p} inputMode="numeric" value={f.leadDays} onChange={set("leadDays")} />}</Field>
        {meterUnit && <Field label={`Raise it early (${meterUnit})`}>{(p) => <Input {...p} inputMode="decimal" value={f.leadMeter} onChange={set("leadMeter")} />}</Field>}
        <Field label="Done by">{(p) => <Select {...p} value={f.assigneeId} onChange={set("assigneeId")}><option value="">Whoever picks it up</option>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Takes about (hours)">{(p) => <Input {...p} inputMode="decimal" value={f.estimateHours} onChange={set("estimateHours")} />}</Field>
        <Field label="Checklist" hint="One step per line" className="sm:col-span-2">{(p) => <Textarea {...p} rows={4} value={f.checklist} onChange={set("checklist")} />}</Field>
        {meta.links.inventory && meta.items.length > 0 && (
          <div className="grid gap-2 sm:col-span-2">
            <p className="text-[12.5px] font-medium">Spare parts it uses</p>
            {parts.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Select aria-label={`Part ${i + 1}`} value={p.itemId} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className="h-9 flex-1">{meta.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</Select>
                <Input aria-label={`Quantity of part ${i + 1}`} inputMode="decimal" value={String(p.qty)} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} className="h-9 !w-24" />
                <Button size="sm" variant="ghost" aria-label="Remove part" icon={<X className="size-3.5" />} onClick={() => setParts(parts.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setParts([...parts, { itemId: meta.items[0].id, qty: 1 }])}>Part</Button>
          </div>
        )}
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>
      </div>
    </Dialog>
  );
}

// ── Work orders ─────────────────────────────────────────────────────────────

function OrderList({ rows, compact, hideAsset }: { rows: OrderRow[]; compact?: boolean; hideAsset?: boolean }) {
  const { meta } = useMnt();
  return (
    <ul className={cx("divide-y divide-border text-[13px]", !compact && "rounded-[20px] border border-border bg-surface px-4 shadow-sm")}>
      {rows.map((o) => (
        <li key={o.id}>
          <Link href={`/maintenance/orders/${o.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:opacity-80">
            <span className="min-w-0 flex-1">
              <b className="block truncate font-semibold">{o.title}</b>
              <span className="text-[12px] text-muted">{o.number} · {ORDER_KIND_LABEL[o.kind]}{hideAsset ? "" : ` · ${o.asset.code} ${o.asset.name}`}{o.assigneeId ? ` · ${nameOf(meta, o.assigneeId)}` : ""}</span>
            </span>
            {o.priority !== "normal" && <span className={cx("text-[11px] font-semibold uppercase", PRIORITY_TONE[o.priority])}>{o.priority}</span>}
            {o.dueDate && <span className={cx("text-[12px]", o.overdue ? "font-semibold text-danger" : "text-muted")}>{dm(o.dueDate)}</span>}
            <Pill s={o.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OrdersView({ startNew }: { startNew?: boolean }) {
  const { go } = useMnt();
  const [tab, setTab] = useState<"open" | "mine" | "done" | "all">("open");
  const [adding, setAdding] = useState(!!startNew);
  const q = useModuleQuery<{ orders: OrderRow[] }>(`orders?${tab === "mine" ? "status=open&mine=1" : `status=${tab}`}`, { keepPrevious: true });
  const rows = q.data?.orders ?? [];
  return (
    <div>
      <PageHeader
        title="Work orders"
        description="Breakdowns, requests and servicing, from reported to done."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="work-orders" columns={[{ key: "number", label: "Number" }, { key: "asset", label: "Asset" }, { key: "kind", label: "Kind" }, { key: "title", label: "Title" }, { key: "priority", label: "Priority" }, { key: "status", label: "Status" }, { key: "dueDate", label: "Due" }, { key: "downHours", label: "Downtime (h)" }, { key: "cost", label: "Cost", money: true }, { key: "cause", label: "Cause" }, { key: "remedy", label: "Remedy" }]} rows={rows.map((o) => ({ ...o, asset: `${o.asset.code} ${o.asset.name}`, kind: ORDER_KIND_LABEL[o.kind], downHours: Math.round((o.downMinutes / 60) * 100) / 100 }))} />
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Work order</Button>
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: "open", label: "Open" }, { value: "mine", label: "Mine" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>{tab === "open" ? "Nothing open." : "None."}</Empty> : <OrderList rows={rows} />}
      {adding && <OrderDialog onClose={() => (setAdding(false), startNew && go("orders"))} onSaved={(id) => go(`orders/${id}`)} />}
    </div>
  );
}

function OrderDialog({ assetId, onClose, onSaved }: { assetId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useMnt();
  const assets = useModuleQuery<{ assets: AssetRow[] }>("assets");
  const [f, setF] = useState({ assetId: assetId ?? "", kind: "breakdown", title: "", description: "", priority: "normal", assigneeId: "", dueDate: "", stopped: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const asset = f.assetId || assets.data?.assets[0]?.id || "";
  const save = useModuleAction<void, { order: Order }>(() => ({ path: "orders", body: { ...f, assetId: asset, assigneeId: f.assigneeId || null, dueDate: f.dueDate || null } }), { success: meta.me.write ? "Work order raised" : "Request sent", onDone: (r) => (onClose(), onSaved?.(r.order.id)) });
  return (
    <Dialog open onClose={onClose} title={meta.me.write ? "New work order" : "Report a problem"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.title.trim() || !asset} loading={save.isPending} onClick={() => save.mutate()}>{meta.me.write ? "Raise" : "Send"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset" className="sm:col-span-2">{(p) => <Select {...p} value={asset} onChange={set("assetId")}>{(assets.data?.assets ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>}</Field>
        <Field label="What's wrong, or what to do" className="sm:col-span-2">{(p) => <Input {...p} autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Won't start" />}</Field>
        <Field label="Details" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.description} onChange={set("description")} />}</Field>
        {meta.me.write && <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}>{ORDER_KINDS.map((k) => <option key={k} value={k}>{ORDER_KIND_LABEL[k]}</option>)}</Select>}</Field>}
        <Field label="Priority">{(p) => <Select {...p} value={f.priority} onChange={set("priority")}>{PRIORITIES.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</Select>}</Field>
        {meta.me.write && <Field label="Assign to">{(p) => <Select {...p} value={f.assigneeId} onChange={set("assigneeId")}><option value="">Nobody yet</option>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
        {meta.me.write && <Field label="Due">{(p) => <Input {...p} type="date" value={f.dueDate} onChange={set("dueDate")} />}</Field>}
        {f.kind !== "preventive" && <div className="sm:col-span-2"><Switch checked={f.stopped} onChange={(v) => setF({ ...f, stopped: v })} label="The asset has stopped (downtime starts now)" /></div>}
      </div>
    </Dialog>
  );
}

type OrderDetail = { order: Order; asset: { id: string; code: string; name: string; status: string; meter: number | null; meterUnit: string; location: string }; plan: { id: string; title: string; parts: { itemId: string; qty: number }[] } | null; items: { id: string; name: string; unit: string; sku: string }[]; cost: { labour: number; parts: number; external: number; total: number }; downMinutes: number };

function OrderPage({ id }: { id: string }) {
  const { meta, go } = useMnt();
  const q = useModuleQuery<OrderDetail>(`orders/${id}`);
  const [dialog, setDialog] = useState<"labour" | "parts" | "external" | "complete" | "edit" | null>(null);
  const step = useModuleAction<string>((s) => ({ path: `orders/${id}/step`, body: { step: s } }), { success: "Updated" });
  const tick = useModuleAction<{ item: string; done: boolean }>((b) => ({ path: `orders/${id}/tick`, body: b }));
  const cancel = useModuleAction<void>(() => ({ path: `orders/${id}/cancel` }), { success: "Cancelled" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { order: o, asset: a, cost } = q.data;
  const open = ["requested", "open", "in_progress", "on_hold"].includes(o.status);
  const stopped = !!o.downFrom && !o.downTo;
  const w = meta.me.write && open;
  return (
    <div>
      <button type="button" onClick={() => go("orders")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Work orders</button>
      <PageHeader
        title={o.title}
        description={<span>{o.number} · {ORDER_KIND_LABEL[o.kind]} · <Link href={`/maintenance/assets/${a.id}`} className="underline">{a.code} {a.name}</Link>{a.location ? ` · ${a.location}` : ""}</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={o.status} />
            {w && <Button size="sm" onClick={() => setDialog("edit")}>{o.status === "requested" ? "Accept" : "Edit"}</Button>}
            {w && o.status === "open" && <Button size="sm" onClick={() => step.mutate("start")}>Start</Button>}
            {w && o.status === "in_progress" && <Button size="sm" onClick={() => step.mutate("hold")}>Hold</Button>}
            {w && o.status === "on_hold" && <Button size="sm" onClick={() => step.mutate("resume")}>Resume</Button>}
            {w && !stopped && <Button size="sm" variant="ghost" onClick={() => step.mutate("stop")}>Asset stopped</Button>}
            {w && stopped && <Button size="sm" variant="ghost" onClick={() => step.mutate("back")}>Back running</Button>}
            {w && o.status !== "requested" && <Button size="sm" variant="primary" onClick={() => setDialog("complete")}>Finish</Button>}
            {w && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel job</Button>}
          </div>
        }
      />
      {stopped && <div className="mb-4"><Notice tone="danger" title={`${a.code} is stopped`}>Down for {hm(q.data.downMinutes)} so far.</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Assigned to" value={nameOf(meta, o.assigneeId)} sub={o.dueDate ? `due ${dm(o.dueDate)}` : undefined} />
        <Stat label="Labour" value={inr(cost.labour)} sub={hm(o.labour.reduce((n, l) => n + l.minutes, 0))} />
        <Stat label="Parts" value={inr(cost.parts)} sub={`${o.parts.length} item${o.parts.length === 1 ? "" : "s"}`} />
        <Stat label="Total" value={inr(cost.total)} sub={o.externalCost ? `incl. ${inr(o.externalCost)} outside` : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Checklist">
          {!o.checklist.length ? <p className="text-[12.5px] text-muted">{o.description || "No checklist."}</p> : (
            <ul className="grid gap-1.5 text-[13px]">
              {o.checklist.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={c.done} disabled={!w} onChange={(e) => tick.mutate({ item: c.id, done: e.target.checked })} className="accent-[var(--accent)]" />
                    <span className={cx(c.done && "text-muted line-through")}>{c.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {o.description && o.checklist.length > 0 && <p className="mt-3 text-[12.5px] text-muted">{o.description}</p>}
        </Section>
        <Section title="Labour" action={w ? <Button size="sm" onClick={() => setDialog("labour")}>Log time</Button> : undefined}>
          {!o.labour.length ? <p className="text-[12.5px] text-muted">None yet.</p> : <ul className="divide-y divide-border text-[13px]">{o.labour.map((l, i) => <li key={i} className="flex justify-between py-1.5"><span>{nameOf(meta, l.userId)} <span className="text-muted">· {dm(l.on)}</span></span><span className="tabular-nums">{hm(l.minutes)}{l.rate ? ` · ${inr(Math.round((l.minutes * l.rate) / 60))}` : ""}</span></li>)}</ul>}
        </Section>
        <Section title="Spare parts" action={w && meta.links.inventory ? <Button size="sm" onClick={() => setDialog("parts")}>Issue parts</Button> : undefined}>
          {!o.parts.length ? <p className="text-[12.5px] text-muted">{q.data.plan?.parts.length ? `The plan uses ${q.data.plan.parts.length} part${q.data.plan.parts.length === 1 ? "" : "s"}.` : "None issued."}</p> : <ul className="divide-y divide-border text-[13px]">{o.parts.map((p) => { const it = q.data!.items.find((x) => x.id === p.itemId); return <li key={p.itemId} className="flex justify-between py-1.5"><span>{it?.name ?? "Item"}</span><span className="tabular-nums">{p.qty} {it?.unit} · {inr(p.cost)}</span></li>; })}</ul>}
        </Section>
        <Section title="Outside work" action={w ? <Button size="sm" onClick={() => setDialog("external")}>{o.externalCost ? "Change" : "Add"}</Button> : undefined}>
          <p className="text-[13px]">{o.externalCost ? <>{inr(o.externalCost)} <span className="text-muted">{o.externalNote}</span></> : <span className="text-muted">None.</span>}</p>
        </Section>
        {o.status === "done" && (
          <Section title="What was found">
            <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-[13px]"><dt className="text-muted">Failure</dt><dd>{o.failure || "—"}</dd><dt className="text-muted">Cause</dt><dd>{o.cause || "—"}</dd><dt className="text-muted">Remedy</dt><dd>{o.remedy || "—"}</dd></dl>
          </Section>
        )}
      </div>
      {dialog === "labour" && <LabourDialog id={id} onClose={() => setDialog(null)} />}
      {dialog === "parts" && <PartsDialog id={id} order={o} suggested={q.data.plan?.parts ?? []} onClose={() => setDialog(null)} />}
      {dialog === "external" && <ExternalDialog id={id} order={o} onClose={() => setDialog(null)} />}
      {dialog === "complete" && <CompleteDialog id={id} order={o} asset={a} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditOrderDialog order={o} onClose={() => setDialog(null)} />}
    </div>
  );
}

function EditOrderDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const { meta } = useMnt();
  const [f, setF] = useState({ title: order.title, description: order.description, priority: order.priority, assigneeId: order.assigneeId ?? meta.me.id, dueDate: order.dueDate ?? "", kind: order.kind === "request" ? "breakdown" : order.kind });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: `orders/${order.id}`, method: "PUT", body: { ...f, assigneeId: f.assigneeId || null, dueDate: f.dueDate || null } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={order.status === "requested" ? "Accept the request" : `Edit ${order.number}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}>{ORDER_KINDS.map((k) => <option key={k} value={k}>{ORDER_KIND_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="Priority">{(p) => <Select {...p} value={f.priority} onChange={set("priority")}>{PRIORITIES.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</Select>}</Field>
        <Field label="Assign to">{(p) => <Select {...p} value={f.assigneeId} onChange={set("assigneeId")}><option value="">Nobody yet</option>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Due">{(p) => <Input {...p} type="date" value={f.dueDate} onChange={set("dueDate")} />}</Field>
        <Field label="Details" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.description} onChange={set("description")} />}</Field>
      </div>
    </Dialog>
  );
}

function LabourDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { meta } = useMnt();
  const [f, setF] = useState({ userId: meta.me.id, hours: "", on: today(), rate: "" });
  const minutes = Math.round((Number(f.hours) || 0) * 60);
  const save = useModuleAction<void>(() => ({ path: `orders/${id}/labour`, body: { userId: f.userId, minutes, on: f.on, ...(meta.me.manage && f.rate ? { rate: toPaise(f.rate) } : {}) } }), { success: "Time logged", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Log time" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={minutes < 1} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who">{(p) => <Select {...p} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{meta.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <Field label="Hours">{(p) => <Input {...p} autoFocus inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder="1.5" />}</Field>
        <Field label="On">{(p) => <Input {...p} type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />}</Field>
        {meta.me.manage && <Field label="Rate (₹/hour)" hint={meta.settings.labourRate ? `Default ${inr(meta.settings.labourRate)}` : "No default rate set"}>{(p) => <Input {...p} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}</Field>}
      </div>
    </Dialog>
  );
}

function PartsDialog({ id, order, suggested, onClose }: { id: string; order: Order; suggested: { itemId: string; qty: number }[]; onClose: () => void }) {
  const { meta } = useMnt();
  const [warehouseId, setWh] = useState(order.warehouseId ?? meta.settings.partsWarehouseId ?? meta.warehouses[0]?.id ?? "");
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>(suggested.length && !order.parts.length ? suggested.map((p) => ({ itemId: p.itemId, qty: String(p.qty) })) : [{ itemId: meta.items[0]?.id ?? "", qty: "1" }]);
  const save = useModuleAction<void>(() => ({ path: `orders/${id}/parts`, body: { warehouseId, lines: lines.filter((l) => l.itemId && Number(l.qty)).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) } }), { success: "Parts issued", onDone: onClose, also: ["inventory"] });
  return (
    <Dialog open onClose={onClose} title="Issue spare parts" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!warehouseId || !lines.some((l) => l.itemId && Number(l.qty))} loading={save.isPending} onClick={() => save.mutate()}>Issue</Button></>}>
      <div className="grid gap-3">
        <Field label="From">{(p) => <Select {...p} value={warehouseId} onChange={(e) => setWh(e.target.value)}>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label={`Part ${i + 1}`} value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className="h-9 flex-1">{meta.items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` · ${it.sku}` : ""}</option>)}</Select>
            <Input aria-label={`Quantity of part ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-9 !w-24" />
            <Button size="sm" variant="ghost" aria-label="Remove line" icon={<X className="size-3.5" />} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setLines([...lines, { itemId: meta.items[0]?.id ?? "", qty: "1" }])}>Line</Button>
        <p className="text-[12px] text-muted">A negative quantity returns unused parts to stock.</p>
      </div>
    </Dialog>
  );
}

function ExternalDialog({ id, order, onClose }: { id: string; order: Order; onClose: () => void }) {
  const [cost, setCost] = useState(order.externalCost ? String(order.externalCost / 100) : "");
  const [note, setNote] = useState(order.externalNote);
  const save = useModuleAction<void>(() => ({ path: `orders/${id}/external`, body: { cost: toPaise(cost), note } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Outside work" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cost (₹)">{(p) => <Input {...p} autoFocus inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <Field label="Who and what">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Electrician visit" />}</Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">Recorded on the job; enter the vendor&apos;s bill in Accounting to pay it.</p>
    </Dialog>
  );
}

function CompleteDialog({ id, order, asset, onClose }: { id: string; order: Order; asset: OrderDetail["asset"]; onClose: () => void }) {
  const [f, setF] = useState({ failure: "", cause: "", remedy: "", meter: "" });
  const left = order.checklist.filter((c) => !c.done).length;
  const [force, setForce] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: `orders/${id}/complete`, body: { failure: f.failure, cause: f.cause, remedy: f.remedy, meter: f.meter ? Number(f.meter) : null, force } }), { success: "Job done", onDone: onClose });
  const breakdown = order.kind === "breakdown";
  return (
    <Dialog open onClose={onClose} title={`Finish ${order.number}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={(breakdown && !f.cause.trim()) || (left > 0 && !force)} loading={save.isPending} onClick={() => save.mutate()}>Finish</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {breakdown && <Field label="What failed">{(p) => <Input {...p} value={f.failure} onChange={set("failure")} placeholder="e.g. No start" />}</Field>}
        {breakdown && <Field label="Cause">{(p) => <Input {...p} value={f.cause} onChange={set("cause")} placeholder="e.g. Flat battery" />}</Field>}
        <Field label={breakdown ? "Remedy" : "Notes"} className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.remedy} onChange={set("remedy")} />}</Field>
        {asset.meterUnit && <Field label={`Meter now (${asset.meterUnit})`} hint={asset.meter !== null ? `Last: ${asset.meter}` : undefined}>{(p) => <Input {...p} inputMode="decimal" value={f.meter} onChange={set("meter")} />}</Field>}
        {left > 0 && <div className="sm:col-span-2"><Switch checked={force} onChange={setForce} label={`Finish with ${left} checklist item${left === 1 ? "" : "s"} not done`} /></div>}
      </div>
    </Dialog>
  );
}

// ── Plans ───────────────────────────────────────────────────────────────────

function PlansView() {
  const { meta } = useMnt();
  const q = useModuleQuery<{ plans: (Plan & { asset: { id: string; code: string; name: string; meter: number | null; meterUnit: string }; openOrder: { id: string; number: string } | null })[] }>("plans");
  const raise = useModuleAction<void, { raised: unknown[] }>(() => ({ path: "plans/raise" }), { success: (r) => (r.raised.length ? `Raised ${r.raised.length} work order${r.raised.length === 1 ? "" : "s"}` : "Nothing due yet") });
  const rows = q.data?.plans ?? [];
  return (
    <div>
      <PageHeader
        title="Preventive plans"
        description="Every plan, soonest due first. Add plans from an asset's page."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="preventive-plans" columns={[{ key: "asset", label: "Asset" }, { key: "title", label: "Task" }, { key: "everyDays", label: "Every (days)" }, { key: "everyMeter", label: "Every (meter)" }, { key: "lastDoneOn", label: "Last done" }, { key: "date", label: "Next due" }, { key: "meter", label: "Due at meter" }, { key: "active", label: "Active" }]} rows={rows.map((p) => ({ ...p, asset: `${p.asset.code} ${p.asset.name}`, active: p.active ? "yes" : "no" }))} />
            {meta.me.write && <Button size="sm" variant="primary" loading={raise.isPending} onClick={() => raise.mutate()}>Raise due work orders</Button>}
          </div>
        }
      />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No plans yet. Open an asset and add one.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1"><b className={cx("block font-semibold", !p.active && "text-muted line-through")}>{p.title}</b><Link href={`/maintenance/assets/${p.asset.id}`} className="text-[12px] text-muted hover:underline">{p.asset.code} · {p.asset.name}</Link></span>
              <span className="text-[12px] text-muted">{[p.everyDays && `${p.everyDays}d`, p.everyMeter && `${p.everyMeter} ${p.asset.meterUnit}`].filter(Boolean).join(" / ")}</span>
              <span className={cx("w-28 text-right", p.due ? "font-semibold text-warning" : "text-muted")}>{dm(p.date)}</span>
              {p.openOrder ? <Link href={`/maintenance/orders/${p.openOrder.id}`} className="text-[12px] font-semibold underline">{p.openOrder.number}</Link> : <span className="w-16" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────

function ContractsView() {
  const { meta } = useMnt();
  const q = useModuleQuery<{ contracts: Contract[] }>("contracts");
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const rows = q.data?.contracts ?? [];
  return (
    <div>
      <PageHeader
        title="Contracts"
        description="AMCs, warranties, insurance, calibration and leases on your assets, flagged before they end."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="maintenance-contracts" columns={[{ key: "kind", label: "Kind" }, { key: "vendor", label: "Vendor" }, { key: "reference", label: "Reference" }, { key: "assets", label: "Assets" }, { key: "startOn", label: "Start" }, { key: "endOn", label: "End" }, { key: "cost", label: "Cost", money: true }, { key: "visits", label: "Visits" }, { key: "state", label: "State" }]} rows={rows.map((c) => ({ ...c, kind: CONTRACT_KIND_LABEL[c.kind], assets: (c.assets ?? []).map((a) => a.code).join(", "), state: LABEL[c.state] }))} />
            {meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Contract</Button>}
          </div>
        }
      />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No contracts yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={!meta.me.manage} onClick={() => setEditing(c)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left disabled:cursor-default">
                <span className="min-w-0 flex-1"><b className="block font-semibold">{CONTRACT_KIND_LABEL[c.kind]} · {c.vendor}{c.reference ? <span className="font-normal text-muted"> · {c.reference}</span> : null}</b><span className="text-[12px] text-muted">{(c.assets ?? []).map((a) => a.code).join(", ")}{c.visits ? ` · ${c.visits} visits` : ""}</span></span>
                {meta.me.manage && c.cost > 0 && <span className="tabular-nums">{inr(c.cost)}</span>}
                <span className="text-[12px] text-muted">{dm(c.startOn)} – {dm(c.endOn)}</span>
                <Pill s={c.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ContractDialog contract={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ContractDialog({ contract, onClose }: { contract?: Contract; onClose: () => void }) {
  const assets = useModuleQuery<{ assets: AssetRow[] }>("assets");
  const [f, setF] = useState({ kind: contract?.kind ?? "amc", vendor: contract?.vendor ?? "", reference: contract?.reference ?? "", startOn: contract?.startOn ?? today(), endOn: contract?.endOn ?? "", cost: contract?.cost ? String(contract.cost / 100) : "", visits: contract?.visits ? String(contract.visits) : "", notes: contract?.notes ?? "" });
  const [picked, setPicked] = useState<string[]>(contract?.assetIds ?? []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: contract ? `contracts/${contract.id}` : "contracts", method: contract ? "PUT" : "POST", body: { ...f, cost: toPaise(f.cost), visits: Number(f.visits) || 0, assetIds: picked } }), { success: "Contract saved", onDone: onClose });
  const del = useModuleAction<void>(() => ({ path: `contracts/${contract!.id}`, method: "DELETE" }), { success: "Contract removed", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={contract ? "Edit contract" : "New contract"} footer={<>{contract && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => del.mutate()}>Remove</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.vendor.trim() || !f.endOn || !picked.length} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}>{CONTRACT_KINDS.map((k) => <option key={k} value={k}>{CONTRACT_KIND_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="Vendor">{(p) => <Input {...p} autoFocus value={f.vendor} onChange={set("vendor")} />}</Field>
        <Field label="Reference">{(p) => <Input {...p} value={f.reference} onChange={set("reference")} placeholder="Policy or contract number" />}</Field>
        <Field label="Cost for the term (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.cost} onChange={set("cost")} />}</Field>
        <Field label="Starts">{(p) => <Input {...p} type="date" value={f.startOn} onChange={set("startOn")} />}</Field>
        <Field label="Ends">{(p) => <Input {...p} type="date" value={f.endOn} onChange={set("endOn")} />}</Field>
        <Field label="Visits included">{(p) => <Input {...p} inputMode="numeric" value={f.visits} onChange={set("visits")} />}</Field>
        <fieldset className="grid max-h-44 gap-1 overflow-y-auto rounded-[12px] border border-border p-2 sm:col-span-2">
          <legend className="px-1 text-[12.5px] font-medium">Assets it covers</legend>
          {(assets.data?.assets ?? []).map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} className="accent-[var(--accent)]" />{a.code} · {a.name}</label>
          ))}
        </fieldset>
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={set("notes")} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Reports & settings ──────────────────────────────────────────────────────

type ReportRow = { id: string; code: string; name: string; category: string; criticality: string; failures: number; downHours: number; mtbf: number | null; mttr: number | null; availability: number | null; jobs: number; preventive: number; cost: { labour: number; parts: number; external: number; total: number } };

function ReportsView() {
  const [from, setFrom] = useState(() => new Date(Date.parse(`${today()}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const q = useModuleQuery<{ from: string; to: string; hours: number; assets: ReportRow[]; totals: { failures: number; downHours: number; jobs: number; cost: number; preventiveShare: number | null } }>(`reports?from=${from}&to=${to}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <PageHeader
        title="Reliability & cost"
        description="Breakdowns, downtime, MTBF, MTTR and availability per asset, and what completed jobs cost."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 !w-40 text-[13px]" />
            <Input aria-label="To" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-8 !w-40 text-[13px]" />
            {d && <ExportMenu name="maintenance-reliability" columns={[{ key: "code", label: "Code" }, { key: "name", label: "Asset" }, { key: "failures", label: "Breakdowns" }, { key: "downHours", label: "Downtime (h)" }, { key: "mtbf", label: "MTBF (h)" }, { key: "mttr", label: "MTTR (h)" }, { key: "availability", label: "Availability %" }, { key: "jobs", label: "Jobs done" }, { key: "preventive", label: "Preventive jobs" }, { key: "total", label: "Cost", money: true }]} rows={d.assets.map((r) => ({ ...r, mtbf: r.mtbf ?? "", mttr: r.mttr ?? "", availability: r.availability === null ? "" : Math.round(r.availability * 10000) / 100, total: r.cost.total }))} />}
          </div>
        }
      />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Breakdowns" value={d.totals.failures} />
            <Stat label="Downtime" value={`${d.totals.downHours}h`} />
            <Stat label="Jobs done" value={d.totals.jobs} sub={d.totals.preventiveShare === null ? undefined : `${Math.round(d.totals.preventiveShare * 100)}% preventive`} />
            <Stat label="Cost" value={inr(d.totals.cost)} />
          </div>
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface px-4 shadow-sm">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead><tr className="text-left text-[12px] text-muted"><th className="py-2.5 pr-3 font-medium">Asset</th><th className="py-2.5 pr-3 text-right font-medium">Breakdowns</th><th className="py-2.5 pr-3 text-right font-medium">Down</th><th className="py-2.5 pr-3 text-right font-medium">MTBF</th><th className="py-2.5 pr-3 text-right font-medium">MTTR</th><th className="py-2.5 pr-3 text-right font-medium">Availability</th><th className="py-2.5 text-right font-medium">Cost</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.assets.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3"><Link href={`/maintenance/assets/${r.id}`} className="font-medium hover:underline">{r.code} · {r.name}</Link></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.failures}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.downHours}h</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.mtbf === null ? "—" : `${r.mtbf}h`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.mttr === null ? "—" : `${r.mttr}h`}</td>
                    <td className={cx("py-2 pr-3 text-right tabular-nums", r.availability !== null && r.availability < 0.95 && "font-semibold text-danger")}>{r.availability === null ? "—" : `${Math.round(r.availability * 1000) / 10}%`}</td>
                    <td className="py-2 text-right tabular-nums">{inr(r.cost.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted">Availability is the hours in the period less breakdown downtime, over the hours in the period. Planned servicing isn&apos;t counted as downtime unless the asset was marked stopped on a breakdown.</p>
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const { meta } = useMnt();
  const [f, setF] = useState({ ...meta.settings, labourRate: meta.settings.labourRate ? String(meta.settings.labourRate / 100) : "" });
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: { ...f, labourRate: toPaise(f.labourRate), partsWarehouseId: f.partsWarehouseId || null } }), { success: "Saved" });
  return (
    <div className="grid max-w-2xl gap-5">
      <PageHeader title="Maintenance settings" />
      <Section title="Numbering and costs">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Asset codes start with">{(p) => <Input {...p} value={f.assetPrefix} onChange={(e) => setF({ ...f, assetPrefix: e.target.value })} />}</Field>
          <Field label="Work orders start with">{(p) => <Input {...p} value={f.orderPrefix} onChange={(e) => setF({ ...f, orderPrefix: e.target.value })} />}</Field>
          <Field label="Labour rate (₹/hour)" hint="To cost time on jobs">{(p) => <Input {...p} inputMode="decimal" value={f.labourRate} onChange={(e) => setF({ ...f, labourRate: e.target.value })} />}</Field>
          {meta.links.inventory && <Field label="Spare parts come from">{(p) => <Select {...p} value={f.partsWarehouseId ?? ""} onChange={(e) => setF({ ...f, partsWarehouseId: e.target.value || null })}><option value="">Ask each time</option>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>}
          <Field label="Flag contracts ending within (days)">{(p) => <Input {...p} inputMode="numeric" value={String(f.contractNoticeDays)} onChange={(e) => setF({ ...f, contractNoticeDays: Number(e.target.value) || 0 })} />}</Field>
        </div>
        <div className="mt-3"><Switch checked={f.requestsFromEveryone} onChange={(v) => setF({ ...f, requestsFromEveryone: v })} label="Anyone on the team can report a problem" /></div>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
