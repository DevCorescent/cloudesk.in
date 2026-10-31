"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Field, IconButton, Input, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { DAYS, type Day, type WeeklyHours } from "@/lib/bookings/slots";
import { MoneyInput, Panel, storeApi, SubHeader, useMoney, useStoreCtx, useStoreQuery } from "./shared";

type Service = { id: string; name: string; description: string; durationMin: number; price: number; payment: "none" | "full"; capacity: number; bufferMin: number; active: boolean; sort: number };
type Booking = { id: string; serviceName: string; startsAt: string; endsAt: string; name: string; email: string; phone: string; notes: string; status: string; amount: number; currency: string; paid: boolean; paymentMethod: string };
type Settings = { timezone: string; hours: WeeklyHours; slotStepMin: number; minNoticeHours: number; maxDaysAhead: number; closedDates: string[]; cancelHours: number };
type Data = { bookings: Booking[]; services: Service[]; settings: Settings };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "accent" }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  pending_payment: { label: "Awaiting payment", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  completed: { label: "Completed", tone: "accent" },
  no_show: { label: "No-show", tone: "danger" },
};
const DAY_LABEL: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];

export function BookingsView() {
  const { liveUrl } = useStoreCtx();
  const [tab, setTab] = useState<"calendar" | "services" | "availability">("calendar");
  const q = useStoreQuery<Data>("bookings");
  return (
    <div>
      <SubHeader
        title="Bookings"
        description="Let customers book appointments or classes on your site, with optional online payment."
        actions={liveUrl && <ButtonLink href={`${liveUrl}/book`} external icon={<ExternalLink className="size-3.5" />}>Booking page</ButtonLink>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "calendar", label: "Upcoming" }, { value: "services", label: "Services" }, { value: "availability", label: "Opening hours" }]} />
      <div className="mt-4">
        {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : tab === "calendar" ? <Calendar data={q.data} now={q.dataUpdatedAt} onServices={() => setTab("services")} /> : tab === "services" ? <Services services={q.data.services} /> : <Availability key={JSON.stringify(q.data.settings)} settings={q.data.settings} />}
      </div>
      <p className="mt-6 text-xs text-muted">
        Link to <code className="rounded bg-surface-2 px-1">/book</code> from your site (for example in the navigation or a button) so customers can find it.
      </p>
    </div>
  );
}

