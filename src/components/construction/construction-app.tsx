"use client";

// Construction: contracts, and for each — the bill of quantities, the
// measurement book, RA bills (prepare, submit, certify), money received and
// the site diary.
import { useQueryClient } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleOfflineAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { mbQty } from "@/lib/construction/model";
import { target } from "@/lib/import/targets";
import { CustomFieldsCard } from "@/components/custom/fields-card";

type Meta = { me: { write: boolean; manage: boolean }; accounts: { id: string; name: string }[] };
type Contract = { id: string; name: string; client: string; clientGstin: string; workOrderNo: string; site: string; startDate: string | null; endDate: string | null; retentionPct: number; advancePct: number; gstRate: number; interState: boolean; tdsPct: number; status: string; boqValue: number; certified: number; receivable: number; progress: number };
type Item = { id: string; code: string; description: string; unit: string; qty: number; rate: number; amount: number; measured: number; billed: number };
type Bill = { id: string; seq: number; upTo: string; lines: { code: string; description: string; unit: string; rate: number; boqQty: number; upto: number; prev: number; qty: number; amount: number; excess: boolean }[]; gross: number; retention: number; advance: number; gst: number; tds: number; net: number; received: number; status: string; certifiedOn: string | null; clientRef: string };

const useCon = () => useModule<Meta>();
/** Quantities to at most three decimals (they're stored as 4-byte floats). */
const q3 = (x: number) => String(Math.round(x * 1000) / 1000);
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, "neutral" | "accent" | "success" | "warning"> = { draft: "neutral", submitted: "warning", certified: "accent", paid: "success" };

export function ConstructionApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta> api="construction" base="construction" title="Construction" icon={<HardHat />} section="" nav={() => [{ id: "", label: "Contracts", icon: <HardHat /> }]} render={() => (section === "contracts" && isId(id) ? <ContractPage key={id} id={id!} /> : <ContractsView />)} />
  );
}

