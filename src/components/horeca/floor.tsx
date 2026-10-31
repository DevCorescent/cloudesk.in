"use client";

// Floor & orders: the live table map, each table's order, the waiter's menu
// picker, bills and payments.
import { Bell, CalendarClock, Check, Clock, Gift, Minus, Plus, Printer, Receipt, Search, ShoppingBag, Trash2, Undo2, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, Menu } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Input, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { BillDialog, MOVE_ICONS, MoveDialog, PayDialog, printBill, printKot, ReasonDialog, SOURCE_LABEL, TotalsBlock, type OrderView } from "./bill";
import { toggleOption } from "@/lib/horeca/model";
import { DietMark, minutesSince, Pill, sortTables, useH, useHAction, useHQuery, useMoney } from "./shared";

type OrderSummary = { id: string; number: number; status: string; source: string; since: string; covers: number; guestName: string; total: number; due: number; items: number; pending: number; ready: number; cooking: number };
type Table = { id: string; name: string; seats: number; kind: string; areaId: string | null; order: OrderSummary | null; checks: number; reservation: { id: string; guestName: string; partySize: number; at: string } | null; requests: { id: string; kind: string; at: string }[] };
type Floor = { areas: { id: string; name: string }[]; tables: Table[]; counter: OrderSummary[] };
type MenuData = { categories: { id: string; name: string; active: boolean }[]; items: { id: string; categoryId: string; name: string; price: number; diet: string; available: boolean; modifierGroupIds: string[] }[]; modifiers: { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; price: number }[] }[] };

const REQ: Record<string, string> = { waiter: "🙋 Calling a waiter", water: "💧 Water", bill: "🧾 Wants the bill" };

