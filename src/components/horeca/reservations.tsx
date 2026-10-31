"use client";

// Reservations and the waitlist: the day's bookings in time order, seating a
// party onto a table (which opens its order), and the online booking link.
import { CalendarClock, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Hourglass, Phone, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Dialog, Menu, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { Stat, useH, useHAction, useHQuery } from "./shared";

type Resv = { id: string; kind: string; guestName: string; guestPhone: string; partySize: number; at: string; durationMin: number; tableId: string | null; table: string | null; status: string; source: string; notes: string };
type Day = { day: string; reservations: Resv[]; waitlist: Resv[]; stats: { bookings: number; covers: number; waiting: number; seated: number } };
type Table = { id: string; name: string; seats: number; kind: string; order: { id: string } | null };

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = { booked: "warning", confirmed: "accent", seated: "success", completed: "neutral", cancelled: "danger", no_show: "danger" };
const LABEL: Record<string, string> = { booked: "Requested", confirmed: "Confirmed", seated: "Seated", completed: "Done", cancelled: "Cancelled", no_show: "No-show" };
const SOURCE: Record<string, string> = { staff: "Staff", online: "Online", phone: "Phone", walk_in: "Walk-in" };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function ReservationsView() {
  const { venue } = useH();
  const toast = useToast();
  const [day, setDay] = useState(istToday());
  const q = useHQuery<Day>(`reservations?day=${day}`, { refetchInterval: 15000 });
  const [edit, setEdit] = useState<Partial<Resv> | null>(null);
  const [seating, setSeating] = useState<Resv | null>(null);
  const move = useHAction<{ id: string; status: string; tableId?: string | null }>((b) => ({ path: `reservations/${b.id}/status`, body: { status: b.status, tableId: b.tableId } }), {
    success: "Updated",
    onDone: () => setSeating(null),
  });
  const link = typeof window !== "undefined" ? `${window.location.origin}/r/${venue.token}` : `/r/${venue.token}`;
  const online = venue.settings.reservations.online;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const d = q.data;
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div>
      <PageHeader
        title="Reservations"
        description="Bookings and the walk-in waitlist. Seating a party opens its order on the table."
        actions={
          <>
            <Button size="sm" icon={<Hourglass className="size-4" />} onClick={() => setEdit({ kind: "waitlist", at: new Date().toISOString(), partySize: 2 })}>
              Add to waitlist
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ kind: "reservation", partySize: 2 })}>
              Reservation
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bookings" value={d.stats.bookings} sub={label} />
        <Stat label="Covers expected" value={d.stats.covers} />
        <Stat label="Seated now" value={d.stats.seated} />
        <Stat label="Waitlist" value={d.stats.waiting} tone={d.stats.waiting ? "warn" : undefined} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-4" />} aria-label="Previous day" onClick={() => setDay(shift(day, -1))} />
        <Button size="sm" onClick={() => setDay(istToday())}>
          Today
        </Button>
        <Button size="sm" variant="ghost" icon={<ChevronRight className="size-4" />} aria-label="Next day" onClick={() => setDay(shift(day, 1))} />
        <Input type="date" aria-label="Day" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="!h-8 !w-40" />
        <span className="text-[14px] font-semibold">{label}</span>
        {online && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-[12.5px]">
            <span className="text-muted">Online booking:</span>
            <code className="max-w-[220px] truncate">{link.replace(/^https?:\/\//, "")}</code>
            <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} aria-label="Copy booking link" onClick={() => navigator.clipboard.writeText(link).then(() => toast({ tone: "success", title: "Link copied" }))} />
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} aria-label="Open booking page" onClick={() => window.open(link, "_blank", "noopener")} />
          </span>
        )}
      </div>
      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm">
          {!d.reservations.length ? (
            <EmptyState icon={<CalendarClock />} title="No reservations" description={online ? "Share the online booking link, or add one here." : "Add one here."} className="py-16" />
          ) : (
            <ul className="divide-y divide-border">
              {d.reservations.map((r) => (
                <li key={r.id} className={cx("flex flex-wrap items-center gap-3 px-4 py-3", ["cancelled", "no_show", "completed"].includes(r.status) && "opacity-55")}>
                  <span className="w-16 text-[16px] font-bold tabular-nums">{time(r.at)}</span>
                  <span className="min-w-0 flex-1">
                    <b className="flex items-center gap-2 text-[14.5px] font-semibold">
                      {r.guestName}
                      <span className="inline-flex items-center gap-0.5 text-[12px] font-normal text-muted">
                        <Users className="size-3" />
                        {r.partySize}
                      </span>
                    </b>
                    <span className="flex flex-wrap gap-x-2 text-[12px] text-muted">
                      <span>
                        {r.table ? `Table ${r.table}` : "No table yet"} · {SOURCE[r.source] ?? r.source}
                      </span>
                      {r.guestPhone && (
                        <a href={`tel:${r.guestPhone}`} className="inline-flex items-center gap-0.5 hover:text-fg">
                          <Phone className="size-3" />
                          {r.guestPhone}
                        </a>
                      )}
                      {r.notes && <span>📝 {r.notes}</span>}
                    </span>
                  </span>
                  <Badge tone={TONE[r.status]}>{LABEL[r.status] ?? r.status}</Badge>
                  <Actions r={r} onSeat={() => setSeating(r)} onEdit={() => setEdit(r)} onMove={(status) => move.mutate({ id: r.id, status })} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="self-start rounded-[22px] border border-border bg-surface p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <Hourglass className="size-4" /> Waitlist
          </h2>
          {!d.waitlist.length ? (
            <p className="mt-6 mb-4 text-center text-[13px] text-muted">Nobody waiting.</p>
          ) : (
            <ol className="mt-3 grid gap-2">
              {d.waitlist.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 rounded-[14px] bg-surface-2 px-3 py-2.5">
                  <span className="grid size-7 place-items-center rounded-full bg-fg text-[12px] font-bold text-bg">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px]">
                      {r.guestName} · {r.partySize}
                    </b>
                    <span className="text-[11.5px] text-muted">waiting since {time(r.at)}</span>
                  </span>
                  <Button size="sm" variant="primary" onClick={() => setSeating(r)}>
                    Seat
                  </Button>
                  <Menu
                    label={`More for ${r.guestName}`}
                    trigger={(p) => (
                      <button {...p} aria-label={`More for ${r.guestName}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-3">
                        ⋯
                      </button>
                    )}
                    items={[{ label: "Left without a table", danger: true, onSelect: () => move.mutate({ id: r.id, status: "cancelled" }) }]}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {edit && <ReservationDialog init={edit} day={day} onClose={() => setEdit(null)} />}
      {seating && <SeatDialog r={seating} busy={move.isPending} onClose={() => setSeating(null)} onSeat={(tableId) => move.mutate({ id: seating.id, status: "seated", tableId })} />}
    </div>
  );
}

function Actions({ r, onSeat, onEdit, onMove }: { r: Resv; onSeat: () => void; onEdit: () => void; onMove: (s: string) => void }) {
  if (r.status === "booked")
    return (
      <span className="flex gap-1.5">
        <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => onMove("confirmed")}>
          Confirm
        </Button>
        <Button size="sm" variant="primary" onClick={onSeat}>
          Seat
        </Button>
        <More r={r} onEdit={onEdit} onMove={onMove} />
      </span>
    );
  if (r.status === "confirmed")
    return (
      <span className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={onSeat}>
          Seat
        </Button>
        <More r={r} onEdit={onEdit} onMove={onMove} />
      </span>
    );
  if (r.status === "seated")
    return (
      <Button size="sm" onClick={() => onMove("completed")}>
        Done
      </Button>
    );
  if (r.status === "cancelled" || r.status === "no_show")
    return (
      <Button size="sm" variant="ghost" onClick={() => onMove("booked")}>
        Restore
      </Button>
    );
  return null;
}

function More({ r, onEdit, onMove }: { r: Resv; onEdit: () => void; onMove: (s: string) => void }) {
  return (
    <Menu
      label={`More for ${r.guestName}`}
      trigger={(p) => (
        <button {...p} aria-label={`More for ${r.guestName}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
          ⋯
        </button>
      )}
      items={[{ label: "Edit", onSelect: onEdit }, "separator", { label: "No-show", danger: true, onSelect: () => onMove("no_show") }, { label: "Cancel", danger: true, onSelect: () => onMove("cancelled") }]}
    />
  );
}

/** "2026-10-23T19:30" in venue time ↔ ISO. */
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);
const fromLocal = (local: string) => new Date(`${local}:00+05:30`).toISOString();

function ReservationDialog({ init, day, onClose }: { init: Partial<Resv>; day: string; onClose: () => void }) {
  const { venue } = useH();
  const tables = useHQuery<{ tables: Table[] }>("tables");
  const [kind, setKind] = useState<"reservation" | "waitlist">((init.kind as "reservation" | "waitlist") ?? "reservation");
  const [f, setF] = useState({
    guestName: init.guestName ?? "",
    guestPhone: init.guestPhone ?? "",
    partySize: init.partySize ?? 2,
    at: init.at ? toLocal(init.at) : `${day}T20:00`,
    durationMin: init.durationMin ?? venue.settings.reservations.durationMin,
    tableId: init.tableId ?? "",
    source: init.source ?? "phone",
    notes: init.notes ?? "",
  });
  const save = useHAction<void>(() => ({ path: init.id ? `reservations/${init.id}` : "reservations", method: init.id ? "PUT" : "POST", body: { ...f, kind, at: kind === "waitlist" && !init.id ? new Date().toISOString() : fromLocal(f.at), tableId: f.tableId || null } }), { success: kind === "waitlist" ? "Added to the waitlist" : "Reserved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit · ${init.guestName}` : kind === "waitlist" ? "Add to the waitlist" : "New reservation"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.guestName.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!init.id && (
          <div className="sm:col-span-2">
            <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "reservation", label: "Reservation" }, { value: "waitlist", label: "Waitlist (now)" }]} />
          </div>
        )}
        <Field label="Guest name">{(a) => <Input {...a} value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} maxLength={80} autoFocus />}</Field>
        <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} maxLength={20} />}</Field>
        <Field label="Guests">{(a) => <Input {...a} type="number" min={1} max={100} value={f.partySize} onChange={(e) => setF({ ...f, partySize: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        {kind === "reservation" && <Field label="Date and time">{(a) => <Input {...a} type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />}</Field>}
        {kind === "reservation" && (
          <Field label="Table" hint="Optional — or choose when seating.">
            {(a) => (
              <Select {...a} value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}>
                <option value="">Decide later</option>
                {(tables.data?.tables ?? [])
                  .filter((t) => t.kind !== "room")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.seats} seats
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {kind === "reservation" && <Field label="Table time (minutes)">{(a) => <Input {...a} type="number" min={15} max={480} step={15} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Math.max(15, Number(e.target.value) || 90) })} />}</Field>}
        <Field label="Booked via">
          {(a) => (
            <Select {...a} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              {Object.entries(SOURCE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={300} placeholder="Birthday, high chair, allergies…" />}</Field>
      </div>
    </Dialog>
  );
}

function SeatDialog({ r, busy, onClose, onSeat }: { r: Resv; busy: boolean; onClose: () => void; onSeat: (tableId: string) => void }) {
  const floor = useHQuery<{ tables: Table[] }>("floor");
  const [pick, setPick] = useState(r.tableId ?? "");
  const tables = (floor.data?.tables ?? []).filter((t) => t.kind !== "room");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Seat ${r.guestName} · ${r.partySize}`}
      description="Their order opens on the table straight away."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!pick} onClick={() => onSeat(pick)}>
            Seat them
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {tables.map((t) => (
          <button key={t.id} type="button" disabled={!!t.order} onClick={() => setPick(t.id)} aria-pressed={pick === t.id} className={cx("flex h-16 flex-col items-center justify-center rounded-[14px] border text-[15px] font-bold disabled:opacity-35", pick === t.id ? "border-fg bg-fg text-bg" : t.seats >= r.partySize ? "border-border hover:bg-surface-2" : "border-dashed border-border hover:bg-surface-2")}>
            {t.name}
            <span className="text-[11px] font-normal opacity-70">{t.order ? "busy" : `${t.seats} seats`}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
