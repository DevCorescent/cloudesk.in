"use client";

// Valet parking: the live board (booked → parked → requested → ready →
// delivered), new tickets, pre-bookings and the guest links.
import { CarFront, Clock, Copy, ExternalLink, KeyRound, MapPin, Phone, Plus, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, cx, Field, Input, Notice, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { qrSvg } from "@/lib/store/barcode";
import { minutesSince, Stat, useH, useHAction, useHQuery } from "./shared";

type Ticket = { id: string; ticket: number; token: string; status: string; plate: string; car: string; color: string; guestName: string; guestPhone: string; slot: string; keyTag: string; notes: string; expectedAt: string | null; parkedAt: string | null; requestedAt: string | null; readyAt: string | null; deliveredAt: string | null; link: string };
type Board = { tickets: Ticket[]; stats: { parked: number; requested: number; booked: number; slots: number; free: number }; bookingLink: string };

const COLS = [
  { id: "requested", title: "Guest asked for the car", tone: "border-danger/50 bg-danger-soft/40" },
  { id: "ready", title: "Ready at the porch", tone: "border-success/40 bg-success-soft/40" },
  { id: "parked", title: "Parked", tone: "border-border bg-surface" },
  { id: "booked", title: "Pre-booked arrivals", tone: "border-[#c7d2fe] bg-[#eef2ff]/60 dark:border-[#3730a3] dark:bg-[#161433]/60" },
];
const ACTIONS: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  booked: [{ to: "parked", label: "Car arrived", primary: true }, { to: "cancelled", label: "Cancel" }],
  parked: [{ to: "ready", label: "Bring it round", primary: true }, { to: "delivered", label: "Handed over" }],
  requested: [{ to: "ready", label: "Car is ready", primary: true }, { to: "delivered", label: "Handed over" }],
  ready: [{ to: "delivered", label: "Handed over", primary: true }, { to: "parked", label: "Park again" }],
};

