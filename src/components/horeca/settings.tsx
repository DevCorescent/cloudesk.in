"use client";

// Settings: the venue and its bills, staff and PINs, security and approvals,
// the POS and delivery, loyalty and receipts, reservations, happy hours, and
// which sections the venue uses — so a small café stays simple and a hotel
// gets everything.
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, Dialog, Menu, Tabs } from "@/components/ui/overlays";
import { Badge, Button, cx, Field, Input, PageHeader, Select, Switch } from "@/components/ui/primitives";
import { STAFF_ROLES, VENUE_KINDS, type HorecaSettings } from "@/lib/horeca/model";
import { cap, toMajor, toMinor, Toggle, useH, useHAction, useHQuery, useMoney, useSaveVenue } from "./shared";

type Tab = "venue" | "staff" | "pos" | "loyalty" | "reservations" | "offers" | "sections";
const ROLE_HINT: Record<string, string> = { owner: "Everything, approves", manager: "Approves voids, discounts, pay-outs", cashier: "Bills and payments", captain: "Runs a section of the floor", waiter: "Takes orders", chef: "Kitchen display", bartender: "Bar orders", host: "Reservations and seating", housekeeping: "Rooms", valet: "Valet board" };

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("venue");
  return (
    <div>
      <PageHeader title="Settings" description="How your venue bills and runs — from a one-counter café to a hotel with many outlets." />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { value: "venue", label: "Venue & bills" },
          { value: "staff", label: "Staff & security" },
          { value: "pos", label: "POS & delivery" },
          { value: "loyalty", label: "Loyalty & receipts" },
          { value: "reservations", label: "Reservations" },
          { value: "offers", label: "Happy hours" },
          { value: "sections", label: "Sections" },
        ]}
      />
      <div className="max-w-3xl">
        {tab === "venue" && <VenueTab />}
        {tab === "staff" && <StaffTab />}
        {tab === "pos" && <PosTab />}
        {tab === "loyalty" && <LoyaltyTab />}
        {tab === "reservations" && <ReservationsTab />}
        {tab === "offers" && <OffersTab />}
        {tab === "sections" && <SectionsTab />}
      </div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-[22px] border border-border bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SaveBar({ busy, onSave, disabled }: { busy: boolean; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end">
      <Button variant="primary" loading={busy} disabled={disabled} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

function VenueTab() {
  const { venue } = useH();
  const s = venue.settings;
  const [f, setF] = useState({ name: venue.name, kind: venue.kind, gst: String(venue.taxBps / 100), service: String(venue.serviceChargeBps / 100), stations: s.kitchen.stations, newStation: "", checkInTime: s.rooms.checkInTime, checkOutTime: s.rooms.checkOutTime, roomGst: String(s.rooms.taxBps / 100), valetOn: s.valet.enabled, valetFee: s.valet.fee ? toMajor(s.valet.fee) : "", slots: s.valet.slots });
  const save = useSaveVenue({ success: "Settings saved" });
  const addStation = () => {
    const v = f.newStation.trim().toLowerCase();
    if (v && !f.stations.includes(v) && f.stations.length < 8) setF({ ...f, stations: [...f.stations, v], newStation: "" });
  };
  return (
    <div className="grid gap-5">
      <Card title="Venue">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} />}</Field>
        <div className="flex flex-wrap gap-2">
          {VENUE_KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setF({ ...f, kind: k.id })} aria-pressed={f.kind === k.id} className={cx("h-9 rounded-full border px-4 text-[13px] font-medium", f.kind === k.id ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
              {k.label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Bills" hint="Menu prices are before GST; GST and service charge are added on the bill.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GST on food & drinks (%)" hint="5% for most restaurants; set per dish under Menu if different.">{(a) => <Input {...a} inputMode="decimal" value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })} />}</Field>
          <Field label="Service charge (%)" hint="Optional — guests may ask to remove it.">{(a) => <Input {...a} inputMode="decimal" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card title="Kitchen stations" hint="Each menu category sends its tickets to one station; the kitchen display filters by station.">
        <div className="flex flex-wrap gap-2">
          {f.stations.map((st) => (
            <span key={st} className="inline-flex h-8 items-center gap-1 rounded-full border border-border pr-1 pl-3 text-[13px] font-medium">
              {cap(st)}
              <button type="button" aria-label={`Remove ${st}`} disabled={f.stations.length <= 1} onClick={() => setF({ ...f, stations: f.stations.filter((x) => x !== st) })} className="grid size-6 place-items-center rounded-full text-subtle hover:text-danger disabled:opacity-30">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Input aria-label="New station" className="!h-8 w-32" value={f.newStation} onChange={(e) => setF({ ...f, newStation: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addStation()} placeholder="tandoor" maxLength={30} />
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={addStation} disabled={!f.newStation.trim() || f.stations.length >= 8}>
              Add
            </Button>
          </span>
        </div>
      </Card>
      {s.sections.rooms && (
        <Card title="Rooms">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Check-in from">{(a) => <Input {...a} type="time" value={f.checkInTime} onChange={(e) => setF({ ...f, checkInTime: e.target.value })} />}</Field>
            <Field label="Check-out by">{(a) => <Input {...a} type="time" value={f.checkOutTime} onChange={(e) => setF({ ...f, checkOutTime: e.target.value })} />}</Field>
            <Field label="GST on room tariff (%)" hint="12% up to ₹7,500 a night; 18% above.">{(a) => <Input {...a} inputMode="decimal" value={f.roomGst} onChange={(e) => setF({ ...f, roomGst: e.target.value })} />}</Field>
          </div>
        </Card>
      )}
      {s.sections.valet && (
        <Card title="Valet parking">
          <Toggle checked={f.valetOn} onChange={(v) => setF({ ...f, valetOn: v })} label="Offer valet parking" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Parking slots">{(a) => <Input {...a} type="number" min={0} max={2000} value={f.slots} onChange={(e) => setF({ ...f, slots: Math.max(0, Math.min(2000, Number(e.target.value) || 0)) })} />}</Field>
            <Field label="Valet fee" hint="Blank = complimentary.">{(a) => <Input {...a} inputMode="decimal" value={f.valetFee} onChange={(e) => setF({ ...f, valetFee: e.target.value })} placeholder="0" />}</Field>
          </div>
        </Card>
      )}
      <SaveBar
        busy={save.isPending}
        disabled={!f.name.trim()}
        onSave={() =>
          save.mutate({
            name: f.name.trim(),
            kind: f.kind,
            taxBps: Math.round(Number(f.gst || 0) * 100),
            serviceChargeBps: Math.round(Number(f.service || 0) * 100),
            settings: { kitchen: { stations: f.stations }, rooms: { checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, taxBps: Math.round(Number(f.roomGst || 0) * 100) }, valet: { enabled: f.valetOn, fee: toMinor(f.valetFee), slots: f.slots } },
          })
        }
      />
    </div>
  );
}

type Staff = { id: string; name: string; role: string; active: boolean; lastSeenAt: string | null };

function StaffTab() {
  const { venue } = useH();
  const q = useHQuery<{ staff: Staff[] }>("staff");
  const [edit, setEdit] = useState<Partial<Staff> | null>(null);
  const [del, setDel] = useState<Staff | null>(null);
  const remove = useHAction<void>(() => ({ path: `staff/${del!.id}`, method: "DELETE" }), { success: "Removed", onDone: () => setDel(null) });
  const [f, setF] = useState(venue.settings.security);
  const save = useSaveVenue({ success: "Security saved" });
  const staff = q.data?.staff ?? [];
  return (
    <div className="grid gap-5">
      <Card title="Staff" hint="Each person unlocks the till with their own PIN, so every order, void and payment shows who did it. Managers and owners approve the sensitive things.">
        {!staff.length ? (
          <p className="rounded-[14px] bg-surface-2 p-4 text-[13px] text-muted">No staff yet — anyone signed in can use the till without a PIN. Add people to turn on the lock screen and approvals.</p>
        ) : (
          <ul className="divide-y divide-border rounded-[14px] border border-border">
            {staff.map((s) => (
              <li key={s.id} className={cx("flex items-center gap-3 px-3 py-2.5", !s.active && "opacity-50")}>
                <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[14px] font-semibold">{s.name}</b>
                  <span className="text-[12px] text-muted">
                    {cap(s.role)} · {ROLE_HINT[s.role]}
                    {s.lastSeenAt ? ` · last in ${new Date(s.lastSeenAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                  </span>
                </span>
                {(s.role === "owner" || s.role === "manager") && <Badge tone="accent">Approver</Badge>}
                <Menu
                  label={`Actions for ${s.name}`}
                  trigger={(p) => (
                    <button {...p} aria-label={`Actions for ${s.name}`} type="button" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                  items={[
                    { label: "Edit or reset PIN", icon: <Pencil className="size-4" />, onSelect: () => setEdit(s) },
                    { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDel(s) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <Button className="justify-self-start" icon={<UserPlus className="size-4" />} onClick={() => setEdit({ role: "waiter", active: true })}>
          Add staff
        </Button>
      </Card>
      <Card title="Security" hint="These apply once at least one staff member is set up.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lock after idle (minutes)" hint="0 = never. Staff can always lock by hand.">{(a) => <Input {...a} type="number" min={0} max={240} value={f.autoLockMinutes} onChange={(e) => setF({ ...f, autoLockMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} />}</Field>
          <Field label="Discounts above (%) need a manager">{(a) => <Input {...a} type="number" min={0} max={100} value={f.discountLimitPct} onChange={(e) => setF({ ...f, discountLimitPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />}</Field>
        </div>
        <Toggle checked={f.voidNeedsApproval} onChange={(v) => setF({ ...f, voidNeedsApproval: v })} label="Cancelling items sent to the kitchen needs a manager" />
        <Toggle checked={f.compNeedsApproval} onChange={(v) => setF({ ...f, compNeedsApproval: v })} label="Making items complimentary needs a manager" />
        <p className="text-[12px] text-subtle">Paying cash out of the till always needs a manager. The lock screen protects this device&apos;s screen; the account behind it stays signed in.</p>
        <SaveBar busy={save.isPending} onSave={() => save.mutate({ settings: { security: f } })} />
      </Card>
      {edit && <StaffDialog init={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Remove ${del?.name}?`} description="They can no longer unlock the till. Their name stays on past orders." confirmLabel="Remove" />
    </div>
  );
}

function StaffDialog({ init, onClose }: { init: Partial<Staff>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", role: init.role ?? "waiter", active: init.active ?? true, pin: "" });
  const ok = !!f.name.trim() && (init.id ? !f.pin || /^\d{4,6}$/.test(f.pin) : /^\d{4,6}$/.test(f.pin));
  const save = useHAction<void>(() => ({ path: init.id ? `staff/${init.id}` : "staff", method: init.id ? "PUT" : "POST", body: { name: f.name, role: f.role, active: f.active, ...(f.pin ? { pin: f.pin } : {}) } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "Add staff"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} autoFocus />}</Field>
        <Field label="Role" hint={ROLE_HINT[f.role]}>
          {(a) => (
            <Select {...a} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {cap(r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={init.id ? "New PIN (leave blank to keep)" : "PIN"} hint="4 to 6 digits, known only to them.">{(a) => <Input {...a} type="password" inputMode="numeric" autoComplete="new-password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} />}</Field>
        <div className="flex items-end pb-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Can unlock the till" />
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-subtle sm:col-span-2">
          <KeyRound className="size-3.5" /> PINs are stored hashed — nobody can read them back, so a forgotten PIN is reset here.
        </p>
      </div>
    </Dialog>
  );
}

function PosTab() {
  const { venue } = useH();
  const [f, setF] = useState({ ...venue.settings.pos, fee: venue.settings.pos.deliveryFee ? toMajor(venue.settings.pos.deliveryFee) : "" });
  const save = useSaveVenue({ success: "POS saved" });
  return (
    <div className="grid gap-5">
      <Card title="Order types" hint="Which kinds of orders the POS takes.">
        <Toggle checked={f.dineIn} onChange={(v) => setF({ ...f, dineIn: v })} label="Dine-in at tables" />
        <Toggle checked={f.takeaway} onChange={(v) => setF({ ...f, takeaway: v })} label="Takeaway & counter" />
        <Toggle checked={f.delivery} onChange={(v) => setF({ ...f, delivery: v })} label="Delivery" />
        {f.delivery && <Field label="Delivery fee" hint="Added to delivery bills, with GST. Blank = free.">{(a) => <Input {...a} inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} placeholder="0" />}</Field>}
      </Card>
      <Card title="Till">
        <Toggle checked={f.askCovers} onChange={(v) => setF({ ...f, askCovers: v })} label="Ask how many guests (covers) at tables" />
        <Toggle checked={f.roundOff} onChange={(v) => setF({ ...f, roundOff: v })} label="Round bills to the nearest whole rupee" />
        <Toggle checked={f.requireShift} onChange={(v) => setF({ ...f, requireShift: v })} label="Only take cash while a till session is open" />
      </Card>
      <SaveBar busy={save.isPending} onSave={() => save.mutate({ settings: { pos: { dineIn: f.dineIn, takeaway: f.takeaway, delivery: f.delivery, deliveryFee: toMinor(f.fee), askCovers: f.askCovers, roundOff: f.roundOff, requireShift: f.requireShift } } })} />
    </div>
  );
}

function LoyaltyTab() {
  const { venue } = useH();
  const money = useMoney();
  const [l, setL] = useState(venue.settings.loyalty);
  const [r, setR] = useState(venue.settings.receipt);
  const save = useSaveVenue({ success: "Saved" });
  const earned = Math.floor(100_000 / 10_000) * l.pointsPer100;
  return (
    <div className="grid gap-5">
      <Card title="Loyalty points" hint="Guests earn points on paid bills (found by phone) and spend them at the till.">
        <Toggle checked={l.enabled} onChange={(v) => setL({ ...l, enabled: v })} label="Loyalty points" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`Points per ${money(10_000)}`}>{(a) => <Input {...a} type="number" min={0} max={100} value={l.pointsPer100} onChange={(e) => setL({ ...l, pointsPer100: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />}</Field>
          <Field label="One point is worth" hint="in paise — 100 = ₹1">{(a) => <Input {...a} type="number" min={1} max={10000} value={l.pointValue} onChange={(e) => setL({ ...l, pointValue: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
          <Field label="Spend from (points)">{(a) => <Input {...a} type="number" min={0} value={l.minRedeem} onChange={(e) => setL({ ...l, minRedeem: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
        </div>
        <p className="text-[12.5px] text-muted">
          A {money(100_000)} bill earns {earned} points, worth {money(earned * l.pointValue)} next time — {((l.pointsPer100 * l.pointValue) / 100).toFixed(1)}% back.
        </p>
      </Card>
      <Card title="Receipt" hint="Printed on every bill.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Header line" className="sm:col-span-2">{(a) => <Input {...a} value={r.header} onChange={(e) => setR({ ...r, header: e.target.value })} maxLength={200} placeholder="A unit of Saffron Hospitality Pvt Ltd" />}</Field>
          <Field label="Address" className="sm:col-span-2">{(a) => <Input {...a} value={r.address} onChange={(e) => setR({ ...r, address: e.target.value })} maxLength={200} />}</Field>
          <Field label="Phone">{(a) => <Input {...a} value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} maxLength={30} />}</Field>
          <Field label="GSTIN">{(a) => <Input {...a} value={r.gstin} onChange={(e) => setR({ ...r, gstin: e.target.value.toUpperCase() })} maxLength={15} />}</Field>
          <Field label="FSSAI licence">{(a) => <Input {...a} value={r.fssai} onChange={(e) => setR({ ...r, fssai: e.target.value })} maxLength={20} />}</Field>
          <Field label="Footer">{(a) => <Input {...a} value={r.footer} onChange={(e) => setR({ ...r, footer: e.target.value })} maxLength={200} />}</Field>
        </div>
      </Card>
      <SaveBar busy={save.isPending} onSave={() => save.mutate({ settings: { loyalty: l, receipt: r } })} />
    </div>
  );
}

function ReservationsTab() {
  const { venue } = useH();
  const [f, setF] = useState(venue.settings.reservations);
  const save = useSaveVenue({ success: "Saved" });
  return (
    <div className="grid gap-5">
      <Card title="Reservations" hint={`Guests request a table at /r/${venue.token} — it arrives on the Reservations board for you to confirm.`}>
        <Toggle checked={f.online} onChange={(v) => setF({ ...f, online: v })} label="Take reservation requests online" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Taking reservations from">{(a) => <Input {...a} type="time" value={f.openFrom} onChange={(e) => setF({ ...f, openFrom: e.target.value })} />}</Field>
          <Field label="Until">{(a) => <Input {...a} type="time" value={f.openTo} onChange={(e) => setF({ ...f, openTo: e.target.value })} />}</Field>
          <Field label="A table is held for (minutes)">{(a) => <Input {...a} type="number" min={15} max={480} step={15} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Math.max(15, Number(e.target.value) || 90) })} />}</Field>
          <Field label="Largest party online">{(a) => <Input {...a} type="number" min={1} max={100} value={f.maxParty} onChange={(e) => setF({ ...f, maxParty: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        </div>
      </Card>
      <SaveBar busy={save.isPending} onSave={() => save.mutate({ settings: { reservations: f } })} />
    </div>
  );
}

type Rule = HorecaSettings["pricing"]["rules"][number];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function OffersTab() {
  const { venue } = useH();
  const menu = useHQuery<{ categories: { id: string; name: string }[] }>("menu");
  const [rules, setRules] = useState<Rule[]>(venue.settings.pricing.rules);
  const save = useSaveVenue({ success: "Offers saved" });
  const set = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cats = menu.data?.categories ?? [];
  return (
    <div className="grid gap-5">
      <Card title="Happy hours & timed offers" hint="A percentage off chosen categories at chosen times — applied when items are ordered and shown on the bill. The best matching offer wins.">
        {!rules.length && <p className="text-[13px] text-muted">No offers yet.</p>}
        {rules.map((r, i) => (
          <div key={r.id} className={cx("grid gap-3 rounded-[16px] border border-border p-4", !r.active && "opacity-60")}>
            <div className="grid grid-cols-[1fr_110px_auto] items-end gap-2">
              <Field label="Name">{(a) => <Input {...a} value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} />}</Field>
              <Field label="% off">{(a) => <Input {...a} type="number" min={1} max={100} value={r.pct} onChange={(e) => set(i, { pct: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />}</Field>
              <button type="button" aria-label="Remove offer" onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mb-1 grid size-8 place-items-center rounded-full text-muted hover:text-danger">
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" hint="Blank = all day">{(a) => <Input {...a} type="time" value={r.from} onChange={(e) => set(i, { from: e.target.value })} />}</Field>
              <Field label="Until">{(a) => <Input {...a} type="time" value={r.to} onChange={(e) => set(i, { to: e.target.value })} />}</Field>
            </div>
            <div>
              <p className="mb-1.5 text-[12.5px] font-medium">Days {!r.days.length && <span className="font-normal text-muted">· every day</span>}</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, n) => {
                  const on = r.days.includes(n);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set(i, { days: on ? r.days.filter((x) => x !== n) : [...r.days, n] })} className={cx("h-8 w-11 rounded-full border text-[12.5px] font-medium", on ? "border-fg bg-fg text-bg" : "border-border")}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12.5px] font-medium">Categories {!r.categoryIds.length && <span className="font-normal text-muted">· the whole menu</span>}</p>
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => {
                  const on = r.categoryIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => set(i, { categoryIds: on ? r.categoryIds.filter((x) => x !== c.id) : [...r.categoryIds, c.id] })} className={cx("h-8 rounded-full border px-3 text-[12.5px]", on ? "border-fg bg-fg text-bg" : "border-border")}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <Toggle checked={r.active} onChange={(v) => set(i, { active: v })} label="Running" />
          </div>
        ))}
        <Button className="justify-self-start" icon={<Plus className="size-4" />} disabled={rules.length >= 20} onClick={() => setRules([...rules, { id: crypto.randomUUID().slice(0, 8), name: "Happy hour", pct: 20, days: [], from: "17:00", to: "19:00", categoryIds: [], active: true }])}>
          Add an offer
        </Button>
      </Card>
      <SaveBar busy={save.isPending} disabled={rules.some((r) => !r.name.trim())} onSave={() => save.mutate({ settings: { pricing: { rules } } })} />
    </div>
  );
}

const SECTION_INFO: [keyof HorecaSettings["sections"], string, string][] = [
  ["pos", "POS", "The full-screen till for dine-in, takeaway and delivery"],
  ["reservations", "Reservations", "Bookings, the waitlist and online requests"],
  ["inventory", "Kitchen stock", "Ingredients, recipes, purchases and counts"],
  ["bar", "Bar inventory", "Bottles, pours and closing counts"],
  ["guests", "Guests & loyalty", "Regulars, points and feedback"],
  ["rooms", "Rooms", "Bookings, folios and housekeeping"],
  ["valet", "Valet parking", "Tickets, pre-bookings and car requests"],
];

function SectionsTab() {
  const { venue } = useH();
  const [s, setS] = useState(venue.settings.sections);
  const save = useSaveVenue({ success: "Sections saved" });
  return (
    <div className="grid gap-5">
      <Card title="What this venue uses" hint="Hide what you don't need — a café can switch off rooms, bar and valet. Nothing is deleted; switch back on any time. Floor, kitchen, menu, QR, till, reports and settings are always here.">
        {SECTION_INFO.map(([k, label, hint]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span>
              <b className="block text-[14px] font-medium">{label}</b>
              <span className="text-[12.5px] text-muted">{hint}</span>
            </span>
            <Switch checked={s[k]} onChange={(v) => setS({ ...s, [k]: v })} label={label} />
          </div>
        ))}
      </Card>
      <SaveBar busy={save.isPending} onSave={() => save.mutate({ settings: { sections: s } })} />
    </div>
  );
}
