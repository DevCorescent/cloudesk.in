"use client";

// Procurement screens: requisitions, RFQs (quotes compared side by side and
// awarded), returns to suppliers, purchase control (3-way match, supplier
// performance, budgets), and supplier onboarding and agreed rates.
import { ArrowLeft, Plus, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalPanel } from "@/components/approvals/card";
import { ExportMenu } from "@/components/import/buttons";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, cx, FormLines } from "@/components/ui/primitives";
import { MATCH_LABEL, SUPPLIER_CHECKS, type MatchStatus } from "@/lib/inventory/model";
import { Empty, Section, fmt, fmtQty, fromPaise, inr, short, supName, toPaise, todayIst, useInv, useInvAction, useInvQuery, whName, type Item } from "./shared";

const ITEMS = "items?filter=all";

// ── Requisitions ────────────────────────────────────────────────────────────

type Req = { id: string; number: string; warehouseId: string; neededBy: string | null; lines: { itemId: string; qty: number; estRate: number; note: string }[]; reason: string; status: string; total: number; poIds: string[]; rfqId: string | null; requestedByName: string; createdAt: string };
const REQ_TONE: Record<string, string> = { draft: "bg-surface-2 text-muted", pending_approval: "bg-warning-soft text-warning", approved: "bg-accent-soft text-accent", rejected: "bg-danger-soft text-danger", ordered: "bg-success-soft text-success", cancelled: "bg-surface-2 text-muted" };
const REQ_LABEL: Record<string, string> = { draft: "Draft", pending_approval: "Waiting for approval", approved: "Approved", rejected: "Sent back", ordered: "Ordered", cancelled: "Cancelled" };
const Pill = ({ s, tone = REQ_TONE, label = REQ_LABEL }: { s: string; tone?: Record<string, string>; label?: Record<string, string> }) => <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", tone[s] ?? "bg-surface-2 text-muted")}>{label[s] ?? s}</span>;

export function RequisitionsView() {
  const { meta, go } = useInv();
  const q = useInvQuery<{ requisitions: Req[] }>("requisitions");
  const items = useInvQuery<{ items: Item[] }>(ITEMS);
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState<Req | null>(null);
  const submit = useInvAction<string, { status: string }>((id) => ({ path: `requisitions/${id}/submit` }), { success: (r) => (r.status === "approved" ? "Approved — no approval rule applies" : "Sent for approval") });
  const cancel = useInvAction<string>((id) => ({ path: `requisitions/${id}/cancel` }), { success: "Cancelled" });
  const name = (id: string) => items.data?.items.find((i) => i.id === id)?.name ?? "Item";
  return (
    <div>
      <PageHeader title="Requisitions" description="What people need bought. Once approved, turn it into purchase orders or ask suppliers for quotes." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Requisition</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.requisitions.length ? <EmptyState title="No requisitions" description="Anyone on the team can ask for something to be bought; it goes through your approval rules for requisitions." /> : (
        <ul className="grid gap-3">
          {q.data.requisitions.map((r) => (
            <li key={r.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span>
                  <b className="text-[14.5px] font-semibold">{r.number}</b> <span className="text-[12.5px] text-muted">· {r.requestedByName} · {whName(meta, r.warehouseId)}{r.neededBy ? ` · needed by ${fmt(r.neededBy)}` : ""}</span>
                  <span className="block text-[13px]">{r.lines.map((l) => `${fmtQty(l.qty)} ${name(l.itemId)}`).join(", ")}</span>
                  {r.reason && <span className="block text-[12.5px] text-muted">{r.reason}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] tabular-nums">~{inr(r.total)}</span>
                  <Pill s={r.status} />
                  {meta.me.write && ["draft", "rejected"].includes(r.status) && <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => submit.mutate(r.id)}>Send for approval</Button>}
                  {meta.me.write && r.status === "approved" && <Button size="sm" variant="primary" onClick={() => setOrdering(r)}>Order</Button>}
                  {meta.me.write && r.status === "approved" && meta.parts.procurement && <Button size="sm" onClick={() => go(`rfqs?from=${r.id}`)}>Ask for quotes</Button>}
                  {meta.me.write && !["ordered", "cancelled"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</Button>}
                  {r.poIds.length > 0 && r.poIds.map((id, i) => <Link key={id} href={`/inventory/orders/${id}`} className="text-[12.5px] underline">PO {i + 1}</Link>)}
                </span>
              </div>
              {r.status === "pending_approval" && <div className="mt-3"><ApprovalPanel kind="inv.requisition" refId={r.id} /></div>}
            </li>
          ))}
        </ul>
      )}
      {adding && <ReqDialog items={items.data?.items ?? []} onClose={() => setAdding(false)} />}
      {ordering && <OrderReqDialog req={ordering} items={items.data?.items ?? []} onClose={() => setOrdering(null)} />}
    </div>
  );
}

