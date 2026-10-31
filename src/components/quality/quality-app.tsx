"use client";

// Quality: home (pass rates, open reports), inspections with a sample grid,
// non-conformance reports worked through to a disposition, inspection plans.
import { ArrowLeft, ClipboardCheck, Home, ListChecks, Plus, Settings, ShieldAlert, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Section, Stat } from "@/components/crm/shared";
import { ModuleFrame, isId, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { DISPOSITIONS, NCR_SOURCES, SEVERITY, STAGES, passes, type QcSettings } from "@/lib/quality/model";

type Meta = { me: { id: string; write: boolean; manage: boolean }; settings: QcSettings; items: { id: string; name: string; sku: string; unit: string; category: string }[]; warehouses: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; people: { id: string; name: string }[] };
type Param = { id: string; name: string; kind: "measure" | "check"; min: number | null; max: number | null; unit: string };
type Plan = { id: string; name: string; itemId: string | null; category: string; stage: keyof typeof STAGES; sampleSize: number; samplePct: number; acceptMax: number; parameters: Param[]; active: boolean };
const useQc = () => useModule<Meta>();
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const TONE: Record<string, string> = { pending: "bg-accent-soft text-accent", passed: "bg-success-soft text-success", failed: "bg-danger-soft text-danger", open: "bg-warning-soft text-warning", closed: "bg-surface-2 text-muted" };
const Pill = ({ s }: { s: string }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold", TONE[s])}>{s[0].toUpperCase() + s.slice(1)}</span>;

export function QualityApp({ path }: { path: string[] }) {
  const [section = "", id] = path;
  return (
    <ModuleFrame<Meta>
      api="quality"
      base="quality"
      title="Quality"
      icon={<ShieldCheck />}
      section={section}
      nav={(m) => [
        { id: "", label: "Home", icon: <Home /> },
        { id: "inspections", label: "Inspections", icon: <ClipboardCheck />, group: "Checks" },
        { id: "ncrs", label: "Non-conformances", icon: <ShieldAlert /> },
        { id: "plans", label: "Inspection plans", icon: <ListChecks />, group: "Setup" },
        { id: "settings", label: "Settings", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => {
        switch (section) {
          case "inspections":
            return isId(id) ? <InspectionPage key={id} id={id!} /> : <InspectionsView />;
          case "ncrs":
            return isId(id) ? <NcrPage key={id} id={id!} /> : <NcrsView />;
          case "plans":
            return <PlansView />;
          case "settings":
            return <SettingsView />;
          default:
            return <HomeView />;
        }
      }}
    />
  );
}

type HomeData = { pending: number; passRate: number | null; inspected: number; openNcrs: number; held: number; overdueActions: { ncrId: string; number: string; action: string; due: string }[]; suppliers: { id: string; name: string; inspected: number; passRate: number | null }[]; items: { id: string; name: string; inspected: number; passRate: number | null }[] };

function HomeView() {
  const q = useModuleQuery<HomeData>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Quality" description="Inspections waiting, how lots are passing, and what's still being put right." />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="To inspect" value={d.pending} />
            <Stat label="Pass rate (90 days)" value={d.passRate === null ? "—" : `${d.passRate}%`} sub={`${d.inspected} lot${d.inspected === 1 ? "" : "s"} inspected`} />
            <Stat label="Open reports" value={d.openNcrs} sub={d.held ? `${d.held} units held` : "nothing held"} tone={d.openNcrs ? "warn" : undefined} />
            <Stat label="Actions overdue" value={d.overdueActions.length} tone={d.overdueActions.length ? "warn" : undefined} />
          </div>
          {d.overdueActions.length > 0 && <Section title="Overdue actions"><ul className="divide-y divide-border text-[13px]">{d.overdueActions.map((a) => <li key={a.ncrId + a.action} className="flex justify-between gap-3 py-2"><Link href={`/quality/ncrs/${a.ncrId}`} className="hover:underline">{a.number} · {a.action}</Link><span className="text-danger">due {fmt(a.due)}</span></li>)}</ul></Section>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Suppliers">{!d.suppliers.length ? <Empty>No supplier lots inspected yet.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.suppliers.map((x) => <li key={x.id} className="flex justify-between py-2"><span>{x.name} <span className="text-muted">· {x.inspected} lots</span></span><b className={cx("tabular-nums", (x.passRate ?? 100) < 90 && "text-danger")}>{x.passRate}%</b></li>)}</ul>}</Section>
            <Section title="Items">{!d.items.length ? <Empty>No lots inspected yet.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.items.map((x) => <li key={x.id} className="flex justify-between py-2"><span>{x.name} <span className="text-muted">· {x.inspected} lots</span></span><b className={cx("tabular-nums", (x.passRate ?? 100) < 90 && "text-danger")}>{x.passRate}%</b></li>)}</ul>}</Section>
          </div>
        </div>
      )}
    </div>
  );
}

type Insp = { id: string; number: string; stage: string; itemId: string; item: string; plan: string; supplier: string | null; lotQty: number; batch: string; sampleCount: number; status: string; defective: number; quarantined: number; source: { type: string; id: string | null; no: string }; createdAt: string; ncrId: string | null };

function InspectionsView() {
  const { meta, go } = useQc();
  const [tab, setTab] = useState<"pending" | "">("pending");
  const q = useModuleQuery<{ inspections: Insp[] }>(`inspections${tab ? `?status=${tab}` : ""}`, { keepPrevious: true });
  const [raising, setRaising] = useState(false);
  return (
    <div>
      <PageHeader title="Inspections" description="Lots waiting to be checked against their plan: made by themselves when goods are received or made, or raised by hand." actions={meta.me.write && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRaising(true)}>Inspect a lot</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "pending", label: "To inspect" }, { value: "", label: "All" }]} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.inspections.length ? <EmptyState icon={<ClipboardCheck />} title="Nothing to inspect" description="Add an inspection plan for an item or category; lots of it are queued here when they arrive or are made." /> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <tbody className="divide-y divide-border">
              {q.data.inspections.map((i) => (
                <tr key={i.id} onClick={() => go(`inspections/${i.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5"><b className="font-medium">{i.number}</b><span className="block text-[12px] text-muted">{STAGES[i.stage as keyof typeof STAGES]}{i.source.no ? ` · ${i.source.no}` : ""} · {fmt(i.createdAt)}</span></td>
                  <td className="px-4 py-2.5">{i.item}<span className="block text-[12px] text-muted">{i.lotQty} in lot{i.batch ? ` · batch ${i.batch}` : ""}{i.supplier ? ` · ${i.supplier}` : ""}</span></td>
                  <td className="px-4 py-2.5 text-[12.5px] text-muted">{i.sampleCount} sample{i.sampleCount === 1 ? "" : "s"}</td>
                  <td className="px-4 py-2.5"><Pill s={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {raising && <RaiseDialog onClose={() => setRaising(false)} />}
    </div>
  );
}

function RaiseDialog({ onClose }: { onClose: () => void }) {
  const { meta, go } = useQc();
  const plans = useModuleQuery<{ plans: Plan[] }>("plans");
  const [f, setF] = useState({ planId: "", itemId: "", warehouseId: meta.warehouses[0]?.id ?? "", qty: "", batch: "" });
  const plan = plans.data?.plans.find((p) => p.id === f.planId);
  const save = useModuleAction<void, { inspection: { id: string } }>(() => ({ path: "inspections", body: { ...f, itemId: plan?.itemId ?? f.itemId, qty: Number(f.qty) } }), { success: "Inspection raised", onDone: (r) => (onClose(), go(`inspections/${r.inspection.id}`)) });
  return (
    <Dialog open onClose={onClose} title="Inspect a lot" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!plan || !(Number(f.qty) > 0) || (!plan.itemId && !f.itemId)} onClick={() => save.mutate()}>Start</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plan" className="sm:col-span-2">{(a) => <Select {...a} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}><option value="">Choose…</option>{(plans.data?.plans ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {STAGES[p.stage]}</option>)}</Select>}</Field>
        {plan && !plan.itemId && <Field label="Item">{(a) => <Select {...a} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{meta.items.filter((i) => i.category.toLowerCase() === plan.category.toLowerCase()).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field>}
        <Field label="Lot size">{(a) => <Input {...a} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Location">{(a) => <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
        <Field label="Batch">{(a) => <Input {...a} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function InspectionPage({ id }: { id: string }) {
  const { meta } = useQc();
  const q = useModuleQuery<{ inspection: Insp & { samples: Record<string, number | boolean | null>[]; notes: string }; plan: Plan | null; item: { name: string; unit: string } }>(`inspections/${id}`);
  const [grid, setGrid] = useState<Record<string, number | boolean | null>[] | null>(null);
  const [notes, setNotes] = useState("");
  const save = useModuleAction<void, { inspection: Insp; ncrId: string | null }>(() => ({ path: `inspections/${id}/results`, body: { samples: grid, notes } }), { success: (r) => (r.inspection.status === "passed" ? "Passed" : `Failed — a report was raised${r.inspection.quarantined ? ` and ${r.inspection.quarantined} held in quarantine` : ""}`), also: ["inv"] });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { inspection: i, plan, item } = q.data;
  const rows = grid ?? (i.status === "pending" ? Array.from({ length: i.sampleCount }, () => Object.fromEntries((plan?.parameters ?? []).map((p) => [p.id, p.kind === "check" ? true : null]))) : i.samples);
  const set = (r: number, pid: string, v: number | boolean | null) => setGrid(rows.map((x, j) => (j === r ? { ...x, [pid]: v } : x)));
  const editable = i.status === "pending" && meta.me.write;
  return (
    <div>
      <Link href="/quality/inspections" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Inspections</Link>
      <PageHeader title={`${i.number} · ${item.name}`} description={`${STAGES[i.stage as keyof typeof STAGES]} · lot of ${i.lotQty}${i.batch ? ` · batch ${i.batch}` : ""}${i.source.no ? ` · ${i.source.no}` : ""} · ${plan?.name ?? ""}: ${(plan?.acceptMax ?? 0) === 0 ? "passes only with no failed samples" : `passes with up to ${plan!.acceptMax} failed sample${plan!.acceptMax === 1 ? "" : "s"}`}`} actions={<div className="flex items-center gap-2"><Pill s={i.status} />{editable && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record results</Button>}</div>} />
      {i.status === "failed" && <div className="mb-4"><Notice tone="danger" title={`${i.defective} sample${i.defective === 1 ? "" : "s"} failed`}>{i.quarantined ? `${i.quarantined} held in quarantine. ` : ""}{i.ncrId && <Link href={`/quality/ncrs/${i.ncrId}`} className="underline">Open the report</Link>}</Notice></div>}
      {plan && (
        <Section title="Samples">
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead className="text-left text-[12px] text-muted"><tr><th className="w-16 py-1.5 font-medium">#</th>{plan.parameters.map((p) => <th key={p.id} className="py-1.5 font-medium">{p.name}{p.kind === "measure" ? <span className="block font-normal">{p.min ?? "…"} – {p.max ?? "…"} {p.unit}</span> : null}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, n) => (
                  <tr key={n}>
                    <td className="py-1.5 text-muted">{n + 1}</td>
                    {plan.parameters.map((p) => {
                      const ok = passes(p, r[p.id]);
                      return (
                        <td key={p.id} className={cx("py-1.5 pr-2", !ok && r[p.id] !== null && "text-danger")}>
                          {p.kind === "check" ? (
                            <label className="flex items-center gap-2"><Switch checked={r[p.id] === true} onChange={(v) => editable && set(n, p.id, v)} label={`${p.name}, sample ${n + 1}`} /> {r[p.id] === true ? "OK" : "Fail"}</label>
                          ) : editable ? (
                            <Input aria-label={`${p.name}, sample ${n + 1}`} inputMode="decimal" className={cx(!ok && r[p.id] !== null && "!border-danger")} value={r[p.id] === null || r[p.id] === undefined ? "" : String(r[p.id])} onChange={(e) => set(n, p.id, e.target.value === "" ? null : Number(e.target.value))} />
                          ) : <span className="tabular-nums">{String(r[p.id] ?? "—")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && <Field label="Notes" className="mt-3">{(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />}</Field>}
        </Section>
      )}
    </div>
  );
}

type Ncr = { id: string; number: string; source: keyof typeof NCR_SOURCES; title: string; description: string; itemId: string | null; item: string | null; supplierId: string | null; supplier: string | null; warehouseId: string | null; batch: string; qty: number; severity: keyof typeof SEVERITY; rootCause: string; disposition: keyof typeof DISPOSITIONS; actions: { id: string; action: string; kind: "corrective" | "preventive"; ownerId: string | null; due: string | null; done: boolean }[]; status: string; held: number; createdAt: string; closedAt: string | null };

function NcrsView() {
  const { meta, go } = useQc();
  const [tab, setTab] = useState<"open" | "">("open");
  const q = useModuleQuery<{ ncrs: Ncr[] }>(`ncrs${tab ? `?status=${tab}` : ""}`, { keepPrevious: true });
  const [raising, setRaising] = useState(false);
  return (
    <div>
      <PageHeader title="Non-conformances" description="What went wrong, why, what's being done so it doesn't happen again, and what happens to the goods." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRaising(true)}>Report</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "open", label: "Open" }, { value: "", label: "All" }]} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.ncrs.length ? <Empty>No reports here.</Empty> : (
        <ul className="grid gap-2">
          {q.data.ncrs.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => go(`ncrs/${n.id}`)} className="w-full rounded-[16px] border border-border bg-surface px-4 py-3 text-left text-[13px] hover:bg-surface-2">
                <span className="flex items-center justify-between gap-3"><b className="font-medium">{n.number} · {n.title}</b><span className="flex items-center gap-2"><span className={cx("text-[11.5px] font-semibold", n.severity === "critical" ? "text-danger" : n.severity === "major" ? "text-warning" : "text-muted")}>{SEVERITY[n.severity]}</span><Pill s={n.status} /></span></span>
                <span className="block text-[12px] text-muted">{NCR_SOURCES[n.source]}{n.item ? ` · ${n.item}` : ""}{n.supplier ? ` · ${n.supplier}` : ""}{n.held ? ` · ${n.held} held` : ""} · {DISPOSITIONS[n.disposition]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {raising && <RaiseNcrDialog onClose={() => setRaising(false)} />}
    </div>
  );
}

function RaiseNcrDialog({ onClose }: { onClose: () => void }) {
  const { meta, go } = useQc();
  const [f, setF] = useState({ source: "internal", title: "", description: "", itemId: "", supplierId: "", qty: "", batch: "", severity: "minor" });
  const save = useModuleAction<void, { ncr: { id: string } }>(() => ({ path: "ncrs", body: { ...f, itemId: f.itemId || null, supplierId: f.supplierId || null, qty: Number(f.qty) || 0 } }), { success: "Reported", onDone: (r) => (onClose(), go(`ncrs/${r.ncr.id}`)) });
  return (
    <Dialog open onClose={onClose} size="lg" title="Report a non-conformance" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Report</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What's wrong" className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} />}</Field>
        <Field label="Found by">{(a) => <Select {...a} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{Object.entries(NCR_SOURCES).filter(([k]) => k !== "inspection").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Severity">{(a) => <Select {...a} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Item">{(a) => <Select {...a} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">—</option>{meta.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field>
        <Field label="Supplier">{(a) => <Select {...a} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{meta.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
        <Field label="Quantity">{(a) => <Input {...a} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Batch">{(a) => <Input {...a} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} />}</Field>
        <Field label="Details" className="sm:col-span-2">{(a) => <Textarea {...a} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} />}</Field>
      </div>
    </Dialog>
  );
}

let seq = 0;
const nid = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

function NcrPage({ id }: { id: string }) {
  const q = useModuleQuery<{ ncr: Ncr }>(`ncrs/${id}`);
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  return <NcrForm key={q.data.ncr.id + q.data.ncr.status} n={q.data.ncr} />;
}

function NcrForm({ n }: { n: Ncr }) {
  const { meta } = useQc();
  const [f, setF] = useState({ rootCause: n.rootCause, disposition: n.disposition, actions: n.actions });
  const save = useModuleAction(() => ({ path: `ncrs/${n.id}`, method: "PUT", body: f }), { success: "Saved" });
  const close = useModuleAction<void, { note: string }>(() => ({ path: `ncrs/${n.id}/close` }), { success: (r) => `Closed${r.note ? ` — ${r.note}` : ""}`, also: ["inv", "acc"] });
  const open = n.status === "open";
  const setAction = (i: number, p: Partial<Ncr["actions"][number]>) => setF({ ...f, actions: f.actions.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  return (
    <div>
      <Link href="/quality/ncrs" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Non-conformances</Link>
      <PageHeader title={`${n.number} · ${n.title}`} description={`${NCR_SOURCES[n.source]} · ${SEVERITY[n.severity]}${n.item ? ` · ${n.item}` : ""}${n.supplier ? ` · ${n.supplier}` : ""}${n.qty ? ` · ${n.qty} affected` : ""}${n.batch ? ` · batch ${n.batch}` : ""}`} actions={<div className="flex items-center gap-2"><Pill s={n.status} />{open && meta.me.write && <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}{open && meta.me.manage && <Button size="sm" variant="primary" loading={close.isPending} onClick={() => save.mutateAsync(undefined).then(() => close.mutate())}>Close</Button>}</div>} />
      {n.held > 0 && <div className="mb-4"><Notice title={`${n.held} held in quarantine`}>Closing carries out the decision: use as is or rework releases them to stock, scrap writes them off, return to supplier sends them back on a return with a debit note.</Notice></div>}
      {n.description && <p className="mb-5 text-[13.5px] whitespace-pre-line text-muted">{n.description}</p>}
      <div className="grid gap-5">
        <Section title="Why it happened">
          <Textarea aria-label="Root cause" rows={3} value={f.rootCause} disabled={!open} onChange={(e) => setF({ ...f, rootCause: e.target.value })} placeholder="The root cause (5 whys, fishbone…)" maxLength={4000} />
        </Section>
        <Section title="Actions">
          {f.actions.map((a, i) => (
            <div key={a.id} className="mb-2 grid grid-cols-[28px_minmax(0,1fr)_130px_150px_140px_32px] items-center gap-2">
              <input type="checkbox" aria-label={`Done: ${a.action}`} checked={a.done} disabled={!open} onChange={(e) => setAction(i, { done: e.target.checked })} className="size-4" />
              <Input aria-label="Action" value={a.action} disabled={!open} onChange={(e) => setAction(i, { action: e.target.value })} />
              <Select aria-label="Kind" value={a.kind} disabled={!open} onChange={(e) => setAction(i, { kind: e.target.value as "corrective" | "preventive" })}><option value="corrective">Corrective</option><option value="preventive">Preventive</option></Select>
              <Select aria-label="Owner" value={a.ownerId ?? ""} disabled={!open} onChange={(e) => setAction(i, { ownerId: e.target.value || null })}><option value="">Owner…</option>{meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              <Input aria-label="Due" type="date" value={a.due ?? ""} disabled={!open} onChange={(e) => setAction(i, { due: e.target.value || null })} />
              {open && <Button size="sm" variant="ghost" aria-label="Remove action" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, actions: f.actions.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          {open && <button type="button" className="text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, actions: [...f.actions, { id: nid(), action: "", kind: "corrective", ownerId: null, due: null, done: false }] })}>+ Add an action</button>}
        </Section>
        <Section title="What happens to the goods">
          <Select aria-label="Disposition" className="!w-auto" value={f.disposition} disabled={!open || !meta.me.manage} onChange={(e) => setF({ ...f, disposition: e.target.value as Ncr["disposition"] })}>{Object.entries(DISPOSITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          {!meta.me.manage && <p className="mt-2 text-[12px] text-muted">An owner or admin decides this.</p>}
        </Section>
      </div>
    </div>
  );
}

function PlansView() {
  const { meta } = useQc();
  const q = useModuleQuery<{ plans: Plan[] }>("plans");
  const [editing, setEditing] = useState<Plan | null | undefined>(undefined);
  return (
    <div>
      <PageHeader title="Inspection plans" description="What to check on an item (or every item in a category) at a stage, how many samples, and how many may fail." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing(null)}>Plan</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.plans.length ? <EmptyState icon={<ListChecks />} title="No plans yet" description="A plan says what to check — measurements with limits, or pass/fail checks — and inspections follow it." /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.plans.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => meta.me.manage && setEditing(p)} className={cx("w-full rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2", !p.active && "opacity-60")}>
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{p.name}</b><span className="text-[11.5px] text-muted">{STAGES[p.stage]}</span></span>
                <span className="mt-1 block text-[12.5px] text-muted">{p.itemId ? meta.items.find((i) => i.id === p.itemId)?.name : `All ${p.category}`} · {p.samplePct ? `${p.samplePct}% of the lot` : `${p.sampleSize} samples`} · {p.acceptMax} may fail · {p.parameters.length} check{p.parameters.length === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && <PlanDialog init={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function PlanDialog({ init, onClose }: { init: Plan | null; onClose: () => void }) {
  const { meta } = useQc();
  const categories = [...new Set(meta.items.map((i) => i.category).filter(Boolean))];
  const [f, setF] = useState({ name: init?.name ?? "", for: init?.itemId ? "item" : init?.category ? "category" : "item", itemId: init?.itemId ?? "", category: init?.category ?? "", stage: init?.stage ?? "receipt", sampleSize: String(init?.sampleSize ?? 5), samplePct: init?.samplePct ? String(init.samplePct) : "", acceptMax: String(init?.acceptMax ?? 0), active: init?.active ?? true, parameters: (init?.parameters ?? []).map((p) => ({ ...p, min: p.min === null ? "" : String(p.min), max: p.max === null ? "" : String(p.max) })) });
  const save = useModuleAction(() => ({ path: init ? `plans/${init.id}` : "plans", method: init ? "PUT" : "POST", body: { name: f.name, itemId: f.for === "item" ? f.itemId || null : null, category: f.for === "category" ? f.category : "", stage: f.stage, sampleSize: Number(f.sampleSize) || 1, samplePct: Number(f.samplePct) || 0, acceptMax: Number(f.acceptMax) || 0, active: f.active, parameters: f.parameters.filter((p) => p.name.trim()).map((p) => ({ id: p.id, name: p.name.trim(), kind: p.kind, unit: p.unit, min: p.kind === "measure" && p.min !== "" ? Number(p.min) : null, max: p.kind === "measure" && p.max !== "" ? Number(p.max) : null })) } }), { success: "Plan saved", onDone: onClose });
  const setP = (i: number, p: Partial<(typeof f.parameters)[number]>) => setF({ ...f, parameters: f.parameters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <Dialog open onClose={onClose} size="lg" title={init ? `Edit ${init.name}` : "New inspection plan"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !f.parameters.some((p) => p.name.trim()) || (f.for === "item" ? !f.itemId : !f.category)} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Incoming bolts" />}</Field>
          <Field label="When">{(a) => <Select {...a} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Plan["stage"] })}>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="For">{(a) => <Select {...a} value={f.for} onChange={(e) => setF({ ...f, for: e.target.value })}><option value="item">One item</option><option value="category">A category</option></Select>}</Field>
          {f.for === "item" ? <Field label="Item">{(a) => <Select {...a} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{meta.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field> : <Field label="Category">{(a) => <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Choose…</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>}
          <Field label="Samples" hint="Or a % of the lot">{(a) => <span className="grid grid-cols-2 gap-2"><Input {...a} inputMode="numeric" value={f.sampleSize} onChange={(e) => setF({ ...f, sampleSize: e.target.value })} /><Input aria-label="Sample %" inputMode="decimal" placeholder="%" value={f.samplePct} onChange={(e) => setF({ ...f, samplePct: e.target.value })} /></span>}</Field>
          <Field label="May fail" hint="Failed samples a lot can have and still pass">{(a) => <Input {...a} inputMode="numeric" value={f.acceptMax} onChange={(e) => setF({ ...f, acceptMax: e.target.value })} />}</Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium">Checks</p>
          {f.parameters.map((p, i) => (
            <div key={p.id} className="mb-2 grid grid-cols-[minmax(0,1fr)_120px_90px_90px_80px_32px] items-center gap-2">
              <Input aria-label={`Check ${i + 1}`} placeholder="Length" value={p.name} onChange={(e) => setP(i, { name: e.target.value })} />
              <Select aria-label={`Kind of check ${i + 1}`} value={p.kind} onChange={(e) => setP(i, { kind: e.target.value as "measure" | "check" })}><option value="check">Pass / fail</option><option value="measure">Measure</option></Select>
              {p.kind === "measure" ? <><Input aria-label={`Lowest for check ${i + 1}`} inputMode="decimal" placeholder="Min" value={p.min} onChange={(e) => setP(i, { min: e.target.value })} /><Input aria-label={`Highest for check ${i + 1}`} inputMode="decimal" placeholder="Max" value={p.max} onChange={(e) => setP(i, { max: e.target.value })} /><Input aria-label={`Unit for check ${i + 1}`} placeholder="mm" value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} /></> : <span className="col-span-3" />}
              <Button size="sm" variant="ghost" aria-label="Remove check" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, parameters: f.parameters.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button type="button" className="text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, parameters: [...f.parameters, { id: nid(), name: "", kind: "check", min: "", max: "", unit: "" }] })}>+ Add a check</button>
        </div>
        {init && <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" /> In use</label>}
      </div>
    </Dialog>
  );
}

function SettingsView() {
  const { meta } = useQc();
  const [f, setF] = useState(meta.settings);
  const save = useModuleAction(() => ({ path: "settings", method: "PUT", body: f }), { success: "Settings saved" });
  return (
    <div className="max-w-2xl">
      <PageHeader title="Quality settings" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>} />
      <Section title="Failed lots">
        <label className="flex items-center justify-between gap-3 text-[13px]"><span><b className="block font-medium">Hold failed lots in quarantine</b><span className="text-muted">Moved into the location&apos;s quarantine bin (add one in Inventory → Bins) until the report decides.</span></span><Switch checked={f.quarantineOnFail} onChange={(v) => setF({ ...f, quarantineOnFail: v })} label="Quarantine failed lots" /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Inspection prefix">{(a) => <Input {...a} value={f.inspectionPrefix} onChange={(e) => setF({ ...f, inspectionPrefix: e.target.value })} maxLength={8} />}</Field>
          <Field label="Report prefix">{(a) => <Input {...a} value={f.ncrPrefix} onChange={(e) => setF({ ...f, ncrPrefix: e.target.value })} maxLength={8} />}</Field>
        </div>
      </Section>
    </div>
  );
}
