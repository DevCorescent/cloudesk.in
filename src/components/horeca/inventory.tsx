"use client";

// Kitchen stock: ingredients in grams, millilitres or pieces; purchases from
// suppliers; wastage; physical counts with the variance; and food cost per
// dish from its recipe (set recipes on each dish under Menu).
import { Boxes, ClipboardCheck, MoreHorizontal, PackagePlus, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu, Tabs } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { cap, Stat, toMajor, toMinor, Toggle, useHAction, useHQuery, useMoney } from "./shared";

type Item = { id: string; name: string; category: string; unit: "g" | "ml" | "pcs"; packSize: number; costPerPack: number; stock: number; reorderAt: number; supplierId: string | null; supplier: string; active: boolean; value: number; low: boolean; used7: number; daysLeft: number | null };
type Supplier = { id: string; name: string; phone: string; email: string; gstin: string; notes: string };
type Stock = { items: Item[]; suppliers: Supplier[]; value: number; low: number };

/** 1500 g → "1.5 kg"; 250 ml → "250 ml". */
export function qtyLabel(qty: number, unit: string) {
  const a = Math.abs(qty);
  const sign = qty < 0 ? "−" : "";
  if (unit === "g" && a >= 1000) return `${sign}${(a / 1000).toFixed(a % 1000 ? 2 : 0).replace(/\.?0+$/, "")} kg`;
  if (unit === "ml" && a >= 1000) return `${sign}${(a / 1000).toFixed(a % 1000 ? 2 : 0).replace(/\.?0+$/, "")} L`;
  return `${sign}${a} ${unit}`;
}
const packLabel = (i: Pick<Item, "packSize" | "unit">) => qtyLabel(i.packSize, i.unit);

