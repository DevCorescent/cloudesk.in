"use client";

// The Horeca POS: a full-window till for dine-in, takeaway, delivery and room
// service. Tap or search dishes (or type a dish's short code and press
// Enter), send them to the kitchen with a KOT, then bill and settle — cash,
// UPI, card, to the room, loyalty points or split. Tickets can be held and
// picked up again; the screen locks with the staff PIN.
import { ArrowLeft, Ban, BedDouble, Bike, ChevronDown, Clock, Hand, LayoutGrid, Lock, Maximize2, Minimize2, Minus, PauseCircle, Plus, Printer, Receipt, Search, Send, ShoppingBag, Trash2, User, UtensilsCrossed, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, cx, Field, Input, Textarea } from "@/components/ui/primitives";
import { BillDialog, PayDialog, printKot, TotalsBlock, type OrderView } from "./bill";
import { toggleOption } from "@/lib/horeca/model";
import { DietMark, minutesSince, sortTables, useH, useHAction, useHQuery, useMoney } from "./shared";

type Kind = "staff" | "takeaway" | "delivery" | "room";
type MenuItem = { id: string; categoryId: string; name: string; price: number; diet: string; available: boolean; modifierGroupIds: string[]; code: string; image: string };
type MenuData = { categories: { id: string; name: string; active: boolean; station: string }[]; items: MenuItem[]; modifiers: { id: string; name: string; minSelect: number; maxSelect: number; options: { id: string; name: string; price: number }[] }[] };
type FloorTable = { id: string; name: string; seats: number; kind: string; areaId: string | null; order: { id: string; number: number; status: string; total: number; since: string; covers: number } | null; checks: number };
type Floor = { areas: { id: string; name: string }[]; tables: FloorTable[]; counter: { id: string; number: number; source: string; since: string; total: number; guestName: string; deliveryAddress: string }[] };
type Line = { key: string; itemId: string; name: string; qty: number; options: string[]; optionNames: string[]; unit: number; notes: string };
type Held = { id: string; label: string; kind: Kind; tableId: string | null; lines: Line[]; customer: Customer; covers: number; at: number };
type Customer = { phone: string; name: string; address: string };

const KINDS: { id: Kind; label: string; icon: React.ReactNode }[] = [
  { id: "staff", label: "Dine-in", icon: <UtensilsCrossed className="size-4" /> },
  { id: "takeaway", label: "Takeaway", icon: <ShoppingBag className="size-4" /> },
  { id: "delivery", label: "Delivery", icon: <Bike className="size-4" /> },
  { id: "room", label: "Room", icon: <BedDouble className="size-4" /> },
];
const blank: Customer = { phone: "", name: "", address: "" };

/** Held tickets live on this device only. */
const heldKey = (projectId: string) => `horeca:${projectId}:held`;
const readHeld = (projectId: string): Held[] => {
  try {
    return JSON.parse(localStorage.getItem(heldKey(projectId)) ?? "[]") as Held[];
  } catch {
    return [];
  }
};
const writeHeld = (projectId: string, h: Held[]) => {
  try {
    localStorage.setItem(heldKey(projectId), JSON.stringify(h.slice(0, 30)));
  } catch {
    /* storage blocked: holding isn't available */
  }
};

