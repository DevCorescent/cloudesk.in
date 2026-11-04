"use client";

// Purchasing screens: purchase orders (list, editor, page, printable copy),
// receiving goods against an order or on their own, and the reorder list that
// drafts orders for you.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { Ban, Check, Mail, PackageCheck, Pencil, Plus, Printer, RefreshCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { GST_RATES, isInterState, purchaseTotals } from "@/lib/inventory/model";
import { Empty, Section, StatusPill, fmt, fmtQty, fromPaise, inr, short, toPaise, todayIst, useInv, useInvAction, useInvQuery, type Item } from "./shared";
import { ApprovalPanel } from "@/components/approvals/card";

type Line = { itemId: string; qty: number; rate: number; gstRate: number; received: number };
type Order = { id: string; number: string; supplierId: string; warehouseId: string; status: string; orderDate: string; expectedDate: string | null; lines: Line[]; subtotal: number; tax: number; total: number; interState: boolean; notes: string; sentAt: string | null; supplierAck?: { at: string; promisedDate: string | null; note: string } | null; dispatches?: { id: string; date: string; reference: string; carrier: string; note: string }[]; supplier?: string; warehouse?: string; late?: boolean };
type OrderDetail = {
  warnings: string[];
  po: Order;
  supplier: { id: string; name: string; contactName: string; email: string; phone: string; gstin: string; state: string; address: string; paymentTermsDays: number };
  warehouse: { id: string; name: string; address: string; state: string };
  items: { id: string; name: string; sku: string; unit: string; hsn: string }[];
  receipts: { id: string; number: string; date: string; supplierInvoice: string; total: number; lines: { itemId: string; qty: number }[] }[];
  split: { igst: number; cgst: number; sgst: number };
  rows: { amount: number; tax: number }[];
  company: string;
  terms: string;
};

