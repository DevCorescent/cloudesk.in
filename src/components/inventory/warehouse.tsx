"use client";

// The warehouse floor: bins with what's in them and putting stock away,
// waves of orders picked (with a scanner), packed and dispatched, stock value
// by FIFO and average with its age, and the cycle counts that are due.
import { ArrowLeft, Plus, ScanLine, Truck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { AGE_BUCKETS, BIN_KINDS } from "@/lib/inventory/model";
import { Empty, Section, Stat, fmt, fmtQty, inr, invApi, short, useInv, useInvAction, useInvQuery, whName } from "./shared";

type BinView = { bins: { id: string; code: string; zone: string; kind: keyof typeof BIN_KINDS; active: boolean; stock: { itemId: string; batch: string; qty: number; name: string; unit: string }[] }[]; unplaced: { itemId: string; batch: string; qty: number; name: string; unit: string }[] };

export function BinsView() {
  const { meta } = useInv();
  const [wh, setWh] = useState(meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "");
  const q = useInvQuery<BinView>(wh ? `bins?warehouseId=${wh}` : null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ itemId: string; batch: string; fromBinId: string | null; max: number; name: string } | null>(null);
  return (
    <div>
      <PageHeader title="Bins" description="Where in each location stock sits. Stock in a quarantine bin counts as on hand but not available to sell." actions={<div className="flex gap-2">{meta.warehouses.length > 1 && <Select aria-label="Location" className="!w-auto" value={wh} onChange={(e) => setWh(e.target.value)}>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}{meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Bin</Button>}</div>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          {q.data.unplaced.length > 0 && (
            <Section title="Not put away">
              <ul className="divide-y divide-border text-[13px]">
                {q.data.unplaced.map((u) => <li key={`${u.itemId}${u.batch}`} className="flex items-center justify-between gap-3 py-2"><span>{u.name}{u.batch ? <span className="text-muted"> · batch {u.batch}</span> : ""}</span><span className="flex items-center gap-3"><b className="tabular-nums">{fmtQty(u.qty, u.unit)}</b>{meta.me.write && q.data!.bins.length > 0 && <Button size="sm" onClick={() => setMoving({ itemId: u.itemId, batch: u.batch, fromBinId: null, max: u.qty, name: u.name })}>Put away</Button>}</span></li>)}
              </ul>
            </Section>
          )}
          {!q.data.bins.length ? <EmptyState title="No bins here" description="Add bins (racks, shelves, zones) to know where stock sits and to pick from them. A quarantine bin holds stock that isn't sellable." /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {q.data.bins.map((b) => (
                <div key={b.id} className={cx("rounded-[18px] border bg-surface p-4 shadow-sm", b.kind === "quarantine" ? "border-warning" : "border-border", !b.active && "opacity-60")}>
                  <p className="flex items-center justify-between gap-2"><b className="font-mono text-[14px]">{b.code}</b><span className="text-[11.5px] text-muted">{[b.zone, b.kind !== "storage" ? BIN_KINDS[b.kind] : ""].filter(Boolean).join(" · ")}</span></p>
                  {!b.stock.length ? <p className="mt-2 text-[12.5px] text-muted">Empty</p> : (
                    <ul className="mt-2 grid gap-1 text-[12.5px]">
                      {b.stock.map((x) => <li key={`${x.itemId}${x.batch}`} className="flex justify-between gap-2"><span className="truncate">{x.name}{x.batch ? ` · ${x.batch}` : ""}</span><span className="flex items-center gap-2 tabular-nums">{fmtQty(x.qty, x.unit)}{meta.me.write && <button type="button" className="text-[11.5px] underline" onClick={() => setMoving({ itemId: x.itemId, batch: x.batch, fromBinId: b.id, max: x.qty, name: x.name })}>move</button>}</span></li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {adding && <BinDialog warehouseId={wh} onClose={() => setAdding(false)} />}
      {moving && q.data && <MoveDialog warehouseId={wh} bins={q.data.bins} from={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function BinDialog({ warehouseId, onClose }: { warehouseId: string; onClose: () => void }) {
  const [f, setF] = useState({ code: "", zone: "", kind: "storage" });
  const save = useInvAction(() => ({ path: "bins", body: { ...f, warehouseId } }), { success: "Bin added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="New bin" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code.trim()} onClick={() => save.mutate(undefined)}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={30} placeholder="A-01-03" />}</Field>
        <Field label="Zone">{(a) => <Input {...a} value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} maxLength={40} placeholder="Aisle A" />}</Field>
        <Field label="Kind">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(BIN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

function MoveDialog({ warehouseId, bins, from, onClose }: { warehouseId: string; bins: BinView["bins"]; from: { itemId: string; batch: string; fromBinId: string | null; max: number; name: string }; onClose: () => void }) {
  const [f, setF] = useState({ qty: String(from.max), toBinId: "" });
  const save = useInvAction(() => ({ path: "bin-moves", body: { warehouseId, itemId: from.itemId, batch: from.batch, qty: Number(f.qty), fromBinId: from.fromBinId, toBinId: f.toBinId || null } }), { success: "Moved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={from.fromBinId ? `Move ${from.name}` : `Put away ${from.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!(Number(f.qty) > 0) || (!f.toBinId && !from.fromBinId)} onClick={() => save.mutate(undefined)}>Move</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity" hint={`Up to ${fmtQty(from.max)}`}>{(a) => <Input {...a} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="To">{(a) => <Select {...a} value={f.toBinId} onChange={(e) => setF({ ...f, toBinId: e.target.value })}>{from.fromBinId ? <option value="">Out of bins (not put away)</option> : <option value="">Choose a bin…</option>}{bins.filter((b) => b.active && b.id !== from.fromBinId).map((b) => <option key={b.id} value={b.id}>{b.code}{b.kind === "quarantine" ? " (quarantine)" : ""}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

// ── Waves ───────────────────────────────────────────────────────────────────

type Wave = { id: string; number: string; warehouseId: string; status: string; orderIds: string[]; lines: { orderId: string; lineId: string; itemId: string; qty: number; picked: number; binId: string | null; batch: string; serials: string[] }[]; packages: { orderId: string; boxes: number; weightKg: number }[]; createdAt: string };
const WAVE_TONE: Record<string, string> = { picking: "bg-accent-soft text-accent", packed: "bg-warning-soft text-warning", dispatched: "bg-success-soft text-success", cancelled: "bg-surface-2 text-muted" };

export function WavesView() {
  const { meta, go } = useInv();
  const q = useInvQuery<{ waves: Wave[] }>("waves");
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader title="Pick, pack & dispatch" description="Group confirmed sales orders into a wave, pick them from their bins (with a scanner if you have one), pack, and dispatch — each order gets its delivery challan." actions={meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Wave</Button>} />
      {!q.data ? <Skeleton className="h-60 rounded-[20px]" /> : !q.data.waves.length ? <Empty>No waves yet. Orders confirmed in Sales show up here to pick.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data.waves.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => go(`waves/${w.id}`)} className="w-full rounded-[18px] border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2">
                <span className="flex items-center justify-between gap-2"><b className="font-semibold">{w.number}</b><span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold", WAVE_TONE[w.status])}>{w.status[0].toUpperCase() + w.status.slice(1)}</span></span>
                <span className="mt-1 block text-[12.5px] text-muted">{whName(meta, w.warehouseId)} · {w.orderIds.length} order{w.orderIds.length === 1 ? "" : "s"} · {w.lines.filter((l) => l.picked >= l.qty).length} of {w.lines.length} lines picked</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && <WaveDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function WaveDialog({ onClose }: { onClose: () => void }) {
  const { meta, go } = useInv();
  const [wh, setWh] = useState(meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "");
  const q = useInvQuery<{ orders: { id: string; number: string; client: string; expectedDate: string | null; lines: number }[] }>(wh ? `wave-candidates?warehouseId=${wh}` : null);
  const [picked, setPicked] = useState<string[]>([]);
  const save = useInvAction<void, { wave: { id: string } }>(() => ({ path: "waves", body: { warehouseId: wh, orderIds: picked } }), { success: "Wave started", onDone: (r) => (onClose(), go(`waves/${r.wave.id}`)) });
  return (
    <Dialog open onClose={onClose} title="New wave" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!picked.length} onClick={() => save.mutate()}>Start picking</Button></>}>
      <div className="grid gap-4">
        {meta.warehouses.length > 1 && <Field label="From">{(a) => <Select {...a} value={wh} onChange={(e) => (setWh(e.target.value), setPicked([]))}>{meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>}
        {!q.data ? <Skeleton className="h-24 rounded-[14px]" /> : !q.data.orders.length ? <Empty>No confirmed orders waiting to go out from here.</Empty> : (
          <ul className="divide-y divide-border text-[13px]">
            {q.data.orders.map((o) => <li key={o.id}><label className="flex cursor-pointer items-center gap-3 py-2"><input type="checkbox" aria-label={`Pick ${o.number}`} checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} className="size-4" /><span className="flex-1"><b className="font-medium">{o.number}</b> · {o.client}<span className="block text-[12px] text-muted">{o.lines} line{o.lines === 1 ? "" : "s"}{o.expectedDate ? ` · expected ${fmt(o.expectedDate)}` : ""}</span></span></label></li>)}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

type WaveDetail = { wave: Wave; orders: { id: string; number: string; client: string }[]; items: { id: string; name: string; sku: string; barcode: string; unit: string; trackSerials: boolean }[]; bins: { itemId: string; binId: string; code: string; zone: string; qty: number; batch: string }[] };

export function WavePage({ id }: { id: string }) {
  const { meta, orgId, go } = useInv();
  const toast = useToast();
  const q = useInvQuery<WaveDetail>(`waves/${id}`);
  const [edits, setEdits] = useState<Record<string, { picked: string; binId: string; serials: string }>>({});
  const [boxes, setBoxes] = useState<Record<string, { boxes: string; weightKg: string }>>({});
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const save = useInvAction<void>(() => ({ path: `waves/${id}/pick`, body: { lines: rows().map((r) => ({ orderId: r.orderId, lineId: r.lineId, picked: Number(r.e.picked) || 0, binId: r.e.binId || null, serials: r.e.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) })) } }), { success: "Picks saved" });
  const pack = useInvAction<void>(() => ({ path: `waves/${id}/pack`, body: { packages: (q.data?.orders ?? []).map((o) => ({ orderId: o.id, boxes: Number(boxes[o.id]?.boxes) || 1, weightKg: Number(boxes[o.id]?.weightKg) || 0 })) } }), { success: "Packed" });
  const dispatch = useInvAction<void, { challans: string[] }>(() => ({ path: `waves/${id}/dispatch` }), { success: (r) => `Dispatched — ${r.challans.join(", ")}` });
  const cancel = useInvAction<void>(() => ({ path: `waves/${id}/cancel` }), { success: "Wave cancelled", onDone: () => go("waves") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { wave: w, orders, items, bins } = q.data;
  const key = (l: { orderId: string; lineId: string }) => `${l.orderId}|${l.lineId}`;
  function rows() {
    return w.lines.map((l) => ({ ...l, e: edits[key(l)] ?? { picked: String(l.picked || ""), binId: l.binId ?? bins.find((b) => b.itemId === l.itemId)?.binId ?? "", serials: l.serials.join("\n") } }));
  }
  const set = (l: { orderId: string; lineId: string }, p: Partial<{ picked: string; binId: string; serials: string }>) => {
    const cur = rows().find((r) => key(r) === key(l))!.e;
    setEdits({ ...edits, [key(l)]: { ...cur, ...p } });
  };
  const onScan = async () => {
    const c = code.trim();
    setCode("");
    if (!c) return;
    try {
      const r = await api<{ kind: string; item?: { id: string }; serial?: { itemId: string; serial: string } }>(invApi(orgId, `scan?code=${encodeURIComponent(c)}`));
      const itemId = r.item?.id ?? r.serial?.itemId;
      const line = rows().find((x) => x.itemId === itemId && (Number(x.e.picked) || 0) < x.qty);
      if (!line) throw new Error(itemId ? "Everything of that item is picked" : "That isn't on this wave");
      set(line, { picked: String((Number(line.e.picked) || 0) + 1), ...(r.serial ? { serials: [line.e.serials, r.serial.serial].filter(Boolean).join("\n") } : {}) });
      toast({ tone: "success", title: `${items.find((i) => i.id === line.itemId)?.name}: ${(Number(line.e.picked) || 0) + 1} of ${line.qty}` });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
    scanRef.current?.focus();
  };
  const open = w.status === "picking" || w.status === "packed";
  return (
    <div>
      <Link href="/inventory/waves" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Waves</Link>
      <PageHeader title={w.number} description={`${whName(meta, w.warehouseId)} · ${orders.map((o) => `${o.number} (${o.client})`).join(", ")}`} actions={meta.me.write && open && <div className="flex flex-wrap gap-2">{w.status === "picking" && <><Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save picks</Button><Button size="sm" onClick={() => save.mutateAsync().then(() => pack.mutate())}>Packed</Button></>}<Button size="sm" variant="primary" icon={<Truck className="size-3.5" />} loading={dispatch.isPending} onClick={() => save.mutateAsync().then(() => dispatch.mutate())}>Dispatch</Button><Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>Cancel</Button></div>} />
      {open && w.status === "picking" && (
        <div className="mb-4 flex items-center gap-2 rounded-[14px] border border-border bg-surface px-3 py-2">
          <ScanLine className="size-4 text-muted" />
          <input ref={scanRef} aria-label="Scan" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void onScan())} placeholder="Scan a barcode, SKU or serial — each scan picks one" className="h-8 flex-1 bg-transparent text-[13px] outline-none" autoFocus />
        </div>
      )}
      <Section title="Pick list">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <FormLines className="w-full min-w-[720px] text-[13px]">
            <thead className="text-left text-[12px] text-muted"><tr><th className="py-1.5 font-medium">Item</th><th className="py-1.5 font-medium">Order</th><th className="py-1.5 font-medium">From bin</th><th className="w-24 py-1.5 font-medium">Picked</th><th className="py-1.5 font-medium">Serials</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows().map((r) => {
                const it = items.find((i) => i.id === r.itemId);
                const choices = bins.filter((b) => b.itemId === r.itemId);
                const done = (Number(r.e.picked) || 0) >= r.qty;
                return (
                  <tr key={key(r)} className={cx("align-top", done && "bg-success-soft/40")}>
                    <td className="py-2">{it?.name}<span className="block text-[12px] text-muted">{fmtQty(r.qty, it?.unit)} to pick{it?.sku ? ` · ${it.sku}` : ""}</span></td>
                    <td className="py-2 text-muted">{orders.find((o) => o.id === r.orderId)?.number}</td>
                    <td className="py-2 pr-2">{choices.length ? <Select aria-label={`Bin for ${it?.name}`} value={r.e.binId} disabled={!open || w.status !== "picking"} onChange={(e) => set(r, { binId: e.target.value })}><option value="">Anywhere</option>{choices.map((b) => <option key={b.binId} value={b.binId}>{b.code} · {fmtQty(b.qty)}</option>)}</Select> : <span className="text-muted">—</span>}</td>
                    <td className="py-2 pr-2"><Input aria-label={`Picked of ${it?.name}`} inputMode="decimal" value={r.e.picked} disabled={w.status !== "picking"} onChange={(e) => set(r, { picked: e.target.value })} placeholder="0" /></td>
                    <td className="py-2">{it?.trackSerials ? <Textarea aria-label={`Serials for ${it.name}`} rows={2} value={r.e.serials} disabled={w.status !== "picking"} onChange={(e) => set(r, { serials: e.target.value })} placeholder="One per line" /> : <span className="text-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </FormLines>
        </div>
      </Section>
      {w.status === "picking" && (
        <div className="mt-5">
          <Section title="Packing">
            <div className="grid gap-3">
              {orders.map((o) => <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_100px_120px] items-center gap-2 text-[13px]"><span>{o.number} · {o.client}</span><Input aria-label={`Boxes for ${o.number}`} inputMode="numeric" placeholder="Boxes" value={boxes[o.id]?.boxes ?? ""} onChange={(e) => setBoxes({ ...boxes, [o.id]: { ...boxes[o.id], boxes: e.target.value } })} /><Input aria-label={`Weight for ${o.number}`} inputMode="decimal" placeholder="Weight kg" value={boxes[o.id]?.weightKg ?? ""} onChange={(e) => setBoxes({ ...boxes, [o.id]: { ...boxes[o.id], weightKg: e.target.value } })} /></div>)}
            </div>
          </Section>
        </div>
      )}
      {w.packages.length > 0 && <p className="mt-3 text-[12.5px] text-muted">Packed: {w.packages.map((p) => `${orders.find((o) => o.id === p.orderId)?.number} ${p.boxes} box${p.boxes === 1 ? "" : "es"}${p.weightKg ? `, ${p.weightKg} kg` : ""}`).join(" · ")}</p>}
    </div>
  );
}

// ── Stock value & age, cycle counts ─────────────────────────────────────────

type Value = { method: "average" | "fifo"; rows: { id: string; name: string; sku: string; unit: string; category: string; onHand: number; average: number; fifo: number; ages: { bucket: string; qty: number; value: number }[] }[]; buckets: { bucket: string; value: number }[]; totals: { average: number; fifo: number } };

export function StockValueView() {
  const q = useInvQuery<Value>("stock-value");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Stock value & age" description="What stock in hand is worth by weighted average and by FIFO (the newest receipts), and how long it's been sitting." />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Value · average${d.method === "average" ? " (used)" : ""}`} value={short(d.totals.average)} />
            <Stat label={`Value · FIFO${d.method === "fifo" ? " (used)" : ""}`} value={short(d.totals.fifo)} />
            {d.buckets.filter((b) => b.bucket === "91-180" || b.bucket === "180+").map((b) => <Stat key={b.bucket} label={`Over ${b.bucket === "180+" ? "180" : "90"} days`} value={short(b.value)} tone={b.value ? "warn" : undefined} />)}
          </div>
          <Section title="By item">
            <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead className="text-right text-[12px] text-muted"><tr><th className="py-1.5 text-left font-medium">Item</th><th className="py-1.5 font-medium">On hand</th><th className="py-1.5 font-medium">Average</th><th className="py-1.5 font-medium">FIFO</th>{AGE_BUCKETS.map((b) => <th key={b.key} className="py-1.5 font-medium">{b.key} d</th>)}</tr></thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 text-left">{r.name}<span className="block text-[12px] text-muted">{[r.sku, r.category].filter(Boolean).join(" · ")}</span></td>
                      <td className="py-2">{fmtQty(r.onHand, r.unit)}</td>
                      <td className="py-2">{inr(r.average)}</td>
                      <td className="py-2">{inr(r.fifo)}</td>
                      {r.ages.map((a) => <td key={a.bucket} className={cx("py-2", a.qty && (a.bucket === "180+" || a.bucket === "91-180") && "text-warning")}>{a.qty ? fmtQty(a.qty) : "—"}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-muted">FIFO takes what&apos;s in hand to be the latest receipts; stock older than Cloudesk&apos;s history is valued at average cost and counted as 180+ days. Store sales made outside Inventory reduce stock without changing which receipts are left.</p>
          </Section>
        </div>
      )}
    </div>
  );
}

type Due = { classes: Record<string, "A" | "B" | "C">; every: { A: number; B: number; C: number }; due: { itemId: string; name: string; sku: string; warehouseId: string; cls: "A" | "B" | "C"; lastCounted: string | null; overdueDays: number }[] };

export function CountsDueView() {
  const { meta, go } = useInv();
  const q = useInvQuery<Due>("counts-due");
  const d = q.data;
  return (
    <div>
      <PageHeader title="Cycle counts due" description="Items are classed A, B or C by what a year of their use is worth; each class is counted on its own schedule." />
      {!d ? <Skeleton className="h-60 rounded-[20px]" /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-3 gap-3">{(["A", "B", "C"] as const).map((c) => <Stat key={c} label={`${c} items`} value={Object.values(d.classes).filter((x) => x === c).length} sub={`counted every ${d.every[c]} days`} />)}</div>
          <Section title={`${d.due.length} due`}>
            {!d.due.length ? <Empty>Everything has been counted on schedule.</Empty> : (
              <ul className="divide-y divide-border text-[13px]">
                {d.due.map((x) => <li key={`${x.itemId}${x.warehouseId}`} className="flex items-center justify-between gap-3 py-2"><span><span className={cx("mr-2 inline-grid size-5 place-items-center rounded-full text-[11px] font-bold", x.cls === "A" ? "bg-danger-soft text-danger" : x.cls === "B" ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>{x.cls}</span>{x.name}<span className="text-muted"> · {whName(meta, x.warehouseId)}</span></span><span className="text-[12px] text-muted">{x.lastCounted ? `last ${fmt(x.lastCounted)}${x.overdueDays ? ` · ${x.overdueDays} days late` : ""}` : "never counted"}</span></li>)}
              </ul>
            )}
            {d.due.length > 0 && <Button size="sm" variant="primary" className="mt-3" onClick={() => go("counts")}>Count now</Button>}
          </Section>
        </div>
      )}
    </div>
  );
}
