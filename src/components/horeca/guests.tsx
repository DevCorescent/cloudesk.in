"use client";

// Guests & loyalty: regulars found by phone, their visits, spend, points and
// history; and what guests said after paying.
import { Gift, MessageSquareHeart, Plus, Search, Star, Users } from "lucide-react";
import { useState } from "react";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, cx, EmptyState, Field, Input, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { METHOD_LABEL, SOURCE_LABEL } from "./bill";
import { Stat, useH, useHAction, useHQuery, useMoney } from "./shared";

type Guest = { id: string; name: string; phone: string; email: string; birthday: string; notes: string; tags: string[]; visits: number; spend: number; points: number; lastVisitAt: string | null };
type Feedback = { id: string; rating: number; comment: string; createdAt: string; orderNo: number | null; guestName: string };

export function GuestsView({ guestId }: { guestId?: string }) {
  const { venue } = useH();
  const money = useMoney();
  const [tab, setTab] = useState<"guests" | "feedback">("guests");
  const [q, setQ] = useState("");
  const list = useHQuery<{ guests: Guest[] }>(`guests?q=${encodeURIComponent(q)}`);
  const fb = useHQuery<{ feedback: Feedback[]; average: number }>("feedback");
  const [open, setOpen] = useState<string | null>(guestId ?? null);
  const [edit, setEdit] = useState<Partial<Guest> | null>(null);
  const guests = list.data?.guests ?? [];
  const loyalty = venue.settings.loyalty;
  return (
    <div>
      <PageHeader
        title="Guests & loyalty"
        description={loyalty.enabled ? `Guests earn ${loyalty.pointsPer100} points per ${money(10_000)} and spend them as ${money(loyalty.pointValue)} a point.` : "Every guest whose phone is taken at the till. Turn on loyalty points in Settings."}
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
            Guest
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Guests" value={guests.length >= 200 ? "200+" : guests.length} sub={q ? "matching" : "on file"} />
        <Stat label="Regulars" value={guests.filter((g) => g.visits >= 3).length} sub="3 or more visits" />
        <Stat label="Points out there" value={guests.reduce((a, g) => a + g.points, 0)} sub={loyalty.enabled ? money(guests.reduce((a, g) => a + g.points, 0) * loyalty.pointValue) : "loyalty is off"} />
        <Stat label="Rating" value={fb.data?.feedback.length ? `${fb.data.average} ★` : "—"} sub={`${fb.data?.feedback.length ?? 0} reviews`} tone={fb.data && fb.data.average >= 4.5 ? "good" : undefined} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        className="mt-5 mb-4"
        tabs={[
          { value: "guests", label: "Guests" },
          { value: "feedback", label: "Feedback" },
        ]}
      />
      {tab === "guests" ? (
        <>
          <div className="relative mb-3 max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search guests" className="!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" />
          </div>
          {!list.data ? (
            <Skeleton className="h-64 rounded-[20px]" />
          ) : !guests.length ? (
            <EmptyState icon={<Users />} title={q ? "No one matches" : "No guests yet"} description="Add a guest's phone on the POS and they're remembered here." />
          ) : (
            <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
              <table className="w-full min-w-[640px] text-[13.5px]">
                <thead className="border-b border-border text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Guest</th>
                    <th className="px-4 py-2.5 text-right font-medium">Visits</th>
                    <th className="px-4 py-2.5 text-right font-medium">Spend</th>
                    {loyalty.enabled && <th className="px-4 py-2.5 text-right font-medium">Points</th>}
                    <th className="px-4 py-2.5 text-right font-medium">Last visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {guests.map((g) => (
                    <tr key={g.id} onClick={() => setOpen(g.id)} className="cursor-pointer hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <b className="font-medium">{g.name || "—"}</b>
                        <span className="ml-2 text-muted tabular-nums">{g.phone}</span>
                        {g.tags.map((t) => (
                          <span key={t} className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">
                            {t}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{g.visits}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(g.spend)}</td>
                      {loyalty.enabled && <td className="px-4 py-2.5 text-right tabular-nums">{g.points}</td>}
                      <td className="px-4 py-2.5 text-right text-muted">{g.lastVisitAt ? new Date(g.lastVisitAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : !fb.data ? (
        <Skeleton className="h-64 rounded-[20px]" />
      ) : !fb.data.feedback.length ? (
        <EmptyState icon={<MessageSquareHeart />} title="No feedback yet" description="After a table pays, its QR menu asks how the meal was. Answers show up here." />
      ) : (
        <ul className="grid gap-2">
          {fb.data.feedback.map((f) => (
            <li key={f.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex" aria-label={`${f.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={cx("size-4", n <= f.rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-border")} />
                  ))}
                </span>
                <span className="text-[12.5px] text-muted">
                  {f.guestName || "Guest"} · order #{f.orderNo} · {new Date(f.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              {f.comment && <p className="mt-2 text-[14px]">“{f.comment}”</p>}
            </li>
          ))}
        </ul>
      )}
      {open && <GuestDrawer id={open} onClose={() => setOpen(null)} onEdit={(g) => setEdit(g)} />}
      {edit && <GuestDialog init={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GuestDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (g: Guest) => void }) {
  const { venue } = useH();
  const money = useMoney();
  const q = useHQuery<{ guest: Guest; orders: { id: string; number: number; status: string; source: string; createdAt: string; payments: { method: string; amount: number }[] }[]; pointsValue: number }>(`guests/${id}`);
  if (!q.data) return null;
  const { guest: g, orders, pointsValue } = q.data;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={g.name || g.phone}
      description={[g.phone, g.email, g.birthday && `Birthday ${g.birthday}`].filter(Boolean).join(" · ")}
      footer={
        <>
          <Button onClick={() => onEdit(g)}>Edit</Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Visits" value={g.visits} />
          <Stat label="Spend" value={money(g.spend)} sub={g.visits ? `${money(Math.round(g.spend / g.visits))} a visit` : undefined} />
          <Stat label="Points" value={venue.settings.loyalty.enabled ? g.points : "—"} sub={venue.settings.loyalty.enabled ? `worth ${money(pointsValue)}` : "loyalty is off"} />
        </div>
        {g.notes && <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-[13px]">📝 {g.notes}</p>}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Gift className="size-4" /> Recent orders
          </p>
          {!orders.length ? (
            <p className="text-[13px] text-muted">No orders yet.</p>
          ) : (
            <ul className="grid gap-1">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">
                  <b>#{o.number}</b>
                  <span className="text-muted">{SOURCE_LABEL[o.source] ?? o.source}</span>
                  <span className="text-muted">{new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  <span className="ml-auto tabular-nums">{o.payments.map((p) => `${METHOD_LABEL[p.method] ?? p.method} ${money(p.amount)}`).join(" · ") || o.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function GuestDialog({ init, onClose }: { init: Partial<Guest>; onClose: () => void }) {
  const [f, setF] = useState({ name: init.name ?? "", phone: init.phone ?? "", email: init.email ?? "", birthday: init.birthday ?? "", notes: init.notes ?? "", tags: (init.tags ?? []).join(", ") });
  const save = useHAction<void>(() => ({ path: init.id ? `guests/${init.id}` : "guests", method: init.id ? "PUT" : "POST", body: { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10) } }), { success: "Saved", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name || init.phone}` : "New guest"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={f.phone.replace(/\D/g, "").length < 7} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} autoFocus />}</Field>
        <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} />}</Field>
        <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={120} />}</Field>
        <Field label="Birthday" hint="DD-MM">{(a) => <Input {...a} value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} maxLength={10} placeholder="14-02" />}</Field>
        <Field label="Tags" hint="Comma separated — VIP, Jain, corporate" className="sm:col-span-2">{(a) => <Input {...a} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} placeholder="Allergic to nuts, prefers the window table" />}</Field>
      </div>
    </Dialog>
  );
}
