"use client";

// Items & stock: the list with what's on hand everywhere, an item's page with
// stock by location and batch and its full history, and the dialogs to add an
// item, adjust stock and bring a store's products in.
import { ArrowLeftRight, Pencil, Plus, Search, ShoppingCart, SlidersHorizontal, Store, Trash2 } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { ADJUST_REASONS, GST_RATES, UNITS } from "@/lib/inventory/model";
import { TransferDialog } from "./more";
import { Delta, Empty, MOVE_LABEL, Section, Stat, StatusPill, fmt, fmtQty, fromPaise, inr, invApi, short, supName, toPaise, todayIst, useInv, useInvAction, useInvQuery, when, whName, type Item } from "./shared";
import { CustomFieldsCard } from "@/components/custom/fields-card";

export function ItemsView() {
  const { meta, go, orgId } = useInv();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [warehouseId, setWarehouse] = useState("");
  const [filter, setFilter] = useState(params.get("filter") ?? "");
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const qs = new URLSearchParams(Object.entries({ q, category, warehouseId, filter }).filter(([, v]) => v)).toString();
  const list = useInvQuery<{ items: Item[] }>(`items${qs ? `?${qs}` : ""}`, { keepPrevious: true });
  const items = list.data?.items;
  const totalValue = items?.reduce((a, i) => a + i.value, 0) ?? 0;
  return (
    <div>
      <PageHeader
        title="Items & stock"
        description={items ? `${items.length} item${items.length === 1 ? "" : "s"} · ${short(totalValue)} at average cost` : "Everything you buy, keep and sell."}
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.write && <ImportButton target={target("inventory.items")} onImport={(rows, mode) => api(invApi(orgId, "items/import"), { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["inv", orgId] })} />}
            <ExportMenu
              name="stock"
              rows={items}
              columns={[
                { key: "name", label: "Name" },
                { key: "sku", label: "SKU" },
                { key: "barcode", label: "Barcode" },
                { key: "unit", label: "Unit" },
                { key: "category", label: "Category" },
                { key: "hsn", label: "HSN" },
                { key: "gstRate", label: "GST %" },
                { key: "avgCost", label: "Cost price", money: true },
                { key: "onHand", label: "Stock on hand" },
                { key: "onOrder", label: "On order" },
                { key: "value", label: "Value", money: true },
                { key: "reorderLevel", label: "Reorder at" },
                { key: "reorderQty", label: "Order quantity" },
                { key: "supplierId", label: "Supplier", format: (v) => supName(meta, v as string | null) },
                ...meta.warehouses.map((w) => ({ key: `wh:${w.id}`, label: w.name, format: (_: unknown, r: Record<string, unknown>) => (r.byLocation as Record<string, number>)[w.id] ?? 0 })),
              ]}
            />
            {meta.me.write && meta.stores.length > 0 && (
              <Button size="sm" icon={<Store className="size-3.5" />} onClick={() => setLinking(true)}>
                From your store
              </Button>
            )}
            {meta.me.write && (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                New item
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input aria-label="Find an item" className="!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU or barcode" />
        </div>
        {meta.categories.length > 0 && (
          <Select aria-label="Category" className="!w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {meta.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
        {meta.warehouses.length > 1 && (
          <Select aria-label="Location" className="!w-auto" value={warehouseId} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">All locations</option>
            {meta.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Show" className="!w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Active items</option>
          <option value="low">Running low</option>
          <option value="out">Out of stock</option>
          <option value="inactive">Switched off</option>
          <option value="all">Everything</option>
        </Select>
      </div>
      {!items ? (
        <Skeleton className="h-[60vh] rounded-[20px]" />
      ) : !items.length ? (
        <EmptyState icon={<SlidersHorizontal />} title={q || category || filter ? "Nothing matches" : "No items yet"} description="Add the things you buy and keep, or bring in your store's products." action={meta.me.write && !q ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add an item</Button> : undefined} />
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm", list.isFetching && "opacity-80")}>
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 text-right font-medium">On hand</th>
                {meta.parts.purchasing && <th className="px-4 py-2.5 text-right font-medium">On order</th>}
                <th className="px-4 py-2.5 text-right font-medium">Avg cost</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <tr key={i.id} onClick={() => go(`items/${i.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/inventory/items/${i.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>
                      {i.name}
                    </Link>
                    <span className="block text-[12px] text-muted">
                      {[i.sku, i.variantId ? "In your store" : "", i.trackBatches ? "By batch" : ""].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{i.category || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums" title={Object.entries(i.byLocation).map(([w, n]) => `${whName(meta, w)}: ${n}`).join("\n")}>
                    <b className={cx(i.onHand <= 0 && "text-danger")}>{fmtQty(i.onHand, i.unit)}</b>
                  </td>
                  {meta.parts.purchasing && <td className="px-4 py-2.5 text-right text-muted tabular-nums">{i.onOrder ? fmtQty(i.onOrder) : "—"}</td>}
                  <td className="px-4 py-2.5 text-right text-muted tabular-nums">{i.avgCost ? inr(i.avgCost) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{i.value ? short(i.value) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">{i.onHand <= 0 ? <StatusPill status="out" /> : i.low ? <StatusPill status="low" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <ItemDialog onClose={() => setAdding(false)} onSaved={(id) => go(`items/${id}`)} />}
      {linking && <LinkStoreDialog onClose={() => setLinking(false)} />}
    </div>
  );
}

type Detail = {
  item: Omit<Item, "onHand" | "onOrder" | "value" | "low" | "byLocation" | "storeTitle">;
  supplier: { id: string; name: string } | null;
  stock: { warehouseId: string; batch: string; expiry: string | null; qty: number }[];
  reserved: number;
  quarantined: number;
  serials: { serial: string; status: string; warehouseId: string | null }[];
  onHand: number;
  onOrder: number;
  openOrders: { id: string; number: string; status: string; expectedDate: string | null; qty: number }[];
  history: { id: string; at: string; qty: number; kind: string; warehouseId: string | null; batch: string; refNo: string; refType: string; refId: string | null; note: string }[];
};

export function ItemPage({ id }: { id: string }) {
  const { meta, go } = useInv();
  const q = useInvQuery<Detail>(`items/${id}`);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useInvAction<void, { archived: boolean }>(() => ({ path: `items/${id}`, method: "DELETE" }), { success: (r) => (r.archived ? "Switched off — it has history, so it's kept" : "Item deleted"), onDone: () => go("items") });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { item: it, stock, history } = q.data;
  const today = todayIst();
  return (
    <div>
      <Link href="/inventory/items" className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← Items
      </Link>
      <PageHeader
        title={it.name}
        description={[it.sku && `SKU ${it.sku}`, it.category, it.hsn && `HSN ${it.hsn}`, `GST ${it.gstRate}%`, it.variantId ? "Linked to your store" : ""].filter(Boolean).join(" · ")}
        actions={
          meta.me.write && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setAdjusting(true)}>
                Adjust
              </Button>
              {meta.parts.locations && meta.warehouses.length > 1 && (
                <Button size="sm" icon={<ArrowLeftRight className="size-3.5" />} onClick={() => setMoving(true)}>
                  Transfer
                </Button>
              )}
              {meta.parts.purchasing && (
                <Button size="sm" variant="primary" icon={<ShoppingCart className="size-3.5" />} onClick={() => go(`orders/new?item=${id}`)}>
                  Order more
                </Button>
              )}
              {meta.me.manage && <Button size="sm" variant="ghost" aria-label="Delete item" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />}
            </div>
          )
        }
      />
      <CustomFieldsCard entity="inventory.item" id={id} />
      {!it.active && <div className="mb-4"><Notice>This item is switched off. It stays in reports and history.</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On hand" value={fmtQty(q.data.onHand, it.unit)} sub={q.data.reserved || q.data.quarantined ? `${fmtQty(Math.max(0, q.data.onHand - q.data.reserved - q.data.quarantined))} free · ${fmtQty(q.data.reserved)} reserved${q.data.quarantined ? ` · ${fmtQty(q.data.quarantined)} in quarantine` : ""}` : it.reorderLevel ? `reorder at ${fmtQty(it.reorderLevel)}${it.safetyStock ? ` + ${fmtQty(it.safetyStock)} safety` : ""}` : "no reorder level"} tone={it.reorderLevel && q.data.onHand - q.data.reserved <= it.reorderLevel + it.safetyStock ? "warn" : undefined} />
        <Stat label="On order" value={fmtQty(q.data.onOrder)} sub={`${q.data.openOrders.length} open order${q.data.openOrders.length === 1 ? "" : "s"}`} />
        <Stat label="Average cost" value={it.avgCost ? inr(it.avgCost) : "—"} sub="weighted, from what you paid" />
        <Stat label="Value" value={short(Math.round(q.data.onHand * it.avgCost))} sub={q.data.supplier ? `from ${q.data.supplier.name}` : "no usual supplier"} />
      </div>
      {it.trackSerials && (
        <div className="mb-5">
          <Section title={`Serial numbers · ${q.data.serials.filter((x) => x.status === "in_stock").length} in stock`}>
            {!q.data.serials.length ? <Empty>No units received yet.</Empty> : (
              <div className="flex flex-wrap gap-1.5">
                {q.data.serials.map((x) => <span key={x.serial} title={x.status.replace(/_/g, " ")} className={cx("rounded-full border px-2 py-0.5 font-mono text-[12px]", x.status === "in_stock" ? "border-border" : "border-transparent bg-surface-2 text-muted line-through")}>{x.serial}{x.status === "in_stock" && meta.warehouses.length > 1 ? ` · ${whName(meta, x.warehouseId)}` : ""}</span>)}
              </div>
            )}
          </Section>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] [&>*]:min-w-0">
        <div className="grid content-start gap-5">
          <Section title="Where it is">
            {!stock.filter((s) => s.qty !== 0).length ? (
              <Empty>None on hand anywhere.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {stock
                  .filter((s) => s.qty !== 0)
                  .sort((a, b) => (a.expiry ?? "9").localeCompare(b.expiry ?? "9"))
                  .map((s) => (
                    <li key={`${s.warehouseId}-${s.batch}`} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        <b className="font-medium">{whName(meta, s.warehouseId)}</b>
                        {s.batch && (
                          <span className="block text-[12px] text-muted">
                            Batch {s.batch}
                            {s.expiry && ` · expires ${fmt(s.expiry)}`}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {s.expiry && s.expiry < today && <StatusPill status="expired" />}
                        <b className="tabular-nums">{fmtQty(s.qty, it.unit)}</b>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Section>
          {q.data.openOrders.length > 0 && (
            <Section title="Coming in">
              <ul className="grid gap-1.5 text-[13px]">
                {q.data.openOrders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/inventory/orders/${o.id}`} className="flex items-center justify-between gap-3 hover:opacity-80">
                      <span>
                        <b>{o.number}</b> <span className="text-muted">· {o.expectedDate ? `due ${fmt(o.expectedDate, { day: "numeric", month: "short" })}` : "no date"}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {fmtQty(o.qty, it.unit)} <StatusPill status={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {it.notes && (
            <Section title="Notes">
              <p className="text-[13px] whitespace-pre-line text-muted">{it.notes}</p>
            </Section>
          )}
        </div>
        <Section title="History">
          {!history.length ? (
            <Empty>Every receipt, transfer, count, adjustment{it.variantId ? " and store sale" : ""} shows up here.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {MOVE_LABEL[h.kind] ?? h.kind}
                      {h.warehouseId ? <span className="font-normal text-muted"> · {whName(meta, h.warehouseId)}</span> : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {[when(h.at), h.refNo, h.batch && `batch ${h.batch}`, h.note].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Delta qty={h.qty} unit={it.unit} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {editing && <ItemDialog init={it} onClose={() => setEditing(false)} />}
      {adjusting && <AdjustDialog item={it} stock={stock} onClose={() => setAdjusting(false)} />}
      {moving && <TransferDialog itemId={id} onClose={() => setMoving(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title={`Delete ${it.name}?`} description="If it has stock history it's switched off instead, so the records stay whole." confirmLabel="Delete" />
    </div>
  );
}

export function ItemDialog({ init, onClose, onSaved }: { init?: Partial<Detail["item"]>; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({
    name: init?.name ?? "",
    sku: init?.sku ?? "",
    barcode: init?.barcode ?? "",
    unit: init?.unit ?? "pcs",
    category: init?.category ?? "",
    hsn: init?.hsn ?? "",
    gstRate: init?.gstRate ?? 18,
    avgCost: fromPaise(init?.avgCost),
    trackBatches: init?.trackBatches ?? false,
    reorderLevel: String(init?.reorderLevel ?? ""),
    reorderQty: String(init?.reorderQty ?? ""),
    safetyStock: String(init?.safetyStock || ""),
    trackSerials: init?.trackSerials ?? false,
    supplierId: init?.supplierId ?? "",
    notes: init?.notes ?? "",
    active: init?.active ?? true,
  });
  const linked = !!init?.variantId;
  const save = useInvAction<void, { item: { id: string } }>(
    () => ({ path: init?.id ? `items/${init.id}` : "items", method: init?.id ? "PUT" : "POST", body: { ...f, avgCost: toPaise(f.avgCost), reorderLevel: Number(f.reorderLevel) || 0, reorderQty: Number(f.reorderQty) || 0, safetyStock: Number(f.safetyStock) || 0, supplierId: f.supplierId || null } }),
    { success: init?.id ? "Saved" : "Item added", onDone: (r) => (onClose(), onSaved?.(r.item.id)) },
  );
  return (
    <Dialog open onClose={onClose} size="lg" title={init?.id ? `Edit ${init.name}` : "New item"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>{init?.id ? "Save" : "Add item"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={160} placeholder="Shipping box (medium)" />}</Field>
        <Field label="SKU">{(a) => <Input {...a} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} maxLength={60} />}</Field>
        <Field label="Barcode">{(a) => <Input {...a} value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} maxLength={60} />}</Field>
        <Field label="Unit" hint={linked ? "Store items are counted in pieces." : undefined}>
          {(a) => (
            <Select {...a} value={f.unit} disabled={linked} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(a) => (
            <>
              <Input {...a} list="inv-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={60} placeholder="Packaging" />
              <datalist id="inv-categories">
                {meta.categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="HSN code">{(a) => <Input {...a} value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value.replace(/\D/g, "") })} maxLength={10} />}</Field>
        <Field label="GST rate">
          {(a) => (
            <Select {...a} value={String(f.gstRate)} onChange={(e) => setF({ ...f, gstRate: Number(e.target.value) })}>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Average cost (₹)" hint={init?.id ? "Worked out from what you pay; change it only to correct it." : "What one unit costs you now."}>{(a) => <Input {...a} inputMode="decimal" value={f.avgCost} onChange={(e) => setF({ ...f, avgCost: e.target.value })} />}</Field>
        {meta.parts.purchasing && (
          <Field label="Usual supplier">
            {(a) => (
              <Select {...a} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                <option value="">None</option>
                {meta.suppliers.filter((x) => x.active || x.id === f.supplierId).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Reorder at" hint="When stock falls to this, it's flagged.">{(a) => <Input {...a} inputMode="decimal" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} placeholder="0" />}</Field>
        <Field label="Order this many" hint="The usual quantity to buy.">{(a) => <Input {...a} inputMode="decimal" value={f.reorderQty} onChange={(e) => setF({ ...f, reorderQty: e.target.value })} placeholder="0" />}</Field>
        <Field label="Safety stock" hint="Kept on top of the reorder level for surprises.">{(a) => <Input {...a} inputMode="decimal" value={f.safetyStock} onChange={(e) => setF({ ...f, safetyStock: e.target.value })} placeholder="0" />}</Field>
        {!linked && (
          <label className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px]">
            <span>
              <b className="block font-medium">Serial numbers</b>
              <span className="text-muted">One per unit, asked for on receipt and delivery.</span>
            </span>
            <Switch checked={f.trackSerials} onChange={(v) => setF({ ...f, trackSerials: v })} label="Track serial numbers" />
          </label>
        )}
        {meta.parts.batches && !linked && (
          <label className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px] sm:col-span-2">
            <span>
              <b className="block font-medium">Track by batch and expiry</b>
              <span className="text-muted">Each receipt asks for a batch number; the oldest expiry goes out first.</span>
            </span>
            <Switch checked={f.trackBatches} onChange={(v) => setF({ ...f, trackBatches: v })} label="Track by batch" />
          </label>
        )}
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>
        {init?.id && (
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Item in use" /> In use
          </label>
        )}
      </div>
    </Dialog>
  );
}

function AdjustDialog({ item, stock, onClose }: { item: Detail["item"]; stock: Detail["stock"]; onClose: () => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({ warehouseId: meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "", direction: "-1", qty: "", reason: "damaged", batch: "", expiry: "", note: "" });
  const batches = useMemo(() => [...new Set(stock.filter((s) => s.warehouseId === f.warehouseId && s.batch).map((s) => s.batch))], [stock, f.warehouseId]);
  const save = useInvAction(() => ({ path: "adjust", body: { itemId: item.id, warehouseId: f.warehouseId, qty: Number(f.direction) * (Number(f.qty) || 0), reason: f.reason, batch: f.batch, expiry: f.expiry || null, note: f.note } }), { success: "Stock adjusted", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Adjust ${item.name}`} description="For damage, loss, finds and opening stock. Counting a whole location is under Counts." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!Number(f.qty) || !f.warehouseId || (item.trackBatches && !f.batch)} onClick={() => save.mutate(undefined)}>Adjust</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Location" className="sm:col-span-2">
          {(a) => (
            <Select {...a} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value, batch: "" })}>
              {meta.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Change">
          {(a) => (
            <Select {...a} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, reason: e.target.value === "1" ? "found" : "damaged" })}>
              <option value="-1">Take out</option>
              <option value="1">Add</option>
            </Select>
          )}
        </Field>
        <Field label={`Quantity (${item.unit})`}>{(a) => <Input {...a} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Why">
          {(a) => (
            <Select {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
              {Object.entries(ADJUST_REASONS)
                .filter(([k]) => (f.direction === "1" ? ["found", "opening", "other"] : ["damaged", "expired", "lost", "used", "other"]).includes(k))
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {item.trackBatches && (
          <Field label="Batch">
            {(a) =>
              f.direction === "-1" ? (
                <Select {...a} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })}>
                  <option value="">Choose…</option>
                  {batches.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              ) : (
                <Input {...a} value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} maxLength={40} />
              )
            }
          </Field>
        )}
        {item.trackBatches && f.direction === "1" && <Field label="Expiry">{(a) => <Input {...a} type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />}</Field>}
        <Field label="Note (optional)" className="sm:col-span-2">{(a) => <Input {...a} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

export function LinkStoreDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useInv();
  const [projectId, setProject] = useState(meta.stores.find((s) => !s.linked)?.id ?? meta.stores[0]?.id ?? "");
  const link = useInvAction<void, { added: number; already: number }>(() => ({ path: "link-store", body: { projectId } }), { success: (r) => (r.added ? `${r.added} product${r.added === 1 ? "" : "s"} brought in` : "Everything was already here"), onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Bring in your store's products" description="Each product variant that tracks stock becomes an item. The store gets a location of its own: its quantity is the store's stock, so the shop and the POS keep selling from the same number." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={link.isPending} disabled={!projectId} onClick={() => link.mutate()}>Bring them in</Button></>}>
      {meta.stores.length > 1 ? (
        <Field label="Store">
          {(a) => (
            <Select {...a} value={projectId} onChange={(e) => setProject(e.target.value)}>
              {meta.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.linked ? " (linked — adds what's new)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <p className="text-[13px]">
          From <b>{meta.stores[0]?.name}</b>. Running it again later only adds new products.
        </p>
      )}
    </Dialog>
  );
}
