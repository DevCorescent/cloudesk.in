"use client";

// Manufacturing: home, work orders (issue, time, finish), recipes, work
// centres and capacity, MRP and settings.
import { ArrowLeft, Calculator, Cog, Factory, Home, ListTree, Plus, Settings, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Section, Stat } from "@/components/crm/shared";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { WO_LABEL, type MfgSettings, type WoStatus } from "@/lib/manufacturing/model";
import { formatPrice } from "@/lib/store/money";

type Meta = { me: { write: boolean; manage: boolean }; settings: MfgSettings; items: { id: string; name: string; sku: string; unit: string; avgCost: number; trackBatches: boolean }[]; warehouses: { id: string; name: string; isDefault: boolean }[]; centres: { id: string; code: string; name: string; costPerHour: number; hoursPerDay: number; active: boolean }[]; parts: { routing: boolean; mrp: boolean } };
const useMfg = () => useModule<Meta>();
const inr = (n: number) => formatPrice(n, "INR");
const qty = (n: number) => Number(Number(n).toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { draft: "bg-surface-2 text-muted", released: "bg-accent-soft text-accent", in_progress: "bg-warning-soft text-warning", done: "bg-success-soft text-success", cancelled: "bg-surface-2 text-muted" };
const Pill = ({ s }: { s: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[s])}>{WO_LABEL[s as WoStatus] ?? s}</span>;

export function ManufacturingApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="manufacturing"
      base="manufacturing"
      title="Manufacturing"
      icon={<Factory />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "work-orders", label: "Work orders", icon: <Factory />, group: "Production" },
        { id: "mrp", label: "MRP", icon: <Calculator />, hidden: !m.parts.mrp },
        { id: "boms", label: "Recipes", icon: <ListTree />, group: "Setup" },
        { id: "work-centres", label: "Work centres", icon: <Cog />, hidden: !m.parts.routing },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={(m) => {
        switch (section) {
          case "work-orders":
            return isId(id) ? <WorkOrderPage key={id} id={id!} /> : <WorkOrdersView />;
          case "mrp":
            return m.parts.mrp ? <MrpView /> : <Empty>MRP is switched off.</Empty>;
          case "boms":
            return id === "new" ? <BomEditor /> : isId(id) ? <BomEditor key={id} id={id} /> : <BomsView />;
          case "work-centres":
            return <CentresView />;
          case "settings":
            return <SettingsView />;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}

type HomeData = { wip: { count: number; value: number }; released: number; drafts: number; late: { id: string; number: string; item: string; plannedEnd: string }[]; month: { orders: number; value: number }; recent: { id: string; number: string; item: string; unit: string; produced: number; unitCost: number; materialValue: number; minutes: number; yieldPct: number }[] };

function HomeView() {
  const { meta, go } = useMfg();
  const q = useModuleQuery<HomeData>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Manufacturing" description="What's being made, what's late, and what it really cost." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("work-orders")}>Work order</Button>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="In production" value={d.wip.count} sub={`${inr(d.wip.value)} of materials in progress`} />
            <Stat label="Released" value={d.released} sub={d.drafts ? `${d.drafts} draft${d.drafts === 1 ? "" : "s"}` : "no drafts"} />
            <Stat label="Late" value={d.late.length} tone={d.late.length ? "warn" : undefined} />
            <Stat label="Made this month" value={inr(d.month.value)} sub={`${d.month.orders} work order${d.month.orders === 1 ? "" : "s"}`} />
          </div>
          {d.late.length > 0 && <Section title="Late"><ul className="divide-y divide-border text-[13px]">{d.late.map((x) => <li key={x.id} className="flex justify-between py-2"><Link href={`/manufacturing/work-orders/${x.id}`} className="font-medium hover:underline">{x.number} · {x.item}</Link><span className="text-danger">due {fmt(x.plannedEnd)}</span></li>)}</ul></Section>}
          <Section title="Finished this month">
            {!d.recent.length ? <Empty>Nothing finished yet this month.</Empty> : (
              <table className="w-full text-[13px]">
                <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Order</th><th className="py-1.5 font-medium">Made</th><th className="py-1.5 font-medium">Unit cost</th><th className="py-1.5 font-medium">Material variance</th><th className="py-1.5 font-medium">Time variance</th><th className="py-1.5 font-medium">Yield</th></tr></thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.recent.map((r) => <tr key={r.id}><td className="py-2 text-left"><Link href={`/manufacturing/work-orders/${r.id}`} className="font-medium hover:underline">{r.number}</Link> · {r.item}</td><td className="py-2">{qty(r.produced)} {r.unit}</td><td className="py-2">{inr(r.unitCost)}</td><td className={cx("py-2", r.materialValue > 0 ? "text-danger" : r.materialValue < 0 && "text-success")}>{r.materialValue ? inr(r.materialValue) : "—"}</td><td className={cx("py-2", r.minutes > 0 && "text-danger")}>{r.minutes ? `${r.minutes > 0 ? "+" : ""}${r.minutes} min` : "—"}</td><td className="py-2">{r.yieldPct}%</td></tr>)}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

type Wo = { id: string; number: string; itemId: string; item: string; unit: string; qty: number; status: string; plannedStart: string | null; plannedEnd: string | null; produced: number; unitCost: number };

function WorkOrdersView() {
  const { meta, go } = useMfg();
  const [tab, setTab] = useState<"open" | "done" | "">("open");
  const q = useModuleQuery<{ orders: Wo[] }>(`work-orders${tab ? `?status=${tab}` : ""}`, { keepPrevious: true });
  const [adding, setAdding] = useState(false);
  const rows = q.data?.orders;
  return (
    <div>
      <PageHeader title="Work orders" description="Make something from its recipe: release it, issue materials, log time, record what was made." actions={<div className="flex gap-2"><ExportMenu name="work-orders" rows={rows} columns={[{ key: "number", label: "Number" }, { key: "item", label: "Item" }, { key: "qty", label: "Planned" }, { key: "produced", label: "Made" }, { key: "unitCost", label: "Unit cost", money: true }, { key: "plannedStart", label: "Start" }, { key: "plannedEnd", label: "Due" }, { key: "status", label: "Status" }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Work order</Button>}</div>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "", label: "All" }]} />
      {!rows ? <Skeleton className="h-60 rounded-[20px]" /> : !rows.length ? <EmptyState icon={<Factory />} title="No work orders here" description="Add a recipe for what you make, then start a work order — or let MRP suggest them from your sales orders." /> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <tbody className="divide-y divide-border">
              {rows.map((w) => (
                <tr key={w.id} onClick={() => go(`work-orders/${w.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5"><b className="font-medium">{w.number}</b><span className="block text-[12px] text-muted">{fmt(w.plannedStart)} – {fmt(w.plannedEnd)}</span></td>
                  <td className="px-4 py-2.5">{w.item}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{w.status === "done" ? `${qty(w.produced)} of ${qty(w.qty)}` : qty(w.qty)} {w.unit}</td>
                  <td className="px-4 py-2.5"><Pill s={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <NewWoDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewWoDialog({ onClose }: { onClose: () => void }) {
  const { meta, go } = useMfg();
  const boms = useModuleQuery<{ boms: { id: string; itemId: string; item: string; name: string; isDefault: boolean; active: boolean }[] }>("boms");
  const makes = (boms.data?.boms ?? []).filter((b) => b.active);
  const [f, setF] = useState({ bomId: "", qty: "1", plannedStart: today(), plannedEnd: "", warehouseId: meta.settings.defaultWarehouseId ?? "" });
  const bom = makes.find((b) => b.id === f.bomId);
  const save = useModuleAction<void, { order: { id: string } }>(() => ({ path: "work-orders", body: { itemId: bom?.itemId, bomId: f.bomId, qty: Number(f.qty), plannedStart: f.plannedStart || null, plannedEnd: f.plannedEnd || null, warehouseId: f.warehouseId || null } }), { success: "Work order drafted", onDone: (r) => (onClose(), go(`work-orders/${r.order.id}`)) });
  return (
    <Dialog open onClose={onClose} title="New work order" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!bom || !(Number(f.qty) > 0)} onClick={() => save.mutate()}>Draft it</Button></>}>
      {boms.data && !makes.length ? <Empty>Add a recipe first — it says what goes into the item.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Make" className="sm:col-span-2">{(a) => <Select {...a} value={f.bomId} onChange={(e) => setF({ ...f, bomId: e.target.value })}><option value="">Choose…</option>{makes.map((b) => <option key={b.id} value={b.id}>{b.item}{b.name !== "Standard" ? ` · ${b.name}` : ""}</option>)}</Select>}</Field>
          <Field label="Quantity">{(a) => <Input {...a} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
          {meta.warehouses.length > 1 && <Field label="At">{(a) => <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Default location</option>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>}
          <Field label="Start">{(a) => <Input {...a} type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} />}</Field>
          <Field label="Due">{(a) => <Input {...a} type="date" value={f.plannedEnd} min={f.plannedStart} onChange={(e) => setF({ ...f, plannedEnd: e.target.value })} />}</Field>
        </div>
      )}
    </Dialog>
  );
}

type WoDetail = {
  order: Wo & { warehouseId: string; materials: { itemId: string; required: number; issued: number }[]; operations: { id: string; workCentreId: string; name: string; plannedMinutes: number; actualMinutes: number; done: boolean }[]; materialCost: number; conversionCost: number; scrap: number; notes: string };
  items: { id: string; name: string; unit: string; avgCost: number; trackBatches: boolean }[];
  centres: { id: string; code: string; name: string; costPerHour: number }[];
  onHand: Record<string, number>;
  variances: { materials: { itemId: string; standard: number; actual: number; qty: number; value: number }[]; materialValue: number; minutes: number; yieldPct: number } | null;
};

function WorkOrderPage({ id }: { id: string }) {
  const { meta } = useMfg();
  const q = useModuleQuery<WoDetail>(`work-orders/${id}`);
  const [finishing, setFinishing] = useState(false);
  const [issue, setIssue] = useState<Record<string, string>>({});
  const [mins, setMins] = useState<Record<string, string>>({});
  const release = useModuleAction(() => ({ path: `work-orders/${id}/release` }), { success: "Released — materials are reserved", also: ["inv"] });
  const doIssue = useModuleAction<{ itemId: string; qty: number }[]>((lines) => ({ path: `work-orders/${id}/issue`, body: { lines } }), { success: "Done — stock updated", onDone: () => setIssue({}), also: ["inv"] });
  const time = useModuleAction<{ operationId: string; minutes: number; done: boolean }>((b) => ({ path: `work-orders/${id}/time`, body: b }), { success: "Time saved" });
  const cancel = useModuleAction(() => ({ path: `work-orders/${id}/cancel` }), { success: "Cancelled" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { order: w, items, centres, onHand, variances: v } = q.data;
  const name = (iid: string) => items.find((i) => i.id === iid)?.name ?? "Item";
  const unit = (iid: string) => items.find((i) => i.id === iid)?.unit ?? "";
  const running = ["released", "in_progress"].includes(w.status);
  const remaining = w.materials.filter((m) => m.required - m.issued > 0.0005).map((m) => ({ itemId: m.itemId, qty: Math.round((m.required - m.issued) * 1000) / 1000 }));
  return (
    <div>
      <Link href="/manufacturing/work-orders" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Work orders</Link>
      <PageHeader title={`${w.number} · ${qty(w.qty)} ${w.item}`} description={`${fmt(w.plannedStart)} – ${fmt(w.plannedEnd)}${w.status === "done" ? ` · made ${qty(w.produced)}${w.scrap ? `, ${qty(w.scrap)} scrapped` : ""} at ${inr(w.unitCost)} each` : ""}`} actions={<div className="flex flex-wrap items-center gap-2"><Pill s={w.status} />{meta.me.write && w.status === "draft" && <Button size="sm" variant="primary" loading={release.isPending} onClick={() => release.mutate(undefined)}>Release</Button>}{meta.me.write && running && remaining.length > 0 && <Button size="sm" variant="primary" loading={doIssue.isPending} onClick={() => doIssue.mutate(remaining)}>Issue all materials</Button>}{meta.me.write && w.status === "in_progress" && <Button size="sm" variant="primary" onClick={() => setFinishing(true)}>Finish</Button>}{meta.me.write && !["done", "cancelled"].includes(w.status) && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(undefined)}>Cancel</Button>}</div>} />
      {v && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Unit cost" value={inr(w.unitCost)} sub={`${inr(w.materialCost)} materials + ${inr(w.conversionCost)} time`} />
          <Stat label="Yield" value={`${v.yieldPct}%`} sub={`${qty(w.produced)} of ${qty(w.qty)}`} />
          <Stat label="Material variance" value={inr(v.materialValue)} tone={v.materialValue > 0 ? "warn" : undefined} sub="against the recipe for what was made" />
          <Stat label="Time variance" value={`${v.minutes > 0 ? "+" : ""}${v.minutes} min`} tone={v.minutes > 0 ? "warn" : undefined} />
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Materials">
          <table className="w-full text-[13px]">
            <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Item</th><th className="py-1.5 font-medium">Needed</th><th className="py-1.5 font-medium">Issued</th>{running && <th className="py-1.5 font-medium">In stock</th>}{running && meta.me.write && <th className="w-28 py-1.5 font-medium">Issue / return</th>}</tr></thead>
            <tbody className="divide-y divide-border text-right tabular-nums">
              {w.materials.map((m) => (
                <tr key={m.itemId}>
                  <td className="py-2 text-left">{name(m.itemId)}{v && <span className="block text-[12px] text-muted">{(() => { const x = v.materials.find((y) => y.itemId === m.itemId); return x && x.qty ? `${x.qty > 0 ? "+" : ""}${qty(x.qty)} against ${qty(x.standard)}` : "as planned"; })()}</span>}</td>
                  <td className="py-2">{qty(m.required)} {unit(m.itemId)}</td>
                  <td className={cx("py-2", m.issued + 0.0005 < m.required && running && "text-warning")}>{qty(m.issued)}</td>
                  {running && <td className={cx("py-2", (onHand[m.itemId] ?? 0) < m.required - m.issued && "text-danger")}>{qty(onHand[m.itemId] ?? 0)}</td>}
                  {running && meta.me.write && <td className="py-2 pl-2"><span className="flex gap-1"><Input aria-label={`Issue ${name(m.itemId)}`} inputMode="decimal" value={issue[m.itemId] ?? ""} onChange={(e) => setIssue({ ...issue, [m.itemId]: e.target.value })} placeholder="±" /><Button size="sm" disabled={!Number(issue[m.itemId])} onClick={() => doIssue.mutate([{ itemId: m.itemId, qty: Number(issue[m.itemId]) }])}>Go</Button></span></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {running && <p className="mt-2 text-[12px] text-muted">A negative quantity returns unused material to stock.</p>}
        </Section>
        {w.operations.length > 0 && (
          <Section title="Operations">
            <ul className="divide-y divide-border text-[13px]">
              {w.operations.map((o) => {
                const c = centres.find((x) => x.id === o.workCentreId);
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span><b className="font-medium">{o.name}</b> <span className="text-muted">· {c?.code ?? "—"} · planned {o.plannedMinutes} min</span>{o.done && <span className="ml-2 text-[11.5px] font-semibold text-success">Done</span>}</span>
                    {running && meta.me.write ? (
                      <span className="flex items-center gap-1.5"><Input aria-label={`Minutes on ${o.name}`} className="!w-20" inputMode="numeric" value={mins[o.id] ?? (o.actualMinutes ? String(o.actualMinutes) : "")} onChange={(e) => setMins({ ...mins, [o.id]: e.target.value })} placeholder="min" /><Button size="sm" onClick={() => time.mutate({ operationId: o.id, minutes: Number(mins[o.id] ?? o.actualMinutes) || 0, done: true })}>Done</Button></span>
                    ) : <span className="tabular-nums">{o.actualMinutes || "—"} min</span>}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
      {finishing && <FinishDialog wo={w} batch={items.find((i) => i.id === w.itemId)?.trackBatches ?? false} onClose={() => setFinishing(false)} />}
    </div>
  );
}

function FinishDialog({ wo, batch, onClose }: { wo: WoDetail["order"]; batch: boolean; onClose: () => void }) {
  const [f, setF] = useState({ produced: String(wo.qty), scrap: "", batch: "", expiry: "" });
  const save = useModuleAction(() => ({ path: `work-orders/${wo.id}/complete`, body: { produced: Number(f.produced), scrap: Number(f.scrap) || 0, batch: f.batch, expiry: f.expiry || null } }), { success: "Finished — output is in stock", onDone: onClose, also: ["inv", "acc"] });
  return (
    <Dialog open onClose={onClose} title={`Finish ${wo.number}`} description="What was made goes into stock at materials plus time, divided over what was made." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!(Number(f.produced) > 0) || (batch && !f.batch)} onClick={() => save.mutate(undefined)}>Finish</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Made">{(a) => <Input {...a} inputMode="decimal" value={f.produced} onChange={(e) => setF({ ...f, produced: e.target.value })} />}</Field>
        <Field label="Scrapped">{(a) => <Input {...a} inputMode="decimal" value={f.scrap} onChange={(e) => setF({ ...f, scrap: e.target.value })} placeholder="0" />}</Field>
        {batch && <><Field label="Batch">{(a) => <Input {...a} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} />}</Field><Field label="Expiry">{(a) => <Input {...a} type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />}</Field></>}
      </div>
    </Dialog>
  );
}

function BomsView() {
  const { meta, orgId, go } = useMfg();
  const qc = useQueryClient();
  const q = useModuleQuery<{ boms: { id: string; itemId: string; item: string; unit: string; name: string; outputQty: number; lines: unknown[]; operations: unknown[]; isDefault: boolean; active: boolean }[] }>("boms");
  return (
    <div>
      <PageHeader title="Recipes" description="What goes into each item you make (bill of materials) and the steps on work centres (routing)." actions={meta.me.manage && <div className="flex gap-2"><ImportButton target={target("manufacturing.boms")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/manufacturing/boms/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["manufacturing", orgId] })} /><Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("boms/new")}>Recipe</Button></div>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.boms.length ? <EmptyState title="No recipes yet" description="Add one for each item you make, or import them from a spreadsheet (one row per component)." /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.boms.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => go(`boms/${b.id}`)} className={cx("w-full rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2", !b.active && "opacity-60")}>
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{b.item}</b><span className="text-[11.5px] text-muted">{b.name}{b.isDefault ? " · default" : ""}</span></span>
                <span className="mt-1 block text-[12.5px] text-muted">Makes {qty(b.outputQty)} {b.unit} · {b.lines.length} component{b.lines.length === 1 ? "" : "s"} · {b.operations.length} step{b.operations.length === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

let seq = 0;
const nid = () => `op${Date.now().toString(36)}${(seq++).toString(36)}`;

function BomEditor({ id }: { id?: string }) {
  const { meta, go } = useMfg();
  const q = useModuleQuery<{ bom: { itemId: string; name: string; outputQty: number; lines: { itemId: string; qty: number; scrapPct: number }[]; operations: { id: string; workCentreId: string; name: string; minutes: number; setupMinutes: number }[]; isDefault: boolean; active: boolean; notes: string }; standard: { material: number; conversion: number; perUnit: number } }>(id ? `boms/${id}` : null);
  if (id && !q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  return <BomForm key={id ?? "new"} id={id} init={q.data?.bom} standard={q.data?.standard} onDone={() => go("boms")} meta={meta} />;
}

function BomForm({ id, init, standard, onDone, meta }: { id?: string; init?: { itemId: string; name: string; outputQty: number; lines: { itemId: string; qty: number; scrapPct: number }[]; operations: { id: string; workCentreId: string; name: string; minutes: number; setupMinutes: number }[]; isDefault: boolean; active: boolean; notes: string }; standard?: { material: number; conversion: number; perUnit: number }; onDone: () => void; meta: Meta }) {
  const [f, setF] = useState({ itemId: init?.itemId ?? "", name: init?.name ?? "Standard", outputQty: String(init?.outputQty ?? 1), isDefault: init?.isDefault ?? true, active: init?.active ?? true, notes: init?.notes ?? "", lines: (init?.lines ?? []).map((l) => ({ itemId: l.itemId, qty: String(l.qty), scrapPct: l.scrapPct ? String(l.scrapPct) : "" })), operations: (init?.operations ?? []).map((o) => ({ ...o, minutes: String(o.minutes), setupMinutes: o.setupMinutes ? String(o.setupMinutes) : "" })) });
  const save = useModuleAction(() => ({ path: id ? `boms/${id}` : "boms", method: id ? "PUT" : "POST", body: { itemId: f.itemId, name: f.name, outputQty: Number(f.outputQty) || 1, isDefault: f.isDefault, active: f.active, notes: f.notes, lines: f.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), scrapPct: Number(l.scrapPct) || 0 })), operations: f.operations.filter((o) => o.workCentreId && o.name.trim()).map((o) => ({ id: o.id, workCentreId: o.workCentreId, name: o.name.trim(), minutes: Number(o.minutes) || 0, setupMinutes: Number(o.setupMinutes) || 0 })) } }), { success: "Recipe saved", onDone });
  const del = useModuleAction(() => ({ path: `boms/${id}`, method: "DELETE" }), { success: "Recipe deleted", onDone });
  const name = (iid: string) => meta.items.find((i) => i.id === iid)?.name ?? "";
  return (
    <div>
      <Link href="/manufacturing/boms" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Recipes</Link>
      <PageHeader title={id ? `${name(f.itemId)} · ${f.name}` : "New recipe"} description={standard ? `Standard cost ${inr(standard.perUnit)} each — ${inr(standard.material)} materials + ${inr(standard.conversion)} time per run` : "Components per run, and the steps."} actions={meta.me.manage && <div className="flex gap-2">{id && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => del.mutate(undefined)}>Delete</Button>}<Button size="sm" variant="primary" loading={save.isPending} disabled={!f.itemId || !f.lines.some((l) => l.itemId && Number(l.qty) > 0)} onClick={() => save.mutate(undefined)}>Save</Button></div>} />
      <div className="grid gap-5">
        <Section title="Makes">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Item">{(a) => <Select {...a} value={f.itemId} disabled={!!id} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{meta.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field>
            <Field label="One run makes">{(a) => <Input {...a} inputMode="decimal" value={f.outputQty} onChange={(e) => setF({ ...f, outputQty: e.target.value })} />}</Field>
            <Field label="Recipe name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />}</Field>
          </div>
          <div className="mt-3 flex gap-5 text-[13px]"><label className="flex items-center gap-2"><Switch checked={f.isDefault} onChange={(v) => setF({ ...f, isDefault: v })} label="Default recipe" /> Default for this item</label><label className="flex items-center gap-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" /> In use</label></div>
        </Section>
        <Section title="Components">
          {f.lines.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[minmax(0,1fr)_110px_90px_32px] items-center gap-2">
              <Select aria-label={`Component ${i + 1}`} value={l.itemId} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)) })}><option value="">Choose…</option>{meta.items.filter((it) => it.id !== f.itemId).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</Select>
              <Input aria-label={`Quantity of component ${i + 1}`} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
              <Input aria-label={`Scrap % of component ${i + 1}`} inputMode="decimal" placeholder="Scrap %" value={l.scrapPct} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, scrapPct: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" aria-label="Remove component" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button type="button" className="text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, lines: [...f.lines, { itemId: "", qty: "1", scrapPct: "" }] })}>+ Add a component</button>
        </Section>
        {meta.parts.routing && (
          <Section title="Steps">
            {!meta.centres.length ? <p className="text-[13px] text-muted">Add work centres to plan the steps and cost the time.</p> : (
              <>
                {f.operations.map((o, i) => (
                  <div key={o.id} className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_100px_32px] items-center gap-2">
                    <Input aria-label={`Step ${i + 1}`} placeholder="Step" value={o.name} onChange={(e) => setF({ ...f, operations: f.operations.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Select aria-label={`Work centre for step ${i + 1}`} value={o.workCentreId} onChange={(e) => setF({ ...f, operations: f.operations.map((x, j) => (j === i ? { ...x, workCentreId: e.target.value } : x)) })}><option value="">Work centre…</option>{meta.centres.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
                    <Input aria-label={`Minutes per run for step ${i + 1}`} inputMode="decimal" placeholder="Min/run" value={o.minutes} onChange={(e) => setF({ ...f, operations: f.operations.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)) })} />
                    <Input aria-label={`Setup minutes for step ${i + 1}`} inputMode="decimal" placeholder="Setup" value={o.setupMinutes} onChange={(e) => setF({ ...f, operations: f.operations.map((x, j) => (j === i ? { ...x, setupMinutes: e.target.value } : x)) })} />
                    <Button size="sm" variant="ghost" aria-label="Remove step" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, operations: f.operations.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <button type="button" className="text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, operations: [...f.operations, { id: nid(), workCentreId: meta.centres[0]?.id ?? "", name: "", minutes: "", setupMinutes: "" }] })}>+ Add a step</button>
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function CentresView() {
  const { meta } = useMfg();
  const cap = useModuleQuery<{ days: number; centres: { id: string; code: string; name: string; minutes: number; capacity: number; pct: number; costPerHour: number; hoursPerDay: number }[] }>("capacity?days=14");
  const [editing, setEditing] = useState<Meta["centres"][number] | null | undefined>(undefined);
  return (
    <div>
      <PageHeader title="Work centres" description="Machines, lines or teams where steps happen: their cost per hour (machine and labour) and hours a day. Load is open work for the next 14 days." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing(null)}>Work centre</Button>} />
      {!meta.centres.length ? <EmptyState icon={<Cog />} title="No work centres" description="Add the places work happens to plan steps in recipes and cost the time." /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {meta.centres.map((c) => {
            const l = cap.data?.centres.find((x) => x.id === c.id);
            return (
              <li key={c.id} className={cx("rounded-[18px] border border-border bg-surface p-4 shadow-sm", !c.active && "opacity-60")}>
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{c.code} · {c.name}</b>{meta.me.manage && <button type="button" className="text-[12px] underline" onClick={() => setEditing(c)}>Edit</button>}</span>
                <span className="block text-[12.5px] text-muted">{inr(c.costPerHour)}/hour · {c.hoursPerDay} h/day</span>
                {l && <><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={cx("block h-full rounded-full", l.pct > 100 ? "bg-danger" : l.pct > 80 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, l.pct)}%` }} /></span><span className="mt-1 block text-[12px] text-muted">{Math.round(l.minutes / 60)} h booked of {Math.round(l.capacity / 60)} h · {l.pct}%</span></>}
              </li>
            );
          })}
        </ul>
      )}
      {editing !== undefined && <CentreDialog init={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function CentreDialog({ init, onClose }: { init: Meta["centres"][number] | null; onClose: () => void }) {
  const [f, setF] = useState({ code: init?.code ?? "", name: init?.name ?? "", costPerHour: init ? String(init.costPerHour / 100) : "", hoursPerDay: String(init?.hoursPerDay ?? 8), active: init?.active ?? true });
  const save = useModuleAction(() => ({ path: init ? `work-centres/${init.id}` : "work-centres", method: init ? "PUT" : "POST", body: { ...f, costPerHour: Math.round((Number(f.costPerHour) || 0) * 100), hoursPerDay: Number(f.hoursPerDay) || 8 } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={init ? `Edit ${init.code}` : "New work centre"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} placeholder="SAW" />}</Field>
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Panel saw" />}</Field>
        <Field label="Cost per hour (₹)" hint="Machine and labour together">{(a) => <Input {...a} inputMode="decimal" value={f.costPerHour} onChange={(e) => setF({ ...f, costPerHour: e.target.value })} />}</Field>
        <Field label="Hours a day">{(a) => <Input {...a} inputMode="decimal" value={f.hoursPerDay} onChange={(e) => setF({ ...f, hoursPerDay: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

type Mrp = { horizon: string; make: { itemId: string; name: string; unit: string; demand: number; available: number; incoming: number; safety: number; net: number }[]; buy: { itemId: string; name: string; unit: string; demand: number; available: number; incoming: number; safety: number; net: number }[]; cyclic: boolean };

function MrpView() {
  const { meta, go } = useMfg();
  const q = useModuleQuery<Mrp>("mrp");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const make = useModuleAction<{ itemId: string; qty: number }[], { workOrderIds: string[] }>((lines) => ({ path: "mrp/make", body: { lines } }), { success: (r) => `${r.workOrderIds.length} draft work order${r.workOrderIds.length === 1 ? "" : "s"} made`, onDone: () => go("work-orders") });
  const buy = useModuleAction<{ itemId: string; qty: number }[], { number?: string; poIds?: string[]; noSupplier?: string[] }>((lines) => ({ path: "mrp/buy", body: { lines } }), { success: (r) => (r.number ? `Requisition ${r.number} made` : `${r.poIds?.length ?? 0} draft purchase order(s) made${r.noSupplier?.length ? ` — no usual supplier for ${r.noSupplier.join(", ")}` : ""}`), also: ["inv"] });
  const d = q.data;
  const table = (rows: Mrp["make"], kind: "make" | "buy") => (
    <table className="w-full text-[13px]">
      <thead className="text-right text-[12px] text-muted"><tr><th className="w-8" /><th className="py-1.5 text-left font-medium">Item</th><th className="py-1.5 font-medium">Needed</th><th className="py-1.5 font-medium">Free</th><th className="py-1.5 font-medium">Coming</th><th className="py-1.5 font-medium">{kind === "make" ? "Make" : "Buy"}</th></tr></thead>
      <tbody className="divide-y divide-border text-right tabular-nums">
        {rows.map((r) => <tr key={r.itemId}><td><input type="checkbox" aria-label={`${kind === "make" ? "Make" : "Buy"} ${r.name}`} checked={!skip.has(`${kind}${r.itemId}`)} onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(`${kind}${r.itemId}`); else n.add(`${kind}${r.itemId}`); setSkip(n); }} className="size-4" /></td><td className="py-2 text-left">{r.name}</td><td className="py-2">{qty(r.demand + r.safety)}</td><td className="py-2">{qty(r.available)}</td><td className="py-2">{qty(r.incoming)}</td><td className="py-2 font-semibold">{qty(r.net)} {r.unit}</td></tr>)}
      </tbody>
    </table>
  );
  return (
    <div>
      <PageHeader title="MRP" description={`From sales orders due by ${d ? fmt(d.horizon) : "…"}, open work orders' materials and safety stock — against stock that's free and what's on order or being made.`} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          {d.cyclic && <Notice tone="warning" title="A recipe loop">Some recipes use each other in a loop; those items were left out.</Notice>}
          <Section title="To make" action={meta.me.write && d.make.length > 0 && <Button size="sm" variant="primary" loading={make.isPending} onClick={() => make.mutate(d.make.filter((r) => !skip.has(`make${r.itemId}`)).map((r) => ({ itemId: r.itemId, qty: r.net })))}>Draft work orders</Button>}>
            {!d.make.length ? <Empty>Nothing to make.</Empty> : table(d.make, "make")}
          </Section>
          <Section title="To buy" action={meta.me.write && d.buy.length > 0 && <Button size="sm" variant="primary" loading={buy.isPending} onClick={() => buy.mutate(d.buy.filter((r) => !skip.has(`buy${r.itemId}`)).map((r) => ({ itemId: r.itemId, qty: r.net })))}>Raise purchases</Button>}>
            {!d.buy.length ? <Empty>Nothing to buy.</Empty> : table(d.buy, "buy")}
          </Section>
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const { meta } = useMfg();
  const [f, setF] = useState({ ...meta.settings, horizonDays: String(meta.settings.horizonDays) });
  const save = useModuleAction(() => ({ path: "settings", method: "PUT", body: { ...f, horizonDays: Number(f.horizonDays) || 30, defaultWarehouseId: f.defaultWarehouseId || null } }), { success: "Settings saved" });
  return (
    <div className="max-w-2xl">
      <PageHeader title="Manufacturing settings" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>} />
      <Section title="Production">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Work order prefix">{(a) => <Input {...a} value={f.workOrderPrefix} onChange={(e) => setF({ ...f, workOrderPrefix: e.target.value })} maxLength={8} />}</Field>
          <Field label="MRP looks ahead (days)">{(a) => <Input {...a} inputMode="numeric" value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: e.target.value })} />}</Field>
          <Field label="Make at">{(a) => <Select {...a} value={f.defaultWarehouseId ?? ""} onChange={(e) => setF({ ...f, defaultWarehouseId: e.target.value || null })}><option value="">Default location</option>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
        </div>
      </Section>
    </div>
  );
}
