"use client";

// Bar inventory in millilitres: stock per bottle, purchases and wastage, pours
// from orders, physical counts and the variance (what went missing, and its cost).
import { ClipboardCheck, MoreHorizontal, PackagePlus, Pencil, Plus, Trash2, Wine } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, Dialog, Menu, Segmented, Tabs } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { BAR_CATEGORIES } from "@/lib/horeca/model";
import { cap, Stat, Toggle, toMajor, toMinor, useHAction, useHQuery, useMoney } from "./shared";

type BarItem = { id: string; name: string; category: string; bottleMl: number; costPerBottle: number; reorderMl: number; stockMl: number; active: boolean; bottles: number; value: number; low: boolean; sold7: number; daysLeft: number | null };
type Move = { id: string; kind: string; ml: number; note: string; createdAt: string; item: string; barItemId: string };
type Count = { id: string; createdAt: string; note: string; lines: { barItemId: string; name: string; expectedMl: number; countedMl: number; varianceMl: number; varianceValue: number }[]; totalValue: number };

const KIND: Record<string, { label: string; tone: "success" | "danger" | "neutral" | "warning" | "accent" }> = { purchase: { label: "Purchase", tone: "success" }, sale: { label: "Poured (sale)", tone: "neutral" }, void: { label: "Returned (void)", tone: "accent" }, wastage: { label: "Wastage", tone: "danger" }, adjust: { label: "Count adjustment", tone: "warning" } };
const fmtMl = (ml: number) => (Math.abs(ml) >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 ? 2 : 0)} L` : `${ml} ml`);

export function BarView() {
  const money = useMoney();
  const q = useHQuery<{ items: BarItem[]; value: number; low: number }>("bar");
  const [tab, setTab] = useState<"stock" | "moves" | "counts">("stock");
  const [cat, setCat] = useState("all");
  const [edit, setEdit] = useState<Partial<BarItem> | null>(null);
  const [move, setMove] = useState<{ item?: BarItem; kind: "purchase" | "wastage" } | null>(null);
  const [counting, setCounting] = useState(false);
  const [del, setDel] = useState<BarItem | null>(null);
  const remove = useHAction<void>(() => ({ path: `bar-items/${del!.id}`, method: "DELETE" }), { success: "Deleted", onDone: () => setDel(null) });
  const items = useMemo(() => (q.data?.items ?? []).filter((i) => cat === "all" || (cat === "low" ? i.low && i.active : i.category === cat)), [q.data, cat]);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const all = q.data.items;
  const cats = BAR_CATEGORIES.filter((c) => all.some((i) => i.category === c));
  const poured = all.reduce((a, i) => a + i.sold7, 0);
  return (
    <div>
      <PageHeader
        title="Bar inventory"
        description="Every peg and pint is taken out of stock as it's ordered. Count the shelf, and Cloudesk shows exactly what's missing."
        actions={
          <>
            <Button size="sm" icon={<ClipboardCheck className="size-4" />} disabled={!all.length} onClick={() => setCounting(true)}>
              Stock count
            </Button>
            <Button size="sm" icon={<PackagePlus className="size-4" />} disabled={!all.length} onClick={() => setMove({ kind: "purchase" })}>
              Receive stock
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
              Bottle
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value" value={money(q.data.value)} sub="at cost" />
        <Stat label="Running low" value={q.data.low} sub="at or below reorder level" tone={q.data.low ? "warn" : undefined} />
        <Stat label="Poured, last 7 days" value={fmtMl(poured)} sub={`${all.filter((i) => i.sold7 > 0).length} bottles in use`} />
        <Stat label="Bottles tracked" value={all.filter((i) => i.active).length} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mt-5 mb-4"
        tabs={[
          { value: "stock", label: "Stock" },
          { value: "moves", label: "Movements" },
          { value: "counts", label: "Counts & variance" },
        ]}
      />
      {tab === "stock" &&
        (!all.length ? (
          <EmptyState icon={<Wine />} title="Add your bottles" description="Whisky, gin, beer kegs, wine… Then link menu drinks to a bottle and the pour size, and stock looks after itself." action={<Button variant="primary" onClick={() => setEdit({})}>Add a bottle</Button>} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {["all", ...(q.data.low ? ["low"] : []), ...cats].map((c) => (
                <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", cat === c ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2", c === "low" && cat !== c && "border-warning/50 text-warning")}>
                  {c === "low" ? `Running low · ${q.data!.low}` : cap(c)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead className="border-b border-border text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Bottle</th>
                    <th className="px-4 py-2.5 font-medium">In stock</th>
                    <th className="px-4 py-2.5 text-right font-medium">Poured (7d)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lasts</th>
                    <th className="px-4 py-2.5 text-right font-medium">Value</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((i) => {
                    const pct = Math.min(100, (i.stockMl / Math.max(i.reorderMl * 3, i.bottleMl)) * 100);
                    return (
                      <tr key={i.id} className={cx(!i.active && "opacity-50")}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{i.name}</p>
                          <p className="text-[12px] text-muted">
                            {cap(i.category)} · {i.bottleMl} ml bottle · {money(i.costPerBottle)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-28 tabular-nums">
                              <b>{i.bottles.toFixed(i.bottles % 1 ? 1 : 0)}</b> btl <span className="text-[12px] text-muted">({fmtMl(i.stockMl)})</span>
                            </span>
                            {i.low && i.active && <Badge tone="warning">Reorder</Badge>}
                          </div>
                          <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
                            <div className={cx("h-full rounded-full", i.low ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{i.sold7 ? fmtMl(i.sold7) : "—"}</td>
                        <td className={cx("px-4 py-3 text-right tabular-nums", i.daysLeft !== null && i.daysLeft < 4 && "font-semibold text-danger")}>{i.daysLeft === null ? "—" : `${i.daysLeft} days`}</td>
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
                              { label: "Receive stock", icon: <PackagePlus className="size-4" />, onSelect: () => setMove({ item: i, kind: "purchase" }) },
                              { label: "Record wastage", onSelect: () => setMove({ item: i, kind: "wastage" }) },
                              { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEdit(i) },
                              "separator",
                              { label: "Delete", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel(i) },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ))}
      {tab === "moves" && <Moves />}
      {tab === "counts" && <Counts onStart={() => setCounting(true)} />}
      {edit && <ItemDialog init={edit} onClose={() => setEdit(null)} />}
      {move && <MoveDialog items={all} init={move} onClose={() => setMove(null)} />}
      {counting && <CountDialog items={all.filter((i) => i.active)} onClose={() => setCounting(false)} onDone={() => { setCounting(false); setTab("counts"); }} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${del?.name}?`} description="Its history is deleted too, and drinks linked to it stop deducting stock." confirmLabel="Delete" />
    </div>
  );
}

