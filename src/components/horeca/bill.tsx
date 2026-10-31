"use client";

// Billing pieces shared by the POS and the floor: the order's totals, bill and
// payment dialogs, receipts and kitchen tickets (KOTs), and moving checks
// between tables (transfer, merge, split).
import { ArrowRightLeft, Check, Combine, Printer, Scissors } from "lucide-react";
import { useState } from "react";
import { Dialog, Segmented } from "@/components/ui/overlays";
import { Button, cx, Field, Input } from "@/components/ui/primitives";
import { splitGst, type HorecaSettings } from "@/lib/horeca/model";
import { formatPrice } from "@/lib/store/money";
import { toMinor, useH, useHAction, useHQuery, useMoney, type Venue } from "./shared";

export type OrderItem = { id: string; name: string; qty: number; unitPrice: number; modifiers: { group: string; name: string; price: number }[]; notes: string; station: string; status: string; kotNo: number | null; comp: boolean; voidReason: string };
export type Totals = { subtotal: number; discount: number; comps: number; service: number; delivery: number; tax: number; tip: number; roundOff: number; total: number; paid: number; due: number };
export type OrderView = {
  order: { id: string; number: number; status: string; source: string; guestName: string; guestPhone: string; covers: number; deliveryAddress: string; createdAt: string; serviceChargeBps: number; discount: number; tip: number; payments: { method: string; amount: number; at: string; staff?: string }[]; staffName: string; tableId: string | null };
  table: { name: string; kind: string } | null;
  guest: { id: string; name: string; phone: string; points: number; visits: number } | null;
  items: OrderItem[];
  totals: Totals;
};

export const SOURCE_LABEL: Record<string, string> = { staff: "Dine-in", qr: "QR order", takeaway: "Takeaway", delivery: "Delivery", room: "Room service" };
export const METHOD_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", room: "To room", points: "Points", other: "Other" };