export function FloorView({ orderId }: { orderId?: string }) {
  const floor = useHQuery<Floor>("floor", { refetchInterval: 5000 });
  const [area, setArea] = useState("all");
  const [selected, setSelected] = useState<string | null>(orderId ? `order:${orderId}` : null); // table id or "order:<id>"
  const [picker, setPicker] = useState<{ tableId: string | null; orderId?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!floor.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const { areas, tables, counter } = floor.data;
  // Rooms only show under "All" while they have an in-room dining order.
  const shown = sortTables(tables, areas).filter((t) => (area === "all" ? t.kind !== "room" || !!t.order || t.requests.length > 0 : area === "rooms" ? t.kind === "room" : t.areaId === area && t.kind !== "room"));
  const selByOrder = selected?.startsWith("order:") ? tables.find((t) => t.order?.id === selected.slice(6)) : undefined;
  const sel = selected?.startsWith("order:") ? selByOrder ?? null : tables.find((t) => t.id === selected);
  const selOrderId = selected?.startsWith("order:") ? selected.slice(6) : sel?.order?.id;
  const hasRooms = tables.some((t) => t.kind === "room");
  return (
    <div>
      <PageHeader
        title="Floor & orders"
        description="Tap a table to take an order, see what's cooking, bill and settle up. Updates every few seconds."
        actions={
          <Button variant="primary" icon={<ShoppingBag className="size-4" />} onClick={() => setPicker({ tableId: null })}>
            Takeaway / counter
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[{ id: "all", name: "All" }, ...areas, ...(hasRooms ? [{ id: "rooms", name: "Rooms" }] : [])].map((a) => (
          <button key={a.id} type="button" onClick={() => setArea(a.id)} aria-pressed={area === a.id} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", area === a.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
            {a.name}
          </button>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          {!tables.length ? (
            <EmptyState title="No tables yet" description="Add tables under QR menu & tables." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {shown.map((t) => (
                <TableTile key={t.id} t={t} now={now} on={selected === t.id || (!!t.order && selOrderId === t.order.id)} onClick={() => setSelected(t.id)} />
              ))}
            </div>
          )}
          {counter.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-[13px] font-semibold text-muted">Takeaway & counter</h2>
              <div className="flex flex-wrap gap-2">
                {counter.map((o) => (
                  <button key={o.id} type="button" onClick={() => setSelected(`order:${o.id}`)} className={cx("rounded-[14px] border px-3 py-2 text-left text-[13px]", selOrderId === o.id ? "border-fg" : "border-border hover:bg-surface-2")}>
                    <b>#{o.number}</b> · {o.items} items · {minutesSince(o.since, now)} min
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          {selOrderId ? (
            <OrderPanel key={selOrderId} orderId={selOrderId} tableId={sel?.id ?? null} requests={sel?.requests ?? []} onAdd={() => setPicker({ tableId: sel?.id ?? null, orderId: selOrderId })} onClose={() => setSelected(null)} onSwitch={(id) => setSelected(`order:${id}`)} />
          ) : sel ? (
            <div className="rounded-[22px] border border-border bg-surface p-6 text-center shadow-sm">
              <p className="text-[13px] text-muted">{sel.kind === "room" ? "In-room dining" : `${sel.seats} seats`}</p>
              <h2 className="mt-1 text-[22px] font-semibold">{sel.name}</h2>
              <p className="mt-2 text-[13.5px] text-muted">Free. Guests can also scan the table&apos;s QR code to order themselves.</p>
              <Button className="mt-5" variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicker({ tableId: sel.id })}>
                Start an order
              </Button>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-border p-8 text-center text-[13.5px] text-muted">Select a table to see its order.</div>
          )}
        </aside>
      </div>
      {picker && <MenuPicker tableId={picker.tableId} orderId={picker.orderId} tableName={tables.find((t) => t.id === picker.tableId)?.name ?? "Takeaway"} onClose={() => setPicker(null)} onPlaced={(id) => { setPicker(null); if (!picker.tableId) setSelected(`order:${id}`); }} />}
    </div>
  );
}

function TableTile({ t, now, on, onClick }: { t: Table; now: number; on: boolean; onClick: () => void }) {
  const money = useMoney();
  const o = t.order;
  const state = t.requests.length ? "call" : o?.status === "billed" ? "billed" : o?.pending ? "pending" : o?.ready ? "ready" : o ? "busy" : "free";
  const tone = {
    free: "border-border bg-surface",
    busy: "border-[#f5c9a4] bg-[#fff6ee] dark:border-[#5a3a22] dark:bg-[#24180f]",
    pending: "border-[#c7d2fe] bg-[#eef2ff] dark:border-[#3730a3] dark:bg-[#161433]",
    ready: "border-success/40 bg-success-soft",
    billed: "border-[#c7d2fe] bg-[#eef2ff] dark:border-[#3730a3] dark:bg-[#161433]",
    call: "border-danger/50 bg-danger-soft",
  }[state];
  return (
    <button type="button" onClick={onClick} className={cx("relative flex aspect-[5/4] flex-col justify-between rounded-[20px] border p-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md", tone, on && "ring-2 ring-fg")}>
      <div className="flex items-start justify-between">
        <span className={cx("min-w-0 truncate font-bold tracking-[-0.02em]", t.name.length > 5 ? "text-[15px]" : "text-[19px]")}>{t.name}</span>
        {o ? <span className="flex items-center gap-1 text-[11.5px] font-medium text-muted"><Clock className="size-3" />{minutesSince(o.since, now)}m</span> : <span className="shrink-0 text-[11.5px] text-subtle">{t.kind === "room" ? "In-room" : `${t.seats} seats`}</span>}
      </div>
      {t.checks > 1 && <span className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-fg px-1.5 text-[10px] font-semibold text-bg">{t.checks} checks</span>}
      {t.requests.length > 0 && (
        <span className="absolute -top-2 -right-2 grid size-7 animate-bounce place-items-center rounded-full bg-danger text-white shadow">
          <Bell className="size-3.5" />
        </span>
      )}
      {o ? (
        <div>
          <p className="text-[16px] font-semibold tabular-nums">{o.total || !o.pending ? money(o.total) : "New QR order"}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {o.pending ? `${o.pending} to confirm · ` : ""}
            {o.cooking ? `${o.cooking} cooking · ` : ""}
            {o.ready ? `${o.ready} ready · ` : ""}
            {o.status === "billed" ? "bill printed" : `${o.items} items`}
            {o.covers ? ` · ${o.covers} 👤` : ""}
          </p>
        </div>
      ) : t.reservation ? (
        <p className="flex items-center gap-1 text-[11.5px] font-medium text-accent">
          <CalendarClock className="size-3" />
          {new Date(t.reservation.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {t.reservation.guestName} ({t.reservation.partySize})
        </p>
      ) : (
        <p className="text-[12px] text-subtle">Free</p>
      )}
    </button>
  );
}

function OrderPanel({ orderId, tableId, requests, onAdd, onClose, onSwitch }: { orderId: string; tableId: string | null; requests: { id: string; kind: string }[]; onAdd: () => void; onClose: () => void; onSwitch: (orderId: string) => void }) {
  const { venue } = useH();
  const money = useMoney();
  const q = useHQuery<OrderView>(`orders/${orderId}`, { refetchInterval: 5000 });
  const checks = useHQuery<{ checks: { id: string; number: number }[] }>(`tables/${tableId}/checks`, { enabled: !!tableId, refetchInterval: 10000 });
  const [bill, setBill] = useState(false);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; name: string } | null>(null);
  const [move, setMove] = useState<"transfer" | "merge" | "split" | null>(null);
  const status = useHAction<{ id: string; status: string; reason?: string }>((b) => ({ path: `items/${b.id}/status`, body: { status: b.status, reason: b.reason } }), { onDone: () => setVoiding(null) });
  const comp = useHAction<{ id: string; comp: boolean }>((b) => ({ path: `items/${b.id}/comp`, body: { comp: b.comp } }), { success: "Updated" });
  const approve = useHAction<void>(() => ({ path: `orders/${orderId}/approve` }), { success: "Sent to the kitchen" });
  const done = useHAction<string>((id) => ({ path: `requests/${id}/done` }));
  const cancelOrder = useHAction<string>((reason) => ({ path: `orders/${orderId}/cancel`, body: { reason } }), { success: "Order cancelled", onDone: onClose });
  if (!q.data) return <Skeleton className="h-96 rounded-[22px]" />;
  const { order, table, items, totals, guest } = q.data;
  const open = order.status === "open" || order.status === "billed";
  const pending = items.filter((i) => i.status === "pending");
  const list = checks.data?.checks ?? [];
  return (
    <div className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-muted">
            Order #{order.number} · {SOURCE_LABEL[order.source] ?? order.source}
            {order.staffName ? ` · ${order.staffName}` : ""}
          </p>
          <h2 className="text-[20px] font-semibold">{table?.name ?? SOURCE_LABEL[order.source] ?? "Counter"}</h2>
          {(order.covers > 0 || guest || order.guestName) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
              {order.covers > 0 && (
                <span className="flex items-center gap-1">
                  <Users className="size-3" />
                  {order.covers}
                </span>
              )}
              {(guest?.name || order.guestName) && <span>{guest?.name || order.guestName}</span>}
              {guest && venue.settings.loyalty.enabled && <span>· {guest.points} pts · visit {guest.visits + 1}</span>}
            </p>
          )}
          {order.deliveryAddress && <p className="mt-0.5 text-[12px] text-muted">🛵 {order.deliveryAddress}</p>}
        </div>
        <div className="flex items-center gap-1">
          <Badge tone={order.status === "paid" ? "success" : order.status === "billed" ? "accent" : order.status === "cancelled" ? "danger" : "warning"}>{order.status === "open" ? "Open" : order.status === "billed" ? "Bill printed" : order.status === "paid" ? "Paid" : "Cancelled"}</Badge>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
      </div>
      {list.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => onSwitch(c.id)} aria-pressed={c.id === orderId} className={cx("h-7 shrink-0 rounded-full border px-3 text-[12px] font-semibold", c.id === orderId ? "border-fg bg-fg text-bg" : "border-border")}>
              Check #{c.number}
            </button>
          ))}
        </div>
      )}
      {requests.length > 0 && (
        <div className="grid gap-1.5 border-b border-border bg-danger-soft/60 p-3">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[13px] font-medium">
              {REQ[r.kind] ?? r.kind}
              <Button size="sm" onClick={() => done.mutate(r.id)}>
                Done
              </Button>
            </div>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[#eef2ff] p-3 text-[13px] dark:bg-[#161433]">
          <span>
            <b>{pending.length}</b> item{pending.length === 1 ? "" : "s"} ordered by QR, waiting for your OK
          </span>
          <Button size="sm" variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
            Confirm & send
          </Button>
        </div>
      )}
      <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className={cx("flex items-start gap-3 px-4 py-3", i.status === "void" && "opacity-50")}>
            <span className="mt-0.5 min-w-6 text-[14px] font-semibold tabular-nums">{i.qty}×</span>
            <div className="min-w-0 flex-1">
              <p className={cx("text-[14px] font-medium", i.status === "void" && "line-through")}>{i.name}</p>
              {i.modifiers.length > 0 && <p className="text-[12px] text-muted">{i.modifiers.map((m) => m.name).join(", ")}</p>}
              {i.notes && <p className="text-[12px] text-muted italic">“{i.notes}”</p>}
              {i.voidReason && <p className="text-[12px] text-danger">Cancelled: {i.voidReason}</p>}
              <div className="mt-1 flex items-center gap-1.5">
                <Pill status={i.status} />
                {i.comp && <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success-soft px-2 text-[11px] font-semibold text-success"><Gift className="size-3" />On the house</span>}
                {i.kotNo !== null && <span className="text-[11px] text-subtle">KOT {i.kotNo}</span>}
              </div>
            </div>
            <div className="text-right">
              <p className={cx("text-[13.5px] tabular-nums", i.comp && "text-subtle line-through")}>{money(i.unitPrice * i.qty)}</p>
              {open && i.status !== "void" && (
                <Menu
                  label={`Actions for ${i.name}`}
                  trigger={(p) => (
                    <button {...p} type="button" className="mt-1 rounded-full px-2 py-0.5 text-[11.5px] text-muted hover:bg-surface-2">
                      Update ▾
                    </button>
                  )}
                  items={[
                    ...(i.status === "pending" ? [] : [{ label: "Cooking", onSelect: () => status.mutate({ id: i.id, status: "preparing" }) }, { label: "Ready", onSelect: () => status.mutate({ id: i.id, status: "ready" }) }, { label: "Served", icon: <Check className="size-4" />, onSelect: () => status.mutate({ id: i.id, status: "served" }) }]),
                    "separator" as const,
                    { label: i.comp ? "Charge again" : "On the house", icon: <Gift className="size-4" />, onSelect: () => comp.mutate({ id: i.id, comp: !i.comp }) },
                    { label: "Cancel item", icon: <Undo2 className="size-4" />, danger: true, onSelect: () => setVoiding({ id: i.id, name: i.name }) },
                  ]}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-4">
        <TotalsBlock v={q.data} open={open} />
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
          <Button icon={<Plus className="size-4" />} onClick={onAdd}>
            Add items
          </Button>
          <Button icon={<Receipt className="size-4" />} onClick={() => setBill(true)}>
            {order.status === "billed" ? "Edit bill" : "Print bill"}
          </Button>
          <Button className="col-span-2" variant="primary" disabled={totals.due <= 0} onClick={() => setPay(true)}>
            Settle {money(totals.due)}
          </Button>
          <div className="col-span-2 grid grid-cols-4 gap-1.5">
            {(["transfer", "merge", "split"] as const).map((m) => (
              <Button key={m} size="sm" variant="ghost" icon={MOVE_ICONS[m]} disabled={(m === "transfer" && !order.tableId) || (m === "split" && items.filter((i) => i.status !== "void").length < 2)} onClick={() => setMove(m)}>
                {m === "transfer" ? "Move" : m === "merge" ? "Merge" : "Split"}
              </Button>
            ))}
            <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => printKot(venue.name, q.data!)}>
              KOT
            </Button>
          </div>
          {totals.paid === 0 && (
            <button type="button" onClick={() => setCancel(true)} className="col-span-2 text-[12px] text-muted hover:text-danger">
              Cancel this order
            </button>
          )}
        </div>
      )}
      {order.status === "paid" && (
        <div className="border-t border-border p-4">
          <Button className="w-full" icon={<Printer className="size-4" />} onClick={() => printBill(venue, q.data!)}>
            Reprint bill
          </Button>
        </div>
      )}
      {bill && <BillDialog view={q.data} onClose={() => setBill(false)} />}
      {pay && <PayDialog view={q.data} onClose={() => setPay(false)} />}
      {move && <MoveDialog view={q.data} mode={move} onClose={() => setMove(null)} onDone={(id) => { setMove(null); if (move === "split") onSwitch(id); }} />}
      {voiding && <ReasonDialog title={`Cancel ${voiding.name}?`} busy={status.isPending} onClose={() => setVoiding(null)} onConfirm={(reason) => status.mutate({ id: voiding.id, status: "void", reason })} />}
      {cancel && <ReasonDialog title="Cancel this whole order?" busy={cancelOrder.isPending} onClose={() => setCancel(false)} onConfirm={(r) => cancelOrder.mutate(r)} />}
    </div>
  );
}

type Line = { itemId: string; name: string; qty: number; options: string[]; optionNames: string[]; unit: number; notes: string };

export function MenuPicker({ tableId, orderId, tableName, onClose, onPlaced }: { tableId: string | null; orderId?: string; tableName: string; onClose: () => void; onPlaced: (orderId: string) => void }) {
  const money = useMoney();
  const m = useHQuery<MenuData>("menu");
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [choosing, setChoosing] = useState<MenuData["items"][number] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const place = useHAction<void, OrderView>(() => ({ path: "orders", body: { tableId, orderId: orderId ?? null, source: tableId ? "staff" : "takeaway", lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, options: l.options, notes: l.notes })) } }), { success: "Sent to the kitchen", onDone: (r) => onPlaced(r.order.id) });
  const data = m.data;
  const cats = data?.categories.filter((c) => c.active) ?? [];
  const items = useMemo(() => (data?.items ?? []).filter((i) => (!cat || i.categoryId === cat) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))), [data, cat, q]);
  const groupsOf = (it: MenuData["items"][number]) => (data?.modifiers ?? []).filter((g) => it.modifierGroupIds.includes(g.id));
  const add = (it: MenuData["items"][number], opts: string[], notes = "") => {
    const gs = groupsOf(it);
    const chosen = gs.flatMap((g) => g.options.filter((o) => opts.includes(o.id)));
    setLines((ls) => [...ls, { itemId: it.id, name: it.name, qty: 1, options: opts, optionNames: chosen.map((o) => o.name), unit: it.price + chosen.reduce((a, o) => a + o.price, 0), notes }]);
  };
  const groupsOk = choosing ? groupsOf(choosing).every((g) => { const n = g.options.filter((o) => picked.includes(o.id)).length; return n >= g.minSelect && n <= g.maxSelect; }) : true;
  const total = lines.reduce((a, l) => a + l.unit * l.qty, 0);
  return (
    <Dialog
      open
      onClose={onClose}
      size="2xl"
      title={`New items · ${tableName}`}
      footer={
        <>
          <span className="mr-auto text-[13.5px] font-semibold tabular-nums">{lines.reduce((a, l) => a + l.qty, 0)} items · {money(total)}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={place.isPending} disabled={!lines.length} onClick={() => place.mutate()}>
            Send to kitchen
          </Button>
        </>
      }
    >
      {!data ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <Input aria-label="Search the menu" className="!pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes and drinks" autoFocus />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setCat("")} aria-pressed={!cat} className={cx("h-7 rounded-full border px-3 text-[12.5px]", !cat ? "border-fg bg-fg text-bg" : "border-border")}>
                All
              </button>
              {cats.map((c) => (
                <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id} className={cx("h-7 rounded-full border px-3 text-[12.5px]", cat === c.id ? "border-fg bg-fg text-bg" : "border-border")}>
                  {c.name}
                </button>
              ))}
            </div>
            {choosing ? (
              <div className="mt-4 rounded-[16px] border border-border p-4">
                <p className="text-[15px] font-semibold">{choosing.name}</p>
                {groupsOf(choosing).map((g) => (
                  <div key={g.id} className="mt-3">
                    <p className="text-[12.5px] font-medium text-muted">
                      {g.name} · {g.minSelect ? `pick ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `up to ${g.maxSelect}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.options.map((o) => {
                        const on = picked.includes(o.id);
                        return (
                          <button key={o.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => toggleOption(p, g, o.id))} className={cx("h-8 rounded-full border px-3 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border")}>
                            {o.name}
                            {o.price ? ` +${money(o.price)}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <Textarea className="mt-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kitchen note (optional)" aria-label="Kitchen note" />
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => setChoosing(null)}>Back</Button>
                  <Button variant="primary" disabled={!groupsOk} onClick={() => { add(choosing, picked, note); setChoosing(null); }}>
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="mt-3 grid max-h-[50vh] gap-1.5 overflow-y-auto sm:grid-cols-2">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      disabled={!it.available}
                      onClick={() => {
                        if (groupsOf(it).length) {
                          setChoosing(it);
                          setPicked(groupsOf(it).flatMap((g) => (g.minSelect === 1 && g.maxSelect === 1 ? [g.options[0].id] : [])));
                          setNote("");
                        } else add(it, []);
                      }}
                      className="flex w-full items-center gap-2 rounded-[12px] border border-border px-3 py-2.5 text-left text-[13.5px] hover:bg-surface-2 disabled:opacity-40"
                    >
                      <DietMark diet={it.diet} />
                      <span className="min-w-0 flex-1 truncate">{it.name}</span>
                      <span className="text-muted tabular-nums">{it.available ? money(it.price) : "Sold out"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-[16px] bg-surface-2 p-3">
            <p className="text-[12.5px] font-semibold text-muted">This round</p>
            {!lines.length ? (
              <p className="mt-6 text-center text-[12.5px] text-muted">Tap dishes to add them.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {lines.map((l, i) => (
                  <li key={i} className="rounded-[12px] bg-surface p-2.5 text-[13px]">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{l.name}</span>
                      <span className="tabular-nums">{money(l.unit * l.qty)}</span>
                    </div>
                    {(l.optionNames.length > 0 || l.notes) && <p className="text-[11.5px] text-muted">{[...l.optionNames, l.notes && `“${l.notes}”`].filter(Boolean).join(", ")}</p>}
                    <div className="mt-1.5 flex items-center gap-1">
                      <button type="button" aria-label="One less" onClick={() => setLines((ls) => ls.flatMap((x, j) => (j !== i ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))} className="grid size-6 place-items-center rounded-full border border-border">
                        <Minus className="size-3" />
                      </button>
                      <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                      <button type="button" aria-label="One more" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.min(50, x.qty + 1) } : x)))} className="grid size-6 place-items-center rounded-full border border-border">
                        <Plus className="size-3" />
                      </button>
                      <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="ml-auto grid size-6 place-items-center rounded-full text-muted hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