export function PosView({ orderId: initialOrder }: { orderId?: string }) {
  const { venue, projectId, base, operator, lock, fullscreen, setFullscreen } = useH();
  const money = useMoney();
  const pos = venue.settings.pos;
  const sections = venue.settings.sections;
  const menu = useHQuery<MenuData>("menu");
  const floor = useHQuery<Floor>("floor", { refetchInterval: 6000 });
  const kinds = KINDS.filter((k) => (k.id === "staff" ? pos.dineIn : k.id === "takeaway" ? pos.takeaway : k.id === "delivery" ? pos.delivery : sections.rooms));
  const [kind, setKind] = useState<Kind>(kinds[0]?.id ?? "takeaway");
  const [tableId, setTableId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialOrder ?? null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [veg, setVeg] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer>(blank);
  const [covers, setCovers] = useState(0);
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [openOrders, setOpenOrders] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<Held[]>(() => (typeof window === "undefined" ? [] : readHeld(projectId)));
  const [bill, setBill] = useState(false);
  const [pay, setPay] = useState(false);
  const [autoKot, setAutoKot] = useState(() => {
    try {
      return localStorage.getItem(`horeca:${projectId}:autokot`) === "1";
    } catch {
      return false;
    }
  });
  const search = useRef<HTMLInputElement>(null);

  // The order on screen: the table's running check for dine-in, or the one we're working on.
  const table = floor.data?.tables.find((t) => t.id === tableId) ?? null;
  const currentId = kind === "staff" || kind === "room" ? (activeId ?? table?.order?.id ?? null) : activeId;
  const view = useHQuery<OrderView>(`orders/${currentId}`, { enabled: !!currentId, refetchInterval: 6000 });
  const order = currentId && view.data?.order.id === currentId ? view.data : null;
  const open = order ? order.order.status === "open" || order.order.status === "billed" : false;

  const data = menu.data;
  const groupsOf = (it: MenuItem) => (data?.modifiers ?? []).filter((g) => it.modifierGroupIds.includes(g.id));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (!cat || i.categoryId === cat) && (!veg || i.diet === "veg" || i.diet === "vegan") && (!t || i.name.toLowerCase().includes(t) || i.code.toLowerCase() === t));
  }, [data, cat, q, veg]);
  const cartTotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);
  const cartCount = lines.reduce((a, l) => a + l.qty, 0);

  const add = (it: MenuItem, opts: string[] = [], notes = "") => {
    if (!it.available) return;
    const chosen = groupsOf(it).flatMap((g) => g.options.filter((o) => opts.includes(o.id)));
    const key = `${it.id}|${opts.slice().sort().join(",")}|${notes}`;
    setLines((ls) => {
      const hit = ls.find((l) => l.key === key);
      if (hit) return ls.map((l) => (l === hit ? { ...l, qty: Math.min(50, l.qty + 1) } : l));
      return [...ls, { key, itemId: it.id, name: it.name, qty: 1, options: opts, optionNames: chosen.map((o) => o.name), unit: it.price + chosen.reduce((a, o) => a + o.price, 0), notes }];
    });
  };
  const pick = (it: MenuItem) => (groupsOf(it).length ? setChoosing(it) : add(it));
  const reset = () => {
    setLines([]);
    setActiveId(null);
    setCustomer(blank);
    setCovers(0);
    if (kind === "staff" || kind === "room") setTableId(null);
  };
  const switchKind = (k: Kind) => {
    setKind(k);
    setActiveId(null);
    setTableId(null);
    if (k === "staff" || k === "room") setTablesOpen(true);
  };

  const send = useHAction<{ thenPay?: boolean }, OrderView>(
    () => ({
      path: "orders",
      body: {
        orderId: currentId,
        tableId: kind === "staff" || kind === "room" ? tableId : null,
        source: kind,
        covers,
        guestName: customer.name,
        guestPhone: customer.phone,
        deliveryAddress: kind === "delivery" ? customer.address : "",
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, options: l.options, notes: l.notes })),
      },
    }),
    {
      success: "Sent to the kitchen",
      onDone: (r) => {
        const before = new Set((order?.items ?? []).map((i) => i.id));
        const fresh = r.items.filter((i) => !before.has(i.id) && i.kotNo !== null).map((i) => i.kotNo!);
        if (autoKot && fresh.length) printKot(venue.name, r, [...new Set(fresh)]);
        setLines([]);
        setActiveId(r.order.id);
        if (send.variables?.thenPay) setPay(true);
      },
    },
  );
  const needsTable = (kind === "staff" || kind === "room") && !tableId && !currentId;
  const needsAddress = kind === "delivery" && !currentId && !customer.address.trim();

  // Keyboard: "/" to search, Enter adds a dish by its code or the only match, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const t = q.trim().toLowerCase();
      const byCode = data?.items.find((i) => i.code && i.code.toLowerCase() === t);
      const one = byCode ?? (shown.length === 1 ? shown[0] : null);
      if (one) {
        pick(one);
        setQ("");
      }
    } else if (e.key === "Escape") setQ("");
  };

  const hold = () => {
    if (!lines.length) return;
    const label = kind === "staff" || kind === "room" ? (table?.name ?? "Table") : customer.name || customer.phone || (kind === "delivery" ? "Delivery" : "Takeaway");
    const next = [{ id: crypto.randomUUID(), label, kind, tableId, lines, customer, covers, at: Date.now() }, ...held];
    setHeld(next);
    writeHeld(projectId, next);
    setLines([]);
  };
  const resume = (h: Held) => {
    setKind(h.kind);
    setTableId(h.tableId);
    setActiveId(null);
    setLines(h.lines);
    setCustomer(h.customer);
    setCovers(h.covers);
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next);
    writeHeld(projectId, next);
    setHeldOpen(false);
  };

  const context =
    kind === "staff" || kind === "room"
      ? table
        ? `${table.name}${order?.order.covers || covers ? ` · ${order?.order.covers || covers} covers` : ""}`
        : "Choose a table"
      : order
        ? `${kind === "delivery" ? "Delivery" : "Takeaway"} #${order.order.number}`
        : `New ${kind === "delivery" ? "delivery" : "takeaway"}`;

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur-[20px]">
        <Link href={base} aria-label="Back to the dashboard" className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="mr-2 hidden min-w-0 sm:block">
          <p className="truncate text-[13px] leading-tight font-semibold">{venue.name}</p>
          <p className="text-[11px] leading-tight text-subtle">POS</p>
        </div>
        <div role="tablist" aria-label="Order type" className="flex rounded-full bg-surface-2 p-1">
          {kinds.map((k) => (
            <button key={k.id} type="button" role="tab" aria-label={k.label} aria-selected={kind === k.id} onClick={() => switchKind(k.id)} className={cx("flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background,color,box-shadow] duration-200", kind === k.id ? "bg-surface-solid text-fg shadow-sm" : "text-muted hover:text-fg")}>
              {k.icon}
              <span className="hidden md:inline">{k.label}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-2 min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search dishes or type a code" placeholder="Search or type a code   /" className="h-9 w-full rounded-full border border-border bg-surface pr-3 pl-9 text-[13.5px] outline-none focus:border-fg/40" />
        </div>
        <button type="button" onClick={() => setOpenOrders(true)} className="hidden h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2 lg:inline-flex">
          <LayoutGrid className="size-4" /> Counter orders <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{floor.data?.counter.length ?? 0}</span>
        </button>
        <button type="button" onClick={() => setHeldOpen(true)} disabled={!held.length} className="hidden h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-40 lg:inline-flex">
          <PauseCircle className="size-4" /> Held <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{held.length}</span>
        </button>
        {operator && (
          <span className="hidden items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-[12.5px] font-medium xl:inline-flex">
            <span className="grid size-7 place-items-center rounded-full bg-fg text-[11px] font-semibold text-bg">{operator.name.slice(0, 1)}</span>
            {operator.name}
          </span>
        )}
        <button type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => setFullscreen(!fullscreen)} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        {operator && (
          <button type="button" aria-label="Lock" onClick={lock} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
            <Lock className="size-4" />
          </button>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[170px_minmax(0,1fr)_380px] xl:grid-cols-[190px_minmax(0,1fr)_420px]">
        {/* Categories */}
        <nav aria-label="Menu categories" className="hidden min-h-0 overflow-y-auto border-r border-border p-2 md:block">
          {[{ id: "", name: "All" }, ...(data?.categories.filter((c) => c.active) ?? [])].map((c) => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id} className={cx("mb-1 flex w-full items-center justify-between rounded-[12px] px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors", cat === c.id ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <span className="truncate">{c.name}</span>
              <span className="text-[11px] tabular-nums opacity-60">{(data?.items ?? []).filter((i) => !c.id || i.categoryId === c.id).length}</span>
            </button>
          ))}
          <label className="mt-3 flex items-center gap-2 px-3 text-[12.5px] text-muted">
            <input type="checkbox" checked={veg} onChange={(e) => setVeg(e.target.checked)} className="accent-[#16a34a]" /> Veg only
          </label>
        </nav>

        {/* Items */}
        <section aria-label="Dishes" className="min-h-0 overflow-y-auto p-3">
          <div className="mb-3 flex gap-1.5 overflow-x-auto md:hidden">
            {[{ id: "", name: "All" }, ...(data?.categories.filter((c) => c.active) ?? [])].map((c) => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)} className={cx("h-8 shrink-0 rounded-full border px-3 text-[12.5px]", cat === c.id ? "border-fg bg-fg text-bg" : "border-border")}>
                {c.name}
              </button>
            ))}
          </div>
          {!data ? (
            <p className="p-10 text-center text-[13px] text-muted">Loading the menu…</p>
          ) : !shown.length ? (
            <p className="p-10 text-center text-[13px] text-muted">{q ? `Nothing matches “${q}”.` : "Add dishes under Menu."}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {shown.map((i) => {
                const inCart = lines.filter((l) => l.itemId === i.id).reduce((a, l) => a + l.qty, 0);
                return (
                  <button
                    key={i.id}
                    type="button"
                    disabled={!i.available}
                    onClick={() => pick(i)}
                    className={cx("group relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-[16px] border p-3 text-left transition-[transform,box-shadow,border-color] duration-150 active:scale-[0.97] disabled:opacity-40", inCart ? "border-fg/60 bg-surface shadow-md" : "border-border bg-surface hover:-translate-y-0.5 hover:shadow-md")}
                  >
                    <span className="flex items-start gap-1.5">
                      <span className="mt-0.5">
                        <DietMark diet={i.diet} />
                      </span>
                      <span className="line-clamp-2 text-[13.5px] leading-snug font-semibold">{i.name}</span>
                    </span>
                    <span className="mt-2 flex items-end justify-between gap-1">
                      <span className="text-[13px] font-semibold tabular-nums">{i.available ? money(i.price) : "Sold out"}</span>
                      <span className="flex items-center gap-1">
                        {i.code && <span className="rounded-[6px] bg-surface-2 px-1.5 text-[10.5px] font-semibold text-muted">{i.code}</span>}
                        {groupsOf(i).length > 0 && <ChevronDown className="size-3.5 text-subtle" aria-label="Has options" />}
                      </span>
                    </span>
                    {inCart > 0 && <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-fg text-[11.5px] font-bold text-bg tabular-nums">{inCart}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Ticket */}
        <aside aria-label="Ticket" className="flex min-h-0 flex-col border-t border-border bg-surface md:border-t-0 md:border-l">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <button
              type="button"
              onClick={() => (kind === "staff" || kind === "room" ? setTablesOpen(true) : kind === "delivery" ? setCustomerOpen(true) : null)}
              className={cx("min-w-0 flex-1 rounded-[12px] px-2 py-1 text-left", (kind === "staff" || kind === "room" || kind === "delivery") && "hover:bg-surface-2")}
            >
              <p className="truncate text-[16px] font-semibold">{context}</p>
              <p className="truncate text-[12px] text-muted">{order ? `Order #${order.order.number} · ${minutesSince(order.order.createdAt)} min` : kind === "delivery" ? customer.address || "Add the address" : "Nothing sent yet"}</p>
            </button>
            {(kind === "staff" || kind === "room") && pos.askCovers && !order?.order.covers && (
              <div className="flex items-center rounded-full border border-border" aria-label="Covers">
                <button type="button" aria-label="Fewer covers" onClick={() => setCovers(Math.max(0, covers - 1))} className="grid size-8 place-items-center">
                  <Minus className="size-3.5" />
                </button>
                <span className="w-7 text-center text-[13px] font-semibold tabular-nums">{covers}</span>
                <button type="button" aria-label="More covers" onClick={() => setCovers(Math.min(99, covers + 1))} className="grid size-8 place-items-center">
                  <Plus className="size-3.5" />
                </button>
              </div>
            )}
            <button type="button" onClick={() => setCustomerOpen(true)} className={cx("inline-flex h-8 max-w-[140px] items-center gap-1.5 truncate rounded-full border px-3 text-[12.5px] font-medium", customer.phone || order?.guest ? "border-fg/50 bg-surface-2" : "border-border hover:bg-surface-2")}>
              <User className="size-3.5 shrink-0" />
              <span className="truncate">{order?.guest?.name || customer.name || order?.guest?.phone || customer.phone || "Customer"}</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {order && order.items.filter((i) => i.status !== "void").length > 0 && (
              <ul className="divide-y divide-border border-b border-border bg-surface-2/40">
                {order.items
                  .filter((i) => i.status !== "void")
                  .map((i) => (
                    <li key={i.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                      <span className="w-6 font-semibold tabular-nums">{i.qty}×</span>
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      <span className="text-[11px] text-subtle">{i.kotNo ? `KOT ${i.kotNo}` : "QR"}</span>
                      <span className={cx("w-20 text-right tabular-nums", i.comp && "text-subtle line-through")}>{money(i.unitPrice * i.qty)}</span>
                    </li>
                  ))}
              </ul>
            )}
            {!lines.length && !order ? (
              <div className="grid h-full min-h-48 place-items-center p-6 text-center text-[13px] text-muted">
                <span>
                  <Hand className="mx-auto mb-2 size-6 text-subtle" />
                  Tap dishes to add them.
                  <br />
                  <span className="text-[12px] text-subtle">Type a code and press Enter for speed.</span>
                </span>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lines.map((l, i) => (
                  <li key={l.key} className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <b className="block text-[14px] font-semibold">{l.name}</b>
                        {(l.optionNames.length > 0 || l.notes) && <span className="block text-[12px] text-muted">{[...l.optionNames, l.notes && `“${l.notes}”`].filter(Boolean).join(", ")}</span>}
                      </span>
                      <span className="text-[13.5px] font-semibold tabular-nums">{money(l.unit * l.qty)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button type="button" aria-label={`One less ${l.name}`} onClick={() => setLines((ls) => ls.flatMap((x, j) => (j !== i ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))} className="grid size-7 place-items-center rounded-full border border-border hover:bg-surface-2">
                        <Minus className="size-3" />
                      </button>
                      <span className="w-7 text-center text-[13px] font-semibold tabular-nums">{l.qty}</span>
                      <button type="button" aria-label={`One more ${l.name}`} onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.min(50, x.qty + 1) } : x)))} className="grid size-7 place-items-center rounded-full border border-border hover:bg-surface-2">
                        <Plus className="size-3" />
                      </button>
                      <NoteButton value={l.notes} onChange={(notes) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, notes } : x)))} />
                      <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="ml-auto grid size-7 place-items-center rounded-full text-muted hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border p-3">
            {lines.length > 0 && (
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">
                  New: {cartCount} item{cartCount === 1 ? "" : "s"}
                </span>
                <b className="tabular-nums">{money(cartTotal)}</b>
              </div>
            )}
            {order && <TotalsBlock v={order} open={open} />}
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <Button size="sm" variant="ghost" icon={<PauseCircle className="size-4" />} disabled={!lines.length} onClick={hold}>
                Hold
              </Button>
              <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} disabled={!order} onClick={() => order && printKot(venue.name, order)}>
                KOT
              </Button>
              <Button size="sm" variant="ghost" icon={<Receipt className="size-4" />} disabled={!order || !open || lines.length > 0} onClick={() => setBill(true)}>
                Bill
              </Button>
              <Button size="sm" variant="ghost" icon={<Ban className="size-4" />} onClick={reset}>
                New
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="lg" icon={<Send className="size-4" />} disabled={!lines.length || needsTable || needsAddress} loading={send.isPending && !send.variables?.thenPay} onClick={() => send.mutate({})}>
                {needsTable ? "Pick a table" : needsAddress ? "Add the address" : "Send"}
              </Button>
              {lines.length > 0 && kind !== "staff" && kind !== "room" ? (
                <Button size="lg" variant="primary" disabled={needsAddress} loading={send.isPending && !!send.variables?.thenPay} onClick={() => send.mutate({ thenPay: true })}>
                  Send & pay
                </Button>
              ) : (
                <Button size="lg" variant="primary" disabled={!order || !open || order.totals.due <= 0 || lines.length > 0} onClick={() => setPay(true)}>
                  Pay {order && open ? money(order.totals.due) : ""}
                </Button>
              )}
            </div>
            <label className="mt-2 flex items-center justify-center gap-2 text-[11.5px] text-subtle">
              <input
                type="checkbox"
                checked={autoKot}
                onChange={(e) => {
                  setAutoKot(e.target.checked);
                  try {
                    localStorage.setItem(`horeca:${projectId}:autokot`, e.target.checked ? "1" : "0");
                  } catch {
                    /* not remembered */
                  }
                }}
              />
              Print the KOT when sending
            </label>
          </div>
        </aside>
      </div>

      {choosing && <OptionsDialog item={choosing} groups={groupsOf(choosing)} onClose={() => setChoosing(null)} onAdd={(opts, notes) => (add(choosing, opts, notes), setChoosing(null))} />}
      {tablesOpen && floor.data && (
        <TablePicker
          floor={floor.data}
          rooms={kind === "room"}
          onClose={() => setTablesOpen(false)}
          onPick={(t) => {
            setTableId(t.id);
            setActiveId(t.order?.id ?? null);
            setCovers(t.order?.covers ?? 0);
            setTablesOpen(false);
          }}
        />
      )}
      {customerOpen && <CustomerDialog value={customer} delivery={kind === "delivery"} onClose={() => setCustomerOpen(false)} onSave={(c) => (setCustomer(c), setCustomerOpen(false))} />}
      {openOrders && floor.data && (
        <Dialog open onClose={() => setOpenOrders(false)} title="Open takeaway & delivery orders" size="md">
          {!floor.data.counter.length ? (
            <p className="py-8 text-center text-[13px] text-muted">No open counter orders.</p>
          ) : (
            <ul className="grid gap-1.5">
              {floor.data.counter.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setKind(o.source === "delivery" ? "delivery" : "takeaway");
                      setTableId(null);
                      setActiveId(o.id);
                      setLines([]);
                      setOpenOrders(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-[14px] border border-border px-3 py-2.5 text-left text-[13.5px] hover:bg-surface-2"
                  >
                    {o.source === "delivery" ? <Bike className="size-4" /> : <ShoppingBag className="size-4" />}
                    <span className="min-w-0 flex-1">
                      <b>#{o.number}</b> {o.guestName && `· ${o.guestName}`}
                      {o.deliveryAddress && <span className="block truncate text-[12px] text-muted">{o.deliveryAddress}</span>}
                    </span>
                    <span className="flex items-center gap-1 text-[12px] text-muted">
                      <Clock className="size-3" />
                      {minutesSince(o.since)}m
                    </span>
                    <b className="tabular-nums">{money(o.total)}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {heldOpen && (
        <Dialog open onClose={() => setHeldOpen(false)} title="Held tickets" description="Saved on this device until you pick them up." size="md">
          <ul className="grid gap-1.5">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <button type="button" onClick={() => resume(h)} className="flex flex-1 items-center gap-3 rounded-[14px] border border-border px-3 py-2.5 text-left text-[13.5px] hover:bg-surface-2">
                  <PauseCircle className="size-4 text-muted" />
                  <span className="flex-1">
                    <b>{h.label}</b> · {h.lines.reduce((a, l) => a + l.qty, 0)} items
                  </span>
                  <span className="text-[12px] text-muted">{minutesSince(new Date(h.at).toISOString())}m ago</span>
                </button>
                <button
                  type="button"
                  aria-label={`Discard ${h.label}`}
                  onClick={() => {
                    const next = held.filter((x) => x.id !== h.id);
                    setHeld(next);
                    writeHeld(projectId, next);
                  }}
                  className="grid size-9 place-items-center rounded-full text-muted hover:text-danger"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {bill && order && <BillDialog view={order} onClose={() => setBill(false)} />}
      {pay && order && (
        <PayDialog
          view={order}
          onClose={() => setPay(false)}
          onSettled={(r) => {
            if (r.order.status === "paid") reset();
          }}
        />
      )}
    </div>
  );
}

function NoteButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value);
  return (
    <>
      <button type="button" onClick={() => (setV(value), setOpen(true))} className={cx("h-7 rounded-full border px-2.5 text-[11.5px]", value ? "border-fg/50 bg-surface-2" : "border-border text-muted hover:bg-surface-2")}>
        {value ? "Note ✓" : "Note"}
      </button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          size="sm"
          title="Kitchen note"
          footer={
            <Button variant="primary" onClick={() => (onChange(v.trim().slice(0, 200)), setOpen(false))}>
              Save
            </Button>
          }
        >
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-1.5">
              {["Less spicy", "Extra spicy", "No onion", "No garlic", "Jain", "Pack separately"].map((p) => (
                <button key={p} type="button" onClick={() => setV(v ? `${v}, ${p}` : p)} className="h-7 rounded-full border border-border px-2.5 text-[12px] hover:bg-surface-2">
                  {p}
                </button>
              ))}
            </div>
            <Textarea aria-label="Note" rows={2} value={v} onChange={(e) => setV(e.target.value)} maxLength={200} autoFocus />
          </div>
        </Dialog>
      )}
    </>
  );
}

function OptionsDialog({ item, groups, onClose, onAdd }: { item: MenuItem; groups: MenuData["modifiers"]; onClose: () => void; onAdd: (opts: string[], notes: string) => void }) {
  const money = useMoney();
  const [picked, setPicked] = useState<string[]>(() => groups.flatMap((g) => (g.minSelect === 1 && g.maxSelect === 1 ? [g.options[0].id] : [])));
  const [notes, setNotes] = useState("");
  const ok = groups.every((g) => {
    const n = g.options.filter((o) => picked.includes(o.id)).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const extra = groups.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.price, 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onAdd(picked, notes.trim())}>
            Add · {money(item.price + extra)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="mb-1.5 text-[13px] font-medium">
              {g.name} <span className="font-normal text-muted">· {g.minSelect ? `pick ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `up to ${g.maxSelect}`}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.options.map((o) => {
                const on = picked.includes(o.id);
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => toggleOption(p, g, o.id))} className={cx("h-10 rounded-[12px] border px-3.5 text-[13px] font-medium", on ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
                    {o.name}
                    {o.price ? ` +${money(o.price)}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Field label="Kitchen note">{(a) => <Input {...a} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Optional" />}</Field>
      </div>
    </Dialog>
  );
}

function TablePicker({ floor, rooms, onClose, onPick }: { floor: Floor; rooms: boolean; onClose: () => void; onPick: (t: FloorTable) => void }) {
  const money = useMoney();
  const [area, setArea] = useState("all");
  const list = sortTables(floor.tables, floor.areas).filter((t) => (rooms ? t.kind === "room" : t.kind !== "room") && (area === "all" || t.areaId === area));
  return (
    <Dialog open onClose={onClose} size="xl" title={rooms ? "Which room?" : "Which table?"}>
      {!rooms && floor.areas.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[{ id: "all", name: "All" }, ...floor.areas].map((a) => (
            <button key={a.id} type="button" onClick={() => setArea(a.id)} aria-pressed={area === a.id} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-medium", area === a.id ? "border-fg bg-fg text-bg" : "border-border")}>
              {a.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
        {list.map((t) => (
          <button key={t.id} type="button" onClick={() => onPick(t)} className={cx("flex aspect-[5/4] flex-col justify-between rounded-[16px] border p-2.5 text-left transition-transform hover:-translate-y-0.5", t.order ? "border-[#f5c9a4] bg-[#fff6ee] dark:border-[#5a3a22] dark:bg-[#24180f]" : "border-border bg-surface")}>
            <span className="text-[16px] font-bold">{t.name}</span>
            <span className="text-[11.5px] text-muted">{t.order ? `${money(t.order.total)} · ${minutesSince(t.order.since)}m` : `${t.seats} seats · free`}</span>
          </button>
        ))}
        {!list.length && <p className="col-span-full py-8 text-center text-[13px] text-muted">{rooms ? "No rooms set up yet." : "No tables yet — add them under QR menu & tables."}</p>}
      </div>
    </Dialog>
  );
}

function CustomerDialog({ value, delivery, onClose, onSave }: { value: Customer; delivery: boolean; onClose: () => void; onSave: (c: Customer) => void }) {
  const { venue } = useH();
  const money = useMoney();
  const [c, setC] = useState(value);
  const digits = c.phone.replace(/\D/g, "");
  const found = useHQuery<{ guests: { id: string; name: string; phone: string; points: number; visits: number; spend: number }[] }>(`guests?q=${encodeURIComponent(digits)}`, { enabled: digits.length >= 7 });
  const match = found.data?.guests.find((g) => digits.endsWith(g.phone) || g.phone.endsWith(digits.slice(-10)));
  const name = c.name || match?.name || "";
  return (
    <Dialog
      open
      onClose={onClose}
      title="Customer"
      description={venue.settings.loyalty.enabled ? "Add their phone to give them loyalty points." : "Add their phone to remember them next time."}
      footer={
        <>
          <Button onClick={() => onSave(blank)}>Clear</Button>
          <Button variant="primary" onClick={() => onSave({ ...c, phone: c.phone.trim(), name: name.trim(), address: c.address.trim() })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Phone">{(a) => <Input {...a} type="tel" inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} autoFocus maxLength={20} />}</Field>
        {match && (
          <p className="rounded-[12px] bg-success-soft px-3 py-2 text-[13px] text-success">
            Welcome back{match.name ? `, ${match.name}` : ""} — visit {match.visits + 1}, {money(match.spend)} spent{venue.settings.loyalty.enabled ? `, ${match.points} points` : ""}.
          </p>
        )}
        <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={80} />}</Field>
        {delivery && <Field label="Delivery address">{(a) => <Textarea {...a} rows={2} value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} maxLength={300} />}</Field>}
      </div>
    </Dialog>
  );
}
