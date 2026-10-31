"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Download, FileText, Printer, Package, PackageCheck, Receipt, RotateCcw, Search, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { CARRIERS } from "@/lib/store/shipping";
import { LabelCard, ShipmentCard } from "./operations";
import { MoneyInput, OrderBadges, PAYMENT_LABEL, storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery } from "./shared";

type OrderRow = { id: string; number: number; email: string; name: string; total: number; currency: string; paymentMethod: string; financialStatus: string; fulfillmentStatus: string; cancelledAt: string | null; createdAt: string; items: number };
type Address = { name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string };
type OrderDetailT = {
  order: OrderRow & {
    phone: string;
    shippingAddress: Address;
    subtotal: number;
    discountTotal: number;
    shippingTotal: number;
    taxTotal: number;
    feeTotal: number;
    refundedTotal: number;
    giftCardTotal: number;
    giftCardCode: string | null;
    shipment: { provider: string; shipmentId?: string; awb?: string; courier?: string; labelUrl?: string; status?: string } | null;
    taxIncluded: boolean;
    discountCode: string | null;
    shippingMethod: { name?: string; eta?: string } | null;
    paymentRef: string | null;
    tracking: { carrier: string; number: string; url: string } | null;
    note: string;
    cancelReason: string | null;
    customerId: string | null;
    reservedUntil: string | null;
  };
  items: { id: string; productId: string | null; title: string; variantTitle: string; sku: string; image: string; unitPrice: number; quantity: number; total: number }[];
  events: { id: string; kind: string; message: string; createdAt: string; actorName: string | null }[];
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "to_fulfill", label: "To fulfil" },
  { value: "unpaid", label: "Unpaid" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function OrdersView() {
  const { base, store, projectId } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<(typeof FILTERS)[number]["value"]>("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ status, q: search, offset: String(page * 50) });
  const list = useStoreQuery<{ orders: OrderRow[]; total: number }>(`orders?${params}`);
  const bulk = useMutation({
    mutationFn: (action: "packed" | "delivered") => api<{ done: string[]; failed: { id: string; error: string }[] }>(storeApi(projectId, "orders/bulk"), { method: "POST", body: { ids: selected, action } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setSelected([]);
      toast({ tone: r.failed.length ? "info" : "success", title: `${r.done.length} order${r.done.length === 1 ? "" : "s"} updated`, description: r.failed.length ? `${r.failed.length} skipped: ${r.failed[0].error}` : undefined });
    },
    onError: (e) => toast({ tone: "error", title: "Could not update orders", description: errorMessage(e) }),
  });
  const rows = list.data?.orders ?? [];
  const allOn = rows.length > 0 && rows.every((o) => selected.includes(o.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      <SubHeader
        title="Orders"
        description="Every order placed on your store. Click one to pack, ship, refund or print an invoice."
        actions={
          <ButtonLink href={storeApi(projectId, "orders/export")} external icon={<Download className="size-3.5" />}>
            Export CSV
          </ButtonLink>
        }
      />
      <Tabs value={status} onChange={(v) => { setStatus(v); setPage(0); setSelected([]); }} tabs={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(0); }}>
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search orders" className="pl-8" placeholder="Order number, name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      <div className="mt-4">
        {list.isPending ? (
          <Skeleton className="h-64" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : (
          <>
            {selected.length > 0 && (
              <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-2 shadow-md">
                <span className="mr-auto text-[13px] font-medium">{selected.length} selected</span>
                <ButtonLink size="sm" href={storeApi(projectId, `orders/slips?ids=${selected.join(",")}`)} external icon={<Printer className="size-3.5" />}>
                  Packing slips
                </ButtonLink>
                <ButtonLink size="sm" href={storeApi(projectId, `orders/export?ids=${selected.join(",")}`)} external icon={<Download className="size-3.5" />}>
                  Export
                </ButtonLink>
                <Button size="sm" loading={bulk.isPending && bulk.variables === "packed"} onClick={() => bulk.mutate("packed")}>
                  Mark packed
                </Button>
                <Button size="sm" loading={bulk.isPending && bulk.variables === "delivered"} onClick={() => bulk.mutate("delivered")}>
                  Mark delivered
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            )}
            <Table
              head={[<input key="all" type="checkbox" aria-label="Select all orders on this page" checked={allOn} onChange={() => setSelected(allOn ? [] : rows.map((o) => o.id))} />, "Order", "Date", "Customer", "Status", "Items", "Total"]}
              empty={list.data.orders.length === 0 && <EmptyState icon={<Receipt className="size-5" />} title={search || status ? "No matching orders" : "No orders yet"} description={search || status ? "Try a different filter." : "When customers buy from your store, orders appear here."} />}
            >
              {list.data.orders.map((o) => (
                <tr key={o.id} className={selected.includes(o.id) ? "bg-accent-soft/40" : "hover:bg-surface-2/60"}>
                  <td className={`${td} w-8`}>
                    <input type="checkbox" aria-label={`Select order ${store.orderPrefix}${o.number}`} checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                  </td>
                  <td className={td}>
                    <Link href={`${base}/orders/${o.id}`} className="font-medium hover:underline">
                      {store.orderPrefix}
                      {o.number}
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`} title={dateTime(o.createdAt)}>
                    {timeAgo(o.createdAt)}
                  </td>
                  <td className={`${td} max-w-[220px]`}>
                    <p className="truncate">{o.name}</p>
                    <p className="truncate text-xs text-muted">{o.email}</p>
                  </td>
                  <td className={td}>
                    <OrderBadges financial={o.financialStatus} fulfillment={o.fulfillmentStatus} cancelled={o.cancelledAt} method={o.paymentMethod} />
                  </td>
                  <td className={`${td} tabular-nums`}>{o.items}</td>
                  <td className={`${td} text-right font-medium tabular-nums`}>{money(o.total)}</td>
                </tr>
              ))}
            </Table>
            {list.data.total > 50 && (
              <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
                <span>
                  {page * 50 + 1}–{Math.min(list.data.total, page * 50 + 50)} of {list.data.total}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export function OrderDetail({ id }: { id: string }) {
  const { projectId, base, store, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<OrderDetailT>(`orders/${id}`);
  const [dialog, setDialog] = useState<null | "ship" | "cancel" | "refund" | "paid" | "delivered">(null);
  const [note, setNote] = useState("");

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<OrderDetailT>(storeApi(projectId, `orders/${id}`), { method: "POST", body }),
    onSuccess: (data, body) => {
      qc.setQueryData(["store", projectId, `orders/${id}`], data);
      qc.invalidateQueries({ queryKey: ["store", projectId], predicate: (k) => String(k.queryKey[2] ?? "").startsWith("orders?") || String(k.queryKey[2] ?? "").startsWith("insights") });
      setDialog(null);
      if (body.action === "note") setNote("");
      else toast({ tone: "success", title: { mark_paid: "Marked as paid", fulfill: "Order updated", cancel: "Order cancelled", refund: "Refund recorded" }[body.action as string] ?? "Saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not update the order", description: errorMessage(e) }),
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { order: o, items, events } = q.data;
  const a = o.shippingAddress;
  const cancelled = !!o.cancelledAt;
  const paid = ["paid", "partially_refunded"].includes(o.financialStatus);
  const canOrders = can("store:orders");
  const label = `${store.orderPrefix}${o.number}`;

  return (
    <div>
      <SubHeader
        back={{ href: `${base}/orders`, label: "Orders" }}
        title={`Order ${label}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {dateTime(o.createdAt)} <OrderBadges financial={o.financialStatus} fulfillment={o.fulfillmentStatus} cancelled={o.cancelledAt} method={o.paymentMethod} />
          </span>
        }
        actions={
          <>
            <ButtonLink href={storeApi(projectId, `orders/${id}/invoice`)} external icon={<FileText className="size-3.5" />}>
              Invoice
            </ButtonLink>
            {canOrders && !cancelled && o.fulfillmentStatus !== "shipped" && o.fulfillmentStatus !== "delivered" && (
              <Button variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => setDialog("cancel")}>
                Cancel order
              </Button>
            )}
          </>
        }
      />

      {cancelled && <div className="mb-4 rounded-[var(--radius-md)] bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">Cancelled {timeAgo(o.cancelledAt!)}{o.cancelReason ? ` — ${o.cancelReason}` : ""}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* Next step: the one thing to do with this order. */}
          {canOrders && !cancelled && (
            <NextStep
              o={o}
              onPaid={() => setDialog("paid")}
              onPack={() => act.mutate({ action: "fulfill", status: "packed" })}
              onShip={() => setDialog("ship")}
              onDelivered={() => setDialog("delivered")}
              busy={act.isPending}
            />
          )}

          <Card>
            <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Items</h2>
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                  <div className="size-12 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- product image */}
                    {i.image && <img src={i.image} alt="" className="size-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {i.productId ? (
                      <Link href={`${base}/products/${i.productId}`} className="block truncate font-medium hover:underline">
                        {i.title}
                      </Link>
                    ) : (
                      <p className="truncate font-medium">{i.title}</p>
                    )}
                    <p className="truncate text-xs text-muted">{[i.variantTitle !== "Default" && i.variantTitle, i.sku && `SKU ${i.sku}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="text-muted tabular-nums">
                    {money(i.unitPrice)} × {i.quantity}
                  </span>
                  <span className="w-24 text-right font-medium tabular-nums">{money(i.total)}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
              <Row k="Subtotal" v={money(o.subtotal)} />
              {o.discountTotal > 0 && <Row k={`Discount${o.discountCode ? ` (${o.discountCode})` : ""}`} v={`−${money(o.discountTotal)}`} />}
              <Row k={`Shipping${o.shippingMethod?.name ? ` · ${o.shippingMethod.name}` : ""}`} v={o.shippingTotal ? money(o.shippingTotal) : "Free"} />
              {o.feeTotal > 0 && <Row k="Payment fee" v={money(o.feeTotal)} />}
              <Row k={o.taxIncluded ? "Tax (included)" : "Tax"} v={money(o.taxTotal)} />
              <Row k="Total" v={money(o.total)} strong />
              {o.giftCardTotal > 0 && <Row k={`Paid by gift card${o.giftCardCode ? ` (${o.giftCardCode})` : ""}`} v={`−${money(o.giftCardTotal)}`} />}
              {o.giftCardTotal > 0 && o.giftCardTotal < o.total && <Row k={`Paid by ${PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}`} v={money(o.total - o.giftCardTotal)} />}
              {o.refundedTotal > 0 && <Row k="Refunded" v={`−${money(o.refundedTotal)}`} />}
            </dl>
            {canOrders && paid && can("store:refund") && o.refundedTotal < o.total && (
              <div className="flex justify-end border-t border-border px-4 py-3">
                <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setDialog("refund")}>
                  Refund
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Timeline</h2>
            {canOrders && (
              <form
                className="flex gap-2 border-b border-border px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) act.mutate({ action: "note", note });
                }}
              >
                <Input aria-label="Add a note" placeholder="Add a private note (only your team sees it)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                <Button type="submit" disabled={!note.trim()} loading={act.isPending && act.variables?.action === "note"}>
                  Add
                </Button>
              </form>
            )}
            <ol className="px-4 py-2">
              {events.map((e) => (
                <li key={e.id} className="relative border-l border-border py-2 pl-4 text-[13px] last:pb-1">
                  <span className="absolute top-3.5 -left-[4px] size-[7px] rounded-full bg-border-strong" aria-hidden />
                  <p className={e.kind === "note" ? "whitespace-pre-wrap" : ""}>{e.message}</p>
                  <p className="text-xs text-subtle" title={dateTime(e.createdAt)}>
                    {e.actorName ? `${e.actorName} · ` : ""}
                    {timeAgo(e.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 text-[13px]">
            <h2 className="text-xs font-medium text-muted">Customer</h2>
            <p className="mt-1.5 font-medium">{a.name}</p>
            {o.customerId && can("store:orders") ? (
              <Link href={`${base}/customers/${o.customerId}`} className="block truncate text-accent hover:underline">
                {o.email}
              </Link>
            ) : (
              <p className="truncate">{o.email}</p>
            )}
            {o.phone && (
              <a href={`tel:${o.phone}`} className="block text-muted hover:text-fg">
                {o.phone}
              </a>
            )}
            <h2 className="mt-4 text-xs font-medium text-muted">Ship to</h2>
            <address className="mt-1.5 not-italic">
              {a.line1}
              {a.line2 && <>, {a.line2}</>}
              <br />
              {a.city}, {a.region} {a.postalCode}
              <br />
              {a.country}
            </address>
            {o.note && (
              <>
                <h2 className="mt-4 text-xs font-medium text-muted">Customer note</h2>
                <p className="mt-1.5 whitespace-pre-wrap">{o.note}</p>
              </>
            )}
          </Card>
          <LabelCard
            orderId={o.id}
            shipment={o.shipment as never}
            eligible={!cancelled && (o.fulfillmentStatus === "unfulfilled" || o.fulfillmentStatus === "packed") && (paid || o.paymentMethod === "cod")}
            onUpdated={(data) => {
              qc.setQueryData(["store", projectId, `orders/${id}`], data);
              qc.invalidateQueries({ queryKey: ["store", projectId], predicate: (k) => String(k.queryKey[2] ?? "").startsWith("orders?") });
            }}
          />
          <ShipmentCard
            orderId={o.id}
            shipment={o.shipment}
            eligible={!cancelled && (o.fulfillmentStatus === "unfulfilled" || o.fulfillmentStatus === "packed") && (paid || o.paymentMethod === "cod")}
            onUpdated={(data) => {
              qc.setQueryData(["store", projectId, `orders/${id}`], data);
              qc.invalidateQueries({ queryKey: ["store", projectId], predicate: (k) => String(k.queryKey[2] ?? "").startsWith("orders?") });
            }}
          />
          <Card className="p-4 text-[13px]">
            <h2 className="text-xs font-medium text-muted">Payment</h2>
            <p className="mt-1.5 font-medium">{PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}</p>
            {o.paymentRef && <p className="truncate font-mono text-xs text-muted" title={o.paymentRef}>{o.paymentRef}</p>}
            {o.financialStatus === "pending" && o.reservedUntil && !cancelled && <p className="mt-1 text-xs text-muted">Stock is held until {dateTime(o.reservedUntil)}; unpaid online orders are cancelled after that.</p>}
            {o.tracking && (
              <>
                <h2 className="mt-4 text-xs font-medium text-muted">Tracking</h2>
                <p className="mt-1.5">{o.tracking.carrier}</p>
                {o.tracking.url ? (
                  <a href={o.tracking.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">
                    {o.tracking.number}
                  </a>
                ) : (
                  <p className="font-mono text-xs">{o.tracking.number}</p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>

      <ShipDialog open={dialog === "ship"} onClose={() => setDialog(null)} loading={act.isPending} onShip={(b) => act.mutate({ action: "fulfill", status: "shipped", ...b })} />
      <ConfirmDialog open={dialog === "paid"} onClose={() => setDialog(null)} onConfirm={() => act.mutate({ action: "mark_paid" })} loading={act.isPending} title="Mark as paid?" description={`Only do this once ${money(o.total)} has reached your account. The customer is emailed a payment confirmation.`} confirmLabel="Mark as paid" />
      <ConfirmDialog
        open={dialog === "delivered"}
        onClose={() => setDialog(null)}
        onConfirm={() => act.mutate({ action: "fulfill", status: "delivered" })}
        loading={act.isPending}
        title="Mark as delivered?"
        description={o.paymentMethod === "cod" && o.financialStatus === "pending" ? `This also records the ${money(o.total)} cash collected on delivery as paid.` : "The customer is emailed that their order arrived."}
        confirmLabel="Mark delivered"
      />
      <CancelDialog open={dialog === "cancel"} onClose={() => setDialog(null)} loading={act.isPending} paid={paid} onCancel={(b) => act.mutate({ action: "cancel", ...b })} />
      <RefundDialog
        open={dialog === "refund"}
        onClose={() => setDialog(null)}
        loading={act.isPending}
        remaining={o.total - o.refundedTotal}
        online={["stripe", "razorpay", "paypal"].includes(o.paymentMethod)}
        method={PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}
        onRefund={(b) => act.mutate({ action: "refund", ...b })}
      />
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "pt-1 text-sm font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function NextStep({ o, onPaid, onPack, onShip, onDelivered, busy }: { o: OrderDetailT["order"]; onPaid: () => void; onPack: () => void; onShip: () => void; onDelivered: () => void; busy: boolean }) {
  const unpaidManual = o.financialStatus === "pending" && o.paymentMethod === "manual";
  const unpaidOnline = o.financialStatus === "pending" && ["stripe", "razorpay", "paypal"].includes(o.paymentMethod);
  let icon = <PackageCheck className="size-5" />;
  let title = "";
  let body = "";
  let action: React.ReactNode = null;
  if (unpaidOnline) {
    icon = <Wallet className="size-5" />;
    title = "Waiting for online payment";
    body = "The customer has not finished paying yet. Payment is confirmed automatically by the provider — there is nothing to do.";
  } else if (unpaidManual) {
    icon = <Wallet className="size-5" />;
    title = "Waiting for UPI / bank transfer";
    body = "Check your bank or UPI app. When the money arrives, mark the order as paid and it will move to packing.";
    action = <Button variant="primary" onClick={onPaid} icon={<CheckCircle2 className="size-3.5" />}>Mark as paid</Button>;
  } else if (o.fulfillmentStatus === "unfulfilled") {
    icon = <Package className="size-5" />;
    title = o.paymentMethod === "cod" ? "Ready to pack (cash on delivery)" : "Paid — ready to pack";
    body = "Pick and pack the items, then add tracking when you hand it to the courier.";
    action = (
      <div className="flex gap-2">
        <Button onClick={onPack} loading={busy}>Mark packed</Button>
        <Button variant="primary" onClick={onShip} icon={<Truck className="size-3.5" />}>Ship with tracking</Button>
      </div>
    );
  } else if (o.fulfillmentStatus === "packed") {
    icon = <Truck className="size-5" />;
    title = "Packed — ready to ship";
    body = "Add the courier and tracking number. The customer gets an email with a tracking link.";
    action = <Button variant="primary" onClick={onShip} icon={<Truck className="size-3.5" />}>Ship with tracking</Button>;
  } else if (o.fulfillmentStatus === "shipped") {
    title = "On its way";
    body = o.paymentMethod === "cod" && o.financialStatus === "pending" ? "Once the courier confirms delivery and the cash is collected, mark it delivered." : "Mark it delivered when the courier confirms.";
    action = <Button variant="primary" onClick={onDelivered}>Mark delivered</Button>;
  } else return null;
  return (
    <Card className="flex flex-wrap items-center gap-4 border-accent/30 bg-accent-soft/40 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="text-xs text-muted">{body}</p>
      </div>
      {action}
    </Card>
  );
}

function ShipDialog({ open, onClose, onShip, loading }: { open: boolean; onClose: () => void; onShip: (b: { carrier: string; trackingNumber: string; notify: boolean }) => void; loading: boolean }) {
  const [carrier, setCarrier] = useState(CARRIERS[0].id);
  const [number, setNumber] = useState("");
  const [notify, setNotify] = useState(true);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ship this order"
      description="Book the shipment with your courier, then enter the tracking number here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => onShip({ carrier, trackingNumber: number.trim(), notify })}>
            Mark shipped
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Courier">
          {(a) => (
            <Select {...a} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Tracking number" hint="Optional, but customers love a tracking link.">
          {(a) => <Input {...a} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={80} className="font-mono" />}
        </Field>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          Email the customer a shipping update
          <Switch checked={notify} onChange={setNotify} label="Email the customer" />
        </label>
      </div>
    </Dialog>
  );
}

function CancelDialog({ open, onClose, onCancel, loading, paid }: { open: boolean; onClose: () => void; onCancel: (b: { reason: string; restock: boolean }) => void; loading: boolean; paid: boolean }) {
  const [reason, setReason] = useState("Customer changed their mind");
  const [restock, setRestock] = useState(true);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel this order?"
      description={paid ? "This order is paid. Cancelling does not return the money — issue a refund afterwards." : "The customer is not charged for cancelled unpaid orders."}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Keep order</Button>
          <Button variant="danger" loading={loading} disabled={!reason.trim()} onClick={() => onCancel({ reason: reason.trim(), restock })}>
            Cancel order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          Put the items back in stock
          <Switch checked={restock} onChange={setRestock} label="Restock items" />
        </label>
      </div>
    </Dialog>
  );
}

function RefundDialog({ open, onClose, onRefund, loading, remaining, online, method }: { open: boolean; onClose: () => void; onRefund: (b: { amount: number; reason: string; restock: boolean }) => void; loading: boolean; remaining: number; online: boolean; method: string }) {
  const { store } = useStoreCtx();
  const money = useMoney();
  const [amount, setAmount] = useState<number | null>(remaining);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const valid = amount !== null && amount > 0 && amount <= remaining;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Refund"
      description={online ? `The refund is sent back through ${method} to the customer's original payment method. This cannot be undone.` : `${method} payments are refunded by you directly (cash, UPI or bank). This records the refund on the order.`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} disabled={!valid} onClick={() => valid && onRefund({ amount: amount!, reason: reason.trim(), restock })}>
            {online ? `Refund ${valid ? money(amount!) : ""}` : "Record refund"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Amount" hint={`Up to ${money(remaining)}`} error={amount !== null && amount > remaining ? "More than the refundable amount" : undefined}>
          {(a) => <MoneyInput {...a} value={amount} onChange={setAmount} currency={store.currency} />}
        </Field>
        <Field label="Reason (optional)">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          Put the items back in stock
          <Switch checked={restock} onChange={setRestock} label="Restock items" />
        </label>
        {!online && <Badge tone="warning">Remember to send the money to the customer yourself.</Badge>}
      </div>
    </Dialog>
  );
}