export function ValetView() {
  const { venue } = useH();
  const toast = useToast();
  const q = useHQuery<Board>("valet", { refetchInterval: 5000 });
  const [create, setCreate] = useState<"parked" | "booked" | null>(null);
  const [arrive, setArrive] = useState<Ticket | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const move = useHAction<{ id: string; status: string }, { ticket: Ticket }>(({ id, status }) => ({ path: `valet/${id}/status`, body: { status } }), { success: (r) => ({ ready: "Guest's page now says the car is ready", delivered: "Handed over — safe drive!", parked: "Parked", cancelled: "Booking cancelled" })[r.ticket.status] ?? "Updated" });
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const { tickets, stats } = q.data;
  const delivered = tickets.filter((t) => t.status === "delivered");
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast({ tone: "success", title: "Link copied" }));
  return (
    <div>
      <PageHeader
        title="Valet parking"
        description="Hand the guest a ticket link or QR. They tap “Bring my car” from the table and it shows here instantly."
        actions={
          <>
            <Button size="sm" icon={<Clock className="size-4" />} onClick={() => setCreate("booked")}>
              Pre-book
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate("parked")}>
              Park a car
            </Button>
          </>
        }
      />
      {!venue.settings.valet.enabled && (
        <div className="mb-4">
          <Notice tone="warning" title="Valet is switched off">
            Turn it on under Settings to show the booking page to guests.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Parked now" value={stats.parked} />
        <Stat label="Waiting for car" value={stats.requested} tone={stats.requested ? "warn" : undefined} />
        <Stat label="Pre-booked" value={stats.booked} />
        <Stat label="Free slots" value={`${stats.free}/${stats.slots}`} tone={stats.free === 0 ? "warn" : "good"} />
        <Stat label="Delivered (12h)" value={delivered.length} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-surface p-3 text-[13px] shadow-sm">
        <span className="font-medium">Guest booking page</span>
        <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface-2 px-2 py-1 text-[12px]">{q.data.bookingLink}</code>
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(q.data!.bookingLink)}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(q.data!.bookingLink, "_blank", "noopener")}>
          Open
        </Button>
      </div>
      <div className="grid-cols-2 mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {COLS.map((c) => {
          const list = tickets.filter((t) => t.status === c.id).sort((a, b) => (c.id === "booked" ? Date.parse(a.expectedAt ?? "") - Date.parse(b.expectedAt ?? "") : 0));
          return (
            <section key={c.id} className="min-w-0">
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
                {c.title}
                <span className="rounded-full bg-surface-2 px-2 text-[11.5px]">{list.length}</span>
              </h2>
              <div className="grid gap-2.5">
                {!list.length && <p className="rounded-[16px] border border-dashed border-border p-5 text-center text-[12.5px] text-subtle">None</p>}
                {list.map((t) => (
                  <article key={t.id} className={cx("rounded-[18px] border p-3.5 shadow-sm", c.tone)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2">
                          <span className="rounded-[8px] bg-fg px-2 py-0.5 text-[12px] font-bold text-bg tabular-nums">#{t.ticket}</span>
                          {t.plate ? <span className="truncate font-mono text-[15px] font-bold tracking-wide">{t.plate}</span> : <span className="truncate text-[13px] font-medium text-muted">Plate on arrival</span>}
                        </p>
                        <p className="mt-1 truncate text-[12.5px] text-muted">{[t.color, t.car].filter(Boolean).join(" ") || "Car details pending"}{t.guestName ? ` · ${t.guestName}` : ""}</p>
                      </div>
                      <span className="text-right text-[11.5px] font-medium text-muted">
                        {t.status === "requested" && t.requestedAt ? <b className="text-danger">{minutesSince(t.requestedAt, now)}m waiting</b> : t.status === "booked" && t.expectedAt ? new Date(t.expectedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : t.parkedAt ? `${minutesSince(t.parkedAt, now)}m ago` : ""}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                      {t.slot && <Badge><MapPin className="size-3" /> {t.slot}</Badge>}
                      {t.keyTag && <Badge><KeyRound className="size-3" /> Key {t.keyTag}</Badge>}
                      {t.guestPhone && (
                        <a href={`tel:${t.guestPhone}`} className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-muted hover:text-fg">
                          <Phone className="size-3" /> Call
                        </a>
                      )}
                    </div>
                    {t.notes && <p className="mt-2 text-[12px] text-muted">📝 {t.notes}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(ACTIONS[t.status] ?? []).map((a) => (
                        <Button key={a.to} size="sm" variant={a.primary ? "primary" : "secondary"} loading={move.isPending && move.variables?.id === t.id && move.variables.status === a.to} onClick={() => (t.status === "booked" && a.to === "parked" ? setArrive(t) : move.mutate({ id: t.id, status: a.to }))}>
                          {a.label}
                        </Button>
                      ))}
                      {t.status !== "booked" && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => copy(t.link)} aria-label="Copy guest link" />
                          <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={() => printTicket(venue.name, t)} aria-label="Print ticket" />
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {delivered.length > 0 && (
        <details className="mt-6 rounded-[18px] border border-border bg-surface p-4 text-[13px]">
          <summary className="cursor-pointer font-semibold">Handed over in the last 12 hours ({delivered.length})</summary>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {delivered.map((t) => (
              <li key={t.id} className="flex justify-between rounded-[10px] bg-surface-2 px-3 py-1.5">
                <span>
                  #{t.ticket} · <b className="font-mono">{t.plate}</b>
                </span>
                <span className="text-muted">{t.deliveredAt ? new Date(t.deliveredAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {create && <TicketDialog mode={create} onClose={() => setCreate(null)} />}
      {arrive && <ArriveDialog t={arrive} onClose={() => setArrive(null)} />}
    </div>
  );
}

function printTicket(venue: string, t: Ticket) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  w.document.write(`<!doctype html><title>Valet #${t.ticket}</title><style>body{font:14px/1.4 ui-sans-serif,system-ui,sans-serif;width:72mm;margin:0 auto;padding:12px;text-align:center;color:#111}h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;margin:0}.n{font-size:44px;font-weight:800;margin:6px 0}.p{font:700 18px ui-monospace,monospace}.qr{width:46mm;margin:10px auto}.qr svg{width:100%;height:auto}small{color:#555}</style><h1>${esc(venue)} · Valet</h1><div class="n">#${t.ticket}</div><div class="p">${esc(t.plate)}</div><div class="qr">${qrSvg(t.link, { margin: 1 })}</div><p><b>Scan to ask for your car</b><br><small>We'll bring it round and let you know when it's ready.</small></p>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function TicketDialog({ mode: initial, onClose }: { mode: "parked" | "booked"; onClose: () => void }) {
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ plate: "", car: "", color: "", guestName: "", guestPhone: "", slot: "", keyTag: "", notes: "", when: "" });
  const save = useHAction<void, { ticket: Ticket }>(
    () => ({ path: "valet", body: { plate: f.plate, car: f.car, color: f.color, guestName: f.guestName, guestPhone: f.guestPhone, slot: f.slot, keyTag: f.keyTag, notes: f.notes, expectedAt: mode === "booked" && f.when ? new Date(f.when).toISOString() : null } }),
    { success: (r) => (r.ticket.status === "booked" ? `Pre-booked · ticket #${r.ticket.ticket}` : `Ticket #${r.ticket.ticket} — key tag ${r.ticket.keyTag}`), onDone: onClose },
  );
  const ok = mode === "booked" ? !!f.when && !!f.guestName.trim() : !!f.plate.trim();
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "booked" ? "Pre-book valet" : "Park a car"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>
            {mode === "booked" ? "Book" : "Issue ticket"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Segmented label="Kind" value={mode} onChange={setMode} options={[{ value: "parked", label: "Arriving now" }, { value: "booked", label: "Arriving later" }]} />
        </div>
        {mode === "booked" && <Field label="Arriving at" className="sm:col-span-2">{(a) => <Input {...a} type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />}</Field>}
        <Field label="Number plate">{(a) => <Input {...a} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} placeholder="MH 01 AB 1234" className="font-mono uppercase" autoFocus={mode === "parked"} />}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Car">{(a) => <Input {...a} value={f.car} onChange={(e) => setF({ ...f, car: e.target.value })} placeholder="Creta" />}</Field>
          <Field label="Colour">{(a) => <Input {...a} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} placeholder="White" />}</Field>
        </div>
        <Field label="Guest name">{(a) => <Input {...a} value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} />}</Field>
        <Field label="Guest phone">{(a) => <Input {...a} type="tel" value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} />}</Field>
        {mode === "parked" && (
          <>
            <Field label="Parking slot">{(a) => <Input {...a} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} placeholder="B2-14" />}</Field>
            <Field label="Key tag" hint="Blank uses the ticket number">{(a) => <Input {...a} value={f.keyTag} onChange={(e) => setF({ ...f, keyTag: e.target.value })} />}</Field>
          </>
        )}
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Scratch on rear bumper, EV — needs charging…" />}</Field>
      </div>
    </Dialog>
  );
}

function ArriveDialog({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const [f, setF] = useState({ plate: t.plate, car: t.car, color: t.color, slot: t.slot });
  const save = useHAction<void>(() => ({ path: `valet/${t.id}/status`, body: { status: "parked", ...f } }), { success: `Ticket #${t.ticket} parked`, onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${t.guestName || `Booking #${t.ticket}`} has arrived`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<CarFront className="size-4" />} loading={save.isPending} disabled={!f.plate.trim()} onClick={() => save.mutate()}>
            Park
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Number plate">{(a) => <Input {...a} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} className="font-mono uppercase" autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Car">{(a) => <Input {...a} value={f.car} onChange={(e) => setF({ ...f, car: e.target.value })} />}</Field>
          <Field label="Colour">{(a) => <Input {...a} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />}</Field>
        </div>
        <Field label="Parking slot">{(a) => <Input {...a} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
