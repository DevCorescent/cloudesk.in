"use client";

// The group of companies — intercompany entries and consolidated statements —
// and e-invoice / e-way bill files for the GST portals.
import { Download, FileJson, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { AccountOptions, Empty, Section, Stat, accApi, amt, fmt, inr, short, toPaise, todayIst, useAcc, useAccAction, useAccQuery } from "./shared";

// ── Group ───────────────────────────────────────────────────────────────────

type Entry = { id: string; number: string; date: string; fromCompanyId: string; toCompanyId: string; amount: number; fromAccountId: string; toAccountId: string; narration: string };
type Consolidated = {
  from: string;
  to: string;
  companies: { id: string; name: string }[];
  lines: { accountId: string; code: string; name: string; type: string; by: Record<string, number>; eliminated: number; consolidated: number }[];
  profit: Record<string, number>;
  pairs: { a: string; b: string; aSays: number; bSays: number; difference: number }[];
  balanced: boolean;
};

export function GroupView({ tab: initial }: { tab?: string }) {
  const { meta, go } = useAcc();
  const tab = initial === "consolidated" ? "consolidated" : "intercompany";
  return (
    <div>
      <PageHeader title="Group" description="Companies in this workspace trading with each other, and their accounts added up with what they owe and charge each other taken out." />
      {meta.companies.length < 2 ? (
        <EmptyState title="One company so far" description="Add your other companies in Settings → Organisation to record intercompany entries and see consolidated statements." action={<Link href="/settings/organisation" className="text-[13px] font-medium underline">Open Organisation</Link>} />
      ) : (
        <>
          <Tabs value={tab} onChange={(v) => go(`group/${v}`)} className="mb-5" tabs={[{ value: "intercompany", label: "Intercompany" }, { value: "consolidated", label: "Consolidated" }]} />
          {tab === "intercompany" ? <Intercompany /> : <Consolidation />}
        </>
      )}
    </div>
  );
}

function Intercompany() {
  const { meta } = useAcc();
  const q = useAccQuery<{ entries: Entry[] }>("intercompany");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const del = useAccAction<string>((id) => ({ path: `intercompany/${id}`, method: "DELETE" }), { success: "Entry removed", onDone: () => setRemoving(null) });
  const co = (id: string) => meta.companies.find((c) => c.id === id)?.name ?? "—";
  const acc = (id: string) => meta.accounts.find((a) => a.id === id);
  const rows = q.data?.entries ?? [];
  return (
    <>
      <div className="mb-4 flex justify-end">{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Intercompany entry</Button>}</div>
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <Empty>Funding one company from another, paying on another&apos;s behalf, or charging it a fee: each entry is posted in both companies, against &ldquo;Due from&rdquo; and &ldquo;Due to group companies&rdquo;.</Empty>
      ) : (
        <Section title="Entries">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2"><b className="font-medium">{co(r.fromCompanyId)} → {co(r.toCompanyId)}</b><span className="block text-[12px] text-muted">{r.number} · {fmt(r.date)}{r.narration ? ` · ${r.narration}` : ""} · {acc(r.fromAccountId)?.name} → {acc(r.toAccountId)?.name}</span></td>
                  <td className="py-2 text-right font-medium tabular-nums">{inr(r.amount)}</td>
                  <td className="w-10 text-right">{meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${r.number}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(r)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {adding && <IcDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing.id)} loading={del.isPending} destructive title={`Remove ${removing?.number}?`} description="Both companies' entries come out of the books." confirmLabel="Remove" />
    </>
  );
}

function IcDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useAcc();
  const def = meta.companies.find((c) => c.isDefault)?.id ?? "";
  const bank = meta.settings.defaultBankId ?? meta.accounts.find((a) => a.systemKey === "bank")?.id ?? "";
  const [f, setF] = useState({ date: todayIst(), fromCompanyId: def, toCompanyId: meta.companies.find((c) => !c.isDefault && c.active)?.id ?? "", amount: "", fromAccountId: bank, toAccountId: bank, narration: "" });
  const save = useAccAction(() => ({ path: "intercompany", body: { ...f, amount: toPaise(f.amount) } }), { success: "Posted in both companies", onDone: onClose });
  const pick = (x: { systemKey: string | null }) => x.systemKey !== "ic_receivable" && x.systemKey !== "ic_payable";
  const active = meta.companies.filter((c) => c.active);
  return (
    <Dialog open onClose={onClose} size="lg" title="Intercompany entry" description="Posted in both companies. The paying side gets “Due from group companies”, the other “Due to group companies”." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!toPaise(f.amount) || !f.fromCompanyId || !f.toCompanyId || f.fromCompanyId === f.toCompanyId} onClick={() => save.mutate(undefined)}>Post</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From company">
          {(a) => (
            <Select {...a} value={f.fromCompanyId} onChange={(e) => setF({ ...f, fromCompanyId: e.target.value })}>
              {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="To company">
          {(a) => (
            <Select {...a} value={f.toCompanyId} onChange={(e) => setF({ ...f, toCompanyId: e.target.value })}>
              <option value="">Choose…</option>
              {active.filter((c) => c.id !== f.fromCompanyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Credited in the from company" hint="A bank for money sent; income for a fee charged">
          {(a) => (
            <Select {...a} value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}>
              <AccountOptions accounts={meta.accounts} filter={pick} />
            </Select>
          )}
        </Field>
        <Field label="Debited in the to company" hint="A bank for money received; a cost for a fee">
          {(a) => (
            <Select {...a} value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
              <AccountOptions accounts={meta.accounts} filter={pick} />
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Narration" className="sm:col-span-2">{(a) => <Input {...a} value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} maxLength={300} placeholder="Working capital for October" />}</Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">When the credited account is income (a recharge or fee), that income and the other company&apos;s cost are also taken out on consolidation.</p>
    </Dialog>
  );
}

function Consolidation() {
  const { meta } = useAcc();
  const fy = meta.fy;
  const [range, setRange] = useState({ from: fy.from, to: todayIst() });
  const q = useAccQuery<Consolidated>(`consolidation?from=${range.from}&to=${range.to}`, { keepPrevious: true });
  const d = q.data;
  const name = (id: string) => d?.companies.find((c) => c.id === id)?.name ?? "—";
  const groups: [string, string][] = [["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"], ["income", "Income"], ["expense", "Expenses"]];
  return (
    <div className={cx("grid gap-5", q.isFetching && "opacity-80")}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Income and costs from">{(a) => <Input {...a} type="date" className="!w-44" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="Up to">{(a) => <Input {...a} type="date" className="!w-44" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      </div>
      {!d ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.companies.map((c) => <Stat key={c.id} label={`${c.name} profit`} value={short(d.profit[c.id] ?? 0)} />)}
            <Stat label="Group profit" value={short(d.profit.consolidated)} sub={d.profit.eliminated ? `${short(-d.profit.eliminated)} taken out` : "Nothing taken out"} />
          </div>
          {!d.balanced && <Notice tone="warning" title="Intercompany balances don't match">Each company should show the mirror of what the other shows. Check the pairs below for an entry posted on one side only.</Notice>}
          {d.pairs.length > 0 && (
            <Section title="Between companies">
              <table className="w-full text-[13px]">
                <tbody className="divide-y divide-border">
                  {d.pairs.map((p) => (
                    <tr key={`${p.a}${p.b}`}>
                      <td className="py-2">{name(p.a)} ↔ {name(p.b)}</td>
                      <td className="py-2 text-right tabular-nums">{name(p.a)}: {amt(p.aSays)}</td>
                      <td className="py-2 text-right tabular-nums">{name(p.b)}: {amt(p.bSays)}</td>
                      <td className={cx("py-2 text-right font-medium", p.difference ? "text-danger" : "text-success")}>{p.difference ? `Off by ${inr(Math.abs(p.difference))}` : "Matches"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
          <Section title="Consolidated trial balance">
            <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-right text-[12px] text-muted">
                  <tr>
                    <th className="py-1.5 text-left font-medium">Account</th>
                    {d.companies.map((c) => <th key={c.id} className="py-1.5 font-medium">{c.name}</th>)}
                    <th className="py-1.5 font-medium">Taken out</th>
                    <th className="py-1.5 font-medium">Group</th>
                  </tr>
                </thead>
                {groups.map(([t, label]) => {
                  const rows = d.lines.filter((l) => l.type === t);
                  if (!rows.length) return null;
                  return (
                    <tbody key={t} className="divide-y divide-border text-right tabular-nums">
                      <tr><td colSpan={d.companies.length + 3} className="pt-3 pb-1 text-left text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">{label}</td></tr>
                      {rows.map((l) => (
                        <tr key={l.accountId}>
                          <td className="py-1.5 text-left">{l.code} · {l.name}</td>
                          {d.companies.map((c) => <td key={c.id} className="py-1.5">{l.by[c.id] ? amt(l.by[c.id]) : "—"}</td>)}
                          <td className="py-1.5 text-muted">{l.eliminated ? amt(l.eliminated) : "—"}</td>
                          <td className="py-1.5 font-semibold">{amt(l.consolidated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
            <p className="mt-3 text-[12px] text-muted">Balance sheet accounts are up to {fmt(d.to)}; income and costs from {fmt(d.from)}. All companies keep their books in rupees; minority interests and unrealised profit in stock between companies aren&apos;t adjusted.</p>
          </Section>
        </>
      )}
    </div>
  );
}

// ── E-invoices and e-way bills ──────────────────────────────────────────────

type EDocRow = { id: string; type: string; number: string; date: string; client: string; gstin: string; currency: string; total: number; totalInr: number; goods: boolean; problems: string[]; record: { irn: string; ackNo: string; ackDate: string | null; ewbNo: string; ewbDate: string | null; ewbValidTill: string | null; transport: Record<string, unknown> } | null };

async function download(res: Response, name: string) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function EinvoiceView() {
  const { meta, orgId } = useAcc();
  const toast = useToast();
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const q = useAccQuery<{ documents: EDocRow[] }>(`einvoice?month=${month}`, { keepPrevious: true });
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<EDocRow | null>(null);
  const [busy, setBusy] = useState(false);
  const docs = q.data?.documents ?? [];
  const ready = docs.filter((d) => !d.problems.length);
  const exportJson = async () => {
    setBusy(true);
    try {
      const res = await fetch(accApi(orgId, "einvoice-export"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: picked }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Couldn't make the file");
      await download(res, `einvoices-${month}.json`);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Input aria-label="Month" type="month" className="!w-auto" value={month} onChange={(e) => (setMonth(e.target.value), setPicked([]))} />
        <Button size="sm" variant="primary" icon={<FileJson className="size-3.5" />} disabled={!picked.length} loading={busy} onClick={exportJson}>E-invoice JSON ({picked.length})</Button>
      </div>
      <p className="mb-4 text-[12.5px] text-muted">For businesses whose turnover needs e-invoicing. Download the JSON, upload it on the e-invoice portal (bulk upload or the offline tool), then record the IRN here. Cloudesk doesn&apos;t connect to the portal, so it can&apos;t get or cancel an IRN for you.</p>
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !docs.length ? (
        <Empty>No invoices to businesses with a GSTIN, or abroad, this month.</Empty>
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm", q.isFetching && "opacity-80")}>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Pick all ready" checked={!!ready.length && picked.length === ready.length} onChange={(e) => setPicked(e.target.checked ? ready.map((d) => d.id) : [])} className="size-4" /></th>
                <th className="py-2.5 font-medium">Invoice</th>
                <th className="py-2.5 font-medium">Client</th>
                <th className="py-2.5 text-right font-medium">Value (₹)</th>
                <th className="px-4 py-2.5 font-medium">IRN / e-way bill</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d) => (
                <tr key={d.id} className="align-top">
                  <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Pick ${d.number}`} disabled={!!d.problems.length} checked={picked.includes(d.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} className="size-4" /></td>
                  <td className="py-2.5"><b className="font-medium">{d.number}</b><span className="block text-[12px] text-muted">{d.type === "credit_note" ? "Credit note · " : ""}{fmt(d.date)}</span></td>
                  <td className="py-2.5">{d.client}<span className="block text-[12px] text-muted">{d.gstin || "Export"}</span>{d.problems.map((p) => <span key={p} className="block text-[12px] text-danger">{p}</span>)}</td>
                  <td className="py-2.5 text-right tabular-nums">{d.totalInr.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2.5 text-[12px]">{d.record?.irn ? <span className="font-mono">IRN …{d.record.irn.slice(-10)}</span> : <span className="text-muted">No IRN yet</span>}{d.record?.ewbNo && <span className="block">EWB {d.record.ewbNo}{d.record.ewbValidTill ? ` · till ${fmt(d.record.ewbValidTill)}` : ""}</span>}</td>
                  <td className="py-2.5 pr-3 text-right">{meta.me.write && <Button size="sm" onClick={() => setEditing(d)}>Record</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RecordDialog doc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecordDialog({ doc, onClose }: { doc: EDocRow; onClose: () => void }) {
  const { orgId } = useAcc();
  const toast = useToast();
  const r = doc.record;
  const t = (r?.transport ?? {}) as Record<string, string | number | undefined>;
  const [f, setF] = useState({ irn: r?.irn ?? "", ackNo: r?.ackNo ?? "", ackDate: r?.ackDate ?? "", ewbNo: r?.ewbNo ?? "", ewbDate: r?.ewbDate ?? "", ewbValidTill: r?.ewbValidTill ?? "", mode: String(t.mode ?? "1"), vehicleNo: String(t.vehicleNo ?? ""), distanceKm: String(t.distanceKm ?? ""), transporterId: String(t.transporterId ?? ""), transporterName: String(t.transporterName ?? ""), transportDocNo: String(t.transportDocNo ?? ""), transportDocDate: String(t.transportDocDate ?? "") });
  const body = { irn: f.irn.trim(), ackNo: f.ackNo, ackDate: f.ackDate || null, ewbNo: f.ewbNo.trim(), ewbDate: f.ewbDate || null, ewbValidTill: f.ewbValidTill || null, transport: { mode: f.mode, vehicleNo: f.vehicleNo, distanceKm: Number(f.distanceKm) || 0, transporterId: f.transporterId, transporterName: f.transporterName, transportDocNo: f.transportDocNo, transportDocDate: f.transportDocDate } };
  const save = useAccAction(() => ({ path: `einvoice/${doc.id}`, method: "PUT", body }), { success: "Saved", onDone: onClose });
  const [busy, setBusy] = useState(false);
  const eway = async () => {
    setBusy(true);
    try {
      await api(accApi(orgId, `einvoice/${doc.id}`), { method: "PUT", body });
      const res = await fetch(accApi(orgId, `einvoice/${doc.id}/eway`));
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Couldn't make the file");
      await download(res, `eway-bill-${doc.number}.json`);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Dialog open onClose={onClose} size="lg" title={`${doc.number} · ${doc.client}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="IRN" className="sm:col-span-3" hint="64 characters, from the e-invoice portal">{(a) => <Input {...a} value={f.irn} onChange={(e) => set({ irn: e.target.value })} maxLength={64} className="font-mono" />}</Field>
          <Field label="Ack no.">{(a) => <Input {...a} value={f.ackNo} onChange={(e) => set({ ackNo: e.target.value })} maxLength={20} />}</Field>
          <Field label="Ack date">{(a) => <Input {...a} type="date" value={f.ackDate} onChange={(e) => set({ ackDate: e.target.value })} />}</Field>
        </div>
        {doc.goods && doc.type === "invoice" && (
          <div className="grid gap-4 rounded-[14px] border border-border p-4 sm:grid-cols-3">
            <p className="text-[13px] font-semibold sm:col-span-3">E-way bill</p>
            <Field label="Transport">
              {(a) => (
                <Select {...a} value={f.mode} onChange={(e) => set({ mode: e.target.value })}>
                  <option value="1">Road</option>
                  <option value="2">Rail</option>
                  <option value="3">Air</option>
                  <option value="4">Ship</option>
                </Select>
              )}
            </Field>
            <Field label="Vehicle no.">{(a) => <Input {...a} value={f.vehicleNo} onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })} maxLength={15} placeholder="KA01AB1234" />}</Field>
            <Field label="Distance (km)">{(a) => <Input {...a} inputMode="numeric" value={f.distanceKm} onChange={(e) => set({ distanceKm: e.target.value.replace(/\D/g, "") })} />}</Field>
            <Field label="Transporter ID">{(a) => <Input {...a} value={f.transporterId} onChange={(e) => set({ transporterId: e.target.value.toUpperCase() })} maxLength={15} />}</Field>
            <Field label="Transporter">{(a) => <Input {...a} value={f.transporterName} onChange={(e) => set({ transporterName: e.target.value })} maxLength={100} />}</Field>
            <Field label="LR / RR no.">{(a) => <Input {...a} value={f.transportDocNo} onChange={(e) => set({ transportDocNo: e.target.value })} maxLength={15} />}</Field>
            <div className="sm:col-span-3"><Button size="sm" icon={<Download className="size-3.5" />} loading={busy} onClick={eway}>E-way bill JSON</Button></div>
            <Field label="EWB no." hint="12 digits, once generated">{(a) => <Input {...a} inputMode="numeric" value={f.ewbNo} onChange={(e) => set({ ewbNo: e.target.value.replace(/\D/g, "") })} maxLength={12} />}</Field>
            <Field label="Generated on">{(a) => <Input {...a} type="date" value={f.ewbDate} onChange={(e) => set({ ewbDate: e.target.value })} />}</Field>
            <Field label="Valid till">{(a) => <Input {...a} type="date" value={f.ewbValidTill} onChange={(e) => set({ ewbValidTill: e.target.value })} />}</Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
