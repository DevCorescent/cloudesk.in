"use client";

// Sales orders: the list, the editor (customer prices filled in from their
// price list), and an order's page — confirm, approve, deliver, invoice,
// return, close.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { LinkedDocuments } from "@/components/documents/linked";
import { ArrowLeft, Check, ClipboardList, FileText, Plus, Truck, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApprovalPanel } from "@/components/approvals/card";
import { ExportMenu } from "@/components/import/buttons";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { RETURN_REASONS, orderTotals, toInvoice } from "@/lib/sales/model";
import { useQuery } from "@tanstack/react-query";
import { Empty, Section, StatusPill, fmt, inr, qty, toPaise, todayIst, useSales, useSalesAction, useSalesQuery, type Customer, type Line, type Order } from "./shared";

export function OrdersView() {
  const { meta, go } = useSales();
  const [tab, setTab] = useState<"open" | "draft" | "pending_approval" | "">("open");
  const [q, setQ] = useState("");
  const list = useSalesQuery<{ orders: (Order & { toDeliver: number; uninvoiced: boolean })[] }>(`orders?${new URLSearchParams(Object.entries({ status: tab, q }).filter(([, v]) => v))}`, { keepPrevious: true });
  const rows = list.data?.orders;
  return (
    <div>
      <PageHeader
        title="Sales orders"
        description="What customers have ordered, through delivery and invoicing."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="sales-orders" rows={rows?.map((o) => ({ ...o, salesperson: meta.people.find((p) => p.id === o.salespersonId)?.name ?? "" }))} columns={[{ key: "number", label: "Number" }, { key: "date", label: "Date" }, { key: "clientName", label: "Customer" }, { key: "reference", label: "Customer PO" }, { key: "salesperson", label: "Salesperson" }, { key: "subtotal", label: "Before tax", money: true }, { key: "tax", label: "Tax", money: true }, { key: "total", label: "Total", money: true }, { key: "status", label: "Status" }]} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("orders/new")}>New order</Button>}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "open", label: "Open" }, { value: "pending_approval", label: "Waiting" }, { value: "draft", label: "Drafts" }, { value: "", label: "All" }]} />
        <Input aria-label="Search orders" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, order or PO number" />
      </div>
      {!rows ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<ClipboardList />} title={tab === "open" ? "No open orders" : "No orders here"} description="Take an order for a customer in your invoicing books. Their price list, credit limit and payment terms are applied." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => go("orders/new")}>New order</Button> : undefined} />
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm", list.isFetching && "opacity-80")}>
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Expected</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((o) => (
                <tr key={o.id} onClick={() => go(`orders/${o.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5"><b className="font-medium">{o.number}</b><span className="block text-[12px] text-muted">{fmt(o.date)}{o.reference ? ` · PO ${o.reference}` : ""}</span></td>
                  <td className="px-4 py-2.5">{o.clientName}</td>
                  <td className="px-4 py-2.5 text-muted">{o.expectedDate ? fmt(o.expectedDate, { day: "numeric", month: "short" }) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(o.total)}</td>
                  <td className="px-4 py-2.5"><span className="flex flex-wrap items-center gap-1.5"><StatusPill status={o.status} />{o.uninvoiced && !["draft", "pending_approval", "cancelled"].includes(o.status) && <span className="text-[11.5px] text-muted">to invoice</span>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Draft = { id: string; itemId: string | null; name: string; hsn: string; unit: string; qty: string; rate: string; listRate: number; discountPct: string; taxBps: number };
let seq = 0;
const nid = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;
const blank = (): Draft => ({ id: nid(), itemId: null, name: "", hsn: "", unit: "", qty: "1", rate: "", listRate: 0, discountPct: "", taxBps: 1800 });

export function OrderEditor({ init, onDone }: { init?: Order; onDone?: () => void }) {
  const { meta, orgId, go } = useSales();
  const toast = useToast();
  const params = useSearchParams();
  const dealId = params.get("deal");
  const customers = useSalesQuery<{ customers: Customer[] }>("customers");
  const deal = useQuery({ queryKey: ["sales", orgId, "deal", dealId], queryFn: () => api<{ dealId: string; title: string; amount: number; clientId: string | null; ownerId: string | null; customer: string }>(`/api/v1/orgs/${orgId}/sales/deals/${dealId}`), enabled: !!dealId && !init });
  const [f, setF] = useState(() => ({
    clientId: init?.clientId ?? "",
    date: init?.date ?? todayIst(),
    expectedDate: init?.expectedDate ?? "",
    warehouseId: init?.warehouseId ?? meta.settings.defaultWarehouseId ?? "",
    salespersonId: init?.salespersonId ?? "",
    reference: init?.reference ?? "",
    placeOfSupply: init?.placeOfSupply ?? "",
    notes: init?.notes ?? "",
    lines: init ? init.lines.map((l): Draft => ({ id: l.id, itemId: l.itemId, name: l.name, hsn: l.hsn, unit: l.unit, qty: String(l.qty), rate: String(l.rate / 100), listRate: l.listRate, discountPct: l.discountPct ? String(l.discountPct) : "", taxBps: l.taxBps })) : [blank()],
  }));
  // A deal's customer, once it loads, unless one's been picked.
  const clientId = f.clientId || (deal.data?.clientId ?? "");
  const cust = customers.data?.customers.find((c) => c.clientId === clientId);
  const lines = f.lines.map((l) => ({ ...l, n: { qty: Number(l.qty) || 0, rate: toPaise(l.rate), discountPct: Number(l.discountPct) || 0, taxBps: l.taxBps } }));
  const t = orderTotals(lines.map((l) => l.n));
  const set = (i: number, p: Partial<Draft>) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
  /** Prices for this customer: the line's rate, and its list rate for the discount shown. */
  const price = async (i: number, itemId: string, q: number) => {
    try {
      const r = await api<{ discountPct: number; prices: { price: number | null; listPrice: number | null; from: string | null }[] }>(`/api/v1/orgs/${orgId}/sales/quote`, { method: "POST", body: { clientId: clientId || null, date: f.date, items: [{ itemId, qty: q }] } });
      const p = r.prices[0];
      if (p?.price !== null && p?.price !== undefined) set(i, { rate: String(p.price / 100), listRate: p.listPrice ?? p.price, ...(p.from === "default" && r.discountPct ? { discountPct: String(r.discountPct) } : {}) });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const pickItem = (i: number, itemId: string) => {
    const it = meta.items.find((x) => x.id === itemId);
    if (!it) return set(i, { itemId: null });
    set(i, { itemId, name: it.name, hsn: it.hsn, unit: it.unit, taxBps: Math.round(it.gstRate * 100) });
    void price(i, itemId, Number(f.lines[i].qty) || 1);
  };
  const body = {
    ownerId: cust?.ownerId ?? deal.data?.ownerId ?? "",
    clientId,
    date: f.date,
    expectedDate: f.expectedDate || null,
    warehouseId: f.warehouseId || null,
    salespersonId: f.salespersonId || cust?.terms?.salespersonId || (init ? null : meta.me.id),
    priceListId: cust?.terms?.priceListId ?? null,
    placeOfSupply: f.placeOfSupply,
    reference: f.reference,
    dealId: init?.dealId ?? deal.data?.dealId ?? null,
    notes: f.notes,
    lines: lines.filter((l) => l.name.trim() && l.n.qty > 0).map((l) => ({ id: l.id, itemId: l.itemId, name: l.name.trim(), hsn: l.hsn, unit: l.unit, qty: l.n.qty, rate: l.n.rate, listRate: l.listRate, discountPct: l.n.discountPct, taxBps: l.taxBps })),
  };
  const save = useSalesAction<void, { order: Order }>(() => ({ path: init ? `orders/${init.id}` : "orders", method: init ? "PUT" : "POST", body }), { success: init ? "Order saved" : "Order saved as a draft", onDone: (r) => (onDone ? onDone() : go(`orders/${r.order.id}`)) });
  const credit = cust && cust.limit ? cust.limit - cust.owed - cust.onOrder - t.total : null;
  return (
    <div>
      {!init && <Link href="/sales/orders" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Orders</Link>}
      <PageHeader title={init ? `Edit ${init.number}` : "New sales order"} description={deal.data ? `From the deal “${deal.data.title}”${deal.data.clientId ? "" : ` — add ${deal.data.customer} as a client in your invoicing books to pick them`}` : "Prices come from the customer's price list; you can change them."} actions={<div className="flex gap-2">{onDone && <Button size="sm" onClick={onDone}>Cancel</Button>}<Button size="sm" variant="primary" loading={save.isPending} disabled={!body.clientId || !body.ownerId || !body.lines.length} onClick={() => save.mutate()}>Save draft</Button></div>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <Section title="Customer">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <Field label="Customer" className="sm:col-span-2">
              {(a) => (
                <Select {...a} value={clientId} disabled={!!init} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(customers.data?.customers ?? []).map((c) => (
                    <option key={c.clientId} value={c.clientId}>{c.name}{meta.books.length > 1 ? ` · ${c.book}` : ""}{c.terms?.onHold ? " (on hold)" : ""}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Their PO no.">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} />}</Field>
            <Field label="Order date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
            <Field label="Expected by">{(a) => <Input {...a} type="date" value={f.expectedDate} min={f.date} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} />}</Field>
            <Field label="Salesperson">
              {(a) => (
                <Select {...a} value={f.salespersonId || cust?.terms?.salespersonId || ""} onChange={(e) => setF({ ...f, salespersonId: e.target.value })}>
                  <option value="">{init ? "None" : "Me"}</option>
                  {meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              )}
            </Field>
            {meta.links.inventory && meta.warehouses.length > 1 && (
              <Field label="Deliver from">
                {(a) => (
                  <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
                    <option value="">Default location</option>
                    {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                )}
              </Field>
            )}
          </div>
          {cust && (
            <p className="mt-3 text-[12.5px] text-muted">
              {cust.terms?.onHold ? <span className="font-medium text-danger">On hold — the order can be saved but not confirmed. </span> : null}
              Owes {inr(cust.owed)}{cust.onOrder ? ` · ${inr(cust.onOrder)} on other open orders` : ""}{cust.limit ? ` · limit ${inr(cust.limit)}` : " · no credit limit"}
              {credit !== null && credit < 0 && <span className="font-medium text-warning"> · this order goes {inr(-credit)} over</span>}
              {cust.terms ? ` · ${cust.terms.paymentTermsDays} days to pay` : ""}
            </p>
          )}
        </Section>
        <Section title="Lines">
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <FormLines className="w-full min-w-[820px] text-[13px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  {meta.links.inventory && <th className="w-48 py-1 font-medium">Item</th>}
                  <th className="py-1 font-medium">Description</th>
                  <th className="w-20 py-1 font-medium">Qty</th>
                  <th className="w-28 py-1 font-medium">Rate (₹)</th>
                  <th className="w-20 py-1 font-medium">Disc %</th>
                  <th className="w-20 py-1 font-medium">GST</th>
                  <th className="w-28 py-1 text-right font-medium">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} className="align-top">
                    {meta.links.inventory && (
                      <td className="py-1 pr-2">
                        <Select aria-label={`Item ${i + 1}`} value={l.itemId ?? ""} onChange={(e) => pickItem(i, e.target.value)}>
                          <option value="">Service / other</option>
                          {meta.items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` · ${it.sku}` : ""}</option>)}
                        </Select>
                      </td>
                    )}
                    <td className="py-1 pr-2"><Input aria-label={`Description ${i + 1}`} value={l.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={300} /></td>
                    <td className="py-1 pr-2"><Input aria-label={`Quantity ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} onBlur={() => l.itemId && void price(i, l.itemId, Number(l.qty) || 1)} /></td>
                    <td className="py-1 pr-2">
                      <Input aria-label={`Rate ${i + 1}`} inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
                      {l.listRate > 0 && l.listRate !== l.n.rate && <span className="mt-0.5 block text-[11px] text-muted">List {inr(l.listRate)}</span>}
                    </td>
                    <td className="py-1 pr-2"><Input aria-label={`Discount ${i + 1}`} inputMode="decimal" value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} className={cx(meta.settings.maxDiscountPct > 0 && l.n.discountPct > meta.settings.maxDiscountPct && "!border-warning")} /></td>
                    <td className="py-1 pr-2">
                      <Select aria-label={`GST ${i + 1}`} value={String(l.taxBps)} onChange={(e) => set(i, { taxBps: Number(e.target.value) })}>
                        {[0, 500, 1200, 1800, 2800].map((r) => <option key={r} value={r}>{r / 100}%</option>)}
                      </Select>
                    </td>
                    <td className="py-2 text-right tabular-nums">{inr(Math.round(l.n.qty * l.n.rate * (1 - l.n.discountPct / 100)))}</td>
                    <td>{f.lines.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove line" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />}</td>
                  </tr>
                ))}
              </tbody>
            </FormLines>
          </div>
          <button type="button" className="mt-2 text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, lines: [...f.lines, blank()] })}>+ Add a line</button>
          {meta.settings.maxDiscountPct > 0 && lines.some((l) => l.n.discountPct > meta.settings.maxDiscountPct) && <p className="mt-2 text-[12.5px] text-warning">Discounts over {meta.settings.maxDiscountPct}% need approval when the order is confirmed.</p>}
          <dl className="mt-4 ml-auto grid max-w-xs gap-1 text-[13px]">
            {t.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{inr(t.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Before tax</dt><dd className="tabular-nums">{inr(t.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST (estimate)</dt><dd className="tabular-nums">{inr(t.tax)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{inr(t.total)}</dd></div>
          </dl>
        </Section>
        <Field label="Notes">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>
      </div>
    </div>
  );
}

type Detail = {
  order: Order;
  deliveries: { id: string; number: string; date: string; status: string; lines: { lineId: string; name: string; qty: number }[]; vehicleNo: string; receivedBy: string }[];
  returns: { id: string; number: string; date: string; lines: { name: string; qty: number; reason: string; restock: boolean }[]; creditNoteId: string | null }[];
  invoices: { id: string; number: string; type: string; status: string; total: number; owner_id: string }[];
  credit: { limit: number; owed: number; onOrder: number; exposure: number; over: boolean };
  terms: { paymentTermsDays: number; onHold: boolean } | null;
  contact?: { name: string; email: string };
};

export function OrderPage({ id }: { id: string }) {
  const { meta, go } = useSales();
  const q = useSalesQuery<Detail>(`orders/${id}`);
  const [editing, setEditing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [returning, setReturning] = useState(false);
  const [confirm, setConfirm] = useState<null | "cancel" | "close" | "delete">(null);
  const confirmIt = useSalesAction<void, { order: Order; holds: string[]; warning: string | null }>(() => ({ path: `orders/${id}/confirm` }), { success: (r) => (r.order.status === "confirmed" ? (r.warning ? `Confirmed — ${r.warning.toLowerCase()}` : "Order confirmed") : "Sent for approval") });
  const approve = useSalesAction<boolean>((ok) => ({ path: `orders/${id}/approve`, body: { approve: ok } }), { success: "Done" });
  const invoice = useSalesAction<void, { invoice: { href: string } }>(() => ({ path: `orders/${id}/invoice` }), { success: "Draft invoice made", onDone: (r) => window.open(r.invoice.href, "_self") });
  const act = useSalesAction<string>((what) => ({ path: what === "delete" ? `orders/${id}` : `orders/${id}/${what}`, method: what === "delete" ? "DELETE" : "POST" }), { success: "Done", onDone: () => (setConfirm(null), confirm === "delete" && go("orders")) });
  const pod = useSalesAction<{ id: string; receivedBy: string }>((b) => ({ path: `deliveries/${b.id}/delivered`, body: { receivedBy: b.receivedBy } }), { success: "Marked delivered" });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { order: o, deliveries, returns, invoices, credit } = q.data;
  if (editing) return <OrderEditor init={o} onDone={() => setEditing(false)} />;
  const live = ["confirmed", "partial", "delivered"].includes(o.status);
  const due = toInvoice(o.lines, meta.settings.invoiceOn);
  const goods = o.lines.filter((l) => l.itemId);
  const canDeliver = live && meta.parts.delivery && goods.some((l) => l.delivered < l.qty - 0.0005);
  const canReturn = meta.parts.delivery && o.lines.some((l) => (l.itemId ? l.delivered - l.returned : l.invoiced) > 0.0005);
  const books = meta.books;
  const href = (d: { id: string; type: string; owner_id: string }) => {
    const kind = books.find((b) => b.id === d.owner_id)?.kind;
    const t = d.type === "credit_note" ? "credit-notes" : "invoices";
    return kind === "project" ? `/projects/${d.owner_id}/invoicing/${t}/${d.id}` : `/finance/${d.owner_id}/${t}/${d.id}`;
  };
  return (
    <div>
      <Link href="/sales/orders" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Orders</Link>
      <PageHeader
        title={`${o.number} · ${o.clientName}`}
        description={`${fmt(o.date)}${o.reference ? ` · PO ${o.reference}` : ""}${o.expectedDate ? ` · expected ${fmt(o.expectedDate)}` : ""}${o.salespersonId ? ` · ${meta.people.find((p) => p.id === o.salespersonId)?.name ?? ""}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={o.status} />
            <ShareToChatButton card={{ kind: "orders", id: o.id, title: `${o.number} · ${o.clientName}`, sub: `${inr(o.total)} · ${o.status}`, link: `/sales/orders/${o.id}`, module: "Sales order", fields: [{ label: "Date", value: fmt(o.date) }, { label: "Expected", value: o.expectedDate ? fmt(o.expectedDate) : "" }, { label: "Lines", value: o.lines.length }, { label: "PO", value: o.reference }] }} />
            <EmailButton to={[q.data.contact]} title={`Email ${q.data.contact?.name || o.clientName} about order ${o.number}`} subject={`Order ${o.number}${o.reference ? ` (your PO ${o.reference})` : ""}`} body={`Hi {{first_name}},\n\nAbout order ${o.number} for ${o.clientName}: \n\nThanks,\n{{my_name}}`} />
            {meta.me.write && o.status === "draft" && (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={confirmIt.isPending} onClick={() => confirmIt.mutate()}>Confirm</Button>
              </>
            )}
            {meta.me.manage && o.status === "pending_approval" && (
              <>
                <Button size="sm" onClick={() => approve.mutate(false)}>Send back</Button>
                <Button size="sm" variant="primary" onClick={() => approve.mutate(true)}>Approve</Button>
              </>
            )}
            {meta.me.write && canDeliver && <Button size="sm" icon={<Truck className="size-3.5" />} onClick={() => setDelivering(true)}>Deliver</Button>}
            {meta.me.write && (live || o.status === "closed") && due.length > 0 && <Button size="sm" variant="primary" icon={<FileText className="size-3.5" />} loading={invoice.isPending} onClick={() => invoice.mutate()}>Invoice</Button>}
            {meta.me.write && canReturn && <Button size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => setReturning(true)}>Return</Button>}
            {meta.me.write && live && <Button size="sm" variant="ghost" onClick={() => setConfirm("close")}>Close</Button>}
            {meta.me.write && ["draft", "pending_approval", "confirmed"].includes(o.status) && !o.lines.some((l) => l.delivered || l.invoiced) && <Button size="sm" variant="ghost" onClick={() => setConfirm("cancel")}>Cancel</Button>}
            {meta.me.manage && ["draft", "cancelled"].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>Delete</Button>}
          </div>
        }
      />
      <div className="mb-4 empty:hidden"><ApprovalPanel kind="sales.order" refId={o.id} /></div>
      {o.status === "pending_approval" && o.holds.length > 0 && <div className="mb-4"><Notice tone="warning" title="Waiting for approval">{o.holds.join(" · ")}</Notice></div>}
      {o.status === "draft" && credit.limit > 0 && credit.over && <div className="mb-4"><Notice tone="warning" title="Over the credit limit">{o.clientName} owes {inr(credit.owed)}{credit.onOrder ? ` and has ${inr(credit.onOrder)} on other orders` : ""}; with this order that&apos;s {inr(credit.exposure)} against {inr(credit.limit)}.</Notice></div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <Section title="Lines">
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-right text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 text-left font-medium">Item</th>
                  <th className="py-1.5 font-medium">Ordered</th>
                  <th className="py-1.5 font-medium">Delivered</th>
                  <th className="py-1.5 font-medium">Invoiced</th>
                  <th className="py-1.5 font-medium">Rate</th>
                  <th className="py-1.5 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-right tabular-nums">
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 text-left">{l.name}<span className="block text-[12px] text-muted">{l.hsn ? `HSN ${l.hsn} · ` : ""}{l.taxBps / 100}% GST{l.discountPct ? ` · ${l.discountPct}% off` : ""}</span></td>
                    <td className="py-2">{qty(l.qty)} {l.unit}</td>
                    <td className="py-2">{l.itemId ? `${qty(l.delivered)}${l.returned ? ` (−${qty(l.returned)})` : ""}` : "—"}</td>
                    <td className="py-2">{qty(l.invoiced)}</td>
                    <td className="py-2">{inr(l.rate)}</td>
                    <td className="py-2 font-medium">{inr(Math.round(l.qty * l.rate * (1 - l.discountPct / 100)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-4 ml-auto grid max-w-xs gap-1 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Before tax</dt><dd className="tabular-nums">{inr(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST (estimate)</dt><dd className="tabular-nums">{inr(o.tax)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{inr(o.total)}</dd></div>
          </dl>
          {o.notes && <p className="mt-3 text-[12.5px] whitespace-pre-line text-muted">{o.notes}</p>}
        </Section>
        <div className="grid content-start gap-5">
          <Section title="Invoices">
            {!invoices.length ? <Empty>Not invoiced yet.</Empty> : (
              <ul className="divide-y divide-border text-[13px]">
                {invoices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={href(d)} className="font-medium hover:underline">{d.type === "credit_note" ? "Credit note " : ""}{d.number || "Draft"}</Link>
                    <span className="flex items-center gap-2 tabular-nums">{d.type === "credit_note" ? "−" : ""}{inr(d.total)}<span className="text-[11.5px] text-muted">{d.status}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {meta.parts.delivery && (
            <Section title="Deliveries">
              {!deliveries.length ? <Empty>Nothing delivered yet.</Empty> : (
                <ul className="divide-y divide-border text-[13px]">
                  {deliveries.map((d) => (
                    <li key={d.id} className="py-2">
                      <span className="flex items-center justify-between gap-2"><b className="font-medium">{d.number}</b><StatusPill status={d.status} /></span>
                      <span className="block text-[12px] text-muted">{fmt(d.date)} · {d.lines.map((x) => `${qty(x.qty)} ${x.name}`).join(", ")}{d.vehicleNo ? ` · ${d.vehicleNo}` : ""}{d.receivedBy ? ` · received by ${d.receivedBy}` : ""}</span>
                      {meta.me.write && d.status === "dispatched" && <button type="button" className="mt-1 text-[12px] font-medium underline" onClick={() => { const who = window.prompt("Received by"); if (who) pod.mutate({ id: d.id, receivedBy: who }); }}>Mark delivered</button>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {returns.length > 0 && (
            <Section title="Returns">
              <ul className="divide-y divide-border text-[13px]">
                {returns.map((r) => (
                  <li key={r.id} className="py-2"><b className="font-medium">{r.number}</b><span className="block text-[12px] text-muted">{fmt(r.date)} · {r.lines.map((x) => `${qty(x.qty)} ${x.name} (${RETURN_REASONS[x.reason as keyof typeof RETURN_REASONS] ?? x.reason}${x.restock ? "" : ", written off"})`).join(", ")}</span></li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Credit">
            <dl className="grid gap-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Owes on invoices</dt><dd className="tabular-nums">{inr(credit.owed)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Other open orders</dt><dd className="tabular-nums">{inr(credit.onOrder)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Limit</dt><dd className="tabular-nums">{credit.limit ? inr(credit.limit) : "None"}</dd></div>
            </dl>
          </Section>
          <LinkedDocuments type="sales_order" id={o.id} name={o.number} />
        </div>
      </div>
      {delivering && <DeliverDialog order={o} onClose={() => setDelivering(false)} />}
      {returning && <ReturnDialog order={o} onClose={() => setReturning(false)} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => confirm && act.mutate(confirm)} loading={act.isPending} destructive={confirm !== "close"} title={confirm === "close" ? `Close ${o.number}?` : confirm === "cancel" ? `Cancel ${o.number}?` : `Delete ${o.number}?`} description={confirm === "close" ? "What isn't delivered won't be; what's delivered can still be invoiced." : confirm === "cancel" ? "It stays listed as cancelled." : "It's removed for good."} confirmLabel={confirm === "close" ? "Close order" : confirm === "cancel" ? "Cancel order" : "Delete"} />
    </div>
  );
}

function DeliverDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const { meta } = useSales();
  const open = order.lines.filter((l) => l.itemId && l.delivered < l.qty - 0.0005);
  const [f, setF] = useState({ date: todayIst(), warehouseId: order.warehouseId ?? "", vehicleNo: "", transporter: "", qtys: Object.fromEntries(open.map((l) => [l.id, String(Math.round((l.qty - l.delivered) * 1000) / 1000)])) as Record<string, string>, serials: {} as Record<string, string> });
  const serialItem = (l: Line) => !!meta.items.find((i) => i.id === l.itemId)?.trackSerials;
  const split = (v: string | undefined) => (v ?? "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const lines = open.map((l) => ({ lineId: l.id, qty: Number(f.qtys[l.id]) || 0, serials: split(f.serials[l.id]) })).filter((x) => x.qty > 0);
  const missing = open.some((l) => serialItem(l) && (Number(f.qtys[l.id]) || 0) > 0 && split(f.serials[l.id]).length !== (Number(f.qtys[l.id]) || 0));
  const save = useSalesAction(() => ({ path: "deliveries", body: { orderId: order.id, date: f.date, warehouseId: f.warehouseId || null, vehicleNo: f.vehicleNo, transporter: f.transporter, lines } }), { success: "Delivery challan made — stock taken out", onDone: onClose, also: ["inventory"] });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Deliver ${order.number}`} description="A delivery challan takes these out of stock." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!lines.length || missing} onClick={() => save.mutate(undefined)}>Make challan</Button></>}>
      <div className="grid gap-4">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-border">
            {open.map((l) => (
              <tr key={l.id}>
                <td className="py-2">{l.name}<span className="block text-[12px] text-muted">{qty(l.qty - l.delivered)} {l.unit} left</span></td>
                <td className="w-32 py-2"><Input aria-label={`Deliver ${l.name}`} inputMode="decimal" value={f.qtys[l.id]} onChange={(e) => setF({ ...f, qtys: { ...f.qtys, [l.id]: e.target.value } })} /></td>
                {serialItem(l) && <td className="w-56 py-2 pl-2"><Textarea aria-label={`Serial numbers for ${l.name}`} rows={2} value={f.serials[l.id] ?? ""} onChange={(e) => setF({ ...f, serials: { ...f.serials, [l.id]: e.target.value } })} placeholder="Serials, one per line" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          {meta.warehouses.length > 1 && (
            <Field label="From">
              {(a) => (
                <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
                  <option value="">Default location</option>
                  {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Vehicle no.">{(a) => <Input {...a} value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })} maxLength={20} />}</Field>
          <Field label="Transporter">{(a) => <Input {...a} value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} maxLength={100} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function ReturnDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const can = (l: Line) => (l.itemId ? l.delivered - l.returned : l.invoiced);
  const open = order.lines.filter((l) => can(l) > 0.0005);
  const { meta } = useSales();
  const [f, setF] = useState({ date: todayIst(), creditNote: true, rows: Object.fromEntries(open.map((l) => [l.id, { qty: "", reason: "damaged", restock: true, serials: "" }])) as Record<string, { qty: string; reason: string; restock: boolean; serials: string }> });
  const split = (v: string) => v.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const serialItem = (l: Line) => !!meta.items.find((i) => i.id === l.itemId)?.trackSerials;
  const lines = open.map((l) => ({ lineId: l.id, qty: Number(f.rows[l.id].qty) || 0, reason: f.rows[l.id].reason, restock: f.rows[l.id].restock, serials: split(f.rows[l.id].serials) })).filter((x) => x.qty > 0);
  const missing = open.some((l) => serialItem(l) && f.rows[l.id].restock && (Number(f.rows[l.id].qty) || 0) > 0 && split(f.rows[l.id].serials).length !== Number(f.rows[l.id].qty));
  const set = (id: string, p: Partial<{ qty: string; reason: string; restock: boolean; serials: string }>) => setF({ ...f, rows: { ...f.rows, [id]: { ...f.rows[id], ...p } } });
  const save = useSalesAction<void, { creditNote: { href: string } | null }>(() => ({ path: "returns", body: { orderId: order.id, date: f.date, creditNote: f.creditNote, lines } }), { success: (r) => (r.creditNote ? "Return recorded — a draft credit note is ready" : "Return recorded"), onDone: onClose, also: ["inventory"] });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Return on ${order.number}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!lines.length || missing} onClick={() => save.mutate(undefined)}>Record return</Button></>}>
      <div className="grid gap-4">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-border">
            {open.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="py-2">{l.name}<span className="block text-[12px] text-muted">up to {qty(can(l))}</span></td>
                <td className="w-24 py-2 pr-2"><Input aria-label={`Return ${l.name}`} inputMode="decimal" value={f.rows[l.id].qty} onChange={(e) => set(l.id, { qty: e.target.value })} /></td>
                <td className="w-36 py-2 pr-2">
                  <Select aria-label={`Reason for ${l.name}`} value={f.rows[l.id].reason} onChange={(e) => set(l.id, { reason: e.target.value })}>
                    {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </td>
                <td className="w-32 py-2">{l.itemId && <label className="flex items-center gap-2 text-[12.5px]"><Switch checked={f.rows[l.id].restock} onChange={(v) => set(l.id, { restock: v })} label="Back into stock" /> Into stock</label>}{serialItem(l) && f.rows[l.id].restock && <Textarea aria-label={`Serial numbers back for ${l.name}`} rows={2} className="mt-1" value={f.rows[l.id].serials} onChange={(e) => set(l.id, { serials: e.target.value })} placeholder="Serials" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.creditNote} onChange={(v) => setF({ ...f, creditNote: v })} label="Credit note" /> Credit note for what was invoiced</label>
        </div>
      </div>
    </Dialog>
  );
}