function Calendar({ data, now, onServices }: { data: Data; now: number; onServices: () => void }) {
  const { projectId, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [cancel, setCancel] = useState<Booking | null>(null);
  const act = useMutation({
    mutationFn: (v: { id: string; action: string; reason?: string }) => api(storeApi(projectId, `bookings/${v.id}`), { method: "POST", body: { action: v.action, reason: v.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "bookings"] });
      setCancel(null);
    },
    onError: (e) => toast({ tone: "error", title: "Could not update", description: errorMessage(e) }),
  });
  if (!data.services.length) return <Card><EmptyState icon={<CalendarDays className="size-5" />} title="Add your first service" description="A service is something customers can book, like “Haircut (45 min)” or “Yoga class”." action={<Button variant="primary" onClick={onServices}>Add a service</Button>} /></Card>;
  const tz = data.settings.timezone;
  const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const groups = new Map<string, Booking[]>();
  for (const b of data.bookings) groups.set(day(b.startsAt), [...(groups.get(day(b.startsAt)) ?? []), b]);
  if (!data.bookings.length) return <Card><EmptyState icon={<CalendarDays className="size-5" />} title="No bookings in the next month" description="New bookings appear here and are emailed to your store contact address." /></Card>;
  // Judged as of the last fetch, which keeps rendering pure.
  const past = (b: Booking) => new Date(b.startsAt).getTime() < now;
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([d, list]) => (
        <section key={d}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{d}</h2>
          <Card className="divide-y divide-border">
            {list.map((b) => (
              <div key={b.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[13px]">
                <div className="w-24 shrink-0 tabular-nums">
                  <p className="font-semibold">{time(b.startsAt)}</p>
                  <p className="text-xs text-muted">to {time(b.endsAt)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {b.serviceName} <Badge tone={STATUS[b.status]?.tone ?? "neutral"}>{STATUS[b.status]?.label ?? b.status}</Badge>
                  </p>
                  <p className="text-muted">
                    {b.name} · <a className="hover:underline" href={`mailto:${b.email}`}>{b.email}</a>
                    {b.phone && (
                      <>
                        {" "}
                        · <a className="hover:underline" href={`tel:${b.phone}`}>{b.phone}</a>
                      </>
                    )}
                  </p>
                  {b.notes && <p className="mt-1 text-xs whitespace-pre-wrap">“{b.notes}”</p>}
                  {b.amount > 0 && <p className="mt-1 text-xs text-muted">{money(b.amount)} · {b.paid ? "paid" : b.paymentMethod === "none" ? "pay at visit" : "not paid"}</p>}
                </div>
                {can("store:orders") && !["cancelled"].includes(b.status) && (
                  <div className="flex flex-wrap gap-1">
                    {b.amount > 0 && !b.paid && b.paymentMethod === "none" && <Button size="sm" onClick={() => act.mutate({ id: b.id, action: "paid_at_visit" })}>Paid</Button>}
                    {past(b) && b.status === "confirmed" && (
                      <>
                        <Button size="sm" onClick={() => act.mutate({ id: b.id, action: "completed" })}>Completed</Button>
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: b.id, action: "no_show" })}>No-show</Button>
                      </>
                    )}
                    {!past(b) && <Button size="sm" variant="ghost" onClick={() => setCancel(b)}>Cancel</Button>}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </section>
      ))}
      <ConfirmDialog
        open={!!cancel}
        onClose={() => setCancel(null)}
        onConfirm={() => cancel && act.mutate({ id: cancel.id, action: "cancel" })}
        loading={act.isPending}
        destructive
        title="Cancel this booking?"
        description={cancel?.paid && cancel.paymentMethod !== "none" ? "The customer is emailed. They paid online — refund them from your payment provider's dashboard." : "The customer is emailed that their booking was cancelled, and the time opens up again."}
        confirmLabel="Cancel booking"
      />
    </div>
  );
}

function Services({ services }: { services: Service[] }) {
  const { projectId, store, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Service> | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: (s: Partial<Service>) => api(storeApi(projectId, s.id ? `booking-services/${s.id}` : "booking-services"), { method: s.id ? "PUT" : "POST", body: { name: s.name, description: s.description ?? "", durationMin: s.durationMin, price: s.price ?? 0, payment: s.payment ?? "none", capacity: s.capacity ?? 1, bufferMin: s.bufferMin ?? 0, active: s.active ?? true, sort: s.sort ?? 0 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "bookings"] });
      setEdit(null);
      setErrors({});
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `booking-services/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "bookings"] });
      setEdit(null);
    },
  });
  const editable = can("store:manage");
  return (
    <div>
      {editable && (
        <div className="mb-3 flex justify-end">
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ name: "", durationMin: 60, price: 0, payment: "none", capacity: 1, bufferMin: 0, active: true })}>
            Add service
          </Button>
        </div>
      )}
      {services.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="size-5" />} title="No services yet" /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {s.name} {!s.active && <Badge>Hidden</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {s.durationMin} min · {s.price ? money(s.price) : "Free"}
                    {s.price > 0 && (s.payment === "full" ? " · paid online" : " · pay at visit")}
                    {s.capacity > 1 && ` · ${s.capacity} per slot`}
                  </p>
                </div>
                {editable && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}
              </div>
              {s.description && <p className="mt-2 text-[13px] text-muted">{s.description}</p>}
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Dialog
          open
          onClose={() => setEdit(null)}
          title={edit.id ? "Edit service" : "New service"}
          footer={
            <>
              {edit.id && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(edit.id!)}>Delete</Button>}
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} disabled={!edit.name?.trim()} onClick={() => save.mutate(edit)}>
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Name">{(a) => <Input {...a} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={100} placeholder="Haircut" autoFocus />}</Field>
            <Field label="Description (optional)">{(a) => <Textarea {...a} rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={1000} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Length (minutes)">{(a) => <Input {...a} type="number" min={5} step={5} value={edit.durationMin ?? 60} onChange={(e) => setEdit({ ...edit, durationMin: Math.max(5, Math.trunc(Number(e.target.value) || 5)) })} />}</Field>
              <Field label="Price" error={errors.price?.[0]}>{(a) => <MoneyInput {...a} value={edit.price ?? 0} onChange={(v) => setEdit({ ...edit, price: v ?? 0 })} currency={store.currency} />}</Field>
              <Field label="Payment">
                {(a) => (
                  <Select {...a} value={edit.payment ?? "none"} onChange={(e) => setEdit({ ...edit, payment: e.target.value as Service["payment"] })}>
                    <option value="none">Pay at the visit</option>
                    <option value="full">Pay online when booking</option>
                  </Select>
                )}
              </Field>
              <Field label="People per time slot" hint="1 for appointments; more for classes.">{(a) => <Input {...a} type="number" min={1} value={edit.capacity ?? 1} onChange={(e) => setEdit({ ...edit, capacity: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />}</Field>
              <Field label="Break after (minutes)" hint="Time to tidy up before the next booking.">{(a) => <Input {...a} type="number" min={0} step={5} value={edit.bufferMin ?? 0} onChange={(e) => setEdit({ ...edit, bufferMin: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />}</Field>
            </div>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              Bookable on your site
              <Switch checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="Bookable" />
            </label>
            {edit.payment === "full" && <p className="text-xs text-muted">Online payment uses the providers you connected under Payments (Razorpay, Stripe or PayPal).</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Availability({ settings }: { settings: Settings }) {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState(settings);
  const [closed, setClosed] = useState("");
  const save = useMutation({
    mutationFn: () => api(storeApi(projectId, "booking-settings"), { method: "PUT", body: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "bookings"] });
      toast({ tone: "success", title: "Opening hours saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const setDay = (d: Day, v: [string, string][]) => setS({ ...s, hours: { ...s.hours, [d]: v } });
  const order: Day[] = [...DAYS.slice(1), DAYS[0]];
  return (
    <fieldset disabled={!can("store:manage")} className="space-y-4">
      <Panel title="Weekly hours">
        <div className="space-y-2">
          {order.map((d) => {
            const ranges = s.hours[d] ?? [];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 text-[13px]">
                <label className="flex w-36 items-center gap-2">
                  <Switch checked={ranges.length > 0} onChange={(v) => setDay(d, v ? [["09:00", "17:00"]] : [])} label={`Open on ${DAY_LABEL[d]}`} />
                  {DAY_LABEL[d]}
                </label>
                {ranges.length === 0 ? (
                  <span className="text-muted">Closed</span>
                ) : (
                  ranges.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <Input aria-label={`${DAY_LABEL[d]} opens`} type="time" value={r[0]} onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} className="w-28" />–
                      <Input aria-label={`${DAY_LABEL[d]} closes`} type="time" value={r[1]} onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="w-28" />
                      {ranges.length > 1 && <IconButton size="sm" label="Remove hours" icon={<X className="size-3.5" />} onClick={() => setDay(d, ranges.filter((_, j) => j !== i))} />}
                    </span>
                  ))
                )}
                {ranges.length > 0 && ranges.length < 4 && (
                  <Button size="sm" variant="ghost" onClick={() => setDay(d, [...ranges, ["14:00", "18:00"]])}>
                    + Split shift
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="Rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone">
            {(a) => (
              <Select {...a} value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
                {[...new Set([s.timezone, ...ZONES])].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Start times every (minutes)">{(a) => <Input {...a} type="number" min={5} step={5} value={s.slotStepMin} onChange={(e) => setS({ ...s, slotStepMin: Math.max(5, Math.trunc(Number(e.target.value) || 5)) })} />}</Field>
          <Field label="Minimum notice (hours)" hint="How soon before a time people can book it.">{(a) => <Input {...a} type="number" min={0} value={s.minNoticeHours} onChange={(e) => setS({ ...s, minNoticeHours: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />}</Field>
          <Field label="Book up to (days ahead)">{(a) => <Input {...a} type="number" min={1} value={s.maxDaysAhead} onChange={(e) => setS({ ...s, maxDaysAhead: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />}</Field>
          <Field label="Online cancellation until (hours before)">{(a) => <Input {...a} type="number" min={0} value={s.cancelHours} onChange={(e) => setS({ ...s, cancelHours: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />}</Field>
        </div>
      </Panel>
      <Panel title="Closed dates" description="Holidays and days off; no bookings on these dates.">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.closedDates.map((d) => (
            <span key={d} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface-2 pr-1 pl-2.5 text-[13px] tabular-nums">
              {d}
              <button type="button" aria-label={`Remove ${d}`} className="rounded-full p-0.5 text-muted hover:bg-surface-3" onClick={() => setS({ ...s, closedDates: s.closedDates.filter((x) => x !== d) })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input aria-label="Add a closed date" type="date" value={closed} onChange={(e) => setClosed(e.target.value)} className="h-7 w-40" />
          <Button size="sm" disabled={!closed} onClick={() => { setS({ ...s, closedDates: [...new Set([...s.closedDates, closed])].sort() }); setClosed(""); }}>
            Add
          </Button>
        </div>
      </Panel>
      <div className="flex justify-end">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </fieldset>
  );
}