function ReqDialog({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({ warehouseId: meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "", neededBy: "", reason: "", lines: [] as { itemId: string; qty: string; note: string }[] });
  const save = useInvAction(() => ({ path: "requisitions", body: { warehouseId: f.warehouseId, neededBy: f.neededBy || null, reason: f.reason, lines: f.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), note: l.note })) } }), { success: "Requisition saved — send it for approval", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title="New requisition" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.lines.some((l) => Number(l.qty) > 0)} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="For">{(a) => <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{meta.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
          <Field label="Needed by">{(a) => <Input {...a} type="date" value={f.neededBy} min={todayIst()} onChange={(e) => setF({ ...f, neededBy: e.target.value })} />}</Field>
          <Field label="Why">{(a) => <Input {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} />}</Field>
        </div>
        {f.lines.map((l, i) => (
          <div key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_32px] items-center gap-2 text-[13px]">
            <span className="font-medium">{items.find((x) => x.id === l.itemId)?.name}</span>
            <Input aria-label={`Quantity of ${items.find((x) => x.id === l.itemId)?.name}`} inputMode="decimal" value={l.qty} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
            <Input aria-label="Note" value={l.note} placeholder="Note" onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
            <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Select aria-label="Add an item" value="" onChange={(e) => e.target.value && setF({ ...f, lines: [...f.lines, { itemId: e.target.value, qty: "1", note: "" }] })}>
          <option value="">+ Add an item…</option>
          {items.filter((i) => !f.lines.some((l) => l.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
      </div>
    </Dialog>
  );
}

function OrderReqDialog({ req, items, onClose }: { req: Req; items: Item[]; onClose: () => void }) {
  const { meta, go } = useInv();
  const [picks, setPicks] = useState<Record<string, string>>(Object.fromEntries(req.lines.map((l) => [l.itemId, items.find((i) => i.id === l.itemId)?.supplierId ?? ""])));
  const order = useInvAction<void, { poIds: string[] }>(() => ({ path: `requisitions/${req.id}/order`, body: { suppliers: picks } }), { success: (r) => `${r.poIds.length} draft purchase order${r.poIds.length === 1 ? "" : "s"} made`, onDone: (r) => (onClose(), r.poIds.length === 1 && go(`orders/${r.poIds[0]}`)) });
  return (
    <Dialog open onClose={onClose} title={`Order ${req.number}`} description="One draft purchase order per supplier." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={order.isPending} disabled={req.lines.some((l) => !picks[l.itemId])} onClick={() => order.mutate()}>Make orders</Button></>}>
      <div className="grid gap-3">
        {req.lines.map((l) => (
          <Field key={l.itemId} label={`${items.find((i) => i.id === l.itemId)?.name ?? "Item"} · ${fmtQty(l.qty)}`}>
            {(a) => <Select {...a} value={picks[l.itemId]} onChange={(e) => setPicks({ ...picks, [l.itemId]: e.target.value })}><option value="">Pick a supplier…</option>{meta.suppliers.filter((s) => s.active && s.approval !== "blocked").map((s) => <option key={s.id} value={s.id}>{s.name}{s.approval === "pending" ? " (not approved)" : ""}</option>)}</Select>}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

// ── RFQs ────────────────────────────────────────────────────────────────────

type Rfq = { id: string; number: string; title: string; warehouseId: string; dueDate: string | null; lines: { itemId: string; qty: number }[]; supplierIds: string[]; status: string; award: { itemId: string; supplierId: string }[]; poIds: string[]; sentAt: string | null; notes: string; quotes?: number };
const RFQ_TONE: Record<string, string> = { open: "bg-accent-soft text-accent", awarded: "bg-success-soft text-success", cancelled: "bg-surface-2 text-muted" };
const RFQ_LABEL: Record<string, string> = { open: "Open", awarded: "Awarded", cancelled: "Cancelled" };

export function RfqsView({ fromReq }: { fromReq?: string | null }) {
  const { meta, go } = useInv();
  const q = useInvQuery<{ rfqs: Rfq[] }>("rfqs");
  const reqs = useInvQuery<{ requisitions: Req[] }>(fromReq ? "requisitions?status=approved" : null);
  const [adding, setAdding] = useState(!!fromReq);
  const req = reqs.data?.requisitions.find((r) => r.id === fromReq);
  return (
    <div>
      <PageHeader title="Requests for quotation" description="Ask several suppliers for prices, compare them side by side, and award each item to the best." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>RFQ</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.rfqs.length ? <Empty>No RFQs yet.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.rfqs.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => go(`rfqs/${r.id}`)} className="w-full rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2">
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{r.number}{r.title ? ` · ${r.title}` : ""}</b><Pill s={r.status} tone={RFQ_TONE} label={RFQ_LABEL} /></span>
                <span className="mt-1 block text-[12.5px] text-muted">{r.lines.length} item{r.lines.length === 1 ? "" : "s"} · {r.quotes ?? 0} of {r.supplierIds.length} quoted{r.dueDate ? ` · by ${fmt(r.dueDate)}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (!fromReq || reqs.data) && <RfqDialog req={req} onClose={() => (setAdding(false), fromReq && go("rfqs"))} />}
    </div>
  );
}

function RfqDialog({ req, onClose }: { req?: Req; onClose: () => void }) {
  const { meta, go } = useInv();
  const items = useInvQuery<{ items: Item[] }>(ITEMS);
  const [f, setF] = useState({ title: req?.reason ?? "", warehouseId: req?.warehouseId ?? meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "", dueDate: "", supplierIds: [] as string[], lines: (req?.lines ?? []).map((l) => ({ itemId: l.itemId, qty: String(l.qty) })) });
  const save = useInvAction<void, { rfq: { id: string } }>(() => ({ path: "rfqs", body: { title: f.title, warehouseId: f.warehouseId, dueDate: f.dueDate || null, supplierIds: f.supplierIds, requisitionId: req?.id ?? null, lines: f.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) } }), { success: "RFQ made", onDone: (r) => (onClose(), go(`rfqs/${r.rfq.id}`)) });
  const list = items.data?.items ?? [];
  return (
    <Dialog open onClose={onClose} size="lg" title={req ? `Quotes for ${req.number}` : "New RFQ"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.supplierIds.length || !f.lines.length} onClick={() => save.mutate()}>Make RFQ</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} />}</Field>
          <Field label="Deliver to">{(a) => <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{meta.warehouses.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
          <Field label="Quotes by">{(a) => <Input {...a} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
        </div>
        {f.lines.map((l, i) => (
          <div key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2 text-[13px]">
            <span className="font-medium">{list.find((x) => x.id === l.itemId)?.name}</span>
            <Input aria-label={`Quantity of ${list.find((x) => x.id === l.itemId)?.name}`} inputMode="decimal" value={l.qty} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
            <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {!req && (
          <Select aria-label="Add an item" value="" onChange={(e) => e.target.value && setF({ ...f, lines: [...f.lines, { itemId: e.target.value, qty: "1" }] })}>
            <option value="">+ Add an item…</option>
            {list.filter((i) => !f.lines.some((l) => l.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Ask</p>
          <div className="flex flex-wrap gap-2">
            {meta.suppliers.filter((s) => s.active && s.approval !== "blocked").map((s) => {
              const on = f.supplierIds.includes(s.id);
              return <button key={s.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, supplierIds: on ? f.supplierIds.filter((x) => x !== s.id) : [...f.supplierIds, s.id] })} className={cx("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>{s.name}</button>;
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

type RfqDetail = { rfq: Rfq; quotes: { supplierId: string; lines: { itemId: string; rate: number; gstRate: number; leadDays: number }[]; validTill: string | null; terms: string }[]; suppliers: { id: string; name: string; email: string }[]; items: { id: string; name: string; unit: string }[]; comparison: { itemId: string; qty: number; offers: { supplierId: string; rate: number; gstRate: number; leadDays: number; amount: number }[]; best: string | null; saving: number }[] };

export function RfqPage({ id }: { id: string }) {
  const { meta, go } = useInv();
  const q = useInvQuery<RfqDetail>(`rfqs/${id}`);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [award, setAward] = useState<Record<string, string>>({});
  const send = useInvAction<void, { emailed: number; of: number; reason: string | null }>(() => ({ path: `rfqs/${id}/send` }), { success: (r) => (r.emailed ? `Emailed ${r.emailed} of ${r.of} suppliers` : r.reason ?? "No supplier has an email address") });
  const doAward = useInvAction<{ award: { itemId: string; supplierId: string }[] }, { poIds: string[] }>((b) => ({ path: `rfqs/${id}/award`, body: { ...b, orderDate: todayIst() } }), { success: (r) => `${r.poIds.length} draft purchase order${r.poIds.length === 1 ? "" : "s"} made`, onDone: () => go("orders") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { rfq, quotes, suppliers, items, comparison } = q.data;
  const sname = (s: string) => suppliers.find((x) => x.id === s)?.name ?? supName(meta, s);
  const picked = comparison.map((c) => ({ itemId: c.itemId, supplierId: award[c.itemId] ?? c.best ?? "" })).filter((x) => x.supplierId);
  return (
    <div>
      <Link href="/inventory/rfqs" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> RFQs</Link>
      <PageHeader title={`${rfq.number}${rfq.title ? ` · ${rfq.title}` : ""}`} description={`To ${whName(meta, rfq.warehouseId)}${rfq.dueDate ? ` · quotes by ${fmt(rfq.dueDate)}` : ""}${rfq.sentAt ? " · sent" : ""}`} actions={meta.me.write && rfq.status === "open" && <div className="flex gap-2"><Button size="sm" icon={<Send className="size-3.5" />} loading={send.isPending} onClick={() => send.mutate()}>Email suppliers</Button><Button size="sm" variant="primary" disabled={!picked.length} loading={doAward.isPending} onClick={() => doAward.mutate({ award: picked })}>Award and order</Button></div>} />
      <Section title="Comparison">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-1.5 font-medium">Item</th>
                {rfq.supplierIds.map((s) => <th key={s} className="py-1.5 text-right font-medium">{sname(s)}{meta.me.write && rfq.status === "open" && <button type="button" aria-label={`Quote from ${sname(s)}`} className="ml-1.5 text-[11.5px] font-medium underline" onClick={() => setQuoting(s)}>{quotes.some((x) => x.supplierId === s) ? "edit" : "enter quote"}</button>}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparison.map((c) => {
                const it = items.find((i) => i.id === c.itemId);
                const pick = award[c.itemId] ?? c.best;
                return (
                  <tr key={c.itemId}>
                    <td className="py-2">{it?.name}<span className="block text-[12px] text-muted">{fmtQty(c.qty, it?.unit)}{c.saving ? ` · best saves ${short(c.saving)}` : ""}</span></td>
                    {rfq.supplierIds.map((s) => {
                      const o = c.offers.find((x) => x.supplierId === s);
                      return (
                        <td key={s} className={cx("py-2 text-right tabular-nums", o && pick === s && "bg-success-soft/50")}>
                          {o ? (
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <span>{inr(o.rate)}<span className="block text-[11.5px] text-muted">{o.gstRate}% GST · {o.leadDays} days</span></span>
                              {rfq.status === "open" && <input type="radio" name={`award-${c.itemId}`} aria-label={`Award ${it?.name} to ${sname(s)}`} checked={pick === s} onChange={() => setAward({ ...award, [c.itemId]: s })} />}
                            </label>
                          ) : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rfq.status === "awarded" && <p className="mt-3 text-[12.5px] text-muted">Awarded: {rfq.poIds.map((p, i) => <Link key={p} href={`/inventory/orders/${p}`} className="mr-2 underline">PO {i + 1}</Link>)}</p>}
      </Section>
      {quoting && <QuoteDialog d={q.data} supplierId={quoting} onClose={() => setQuoting(null)} />}
    </div>
  );
}

function QuoteDialog({ d, supplierId, onClose }: { d: RfqDetail; supplierId: string; onClose: () => void }) {
  const cur = d.quotes.find((x) => x.supplierId === supplierId);
  const [rows, setRows] = useState(d.rfq.lines.map((l) => {
    const x = cur?.lines.find((y) => y.itemId === l.itemId);
    return { itemId: l.itemId, rate: fromPaise(x?.rate), gstRate: String(x?.gstRate ?? 18), leadDays: String(x?.leadDays ?? 7) };
  }));
  const save = useInvAction(() => ({ path: `rfqs/${d.rfq.id}/quotes`, body: { supplierId, lines: rows.filter((r) => toPaise(r.rate) > 0).map((r) => ({ itemId: r.itemId, rate: toPaise(r.rate), gstRate: Number(r.gstRate) || 0, leadDays: Number(r.leadDays) || 0 })) } }), { success: "Quote saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Quote from ${d.suppliers.find((s) => s.id === supplierId)?.name}`} description="Leave the rate empty for items they didn't quote." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!rows.some((r) => toPaise(r.rate) > 0)} onClick={() => save.mutate(undefined)}>Save quote</Button></>}>
      <FormLines className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-muted"><tr><th className="py-1 font-medium">Item</th><th className="w-28 py-1 font-medium">Rate (₹)</th><th className="w-20 py-1 font-medium">GST %</th><th className="w-24 py-1 font-medium">Days</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const it = d.items.find((x) => x.id === r.itemId);
            const set = (p: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <tr key={r.itemId}>
                <td className="py-1 pr-2">{it?.name}</td>
                <td className="py-1 pr-2"><Input aria-label={`Rate for ${it?.name}`} inputMode="decimal" value={r.rate} onChange={(e) => set({ rate: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={`GST for ${it?.name}`} inputMode="decimal" value={r.gstRate} onChange={(e) => set({ gstRate: e.target.value })} /></td>
                <td className="py-1"><Input aria-label={`Lead days for ${it?.name}`} inputMode="numeric" value={r.leadDays} onChange={(e) => set({ leadDays: e.target.value })} /></td>
              </tr>
            );
          })}
        </tbody>
      </FormLines>
    </Dialog>
  );
}

// ── Returns to suppliers ────────────────────────────────────────────────────

type SupplierReturn = { id: string; number: string; supplierId: string; supplier: string; receiptId: string | null; date: string; lines: { itemId: string; qty: number; rate: number; reason: string }[]; total: number; debitNoteId: string | null };

export function SupplierReturnsView() {
  const { meta } = useInv();
  const q = useInvQuery<{ returns: SupplierReturn[] }>("supplier-returns");
  const items = useInvQuery<{ items: Item[] }>(ITEMS);
  const [adding, setAdding] = useState(false);
  const name = (id: string) => items.data?.items.find((i) => i.id === id)?.name ?? "Item";
  return (
    <div>
      <PageHeader title="Returns to suppliers" description="Goods sent back — rejected, damaged or extra. Stock goes out, and a debit note comes off the bill in Accounts." actions={<div className="flex gap-2"><ExportMenu name="supplier-returns" rows={q.data?.returns.map((r) => ({ ...r, items: r.lines.map((l) => `${fmtQty(l.qty)} ${name(l.itemId)}`).join("; "), debitNote: r.debitNoteId ? "Yes" : "No" }))} columns={[{ key: "number", label: "Return" }, { key: "date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "items", label: "Items" }, { key: "total", label: "Total", money: true }, { key: "debitNote", label: "Debit note" }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Return goods</Button>}</div>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.returns.length ? <Empty>Nothing sent back yet.</Empty> : (
        <ul className="grid gap-2">
          {q.data.returns.map((r) => (
            <li key={r.id} className="rounded-[16px] border border-border bg-surface px-4 py-3 text-[13px]">
              <span className="flex justify-between gap-3"><b className="font-medium">{r.number} · {r.supplier}</b><span className="tabular-nums">{inr(r.total)}</span></span>
              <span className="block text-[12px] text-muted">{fmt(r.date)} · {r.lines.map((l) => `${fmtQty(l.qty)} ${name(l.itemId)}${l.reason ? ` (${l.reason})` : ""}`).join(", ")}{r.debitNoteId ? " · debit note made" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {adding && <ReturnDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

type Receipt = { id: string; number: string; date: string; supplierId: string | null; warehouseId: string; lines: { itemId: string; qty: number; rate: number; gstRate: number; batch: string }[] };

function ReturnDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useInv();
  const recs = useInvQuery<{ receipts: (Receipt & { supplier: string | null })[] }>("receipts");
  const items = useInvQuery<{ items: Item[] }>(ITEMS);
  const [receiptId, setReceiptId] = useState("");
  const [f, setF] = useState({ date: todayIst(), debitNote: true, qty: {} as Record<string, string>, reason: "" });
  const rc = recs.data?.receipts.find((r) => r.id === receiptId);
  const lines = (rc?.lines ?? []).map((l, i) => ({ ...l, key: `${l.itemId}-${i}`, back: Number(f.qty[`${l.itemId}-${i}`]) || 0 })).filter((l) => l.back > 0);
  const save = useInvAction<void, { debitNote: { number: string } | null; note: string | null }>(() => ({ path: "supplier-returns", body: { supplierId: rc?.supplierId, receiptId, warehouseId: rc?.warehouseId, date: f.date, debitNote: f.debitNote, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.back, rate: l.rate, gstRate: l.gstRate, batch: l.batch, reason: f.reason })) } }), { success: (r) => (r.debitNote ? `Returned — debit note ${r.debitNote.number} made` : r.note ? `Returned. ${r.note}` : "Returned"), onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title="Return goods to a supplier" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!rc?.supplierId || !lines.length} onClick={() => save.mutate()}>Return</Button></>}>
      <div className="grid gap-4">
        <Field label="From goods received">{(a) => <Select {...a} value={receiptId} onChange={(e) => setReceiptId(e.target.value)}><option value="">Choose…</option>{(recs.data?.receipts ?? []).filter((r) => r.supplierId).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.supplier} · {fmt(r.date)}</option>)}</Select>}</Field>
        {rc && rc.lines.map((l, i) => (
          <div key={`${l.itemId}-${i}`} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 text-[13px]">
            <span>{items.data?.items.find((x) => x.id === l.itemId)?.name}<span className="block text-[12px] text-muted">{fmtQty(l.qty)} received at {inr(l.rate)}{l.batch ? ` · batch ${l.batch}` : ""}</span></span>
            <Input aria-label={`Return of ${items.data?.items.find((x) => x.id === l.itemId)?.name}`} inputMode="decimal" placeholder="0" value={f.qty[`${l.itemId}-${i}`] ?? ""} onChange={(e) => setF({ ...f, qty: { ...f.qty, [`${l.itemId}-${i}`]: e.target.value } })} />
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Why">{(a) => <Input {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} placeholder="Damaged in transit" />}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.debitNote} onChange={(v) => setF({ ...f, debitNote: v })} label="Debit note" /> Make a debit note against the bill in Accounts</label>
        {meta.warehouses.length > 1 && rc && <p className="text-[12px] text-muted">Taken out of {whName(meta, rc.warehouseId)}, where they were received.</p>}
      </div>
    </Dialog>
  );
}

// ── Purchase control ────────────────────────────────────────────────────────

type Match = { id: string; number: string; supplier: string; orderDate: string; poStatus: string; status: MatchStatus; issues: { kind: string; detail: string }[]; orderedValue: number; receivedValue: number; billedValue: number };
type Perf = { supplierId: string; name: string; purchased: number; returned: number; deliveries: number; onTimePct: number | null; rejectedPct: number | null; avgLeadDays: number | null };
type Budgets = { month: string; budgets: { id: string; category: string; amount: number; used: number }[]; unbudgeted: { category: string; amount: number }[] };
const MATCH_TONE: Record<string, string> = { matched: "text-success", to_receive: "text-muted", to_bill: "text-muted", price: "text-warning", quantity: "text-warning", bill_differs: "text-danger" };

export function ControlView({ tab: initial }: { tab?: string }) {
  const { meta, go } = useInv();
  const tab = initial === "suppliers" ? "suppliers" : initial === "budgets" ? "budgets" : "match";
  const match = useInvQuery<{ orders: Match[] }>(tab === "match" ? "match" : null);
  const perf = useInvQuery<{ suppliers: Perf[] }>(tab === "suppliers" ? "performance" : null);
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const budgets = useInvQuery<Budgets>(tab === "budgets" ? `purchase-budgets?month=${month}` : null, { keepPrevious: true });
  const [budgeting, setBudgeting] = useState<{ category: string; amount: number } | null>(null);
  return (
    <div>
      <PageHeader title="Purchase control" description="Orders matched against what arrived and what was billed, how suppliers perform, and spending against budgets." />
      <Tabs value={tab} onChange={(v) => go(`control/${v}`)} className="mb-5" tabs={[{ value: "match", label: "3-way match" }, { value: "suppliers", label: "Supplier performance" }, { value: "budgets", label: "Budgets" }]} />
      {tab === "match" && (!match.data ? <Skeleton className="h-60 rounded-[20px]" /> : !match.data.orders.length ? <Empty>No sent purchase orders yet.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="border-b border-border text-right text-[12px] text-muted"><tr><th className="px-4 py-2.5 text-left font-medium">Order</th><th className="px-4 py-2.5 font-medium">Ordered</th><th className="px-4 py-2.5 font-medium">Received</th><th className="px-4 py-2.5 font-medium">Billed</th><th className="px-4 py-2.5 text-left font-medium">Match</th></tr></thead>
            <tbody className="divide-y divide-border text-right tabular-nums">
              {match.data.orders.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-4 py-2.5 text-left"><Link href={`/inventory/orders/${o.id}`} className="font-medium hover:underline">{o.number}</Link><span className="block text-[12px] text-muted">{o.supplier} · {fmt(o.orderDate)}</span></td>
                  <td className="px-4 py-2.5">{inr(o.orderedValue)}</td>
                  <td className="px-4 py-2.5">{inr(o.receivedValue)}</td>
                  <td className="px-4 py-2.5">{inr(o.billedValue)}</td>
                  <td className={cx("px-4 py-2.5 text-left font-medium", MATCH_TONE[o.status])}>{MATCH_LABEL[o.status]}{o.issues.map((x) => <span key={x.detail} className="block text-[12px] font-normal text-muted">{x.detail}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[12px] text-muted">Values are before GST. Price differences within {meta.settings.matchTolerancePct}% count as a match.</p>
        </div>
      ))}
      {tab === "suppliers" && (!perf.data ? <Skeleton className="h-60 rounded-[20px]" /> : !perf.data.suppliers.length ? <Empty>Nothing received in the last year.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="border-b border-border text-right text-[12px] text-muted"><tr><th className="px-4 py-2.5 text-left font-medium">Supplier</th><th className="px-4 py-2.5 font-medium">Bought</th><th className="px-4 py-2.5 font-medium">Deliveries</th><th className="px-4 py-2.5 font-medium">On time</th><th className="px-4 py-2.5 font-medium">Rejected</th><th className="px-4 py-2.5 font-medium">Avg days</th><th className="px-4 py-2.5 font-medium">Returned</th></tr></thead>
            <tbody className="divide-y divide-border text-right tabular-nums">
              {perf.data.suppliers.map((p) => (
                <tr key={p.supplierId}>
                  <td className="px-4 py-2.5 text-left font-medium">{p.name}</td>
                  <td className="px-4 py-2.5">{short(p.purchased)}</td>
                  <td className="px-4 py-2.5">{p.deliveries}</td>
                  <td className={cx("px-4 py-2.5", p.onTimePct !== null && p.onTimePct < 80 && "text-warning")}>{p.onTimePct === null ? "—" : `${p.onTimePct}%`}</td>
                  <td className={cx("px-4 py-2.5", p.rejectedPct !== null && p.rejectedPct > 2 && "text-danger")}>{p.rejectedPct === null ? "—" : `${p.rejectedPct}%`}</td>
                  <td className="px-4 py-2.5">{p.avgLeadDays ?? "—"}</td>
                  <td className="px-4 py-2.5">{p.returned ? short(p.returned) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[12px] text-muted">The last 12 months. On time means received by the order&apos;s expected date.</p>
        </div>
      ))}
      {tab === "budgets" && (
        <div className="grid gap-4">
          <div className="flex items-end gap-3"><Field label="Month">{(a) => <Input {...a} type="month" className="!w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>{meta.me.manage && <Button size="sm" onClick={() => setBudgeting({ category: meta.categories[0] ?? "", amount: 0 })}>Set a budget</Button>}</div>
          {!budgets.data ? <Skeleton className="h-40 rounded-[20px]" /> : (
            <Section title="By category">
              {!budgets.data.budgets.length && !budgets.data.unbudgeted.length ? <Empty>No purchases or budgets this month.</Empty> : (
                <ul className="divide-y divide-border text-[13px]">
                  {budgets.data.budgets.map((b) => (
                    <li key={b.id} className="py-2.5">
                      <span className="flex justify-between gap-3"><b className="font-medium">{b.category}</b><span className="tabular-nums">{inr(b.used)} of {inr(b.amount)}{meta.me.manage && <button type="button" className="ml-2 text-[12px] underline" onClick={() => setBudgeting({ category: b.category, amount: b.amount })}>change</button>}</span></span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={cx("block h-full rounded-full", b.used > b.amount ? "bg-danger" : b.used > b.amount * 0.9 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, (b.used / Math.max(1, b.amount)) * 100)}%` }} /></span>
                    </li>
                  ))}
                  {budgets.data.unbudgeted.map((u) => <li key={u.category} className="flex justify-between py-2.5"><span>{u.category || "Uncategorised"} <span className="text-muted">· no budget</span></span><span className="tabular-nums">{inr(u.amount)}</span></li>)}
                </ul>
              )}
              <p className="mt-2 text-[12px] text-muted">Purchase orders raised this month, before GST, by item category. Over budget: {meta.settings.budgetCheck === "block" ? "new orders are refused" : meta.settings.budgetCheck === "warn" ? "orders show a warning" : "not checked"}.</p>
            </Section>
          )}
        </div>
      )}
      {budgeting && <BudgetDialog init={budgeting} month={month} onClose={() => setBudgeting(null)} />}
    </div>
  );
}

function BudgetDialog({ init, month, onClose }: { init: { category: string; amount: number }; month: string; onClose: () => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({ category: init.category, amount: fromPaise(init.amount), month });
  const save = useInvAction(() => ({ path: "purchase-budgets", body: { ...f, amount: toPaise(f.amount) } }), { success: "Budget saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Purchase budget" description="Empty clears it." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.category} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category">{(a) => <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
        <Field label="Month">{(a) => <Input {...a} type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />}</Field>
        <Field label="Budget (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Supplier onboarding and agreed rates ────────────────────────────────────

export function OnboardingDialog({ supplier, onClose }: { supplier: { id: string; name: string; approval?: string; checklist?: Record<string, boolean> }; onClose: () => void }) {
  const [f, setF] = useState({ approval: supplier.approval ?? "approved", checklist: supplier.checklist ?? {}, note: "" });
  const save = useInvAction(() => ({ path: `suppliers/${supplier.id}/onboarding`, body: f }), { success: "Saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Onboarding · ${supplier.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          {(Object.keys(SUPPLIER_CHECKS) as (keyof typeof SUPPLIER_CHECKS)[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-[13px]"><Switch checked={!!f.checklist[k]} onChange={(v) => setF({ ...f, checklist: { ...f.checklist, [k]: v } })} label={SUPPLIER_CHECKS[k]} /> {SUPPLIER_CHECKS[k]}</label>
          ))}
        </div>
        <Field label="Status">{(a) => <Select {...a} value={f.approval} onChange={(e) => setF({ ...f, approval: e.target.value })}><option value="pending">Waiting for checks</option><option value="approved">Approved</option><option value="blocked">Blocked — no new orders</option></Select>}</Field>
        <Field label="Note">{(a) => <Input {...a} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

type Rate = { id: string; itemId: string; item: string; rate: number; minQty: number; validFrom: string | null; validTo: string | null; reference: string };

export function RatesDialog({ supplier, onClose }: { supplier: { id: string; name: string }; onClose: () => void }) {
  const { meta } = useInv();
  const q = useInvQuery<{ rates: Rate[] }>(`supplier-rates?supplierId=${supplier.id}`);
  const items = useInvQuery<{ items: Item[] }>(ITEMS);
  const [f, setF] = useState({ itemId: "", rate: "", minQty: "", validFrom: todayIst(), validTo: "", reference: "" });
  const add = useInvAction(() => ({ path: "supplier-rates", body: { supplierId: supplier.id, itemId: f.itemId, rate: toPaise(f.rate), minQty: Number(f.minQty) || 0, validFrom: f.validFrom || null, validTo: f.validTo || null, reference: f.reference } }), { success: "Rate saved", onDone: () => setF({ ...f, itemId: "", rate: "", minQty: "" }) });
  const del = useInvAction<string>((id) => ({ path: `supplier-rates/${id}`, method: "DELETE" }), { success: "Removed" });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Agreed rates · ${supplier.name}`} description="Purchase orders above these rates show a warning.">
      <div className="grid gap-4">
        {meta.me.manage && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_90px_140px_140px_auto]">
            <Select aria-label="Item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Item…</option>{(items.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>
            <Input aria-label="Agreed rate (₹)" inputMode="decimal" placeholder="Rate ₹" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            <Input aria-label="From quantity" inputMode="decimal" placeholder="From qty" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} />
            <Input aria-label="Valid from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
            <Input aria-label="Valid to" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
            <Button variant="primary" disabled={!f.itemId || !toPaise(f.rate)} loading={add.isPending} onClick={() => add.mutate(undefined)}>Add</Button>
          </div>
        )}
        {!q.data ? <Skeleton className="h-24 rounded-[14px]" /> : !q.data.rates.length ? <Empty>No agreed rates.</Empty> : (
          <ul className="divide-y divide-border text-[13px]">
            {q.data.rates.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span>{r.item} · <b className="tabular-nums">{inr(r.rate)}</b>{r.minQty ? ` from ${fmtQty(r.minQty)}` : ""}<span className="block text-[12px] text-muted">{r.validFrom ? fmt(r.validFrom) : "…"} – {r.validTo ? fmt(r.validTo) : "…"}{r.reference ? ` · ${r.reference}` : ""}</span></span>{meta.me.manage && <Button size="sm" variant="ghost" aria-label="Remove rate" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(r.id)} />}</li>)}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

