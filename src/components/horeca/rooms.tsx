"use client";

// Rooms: the booking calendar (tape chart), front desk lists, bookings with a
// folio (room nights, room service, payments), housekeeping, and room setup.
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, MoreHorizontal, Pencil, Plus, Printer, Sparkles, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog, Dialog, Menu, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { nights } from "@/lib/horeca/model";
import { hApi, Stat, toMajor, toMinor, useH, useHAction, useHQuery, useMoney } from "./shared";

type RoomType = { id: string; name: string; description: string; rate: number; maxGuests: number; amenities: string[]; image: string; sort: number };
type Room = { id: string; typeId: string; number: string; floor: string; housekeeping: string; tableId: string | null };
type Booking = { id: string; roomId: string; guestName: string; guestPhone: string; guestEmail: string; checkIn: string; checkOut: string; adults: number; children: number; rate: number; status: string; source: string; notes: string };
type Calendar = { from: string; days: number; today: string; types: RoomType[]; rooms: Room[]; bookings: Booking[]; stats: { rooms: number; occupied: number; arrivals: number; departures: number; dirty: number; outOfOrder: number } };
type Folio = { nights: number; rate: number; room: number; roomTax: number; taxBps: number; charges: { id: string; label: string; amount: number; at: string; orderId?: string }[]; extras: number; payments: { method: string; amount: number; at: string; ref: string }[]; paid: number; total: number; due: number };
type BookingView = { booking: Booking; room: Room; type: RoomType; folio: Folio };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS: Record<string, { label: string; tone: "accent" | "success" | "neutral" | "danger" | "warning"; bar: string }> = {
  reserved: { label: "Reserved", tone: "accent", bar: "bg-[#dbe4ff] text-[#1e3a8a] border-[#a5b8f5] dark:bg-[#1c2550] dark:text-[#c7d2fe] dark:border-[#3646a0]" },
  checked_in: { label: "In house", tone: "success", bar: "bg-[#d5f0e1] text-[#14532d] border-[#94d3b0] dark:bg-[#123222] dark:text-[#a7f3d0] dark:border-[#25694a]" },
  checked_out: { label: "Checked out", tone: "neutral", bar: "bg-surface-2 text-muted border-border" },
  cancelled: { label: "Cancelled", tone: "danger", bar: "" },
  no_show: { label: "No-show", tone: "warning", bar: "" },
};
const HK: Record<string, { label: string; dot: string }> = {
  clean: { label: "Clean", dot: "bg-success" },
  dirty: { label: "Needs cleaning", dot: "bg-danger" },
  inspect: { label: "To inspect", dot: "bg-warning" },
  out_of_order: { label: "Out of order", dot: "bg-fg" },
};
const SOURCES = [
  ["direct", "Direct"],
  ["walk_in", "Walk-in"],
  ["phone", "Phone"],
  ["ota", "Online travel agent"],
  ["corporate", "Corporate"],
] as const;

