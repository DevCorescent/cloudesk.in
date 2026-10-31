"use client";

// Logistics & fleet: home (late shipments, papers and licences expiring,
// trips), shipments (made from Sales challans, moved along, delivered with
// proof, freight paid), trips (stops, load, start and finish with the
// odometer and costs), the fleet (vehicles with papers, drivers), the fuel
// log, carriers and rate cards, reports and settings.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Building2, Copy, Fuel, Home, Package, Plus, Route as RouteIcon, Settings, Trash2, Truck, Users, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Section, Stat } from "@/components/crm/shared";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { DOC_KINDS, DOC_LABEL, EXPENSE_KINDS, EXPENSE_LABEL, FUELS, OPEN_SHIP, SHIP_STATUS_LABEL, VEHICLE_TYPES, VEHICLE_TYPE_LABEL, type LgxSettings } from "@/lib/logistics/model";
import { formatPrice } from "@/lib/store/money";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: LgxSettings; warehouses: { id: string; name: string; state: string }[]; links: Record<string, boolean> };
type Rate = { id: string; carrierId: string; fromState: string; toState: string; perKg: number; minCharge: number; fixed: number; volumetricDivisor: number };
type Carrier = { id: string; name: string; kind: "transporter" | "courier"; trackingUrl: string; active: boolean; rates: Rate[] };
type Event = { at: string; status: string; note: string; by: string | null };
type Shipment = { id: string; number: string; mode: "own" | "carrier"; carrierId: string | null; carrier?: string | null; carrierLink?: string; trackingNo: string; lrNo: string; ewayBillNo: string; deliveryIds: string[]; consignee: string; phone: string; address: string; state: string; warehouseId: string | null; weightKg: number; packages: number; freightCost: number; freightBilled: number; freightPaidFromId: string | null; status: string; promisedOn: string | null; deliveredAt: string | null; podName: string; events: Event[]; trackToken: string; tripId: string | null; stopOrder: number; late?: boolean; createdAt: string };
type Doc = { kind: (typeof DOC_KINDS)[number]; number: string; expiresOn: string | null };
type Vehicle = { id: string; regNo: string; name: string; type: (typeof VEHICLE_TYPES)[number]; ownership: string; capacityKg: number; fuel: string; driverId: string | null; driver?: string | null; assetId: string | null; odometer: number | null; odometerAt: string | null; docs: Doc[]; active: boolean; notes: string; alerts?: (Doc & { expired: boolean })[]; mileage?: { km: number; litres: number; kmPerLitre: number | null; costPerKm: number | null } };
type Driver = { id: string; name: string; phone: string; employeeId: string | null; licenceNo: string; licenceExpires: string | null; active: boolean; licenceAlert?: string | null };

const useLgx = () => useModule<Meta>();
const inr = (n: number) => formatPrice(n, "INR");
const fmt = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
const rs = (p: number) => (p ? String(p / 100) : "");
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { planned: "bg-surface-2 text-muted", picked: "bg-accent-soft text-accent", in_transit: "bg-accent-soft text-accent", out_for_delivery: "bg-warning-soft text-warning", delivered: "bg-success-soft text-success", exception: "bg-danger-soft text-danger", returned: "bg-surface-2 text-muted", cancelled: "bg-surface-2 text-muted", started: "bg-accent-soft text-accent", completed: "bg-success-soft text-success" };
const LABEL: Record<string, string> = { ...SHIP_STATUS_LABEL, started: "On the road", completed: "Completed" };
const Pill = ({ s }: { s: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[s] ?? "bg-surface-2 text-muted")}>{LABEL[s] ?? s}</span>;

export function LogisticsApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="logistics"
      base="logistics"
      title="Logistics"
      icon={<Truck />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "shipments", label: "Shipments", icon: <Package />, group: "Dispatch" },
        { id: "trips", label: "Trips", icon: <RouteIcon /> },
        { id: "vehicles", label: "Vehicles", icon: <Truck />, group: "Fleet" },
        { id: "drivers", label: "Drivers", icon: <Users /> },
        { id: "fuel", label: "Fuel log", icon: <Fuel /> },
        { id: "carriers", label: "Carriers & rates", icon: <Building2 />, group: "Setup" },
        { id: "reports", label: "Reports", icon: <BarChart3 /> },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        switch (section) {
          case "shipments":
            return isId(id) ? <ShipmentPage key={id} id={id!} /> : <ShipmentsView />;
          case "trips":
            return isId(id) ? <TripPage key={id} id={id!} /> : <TripsView />;
          case "vehicles":
            return isId(id) ? <VehiclePage key={id} id={id!} /> : <VehiclesView />;
          case "drivers":
            return <DriversView />;
          case "fuel":
            return <FuelView />;
          case "carriers":
            return <CarriersView />;
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

function HomeView() {
  const { go } = useLgx();
  const q = useModuleQuery<{ counts: { open: number; late: number; byStatus: Record<string, number>; tripsToday: number; onTheRoad: number }; late: Shipment[]; papers: { vehicleId: string; regNo: string; kind: string; expiresOn: string; expired: boolean }[]; licences: Driver[]; waiting: number }>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Logistics" description="What's on the move, what's late, and the papers that need renewing." actions={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => go("shipments")}>Shipment</Button>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="On the move" value={d.counts.open} sub={`${d.counts.byStatus.in_transit ?? 0} in transit · ${d.counts.byStatus.out_for_delivery ?? 0} out for delivery`} />
            <Stat label="Late" value={d.counts.late} tone={d.counts.late ? "warn" : undefined} />
            <Stat label="Trips today" value={d.counts.tripsToday} sub={`${d.counts.onTheRoad} on the road`} />
            <Stat label="Waiting for a trip" value={d.waiting} sub="own-fleet shipments" />
          </div>
          {(d.papers.length > 0 || d.licences.length > 0) && (
            <Section title="Papers to renew">
              <ul className="divide-y divide-border text-[13px]">
                {d.papers.map((p) => <li key={p.vehicleId + p.kind} className="flex justify-between gap-3 py-2"><Link href={`/logistics/vehicles/${p.vehicleId}`} className="hover:underline">{p.regNo} · {DOC_LABEL[p.kind as (typeof DOC_KINDS)[number]] ?? p.kind}</Link><span className={cx(p.expired ? "font-semibold text-danger" : "text-warning")}>{p.expired ? "expired" : "expires"} {fmt(p.expiresOn)}</span></li>)}
                {d.licences.map((x) => <li key={x.id} className="flex justify-between gap-3 py-2"><span>{x.name} · driving licence</span><span className={cx(x.licenceAlert === "expired" ? "font-semibold text-danger" : "text-warning")}>{x.licenceAlert === "expired" ? "expired" : "expires"} {fmt(x.licenceExpires)}</span></li>)}
              </ul>
            </Section>
          )}
          <Section title="Late">{!d.late.length ? <Empty>Nothing late.</Empty> : <ShipmentList rows={d.late} compact />}</Section>
        </div>
      )}
    </div>
  );
}

// ── Shipments ───────────────────────────────────────────────────────────────

