"use client";

// Inventory home: what stock is worth and where, what's running low or
// expiring, what's on its way, and the latest movement. New workspaces get a
// short start: bring in the store's products, or add items.
import { AlertTriangle, ArrowRight, Boxes, Plus, ShoppingCart, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, PageHeader, Skeleton } from "@/components/ui/primitives";
import { ItemDialog, LinkStoreDialog } from "./items";
import { Delta, Empty, MOVE_LABEL, Section, Stat, StatusPill, fmt, fmtQty, short, useInv, useInvQuery, when } from "./shared";

type Home = {
  stats: { items: number; value: number; low: number; out: number; openOrders: number; onOrderValue: number; expiring: number; counted: number };
  byWarehouse: { id: string; name: string; store: boolean; items: number; value: number }[];
  low: { id: string; name: string; unit: string; onHand: number; reorderLevel: number; onOrder: number }[];
  expiring: { itemId: string; name: string; unit: string; warehouse: string; batch: string; expiry: string; qty: number; expired: boolean }[];
  orders: { id: string; number: string; status: string; total: number; expectedDate: string | null; supplier: string; late: boolean }[];
  recent: { id: string; item: string; unit: string; warehouse: string; qty: number; kind: string; refNo: string; createdAt: string }[];
};

export function HomeView() {
  const { meta, go } = useInv();
  const q = useInvQuery<Home>("home", { refetchInterval: 60_000 });
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const d = q.data;
  const unlinked = meta.stores.filter((s) => !s.linked);
  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock in every location, what to buy and what's on its way."
        actions={
          meta.me.write && (
            <div className="flex gap-2">
              {meta.parts.purchasing && (
                <Button size="sm" icon={<ShoppingCart className="size-3.5" />} onClick={() => go("orders/new")}>
                  New purchase order
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                New item
              </Button>
            </div>
          )
        }
      />
      {!d ? (
        <Skeleton className="h-[60vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          {d.stats.items === 0 && (
            <Section title="Get started">
              <div className="grid gap-3 sm:grid-cols-2">
                {unlinked.length > 0 && (
                  <button type="button" onClick={() => setLinking(true)} className="flex items-start gap-3 rounded-[16px] border border-border p-4 text-left hover:bg-surface-2">
                    <Store className="mt-0.5 size-5 text-muted" />
                    <span>
                      <b className="block text-[14px]">Bring in your store&apos;s products</b>
                      <span className="text-[12.5px] text-muted">Every product that tracks stock becomes an item, and the store gets a location whose stock is the shop&apos;s own.</span>
                    </span>
                  </button>
                )}
                <button type="button" onClick={() => setAdding(true)} className="flex items-start gap-3 rounded-[16px] border border-border p-4 text-left hover:bg-surface-2">
                  <Boxes className="mt-0.5 size-5 text-muted" />
                  <span>
                    <b className="block text-[14px]">Add items by hand</b>
                    <span className="text-[12.5px] text-muted">Raw materials, packaging, spares — anything you buy and keep.</span>
                  </span>
                </button>
              </div>
            </Section>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Stock value" value={short(d.stats.value)} sub={`${d.stats.items} items · at average cost`} onClick={() => go("reports")} />
            <Stat label="Running low" value={d.stats.low} sub={d.stats.out ? `${d.stats.out} out of stock` : "at or below reorder level"} tone={d.stats.low ? "warn" : undefined} onClick={() => go(meta.parts.purchasing ? "reorder" : "items?filter=low")} />
            <Stat label="On order" value={short(d.stats.onOrderValue)} sub={`${d.stats.openOrders} open purchase order${d.stats.openOrders === 1 ? "" : "s"}`} onClick={() => go("orders")} />
            <Stat label="Expiring soon" value={d.stats.expiring} sub={`within ${meta.settings.expiryWarnDays} days`} tone={d.stats.expiring ? "warn" : undefined} />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] [&>*]:min-w-0">
            <div className="grid content-start gap-5">
              <Section title="Running low" action={meta.parts.purchasing && d.low.length > 0 ? <Link href="/inventory/reorder" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">Reorder <ArrowRight className="size-3.5" /></Link> : undefined}>
                {!d.low.length ? (
                  <Empty>Nothing is below its reorder level.</Empty>
                ) : (
                  <ul className="grid gap-2.5">
                    {d.low.map((l) => (
                      <li key={l.id}>
                        <Link href={`/inventory/items/${l.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-[13px] hover:opacity-80 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:gap-3">
                          <span className="truncate font-medium">{l.name}</span>
                          <span className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-surface-2 sm:col-span-1 sm:row-start-auto">
                            <span className="block h-full rounded-full bg-warning" style={{ width: `${Math.min(100, (Math.max(0, l.onHand) / (l.reorderLevel || 1)) * 100)}%` }} />
                          </span>
                          <span className="text-right text-[12px] text-muted tabular-nums">
                            {fmtQty(l.onHand, l.unit)} / {fmtQty(l.reorderLevel)}
                            {l.onOrder > 0 && <span className="text-accent"> · {fmtQty(l.onOrder)} coming</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              {meta.parts.purchasing && (
                <Section title="Purchase orders" action={<Link href="/inventory/orders" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">All <ArrowRight className="size-3.5" /></Link>}>
                  {!d.orders.length ? (
                    <Empty>No open purchase orders.</Empty>
                  ) : (
                    <ul className="divide-y divide-border">
                      {d.orders.map((o) => (
                        <li key={o.id}>
                          <Link href={`/inventory/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-[13px] hover:opacity-80">
                            <span className="min-w-0">
                              <b className="font-semibold">{o.number}</b> <span className="text-muted">· {o.supplier}</span>
                              <span className="block text-[12px] text-muted">{o.expectedDate ? `Due ${fmt(o.expectedDate, { day: "numeric", month: "short" })}` : "No date given"}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <b className="tabular-nums">{short(o.total)}</b>
                              <StatusPill status={o.late ? "late" : o.status} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
            </div>
            <div className="grid content-start gap-5">
              <Section title="By location">
                <ul className="grid gap-2">
                  {d.byWarehouse.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px]">
                      <span className="min-w-0">
                        <b className="flex items-center gap-1.5 font-semibold">
                          {w.store && <Store className="size-3.5 text-muted" />}
                          {w.name}
                        </b>
                        <span className="text-[12px] text-muted">{w.items} items in stock</span>
                      </span>
                      <b className="tabular-nums">{short(w.value)}</b>
                    </li>
                  ))}
                </ul>
              </Section>
              {d.expiring.length > 0 && (
                <Section title="Expiring soon">
                  <ul className="grid gap-2">
                    {d.expiring.map((e) => (
                      <li key={`${e.itemId}-${e.batch}-${e.warehouse}`} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {e.expired && <AlertTriangle className="size-3.5 text-danger" />}
                            {e.name}
                          </span>
                          <span className="text-[12px] text-muted">
                            Batch {e.batch} · {e.warehouse} · {fmtQty(e.qty, e.unit)}
                          </span>
                        </span>
                        <StatusPill status={e.expired ? "expired" : "soon"} />
                        <span className="w-20 text-right text-[12px] tabular-nums">{fmt(e.expiry, { day: "numeric", month: "short" })}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section title="Latest movement">
                {!d.recent.length ? (
                  <Empty>Receipts, transfers, counts and adjustments appear here.</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.recent.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.item}</span>
                          <span className="text-[12px] text-muted">
                            {MOVE_LABEL[r.kind] ?? r.kind} · {r.warehouse}
                            {r.refNo ? ` · ${r.refNo}` : ""} · {when(r.createdAt)}
                          </span>
                        </span>
                        <Delta qty={r.qty} unit={r.unit} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
      {adding && <ItemDialog onClose={() => setAdding(false)} onSaved={(id) => go(`items/${id}`)} />}
      {linking && <LinkStoreDialog onClose={() => setLinking(false)} />}
    </div>
  );
}