export function RoomsView({ bookingId }: { bookingId?: string }) {
  const [tab, setTab] = useState<"calendar" | "desk" | "housekeeping" | "setup">("calendar");
  const [from, setFrom] = useState("");
  const [open, setOpen] = useState<string | null>(bookingId ?? null);
  const [book, setBook] = useState<{ roomId?: string; checkIn?: string } | null>(null);
  const cal = useHQuery<Calendar>(`calendar?days=14${from ? `&from=${from}` : ""}`, { refetchInterval: 20000 });
  if (!cal.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const c = cal.data;
  const occ = c.stats.rooms ? Math.round((c.stats.occupied / c.stats.rooms) * 100) : 0;
  return (
    <div>
      <PageHeader
        title="Rooms"
        description="Bookings, check-in and check-out, the guest's folio and housekeeping — with in-room dining charged straight to the room."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} disabled={!c.rooms.length} onClick={() => setBook({})}>
            New booking
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Occupancy" value={`${occ}%`} sub={`${c.stats.occupied} of ${c.stats.rooms} rooms`} tone={occ >= 80 ? "good" : undefined} />
        <Stat label="Arriving today" value={c.stats.arrivals} />
        <Stat label="Leaving today" value={c.stats.departures} />
        <Stat label="In house" value={c.stats.occupied} />
        <Stat label="Need cleaning" value={c.stats.dirty} tone={c.stats.dirty ? "warn" : undefined} />
        <Stat label="Out of order" value={c.stats.outOfOrder} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mt-5 mb-4"
        tabs={[
          { value: "calendar", label: "Calendar" },
          { value: "desk", label: "Front desk" },
          { value: "housekeeping", label: "Housekeeping" },
          { value: "setup", label: "Rooms & rates" },
        ]}
      />
      {!c.rooms.length && tab !== "setup" ? (
        <EmptyState icon={<BedDouble />} title="Add your rooms first" description="Create room types with their nightly rate, then the rooms of each type." action={<Button variant="primary" onClick={() => setTab("setup")}>Set up rooms</Button>} />
      ) : tab === "calendar" ? (
        <TapeChart c={c} onPrev={() => setFrom(addDays(c.from, -7))} onNext={() => setFrom(addDays(c.from, 7))} onToday={() => setFrom("")} onOpen={setOpen} onBook={(roomId, checkIn) => setBook({ roomId, checkIn })} />
      ) : tab === "desk" ? (
        <FrontDesk c={c} onOpen={setOpen} />
      ) : tab === "housekeeping" ? (
        <Housekeeping c={c} />
      ) : (
        <Setup />
      )}
      {book && <BookingDialog c={c} init={book} onClose={() => setBook(null)} onCreated={(id) => { setBook(null); setOpen(id); }} />}
      {open && <BookingDrawer id={open} c={c} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TapeChart({ c, onPrev, onNext, onToday, onOpen, onBook }: { c: Calendar; onPrev: () => void; onNext: () => void; onToday: () => void; onOpen: (id: string) => void; onBook: (roomId: string, day: string) => void }) {
  const days = Array.from({ length: c.days }, (_, i) => addDays(c.from, i));
  const end = addDays(c.from, c.days);
  const W = 76;
  return (
    <div className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={onPrev} aria-label="Earlier" />
        <Button size="sm" onClick={onToday}>
          Today
        </Button>
        <Button size="sm" variant="ghost" icon={<ChevronRight className="size-4" />} onClick={onNext} aria-label="Later" />
        <span className="ml-2 text-[13.5px] font-semibold">
          {nice(c.from)} – {nice(addDays(end, -1))}
        </span>
        <span className="ml-auto hidden gap-3 text-[11.5px] text-muted sm:flex">
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-[#a5b8f5]" /> Reserved</span>
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-[#94d3b0]" /> In house</span>
          <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-surface-3" /> Checked out</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 150 + W * c.days }}>
          <div className="grid border-b border-border text-[11.5px] text-muted" style={{ gridTemplateColumns: `150px repeat(${c.days}, ${W}px)` }}>
            <div className="sticky left-0 z-10 bg-surface px-3 py-2 font-semibold">Room</div>
            {days.map((d) => (
              <div key={d} className={cx("border-l border-border px-1 py-2 text-center", d === c.today && "bg-accent-soft font-semibold text-accent", [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && d !== c.today && "bg-surface-2/60")}>
                {dayLabel(d)}
              </div>
            ))}
          </div>
          {c.types.map((t) => {
            const rooms = c.rooms.filter((r) => r.typeId === t.id);
            if (!rooms.length) return null;
            return (
              <div key={t.id}>
                <div className="sticky left-0 bg-surface-2/50 px-3 py-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">{t.name}</div>
                {rooms.map((r) => {
                  const list = c.bookings.filter((b) => b.roomId === r.id);
                  return (
                    <div key={r.id} className="relative grid h-12 border-b border-border" style={{ gridTemplateColumns: `150px repeat(${c.days}, ${W}px)` }}>
                      <div className="sticky left-0 z-10 flex items-center gap-2 bg-surface px-3 text-[13.5px] font-semibold">
                        <i className={cx("size-2 rounded-full", HK[r.housekeeping]?.dot)} title={HK[r.housekeeping]?.label} />
                        {r.number}
                        {r.floor && <span className="text-[11px] font-normal text-subtle">Fl {r.floor}</span>}
                      </div>
                      {days.map((d) => (
                        <button key={d} type="button" aria-label={`Book room ${r.number} from ${d}`} onClick={() => onBook(r.id, d)} className={cx("border-l border-border hover:bg-accent-soft/50", d === c.today && "bg-accent-soft/30")} />
                      ))}
                      {list.map((b) => {
                        const s = b.checkIn < c.from ? c.from : b.checkIn;
                        const e = b.checkOut > end ? end : b.checkOut;
                        const left = 150 + nights(c.from, s) * W + (b.checkIn < c.from ? 0 : W / 2);
                        const right = 150 + nights(c.from, e) * W + (b.checkOut > end ? 0 : W / 2);
                        return (
                          <button key={b.id} type="button" onClick={() => onOpen(b.id)} className={cx("absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded-[10px] border px-2 text-left text-[12px] font-semibold whitespace-nowrap shadow-sm transition-transform hover:-translate-y-px", STATUS[b.status]?.bar)} style={{ left: left + 2, width: Math.max(24, right - left - 4) }}>
                            {b.status === "checked_in" && <LogIn className="size-3 shrink-0" />}
                            <span className="truncate">{b.guestName}</span>
                            {right - left > 110 && <span className="font-normal opacity-70">· {b.adults + b.children}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="border-t border-border px-3 py-2 text-[11.5px] text-muted">Tap an empty day to book that room. Dots show housekeeping: green clean, red needs cleaning, amber to inspect.</p>
    </div>
  );
}

function DeskList({ title, list, icon, empty, c, onOpen }: { title: string; list: Booking[]; icon: React.ReactNode; empty: string; c: Calendar; onOpen: (id: string) => void }) {
  const money = useMoney();
  const roomOf = (id: string) => c.rooms.find((r) => r.id === id);
  return (
    <section className="rounded-[22px] border border-border bg-surface shadow-sm">
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-[14px] font-semibold [&_svg]:size-4">
        {icon}
        {title}
        <span className="rounded-full bg-surface-2 px-2 text-[11.5px] text-muted">{list.length}</span>
      </h2>
      {!list.length ? (
        <p className="p-6 text-center text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onOpen(b.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-[13px] font-bold">{roomOf(b.roomId)?.number}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[14px]">{b.guestName}</b>
                  <span className="text-[12px] text-muted">
                    {nice(b.checkIn)} → {nice(b.checkOut)} · {nights(b.checkIn, b.checkOut)}n · {b.adults + b.children} guests
                  </span>
                </span>
                <span className="text-[12.5px] text-muted tabular-nums">{money(b.rate)}/n</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FrontDesk({ c, onOpen }: { c: Calendar; onOpen: (id: string) => void }) {
  const arrivals = c.bookings.filter((b) => b.status === "reserved" && b.checkIn <= c.today);
  const departures = c.bookings.filter((b) => b.status === "checked_in" && b.checkOut <= c.today);
  const inHouse = c.bookings.filter((b) => b.status === "checked_in" && b.checkOut > c.today);
  const upcoming = c.bookings.filter((b) => b.status === "reserved" && b.checkIn > c.today);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DeskList c={c} onOpen={onOpen} title="Arriving" list={arrivals} icon={<LogIn />} empty="No arrivals waiting." />
      <DeskList c={c} onOpen={onOpen} title="Leaving" list={departures} icon={<LogOut />} empty="No departures due." />
      <DeskList c={c} onOpen={onOpen} title="In house" list={inHouse} icon={<Users />} empty="No guests in house." />
      <DeskList c={c} onOpen={onOpen} title="Coming up (14 days)" list={upcoming} icon={<CalendarDays />} empty="Nothing booked yet." />
    </div>
  );
}

function Housekeeping({ c }: { c: Calendar }) {
  const set = useHAction<{ id: string; state: string }>(({ id, state }) => ({ path: `rooms/${id}/housekeeping`, body: { state } }));
  const guest = (roomId: string) => c.bookings.find((b) => b.roomId === roomId && b.status === "checked_in");
  const arriving = (roomId: string) => c.bookings.find((b) => b.roomId === roomId && b.status === "reserved" && b.checkIn === c.today);
  const order = ["dirty", "inspect", "clean", "out_of_order"];
  const rooms = [...c.rooms].sort((a, b) => order.indexOf(a.housekeeping) - order.indexOf(b.housekeeping) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {rooms.map((r) => {
        const g = guest(r.id);
        const a = arriving(r.id);
        return (
          <div key={r.id} className={cx("rounded-[18px] border bg-surface p-3.5 shadow-sm", r.housekeeping === "dirty" ? "border-danger/40" : "border-border")}>
            <div className="flex items-center justify-between">
              <span className="text-[20px] font-bold tracking-[-0.02em]">{r.number}</span>
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium">
                <i className={cx("size-2 rounded-full", HK[r.housekeeping]?.dot)} />
                {HK[r.housekeeping]?.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted">{g ? `Occupied · ${g.guestName}` : a ? `Arriving · ${a.guestName}` : "Vacant"}</p>
            {a && r.housekeeping !== "clean" && <Badge tone="warning" className="mt-1.5">Prepare first</Badge>}
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {(r.housekeeping === "dirty" ? ["inspect", "clean"] : r.housekeeping === "inspect" ? ["clean", "dirty"] : r.housekeeping === "clean" ? ["dirty", "out_of_order"] : ["clean", "dirty"]).map((s) => (
                <Button key={s} size="sm" variant={s === "clean" ? "primary" : "secondary"} onClick={() => set.mutate({ id: r.id, state: s })}>
                  {s === "clean" ? "Clean ✓" : s === "inspect" ? "Cleaned" : s === "dirty" ? "Dirty" : "Block"}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookingDialog({ c, init, onClose, onCreated, edit }: { c: Calendar; init: { roomId?: string; checkIn?: string }; onClose: () => void; onCreated: (id: string) => void; edit?: Booking }) {
  const money = useMoney();
  const { venue } = useH();
  const [f, setF] = useState({
    checkIn: edit?.checkIn ?? init.checkIn ?? c.today,
    checkOut: edit?.checkOut ?? addDays(init.checkIn ?? c.today, 1),
    roomId: edit?.roomId ?? init.roomId ?? "",
    guestName: edit?.guestName ?? "",
    guestPhone: edit?.guestPhone ?? "",
    guestEmail: edit?.guestEmail ?? "",
    adults: edit?.adults ?? 2,
    children: edit?.children ?? 0,
    rate: edit ? toMajor(edit.rate) : "",
    source: edit?.source ?? "direct",
    notes: edit?.notes ?? "",
  });
  const okDates = f.checkOut > f.checkIn;
  const avail = useHQuery<{ rooms: Room[]; types: RoomType[] }>(`availability?checkIn=${f.checkIn}&checkOut=${f.checkOut}`, { enabled: okDates });
  const free = useMemo(() => [...(avail.data?.rooms ?? []), ...(edit ? c.rooms.filter((r) => r.id === edit.roomId) : [])], [avail.data, edit, c.rooms]);
  const room = c.rooms.find((r) => r.id === f.roomId);
  const type = c.types.find((t) => t.id === room?.typeId);
  const roomFree = !f.roomId || free.some((r) => r.id === f.roomId);
  const rate = f.rate === "" ? (type?.rate ?? 0) : toMinor(f.rate);
  const n = okDates ? nights(f.checkIn, f.checkOut) : 0;
  const tax = Math.round((n * rate * venue.settings.rooms.taxBps) / 10_000);
  const save = useHAction<void, { booking?: Booking } & Partial<BookingView>>(
    () => ({ path: edit ? `bookings/${edit.id}` : "bookings", method: edit ? "PUT" : "POST", body: { ...f, rate: f.rate === "" ? null : toMinor(f.rate) } }),
    { success: edit ? "Booking updated" : "Booked", onDone: (r) => onCreated(r.booking!.id) },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={edit ? `Change booking · ${edit.guestName}` : "New booking"}
      footer={
        <>
          {n > 0 && rate > 0 && (
            <span className="mr-auto text-[13px] text-muted">
              {n} night{n > 1 ? "s" : ""} × {money(rate)} + GST {money(tax)} = <b className="text-fg">{money(n * rate + tax)}</b>
            </span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!okDates || !f.roomId || !roomFree || !f.guestName.trim()} onClick={() => save.mutate()}>
            {edit ? "Save" : "Book"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Check-in">{(a) => <Input {...a} type="date" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value, checkOut: e.target.value >= f.checkOut ? addDays(e.target.value, 1) : f.checkOut })} />}</Field>
        <Field label="Check-out" error={okDates ? undefined : "After check-in"}>{(a) => <Input {...a} type="date" min={addDays(f.checkIn, 1)} value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[13px] font-medium">
            Room {avail.data && <span className="font-normal text-muted">· {avail.data.rooms.length} free for these dates</span>}
          </p>
          <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
            {c.types.map((t) => {
              const rs = free.filter((r) => r.typeId === t.id);
              if (!rs.length) return null;
              return (
                <div key={t.id} className="rounded-[14px] border border-border p-2.5">
                  <p className="text-[12.5px] font-semibold">
                    {t.name} <span className="font-normal text-muted">· {money(t.rate)}/n · sleeps {t.maxGuests}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {rs.map((r) => (
                      <button key={r.id} type="button" onClick={() => setF({ ...f, roomId: r.id })} aria-pressed={f.roomId === r.id} className={cx("h-8 min-w-12 rounded-full border px-2.5 text-[13px] font-semibold", f.roomId === r.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
                        {r.number}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {!roomFree && <p className="mt-1 text-[12.5px] text-danger">Room {room?.number} is taken on these dates — pick another.</p>}
        </div>
        <Field label="Guest name">{(a) => <Input {...a} value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} maxLength={100} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} />}</Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adults">{(a) => <Input {...a} type="number" min={1} max={20} value={f.adults} onChange={(e) => setF({ ...f, adults: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
          <Field label="Children">{(a) => <Input {...a} type="number" min={0} max={20} value={f.children} onChange={(e) => setF({ ...f, children: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
        </div>
        <Field label="Rate per night" hint={type ? `Blank = ${money(type.rate)} (${type.name})` : undefined}>{(a) => <Input {...a} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder={type ? toMajor(type.rate) : ""} />}</Field>
        <Field label="Booked via">
          {(a) => (
            <Select {...a} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Early check-in, airport pickup, anniversary cake…" />}</Field>
      </div>
    </Dialog>
  );
}

function BookingDrawer({ id, c, onClose }: { id: string; c: Calendar; onClose: () => void }) {
  const money = useMoney();
  const { venue } = useH();
  const q = useHQuery<BookingView>(`bookings/${id}`);
  const [charge, setCharge] = useState(false);
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState(false);
  const [force, setForce] = useState<{ action: string; message: string } | null>(null);
  const act = useHAction<{ action: string; force?: boolean }, BookingView>(({ action, force }) => ({ path: `bookings/${id}/action`, body: { action, force: !!force } }), {
    success: (r) => ({ checked_in: "Checked in — welcome!", checked_out: "Checked out · room marked for cleaning", cancelled: "Booking cancelled", no_show: "Marked as no-show" })[r.booking.status] ?? "Done",
    onDone: () => setForce(null),
  });
  if (!q.data) return null;
  const { booking: b, room, type, folio } = q.data;
  const st = STATUS[b.status];
  const tryAction = (action: string) => {
    if (action === "check_in" && room.housekeeping !== "clean") return setForce({ action, message: `Room ${room.number} isn't marked clean. Check the guest in anyway?` });
    if (action === "check_out" && folio.due > 0) return setForce({ action, message: `${money(folio.due)} is still due. Check out without settling?` });
    act.mutate({ action });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={b.guestName}
      description={`Room ${room.number} · ${type.name} · ${nice(b.checkIn)} → ${nice(b.checkOut)} (${folio.nights} night${folio.nights === 1 ? "" : "s"})`}
      footer={
        <>
          {b.status === "reserved" && (
            <>
              <Menu
                label="More"
                align="start"
                trigger={(p) => (
                  <Button {...p} variant="ghost" icon={<MoreHorizontal className="size-4" />}>
                    More
                  </Button>
                )}
                items={[
                  { label: "Change dates or room", icon: <Pencil className="size-4" />, onSelect: () => setEdit(true) },
                  { label: "Mark as no-show", onSelect: () => act.mutate({ action: "no_show" }) },
                  { label: "Cancel booking", danger: true, onSelect: () => act.mutate({ action: "cancel" }) },
                ]}
              />
              <span className="flex-1" />
              <Button variant="primary" icon={<LogIn className="size-4" />} loading={act.isPending} disabled={b.checkIn > c.today} onClick={() => tryAction("check_in")}>
                {b.checkIn > c.today ? `Check-in from ${nice(b.checkIn)}` : "Check in"}
              </Button>
            </>
          )}
          {b.status === "checked_in" && (
            <>
              <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                Extend / move
              </Button>
              <span className="flex-1" />
              <Button variant="primary" icon={<LogOut className="size-4" />} loading={act.isPending} onClick={() => tryAction("check_out")}>
                Check out
              </Button>
            </>
          )}
          {!["reserved", "checked_in"].includes(b.status) && <Button onClick={onClose}>Close</Button>}
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Badge tone={st?.tone}>{st?.label ?? b.status}</Badge>
          <span>{b.adults} adult{b.adults > 1 ? "s" : ""}{b.children ? ` · ${b.children} child${b.children > 1 ? "ren" : ""}` : ""}</span>
          {b.guestPhone && <a className="text-accent" href={`tel:${b.guestPhone}`}>{b.guestPhone}</a>}
          {b.guestEmail && <a className="text-accent" href={`mailto:${b.guestEmail}`}>{b.guestEmail}</a>}
          <span>via {SOURCES.find(([v]) => v === b.source)?.[1] ?? b.source}</span>
        </div>
        {b.notes && <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-[13px]">📝 {b.notes}</p>}
        <div className="rounded-[18px] border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-[14px] font-semibold">Folio</h3>
            <div className="flex gap-1.5">
              {["reserved", "checked_in"].includes(b.status) && (
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCharge(true)}>
                  Charge
                </Button>
              )}
              {folio.due > 0 && (
                <Button size="sm" variant="primary" onClick={() => setPay(true)}>
                  Take payment
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={() => printFolio(venue.name, q.data!, money)} aria-label="Print folio" />
            </div>
          </div>
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2">
                  Room {room.number} · {folio.nights} × {money(folio.rate)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{money(folio.room)}</td>
              </tr>
              <tr className="text-muted">
                <td className="px-4 py-2">GST on room ({folio.taxBps / 100}%)</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(folio.roomTax)}</td>
              </tr>
              {folio.charges.map((ch) => (
                <tr key={ch.id}>
                  <td className="px-4 py-2">
                    {ch.label} <span className="text-[11.5px] text-subtle">{new Date(ch.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(ch.amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(folio.total)}</td>
              </tr>
              {folio.payments.map((p, i) => (
                <tr key={i} className="text-success">
                  <td className="px-4 py-2 capitalize">
                    Paid · {p.method}
                    {p.ref ? ` · ${p.ref}` : ""}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">−{money(p.amount)}</td>
                </tr>
              ))}
              <tr className="text-[15px] font-bold">
                <td className="px-4 py-2.5">Balance due</td>
                <td className={cx("px-4 py-2.5 text-right tabular-nums", folio.due > 0 ? "text-danger" : "text-success")}>{money(folio.due)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted">In-room dining ordered from Room {room.number}&apos;s QR code and settled “To room” on the floor screen lands here automatically.</p>
      </div>
      {charge && <ChargeDialog id={id} onClose={() => setCharge(false)} />}
      {pay && <FolioPayDialog id={id} due={folio.due} onClose={() => setPay(false)} />}
      {edit && <BookingDialog c={c} init={{}} edit={b} onClose={() => setEdit(false)} onCreated={() => setEdit(false)} />}
      <ConfirmDialog open={!!force} onClose={() => setForce(null)} onConfirm={() => act.mutate({ action: force!.action, force: true })} loading={act.isPending} title="Are you sure?" description={force?.message} confirmLabel="Yes, continue" />
    </Dialog>
  );
}

function printFolio(venue: string, v: BookingView, money: (n: number) => string) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const f = v.folio;
  const row = (k: string, val: string, cls = "") => `<tr class="${cls}"><td>${k}</td><td>${val}</td></tr>`;
  w.document.write(`<!doctype html><title>Folio · ${esc(v.booking.guestName)}</title><style>body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;max-width:640px;margin:40px auto;color:#111;padding:0 20px}h1{font-size:22px;margin:0}p{margin:2px 0;color:#555}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:8px 0;border-bottom:1px solid #eee}td:last-child{text-align:right}.b td{font-weight:700;border-top:2px solid #111}.m td{color:#666}</style><h1>${esc(venue)}</h1><p>Guest folio · ${esc(v.booking.guestName)}</p><p>Room ${esc(v.room.number)} (${esc(v.type.name)}) · ${v.booking.checkIn} → ${v.booking.checkOut} · ${f.nights} night(s)</p><table>${row(`Room · ${f.nights} × ${money(f.rate)}`, money(f.room))}${row(`GST on room (${f.taxBps / 100}%)`, money(f.roomTax), "m")}${f.charges.map((c) => row(esc(c.label), money(c.amount))).join("")}${row("Total", money(f.total), "b")}${f.payments.map((p) => row(`Paid · ${esc(p.method)}`, `−${money(p.amount)}`, "m")).join("")}${row("Balance due", money(f.due), "b")}</table><p style="margin-top:24px">Thank you for staying with us.</p>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function ChargeDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const add = useHAction<void>(() => ({ path: `bookings/${id}/charges`, body: { label, amount: toMinor(amount) } }), { success: "Added to the folio", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Add a charge"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} disabled={!label.trim() || toMinor(amount) <= 0} onClick={() => add.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {["Laundry", "Minibar", "Airport transfer", "Spa", "Extra bed", "Late checkout"].map((l) => (
            <button key={l} type="button" onClick={() => setLabel(l)} className="h-7 rounded-full border border-border px-2.5 text-[12px] hover:bg-surface-2">
              {l}
            </button>
          ))}
        </div>
        <Field label="What for">{(a) => <Input {...a} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus />}</Field>
        <Field label="Amount (incl. tax)">{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function FolioPayDialog({ id, due, onClose }: { id: string; due: number; onClose: () => void }) {
  const money = useMoney();
  const [method, setMethod] = useState<"cash" | "upi" | "card" | "other">("card");
  const [amount, setAmount] = useState(toMajor(due));
  const [ref, setRef] = useState("");
  const pay = useHAction<void>(() => ({ path: `bookings/${id}/payments`, body: { method, amount: toMinor(amount), ref } }), { success: "Payment recorded", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Take payment · ${money(due)} due`}
      description="Advance or final settlement."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pay.isPending} disabled={toMinor(amount) <= 0 || toMinor(amount) > due} onClick={() => pay.mutate()}>
            Record {money(toMinor(amount))}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-4 gap-1.5">
          {(["cash", "upi", "card", "other"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} className={cx("h-10 rounded-[12px] border text-[13px] font-semibold capitalize", method === m ? "border-fg bg-surface-2" : "border-border")}>
              {m === "upi" ? "UPI" : m}
            </button>
          ))}
        </div>
        <Field label="Amount">{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Reference" hint="Card slip, UPI ref or receipt number">{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />}</Field>
      </div>
    </Dialog>
  );
}

// ─── Rooms & rates ───────────────────────────────────────────────────────────

function Setup() {
  const money = useMoney();
  const q = useHQuery<{ types: RoomType[]; rooms: Room[] }>("rooms");
  const [editType, setEditType] = useState<Partial<RoomType> | null>(null);
  const [addRooms, setAddRooms] = useState<string | null>(null);
  const [del, setDel] = useState<{ kind: "rooms" | "room-types"; id: string; name: string } | null>(null);
  const remove = useHAction<void>(() => ({ path: `${del!.kind}/${del!.id}`, method: "DELETE" }), { success: "Deleted", onDone: () => setDel(null) });
  if (!q.data) return <Skeleton className="h-64 rounded-[22px]" />;
  return (
    <div className="grid gap-4">
      {q.data.types.map((t) => {
        const rooms = q.data!.rooms.filter((r) => r.typeId === t.id);
        return (
          <section key={t.id} className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm sm:flex">
            {t.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.image} alt="" className="h-40 w-full object-cover sm:h-auto sm:w-56" />
            ) : (
              <div className="grid h-24 place-items-center bg-surface-2 text-subtle sm:h-auto sm:w-56">
                <BedDouble className="size-8" />
              </div>
            )}
            <div className="min-w-0 flex-1 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[16px] font-semibold">{t.name}</h3>
                  <p className="text-[13px] text-muted">
                    {money(t.rate)} a night · sleeps {t.maxGuests} · {rooms.length} room{rooms.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Menu
                  label={`Actions for ${t.name}`}
                  trigger={(p) => (
                    <button {...p} aria-label={`Actions for ${t.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                  items={[
                    { label: "Edit type", icon: <Pencil className="size-4" />, onSelect: () => setEditType(t) },
                    { label: "Delete type and its rooms", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel({ kind: "room-types", id: t.id, name: t.name }) },
                  ]}
                />
              </div>
              {t.description && <p className="mt-2 text-[13px] text-muted">{t.description}</p>}
              {t.amenities.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.amenities.map((a) => (
                    <span key={a} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px]">
                      <Sparkles className="size-3" />
                      {a}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {rooms.map((r) => (
                  <span key={r.id} className="group inline-flex h-8 items-center gap-1 rounded-full border border-border pr-1 pl-3 text-[13px] font-semibold">
                    {r.number}
                    <button type="button" aria-label={`Delete room ${r.number}`} onClick={() => setDel({ kind: "rooms", id: r.id, name: `room ${r.number}` })} className="grid size-6 place-items-center rounded-full text-subtle hover:text-danger">
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddRooms(t.id)}>
                  Rooms
                </Button>
              </div>
            </div>
          </section>
        );
      })}
      <button type="button" onClick={() => setEditType({})} className="rounded-[22px] border border-dashed border-border p-6 text-[14px] text-muted hover:bg-surface-2">
        + New room type <span className="block text-[12.5px]">Deluxe King, Suite, Dormitory bed…</span>
      </button>
      {editType && <TypeDialog init={editType} onClose={() => setEditType(null)} />}
      {addRooms && <AddRoomsDialog typeId={addRooms} onClose={() => setAddRooms(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${del?.name}?`} description="Bookings for these rooms are deleted too. This can't be undone." confirmLabel="Delete" />
    </div>
  );
}

function TypeDialog({ init, onClose }: { init: Partial<RoomType>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", description: init.description ?? "", rate: init.rate !== undefined ? toMajor(init.rate) : "", maxGuests: init.maxGuests ?? 2, amenities: (init.amenities ?? []).join(", "), image: init.image ?? "" });
  const save = useHAction<void>(
    () => ({ path: init.id ? `room-types/${init.id}` : "room-types", method: init.id ? "PUT" : "POST", body: { ...f, rate: toMinor(f.rate), amenities: f.amenities.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20), sort: init.sort ?? 0 } }),
    { success: "Saved", onDone: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New room type"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || f.rate === ""} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Deluxe King" autoFocus />}</Field>
        <Field label="Rate per night">{(a) => <Input {...a} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="4500" />}</Field>
        <Field label="Sleeps">{(a) => <Input {...a} type="number" min={1} max={20} value={f.maxGuests} onChange={(e) => setF({ ...f, maxGuests: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        <Field label="Amenities" hint="Comma separated" className="sm:col-span-2">{(a) => <Input {...a} value={f.amenities} onChange={(e) => setF({ ...f, amenities: e.target.value })} placeholder="King bed, Balcony, Bathtub, Wi-Fi" />}</Field>
        <Field label="Photo link" className="sm:col-span-2">{(a) => <Input {...a} value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} placeholder="https://…" />}</Field>
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

/** "101-108, 201, 202" → each room number. */
function parseNumbers(s: string) {
  const out: string[] = [];
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m && Number(m[2]) >= Number(m[1]) && Number(m[2]) - Number(m[1]) < 100) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(String(i));
    else out.push(part);
  }
  return [...new Set(out)].slice(0, 100);
}

function AddRoomsDialog({ typeId, onClose }: { typeId: string; onClose: () => void }) {
  const { projectId } = useH();
  const qc = useQueryClient();
  const toast = useToast();
  const [numbers, setNumbers] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const list = parseNumbers(numbers);
  // One request per room, so a number that already exists only skips that room.
  const run = async () => {
    setBusy(true);
    const failed: string[] = [];
    for (const number of list) {
      try {
        await api(hApi(projectId, "rooms"), { method: "POST", body: { typeId, number, floor } });
      } catch (e) {
        failed.push(`${number} (${errorMessage(e)})`);
      }
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ["horeca", projectId] });
    if (failed.length) toast({ tone: "error", title: `Couldn't add ${failed.length}`, description: failed.join(", ") });
    else toast({ tone: "success", title: `${list.length} room${list.length === 1 ? "" : "s"} added`, description: "Each has its own in-room dining QR code." });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Add rooms"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!list.length} onClick={run}>
            Add {list.length || ""}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Room numbers" hint="Ranges work: 101-110, 201, 202">{(a) => <Input {...a} value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="101-108" autoFocus />}</Field>
        <Field label="Floor">{(a) => <Input {...a} value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={20} placeholder="1" />}</Field>
        {list.length > 0 && <p className="text-[12.5px] text-muted">Adds {list.slice(0, 12).join(", ")}{list.length > 12 ? ` and ${list.length - 12} more` : ""}.</p>}
      </div>
    </Dialog>
  );
}