function ShipmentList({ rows, compact }: { rows: Shipment[]; compact?: boolean }) {
  return (
    <ul className={cx("divide-y divide-border text-[13px]", !compact && "rounded-[20px] border border-border bg-surface px-4 shadow-sm")}>
      {rows.map((x) => (
        <li key={x.id}>
          <Link href={`/logistics/shipments/${x.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:opacity-80">
            <span className="min-w-0 flex-1"><b className="block truncate font-semibold">{x.consignee}</b><span className="text-[12px] text-muted">{x.number} · {x.mode === "own" ? "Own fleet" : x.carrier ?? "Carrier"}{x.lrNo ? ` · LR ${x.lrNo}` : x.trackingNo ? ` · ${x.trackingNo}` : ""}{x.state ? ` · ${x.state}` : ""}</span></span>
            {x.promisedOn && <span className={cx("text-[12px]", x.late ? "font-semibold text-danger" : "text-muted")}>due {fmt(x.promisedOn)}</span>}
            <Pill s={x.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ShipmentsView() {
  const { meta, go } = useLgx();
  const params = useSearchParams();
  const preset = (params.get("challans") ?? "").split(",").filter(isId);
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(preset.length > 0);
  const q = useModuleQuery<{ shipments: Shipment[] }>(`shipments?${new URLSearchParams({ status, ...(search ? { q: search } : {}) })}`, { keepPrevious: true });
  const rows = q.data?.shipments ?? [];
  return (
    <div>
      <PageHeader
        title="Shipments"
        description="Consignments going out by transporter, courier or your own vehicles."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="shipments" columns={[{ key: "number", label: "Shipment" }, { key: "consignee", label: "Consignee" }, { key: "state", label: "State" }, { key: "via", label: "Via" }, { key: "lrNo", label: "LR" }, { key: "trackingNo", label: "Tracking" }, { key: "weightKg", label: "Weight (kg)" }, { key: "packages", label: "Packages" }, { key: "freightCost", label: "Freight", money: true }, { key: "freightBilled", label: "Freight billed", money: true }, { key: "promisedOn", label: "Promised" }, { key: "status", label: "Status" }, { key: "podName", label: "Received by" }]} rows={rows.map((x) => ({ ...x, via: x.mode === "own" ? "Own fleet" : x.carrier ?? "", status: LABEL[x.status] }))} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Shipment</Button>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search shipments" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, consignee, LR or tracking number" className="h-9 max-w-xs" />
        <Tabs value={status} onChange={setStatus} tabs={[{ value: "open", label: "On the move" }, { value: "delivered", label: "Delivered" }, { value: "all", label: "All" }]} />
      </div>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No shipments here.</Empty> : <ShipmentList rows={rows} />}
      {adding && <ShipmentDialog preset={preset} onClose={() => setAdding(false)} onSaved={(id) => go(`shipments/${id}`)} />}
    </div>
  );
}

function ShipmentDialog({ preset, onClose, onSaved }: { preset: string[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { meta, orgId } = useLgx();
  const toast = useToast();
  const carriersQ = useModuleQuery<{ carriers: Carrier[] }>("carriers");
  const challans = useModuleQuery<{ challans: { id: string; number: string; date: string; orderNo: string; customer: string }[] }>(meta.links.sales ? "challans" : null);
  const [picked, setPicked] = useState<string[]>(preset);
  const [f, setF] = useState({ mode: "carrier" as "carrier" | "own", carrierId: "", consignee: "", phone: "", address: "", state: "", warehouseId: meta.warehouses[0]?.id ?? "", weightKg: "", packages: "1", lrNo: "", trackingNo: "", ewayBillNo: "", freight: "", freightBilled: "", promisedOn: "" });
  const [est, setEst] = useState<number | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const carrierId = f.carrierId || carriersQ.data?.carriers.find((c) => c.active)?.id || "";
  const fill = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const r = await api<{ consignee: string; phone: string; address: string; state: string; warehouseId: string; mixed: boolean }>(`/api/v1/orgs/${orgId}/logistics/shipments/from?deliveries=${ids.join(",")}`);
      setF((x) => ({ ...x, consignee: r.consignee, phone: r.phone, address: r.address, state: r.state, warehouseId: r.warehouseId || x.warehouseId }));
      if (r.mixed) toast({ tone: "error", title: "Those challans are for different customers" });
    } catch {
      /* the form stays editable */
    }
  };
  // Challans picked in Sales fill in the consignee once they've loaded.
  const pre = useQuery({ queryKey: ["logistics", orgId, `from:${preset.join(",")}`], queryFn: () => api<{ consignee: string; phone: string; address: string; state: string; warehouseId: string }>(`/api/v1/orgs/${orgId}/logistics/shipments/from?deliveries=${preset.join(",")}`), enabled: preset.length > 0, retry: false });
  const [applied, setApplied] = useState<unknown>(null);
  if (pre.data && applied !== pre.data) {
    setApplied(pre.data);
    setF((x) => ({ ...x, consignee: pre.data.consignee, phone: pre.data.phone, address: pre.data.address, state: pre.data.state, warehouseId: pre.data.warehouseId || x.warehouseId }));
  }
  const estimate = async () => {
    if (!carrierId || !f.weightKg) return;
    const r = await api<{ estimate: { amount: number } | null }>(`/api/v1/orgs/${orgId}/logistics/estimate`, { method: "POST", body: { carrierId, warehouseId: f.warehouseId || null, state: f.state, weightKg: Number(f.weightKg) || 0, packages: Number(f.packages) || 1 } });
    setEst(r.estimate?.amount ?? null);
    if (r.estimate) setF((x) => ({ ...x, freight: String(r.estimate!.amount / 100) }));
    else toast({ tone: "error", title: "No rate for that lane on this carrier's card" });
  };
  const save = useModuleAction<void, { shipment: Shipment }>(() => ({ path: "shipments", body: { mode: f.mode, carrierId: f.mode === "carrier" ? carrierId || null : null, deliveryIds: picked, consignee: f.consignee, phone: f.phone, address: f.address, state: f.state, warehouseId: f.warehouseId || null, weightKg: Number(f.weightKg) || 0, packages: Number(f.packages) || 1, lrNo: f.lrNo, trackingNo: f.trackingNo, ewayBillNo: f.ewayBillNo, freightCost: f.freight === "" ? null : toPaise(f.freight), freightBilled: toPaise(f.freightBilled), promisedOn: f.promisedOn || null } }), { success: "Shipment made", onDone: (r) => (onClose(), onSaved(r.shipment.id)), also: ["sales"] });
  return (
    <Dialog open onClose={onClose} size="lg" title="New shipment" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.consignee.trim() || (f.mode === "carrier" && !carrierId)} loading={save.isPending} onClick={() => save.mutate()}>Make shipment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {meta.links.sales && (
          <fieldset className="grid max-h-40 gap-1 overflow-y-auto rounded-[12px] border border-border p-2 sm:col-span-2">
            <legend className="px-1 text-[12.5px] font-medium">Challans to ship</legend>
            {!(challans.data?.challans ?? []).length && <p className="px-1 text-[12.5px] text-muted">No challans waiting. You can still ship without one.</p>}
            {(challans.data?.challans ?? []).map((c) => <label key={c.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => { const next = e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id); setPicked(next); if (e.target.checked && next.length === 1) void fill(next); }} className="accent-[var(--accent)]" />{c.number} · {c.customer} <span className="text-muted">({c.orderNo}, {fmt(c.date)})</span></label>)}
          </fieldset>
        )}
        <Field label="Going by">{(p) => <Select {...p} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as "carrier" | "own" })}><option value="carrier">A transporter or courier</option><option value="own">Our own vehicle</option></Select>}</Field>
        {f.mode === "carrier" && <Field label="Carrier">{(p) => <Select {...p} value={carrierId} onChange={set("carrierId")}>{!carriersQ.data?.carriers.length && <option value="">Add one in Carriers & rates</option>}{(carriersQ.data?.carriers ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
        <Field label="Consignee">{(p) => <Input {...p} value={f.consignee} onChange={set("consignee")} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={f.phone} onChange={set("phone")} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(p) => <Input {...p} value={f.address} onChange={set("address")} />}</Field>
        <Field label="State" hint="Name or code, e.g. KA">{(p) => <Input {...p} value={f.state} onChange={set("state")} />}</Field>
        {meta.warehouses.length > 0 && <Field label="From">{(p) => <Select {...p} value={f.warehouseId} onChange={set("warehouseId")}>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.state ? ` (${w.state})` : ""}</option>)}</Select>}</Field>}
        <Field label="Weight (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.weightKg} onChange={set("weightKg")} />}</Field>
        <Field label="Packages">{(p) => <Input {...p} inputMode="numeric" value={f.packages} onChange={set("packages")} />}</Field>
        {f.mode === "carrier" && <Field label="LR / docket number">{(p) => <Input {...p} value={f.lrNo} onChange={set("lrNo")} />}</Field>}
        {f.mode === "carrier" && <Field label="Tracking / AWB number">{(p) => <Input {...p} value={f.trackingNo} onChange={set("trackingNo")} />}</Field>}
        <Field label="E-way bill number">{(p) => <Input {...p} value={f.ewayBillNo} onChange={set("ewayBillNo")} />}</Field>
        <Field label="Promised by" hint={`Blank: in ${meta.settings.promiseDays} days`}>{(p) => <Input {...p} type="date" value={f.promisedOn} onChange={set("promisedOn")} />}</Field>
        {meta.me.write && f.mode === "carrier" && (
          <div className="grid gap-1">
            <Field label="Freight cost (₹)" hint={est !== null ? `Rate card: ${inr(est)}` : "Blank to use the rate card"}>{(p) => <Input {...p} inputMode="decimal" value={f.freight} onChange={set("freight")} />}</Field>
            <Button size="sm" variant="ghost" className="justify-self-start" disabled={!carrierId || !f.weightKg} onClick={() => void estimate()}>Estimate from the rate card</Button>
          </div>
        )}
        {meta.me.write && <Field label="Freight charged to the customer (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.freightBilled} onChange={set("freightBilled")} />}</Field>}
      </div>
    </Dialog>
  );
}

type ShipmentDetail = { shipment: Shipment; carrier: Carrier | null; carrierLink: string; challans: { id: string; number: string; status: string; orderId: string; lines: { name: string; qty: number }[] }[]; trip: { id: string; number: string; status: string } | null; trackUrl: string; people: { id: string; name: string }[] };

function ShipmentPage({ id }: { id: string }) {
  const { meta, go } = useLgx();
  const toast = useToast();
  const q = useModuleQuery<ShipmentDetail>(`shipments/${id}`);
  const [stepping, setStepping] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pod, setPod] = useState(false);
  const [paying, setPaying] = useState(false);
  const step = useModuleAction<void>(() => ({ path: `shipments/${id}/step`, body: { status: stepping, note } }), { success: "Updated", onDone: () => (setStepping(null), setNote("")) });
  const cancel = useModuleAction<void>(() => ({ path: `shipments/${id}/cancel` }), { success: "Cancelled" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { shipment: x } = q.data;
  const open = OPEN_SHIP.includes(x.status);
  const trackAbs = typeof window !== "undefined" ? `${window.location.origin}${q.data.trackUrl}` : q.data.trackUrl;
  const name = (uid: string | null) => q.data!.people.find((p) => p.id === uid)?.name ?? "";
  return (
    <div>
      <button type="button" onClick={() => go("shipments")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Shipments</button>
      <PageHeader
        title={`${x.number} · ${x.consignee}`}
        description={`${x.mode === "own" ? "Own fleet" : q.data.carrier?.name ?? "Carrier"}${x.lrNo ? ` · LR ${x.lrNo}` : ""}${x.trackingNo ? ` · ${x.trackingNo}` : ""}${x.ewayBillNo ? ` · e-way bill ${x.ewayBillNo}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={x.status} />
            {q.data.carrierLink && <a href={q.data.carrierLink} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-surface-2">Carrier tracking</a>}
            {meta.me.write && open && <Select aria-label="Move it along" value="" onChange={(e) => e.target.value && setStepping(e.target.value)} className="h-8 !w-44 text-[13px]"><option value="">Update status…</option>{["picked", "in_transit", "out_for_delivery", "exception", "returned"].map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</Select>}
            {meta.me.write && open && <Button size="sm" variant="primary" onClick={() => setPod(true)}>Delivered</Button>}
            {meta.me.manage && x.mode === "carrier" && x.freightCost > 0 && !x.freightPaidFromId && meta.links.accounting && <Button size="sm" onClick={() => setPaying(true)}>Pay freight</Button>}
            {meta.me.write && open && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Promised by" value={fmt(x.promisedOn)} sub={x.late ? "late" : undefined} tone={x.late ? "warn" : undefined} />
        <Stat label="Weight" value={`${x.weightKg} kg`} sub={`${x.packages} package${x.packages === 1 ? "" : "s"}`} />
        {meta.me.write && <Stat label="Freight" value={inr(x.freightCost)} sub={x.freightPaidFromId ? "paid" : x.freightBilled ? `charged ${inr(x.freightBilled)}` : undefined} />}
        <Stat label={x.status === "delivered" ? "Received by" : "Trip"} value={x.status === "delivered" ? x.podName : q.data.trip ? q.data.trip.number : "—"} sub={x.status === "delivered" ? when(x.deliveredAt) : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Trail">
          <ol className="grid gap-2 text-[13px]">
            {[...x.events].reverse().map((e, i) => <li key={i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"><span className="text-muted tabular-nums">{when(e.at)}</span><span><b className="font-medium">{LABEL[e.status] ?? e.status}</b>{e.note ? ` — ${e.note}` : ""}{e.by ? <span className="text-muted"> · {name(e.by)}</span> : null}</span></li>)}
          </ol>
        </Section>
        <div className="grid min-w-0 content-start gap-5">
          <Section title="Going to">
            <p className="text-[13px]"><b>{x.consignee}</b>{x.phone ? <span className="block text-muted">{x.phone}</span> : null}<span className="block [overflow-wrap:anywhere] text-muted">{[x.address, x.state].filter(Boolean).join(", ")}</span></p>
          </Section>
          {q.data.challans.length > 0 && <Section title="Challans"><ul className="grid gap-1 text-[13px]">{q.data.challans.map((c) => <li key={c.id}><Link href={`/sales/orders/${c.orderId}`} className="hover:underline">{c.number}</Link> <span className="text-muted">· {c.lines.map((l) => `${l.qty} ${l.name}`).join(", ")}</span></li>)}</ul></Section>}
          <Section title="Tracking page for the customer">
            <div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12.5px]"><span className="min-w-0 flex-1 truncate" data-testid="track-url">{trackAbs}</span><Button size="sm" variant="ghost" aria-label="Copy the tracking link" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(trackAbs).then(() => toast({ tone: "success", title: "Link copied" }), () => {})} /></div>
            <p className="mt-2 text-[12px] text-muted">Shows the status and dates only — not costs or notes.</p>
          </Section>
        </div>
      </div>
      {stepping && (
        <Dialog open onClose={() => setStepping(null)} title={LABEL[stepping]} footer={<><Button onClick={() => setStepping(null)}>Cancel</Button><Button variant="primary" disabled={stepping === "exception" && !note.trim()} loading={step.isPending} onClick={() => step.mutate()}>Save</Button></>}>
          <Field label={stepping === "exception" ? "What's holding it up?" : "Note (optional)"}>{(p) => <Input {...p} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </Dialog>
      )}
      {pod && <PodDialog id={id} onClose={() => setPod(false)} />}
      {paying && <PayDialog path={`shipments/${id}/pay`} title={`Pay ${inr(x.freightCost)} freight`} onClose={() => setPaying(false)} />}
    </div>
  );
}

function PodDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [podName, setName] = useState("");
  const [podNote, setNote] = useState("");
  const save = useModuleAction<void>(() => ({ path: `shipments/${id}/deliver`, body: { podName, podNote } }), { success: "Delivered", onDone: onClose, also: ["sales"] });
  return (
    <Dialog open onClose={onClose} title="Proof of delivery" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!podName.trim()} loading={save.isPending} onClick={() => save.mutate()}>Mark delivered</Button></>}>
      <div className="grid gap-3">
        <Field label="Received by">{(p) => <Input {...p} autoFocus value={podName} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Note" hint="Damage, short delivery, a reference">{(p) => <Textarea {...p} rows={2} value={podNote} onChange={(e) => setNote(e.target.value)} />}</Field>
        <p className="text-[12px] text-muted">The challans on this shipment are marked delivered in Sales.</p>
      </div>
    </Dialog>
  );
}

/** Bank and cash accounts to pay from. */
function useCashAccounts() {
  const { orgId, meta } = useLgx();
  const q = useQuery({ queryKey: ["accounts", orgId, "meta"], queryFn: () => api<{ accounts: { id: string; code: string; name: string; subtype: string }[] }>(`/api/v1/orgs/${orgId}/accounts/meta`), enabled: meta.links.accounting, retry: false });
  return (q.data?.accounts ?? []).filter((a) => a.subtype === "bank" || a.subtype === "cash");
}

function PayDialog({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const accounts = useCashAccounts();
  const [accountId, setAccount] = useState("");
  const [date, setDate] = useState(today());
  const acc = accountId || accounts[0]?.id || "";
  const pay = useModuleAction<void>(() => ({ path, body: { accountId: acc, date } }), { success: "Recorded", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!acc} loading={pay.isPending} onClick={() => pay.mutate()}>Confirm</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid from">{(p) => <Select {...p} value={acc} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">Posted to freight outward when the accounts next sync.</p>
    </Dialog>
  );
}

// ── Trips ───────────────────────────────────────────────────────────────────

type TripRow = { id: string; number: string; date: string; vehicleId: string; regNo: string; driver: string | null; status: string; stops: number; delivered: number; kg: number };

function TripsView() {
  const { meta, go } = useLgx();
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);
  const q = useModuleQuery<{ trips: TripRow[] }>(`trips?status=${status}`, { keepPrevious: true });
  const rows = q.data?.trips ?? [];
  return (
    <div>
      <PageHeader title="Trips" description="Your own vehicles' runs: stops, load, odometer and costs." actions={<div className="flex gap-2"><ExportMenu name="trips" columns={[{ key: "number", label: "Trip" }, { key: "date", label: "Date" }, { key: "regNo", label: "Vehicle" }, { key: "driver", label: "Driver" }, { key: "stops", label: "Stops" }, { key: "delivered", label: "Delivered" }, { key: "kg", label: "Load (kg)" }, { key: "status", label: "Status" }]} rows={rows.map((t) => ({ ...t, driver: t.driver ?? "", status: LABEL[t.status] ?? t.status }))} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Trip</Button>}</div>} />
      <Tabs value={status} onChange={setStatus} className="mb-5" tabs={[{ value: "all", label: "All" }, { value: "planned", label: "Planned" }, { value: "started", label: "On the road" }, { value: "completed", label: "Completed" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No trips.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/logistics/trips/${t.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:opacity-80">
                <span className="min-w-0 flex-1"><b className="block font-semibold">{t.number} · {t.regNo}</b><span className="text-[12px] text-muted">{fmt(t.date)}{t.driver ? ` · ${t.driver}` : ""} · {t.delivered}/{t.stops} delivered · {t.kg} kg</span></span>
                <Pill s={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <TripDialog onClose={() => setAdding(false)} onSaved={(id) => go(`trips/${id}`)} />}
    </div>
  );
}

function TripDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const vs = useModuleQuery<{ vehicles: Vehicle[] }>("vehicles");
  const ds = useModuleQuery<{ drivers: Driver[] }>("drivers");
  const ships = useModuleQuery<{ shipments: Shipment[] }>("shipments?status=open&tripless=1");
  const [f, setF] = useState({ date: today(), vehicleId: "", driverId: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [force, setForce] = useState(false);
  const vehicleId = f.vehicleId || vs.data?.vehicles.find((v) => v.active)?.id || "";
  const veh = vs.data?.vehicles.find((v) => v.id === vehicleId);
  const kg = (ships.data?.shipments ?? []).filter((x) => picked.includes(x.id)).reduce((n, x) => n + x.weightKg, 0);
  const over = !!veh?.capacityKg && kg > veh.capacityKg;
  const save = useModuleAction<void, { trip: { id: string } }>(() => ({ path: "trips", body: { date: f.date, vehicleId, driverId: f.driverId || null, shipmentIds: picked, force } }), { success: "Trip planned", onDone: (r) => (onClose(), onSaved(r.trip.id)) });
  return (
    <Dialog open onClose={onClose} title="Plan a trip" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!vehicleId || (over && !force)} loading={save.isPending} onClick={() => save.mutate()}>Plan trip</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Vehicle">{(p) => <Select {...p} value={vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>{(vs.data?.vehicles ?? []).filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.regNo}{v.capacityKg ? ` · ${v.capacityKg} kg` : ""}</option>)}</Select>}</Field>
        <Field label="Driver" hint="The vehicle's usual driver if blank">{(p) => <Select {...p} value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}><option value="">Usual driver</option>{(ds.data?.drivers ?? []).filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <fieldset className="grid max-h-48 gap-1 overflow-y-auto rounded-[12px] border border-border p-2 sm:col-span-2">
          <legend className="px-1 text-[12.5px] font-medium">Stops (own-fleet shipments waiting)</legend>
          {!(ships.data?.shipments ?? []).length && <p className="px-1 text-[12.5px] text-muted">None waiting. Make a shipment going by your own vehicle first.</p>}
          {(ships.data?.shipments ?? []).map((x) => <label key={x.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((y) => y !== x.id))} className="accent-[var(--accent)]" />{x.number} · {x.consignee} <span className="text-muted">({x.weightKg} kg)</span></label>)}
        </fieldset>
        {veh && <p className={cx("text-[12.5px] sm:col-span-2", over ? "font-semibold text-danger" : "text-muted")}>Load {Math.round(kg * 100) / 100} kg{veh.capacityKg ? ` of ${veh.capacityKg} kg` : ""}</p>}
        {over && <div className="sm:col-span-2"><Switch checked={force} onChange={setForce} label="Plan it anyway" /></div>}
      </div>
    </Dialog>
  );
}

type TripDetail = { trip: { id: string; number: string; date: string; status: string; startOdo: number | null; endOdo: number | null; expenses: { kind: string; amount: number; note: string }[]; notes: string }; vehicle: Vehicle; driver: Driver | null; stops: Shipment[]; load: { kg: number; share: number | null; over: boolean }; distance: number | null; costs: number };

function TripPage({ id }: { id: string }) {
  const { meta, go } = useLgx();
  const q = useModuleQuery<TripDetail>(`trips/${id}`);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const cancel = useModuleAction<void>(() => ({ path: `trips/${id}/cancel` }), { success: "Trip cancelled" });
  const reorder = useModuleAction<string[]>((ids) => ({ path: `trips/${id}/stops`, method: "PUT", body: { shipmentIds: ids } }));
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { trip: t, vehicle: v, stops } = q.data;
  const move = (i: number, d: number) => {
    const ids = stops.map((x) => x.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + d, 0, x);
    reorder.mutate(ids);
  };
  return (
    <div>
      <button type="button" onClick={() => go("trips")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Trips</button>
      <PageHeader
        title={`${t.number} · ${v.regNo}`}
        description={`${fmt(t.date)}${q.data.driver ? ` · ${q.data.driver.name}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={t.status} />
            {meta.me.write && t.status === "planned" && <Button size="sm" variant="primary" onClick={() => setStarting(true)}>Start trip</Button>}
            {meta.me.write && t.status === "started" && <Button size="sm" variant="primary" onClick={() => setFinishing(true)}>Finish trip</Button>}
            {meta.me.write && t.status === "planned" && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Load" value={`${q.data.load.kg} kg`} sub={v.capacityKg ? `of ${v.capacityKg} kg` : undefined} tone={q.data.load.over ? "warn" : undefined} />
        <Stat label="Stops" value={stops.length} sub={`${stops.filter((x) => x.status === "delivered").length} delivered`} />
        <Stat label="Distance" value={q.data.distance === null ? "—" : `${q.data.distance} km`} sub={t.startOdo !== null ? `from ${t.startOdo} km` : undefined} />
        <Stat label="Trip costs" value={inr(q.data.costs)} />
      </div>
      <Section title="Stops">
        {!stops.length ? <Empty>No stops.</Empty> : (
          <ol className="divide-y divide-border text-[13px]">
            {stops.map((x, i) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-5 text-[12px] text-muted tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1"><Link href={`/logistics/shipments/${x.id}`} className="block truncate font-semibold hover:underline">{x.consignee}</Link><span className="text-[12px] text-muted">{x.number} · {x.address || "—"} · {x.weightKg} kg</span></span>
                <Pill s={x.status} />
                {meta.me.write && t.status === "planned" && <span className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Move ${x.consignee} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button><Button size="sm" variant="ghost" aria-label={`Move ${x.consignee} down`} disabled={i === stops.length - 1} onClick={() => move(i, 1)}>↓</Button></span>}
              </li>
            ))}
          </ol>
        )}
        {t.status !== "planned" && stops.some((x) => OPEN_SHIP.includes(x.status)) && <p className="mt-3 text-[12px] text-muted">Mark each stop delivered from its shipment, with who received it.</p>}
      </Section>
      {t.expenses.length > 0 && <Section title="Costs"><ul className="mt-1 grid gap-1 text-[13px]">{t.expenses.map((e, i) => <li key={i} className="flex justify-between"><span>{EXPENSE_LABEL[e.kind as (typeof EXPENSE_KINDS)[number]] ?? e.kind}{e.note ? ` · ${e.note}` : ""}</span><span className="tabular-nums">{inr(e.amount)}</span></li>)}</ul></Section>}
      {starting && <OdoDialog title="Start the trip" path={`trips/${id}/start`} last={v.odometer} onClose={() => setStarting(false)} />}
      {finishing && <FinishDialog id={id} start={t.startOdo} onClose={() => setFinishing(false)} />}
    </div>
  );
}

function OdoDialog({ title, path, last, onClose }: { title: string; path: string; last: number | null; onClose: () => void }) {
  const [odo, setOdo] = useState(last !== null ? String(last) : "");
  const save = useModuleAction<void>(() => ({ path, body: { odometer: Number(odo) } }), { success: "Trip started", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={odo === ""} loading={save.isPending} onClick={() => save.mutate()}>Start</Button></>}>
      <Field label="Odometer (km)" hint={last !== null ? `Last: ${last} km` : undefined}>{(p) => <Input {...p} autoFocus inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} />}</Field>
    </Dialog>
  );
}

function FinishDialog({ id, start, onClose }: { id: string; start: number | null; onClose: () => void }) {
  const { meta } = useLgx();
  const accounts = useCashAccounts();
  const toast = useToast();
  const [odo, setOdo] = useState("");
  const [expenses, setExpenses] = useState<{ kind: string; amount: string; note: string }[]>([]);
  const [paidFromId, setPaid] = useState("");
  const costs = expenses.filter((e) => toPaise(e.amount) > 0);
  const save = useModuleAction<void, { notDelivered: number; servicing: { raised: number } }>(() => ({ path: `trips/${id}/complete`, body: { odometer: Number(odo), expenses: costs.map((e) => ({ kind: e.kind, amount: toPaise(e.amount), note: e.note })), paidFromId: costs.length ? paidFromId || accounts[0]?.id || null : null } }), { onDone: (r) => (toast({ tone: "success", title: `Trip finished${r.notDelivered ? ` — ${r.notDelivered} stop${r.notDelivered === 1 ? "" : "s"} not delivered yet` : ""}${r.servicing.raised ? ` · ${r.servicing.raised} service job raised` : ""}` }), onClose()) });
  return (
    <Dialog open onClose={onClose} title="Finish the trip" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={odo === "" || (costs.length > 0 && meta.links.accounting && !accounts.length)} loading={save.isPending} onClick={() => save.mutate()}>Finish</Button></>}>
      <div className="grid gap-3">
        <Field label="Odometer now (km)" hint={start !== null ? `Started at ${start} km` : undefined}>{(p) => <Input {...p} autoFocus inputMode="decimal" value={odo} onChange={(e) => setOdo(e.target.value)} />}</Field>
        <p className="text-[12.5px] font-medium">Costs on the way</p>
        {expenses.map((e, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label={`Cost ${i + 1} kind`} value={e.kind} onChange={(ev) => setExpenses(expenses.map((x, j) => (j === i ? { ...x, kind: ev.target.value } : x)))} className="h-9 !w-40">{EXPENSE_KINDS.map((k) => <option key={k} value={k}>{EXPENSE_LABEL[k]}</option>)}</Select>
            <Input aria-label={`Cost ${i + 1} amount`} inputMode="decimal" value={e.amount} onChange={(ev) => setExpenses(expenses.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))} placeholder="₹" className="h-9 !w-28" />
            <Input aria-label={`Cost ${i + 1} note`} value={e.note} onChange={(ev) => setExpenses(expenses.map((x, j) => (j === i ? { ...x, note: ev.target.value } : x)))} className="h-9 flex-1" />
            <Button size="sm" variant="ghost" aria-label="Remove cost" icon={<X className="size-3.5" />} onClick={() => setExpenses(expenses.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setExpenses([...expenses, { kind: "toll", amount: "", note: "" }])}>Cost</Button>
        {costs.length > 0 && accounts.length > 0 && <Field label="Paid from">{(p) => <Select {...p} value={paidFromId || accounts[0].id} onChange={(e) => setPaid(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>}</Field>}
      </div>
    </Dialog>
  );
}

// ── Fleet ───────────────────────────────────────────────────────────────────

function VehiclesView() {
  const { meta, orgId, go } = useLgx();
  const qc = useQueryClient();
  const q = useModuleQuery<{ vehicles: Vehicle[] }>("vehicles");
  const [adding, setAdding] = useState(false);
  const rows = q.data?.vehicles ?? [];
  return (
    <div>
      <PageHeader
        title="Vehicles"
        description="Your fleet, its papers, and how far it goes on a litre."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="vehicles" columns={[{ key: "regNo", label: "Registration" }, { key: "name", label: "Make & model" }, { key: "type", label: "Type" }, { key: "ownership", label: "Ownership" }, { key: "capacityKg", label: "Capacity (kg)" }, { key: "fuel", label: "Fuel" }, { key: "odometer", label: "Odometer" }, { key: "kmPerLitre", label: "km/l" }, { key: "papers", label: "Papers due" }]} rows={rows.map((v) => ({ ...v, type: VEHICLE_TYPE_LABEL[v.type], odometer: v.odometer ?? "", kmPerLitre: v.mileage?.kmPerLitre ?? "", papers: (v.alerts ?? []).map((a) => `${DOC_LABEL[a.kind]} ${a.expiresOn}`).join("; ") }))} />
            {meta.me.manage && <ImportButton target={target("logistics.vehicles")} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/logistics/vehicles/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["logistics", orgId] })} />}
            {meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Vehicle</Button>}
          </div>
        }
      />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>Add your vehicles, or import them from a spreadsheet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => go(`vehicles/${v.id}`)} className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left hover:opacity-80">
                <span className="min-w-0 flex-1"><b className={cx("block font-semibold", !v.active && "text-muted")}>{v.regNo}{v.name ? <span className="font-normal text-muted"> · {v.name}</span> : null}</b><span className="text-[12px] text-muted">{VEHICLE_TYPE_LABEL[v.type]}{v.capacityKg ? ` · ${v.capacityKg} kg` : ""}{v.driver ? ` · ${v.driver}` : ""}{v.odometer !== null ? ` · ${v.odometer} km` : ""}{v.mileage?.kmPerLitre ? ` · ${v.mileage.kmPerLitre} km/l` : ""}</span></span>
                {(v.alerts ?? []).length > 0 && <span className={cx("text-[12px] font-semibold", v.alerts!.some((a) => a.expired) ? "text-danger" : "text-warning")}>{v.alerts!.map((a) => DOC_LABEL[a.kind]).join(", ")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <VehicleDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle?: Vehicle; onClose: () => void }) {
  const { meta } = useLgx();
  const ds = useModuleQuery<{ drivers: Driver[] }>("drivers");
  const [f, setF] = useState({ regNo: vehicle?.regNo ?? "", name: vehicle?.name ?? "", type: vehicle?.type ?? "van", ownership: vehicle?.ownership ?? "own", capacityKg: vehicle?.capacityKg ? String(vehicle.capacityKg) : "", fuel: vehicle?.fuel ?? "diesel", driverId: vehicle?.driverId ?? "", assetId: vehicle?.assetId ?? null, active: vehicle?.active ?? true, notes: vehicle?.notes ?? "" });
  const [docs, setDocs] = useState<Doc[]>(vehicle?.docs ?? [{ kind: "insurance", number: "", expiresOn: null }, { kind: "puc", number: "", expiresOn: null }]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: vehicle ? `vehicles/${vehicle.id}` : "vehicles", method: vehicle ? "PUT" : "POST", body: { ...f, capacityKg: Number(f.capacityKg) || 0, driverId: f.driverId || null, docs: docs.filter((d) => d.number || d.expiresOn) } }), { success: "Vehicle saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={vehicle ? `Edit ${vehicle.regNo}` : "Add a vehicle"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.regNo.trim().length < 4} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registration number">{(p) => <Input {...p} autoFocus value={f.regNo} onChange={set("regNo")} placeholder="MH12 AB 1234" />}</Field>
        <Field label="Make & model">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Type">{(p) => <Select {...p} value={f.type} onChange={set("type")}>{VEHICLE_TYPES.map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABEL[t]}</option>)}</Select>}</Field>
        <Field label="Ownership">{(p) => <Select {...p} value={f.ownership} onChange={set("ownership")}><option value="own">Own</option><option value="hired">Hired</option><option value="leased">Leased</option></Select>}</Field>
        <Field label="Capacity (kg)">{(p) => <Input {...p} inputMode="decimal" value={f.capacityKg} onChange={set("capacityKg")} />}</Field>
        <Field label="Fuel">{(p) => <Select {...p} value={f.fuel} onChange={set("fuel")}>{FUELS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</Select>}</Field>
        <Field label="Usual driver">{(p) => <Select {...p} value={f.driverId} onChange={set("driverId")}><option value="">None</option>{(ds.data?.drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}</Field>
        <div className="flex items-end pb-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" /></div>
        <div className="grid gap-2 sm:col-span-2">
          <p className="text-[12.5px] font-medium">Papers</p>
          {docs.map((d, i) => (
            <div key={i} className="flex gap-2">
              <Select aria-label={`Paper ${i + 1}`} value={d.kind} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, kind: e.target.value as Doc["kind"] } : x)))} className="h-9 !w-44">{DOC_KINDS.map((k) => <option key={k} value={k}>{DOC_LABEL[k]}</option>)}</Select>
              <Input aria-label={`Paper ${i + 1} number`} value={d.number} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} placeholder="Number" className="h-9 flex-1" />
              <Input aria-label={`${DOC_LABEL[d.kind]} expires`} type="date" value={d.expiresOn ?? ""} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, expiresOn: e.target.value || null } : x)))} className="h-9 !w-40" />
              <Button size="sm" variant="ghost" aria-label="Remove paper" icon={<X className="size-3.5" />} onClick={() => setDocs(docs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setDocs([...docs, { kind: "permit", number: "", expiresOn: null }])}>Paper</Button>
        </div>
        {meta.links.maintenance && <p className="text-[12px] text-muted sm:col-span-2">Link it to its asset in Assets & maintenance from the vehicle&apos;s page, so odometer readings bring its servicing due.</p>}
        <Field label="Notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={f.notes} onChange={set("notes")} />}</Field>
      </div>
    </Dialog>
  );
}

type VehicleDetail = { vehicle: Vehicle; alerts: (Doc & { expired: boolean })[]; fuel: { id: string; date: string; litres: number; amount: number; odometer: number; full: boolean; station: string }[]; trips: { id: string; number: string; date: string; status: string; startOdo: number | null; endOdo: number | null }[]; mileage: { km: number; litres: number; kmPerLitre: number | null; costPerKm: number | null }; distance: number; tripCosts: number };

function VehiclePage({ id }: { id: string }) {
  const { meta, orgId, go } = useLgx();
  const q = useModuleQuery<VehicleDetail>(`vehicles/${id}`);
  const [editing, setEditing] = useState(false);
  const [fueling, setFueling] = useState(false);
  const [linking, setLinking] = useState(false);
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { vehicle: v, mileage: m } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("vehicles")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Vehicles</button>
      <PageHeader title={v.regNo} description={[v.name, VEHICLE_TYPE_LABEL[v.type], v.capacityKg ? `${v.capacityKg} kg` : "", v.fuel].filter(Boolean).join(" · ")} actions={<div className="flex gap-2">{meta.me.write && <Button size="sm" icon={<Fuel className="size-3.5" />} onClick={() => setFueling(true)}>Fuel</Button>}{meta.me.manage && meta.links.maintenance && <Button size="sm" onClick={() => setLinking(true)}>{v.assetId ? "Servicing link" : "Link to servicing"}</Button>}{meta.me.manage && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}</div>} />
      <CustomFieldsCard entity="logistics.vehicle" id={id} />
      {q.data.alerts.length > 0 && <div className="mb-4"><Notice tone={q.data.alerts.some((a) => a.expired) ? "danger" : "warning"} title="Papers to renew">{q.data.alerts.map((a) => `${DOC_LABEL[a.kind]} ${a.expired ? "expired" : "expires"} ${fmt(a.expiresOn)}`).join(" · ")}</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Odometer" value={v.odometer === null ? "—" : `${v.odometer} km`} sub={v.odometerAt ? `read ${fmt(v.odometerAt)}` : undefined} />
        <Stat label="Mileage" value={m.kmPerLitre === null ? "—" : `${m.kmPerLitre} km/l`} sub={m.km ? `over ${m.km} km` : "two full fills needed"} />
        <Stat label="Fuel cost per km" value={m.costPerKm === null ? "—" : inr(m.costPerKm)} />
        <Stat label="Trips" value={q.data.trips.length} sub={`${q.data.distance} km · ${inr(q.data.tripCosts)} costs`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Fuel">{!q.data.fuel.length ? <Empty>No fills logged.</Empty> : <ul className="divide-y divide-border text-[13px]">{q.data.fuel.slice(0, 20).map((f) => <li key={f.id} className="flex justify-between gap-2 py-1.5"><span>{fmt(f.date)} · {f.litres} l{f.full ? "" : " (part)"}{f.station ? ` · ${f.station}` : ""}</span><span className="text-muted tabular-nums">{f.odometer} km · {inr(f.amount)}</span></li>)}</ul>}</Section>
        <Section title="Trips">{!q.data.trips.length ? <Empty>No trips.</Empty> : <ul className="divide-y divide-border text-[13px]">{q.data.trips.slice(0, 20).map((t) => <li key={t.id} className="flex justify-between gap-2 py-1.5"><Link href={`/logistics/trips/${t.id}`} className="hover:underline">{t.number} · {fmt(t.date)}</Link><span className="flex items-center gap-2 text-muted">{t.startOdo !== null && t.endOdo !== null ? `${Math.round((t.endOdo - t.startOdo) * 10) / 10} km` : ""}<Pill s={t.status} /></span></li>)}</ul>}</Section>
        <Section title="Papers"><ul className="grid gap-1 text-[13px]">{v.docs.map((d, i) => <li key={i} className="flex justify-between"><span>{DOC_LABEL[d.kind]}{d.number ? ` · ${d.number}` : ""}</span><span className="text-muted">{fmt(d.expiresOn)}</span></li>)}{!v.docs.length && <li className="text-muted">None recorded.</li>}</ul></Section>
      </div>
      {editing && <VehicleDialog vehicle={v} onClose={() => setEditing(false)} />}
      {fueling && <FuelDialog vehicleId={v.id} last={v.odometer} onClose={() => setFueling(false)} />}
      {linking && <LinkAssetDialog vehicle={v} orgId={orgId} onClose={() => setLinking(false)} />}
    </div>
  );
}

function LinkAssetDialog({ vehicle, orgId, onClose }: { vehicle: Vehicle; orgId: string; onClose: () => void }) {
  const assets = useQuery({ queryKey: ["maintenance", orgId, "assets"], queryFn: () => api<{ assets: { id: string; code: string; name: string; meterUnit: string }[] }>(`/api/v1/orgs/${orgId}/maintenance/assets`), retry: false }).data?.assets;
  const [assetId, setAssetId] = useState(vehicle.assetId ?? "");
  const save = useModuleAction<void>(() => ({ path: `vehicles/${vehicle.id}`, method: "PUT", body: { ...vehicle, assetId: assetId || null } }), { success: "Linked", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Link to its asset" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <Field label="Asset in Assets & maintenance" hint="Give the asset the meter unit km so odometer readings count towards its servicing">{(p) => <Select {...p} value={assetId} onChange={(e) => setAssetId(e.target.value)}><option value="">Not linked</option>{(assets ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.meterUnit ? ` (${a.meterUnit})` : ""}</option>)}</Select>}</Field>
    </Dialog>
  );
}

function FuelDialog({ vehicleId, last, onClose }: { vehicleId?: string; last?: number | null; onClose: () => void }) {
  const { meta } = useLgx();
  const vs = useModuleQuery<{ vehicles: Vehicle[] }>(vehicleId ? null : "vehicles");
  const accounts = useCashAccounts();
  const [f, setF] = useState({ vehicleId: vehicleId ?? "", date: today(), litres: "", amount: "", odometer: "", full: true, station: "", paidFromId: "" });
  const vid = f.vehicleId || vs.data?.vehicles.find((v) => v.active)?.id || "";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: "fuel", body: { vehicleId: vid, date: f.date, litres: Number(f.litres), amount: toPaise(f.amount), odometer: Number(f.odometer), full: f.full, station: f.station, paidFromId: f.paidFromId || null } }), { success: "Fill logged", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Log a fill" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!vid || !(Number(f.litres) > 0) || f.odometer === ""} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!vehicleId && <Field label="Vehicle">{(p) => <Select {...p} value={vid} onChange={set("vehicleId")}>{(vs.data?.vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.regNo}</option>)}</Select>}</Field>}
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} max={today()} onChange={set("date")} />}</Field>
        <Field label="Litres">{(p) => <Input {...p} autoFocus inputMode="decimal" value={f.litres} onChange={set("litres")} />}</Field>
        <Field label="Amount (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={set("amount")} />}</Field>
        <Field label="Odometer (km)" hint={last != null ? `Last: ${last} km` : undefined}>{(p) => <Input {...p} inputMode="decimal" value={f.odometer} onChange={set("odometer")} />}</Field>
        <Field label="Station">{(p) => <Input {...p} value={f.station} onChange={set("station")} />}</Field>
        {meta.links.accounting && accounts.length > 0 && <Field label="Paid from" hint="Blank if it's on a fuel card billed later">{(p) => <Select {...p} value={f.paidFromId} onChange={set("paidFromId")}><option value="">Not posted now</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>}</Field>}
        <div className="flex items-end pb-2"><Switch checked={f.full} onChange={(v) => setF({ ...f, full: v })} label="Filled to the top" /></div>
      </div>
    </Dialog>
  );
}

function DriversView() {
  const { meta } = useLgx();
  const q = useModuleQuery<{ drivers: Driver[] }>("drivers");
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const rows = q.data?.drivers ?? [];
  return (
    <div>
      <PageHeader title="Drivers" description="Who drives, and when their licences run out." actions={<div className="flex gap-2"><ExportMenu name="drivers" columns={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "licenceNo", label: "Licence" }, { key: "licenceExpires", label: "Licence expires" }, { key: "active", label: "Active" }]} rows={rows.map((d) => ({ ...d, active: d.active ? "yes" : "no" }))} />{meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Driver</Button>}</div>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No drivers yet.</Empty> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 text-[13px] shadow-sm">
          {rows.map((d) => <li key={d.id}><button type="button" disabled={!meta.me.manage} onClick={() => setEditing(d)} className="flex w-full items-center gap-3 py-2.5 text-left disabled:cursor-default"><span className="min-w-0 flex-1"><b className={cx("block font-semibold", !d.active && "text-muted")}>{d.name}</b><span className="text-[12px] text-muted">{d.phone}{d.licenceNo ? ` · ${d.licenceNo}` : ""}</span></span>{d.licenceExpires && <span className={cx("text-[12px]", d.licenceAlert === "expired" ? "font-semibold text-danger" : d.licenceAlert ? "font-semibold text-warning" : "text-muted")}>licence {d.licenceAlert === "expired" ? "expired" : "to"} {fmt(d.licenceExpires)}</span>}</button></li>)}
        </ul>
      )}
      {editing && <DriverDialog driver={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DriverDialog({ driver, onClose }: { driver?: Driver; onClose: () => void }) {
  const [f, setF] = useState({ name: driver?.name ?? "", phone: driver?.phone ?? "", licenceNo: driver?.licenceNo ?? "", licenceExpires: driver?.licenceExpires ?? "", active: driver?.active ?? true, employeeId: driver?.employeeId ?? null });
  const save = useModuleAction<void>(() => ({ path: driver ? `drivers/${driver.id}` : "drivers", method: driver ? "PUT" : "POST", body: { ...f, licenceExpires: f.licenceExpires || null } }), { success: "Driver saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={driver ? `Edit ${driver.name}` : "Add a driver"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="Driving licence number">{(p) => <Input {...p} value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} />}</Field>
        <Field label="Licence valid till">{(p) => <Input {...p} type="date" value={f.licenceExpires} onChange={(e) => setF({ ...f, licenceExpires: e.target.value })} />}</Field>
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Driving for us" /></div>
      </div>
    </Dialog>
  );
}

function FuelView() {
  const { meta, orgId } = useLgx();
  const qc = useQueryClient();
  const q = useModuleQuery<{ fuel: { id: string; regNo: string; date: string; litres: number; amount: number; odometer: number; full: boolean; station: string; paidFromId: string | null }[] }>("fuel");
  const [adding, setAdding] = useState(false);
  const del = useModuleAction<string>((id) => ({ path: `fuel/${id}`, method: "DELETE" }), { success: "Removed" });
  const rows = q.data?.fuel ?? [];
  return (
    <div>
      <PageHeader
        title="Fuel log"
        description="Every fill, from the pump or the fuel-card statement."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="fuel-log" columns={[{ key: "date", label: "Date" }, { key: "regNo", label: "Vehicle" }, { key: "litres", label: "Litres" }, { key: "amount", label: "Amount", money: true }, { key: "odometer", label: "Odometer" }, { key: "full", label: "Full tank" }, { key: "station", label: "Station" }]} rows={rows.map((f) => ({ ...f, full: f.full ? "yes" : "no" }))} />
            {meta.me.write && <ImportButton target={target("logistics.fuel")} label="Import statement" onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/logistics/fuel/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["logistics", orgId] })} />}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Fuel className="size-4" />} onClick={() => setAdding(true)}>Fill</Button>}
          </div>
        }
      />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>No fills logged.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface px-4 shadow-sm">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted"><th className="py-2.5 pr-3 font-medium">Date</th><th className="py-2.5 pr-3 font-medium">Vehicle</th><th className="py-2.5 pr-3 text-right font-medium">Litres</th><th className="py-2.5 pr-3 text-right font-medium">Amount</th><th className="py-2.5 pr-3 text-right font-medium">Odometer</th><th className="py-2.5 pr-3 font-medium">Station</th><th /></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((f) => <tr key={f.id}><td className="py-2 pr-3">{fmt(f.date)}</td><td className="py-2 pr-3">{f.regNo}</td><td className="py-2 pr-3 text-right tabular-nums">{f.litres}{f.full ? "" : " (part)"}</td><td className="py-2 pr-3 text-right tabular-nums">{inr(f.amount)}</td><td className="py-2 pr-3 text-right tabular-nums">{f.odometer}</td><td className="py-2 pr-3 text-muted">{f.station}</td><td className="py-2 text-right">{meta.me.manage && <Button size="sm" variant="ghost" aria-label="Remove fill" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(f.id)} />}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {adding && <FuelDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

// ── Carriers & rates ────────────────────────────────────────────────────────

function CarriersView() {
  const { meta } = useLgx();
  const q = useModuleQuery<{ carriers: Carrier[] }>("carriers");
  const [editing, setEditing] = useState<Carrier | "new" | null>(null);
  const [rating, setRating] = useState<{ carrierId: string; rate?: Rate } | null>(null);
  const del = useModuleAction<string>((id) => ({ path: `rates/${id}`, method: "DELETE" }), { success: "Rate removed" });
  const rows = q.data?.carriers ?? [];
  return (
    <div>
      <PageHeader title="Carriers & rates" description="Transporters and couriers you use, and what they charge by lane and weight." actions={meta.me.manage ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Carrier</Button> : undefined} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !rows.length ? <Empty>Add the transporters and couriers you ship with.</Empty> : (
        <div className="grid gap-4">
          {rows.map((c) => (
            <Section key={c.id} title={`${c.name} · ${c.kind === "courier" ? "Courier" : "Transporter"}${c.active ? "" : " (not in use)"}`} action={meta.me.manage ? <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRating({ carrierId: c.id })}>Rate</Button></span> : undefined}>
              {!c.rates.length ? <p className="text-[12.5px] text-muted">No rates — freight is entered by hand.</p> : (
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-medium">Lane</th><th className="py-1 text-right font-medium">Per kg</th><th className="py-1 text-right font-medium">Minimum</th><th className="py-1 text-right font-medium">Fixed</th><th className="py-1 text-right font-medium">Volumetric ÷</th><th /></tr></thead>
                  <tbody className="divide-y divide-border">{c.rates.map((r) => <tr key={r.id}><td className="py-1.5">{r.fromState || "Any"} → {r.toState || "Any"}</td><td className="py-1.5 text-right tabular-nums">{inr(r.perKg)}</td><td className="py-1.5 text-right tabular-nums">{inr(r.minCharge)}</td><td className="py-1.5 text-right tabular-nums">{inr(r.fixed)}</td><td className="py-1.5 text-right tabular-nums">{r.volumetricDivisor || "—"}</td><td className="py-1.5 text-right">{meta.me.manage && <><Button size="sm" variant="ghost" onClick={() => setRating({ carrierId: c.id, rate: r })}>Edit</Button><Button size="sm" variant="ghost" aria-label="Remove rate" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(r.id)} /></>}</td></tr>)}</tbody>
                </table>
              )}
            </Section>
          ))}
        </div>
      )}
      {editing && <CarrierDialog carrier={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {rating && <RateDialog carrierId={rating.carrierId} rate={rating.rate} onClose={() => setRating(null)} />}
    </div>
  );
}

function CarrierDialog({ carrier, onClose }: { carrier?: Carrier; onClose: () => void }) {
  const [f, setF] = useState({ name: carrier?.name ?? "", kind: carrier?.kind ?? "transporter", trackingUrl: carrier?.trackingUrl ?? "", active: carrier?.active ?? true });
  const save = useModuleAction<void>(() => ({ path: carrier ? `carriers/${carrier.id}` : "carriers", method: carrier ? "PUT" : "POST", body: f }), { success: "Carrier saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={carrier ? `Edit ${carrier.name}` : "Add a carrier"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Carrier["kind"] })}><option value="transporter">Transporter (LR)</option><option value="courier">Courier (AWB)</option></Select>}</Field>
        <Field label="Tracking link" hint="With {tracking} where the number goes" className="sm:col-span-2">{(p) => <Input {...p} value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} placeholder="https://carrier.example/track?no={tracking}" />}</Field>
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" /></div>
      </div>
    </Dialog>
  );
}

function RateDialog({ carrierId, rate, onClose }: { carrierId: string; rate?: Rate; onClose: () => void }) {
  const [f, setF] = useState({ fromState: rate?.fromState ?? "", toState: rate?.toState ?? "", perKg: rs(rate?.perKg ?? 0), minCharge: rs(rate?.minCharge ?? 0), fixed: rs(rate?.fixed ?? 0), volumetricDivisor: rate?.volumetricDivisor ? String(rate.volumetricDivisor) : "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useModuleAction<void>(() => ({ path: rate ? `rates/${rate.id}` : "rates", method: rate ? "PUT" : "POST", body: { carrierId, fromState: f.fromState, toState: f.toState, perKg: toPaise(f.perKg), minCharge: toPaise(f.minCharge), fixed: toPaise(f.fixed), volumetricDivisor: Number(f.volumetricDivisor) || 0 } }), { success: "Rate saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={rate ? "Edit rate" : "Add a rate"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From state" hint="Code or name; blank for any">{(p) => <Input {...p} autoFocus value={f.fromState} onChange={set("fromState")} placeholder="MH" />}</Field>
        <Field label="To state" hint="Blank for any">{(p) => <Input {...p} value={f.toState} onChange={set("toState")} placeholder="KA" />}</Field>
        <Field label="Per kg (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.perKg} onChange={set("perKg")} />}</Field>
        <Field label="Minimum (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.minCharge} onChange={set("minCharge")} />}</Field>
        <Field label="Fixed per consignment (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.fixed} onChange={set("fixed")} />}</Field>
        <Field label="Volumetric divisor" hint="L×W×H cm ÷ this; 5000 for most couriers">{(p) => <Input {...p} inputMode="numeric" value={f.volumetricDivisor} onChange={set("volumetricDivisor")} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Reports & settings ──────────────────────────────────────────────────────

function ReportsView() {
  const { meta } = useLgx();
  const [from, setFrom] = useState(() => new Date(Date.parse(`${today()}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const q = useModuleQuery<{ vehicles: { id: string; regNo: string; trips: number; km: number; litres: number; fuelCost: number; tripCost: number; kmPerLitre: number | null; costPerKm: number | null }[]; carriers: { id: string | null; name: string; shipments: number; delivered: number; onTime: number; rate: number | null; exceptions: number; freightCost: number; freightBilled: number }[] }>(`reports?from=${from}&to=${to}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Reports" description="Carriers' on-time delivery and freight, and each vehicle's distance, mileage and cost per kilometre." actions={<div className="flex flex-wrap items-center gap-2"><Input aria-label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 !w-40 text-[13px]" /><Input aria-label="To" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-8 !w-40 text-[13px]" /></div>} />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <Section title="Carriers" action={<ExportMenu name="carrier-performance" columns={[{ key: "name", label: "Carrier" }, { key: "shipments", label: "Shipments" }, { key: "delivered", label: "Delivered" }, { key: "onTime", label: "On time" }, { key: "rate", label: "On-time %" }, { key: "exceptions", label: "Held up" }, { key: "freightCost", label: "Freight", money: true }, { key: "freightBilled", label: "Charged", money: true }]} rows={d.carriers.map((c) => ({ ...c, rate: c.rate === null ? "" : Math.round(c.rate * 100) }))} />}>
            {!d.carriers.length ? <Empty>No shipments in this period.</Empty> : (
              <table className="w-full text-[13px]"><thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-medium">Carrier</th><th className="py-1 text-right font-medium">Shipments</th><th className="py-1 text-right font-medium">On time</th><th className="py-1 text-right font-medium">Held up</th>{meta.me.write && <th className="py-1 text-right font-medium">Freight</th>}</tr></thead>
                <tbody className="divide-y divide-border">{d.carriers.map((c) => <tr key={c.id ?? "own"}><td className="py-1.5">{c.name}</td><td className="py-1.5 text-right tabular-nums">{c.shipments}</td><td className="py-1.5 text-right tabular-nums">{c.rate === null ? "—" : `${Math.round(c.rate * 100)}%`} <span className="text-muted">({c.onTime}/{c.delivered})</span></td><td className="py-1.5 text-right tabular-nums">{c.exceptions}</td>{meta.me.write && <td className="py-1.5 text-right tabular-nums">{inr(c.freightCost)}</td>}</tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Vehicles" action={<ExportMenu name="vehicle-costs" columns={[{ key: "regNo", label: "Vehicle" }, { key: "trips", label: "Trips" }, { key: "km", label: "Km" }, { key: "litres", label: "Litres" }, { key: "kmPerLitre", label: "km/l" }, { key: "fuelCost", label: "Fuel", money: true }, { key: "tripCost", label: "Trip costs", money: true }, { key: "costPerKm", label: "Cost per km", money: true }]} rows={d.vehicles} />}>
            {!d.vehicles.length ? <Empty>No vehicles.</Empty> : (
              <table className="w-full text-[13px]"><thead><tr className="text-left text-[12px] text-muted"><th className="py-1 font-medium">Vehicle</th><th className="py-1 text-right font-medium">Trips</th><th className="py-1 text-right font-medium">Km</th><th className="py-1 text-right font-medium">km/l</th><th className="py-1 text-right font-medium">Fuel</th><th className="py-1 text-right font-medium">Per km</th></tr></thead>
                <tbody className="divide-y divide-border">{d.vehicles.map((v) => <tr key={v.id}><td className="py-1.5"><Link href={`/logistics/vehicles/${v.id}`} className="hover:underline">{v.regNo}</Link></td><td className="py-1.5 text-right tabular-nums">{v.trips}</td><td className="py-1.5 text-right tabular-nums">{v.km}</td><td className="py-1.5 text-right tabular-nums">{v.kmPerLitre ?? "—"}</td><td className="py-1.5 text-right tabular-nums">{inr(v.fuelCost)}</td><td className="py-1.5 text-right tabular-nums">{v.costPerKm === null ? "—" : inr(v.costPerKm)}</td></tr>)}</tbody></table>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const { meta } = useLgx();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: f }), { success: "Saved" });
  return (
    <div className="grid max-w-2xl gap-5">
      <PageHeader title="Logistics settings" />
      <Section title="Numbering and alerts">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shipment numbers start with">{(p) => <Input {...p} value={f.shipmentPrefix} onChange={(e) => setF({ ...f, shipmentPrefix: e.target.value })} />}</Field>
          <Field label="Trip numbers start with">{(p) => <Input {...p} value={f.tripPrefix} onChange={(e) => setF({ ...f, tripPrefix: e.target.value })} />}</Field>
          <Field label="Promise delivery in (days)" hint="When a shipment has no date">{(p) => <Input {...p} inputMode="numeric" value={String(f.promiseDays)} onChange={(e) => setF({ ...f, promiseDays: Number(e.target.value) || 0 })} />}</Field>
          <Field label="Flag papers expiring within (days)">{(p) => <Input {...p} inputMode="numeric" value={String(f.alertDays)} onChange={(e) => setF({ ...f, alertDays: Number(e.target.value) || 1 })} />}</Field>
        </div>
      </Section>
      <Button variant="primary" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
