"use client";

// Sales: home, deliveries and returns, customers' terms, price lists,
// commissions and targets, and settings.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { Dialog } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { RETURN_REASONS } from "@/lib/sales/model";
import { Empty, Section, Stat, StatusPill, fmt, fromPaise, inr, qty, short, toPaise, todayIst, useSales, useSalesAction, useSalesQuery, type Customer } from "./shared";
import { useSession } from "@/components/shell/session-context";
import { visibleTo } from "@/lib/workspace/modules";

type Home = { waiting: number; open: { count: number; value: number }; toDeliver: { id: string; number: string; client: string; expectedDate: string | null; late: boolean }[]; toInvoice: { id: string; number: string; client: string }[]; month: { orders: number; value: number }; topCustomers: { name: string; value: number }[]; topItems: { name: string; qty: number; value: number }[] };

export function HomeView() {
  const { meta, go } = useSales();
  const q = useSalesQuery<Home>("home");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Sales" description="Orders to deliver and invoice, and how this month is going." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("orders/new")}>New order</Button>} />
      {!d ? (
        <Skeleton className="h-[50vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open orders" value={d.open.count} sub={`${short(d.open.value)} to invoice`} />
            <Stat label="This month" value={short(d.month.value)} sub={`${d.month.orders} order${d.month.orders === 1 ? "" : "s"}, before tax`} />
            <Stat label="To deliver" value={d.toDeliver.length} sub={d.toDeliver.filter((x) => x.late).length ? `${d.toDeliver.filter((x) => x.late).length} late` : "None late"} />
            <Stat label="Waiting for approval" value={d.waiting} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="To deliver">
              {!d.toDeliver.length ? <Empty>Nothing waiting to go out.</Empty> : (
                <ul className="divide-y divide-border text-[13px]">
                  {d.toDeliver.slice(0, 8).map((o) => <li key={o.id} className="flex justify-between gap-3 py-2"><Link href={`/sales/orders/${o.id}`} className="font-medium hover:underline">{o.number} · {o.client}</Link><span className={cx("text-[12px]", o.late ? "text-danger" : "text-muted")}>{o.expectedDate ? fmt(o.expectedDate, { day: "numeric", month: "short" }) : "—"}</span></li>)}
                </ul>
              )}
            </Section>
            <Section title="To invoice">
              {!d.toInvoice.length ? <Empty>Everything delivered is invoiced.</Empty> : (
                <ul className="divide-y divide-border text-[13px]">
                  {d.toInvoice.slice(0, 8).map((o) => <li key={o.id} className="py-2"><Link href={`/sales/orders/${o.id}`} className="font-medium hover:underline">{o.number} · {o.client}</Link></li>)}
                </ul>
              )}
            </Section>
            <Section title="Top customers (12 months)">
              {!d.topCustomers.length ? <Empty>No orders yet.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.topCustomers.map((c) => <li key={c.name} className="flex justify-between py-2"><span>{c.name}</span><span className="tabular-nums">{short(c.value)}</span></li>)}</ul>}
            </Section>
            <Section title="Top items (12 months)">
              {!d.topItems.length ? <Empty>No orders yet.</Empty> : <ul className="divide-y divide-border text-[13px]">{d.topItems.map((c) => <li key={c.name} className="flex justify-between py-2"><span>{c.name} <span className="text-muted">· {qty(c.qty)}</span></span><span className="tabular-nums">{short(c.value)}</span></li>)}</ul>}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeliveriesView() {
  const q = useSalesQuery<{ deliveries: { id: string; number: string; orderId: string; orderNumber: string; client: string; date: string; status: string; lines: { name: string; qty: number }[]; vehicleNo: string; receivedBy: string }[] }>("deliveries");
  const { org } = useSession();
  const ship = visibleTo(org, "logistics");
  const rows = q.data?.deliveries;
  return (
    <div>
      <PageHeader title="Deliveries" description="Delivery challans: goods that left a location against an order." actions={<ExportMenu name="delivery-challans" rows={rows?.map((d) => ({ ...d, items: d.lines.map((l) => `${qty(l.qty)} ${l.name}`).join("; ") }))} columns={[{ key: "number", label: "Challan" }, { key: "date", label: "Date" }, { key: "orderNumber", label: "Order" }, { key: "client", label: "Customer" }, { key: "items", label: "Items" }, { key: "vehicleNo", label: "Vehicle" }, { key: "status", label: "Status" }, { key: "receivedBy", label: "Received by" }]} />} />
      {!rows ? <Skeleton className="h-60 rounded-[20px]" /> : !rows.length ? <Empty>No challans yet — deliver from an order.</Empty> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <tbody className="divide-y divide-border">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2.5"><b className="font-medium">{d.number}</b><span className="block text-[12px] text-muted">{fmt(d.date)}</span></td>
                  <td className="px-4 py-2.5"><Link href={`/sales/orders/${d.orderId}`} className="hover:underline">{d.orderNumber} · {d.client}</Link><span className="block text-[12px] text-muted">{d.lines.map((l) => `${qty(l.qty)} ${l.name}`).join(", ")}</span></td>
                  <td className="px-4 py-2.5 text-muted">{d.vehicleNo || "—"}</td>
                  <td className="px-4 py-2.5"><StatusPill status={d.status} /></td>
                  <td className="px-4 py-2.5 text-right">{ship && d.status === "dispatched" && <Link href={`/logistics/shipments?challans=${d.id}`} className="text-[12.5px] font-medium underline">Ship</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReturnsView() {
  const q = useSalesQuery<{ returns: { id: string; number: string; orderId: string; orderNumber: string; client: string; date: string; lines: { name: string; qty: number; reason: string; restock: boolean }[]; creditNoteId: string | null }[] }>("returns");
  const rows = q.data?.returns;
  return (
    <div>
      <PageHeader title="Returns" description="Goods customers sent back, and the credit notes for them." actions={<ExportMenu name="sales-returns" rows={rows?.map((r) => ({ ...r, items: r.lines.map((l) => `${qty(l.qty)} ${l.name} (${RETURN_REASONS[l.reason as keyof typeof RETURN_REASONS] ?? l.reason})`).join("; "), credited: r.creditNoteId ? "Yes" : "No" }))} columns={[{ key: "number", label: "Return" }, { key: "date", label: "Date" }, { key: "orderNumber", label: "Order" }, { key: "client", label: "Customer" }, { key: "items", label: "Items" }, { key: "credited", label: "Credit note" }]} />} />
      {!rows ? <Skeleton className="h-60 rounded-[20px]" /> : !rows.length ? <Empty>No returns. Record one from the order.</Empty> : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-[16px] border border-border bg-surface px-4 py-3 text-[13px]">
              <span className="flex justify-between gap-3"><b className="font-medium">{r.number} · {r.client}</b><span className="text-muted">{fmt(r.date)}</span></span>
              <span className="block text-[12px] text-muted"><Link href={`/sales/orders/${r.orderId}`} className="underline">{r.orderNumber}</Link> · {r.lines.map((l) => `${qty(l.qty)} ${l.name} (${RETURN_REASONS[l.reason as keyof typeof RETURN_REASONS] ?? l.reason}${l.restock ? "" : ", written off"})`).join(", ")}{r.creditNoteId ? " · credit note made" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomersView() {
  const { meta, orgId } = useSales();
  const qc = useQueryClient();
  const q = useSalesQuery<{ customers: Customer[] }>("customers");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const rows = (q.data?.customers ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <PageHeader
        title="Customers"
        description="Price lists, credit limits and payment terms for the clients in your invoicing books."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="customer-terms" rows={rows.map((c) => ({ ...c, priceList: meta.lists.find((l) => l.id === c.terms?.priceListId)?.name ?? "", creditLimit: c.terms?.creditLimit ?? 0, paymentTermsDays: c.terms?.paymentTermsDays ?? "", discountPct: c.terms?.discountPct ?? "", salesperson: meta.people.find((p) => p.id === c.terms?.salespersonId)?.name ?? "", onHold: c.terms?.onHold ? "Yes" : "" }))} columns={[{ key: "name", label: "Customer" }, { key: "gstin", label: "GSTIN" }, { key: "priceList", label: "Price list" }, { key: "creditLimit", label: "Credit limit", money: true }, { key: "paymentTermsDays", label: "Payment terms (days)" }, { key: "discountPct", label: "Discount %" }, { key: "salesperson", label: "Salesperson" }, { key: "onHold", label: "On hold" }, { key: "owed", label: "Owes", money: true }, { key: "onOrder", label: "On order", money: true }]} />
            {meta.me.manage && <ImportButton target={target("sales.customers")} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/sales/customers/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["sales", orgId] })} />}
          </div>
        }
      />
      <Input aria-label="Search customers" className="mb-4 !w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !rows.length ? <EmptyState title="No customers" description="Customers are the clients in your invoicing books. Add one there, or import your client list." /> : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Price list</th>
                <th className="px-4 py-2.5 text-right font-medium">Owes</th>
                <th className="px-4 py-2.5 text-right font-medium">On order</th>
                <th className="px-4 py-2.5 text-right font-medium">Limit</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.clientId}>
                  <td className="px-4 py-2.5"><b className="font-medium">{c.name}</b>{c.terms?.onHold && <span className="ml-2 text-[11.5px] font-semibold text-danger">On hold</span>}<span className="block text-[12px] text-muted">{[c.gstin, c.state, meta.books.length > 1 ? c.book : ""].filter(Boolean).join(" · ") || "—"}{c.terms ? ` · ${c.terms.paymentTermsDays} days` : ""}</span></td>
                  <td className="px-4 py-2.5 text-muted">{meta.lists.find((l) => l.id === c.terms?.priceListId)?.name ?? "Standard"}{c.terms?.discountPct ? ` · ${c.terms.discountPct}% off` : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(c.owed)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(c.onOrder)}</td>
                  <td className={cx("px-4 py-2.5 text-right tabular-nums", c.headroom !== null && c.headroom < 0 && "font-semibold text-danger")}>{c.limit ? inr(c.limit) : "—"}</td>
                  <td className="px-2 text-right">{meta.me.manage && <Button size="sm" onClick={() => setEditing(c)}>Terms</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TermsDialog c={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TermsDialog({ c, onClose }: { c: Customer; onClose: () => void }) {
  const { meta } = useSales();
  const t = c.terms;
  const [f, setF] = useState({ priceListId: t?.priceListId ?? "", creditLimit: fromPaise(t?.creditLimit), paymentTermsDays: String(t?.paymentTermsDays ?? 30), discountPct: t?.discountPct ? String(t.discountPct) : "", salespersonId: t?.salespersonId ?? "", onHold: t?.onHold ?? false, notes: t?.notes ?? "" });
  const save = useSalesAction(() => ({ path: "customers", body: { ownerId: c.ownerId, clientId: c.clientId, priceListId: f.priceListId || null, creditLimit: toPaise(f.creditLimit), paymentTermsDays: Number(f.paymentTermsDays) || 0, discountPct: Number(f.discountPct) || 0, salespersonId: f.salespersonId || null, onHold: f.onHold, notes: f.notes } }), { success: "Terms saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Terms for ${c.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price list">
          {(a) => (
            <Select {...a} value={f.priceListId} onChange={(e) => setF({ ...f, priceListId: e.target.value })}>
              <option value="">Standard</option>
              {meta.lists.filter((l) => !l.isDefault).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Usual discount %" hint="On standard prices">{(a) => <Input {...a} inputMode="decimal" value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: e.target.value })} />}</Field>
        <Field label="Credit limit (₹)" hint="Empty for no limit">{(a) => <Input {...a} inputMode="decimal" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} />}</Field>
        <Field label="Days to pay">{(a) => <Input {...a} inputMode="numeric" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value.replace(/\D/g, "") })} />}</Field>
        <Field label="Salesperson">
          {(a) => (
            <Select {...a} value={f.salespersonId} onChange={(e) => setF({ ...f, salespersonId: e.target.value })}>
              <option value="">None</option>
              {meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]"><Switch checked={f.onHold} onChange={(v) => setF({ ...f, onHold: v })} label="On hold" /> On hold (no new orders)</label>
      </div>
    </Dialog>
  );
}

type List = { id: string; name: string; kind: string; discountPct: number; validFrom: string | null; validTo: string | null; isDefault: boolean; active: boolean; items: number; notes: string };

export function PriceListsView() {
  const { meta, go } = useSales();
  const q = useSalesQuery<{ lists: List[] }>("price-lists");
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader title="Price lists" description="Standard prices, and lists for groups of customers: fixed prices with quantity breaks, or a discount off standard. Lists can run between dates." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Price list</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.lists.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => go(`price-lists/${l.id}`)} className="w-full rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2">
                <span className="flex items-center justify-between gap-2"><b className="text-[14.5px] font-semibold">{l.name}</b>{l.isDefault && <span className="text-[11.5px] font-semibold text-accent">Default</span>}{!l.active && <span className="text-[11.5px] text-muted">Off</span>}</span>
                <span className="mt-1 block text-[12.5px] text-muted">{l.kind === "discount" ? `${l.discountPct}% off standard` : `${l.items} price${l.items === 1 ? "" : "s"}`}{l.validFrom || l.validTo ? ` · ${l.validFrom ? fmt(l.validFrom) : "…"} – ${l.validTo ? fmt(l.validTo) : "…"}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <ListDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function ListDialog({ init, onClose }: { init?: List; onClose: () => void }) {
  const { go } = useSales();
  const [f, setF] = useState({ name: init?.name ?? "", kind: init?.kind ?? "fixed", discountPct: init?.discountPct ? String(init.discountPct) : "", validFrom: init?.validFrom ?? "", validTo: init?.validTo ?? "", isDefault: init?.isDefault ?? false, active: init?.active ?? true, notes: init?.notes ?? "" });
  const save = useSalesAction<void, { list: { id: string } }>(() => ({ path: init ? `price-lists/${init.id}` : "price-lists", method: init ? "PUT" : "POST", body: { ...f, discountPct: Number(f.discountPct) || 0, validFrom: f.validFrom || null, validTo: f.validTo || null } }), { success: "Saved", onDone: (r) => (onClose(), !init && go(`price-lists/${r.list.id}`)) });
  return (
    <Dialog open onClose={onClose} title={init ? `Edit ${init.name}` : "New price list"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Dealers" />}</Field>
        <Field label="Kind">
          {(a) => (
            <Select {...a} value={f.kind} disabled={init?.isDefault} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="fixed">Fixed prices</option>
              <option value="discount">Discount off standard</option>
            </Select>
          )}
        </Field>
        {f.kind === "discount" && <Field label="Discount %">{(a) => <Input {...a} inputMode="decimal" value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: e.target.value })} />}</Field>}
        <Field label="From">{(a) => <Input {...a} type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />}</Field>
        {init && !init.isDefault && <label className="flex items-center gap-2 text-[13px]"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" /> In use</label>}
      </div>
    </Dialog>
  );
}

export function PriceListPage({ id }: { id: string }) {
  const { meta, orgId } = useSales();
  const qc = useQueryClient();
  const q = useSalesQuery<{ list: List; items: { id: string; itemId: string; name: string; sku: string; unit: string; price: number; minQty: number; avgCost: number }[] }>(`price-lists/${id}`);
  const [editing, setEditing] = useState(false);
  const [row, setRow] = useState({ itemId: "", price: "", minQty: "" });
  const set = useSalesAction<{ itemId: string; price: number; minQty: number; remove?: boolean }>((b) => ({ path: `price-lists/${id}/prices`, body: b }), { success: "Saved", onDone: () => setRow({ itemId: "", price: "", minQty: "" }) });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { list, items } = q.data;
  return (
    <div>
      <Link href="/sales/price-lists" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Price lists</Link>
      <PageHeader title={list.name} description={list.kind === "discount" ? `${list.discountPct}% off standard prices` : "Fixed prices; a lower price can start from a quantity."} actions={meta.me.manage && <div className="flex gap-2">{list.kind === "fixed" && <ImportButton target={target("sales.prices")} onImport={(r, mode) => api(`/api/v1/orgs/${orgId}/sales/price-lists/${id}/import`, { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["sales", orgId] })} />}<ExportMenu name={`prices-${list.name}`} rows={items.map((i) => ({ ...i, item: i.sku || i.name }))} columns={[{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "price", label: "Price", money: true }, { key: "minQty", label: "From quantity" }]} /><Button size="sm" onClick={() => setEditing(true)}>Edit</Button></div>} />
      {list.kind === "fixed" && (
        <Section title="Prices">
          {meta.me.manage && meta.items.length > 0 && (
            <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_120px_auto]">
              <Select aria-label="Item" value={row.itemId} onChange={(e) => setRow({ ...row, itemId: e.target.value })}>
                <option value="">Add an item…</option>
                {meta.items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` · ${it.sku}` : ""}</option>)}
              </Select>
              <Input aria-label="Price (₹)" inputMode="decimal" placeholder="Price ₹" value={row.price} onChange={(e) => setRow({ ...row, price: e.target.value })} />
              <Input aria-label="From quantity" inputMode="decimal" placeholder="From qty" value={row.minQty} onChange={(e) => setRow({ ...row, minQty: e.target.value })} />
              <Button variant="primary" disabled={!row.itemId || !toPaise(row.price)} loading={set.isPending} onClick={() => set.mutate({ itemId: row.itemId, price: toPaise(row.price), minQty: Number(row.minQty) || 0 })}>Set price</Button>
            </div>
          )}
          {!items.length ? <Empty>No prices yet. {meta.items.length ? "Add items above, or import a rate list." : "Add items in Inventory first."}</Empty> : (
            <table className="w-full text-[13px]">
              <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Item</th><th className="py-1.5 font-medium">From qty</th><th className="py-1.5 font-medium">Price</th><th className="py-1.5 font-medium">Margin</th><th className="w-8" /></tr></thead>
              <tbody className="divide-y divide-border text-right tabular-nums">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 text-left">{i.name}<span className="block text-[12px] text-muted">{i.sku}</span></td>
                    <td className="py-2">{i.minQty ? qty(i.minQty) : "Any"}</td>
                    <td className="py-2 font-medium">{inr(i.price)}</td>
                    <td className={cx("py-2", i.avgCost && i.price < i.avgCost && "text-danger")}>{i.avgCost ? `${Math.round(((i.price - i.avgCost) / i.price) * 100)}%` : "—"}</td>
                    <td>{meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${i.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => set.mutate({ itemId: i.itemId, price: 0, minQty: i.minQty, remove: true })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
      {editing && <ListDialog init={list} onClose={() => setEditing(false)} />}
    </div>
  );
}

type Commissions = { from: string; to: string; lines: { userId: string | null; name: string; invoiced: number; collected: number; plan: { name: string; ratePct: number; basis: string } | null; commission: number; target: number; achieved: number | null }[]; total: number };

export function CommissionsView() {
  const { meta } = useSales();
  const [range, setRange] = useState({ from: `${todayIst().slice(0, 7)}-01`, to: todayIst() });
  const q = useSalesQuery<Commissions>(`commissions?from=${range.from}&to=${range.to}`, { keepPrevious: true });
  const plans = useSalesQuery<{ plans: { id: string; name: string; userId: string | null; ratePct: number; basis: string; active: boolean }[] }>(meta.me.manage ? "plans" : null);
  const [planning, setPlanning] = useState(false);
  const [targeting, setTargeting] = useState(false);
  const del = useSalesAction<string>((id) => ({ path: `plans/${id}`, method: "DELETE" }), { success: "Plan removed" });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Commissions & targets" description="Sales before tax from each salesperson's orders: invoiced (less credit notes) and collected." actions={<div className="flex gap-2">{d && <ExportMenu name="commissions" rows={d.lines.map((l) => ({ ...l, plan: l.plan?.name ?? "" }))} columns={[{ key: "name", label: "Salesperson" }, { key: "invoiced", label: "Invoiced", money: true }, { key: "collected", label: "Collected", money: true }, { key: "plan", label: "Plan" }, { key: "commission", label: "Commission", money: true }, { key: "target", label: "Target", money: true }, { key: "achieved", label: "Achieved %" }]} />}{meta.me.manage && <><Button size="sm" onClick={() => setTargeting(true)}>Set a target</Button><Button size="sm" variant="primary" onClick={() => setPlanning(true)}>Commission plan</Button></>}</div>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From">{(a) => <Input {...a} type="date" className="!w-44" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" className="!w-44" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      </div>
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <Section title={`Commission · ${inr(d.total)}`}>
            {!d.lines.length ? <Empty>No sales from orders in this period.</Empty> : (
              <table className="w-full text-[13px]">
                <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Salesperson</th><th className="py-1.5 font-medium">Invoiced</th><th className="py-1.5 font-medium">Collected</th><th className="py-1.5 font-medium">Commission</th><th className="py-1.5 font-medium">Target</th></tr></thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.lines.map((l) => (
                    <tr key={l.userId ?? "none"}>
                      <td className="py-2 text-left">{l.name}<span className="block text-[12px] text-muted">{l.plan ? `${l.plan.name} · ${l.plan.ratePct}% of ${l.plan.basis}` : "No plan"}</span></td>
                      <td className="py-2">{inr(l.invoiced)}</td>
                      <td className="py-2">{inr(l.collected)}</td>
                      <td className="py-2 font-semibold">{inr(l.commission)}</td>
                      <td className="py-2">{l.target ? <span>{l.achieved}% <span className="text-muted">of {short(l.target)}</span></span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          {meta.me.manage && plans.data && (
            <Section title="Plans">
              {!plans.data.plans.length ? <Empty>No commission plans. A plan for everyone applies to salespeople without their own.</Empty> : (
                <ul className="divide-y divide-border text-[13px]">
                  {plans.data.plans.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 py-2"><span><b className="font-medium">{p.name}</b> <span className="text-muted">· {p.userId ? meta.people.find((x) => x.id === p.userId)?.name : "Everyone"} · {p.ratePct}% of {p.basis}{p.active ? "" : " · off"}</span></span><Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(p.id)} /></li>)}
                </ul>
              )}
            </Section>
          )}
        </div>
      )}
      {planning && <PlanDialog onClose={() => setPlanning(false)} />}
      {targeting && <TargetDialog onClose={() => setTargeting(false)} />}
    </div>
  );
}

function PlanDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useSales();
  const [f, setF] = useState({ name: "", userId: "", ratePct: "", basis: "invoiced" });
  const save = useSalesAction(() => ({ path: "plans", body: { ...f, userId: f.userId || null, ratePct: Number(f.ratePct) || 0 } }), { success: "Plan saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Commission plan" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !(Number(f.ratePct) > 0)} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Standard" />}</Field>
        <Field label="For">
          {(a) => (
            <Select {...a} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
              <option value="">Everyone without a plan</option>
              {meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Rate %">{(a) => <Input {...a} inputMode="decimal" value={f.ratePct} onChange={(e) => setF({ ...f, ratePct: e.target.value })} />}</Field>
        <Field label="On">
          {(a) => (
            <Select {...a} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })}>
              <option value="invoiced">What&apos;s invoiced</option>
              <option value="collected">What&apos;s collected</option>
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function TargetDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useSales();
  const [f, setF] = useState({ userId: meta.people[0]?.id ?? "", month: todayIst().slice(0, 7), amount: "" });
  const save = useSalesAction(() => ({ path: "targets", body: { ...f, amount: toPaise(f.amount) } }), { success: "Target set", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Monthly target" description="Sales before tax. Empty clears it." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.userId} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Salesperson">
          {(a) => (
            <Select {...a} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
              {meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Month">{(a) => <Input {...a} type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />}</Field>
        <Field label="Target (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function SettingsView() {
  const { meta } = useSales();
  const s = meta.settings;
  const [f, setF] = useState({ ...s, maxDiscountPct: String(s.maxDiscountPct) });
  const save = useSalesAction(() => ({ path: "settings", method: "PUT", body: { ...f, maxDiscountPct: Number(f.maxDiscountPct) || 0, defaultWarehouseId: f.defaultWarehouseId || null, defaultOwnerId: f.defaultOwnerId || null } }), { success: "Settings saved" });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Sales settings" actions={<Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>} />
      <div className="grid gap-5">
        <Section title="Approval and credit">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discounts above this need approval (%)" hint="0 for never">{(a) => <Input {...a} inputMode="decimal" value={f.maxDiscountPct} onChange={(e) => setF({ ...f, maxDiscountPct: e.target.value })} />}</Field>
            <Field label="Over a customer's credit limit">
              {(a) => (
                <Select {...a} value={f.creditCheck} onChange={(e) => setF({ ...f, creditCheck: e.target.value as typeof f.creditCheck })}>
                  <option value="approve">Needs approval</option>
                  <option value="block">Can&apos;t be confirmed</option>
                  <option value="warn">Only warn</option>
                </Select>
              )}
            </Field>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Held orders follow an approval rule for sales orders (Settings → Approvals) if there is one; otherwise an owner or admin approves them here.</p>
        </Section>
        <Section title="Invoicing and delivery">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice goods">
              {(a) => (
                <Select {...a} value={f.invoiceOn} onChange={(e) => setF({ ...f, invoiceOn: e.target.value as typeof f.invoiceOn })}>
                  <option value="delivery">As they&apos;re delivered</option>
                  <option value="order">As ordered (before delivery)</option>
                </Select>
              )}
            </Field>
            {meta.warehouses.length > 0 && (
              <Field label="Deliver from">
                {(a) => (
                  <Select {...a} value={f.defaultWarehouseId ?? ""} onChange={(e) => setF({ ...f, defaultWarehouseId: e.target.value || null })}>
                    <option value="">The default location</option>
                    {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Order prefix">{(a) => <Input {...a} value={f.orderPrefix} onChange={(e) => setF({ ...f, orderPrefix: e.target.value })} maxLength={8} />}</Field>
            <Field label="Challan prefix">{(a) => <Input {...a} value={f.challanPrefix} onChange={(e) => setF({ ...f, challanPrefix: e.target.value })} maxLength={8} />}</Field>
          </div>
        </Section>
      </div>
    </div>
  );
}