function ContractsView() {
  const { meta, go } = useCon();
  const q = useModuleQuery<{ contracts: Contract[] }>("contracts");
  const [edit, setEdit] = useState<Partial<Contract> | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Contracts" actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>New contract</Button>} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.contracts.length ? <Empty>No contracts yet.</Empty> : (
        <ul className="space-y-3">{q.data.contracts.map((c) => (
          <li key={c.id} className="cursor-pointer rounded-[18px] border border-border bg-surface p-4 text-[13.5px] hover:bg-surface-2" onClick={() => go(`contracts/${c.id}`)}>
            <div className="flex flex-wrap justify-between gap-2"><b className="font-medium">{c.name}</b><Badge>{c.status}</Badge></div>
            <p className="text-muted">{c.client}{c.workOrderNo ? ` · ${c.workOrderNo}` : ""}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} progress`}><div className="h-full bg-fg" style={{ width: `${Math.min(100, c.progress)}%` }} /></div>
            <p className="mt-1 text-[12.5px] text-muted">{c.progress}% certified · {inr(c.certified)} of {inr(c.boqValue)}{c.receivable ? ` · ${inr(c.receivable)} to receive` : ""}</p>
          </li>
        ))}</ul>
      )}
      {edit && <ContractDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ContractDialog({ init, onClose }: { init: Partial<Contract>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", client: init.client ?? "", clientGstin: init.clientGstin ?? "", workOrderNo: init.workOrderNo ?? "", site: init.site ?? "", startDate: init.startDate ?? "", endDate: init.endDate ?? "", retentionPct: String(init.retentionPct ?? 5), advancePct: String(init.advancePct ?? 10), gstRate: String(init.gstRate ?? 18), interState: init.interState ?? false, tdsPct: String(init.tdsPct ?? 2), status: init.status ?? "active" });
  const save = useModuleAction<void>(() => ({ path: init.id ? `contracts/${init.id}` : "contracts", method: init.id ? "PUT" : "POST", body: { ...f, startDate: f.startDate || null, endDate: f.endDate || null, retentionPct: Number(f.retentionPct), advancePct: Number(f.advancePct), gstRate: Number(f.gstRate), tdsPct: Number(f.tdsPct) } }), { success: "Saved", onDone: onClose });
  const n = (k: "retentionPct" | "advancePct" | "tdsPct", label: string) => <Field label={label}>{(a) => <Input {...a} type="number" min={0} max={100} step="0.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>;
  return (
    <Dialog open onClose={onClose} size="lg" title={init.id ? "Edit contract" : "New contract"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.client.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contract" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Client">{(a) => <Input {...a} value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />}</Field>
        <Field label="Client GSTIN">{(a) => <Input {...a} value={f.clientGstin} onChange={(e) => setF({ ...f, clientGstin: e.target.value })} />}</Field>
        <Field label="Work order no.">{(a) => <Input {...a} value={f.workOrderNo} onChange={(e) => setF({ ...f, workOrderNo: e.target.value })} />}</Field>
        <Field label="Site">{(a) => <Input {...a} value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />}</Field>
        <Field label="Start">{(a) => <Input {...a} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
        <Field label="Completion">{(a) => <Input {...a} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
        {n("retentionPct", "Retention %")}
        {n("advancePct", "Advance recovery %")}
        <Field label="GST %">{(a) => <Select {...a} value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: e.target.value })}><option value="18">18%</option><option value="12">12%</option><option value="5">5%</option><option value="0">None</option></Select>}</Field>
        {n("tdsPct", "Client's TDS %")}
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.interState} onChange={(v) => setF({ ...f, interState: v })} label="Client in another state (IGST)" /> Client in another state (IGST)</label>
        {init.id && <Field label="Status">{(a) => <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option></Select>}</Field>}
      </div>
    </Dialog>
  );
}

function ContractPage({ id }: { id: string }) {
  const { meta } = useCon();
  const q = useModuleQuery<{ contract: Contract; advanceLeft: number }>(`contracts/${id}`);
  const [tab, setTab] = useState<"boq" | "mb" | "bills" | "money" | "diary">("boq");
  const [edit, setEdit] = useState(false);
  if (!q.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const c = q.data.contract;
  return (
    <div className="space-y-4">
      <Link href="/construction" className="text-[13px] text-muted hover:text-fg">← Contracts</Link>
      <PageHeader title={c.name} description={`${c.client}${c.workOrderNo ? ` · ${c.workOrderNo}` : ""} · retention ${c.retentionPct}% · advance recovery ${c.advancePct}% · GST ${c.gstRate}% · TDS ${c.tdsPct}%`} actions={meta.me.manage && <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>} />
      <CustomFieldsCard entity="construction.contract" id={id} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Contract value", inr(c.boqValue)], ["Certified", `${inr(c.certified)} (${c.progress}%)`], ["To receive", inr(c.receivable)], ["Advance to recover", inr(q.data.advanceLeft)]] as const).map(([l, v]) => <div key={l} className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">{l}</p><p className="text-[17px] font-semibold tabular-nums">{v}</p></div>)}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "boq", label: "BOQ" }, { value: "mb", label: "Measurements" }, { value: "bills", label: "RA bills" }, { value: "money", label: "Money received" }, { value: "diary", label: "Site diary" }]} />
      {tab === "boq" && <BoqTab id={id} />}
      {tab === "mb" && <MbTab id={id} />}
      {tab === "bills" && <BillsTab id={id} />}
      {tab === "money" && <MoneyTab id={id} />}
      {tab === "diary" && <DiaryTab id={id} />}
      {edit && <ContractDialog init={c} onClose={() => setEdit(false)} />}
    </div>
  );
}

function BoqTab({ id }: { id: string }) {
  const { meta, orgId } = useCon();
  const qc = useQueryClient();
  const q = useModuleQuery<{ items: Item[] }>(`contracts/${id}/boq`);
  const [f, setF] = useState<{ code: string; description: string; unit: string; qty: string; rate: string } | null>(null);
  const save = useModuleAction<void>(() => ({ path: `contracts/${id}/boq`, body: { ...f, qty: Number(f?.qty), rate: Math.round(Number(f?.rate) * 100) } }), { success: "Item added", onDone: () => setF(null) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{meta.me.manage && <ImportButton target={target("construction.boq")} onImport={(rows, mode) => api(`/api/v1/orgs/${orgId}/construction/contracts/${id}/boq/import`, { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["construction", orgId] })} />}<ExportMenu name="boq" rows={q.data?.items} columns={[{ key: "code", label: "Item" }, { key: "description", label: "Description" }, { key: "unit", label: "Unit" }, { key: "qty", label: "Quantity" }, { key: "rate", label: "Rate", money: true }, { key: "amount", label: "Amount", money: true }, { key: "measured", label: "Measured" }, { key: "billed", label: "Billed" }]} />{meta.me.manage && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setF({ code: "", description: "", unit: "cum", qty: "", rate: "" })}>Add an item</Button>}</div>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.items.length ? <Empty>No BOQ yet — import the tender&apos;s Excel or add items.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Rate</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 text-right font-medium">Measured</th><th className="px-3 py-2 text-right font-medium">Billed</th></tr></thead>
            <tbody className="divide-y divide-border">{q.data.items.map((i) => <tr key={i.id}><td className="px-3 py-2">{i.code}</td><td className="px-3 py-2">{i.description}</td><td className="px-3 py-2 text-right tabular-nums">{q3(i.qty)} {i.unit}</td><td className="px-3 py-2 text-right tabular-nums">{inr(i.rate)}</td><td className="px-3 py-2 text-right tabular-nums">{inr(i.amount)}</td><td className={cx("px-3 py-2 text-right tabular-nums", i.measured > i.qty && "font-medium text-danger")}>{q3(i.measured)}</td><td className="px-3 py-2 text-right tabular-nums">{q3(i.billed)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {f && (
        <Dialog open onClose={() => setF(null)} title="Add a BOQ item" footer={<><Button onClick={() => setF(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code || !f.description || !f.qty} onClick={() => save.mutate()}>Add</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Item code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
            <Field label="Unit">{(a) => <Input {...a} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />}</Field>
            <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
            <Field label="Quantity">{(a) => <Input {...a} type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
            <Field label="Rate (₹)">{(a) => <Input {...a} type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}</Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function MbTab({ id }: { id: string }) {
  const { meta } = useCon();
  const items = useModuleQuery<{ items: Item[] }>(`contracts/${id}/boq`);
  const q = useModuleQuery<{ measurements: { id: string; code: string; unit: string; date: string; location: string; nos: number; length: number | null; breadth: number | null; depth: number | null; qty: number; billId: string | null; checkedBy: string | null; by: string | null }[] }>(`contracts/${id}/measurements`);
  const [f, setF] = useState({ itemId: "", date: today(), location: "", nos: "1", length: "", breadth: "", depth: "" });
  const num = (x: string) => (x === "" ? null : Number(x));
  const preview = mbQty({ nos: Number(f.nos) || 0, length: num(f.length), breadth: num(f.breadth), depth: num(f.depth), qty: null });
  const save = useModuleOfflineAction<void>(() => ({ path: `contracts/${id}/measurements`, label: `Measurement: ${items.data?.items.find((i) => i.id === f.itemId)?.code ?? "item"} = ${preview}`, body: { itemId: f.itemId, date: f.date, location: f.location, nos: Number(f.nos) || 0, length: num(f.length), breadth: num(f.breadth), depth: num(f.depth) } }), { success: "Measurement recorded", onDone: () => setF({ ...f, location: "", length: "", breadth: "", depth: "" }) });
  const check = useModuleAction<string>((mid) => ({ path: `measurements/${mid}/check` }), { success: "Checked" });
  return (
    <div className="space-y-3">
      {meta.me.write && (
        <div className="grid gap-2 rounded-[20px] border border-border bg-surface p-4 sm:grid-cols-[2fr_140px_1fr_70px_80px_80px_80px_auto] sm:items-end">
          <Field label="BOQ item">{(a) => <Select {...a} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Pick…</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.description.slice(0, 40)}</option>)}</Select>}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Location">{(a) => <Input {...a} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
          <Field label="Nos">{(a) => <Input {...a} type="number" value={f.nos} onChange={(e) => setF({ ...f, nos: e.target.value })} />}</Field>
          <Field label="L">{(a) => <Input {...a} type="number" value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })} />}</Field>
          <Field label="B">{(a) => <Input {...a} type="number" value={f.breadth} onChange={(e) => setF({ ...f, breadth: e.target.value })} />}</Field>
          <Field label="D">{(a) => <Input {...a} type="number" value={f.depth} onChange={(e) => setF({ ...f, depth: e.target.value })} />}</Field>
          <Button variant="primary" loading={save.isPending} disabled={!f.itemId || !preview} onClick={() => save.mutate()}>Add {preview || ""}</Button>
        </div>
      )}
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.measurements.length ? <Empty>No measurements yet.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface text-[13px]">{q.data.measurements.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"><span>{m.date} · {m.code} · {m.location || "—"} · {q3(m.nos)}{m.length !== null ? ` × ${q3(m.length)}` : ""}{m.breadth !== null ? ` × ${q3(m.breadth)}` : ""}{m.depth !== null ? ` × ${q3(m.depth)}` : ""} = <b className="tabular-nums">{q3(m.qty)} {m.unit}</b> <span className="text-muted">· {m.by}</span></span><span className="flex items-center gap-2">{m.billId && <Badge>In a bill</Badge>}{m.checkedBy ? <Badge tone="success">Checked</Badge> : meta.me.manage && <Button size="sm" variant="ghost" onClick={() => check.mutate(m.id)}>Check</Button>}</span></li>)}</ul>}
    </div>
  );
}

function BillsTab({ id }: { id: string }) {
  const { meta } = useCon();
  const q = useModuleQuery<{ bills: Bill[] }>(`contracts/${id}/bills`);
  const [upTo, setUpTo] = useState(today());
  const prepare = useModuleAction<void, { bill: { seq: number } }>(() => ({ path: `contracts/${id}/bills`, body: { upTo } }), { success: (r) => `RA-${r.bill.seq} prepared` });
  const status = useModuleAction<{ id: string; to: string; certifiedGross?: number | null; clientRef?: string }>((x) => ({ path: `bills/${x.id}/status`, body: x }), { success: "Updated" });
  const [certifying, setCertifying] = useState<Bill | null>(null);
  const [cert, setCert] = useState({ amount: "", ref: "" });
  const [open, setOpen] = useState<Bill | null>(null);
  return (
    <div className="space-y-3">
      {meta.me.write && <div className="flex flex-wrap items-end gap-2"><Field label="Measurements up to">{(a) => <Input {...a} type="date" max={today()} value={upTo} onChange={(e) => setUpTo(e.target.value)} />}</Field><Button variant="primary" loading={prepare.isPending} onClick={() => prepare.mutate()}>Prepare the next RA bill</Button></div>}
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.bills.length ? <Empty>No RA bills yet.</Empty> : <ul className="space-y-2">{q.data.bills.map((b) => (
        <li key={b.id} className="rounded-[18px] border border-border bg-surface p-4 text-[13.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="font-medium hover:underline" onClick={() => setOpen(b)}>RA-{b.seq} · up to {b.upTo}</button><span className="flex items-center gap-2"><Badge tone={TONE[b.status]}>{b.status}</Badge>{b.status === "draft" && meta.me.write && <Button size="sm" onClick={() => status.mutate({ id: b.id, to: "submitted" })}>Submit</Button>}{b.status === "submitted" && meta.me.manage && <Button size="sm" variant="primary" onClick={() => (setCertifying(b), setCert({ amount: String(b.gross / 100), ref: "" }))}>Record certification</Button>}</span></div>
          <p className="text-muted">Work {inr(b.gross)} · retention {inr(b.retention)} · advance {inr(b.advance)} · GST {inr(b.gst)} · TDS {inr(b.tds)} · <b className="text-fg">net {inr(b.net)}</b>{b.received ? ` · received ${inr(b.received)}` : ""}{b.clientRef ? ` · ${b.clientRef}` : ""}</p>
        </li>
      ))}</ul>}
      {certifying && (
        <Dialog open onClose={() => setCertifying(null)} title={`Certification of RA-${certifying.seq}`} description="Enter what the client certified (before GST and deductions) if it's less than billed." footer={<><Button onClick={() => setCertifying(null)}>Cancel</Button><Button variant="primary" onClick={() => (status.mutate({ id: certifying.id, to: "certified", certifiedGross: Math.round(Number(cert.amount) * 100), clientRef: cert.ref }), setCertifying(null))}>Record</Button></>}>
          <div className="grid gap-3"><Field label="Work certified (₹)">{(a) => <Input {...a} type="number" value={cert.amount} onChange={(e) => setCert({ ...cert, amount: e.target.value })} />}</Field><Field label="Client's reference">{(a) => <Input {...a} value={cert.ref} onChange={(e) => setCert({ ...cert, ref: e.target.value })} />}</Field></div>
        </Dialog>
      )}
      {open && (
        <Dialog open onClose={() => setOpen(null)} size="xl" title={`RA-${open.seq} · abstract`} footer={<><Button onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={() => setOpen(null)}>Close</Button></>}>
          <table className="w-full text-[12.5px]"><thead className="text-left text-muted"><tr><th className="py-1 font-medium">Item</th><th className="py-1 font-medium">Description</th><th className="py-1 text-right font-medium">Up to date</th><th className="py-1 text-right font-medium">Previous</th><th className="py-1 text-right font-medium">This bill</th><th className="py-1 text-right font-medium">Rate</th><th className="py-1 text-right font-medium">Amount</th></tr></thead><tbody>{open.lines.map((l) => <tr key={l.code}><td className="py-1">{l.code}</td><td className="py-1">{l.description}{l.excess && <Badge tone="warning" className="ml-1">over BOQ</Badge>}</td><td className="py-1 text-right tabular-nums">{q3(l.upto)}</td><td className="py-1 text-right tabular-nums">{q3(l.prev)}</td><td className="py-1 text-right tabular-nums">{q3(l.qty)} {l.unit}</td><td className="py-1 text-right tabular-nums">{inr(l.rate)}</td><td className="py-1 text-right tabular-nums">{inr(l.amount)}</td></tr>)}</tbody></table>
          <dl className="mt-3 grid grid-cols-2 gap-1 text-[13px] sm:w-80 sm:justify-self-end">{([["Value of work", open.gross], ["Less retention", -open.retention], ["Less advance recovery", -open.advance], ["Add GST", open.gst], ["Less TDS", -open.tds], ["Net payable", open.net]] as const).map(([l, v]) => <div key={l} className="contents"><dt className="text-muted">{l}</dt><dd className="text-right tabular-nums">{inr(v)}</dd></div>)}</dl>
        </Dialog>
      )}
    </div>
  );
}

function MoneyTab({ id }: { id: string }) {
  const { meta } = useCon();
  const q = useModuleQuery<{ payments: { id: string; kind: string; amount: number; date: string; reference: string; billId: string | null }[] }>(`contracts/${id}/payments`);
  const bills = useModuleQuery<{ bills: Bill[] }>(`contracts/${id}/bills`);
  const [f, setF] = useState({ kind: "bill", billId: "", amount: "", date: today(), reference: "", accountId: "" });
  const save = useModuleAction<void>(() => ({ path: `contracts/${id}/payments`, body: { ...f, billId: f.billId || null, amount: Math.round(Number(f.amount) * 100), accountId: f.accountId || null } }), { success: "Recorded", onDone: () => setF({ ...f, amount: "", reference: "" }) });
  const open = bills.data?.bills.filter((b) => b.status === "certified") ?? [];
  return (
    <div className="space-y-3">
      {meta.me.manage && (
        <div className="grid gap-2 rounded-[20px] border border-border bg-surface p-4 sm:grid-cols-3">
          <Field label="For">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="bill">An RA bill</option><option value="advance">Mobilisation advance</option><option value="retention">Retention released</option></Select>}</Field>
          {f.kind === "bill" && <Field label="Bill">{(a) => <Select {...a} value={f.billId} onChange={(e) => { const b = open.find((x) => x.id === e.target.value); setF({ ...f, billId: e.target.value, amount: b ? String((b.net - b.received) / 100) : f.amount }); }}><option value="">Pick…</option>{open.map((b) => <option key={b.id} value={b.id}>RA-{b.seq} · {inr(b.net - b.received)} due</option>)}</Select>}</Field>}
          <Field label="Amount (₹)">{(a) => <Input {...a} type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="RTGS / cheque no." />}</Field>
          {!!meta.accounts.length && <Field label="Into account">{(a) => <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">The default bank account</option>{meta.accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
          <Button variant="primary" loading={save.isPending} disabled={!Number(f.amount) || (f.kind === "bill" && !f.billId)} onClick={() => save.mutate()}>Record</Button>
        </div>
      )}
      {!q.data ? <Skeleton className="h-24 rounded-[20px]" /> : !q.data.payments.length ? <Empty>Nothing received yet.</Empty> : <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface text-[13.5px]">{q.data.payments.map((p) => <li key={p.id} className="flex justify-between px-4 py-2"><span>{p.date} · {p.kind === "advance" ? "Mobilisation advance" : p.kind === "retention" ? "Retention released" : "Against a bill"}{p.reference ? ` · ${p.reference}` : ""}</span><b className="tabular-nums">{inr(p.amount)}</b></li>)}</ul>}
    </div>
  );
}

function DiaryTab({ id }: { id: string }) {
  const { meta } = useCon();
  const q = useModuleQuery<{ diary: { id: string; date: string; weather: string; labour: { trade: string; count: number }[]; work: string; hindrances: string; byName: string | null }[] }>(`contracts/${id}/diary`);
  const [f, setF] = useState({ date: today(), weather: "", labour: "", work: "", hindrances: "" });
  const save = useModuleOfflineAction<void>(() => ({ path: `contracts/${id}/diary`, label: `Site diary for ${f.date}`, body: { date: f.date, weather: f.weather, work: f.work, hindrances: f.hindrances, labour: f.labour.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.*?)\s*[:\-]?\s*(\d+)$/.exec(x); return m ? { trade: m[1] || "Labour", count: Number(m[2]) } : { trade: x, count: 0 }; }) } }), { success: "Diary saved", onDone: () => setF({ ...f, work: "", hindrances: "" }) });
  return (
    <div className="space-y-3">
      {meta.me.write && (
        <div className="grid gap-2 rounded-[20px] border border-border bg-surface p-4 sm:grid-cols-3">
          <Field label="Day">{(a) => <Input {...a} type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Weather">{(a) => <Input {...a} value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })} />}</Field>
          <Field label="Labour" hint="Like: Mason 8, Helper 12">{(a) => <Input {...a} value={f.labour} onChange={(e) => setF({ ...f, labour: e.target.value })} />}</Field>
          <Field label="Work done" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.work} onChange={(e) => setF({ ...f, work: e.target.value })} />}</Field>
          <Field label="Hindrances">{(a) => <Textarea {...a} rows={2} value={f.hindrances} onChange={(e) => setF({ ...f, hindrances: e.target.value })} />}</Field>
          <Button variant="primary" loading={save.isPending} disabled={!f.work.trim()} onClick={() => save.mutate()}>Save the day</Button>
        </div>
      )}
      {!q.data ? <Skeleton className="h-24 rounded-[20px]" /> : !q.data.diary.length ? <Empty>No diary entries yet.</Empty> : <ul className="space-y-2">{q.data.diary.map((d) => <li key={d.id} className="rounded-[16px] border border-border bg-surface p-3 text-[13.5px]"><b className="font-medium">{d.date}</b> <span className="text-muted">· {d.weather || "—"} · {d.labour.map((l) => `${l.trade} ${l.count}`).join(", ") || "no labour noted"} · {d.byName}</span><p className="mt-1 whitespace-pre-wrap">{d.work}</p>{d.hindrances && <p className="text-danger">Hindrances: {d.hindrances}</p>}</li>)}</ul>}
    </div>
  );
}