const Row = ({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) => (
  <div className={cx("flex justify-between", strong ? "text-[15px] font-semibold" : muted ? "text-subtle" : "text-muted")}>
    <span>{k}</span>
    <span className="tabular-nums">{v}</span>
  </div>
);

/** The bill's lines, as shown on screen. */
export function TotalsBlock({ v, open }: { v: OrderView; open: boolean }) {
  const money = useMoney();
  const t = v.totals;
  return (
    <div className="grid gap-1 text-[13px]">
      <Row k="Subtotal" v={money(t.subtotal)} />
      {t.comps > 0 && <Row k="On the house" v={money(t.comps)} muted />}
      {t.discount > 0 && <Row k="Discount" v={`−${money(t.discount)}`} />}
      {t.service > 0 && <Row k={`Service charge (${v.order.serviceChargeBps / 100}%)`} v={money(t.service)} />}
      {t.delivery > 0 && <Row k="Delivery" v={money(t.delivery)} />}
      <Row k="GST" v={money(t.tax)} />
      {t.tip > 0 && <Row k="Tip" v={money(t.tip)} />}
      {t.roundOff !== 0 && <Row k="Round off" v={`${t.roundOff > 0 ? "+" : "−"}${money(Math.abs(t.roundOff))}`} muted />}
      <Row k="Total" v={money(t.total)} strong />
      {t.paid > 0 && <Row k="Paid" v={money(t.paid)} />}
      {open && t.paid > 0 && <Row k="Due" v={money(t.due)} strong />}
    </div>
  );
}

export function BillDialog({ view, onClose, onPrinted }: { view: OrderView; onClose: () => void; onPrinted?: (v: OrderView) => void }) {
  const { venue } = useH();
  const money = useMoney();
  const { order, totals } = view;
  const [mode, setMode] = useState<"amount" | "percent">(order.discount ? "amount" : "percent");
  const [disc, setDisc] = useState(order.discount ? String(order.discount / 100) : "");
  const [reason, setReason] = useState("");
  const [service, setService] = useState(String(order.serviceChargeBps / 100));
  const [tipPct, setTipPct] = useState(0);
  const discount = mode === "percent" ? Math.round((totals.subtotal * Number(disc || 0)) / 100) : toMinor(disc);
  const pct = totals.subtotal ? (discount / totals.subtotal) * 100 : 0;
  const tip = Math.round((totals.subtotal * tipPct) / 100);
  const limit = venue.settings.security.discountLimitPct;
  const bill = useHAction<void, OrderView>(() => ({ path: `orders/${order.id}/bill`, body: { discount, serviceChargeBps: Math.round(Number(service || 0) * 100), tip, discountReason: reason } }), {
    success: "Bill ready",
    onDone: (r) => {
      printBill(venue, r);
      onPrinted?.(r);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Bill · ${view.table?.name ?? SOURCE_LABEL[order.source] ?? "Counter"}`}
      description="Menu prices exclude GST; it's added here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Printer className="size-4" />} loading={bill.isPending} onClick={() => bill.mutate()}>
            Save & print
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Discount">{(a) => <Input {...a} inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="0" />}</Field>
          <Segmented label="Discount type" value={mode} onChange={setMode} options={[{ value: "percent", label: "%" }, { value: "amount", label: venue.currency === "INR" ? "₹" : venue.currency }]} />
        </div>
        {discount > 0 && <Field label="Reason" hint={pct > limit ? `Over ${limit}% — a manager will be asked to approve.` : undefined}>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Regular guest, delay, complaint…" maxLength={200} />}</Field>}
        <Field label="Service charge (%)" hint="Optional for guests — remove it if they ask.">{(a) => <Input {...a} inputMode="decimal" value={service} onChange={(e) => setService(e.target.value)} />}</Field>
        {venue.settings.qr.tipOptions.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Tip</p>
            <div className="flex flex-wrap gap-2">
              {venue.settings.qr.tipOptions.map((p) => (
                <button key={p} type="button" onClick={() => setTipPct(p)} aria-pressed={tipPct === p} className={cx("h-9 rounded-full border px-4 text-[13px] font-semibold", tipPct === p ? "border-fg bg-fg text-bg" : "border-border")}>
                  {p ? `${p}%` : "None"}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="rounded-[12px] bg-surface-2 p-3 text-[13px]">
          Food {money(totals.subtotal)} − discount {money(discount)}
          {tip ? ` + tip ${money(tip)}` : ""} · GST, service charge and round-off are added on save.
        </p>
      </div>
    </Dialog>
  );
}

export function PayDialog({ view, onClose, onSettled }: { view: OrderView; onClose: () => void; onSettled?: (v: OrderView) => void }) {
  const { venue } = useH();
  const money = useMoney();
  const { totals, order, table, guest } = view;
  const loyalty = venue.settings.loyalty;
  const methods = (["cash", "upi", "card", "room", "points"] as const).filter((m) => (m === "points" ? loyalty.enabled && !!guest : true));
  const [method, setMethod] = useState<(typeof methods)[number]>("cash");
  const pointsMax = guest ? Math.min(guest.points * loyalty.pointValue, Math.floor(totals.due / loyalty.pointValue) * loyalty.pointValue) : 0;
  const [amount, setAmount] = useState(String(totals.due / 100));
  const [received, setReceived] = useState("");
  const [ref, setRef] = useState("");
  const pay = useHAction<void, OrderView>(() => ({ path: `orders/${order.id}/pay`, body: { method, amount: toMinor(amount), ref } }), {
    success: (r) => (r.order.status === "paid" ? (r.order.tableId ? "Settled — table is free" : "Settled") : `Part paid · ${money(r.totals.due)} left`),
    onDone: (r) => {
      onSettled?.(r);
      onClose();
    },
  });
  const change = method === "cash" && received ? toMinor(received) - toMinor(amount) : 0;
  // Quick notes for cash: the exact amount and the next round notes up.
  const quick = [...new Set([totals.due, ...[10_000, 20_000, 50_000, 100_000, 200_000].map((n) => Math.ceil(toMinor(amount) / n) * n)])].filter((n) => n >= toMinor(amount)).slice(0, 4);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Settle ${money(totals.due)}`}
      description="Split the bill by taking part now and the rest after."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pay.isPending} disabled={toMinor(amount) <= 0 || toMinor(amount) > totals.due} onClick={() => pay.mutate()}>
            Take {money(toMinor(amount))}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className={cx("grid gap-2", methods.length > 4 ? "grid-cols-5" : "grid-cols-4")}>
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                if (m === "points") setAmount(String(pointsMax / 100));
              }}
              aria-pressed={method === m}
              disabled={(m === "room" && table?.kind !== "room") || (m === "points" && pointsMax <= 0)}
              className={cx("rounded-[14px] border px-2 py-3 text-[13px] font-semibold disabled:opacity-40", method === m ? "border-fg bg-surface-2" : "border-border")}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method === "room" && <p className="text-[12.5px] text-muted">Added to the checked-in guest&apos;s folio for {table?.name}.</p>}
        {method === "points" && guest && (
          <p className="text-[12.5px] text-muted">
            {guest.name || guest.phone} has {guest.points} points = {money(guest.points * loyalty.pointValue)}.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          {method === "cash" ? (
            <Field label="Cash received">{(a) => <Input {...a} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="Optional" />}</Field>
          ) : method === "upi" || method === "card" ? (
            <Field label="Reference">{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" maxLength={80} />}</Field>
          ) : null}
        </div>
        {method === "cash" && (
          <div className="flex flex-wrap gap-2">
            {quick.map((n) => (
              <button key={n} type="button" onClick={() => setReceived(String(n / 100))} className="h-9 rounded-full border border-border px-3.5 text-[13px] font-semibold tabular-nums hover:bg-surface-2">
                {money(n)}
              </button>
            ))}
          </div>
        )}
        {change > 0 && <p className="rounded-[12px] bg-success-soft p-3 text-[15px] font-semibold text-success">Give change: {money(change)}</p>}
        <div className="flex flex-wrap gap-2">
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" onClick={() => setAmount(String(Math.ceil(totals.due / n) / 100))} className="h-8 rounded-full border border-border px-3 text-[12.5px] font-medium hover:bg-surface-2">
              Split {n} ways
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const printDoc = (title: string, width: string, body: string) => {
  const w = window.open("", "_blank", `width=${width},height=760`);
  if (!w) return;
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>body{font:13px/1.4 ui-monospace,Menlo,monospace;width:72mm;margin:0 auto;padding:10px;color:#000}h1{font-size:16px;text-align:center;margin:0}p{text-align:center;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:3px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.b td{font-weight:700;border-top:1px dashed #000;padding-top:6px}.big{font-size:18px;font-weight:700}small{color:#444}hr{border:0;border-top:1px dashed #000}</style>${body}`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
};

/** An 80 mm customer bill with the venue's receipt details and the GST split. */
export function printBill(venue: Venue, v: OrderView) {
  const money = (n: number) => formatPrice(n, venue.currency);
  const r: HorecaSettings["receipt"] = venue.settings.receipt;
  const t = v.totals;
  const lines = v.items
    .filter((i) => i.status !== "void" && i.status !== "pending")
    .map((i) => `<tr><td>${i.qty} × ${esc(i.name)}${i.modifiers.length ? `<br><small>${esc(i.modifiers.map((m) => m.name).join(", "))}</small>` : ""}</td><td>${i.comp ? "FREE" : money(i.unitPrice * i.qty)}</td></tr>`)
    .join("");
  const row = (k: string, val: string, b = false) => `<tr${b ? ' class="b"' : ""}><td>${k}</td><td>${val}</td></tr>`;
  const gst = splitGst(t.tax);
  const rate = venue.taxBps / 200;
  const head = [r.header, r.address, r.phone, r.gstin && `GSTIN ${r.gstin}`, r.fssai && `FSSAI ${r.fssai}`].filter(Boolean).map((x) => `<p>${esc(String(x))}</p>`).join("");
  const where = v.table?.name ?? SOURCE_LABEL[v.order.source] ?? "Counter";
  const meta = [`Bill #${v.order.number}`, where, v.order.covers ? `${v.order.covers} covers` : "", v.order.staffName].filter(Boolean).join(" · ");
  printDoc(
    `Bill #${v.order.number}`,
    "420",
    `<h1>${esc(venue.name)}</h1>${head}<hr><p>${esc(meta)}</p><p>${new Date().toLocaleString("en-IN")}</p>${v.order.deliveryAddress ? `<p><small>${esc(v.order.guestName)} · ${esc(v.order.deliveryAddress)}</small></p>` : ""}<hr><table>${lines}</table><hr><table>${row("Subtotal", money(t.subtotal))}${t.discount ? row("Discount", `−${money(t.discount)}`) : ""}${t.service ? row("Service charge", money(t.service)) : ""}${t.delivery ? row("Delivery", money(t.delivery)) : ""}${row(`CGST ${rate}%`, money(gst.cgst))}${row(`SGST ${rate}%`, money(gst.sgst))}${t.tip ? row("Tip", money(t.tip)) : ""}${t.roundOff ? row("Round off", `${t.roundOff > 0 ? "+" : "−"}${money(Math.abs(t.roundOff))}`) : ""}${row("Total", money(t.total), true)}${t.paid ? row("Paid", money(t.paid)) : ""}${t.paid && t.due ? row("Due", money(t.due), true) : ""}</table>${v.order.payments.length ? `<p><small>${esc(v.order.payments.map((p) => `${METHOD_LABEL[p.method] ?? p.method} ${money(p.amount)}`).join(" · "))}</small></p>` : ""}<p style="margin-top:12px">${esc(r.footer || "Thank you!")}</p>`,
  );
}

/** Kitchen tickets for the items just sent, one per station. */
export function printKot(venueName: string, v: OrderView, kotNos?: number[]) {
  const items = v.items.filter((i) => i.kotNo !== null && i.status !== "void" && (!kotNos || kotNos.includes(i.kotNo)));
  const byKot = new Map<number, OrderItem[]>();
  for (const i of items) byKot.set(i.kotNo!, [...(byKot.get(i.kotNo!) ?? []), i]);
  const where = v.table?.name ?? SOURCE_LABEL[v.order.source] ?? "Counter";
  const tickets = [...byKot.entries()]
    .map(([kot, list]) => `<p class="big">KOT ${kot} · ${esc(where)}</p><p>${esc(list[0].station.toUpperCase())} · order #${v.order.number}${v.order.covers ? ` · ${v.order.covers} covers` : ""}</p><p>${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p><hr><table>${list.map((i) => `<tr><td class="big">${i.qty}</td><td style="text-align:left;padding-left:8px"><b>${esc(i.name)}</b>${i.modifiers.filter((m) => m.group !== "Offer").length ? `<br><small>${esc(i.modifiers.filter((m) => m.group !== "Offer").map((m) => m.name).join(", "))}</small>` : ""}${i.notes ? `<br><small>⚠ ${esc(i.notes)}</small>` : ""}</td></tr>`).join("")}</table><hr style="margin:18px 0">`)
    .join("");
  if (tickets) printDoc(`KOT · ${venueName}`, "380", tickets);
}

// ─── Moving checks ───────────────────────────────────────────────────────────

type FloorTable = { id: string; name: string; kind: string; order: { id: string; number: number } | null };

export function MoveDialog({ view, mode, onClose, onDone }: { view: OrderView; mode: "transfer" | "merge" | "split"; onClose: () => void; onDone: (orderId: string) => void }) {
  const floor = useHQuery<{ tables: FloorTable[]; counter: { id: string; number: number }[] }>("floor");
  const money = useMoney();
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const act = useHAction<void, OrderView & { to?: OrderView }>(
    () => ({ path: `orders/${view.order.id}/${mode}`, body: mode === "transfer" ? { tableId: target } : mode === "merge" ? { fromOrderId: target } : { itemIds: picked } }),
    { success: mode === "transfer" ? "Moved" : mode === "merge" ? "Checks merged" : "Check split", onDone: (r) => onDone(mode === "split" ? (r as unknown as { to: OrderView }).to.order.id : view.order.id) },
  );
  const tables = (floor.data?.tables ?? []).filter((t) => t.kind !== "room");
  const live = view.items.filter((i) => i.status !== "void");
  const title = mode === "transfer" ? "Move to another table" : mode === "merge" ? "Merge another check into this one" : "Split this check";
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={mode === "split" ? "Pick the items that go on a separate check." : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={act.isPending} disabled={mode === "split" ? !picked.length || picked.length >= live.length : !target} onClick={() => act.mutate()}>
            {mode === "transfer" ? "Move" : mode === "merge" ? "Merge" : `Split ${picked.length || ""}`}
          </Button>
        </>
      }
    >
      {mode === "split" ? (
        <ul className="grid gap-1.5">
          {live.map((i) => {
            const on = picked.includes(i.id);
            return (
              <li key={i.id}>
                <button type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== i.id) : [...picked, i.id])} className={cx("flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left text-[13.5px]", on ? "border-fg bg-surface-2" : "border-border")}>
                  <span className={cx("grid size-5 place-items-center rounded-full border", on ? "border-fg bg-fg text-bg" : "border-border")}>{on && <Check className="size-3" />}</span>
                  <span className="flex-1">
                    {i.qty} × {i.name}
                  </span>
                  <span className="tabular-nums text-muted">{money(i.unitPrice * i.qty)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {mode === "transfer"
            ? tables
                .filter((t) => !t.order)
                .map((t) => (
                  <button key={t.id} type="button" onClick={() => setTarget(t.id)} aria-pressed={target === t.id} className={cx("h-14 rounded-[14px] border text-[15px] font-bold", target === t.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
                    {t.name}
                  </button>
                ))
            : [...tables.filter((t) => t.order && t.order.id !== view.order.id).map((t) => ({ id: t.order!.id, label: `${t.name} · #${t.order!.number}` })), ...(floor.data?.counter ?? []).filter((o) => o.id !== view.order.id).map((o) => ({ id: o.id, label: `Counter · #${o.number}` }))].map((o) => (
                <button key={o.id} type="button" onClick={() => setTarget(o.id)} aria-pressed={target === o.id} className={cx("h-14 rounded-[14px] border px-2 text-[13px] font-semibold", target === o.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
                  {o.label}
                </button>
              ))}
        </div>
      )}
    </Dialog>
  );
}

export const MOVE_ICONS = { transfer: <ArrowRightLeft className="size-4" />, merge: <Combine className="size-4" />, split: <Scissors className="size-4" /> };

/** Asks for a reason before cancelling an item or order. */
export function ReasonDialog({ title, onClose, onConfirm, busy }: { title: string; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean }) {
  const [reason, setReason] = useState("");
  const presets = ["Guest changed their mind", "Wrong item entered", "Took too long", "Quality issue", "Out of stock"];
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Cancel it
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => setReason(p)} aria-pressed={reason === p} className={cx("h-8 rounded-full border px-3 text-[12.5px]", reason === p ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
              {p}
            </button>
          ))}
        </div>
        <Field label="Reason">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />}</Field>
      </div>
    </Dialog>
  );
}