export function InventoryView() {
  const money = useMoney();
  const q = useHQuery<Stock>("stock");
  const [tab, setTab] = useState<"stock" | "purchases" | "suppliers" | "counts" | "cost" | "moves">("stock");
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [supplier, setSupplier] = useState<Partial<Supplier> | null>(null);
  const [buying, setBuying] = useState(false);
  const [wasting, setWasting] = useState<Item | null>(null);
  const [counting, setCounting] = useState(false);
  const [del, setDel] = useState<{ path: string; name: string } | null>(null);
  const [cat, setCat] = useState("all");
  const remove = useHAction<void>(() => ({ path: del!.path, method: "DELETE" }), { success: "Deleted", onDone: () => setDel(null) });
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => cat === "all" || (cat === "low" ? i.low && i.active : i.category === cat)), [q.data, cat]);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const all = q.data.items;
  const cats = [...new Set(all.map((i) => i.category))].sort();
  return (
    <div>
      <PageHeader
        title="Kitchen stock"
        description="Ingredients come out of stock as dishes are sent to the kitchen, from each dish's recipe. Buy, count and see what it really costs."
        actions={
          <>
            <Button size="sm" icon={<ClipboardCheck className="size-4" />} disabled={!all.length} onClick={() => setCounting(true)}>
              Stock count
            </Button>
            <Button size="sm" icon={<PackagePlus className="size-4" />} disabled={!all.length} onClick={() => setBuying(true)}>
              Record a purchase
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
              Ingredient
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value" value={money(q.data.value)} sub="at latest cost" />
        <Stat label="Running low" value={q.data.low} sub="at or below reorder level" tone={q.data.low ? "warn" : undefined} />
        <Stat label="Ingredients" value={all.filter((i) => i.active).length} />
        <Stat label="Suppliers" value={q.data.suppliers.length} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mt-5 mb-4"
        tabs={[
          { value: "stock", label: "Stock" },
          { value: "purchases", label: "Purchases" },
          { value: "suppliers", label: "Suppliers" },
          { value: "counts", label: "Counts" },
          { value: "cost", label: "Food cost" },
          { value: "moves", label: "Movements" },
        ]}
      />
      {tab === "stock" &&
        (!all.length ? (
          <EmptyState icon={<Boxes />} title="Add your ingredients" description="Paneer, rice, oil, flour, takeaway boxes… then give each dish a recipe under Menu, and stock looks after itself." action={<Button variant="primary" onClick={() => setEdit({})}>Add an ingredient</Button>} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {["all", ...(q.data.low ? ["low"] : []), ...cats].map((c) => (
                <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", cat === c ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2", c === "low" && cat !== c && "border-warning/50 text-warning")}>
                  {c === "all" ? "All" : c === "low" ? `Running low · ${q.data!.low}` : cap(c)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead className="border-b border-border text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Ingredient</th>
                    <th className="px-4 py-2.5 font-medium">In stock</th>
                    <th className="px-4 py-2.5 text-right font-medium">Used (7d)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lasts</th>
                    <th className="px-4 py-2.5 text-right font-medium">Value</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((i) => (
                    <tr key={i.id} className={cx(!i.active && "opacity-50")}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{i.name}</p>
                        <p className="text-[12px] text-muted">
                          {cap(i.category)} · {money(i.costPerPack)} per {packLabel(i)}
                          {i.supplier ? ` · ${i.supplier}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cx("font-semibold tabular-nums", i.stock < 0 && "text-danger")}>{qtyLabel(i.stock, i.unit)}</span>
                        {i.low && i.active && <Badge tone="warning" className="ml-2">Reorder</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{i.used7 ? qtyLabel(i.used7, i.unit) : "—"}</td>
                      <td className={cx("px-4 py-3 text-right tabular-nums", i.daysLeft !== null && i.daysLeft < 3 && "font-semibold text-danger")}>{i.daysLeft === null ? "—" : `${i.daysLeft} days`}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(i.value)}</td>
                      <td className="px-2">
                        <Menu
                          label={`Actions for ${i.name}`}
                          trigger={(p) => (
                            <button {...p} aria-label={`Actions for ${i.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                              <MoreHorizontal className="size-4" />
                            </button>
                          )}
                          items={[
                            { label: "Record wastage", onSelect: () => setWasting(i) },
                            { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEdit(i) },
                            "separator",
                            { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ path: `stock-items/${i.id}`, name: i.name }) },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-subtle">Stock can go below zero if dishes are sold before a purchase is recorded — it shows in red.</p>
          </>
        ))}
      {tab === "purchases" && <Purchases onNew={() => setBuying(true)} />}
      {tab === "suppliers" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.suppliers.map((s) => (
            <div key={s.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[15px] font-semibold">
                    <Truck className="size-4 text-muted" />
                    {s.name}
                  </p>
                  <p className="mt-1 text-[12.5px] text-muted">{[s.phone, s.email, s.gstin && `GSTIN ${s.gstin}`].filter(Boolean).join(" · ") || "No contact details"}</p>
                  <p className="mt-1 text-[12px] text-subtle">{all.filter((i) => i.supplierId === s.id).length} ingredients</p>
                </div>
                <Menu
                  label={`Actions for ${s.name}`}
                  trigger={(p) => (
                    <button {...p} aria-label={`Actions for ${s.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                  items={[
                    { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setSupplier(s) },
                    { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ path: `suppliers/${s.id}`, name: s.name }) },
                  ]}
                />
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setSupplier({})} className="grid min-h-28 place-items-center rounded-[18px] border border-dashed border-border text-[13.5px] text-muted hover:bg-surface-2">
            + New supplier
          </button>
        </div>
      )}
      {tab === "counts" && <Counts onStart={() => setCounting(true)} />}
      {tab === "cost" && <FoodCost />}
      {tab === "moves" && <Moves />}
      {edit && <ItemDialog init={edit} suppliers={q.data.suppliers} onClose={() => setEdit(null)} />}
      {supplier && <SupplierDialog init={supplier} onClose={() => setSupplier(null)} />}
      {buying && <PurchaseDialog items={all.filter((i) => i.active)} suppliers={q.data.suppliers} onClose={() => setBuying(false)} />}
      {wasting && <WasteDialog item={wasting} onClose={() => setWasting(null)} />}
      {counting && <CountDialog items={all.filter((i) => i.active)} onClose={() => setCounting(false)} onDone={() => (setCounting(false), setTab("counts"))} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${del?.name}?`} description="Its history goes with it. Recipes that use it stop deducting it." confirmLabel="Delete" />
    </div>
  );
}

function Purchases({ onNew }: { onNew: () => void }) {
  const money = useMoney();
  const q = useHQuery<{ purchases: { id: string; supplier: string; invoiceNo: string; date: string; total: number; lines: { name: string; qty: number; unit: string; cost: number }[] }[] }>("purchases");
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.purchases.length) return <EmptyState icon={<PackagePlus />} title="No purchases yet" description="Record a supplier's bill and the stock goes up — and each ingredient's cost updates to what you paid." action={<Button variant="primary" onClick={onNew}>Record a purchase</Button>} />;
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
      <ul className="divide-y divide-border">
        {q.data.purchases.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-[13px] text-muted tabular-nums">{new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
              <b className="flex-1 text-[14px]">{p.supplier || "No supplier"}</b>
              {p.invoiceNo && <span className="text-[12.5px] text-muted">Invoice {p.invoiceNo}</span>}
              <b className="tabular-nums">{money(p.total)}</b>
            </div>
            <p className="mt-1 pl-0 text-[12.5px] text-muted sm:pl-[108px]">{p.lines.map((l) => `${l.name} ${qtyLabel(l.qty, l.unit)}`).join(" · ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Counts({ onStart }: { onStart: () => void }) {
  const money = useMoney();
  const q = useHQuery<{ counts: { id: string; createdAt: string; note: string; totalValue: number; lines: { name: string; unit: string; expected: number; counted: number; variance: number; value: number }[] }[] }>("stock-counts");
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.counts.length) return <EmptyState icon={<ClipboardCheck />} title="No counts yet" description="Count the store-room weekly. The difference from what the recipes say is your variance — spoilage, over-portioning or worse." action={<Button variant="primary" onClick={onStart}>Start a count</Button>} />;
  return (
    <div className="grid gap-3">
      {q.data.counts.map((c) => (
        <section key={c.id} className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
          <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
            <ClipboardCheck className="size-4 text-muted" />
            <span className="flex-1">
              <b className="block text-[14px]">{new Date(c.createdAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b>
              <span className="text-[12px] text-muted">
                {c.lines.length} counted · {c.lines.filter((l) => l.variance).length} off{c.note ? ` · ${c.note}` : ""}
              </span>
            </span>
            <b className={cx("tabular-nums", c.totalValue < 0 ? "text-danger" : c.totalValue > 0 ? "text-success" : "text-muted")}>
              {c.totalValue < 0 ? "−" : c.totalValue > 0 ? "+" : ""}
              {money(Math.abs(c.totalValue))}
            </b>
          </button>
          {open === c.id && (
            <table className="w-full border-t border-border text-[13px]">
              <tbody className="divide-y divide-border">
                {c.lines.map((l) => (
                  <tr key={l.name} className={cx(l.variance < 0 && "bg-danger-soft/40")}>
                    <td className="px-4 py-2">{l.name}</td>
                    <td className="px-4 py-2 text-right text-muted tabular-nums">expected {qtyLabel(l.expected, l.unit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">counted {qtyLabel(l.counted, l.unit)}</td>
                    <td className={cx("px-4 py-2 text-right font-semibold tabular-nums", l.variance < 0 ? "text-danger" : l.variance > 0 ? "text-success" : "text-muted")}>{l.variance ? qtyLabel(l.variance, l.unit) : "exact"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.value ? money(l.value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function FoodCost() {
  const money = useMoney();
  const q = useHQuery<{ items: { id: string; name: string; price: number; cost: number; pct: number; margin: number }[] }>("food-cost");
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.items.length) return <EmptyState title="No recipes yet" description="Open a dish under Menu and add its ingredients — its cost and food-cost % show here." />;
  const avg = q.data.items.reduce((a, i) => a + i.pct, 0) / q.data.items.length;
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">
        Average food cost <b className="text-fg">{avg.toFixed(1)}%</b>. Most restaurants aim for 28–35%.
      </p>
      <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[620px] text-[13.5px]">
          <thead className="border-b border-border text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Dish</th>
              <th className="px-4 py-2.5 text-right font-medium">Menu price</th>
              <th className="px-4 py-2.5 text-right font-medium">Ingredient cost</th>
              <th className="px-4 py-2.5 font-medium">Food cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...q.data.items].sort((a, b) => b.pct - a.pct).map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2.5 font-medium">{i.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(i.price)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(i.cost)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                      <span className={cx("block h-full rounded-full", i.pct > 40 ? "bg-danger" : i.pct > 33 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, i.pct)}%` }} />
                    </span>
                    <b className={cx("tabular-nums", i.pct > 40 && "text-danger")}>{i.pct}%</b>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(i.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Moves() {
  const q = useHQuery<{ moves: { id: string; kind: string; qty: number; note: string; createdAt: string; item: string; unit: string }[] }>("stock-moves");
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.moves.length) return <EmptyState title="No movements yet" description="Purchases, usage from orders, wastage and count adjustments show here." />;
  const tone: Record<string, "success" | "neutral" | "accent" | "danger" | "warning"> = { purchase: "success", sale: "neutral", void: "accent", wastage: "danger", adjust: "warning" };
  const label: Record<string, string> = { purchase: "Purchase", sale: "Used", void: "Returned", wastage: "Wastage", adjust: "Count" };
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
      <ul className="divide-y divide-border">
        {q.data.moves.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
            <Badge tone={tone[m.kind]}>{label[m.kind] ?? m.kind}</Badge>
            <span className="min-w-0 flex-1 truncate">
              <b className="font-medium">{m.item}</b>
              {m.note && <span className="text-muted"> · {m.note}</span>}
            </span>
            <span className={cx("font-semibold tabular-nums", m.qty > 0 && "text-success")}>
              {m.qty > 0 ? "+" : ""}
              {qtyLabel(m.qty, m.unit)}
            </span>
            <span className="w-32 text-right text-[12px] text-muted">{new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CATEGORIES = ["dairy", "meat", "seafood", "vegetables", "grains", "spices", "oils", "bakery", "beverages", "packaging", "cleaning", "other"];

function ItemDialog({ init, suppliers, onClose }: { init: Partial<Item>; suppliers: Supplier[]; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", category: init.category ?? "vegetables", unit: init.unit ?? ("g" as Item["unit"]), packSize: init.packSize ?? 1000, cost: init.costPerPack !== undefined ? toMajor(init.costPerPack) : "", reorderAt: init.reorderAt ?? 0, supplierId: init.supplierId ?? "", active: init.active ?? true });
  const save = useHAction<void>(() => ({ path: init.id ? `stock-items/${init.id}` : "stock-items", method: init.id ? "PUT" : "POST", body: { name: f.name, category: f.category, unit: f.unit, packSize: f.packSize, costPerPack: toMinor(f.cost), reorderAt: f.reorderAt, supplierId: f.supplierId || null, active: f.active } }), { success: "Saved", onDone: onClose });
  const unitWord = f.unit === "pcs" ? "pieces" : f.unit;
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New ingredient"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Paneer" maxLength={80} autoFocus />}</Field>
        <Field label="Category">
          {(a) => (
            <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {cap(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Counted in">
          {(a) => (
            <Select {...a} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Item["unit"], packSize: e.target.value === "pcs" ? 1 : 1000 })}>
              <option value="g">Grams (g)</option>
              <option value="ml">Millilitres (ml)</option>
              <option value="pcs">Pieces</option>
            </Select>
          )}
        </Field>
        <Field label={`One pack holds (${unitWord})`} hint={f.unit === "g" ? "1000 = a kilo" : f.unit === "ml" ? "1000 = a litre" : "e.g. 100 boxes"}>{(a) => <Input {...a} type="number" min={1} value={f.packSize} onChange={(e) => setF({ ...f, packSize: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        <Field label="Price per pack" hint="Updates by itself when you record purchases.">{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="400" />}</Field>
        <Field label={`Reorder at (${unitWord})`}>{(a) => <Input {...a} type="number" min={0} value={f.reorderAt} onChange={(e) => setF({ ...f, reorderAt: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
        <Field label="Supplier">
          {(a) => (
            <Select {...a} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">None</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" />
        </div>
      </div>
    </Dialog>
  );
}

function SupplierDialog({ init, onClose }: { init: Partial<Supplier>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", phone: init.phone ?? "", email: init.email ?? "", gstin: init.gstin ?? "", notes: init.notes ?? "" });
  const save = useHAction<void>(() => ({ path: init.id ? `suppliers/${init.id}` : "suppliers", method: init.id ? "PUT" : "POST", body: f }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New supplier"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} autoFocus />}</Field>
        <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} />}</Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={120} />}</Field>
        <Field label="GSTIN">{(a) => <Input {...a} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={300} placeholder="Delivers Tue & Fri, 7 am" />}</Field>
      </div>
    </Dialog>
  );
}

function PurchaseDialog({ items, suppliers, onClose }: { items: Item[]; suppliers: Supplier[]; onClose: () => void }) {
  const money = useMoney();
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ stockItemId: items[0]?.id ?? "", packs: "1", cost: "" }]);
  const parsed = lines.filter((l) => l.stockItemId && Number(l.packs) > 0).map((l) => ({ stockItemId: l.stockItemId, packs: Number(l.packs), cost: toMinor(l.cost) }));
  const total = parsed.reduce((a, l) => a + l.cost, 0);
  const save = useHAction<void>(() => ({ path: "purchases", body: { supplierId: supplierId || null, invoiceNo, date, lines: parsed } }), { success: "Purchase recorded — stock updated", onDone: onClose });
  // Picking a supplier shows their ingredients first.
  const sorted = supplierId ? [...items].sort((a, b) => Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId)) : items;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Record a purchase"
      description="From a supplier's bill. Quantities are in packs."
      footer={
        <>
          <span className="mr-auto text-[13.5px] font-semibold tabular-nums">Total {money(total)}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!parsed.length} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier">
            {(a) => (
              <Select {...a} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">None</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Invoice number">{(a) => <Input {...a} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={40} />}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_90px_120px_32px] gap-2 text-[12px] font-medium text-muted">
            <span>Ingredient</span>
            <span>Packs</span>
            <span>Line cost</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const it = items.find((x) => x.id === l.stockItemId);
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_90px_120px_32px] items-center gap-2">
                <Select aria-label="Ingredient" value={l.stockItemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                  {sorted.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({packLabel(s)} pack)
                    </option>
                  ))}
                </Select>
                <Input aria-label="Packs" inputMode="decimal" value={l.packs} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, packs: e.target.value } : x)))} />
                <Input aria-label="Line cost" inputMode="decimal" value={l.cost} placeholder={it ? toMajor(Math.round(it.costPerPack * (Number(l.packs) || 0))) : ""} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} />
                <button type="button" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-full text-muted hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
          <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { stockItemId: sorted[0]?.id ?? "", packs: "1", cost: "" }])}>
            Add a line
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function WasteDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const save = useHAction<void>(() => ({ path: "stock-moves", body: { stockItemId: item.id, kind: "wastage", qty: Math.round(Number(qty) || 0), note } }), { success: "Wastage recorded", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Wastage · ${item.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!(Number(qty) > 0)} onClick={() => save.mutate()}>
            Remove {qty ? qtyLabel(Math.round(Number(qty)), item.unit) : ""}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={`How much (${item.unit})`} hint={`${qtyLabel(item.stock, item.unit)} in stock`}>{(a) => <Input {...a} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />}</Field>
        <div className="flex flex-wrap gap-1.5">
          {["Spoiled", "Expired", "Burnt", "Dropped", "Staff meal"].map((p) => (
            <button key={p} type="button" onClick={() => setNote(p)} aria-pressed={note === p} className={cx("h-7 rounded-full border px-2.5 text-[12px]", note === p ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
              {p}
            </button>
          ))}
        </div>
        <Field label="Note">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}</Field>
      </div>
    </Dialog>
  );
}

function CountDialog({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const money = useMoney();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const counted = items.filter((i) => counts[i.id] !== undefined && counts[i.id] !== "").map((i) => {
    const c = Math.round(Number(counts[i.id]) || 0);
    return { i, c, diff: c - i.stock, value: Math.round(((c - i.stock) * i.costPerPack) / i.packSize) };
  });
  const total = counted.reduce((a, x) => a + x.value, 0);
  const save = useHAction<void>(() => ({ path: "stock-counts", body: { lines: counted.map((x) => ({ stockItemId: x.i.id, counted: x.c })), note } }), { success: "Count saved — stock updated", onDone });
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Stock count"
      description="Weigh or count what's on the shelf, in each ingredient's unit. Leave a row blank to skip it."
      footer={
        <>
          <span className={cx("mr-auto text-[13.5px] font-semibold tabular-nums", total < 0 ? "text-danger" : total > 0 ? "text-success" : "text-muted")}>
            {counted.length} counted · variance {total < 0 ? "−" : total > 0 ? "+" : ""}
            {money(Math.abs(total))}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!counted.length} onClick={() => save.mutate()}>
            Save count
          </Button>
        </>
      }
    >
      <div className="grid max-h-[55vh] gap-1 overflow-y-auto">
        {items.map((i) => {
          const x = counted.find((y) => y.i.id === i.id);
          return (
            <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_130px_110px] items-center gap-2 rounded-[12px] px-2 py-1.5 hover:bg-surface-2">
              <span className="min-w-0">
                <b className="block truncate text-[13.5px] font-medium">{i.name}</b>
                <span className="text-[11.5px] text-muted">system {qtyLabel(i.stock, i.unit)}</span>
              </span>
              <Input aria-label={`${i.name} counted (${i.unit})`} inputMode="numeric" placeholder={`counted ${i.unit}`} value={counts[i.id] ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} />
              <span className={cx("text-right text-[12.5px] font-semibold tabular-nums", x && x.diff < 0 ? "text-danger" : x && x.diff > 0 ? "text-success" : "text-subtle")}>{x ? (x.diff ? qtyLabel(x.diff, i.unit) : "exact") : ""}</span>
            </div>
          );
        })}
      </div>
      <Field label="Note" className="mt-3">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Weekly count" />}</Field>
    </Dialog>
  );
}