function Moves() {
  const q = useHQuery<{ moves: Move[] }>("bar-moves");
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.moves.length) return <EmptyState title="No movements yet" description="Purchases, pours, wastage and count adjustments show here." />;
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
      <ul className="divide-y divide-border">
        {q.data.moves.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
            <Badge tone={KIND[m.kind]?.tone}>{KIND[m.kind]?.label ?? m.kind}</Badge>
            <span className="min-w-0 flex-1 truncate">
              <b className="font-medium">{m.item}</b>
              {m.note && <span className="text-muted"> · {m.note}</span>}
            </span>
            <span className={cx("font-semibold tabular-nums", m.ml > 0 ? "text-success" : "text-fg")}>
              {m.ml > 0 ? "+" : "−"}
              {fmtMl(Math.abs(m.ml))}
            </span>
            <span className="w-32 text-right text-[12px] text-muted">{new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Counts({ onStart }: { onStart: () => void }) {
  const money = useMoney();
  const q = useHQuery<{ counts: Count[] }>("bar-counts");
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data) return <Skeleton className="h-64 rounded-[20px]" />;
  if (!q.data.counts.length) return <EmptyState icon={<ClipboardCheck />} title="No counts yet" description="Count the shelf at closing. The difference from what was poured is your variance — spills, free pours or worse." action={<Button variant="primary" onClick={onStart}>Start a count</Button>} />;
  return (
    <div className="grid gap-3">
      {q.data.counts.map((c) => {
        const off = c.lines.filter((l) => l.varianceMl !== 0);
        const shown = open === c.id;
        return (
          <section key={c.id} className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm">
            <button type="button" onClick={() => setOpen(shown ? null : c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <ClipboardCheck className="size-4 text-muted" />
              <span className="min-w-0 flex-1">
                <b className="block text-[14px]">{new Date(c.createdAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b>
                <span className="text-[12px] text-muted">
                  {c.lines.length} bottles counted · {off.length} off{c.note ? ` · ${c.note}` : ""}
                </span>
              </span>
              <span className={cx("text-[15px] font-bold tabular-nums", c.totalValue < 0 ? "text-danger" : c.totalValue > 0 ? "text-success" : "text-muted")}>
                {c.totalValue < 0 ? "−" : c.totalValue > 0 ? "+" : ""}
                {money(Math.abs(c.totalValue))}
              </span>
            </button>
            {shown && (
              <table className="w-full border-t border-border text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bottle</th>
                    <th className="px-4 py-2 text-right font-medium">Expected</th>
                    <th className="px-4 py-2 text-right font-medium">Counted</th>
                    <th className="px-4 py-2 text-right font-medium">Variance</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {c.lines.map((l) => (
                    <tr key={l.barItemId} className={cx(l.varianceMl < 0 && "bg-danger-soft/40")}>
                      <td className="px-4 py-2">{l.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMl(l.expectedMl)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMl(l.countedMl)}</td>
                      <td className={cx("px-4 py-2 text-right font-semibold tabular-nums", l.varianceMl < 0 ? "text-danger" : l.varianceMl > 0 ? "text-success" : "text-muted")}>{l.varianceMl ? `${l.varianceMl > 0 ? "+" : "−"}${fmtMl(Math.abs(l.varianceMl))}` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.varianceValue ? money(l.varianceValue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ItemDialog({ init, onClose }: { init: Partial<BarItem>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", category: init.category ?? "whisky", bottleMl: init.bottleMl ?? 750, cost: init.costPerBottle !== undefined ? toMajor(init.costPerBottle) : "", reorderMl: init.reorderMl ?? 750, active: init.active ?? true });
  const save = useHAction<void>(() => ({ path: init.id ? `bar-items/${init.id}` : "bar-items", method: init.id ? "PUT" : "POST", body: { name: f.name, category: f.category, bottleMl: f.bottleMl, costPerBottle: toMinor(f.cost), reorderMl: f.reorderMl, active: f.active } }), { success: init.id ? "Saved" : "Bottle added — receive stock to fill it", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New bottle"}
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
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Glenfiddich 12" autoFocus />}</Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {BAR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {cap(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Bottle size (ml)">
          {(a) => (
            <div className="flex gap-1.5">
              <Input {...a} type="number" min={50} value={f.bottleMl} onChange={(e) => setF({ ...f, bottleMl: Math.max(50, Number(e.target.value) || 50) })} />
              {[750, 1000, 330].map((m) => (
                <button key={m} type="button" onClick={() => setF({ ...f, bottleMl: m })} className="h-8 shrink-0 rounded-full border border-border px-2 text-[12px] hover:bg-surface-2">
                  {m}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Cost per bottle">{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="3200" />}</Field>
        <Field label="Reorder at (ml)" hint="Flag as low at or below this.">{(a) => <Input {...a} type="number" min={0} value={f.reorderMl} onChange={(e) => setF({ ...f, reorderMl: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
        <div className="sm:col-span-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="In use" />
        </div>
      </div>
    </Dialog>
  );
}

function MoveDialog({ items, init, onClose }: { items: BarItem[]; init: { item?: BarItem; kind: "purchase" | "wastage" }; onClose: () => void }) {
  const [kind, setKind] = useState(init.kind);
  const [itemId, setItemId] = useState(init.item?.id ?? items[0]?.id ?? "");
  const [unit, setUnit] = useState<"bottles" | "ml">(init.kind === "purchase" ? "bottles" : "ml");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const item = items.find((i) => i.id === itemId);
  const n = Number(qty) || 0;
  const ml = unit === "bottles" ? Math.round(n * (item?.bottleMl ?? 0)) : Math.round(n);
  const save = useHAction<void>(() => ({ path: "bar-moves", body: { barItemId: itemId, kind, bottles: unit === "bottles" ? n : 0, ml: unit === "ml" ? Math.round(n) : 0, note } }), { success: kind === "purchase" ? "Stock received" : "Wastage recorded", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === "purchase" ? "Receive stock" : "Record wastage"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!itemId || ml <= 0} onClick={() => save.mutate()}>
            {kind === "purchase" ? "Add" : "Remove"} {ml > 0 ? fmtMl(ml) : ""}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "purchase", label: "Purchase" }, { value: "wastage", label: "Wastage / breakage" }]} />
        <Field label="Bottle">
          {(a) => (
            <Select {...a} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — {fmtMl(i.stockMl)} in stock
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Quantity">{(a) => <Input {...a} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={unit === "bottles" ? "6" : "60"} autoFocus />}</Field>
          <Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: "bottles", label: "Bottles" }, { value: "ml", label: "ml" }]} />
        </div>
        <Field label="Note">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={kind === "purchase" ? "Invoice #4471, ABC Distributors" : "Bottle dropped at the bar"} />}</Field>
      </div>
    </Dialog>
  );
}

/** Count bottles: whole bottles + an estimate of the open one. */
function CountDialog({ items, onClose, onDone }: { items: BarItem[]; onClose: () => void; onDone: () => void }) {
  const money = useMoney();
  const [counts, setCounts] = useState<Record<string, { full: string; open: string }>>({});
  const [note, setNote] = useState("");
  const [review, setReview] = useState(false);
  const counted = items
    .filter((i) => counts[i.id] && (counts[i.id].full !== "" || counts[i.id].open !== ""))
    .map((i) => {
      const c = counts[i.id];
      const ml = Math.round((Number(c.full) || 0) * i.bottleMl + (Number(c.open) || 0));
      return { i, ml, diff: ml - i.stockMl, value: Math.round(((ml - i.stockMl) * i.costPerBottle) / i.bottleMl) };
    });
  const total = counted.reduce((a, c) => a + c.value, 0);
  const save = useHAction<void>(() => ({ path: "bar-counts", body: { lines: counted.map((c) => ({ barItemId: c.i.id, countedMl: c.ml })), note } }), { success: "Count saved — stock updated", onDone });
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={review ? "Check the variance" : "Stock count"}
      description={review ? "Stock is set to what you counted. The difference is recorded as an adjustment." : "Count full bottles, and estimate the open one in ml. Leave a row blank to skip it."}
      footer={
        review ? (
          <>
            <span className={cx("mr-auto text-[14px] font-semibold", total < 0 ? "text-danger" : "text-success")}>
              Variance {total < 0 ? "−" : "+"}
              {money(Math.abs(total))}
            </span>
            <Button onClick={() => setReview(false)}>Back</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save count
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-[13px] text-muted">
              {counted.length} of {items.length} counted
            </span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!counted.length} onClick={() => setReview(true)}>
              Review
            </Button>
          </>
        )
      }
    >
      {review ? (
        <div className="grid gap-3">
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-2 font-medium">Bottle</th>
                <th className="py-2 text-right font-medium">System says</th>
                <th className="py-2 text-right font-medium">Counted</th>
                <th className="py-2 text-right font-medium">Difference</th>
                <th className="py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {counted.map(({ i, ml, diff, value }) => (
                <tr key={i.id}>
                  <td className="py-2 font-medium">{i.name}</td>
                  <td className="py-2 text-right tabular-nums">{fmtMl(i.stockMl)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtMl(ml)}</td>
                  <td className={cx("py-2 text-right font-semibold tabular-nums", diff < 0 ? "text-danger" : diff > 0 ? "text-success" : "text-muted")}>{diff ? `${diff > 0 ? "+" : "−"}${fmtMl(Math.abs(diff))}` : "Exact"}</td>
                  <td className="py-2 text-right tabular-nums">{value ? money(value) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Note">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Closing count, Saturday" maxLength={300} />}</Field>
        </div>
      ) : (
        <div className="grid max-h-[60vh] gap-1 overflow-y-auto">
          {items.map((i) => (
            <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_96px_110px] items-center gap-2 rounded-[12px] px-2 py-1.5 hover:bg-surface-2">
              <span className="min-w-0">
                <b className="block truncate text-[13.5px] font-medium">{i.name}</b>
                <span className="text-[11.5px] text-muted">
                  {i.bottleMl} ml · system {fmtMl(i.stockMl)}
                </span>
              </span>
              <Input aria-label={`${i.name} full bottles`} inputMode="numeric" placeholder="Full btl" value={counts[i.id]?.full ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: { full: e.target.value, open: counts[i.id]?.open ?? "" } })} />
              <Input aria-label={`${i.name} open bottle ml`} inputMode="numeric" placeholder="+ open (ml)" value={counts[i.id]?.open ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: { full: counts[i.id]?.full ?? "", open: e.target.value } })} />
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