export function OrdersView() {
  const { go, meta } = useInv();
  const [tab, setTab] = useState<"open" | "received" | "all">("open");
  const q = useInvQuery<{ orders: Order[] }>(`orders${tab === "all" ? "" : `?status=${tab}`}`, { keepPrevious: true });
  return (
    <div>
      <PageHeader title="Purchase orders" description="What you've asked suppliers for, and what's arrived." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("orders/new")}>New purchase order</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "open", label: "Open" }, { value: "received", label: "Received" }, { value: "all", label: "All" }]} />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.orders.length ? (
        <EmptyState icon={<PackageCheck />} title={tab === "open" ? "No open orders" : "Nothing here yet"} description="Raise a purchase order to a supplier, or let Reorder draft them for what's running low." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => go("orders/new")}>New purchase order</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Deliver to</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.orders.map((o) => (
                <tr key={o.id} onClick={() => go(`orders/${o.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <b className="font-semibold">{o.number}</b>
                    <span className="block text-[12px] text-muted">{fmt(o.orderDate)}</span>
                  </td>
                  <td className="px-4 py-2.5">{o.supplier}</td>
                  <td className="px-4 py-2.5 text-muted">{o.warehouse}</td>
                  <td className="px-4 py-2.5 text-muted">{o.expectedDate ? fmt(o.expectedDate, { day: "numeric", month: "short" }) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(o.total)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex gap-1.5">
                      <StatusPill status={o.status} />
                      {o.late && <StatusPill status="late" />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Draft = { itemId: string; qty: string; rate: string; gstRate: number; received: number };

export function OrderEditor({ id }: { id?: string }) {
  const { meta, go } = useInv();
  const params = useSearchParams();
  const items = useInvQuery<{ items: Item[] }>("items");
  const existing = useInvQuery<OrderDetail>(id ? `orders/${id}` : null);
  const [f, setF] = useState<{ supplierId: string; warehouseId: string; orderDate: string; expectedDate: string; notes: string; lines: Draft[] } | null>(id ? null : { supplierId: "", warehouseId: meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "", orderDate: todayIst(), expectedDate: "", notes: "", lines: [] });
  // Fill from the order being edited, or from "Order more" on an item.
  useEffect(() => {
    if (id && existing.data && !f) {
      const p = existing.data.po;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from data that arrives after mount
      setF({ supplierId: p.supplierId, warehouseId: p.warehouseId, orderDate: String(p.orderDate), expectedDate: p.expectedDate ? String(p.expectedDate) : "", notes: p.notes, lines: p.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), rate: fromPaise(l.rate), gstRate: l.gstRate, received: l.received })) });
    }
  }, [id, existing.data, f]);
  const preset = params.get("item");
  useEffect(() => {
    if (!id && preset && items.data && f && !f.lines.length) {
      const it = items.data.items.find((i) => i.id === preset);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill once the item list has loaded
      if (it) setF({ ...f, supplierId: f.supplierId || it.supplierId || "", lines: [{ itemId: it.id, qty: String(it.reorderQty || 1), rate: fromPaise(it.avgCost), gstRate: it.gstRate, received: 0 }] });
    }
  }, [id, preset, items.data, f]);
  const save = useInvAction<void, { order: { id: string } }>(
    () => ({ path: id ? `orders/${id}` : "orders", method: id ? "PUT" : "POST", body: { supplierId: f!.supplierId, warehouseId: f!.warehouseId, orderDate: f!.orderDate, expectedDate: f!.expectedDate || null, notes: f!.notes, lines: f!.lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) || 0, rate: toPaise(l.rate), gstRate: l.gstRate })) } }),
    { success: id ? "Order saved" : "Purchase order created", onDone: (r) => go(`orders/${r.order.id}`) },
  );
  const sup = meta.suppliers.find((x) => x.id === f?.supplierId);
  const wh = meta.warehouses.find((x) => x.id === f?.warehouseId);
  const inter = isInterState(sup?.state ?? "", wh?.state ?? "");
  const totals = useMemo(() => purchaseTotals((f?.lines ?? []).map((l) => ({ qty: Number(l.qty) || 0, rate: toPaise(l.rate), gstRate: l.gstRate })), inter), [f, inter]);
  if (!f || !items.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const byId = new Map(items.data.items.map((i) => [i.id, i]));
  const setLine = (i: number, patch: Partial<Draft>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const addItem = (itemId: string) => {
    const it = byId.get(itemId);
    if (!it || f.lines.some((l) => l.itemId === itemId)) return;
    setF({ ...f, supplierId: f.supplierId || it.supplierId || "", lines: [...f.lines, { itemId, qty: String(it.reorderQty || 1), rate: fromPaise(it.avgCost), gstRate: it.gstRate, received: 0 }] });
  };
  const ok = f.supplierId && f.warehouseId && f.lines.length && f.lines.every((l) => Number(l.qty) > 0);
  return (
    <div>
      <Link href={id ? `/inventory/orders/${id}` : "/inventory/orders"} className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← {id ? existing.data?.po.number : "Purchase orders"}
      </Link>
      <PageHeader title={id ? `Edit ${existing.data?.po.number}` : "New purchase order"} description="Prices are what you pay per unit, before GST." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-5">
          <Section title="Supplier and delivery">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier">
                {(a) => (
                  <Select {...a} value={f.supplierId} disabled={!!id && existing.data?.po.status !== "draft"} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                    <option value="">Choose a supplier…</option>
                    {meta.suppliers.filter((s) => s.active || s.id === f.supplierId).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Deliver to">
                {(a) => (
                  <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
                    {meta.warehouses.filter((w) => w.active).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Order date">{(a) => <Input {...a} type="date" value={f.orderDate} onChange={(e) => setF({ ...f, orderDate: e.target.value })} />}</Field>
              <Field label="Expected by">{(a) => <Input {...a} type="date" value={f.expectedDate} min={f.orderDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} />}</Field>
            </div>
            {!meta.suppliers.length && (
              <p className="mt-3 text-[12.5px] text-muted">
                No suppliers yet — <Link href="/inventory/suppliers" className="underline">add one</Link> first.
              </p>
            )}
          </Section>
          <Section title="Items">
            {!f.lines.length ? (
              <Empty>Add the items you&apos;re ordering below.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <FormLines className="w-full min-w-[620px] text-[13px]">
                  <thead className="text-left text-[12px] text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">Item</th>
                      <th className="w-24 py-1.5 font-medium">Qty</th>
                      <th className="w-28 py-1.5 font-medium">Rate (₹)</th>
                      <th className="w-24 py-1.5 font-medium">GST</th>
                      <th className="w-28 py-1.5 text-right font-medium">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {f.lines.map((l, i) => {
                      const it = byId.get(l.itemId);
                      return (
                        <tr key={l.itemId} className="border-t border-border">
                          <td className="py-2 pr-2">
                            <b className="font-medium">{it?.name ?? "Item"}</b>
                            <span className="block text-[11.5px] text-muted">
                              {it?.unit}
                              {l.received ? ` · ${fmtQty(l.received)} received` : ""}
                            </span>
                          </td>
                          <td className="py-2 pr-2">
                            <Input aria-label={`Quantity of ${it?.name}`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                          </td>
                          <td className="py-2 pr-2">
                            <Input aria-label={`Rate for ${it?.name}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                          </td>
                          <td className="py-2 pr-2">
                            <Select aria-label={`GST for ${it?.name}`} value={String(l.gstRate)} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })}>
                              {GST_RATES.map((r) => (
                                <option key={r} value={r}>
                                  {r}%
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-2 text-right tabular-nums">{inr(totals.rows[i]?.amount ?? 0)}</td>
                          <td className="py-2 text-right">{!l.received && <Button size="sm" variant="ghost" aria-label={`Remove ${it?.name}`} icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </FormLines>
              </div>
            )}
            <div className="mt-3">
              <Select aria-label="Add an item" value="" onChange={(e) => addItem(e.target.value)}>
                <option value="">+ Add an item…</option>
                {items.data.items
                  .filter((i) => i.active && !f.lines.some((l) => l.itemId === i.id))
                  .sort((a, b) => Number(b.supplierId === f.supplierId) - Number(a.supplierId === f.supplierId) || a.name.localeCompare(b.name))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.low ? " — running low" : ""}
                    </option>
                  ))}
              </Select>
            </div>
          </Section>
          <Section title="Notes for the supplier">
            <Textarea aria-label="Notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} placeholder="Delivery instructions, packing, anything else" />
          </Section>
        </div>
        <aside className="grid content-start gap-3 xl:sticky xl:top-20">
          <Section title="Total">
            <dl className="grid gap-1.5 text-[13px]">
              <Row label="Before GST">{inr(totals.subtotal)}</Row>
              {inter ? <Row label="IGST">{inr(totals.split.igst)}</Row> : (
                <>
                  <Row label="CGST">{inr(totals.split.cgst)}</Row>
                  <Row label="SGST">{inr(totals.split.sgst)}</Row>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{inr(totals.total)}</span>
              </div>
            </dl>
            <p className="mt-2 text-[11.5px] text-muted">{sup?.state && wh?.state ? (inter ? `Inter-state: ${sup.state} → ${wh.state}` : `Within ${wh.state}`) : "Add both states (supplier and location) to split GST correctly; until then it's shown as CGST + SGST."}</p>
          </Section>
          <Button variant="primary" size="lg" loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>
            {id ? "Save order" : "Create purchase order"}
          </Button>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

export function OrderPage({ id }: { id: string }) {
  const { meta, go } = useInv();
  const q = useInvQuery<OrderDetail>(`orders/${id}`);
  const [receiving, setReceiving] = useState(false);
  const [ask, setAsk] = useState<null | "cancel" | "close" | "delete">(null);
  const [sendResult, setSendResult] = useState<{ emailed: boolean; reason: string | null } | null>(null);
  const send = useInvAction<void, { emailed: boolean; reason: string | null; pendingApproval?: boolean }>(() => ({ path: `orders/${id}/send`, body: { email: true } }), { success: (r) => (r.pendingApproval ? "Sent for approval — send it once it's approved" : r.emailed ? "Emailed to the supplier" : "Marked as sent"), onDone: (r) => setSendResult(r.pendingApproval ? null : r) });
  const act = useInvAction<"cancel" | "close" | "delete">((k) => (k === "delete" ? { path: `orders/${id}`, method: "DELETE" } : { path: `orders/${id}/${k}` }), { success: "Done", onDone: () => (setAsk(null), ask === "delete" ? go("orders") : undefined) });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { po, supplier, warehouse, items, receipts } = q.data;
  const names = new Map(items.map((i) => [i.id, i]));
  const open = ["draft", "sent", "partial"].includes(po.status);
  return (
    <div>
      <Link href="/inventory/orders" className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← Purchase orders
      </Link>
      <PageHeader
        title={po.number}
        description={`${supplier.name} → ${warehouse.name} · ordered ${fmt(po.orderDate)}${po.expectedDate ? ` · due ${fmt(po.expectedDate)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={po.status} />
            <ShareToChatButton card={{ kind: "purchase-orders", id, title: `${po.number} · ${supplier.name}`, sub: `${inr(po.total)} · ${po.status}`, link: `/inventory/orders/${id}`, module: "Purchase order", fields: [{ label: "Ordered", value: fmt(po.orderDate) }, { label: "Expected", value: po.expectedDate ? fmt(po.expectedDate) : "" }, { label: "Deliver to", value: warehouse.name }, { label: "Lines", value: po.lines.length }] }} />
            <EmailButton to={[supplier]} title={`Email ${supplier.name}`} subject={`Purchase order ${po.number}`} body={`Hi {{first_name}},\n\nAbout our purchase order ${po.number} (ordered ${fmt(po.orderDate)}${po.expectedDate ? `, expected by ${fmt(po.expectedDate)}` : ""}): \n\nThanks,\n{{my_name}}`} />
            <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => go(`orders/${id}/print`)}>
              Print
            </Button>
            {meta.me.write && open && (
              <>
                <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => go(`orders/${id}/edit`)}>
                  Edit
                </Button>
                {(po.status === "draft" || po.status === "sent") && (
                  <Button size="sm" icon={<Mail className="size-3.5" />} loading={send.isPending} onClick={() => send.mutate()}>
                    {po.status === "draft" ? "Send to supplier" : "Send again"}
                  </Button>
                )}
                <Button size="sm" variant="primary" icon={<PackageCheck className="size-3.5" />} onClick={() => setReceiving(true)}>
                  Receive goods
                </Button>
                {po.status === "partial" && <Button size="sm" variant="ghost" icon={<Check className="size-3.5" />} onClick={() => setAsk("close")}>Close</Button>}
                {(po.status === "draft" || po.status === "sent") && <Button size="sm" variant="ghost" aria-label="Cancel order" icon={<Ban className="size-4" />} onClick={() => setAsk("cancel")} />}
                {po.status === "draft" && <Button size="sm" variant="ghost" aria-label="Delete draft" icon={<Trash2 className="size-4" />} onClick={() => setAsk("delete")} />}
              </>
            )}
          </div>
        }
      />
      <div className="mb-4 empty:hidden">
        <ApprovalPanel kind="inv.po" refId={po.id} />
      </div>
      {(po.supplierAck || (po.dispatches?.length ?? 0) > 0) && (
        <div className="mb-4">
          <Notice tone="accent" title="From the supplier portal">
            {po.supplierAck && <span className="block">Acknowledged {new Date(po.supplierAck.at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}{po.supplierAck.promisedDate ? ` · promises delivery by ${fmt(po.supplierAck.promisedDate)}` : ""}{po.supplierAck.note ? ` · “${po.supplierAck.note}”` : ""}</span>}
            {po.dispatches?.map((d) => <span key={d.id} className="block">Dispatched {fmt(d.date)} · {d.reference}{d.carrier ? ` by ${d.carrier}` : ""}{d.note ? ` · ${d.note}` : ""}</span>)}
          </Notice>
        </div>
      )}
      {q.data.warnings.length > 0 && <div className="mb-4"><Notice tone="warning" title="Check before sending">{q.data.warnings.join(" · ")}</Notice></div>}
      {sendResult && !sendResult.emailed && (
        <div className="mb-4"><Notice title="Marked as sent — not emailed">
          {sendResult.reason}. Print it or save it as a PDF and send it yourself.
        </Notice></div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <Section title="Items">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Item</th>
                  <th className="py-1.5 text-right font-medium">Ordered</th>
                  <th className="py-1.5 text-right font-medium">Received</th>
                  <th className="py-1.5 text-right font-medium">Rate</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l, i) => {
                  const it = names.get(l.itemId);
                  const pct = Math.min(100, (l.received / l.qty) * 100);
                  return (
                    <tr key={l.itemId} className="border-t border-border">
                      <td className="py-2.5">
                        <Link href={`/inventory/items/${l.itemId}`} className="font-medium hover:underline">
                          {it?.name}
                        </Link>
                        <span className="mt-1 block h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
                          <span className={cx("block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-warning")} style={{ width: `${pct}%` }} />
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{fmtQty(l.qty, it?.unit)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtQty(l.received)}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {inr(l.rate)}
                        <span className="block text-[11px] text-muted">+{l.gstRate}% GST</span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{inr(q.data!.rows[i]?.amount ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {po.notes && <p className="mt-3 rounded-[12px] bg-surface-2/60 p-3 text-[12.5px] whitespace-pre-line text-muted">{po.notes}</p>}
        </Section>
        <div className="grid content-start gap-5">
          <Section title="Total">
            <dl className="grid gap-1.5 text-[13px]">
              <Row label="Before GST">{inr(po.subtotal)}</Row>
              {po.interState ? <Row label="IGST">{inr(q.data.split.igst)}</Row> : (
                <>
                  <Row label="CGST">{inr(q.data.split.cgst)}</Row>
                  <Row label="SGST">{inr(q.data.split.sgst)}</Row>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{inr(po.total)}</span>
              </div>
            </dl>
          </Section>
          <Section title="Supplier">
            <p className="text-[13px]">
              <b>{supplier.name}</b>
              <span className="block text-muted">{[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "No contact details"}</span>
              {supplier.gstin && <span className="block text-muted">GSTIN {supplier.gstin}</span>}
              <span className="block text-muted">Pays in {supplier.paymentTermsDays} days</span>
            </p>
          </Section>
          <Section title="Goods received">
            {!receipts.length ? (
              <Empty>Nothing received yet.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {receipts.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3 py-2">
                    <span>
                      <b>{r.number}</b>
                      <span className="block text-[12px] text-muted">
                        {fmt(r.date)}
                        {r.supplierInvoice ? ` · invoice ${r.supplierInvoice}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums">{inr(r.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
      {receiving && <ReceiveDialog order={q.data} onClose={() => setReceiving(false)} />}
      <ConfirmDialog
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => ask && act.mutate(ask)}
        loading={act.isPending}
        destructive={ask !== "close"}
        title={ask === "close" ? `Close ${po.number}?` : ask === "cancel" ? `Cancel ${po.number}?` : `Delete ${po.number}?`}
        description={ask === "close" ? "Stop waiting for the rest. What's arrived stays; the order no longer counts as on order." : ask === "cancel" ? "The supplier isn't told automatically — let them know." : "This draft is removed."}
        confirmLabel={ask === "close" ? "Close order" : ask === "cancel" ? "Cancel order" : "Delete"}
      />
    </div>
  );
}

/** Receive goods: against an order (prefilled with what's still due) or on their own. */
export function ReceiveDialog({ order, onClose }: { order?: OrderDetail; onClose: () => void }) {
  const { meta } = useInv();
  const items = useInvQuery<{ items: Item[] }>(order ? null : "items");
  const tracked = useInvQuery<{ items: Item[] }>("items?filter=all");
  const [f, setF] = useState(() => ({
    supplierId: order?.supplier.id ?? "",
    warehouseId: order?.warehouse.id ?? meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "",
    date: todayIst(),
    supplierInvoice: "",
    lines: (order?.po.lines ?? []).filter((l) => l.qty > l.received).map((l) => ({ itemId: l.itemId, qty: String(Number((l.qty - l.received).toFixed(3))), rate: fromPaise(l.rate), gstRate: l.gstRate, batch: "", expiry: "", rejected: "", rejectReason: "", serials: "", binId: "" })),
  }));
  const byId = new Map((tracked.data?.items ?? []).map((i) => [i.id, i]));
  const save = useInvAction(
    () => ({ path: "receipts", body: { poId: order?.po.id ?? null, supplierId: f.supplierId || null, warehouseId: f.warehouseId, date: f.date, supplierInvoice: f.supplierInvoice, lines: f.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: toPaise(l.rate), gstRate: l.gstRate, batch: l.batch, expiry: l.expiry || null, rejected: Number(l.rejected) || 0, rejectReason: l.rejectReason, serials: l.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean), binId: l.binId || null })) } }),
    { success: "Received — stock is updated", onDone: onClose },
  );
  const setLine = (i: number, p: Partial<(typeof f.lines)[number]>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const needsBatch = f.lines.some((l) => byId.get(l.itemId)?.trackBatches && Number(l.qty) > 0 && !l.batch);
  const bins = useInvQuery<{ bins: { id: string; code: string; kind: string; active: boolean }[] }>(meta.parts.warehouse && f.warehouseId ? `bins?warehouseId=${f.warehouseId}` : null);
  const binList = (bins.data?.bins ?? []).filter((b) => b.active);
  const serialCount = (l: (typeof f.lines)[number]) => l.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).length;
  const needsSerials = f.lines.some((l) => byId.get(l.itemId)?.trackSerials && serialCount(l) !== Math.max(0, (Number(l.qty) || 0) - (Number(l.rejected) || 0)));
  return (
    <Dialog open onClose={onClose} size="lg" title={order ? `Receive against ${order.po.number}` : "Receive goods"} description={order ? "Quantities start at what's still due. Change them to what actually arrived." : "For goods that came without a purchase order."} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.lines.some((l) => Number(l.qty) > 0) || needsBatch || needsSerials || !f.warehouseId} onClick={() => save.mutate(undefined)}>Receive</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {!order && (
            <Field label="Supplier (optional)">
              {(a) => (
                <Select {...a} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                  <option value="">None</option>
                  {meta.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {!order && (
            <Field label="Into">
              {(a) => (
                <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
                  {meta.warehouses.filter((w) => w.active).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Supplier's invoice no.">{(a) => <Input {...a} value={f.supplierInvoice} onChange={(e) => setF({ ...f, supplierInvoice: e.target.value })} maxLength={60} />}</Field>
        </div>
        <div className="overflow-x-auto">
          <FormLines className="w-full min-w-[560px] text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-1.5 font-medium">Item</th>
                <th className="w-24 py-1.5 font-medium">Arrived</th>
                <th className="w-24 py-1.5 font-medium">Rejected</th>
                <th className="w-28 py-1.5 font-medium">Rate (₹)</th>
                <th className="py-1.5 font-medium">Where / batch / serials</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => {
                const it = byId.get(l.itemId);
                return (
                  <tr key={l.itemId} className="border-t border-border">
                    <td className="py-2 pr-2 font-medium">{it?.name ?? order?.items.find((x) => x.id === l.itemId)?.name}</td>
                    <td className="py-2 pr-2">
                      <Input aria-label={`Received of ${it?.name}`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                    </td>
                    <td className="py-2 pr-2">
                      <Input aria-label={`Rejected of ${it?.name ?? order?.items.find((x) => x.id === l.itemId)?.name}`} inputMode="decimal" value={l.rejected} onChange={(e) => setLine(i, { rejected: e.target.value })} placeholder="0" />
                      {Number(l.rejected) > 0 && <Input aria-label={`Why ${it?.name ?? ""} was rejected`} className="mt-1" value={l.rejectReason} onChange={(e) => setLine(i, { rejectReason: e.target.value })} placeholder="Why" maxLength={200} />}
                    </td>
                    <td className="py-2 pr-2">
                      <Input aria-label={`Rate for ${it?.name}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                    </td>
                    <td className="py-2 pr-2">
                      {binList.length > 0 && (
                        <Select aria-label={`Bin for ${it?.name ?? ""}`} className="mb-1" value={l.binId} onChange={(e) => setLine(i, { binId: e.target.value })}>
                          <option value="">Not put away</option>
                          {binList.map((b) => <option key={b.id} value={b.id}>{b.code}{b.kind === "quarantine" ? " (quarantine)" : ""}</option>)}
                        </Select>
                      )}
                      {it?.trackSerials && <Textarea aria-label={`Serial numbers for ${it.name}`} rows={2} className="mb-1" value={l.serials} onChange={(e) => setLine(i, { serials: e.target.value })} placeholder="Serial numbers, one per line" />}
                      {it?.trackBatches ? (
                        <span className="flex gap-1.5">
                          <Input aria-label={`Batch for ${it.name}`} value={l.batch} onChange={(e) => setLine(i, { batch: e.target.value })} placeholder="Batch" maxLength={40} className="min-w-[7.5rem] flex-1" />
                          <Input aria-label={`Expiry for ${it.name}`} type="date" value={l.expiry} onChange={(e) => setLine(i, { expiry: e.target.value })} className="!w-[9.5rem] shrink-0" />
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">{!order && <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </FormLines>
        </div>
        {!order && (
          <Select
            aria-label="Add an item"
            value=""
            onChange={(e) => {
              const it = items.data?.items.find((x) => x.id === e.target.value);
              if (it) setF({ ...f, lines: [...f.lines, { itemId: it.id, qty: "", rate: fromPaise(it.avgCost), gstRate: it.gstRate, batch: "", expiry: "", rejected: "", rejectReason: "", serials: "", binId: "" }] });
            }}
          >
            <option value="">+ Add an item…</option>
            {(items.data?.items ?? []).filter((i) => !f.lines.some((l) => l.itemId === i.id)).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        )}
        {needsBatch && <p className="text-[12.5px] text-warning">Items tracked by batch need a batch number.</p>}
        {needsSerials && <p className="text-[12.5px] text-warning">Items with serial numbers need one serial for each unit accepted.</p>}
        {f.lines.some((l) => Number(l.rejected) > 0) && <p className="text-[12.5px] text-muted">Rejected goods don&apos;t go into stock or onto the bill, and stay due on the order. Send them back from Returns to suppliers.</p>}
      </div>
    </Dialog>
  );
}

type Receipt = { id: string; number: string; date: string; supplier: string | null; warehouse: string; poNumber: string | null; poId: string | null; supplierInvoice: string; total: number; lines: { itemId: string; qty: number }[] };

export function ReceiptsView() {
  const { meta } = useInv();
  const q = useInvQuery<{ receipts: Receipt[] }>("receipts");
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Goods received" description="Every delivery, with or without a purchase order." actions={meta.me.write && <Button size="sm" variant="primary" icon={<PackageCheck className="size-3.5" />} onClick={() => setOpen(true)}>Receive without an order</Button>} />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.receipts.length ? (
        <Empty>Nothing received yet. Receive against a purchase order from its page, or receive here without one.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[680px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Receipt</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Into</th>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <b className="font-semibold">{r.number}</b>
                    <span className="block text-[12px] text-muted">
                      {fmt(r.date)} · {r.lines.length} item{r.lines.length === 1 ? "" : "s"}
                      {r.supplierInvoice ? ` · inv ${r.supplierInvoice}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{r.supplier ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{r.warehouse}</td>
                  <td className="px-4 py-2.5">{r.poId ? <Link href={`/inventory/orders/${r.poId}`} className="underline">{r.poNumber}</Link> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReceiveDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

type ReorderRow = { id: string; name: string; sku: string; unit: string; onHand: number; onOrder: number; reorderLevel: number; suggest: number; rate: number; gstRate: number; supplierId: string | null };

export function ReorderView() {
  const { meta, go } = useInv();
  const q = useInvQuery<{ rows: ReorderRow[]; suppliers: { id: string; name: string; leadTimeDays: number }[] }>("reorder");
  const [pick, setPick] = useState<Record<string, { on: boolean; qty: string; supplierId: string }>>({});
  const [warehouseId, setWarehouse] = useState(meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "");
  const rows = q.data?.rows ?? [];
  const state = (r: ReorderRow) => pick[r.id] ?? { on: r.suggest > 0, qty: String(r.suggest || ""), supplierId: r.supplierId ?? "" };
  const chosen = rows.filter((r) => state(r).on && Number(state(r).qty) > 0);
  const draft = useInvAction<void, { orders: { id: string; number: string }[]; skipped: string[] }>(() => ({ path: "reorder", body: { warehouseId, lines: chosen.map((r) => ({ itemId: r.id, qty: Number(state(r).qty), supplierId: state(r).supplierId || null })) } }), {
    success: (r) => `${r.orders.length} draft order${r.orders.length === 1 ? "" : "s"} created${r.skipped.length ? ` · ${r.skipped.length} without a supplier left out` : ""}`,
    onDone: (r) => (r.orders.length === 1 ? go(`orders/${r.orders[0].id}`) : go("orders")),
  });
  const total = chosen.reduce((a, r) => a + Math.round((Number(state(r).qty) || 0) * r.rate), 0);
  return (
    <div>
      <PageHeader title="Reorder" description="Items at or below their reorder level, with what's already on order counted. Pick what to buy — one draft order is made per supplier." />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<RefreshCcw />} title="Nothing to reorder" description="Set a reorder level on items and they'll show up here when they run low." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
            <FormLines className="w-full min-w-[760px] text-[13.5px]">
              <thead className="border-b border-border text-left text-[12px] text-muted">
                <tr>
                  <th className="w-10 px-4 py-2.5" />
                  <th className="px-2 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 text-right font-medium">On hand</th>
                  <th className="px-4 py-2.5 text-right font-medium">On order</th>
                  <th className="px-4 py-2.5 text-right font-medium">Level</th>
                  <th className="w-28 px-4 py-2.5 font-medium">Order</th>
                  <th className="w-48 px-4 py-2.5 font-medium">Supplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const st = state(r);
                  const set = (p: Partial<typeof st>) => setPick({ ...pick, [r.id]: { ...st, ...p } });
                  return (
                    <tr key={r.id} className={cx(!st.on && "opacity-60")}>
                      <td className="px-4 py-2">
                        <input type="checkbox" aria-label={`Order ${r.name}`} className="size-4 accent-[var(--accent)]" checked={st.on} onChange={(e) => set({ on: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/inventory/items/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        <span className="block text-[12px] text-muted">{r.rate ? `${inr(r.rate)} last cost` : "No cost yet"}</span>
                      </td>
                      <td className={cx("px-4 py-2 text-right tabular-nums", r.onHand <= 0 && "text-danger")}>{fmtQty(r.onHand, r.unit)}</td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums">{r.onOrder ? fmtQty(r.onOrder) : "—"}</td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums">{fmtQty(r.reorderLevel)}</td>
                      <td className="px-4 py-2">
                        <Input aria-label={`Quantity of ${r.name}`} inputMode="decimal" value={st.qty} onChange={(e) => set({ qty: e.target.value, on: true })} />
                        {r.suggest === 0 && !st.qty && <span className="mt-0.5 block text-[11px] text-muted">Covered by what&apos;s on order</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Select aria-label={`Supplier for ${r.name}`} value={st.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
                          <option value="">Choose…</option>
                          {q.data!.suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </FormLines>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {meta.warehouses.length > 1 && (
              <Select aria-label="Deliver to" className="!w-auto" value={warehouseId} onChange={(e) => setWarehouse(e.target.value)}>
                {meta.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    Deliver to {w.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="text-[13px] text-muted">
              {chosen.length} item{chosen.length === 1 ? "" : "s"} · about {short(total)} before GST
            </span>
            {meta.me.write && (
              <Button variant="primary" loading={draft.isPending} disabled={!chosen.length} onClick={() => draft.mutate()}>
                Draft purchase orders
              </Button>
            )}
          </div>
          {chosen.some((r) => !state(r).supplierId) && <p className="mt-2 text-right text-[12.5px] text-warning">Items without a supplier are left out — pick one for each.</p>}
        </>
      )}
    </div>
  );
}

/** A clean, printable purchase order (Print → Save as PDF). */
export function OrderPrint({ id }: { id: string }) {
  const q = useInvQuery<OrderDetail>(`orders/${id}`);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { po, supplier, warehouse, items, company, terms, split, rows } = q.data;
  const names = new Map(items.map((i) => [i.id, i]));
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/inventory/orders/${id}`} className="text-[13px] text-muted hover:text-fg">
          ← Back
        </Link>
        <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>
      <article className="rounded-[20px] border border-border bg-surface p-8 text-[13px] shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-border pb-5">
          <div>
            <h1 className="text-[20px] font-semibold">{company}</h1>
            <p className="mt-1 text-muted">
              Deliver to: {warehouse.name}
              {warehouse.address ? `, ${warehouse.address}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">Purchase order</p>
            <p className="mt-1 text-[18px] font-semibold">{po.number}</p>
            <p className="text-muted">Date {fmt(po.orderDate)}</p>
            {po.expectedDate && <p className="text-muted">Needed by {fmt(po.expectedDate)}</p>}
          </div>
        </header>
        <section className="mt-5">
          <p className="text-[11.5px] font-semibold tracking-[0.14em] text-muted uppercase">Supplier</p>
          <p className="mt-1 font-semibold">{supplier.name}</p>
          <p className="text-muted">{[supplier.address, supplier.gstin && `GSTIN ${supplier.gstin}`].filter(Boolean).join(" · ")}</p>
        </section>
        <table className="mt-6 w-full">
          <thead className="border-b border-border text-left text-[11.5px] text-muted uppercase">
            <tr>
              <th className="py-2 font-semibold">#</th>
              <th className="py-2 font-semibold">Item</th>
              <th className="py-2 font-semibold">HSN</th>
              <th className="py-2 text-right font-semibold">Qty</th>
              <th className="py-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">GST</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => {
              const it = names.get(l.itemId);
              return (
                <tr key={l.itemId} className="border-b border-border">
                  <td className="py-2 text-muted">{i + 1}</td>
                  <td className="py-2">
                    {it?.name}
                    {it?.sku && <span className="block text-[11.5px] text-muted">{it.sku}</span>}
                  </td>
                  <td className="py-2 text-muted">{it?.hsn || "—"}</td>
                  <td className="py-2 text-right tabular-nums">{fmtQty(l.qty, it?.unit)}</td>
                  <td className="py-2 text-right tabular-nums">{inr(l.rate)}</td>
                  <td className="py-2 text-right tabular-nums">{l.gstRate}%</td>
                  <td className="py-2 text-right tabular-nums">{inr(rows[i]?.amount ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto grid max-w-[280px] gap-1">
          <Row label="Before GST">{inr(po.subtotal)}</Row>
          {po.interState ? <Row label="IGST">{inr(split.igst)}</Row> : (
            <>
              <Row label="CGST">{inr(split.cgst)}</Row>
              <Row label="SGST">{inr(split.sgst)}</Row>
            </>
          )}
          <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{inr(po.total)}</span>
          </div>
        </dl>
        {po.notes && <p className="mt-6 whitespace-pre-line">{po.notes}</p>}
        <p className="mt-6 text-[12px] text-muted">{terms}</p>
      </article>
    </div>
  );
}
