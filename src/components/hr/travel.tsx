"use client";

// Expense & travel: trips (asked for, approved, an advance paid, claims added,
// settled), and company cards (statements brought in, each spend explained as a
// claim or marked personal and repaid).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CreditCard, Plane, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { Dialog, Tabs } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { TRIP_MODES, tripDays } from "@/lib/hr/model";
import { ClaimDialog, type Claim } from "./payroll";
import { Avatar, Empty, Section, Stat, StatusPill, fmt, hrApi, inr, toPaise, todayIst, useHr, useHrAction, useHrQuery } from "./shared";

type Trip = { id: string; number: string; employeeId: string; name: string; purpose: string; destination: string; international: boolean; departOn: string; returnOn: string; mode: string; estimate: number; advance: number; advancePaidOn: string | null; projectId: string | null; notes: string; status: string; decisionNote: string; settledOn: string | null; claimed: number; balance: number; canDecide: boolean };
type Account = { id: string; name: string; code: string; subtype: string };
const dm = (d: string | null) => fmt(d, { day: "numeric", month: "short" });

/** Bank and cash accounts to pay from, for those who run payroll. */
function useCashAccounts() {
  const { orgId, meta } = useHr();
  const q = useQuery({ queryKey: ["accounts", orgId, "meta"], queryFn: () => api<{ accounts: Account[] }>(`/api/v1/orgs/${orgId}/accounts/meta`), enabled: meta.me.payroll, retry: false });
  return (q.data?.accounts ?? []).filter((a) => a.subtype === "bank" || a.subtype === "cash");
}

// ── Trips ───────────────────────────────────────────────────────────────────

export function TripsView() {
  const { meta, go } = useHr();
  const approver = meta.me.payroll || meta.me.isManager || meta.me.manage;
  const [tab, setTab] = useState<"approve" | "all" | "mine">(approver ? "approve" : "mine");
  const [adding, setAdding] = useState(false);
  const home = useHrQuery<{ waiting: number; away: number; toSettle: number; advancesOut: number; toExplain: number }>("travel");
  const q = useHrQuery<{ trips: Trip[] }>(`trips${tab === "mine" ? "?mine=1" : ""}`);
  const rows = (q.data?.trips ?? []).filter((t) => tab !== "approve" || t.canDecide || (meta.me.payroll && t.status === "approved"));
  return (
    <div>
      <PageHeader
        title="Trips"
        description="Business travel: approved before it starts, an advance if needed, and settled against what's claimed."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="trips" columns={[{ key: "number", label: "Trip" }, { key: "name", label: "Person" }, { key: "destination", label: "Destination" }, { key: "purpose", label: "Purpose" }, { key: "departOn", label: "Depart" }, { key: "returnOn", label: "Return" }, { key: "mode", label: "Mode" }, { key: "estimate", label: "Estimate", money: true }, { key: "advance", label: "Advance", money: true }, { key: "claimed", label: "Claimed", money: true }, { key: "balance", label: "Balance", money: true }, { key: "status", label: "Status" }]} rows={q.data?.trips ?? []} />
            {meta.me.employeeId && <Button size="sm" variant="primary" icon={<Plane className="size-4" />} onClick={() => setAdding(true)}>New trip</Button>}
          </div>
        }
      />
      {home.data && approver && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Waiting for you" value={String(home.data.waiting)} />
          <Stat label="Away now" value={String(home.data.away)} />
          <Stat label="Back, not settled" value={String(home.data.toSettle)} tone={home.data.toSettle ? "warn" : undefined} />
          <Stat label="Advances out" value={inr(home.data.advancesOut)} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[...(approver ? [{ value: "approve" as const, label: "To act on" }, { value: "all" as const, label: "All trips" }] : []), ...(meta.me.employeeId ? [{ value: "mine" as const, label: "Mine" }] : [])]} />
      {!q.data ? (
        <Skeleton className="h-40 rounded-[20px]" />
      ) : !rows.length ? (
        <Empty>{tab === "approve" ? "Nothing waiting." : "No trips yet."}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 shadow-sm">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/hr/trips/${t.id}`} className="flex flex-wrap items-center gap-3 py-3 text-[13px] hover:opacity-80">
                <Avatar name={t.name} size={32} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px]">{t.destination} <span className="font-normal text-muted">· {t.number}</span></b>
                  <span className="text-[12.5px] text-muted">{t.name} · {dm(t.departOn)} – {dm(t.returnOn)} · {t.purpose}</span>
                </span>
                {t.advance > 0 && <span className="text-[12px] text-muted">{t.advancePaidOn ? "Advance paid" : "Advance"} {inr(t.advance)}</span>}
                <StatusPill status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <TripDialog onClose={() => setAdding(false)} onSaved={(id) => go(`trips/${id}`)} />}
    </div>
  );
}

function TripDialog({ trip, onClose, onSaved }: { trip?: Trip; onClose: () => void; onSaved?: (id: string) => void }) {
  const [f, setF] = useState({ purpose: trip?.purpose ?? "", destination: trip?.destination ?? "", international: trip?.international ?? false, departOn: trip?.departOn ?? todayIst(), returnOn: trip?.returnOn ?? todayIst(), mode: trip?.mode ?? "Flight", estimate: trip?.estimate ? String(trip.estimate / 100) : "", advance: trip?.advance ? String(trip.advance / 100) : "", notes: trip?.notes ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useHrAction<void, { trip: Trip }>(() => ({ path: trip ? `trips/${trip.id}` : "trips", method: trip ? "PUT" : "POST", body: { ...f, estimate: toPaise(f.estimate), advance: toPaise(f.advance), projectId: trip?.projectId ?? null } }), { success: "Trip saved as a draft", onDone: (r) => (onClose(), onSaved?.(r.trip.id)) });
  const days = f.returnOn >= f.departOn ? tripDays(f.departOn, f.returnOn) : 0;
  return (
    <Dialog open onClose={onClose} title={trip ? `Edit ${trip.number}` : "New trip"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.purpose.trim() || !f.destination.trim() || !days} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destination">{(a) => <Input {...a} autoFocus value={f.destination} onChange={set("destination")} placeholder="e.g. Pune" />}</Field>
        <Field label="Travelling by">{(a) => <Select {...a} value={f.mode} onChange={set("mode")}>{TRIP_MODES.map((m) => <option key={m}>{m}</option>)}</Select>}</Field>
        <Field label="Purpose" className="sm:col-span-2">{(a) => <Input {...a} value={f.purpose} onChange={set("purpose")} placeholder="e.g. Client workshop" />}</Field>
        <Field label="Leaving">{(a) => <Input {...a} type="date" value={f.departOn} onChange={set("departOn")} />}</Field>
        <Field label="Back" hint={days ? `${days} day${days === 1 ? "" : "s"}` : "Before leaving"}>{(a) => <Input {...a} type="date" value={f.returnOn} onChange={set("returnOn")} />}</Field>
        <Field label="Estimated cost (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.estimate} onChange={set("estimate")} />}</Field>
        <Field label="Advance needed (₹)" hint="Paid before you go, settled after">{(a) => <Input {...a} inputMode="decimal" value={f.advance} onChange={set("advance")} />}</Field>
        <div className="sm:col-span-2"><Switch checked={f.international} onChange={(v) => setF({ ...f, international: v })} label="Outside India" /></div>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={set("notes")} />}</Field>
      </div>
    </Dialog>
  );
}

type TripDetail = { trip: Trip; claims: Claim[]; balance: { claimed: number; advance: number; net: number; waiting: number }; perDiem: number; can: { edit: boolean; decide: boolean; pay: boolean; claim: boolean } };

export function TripPage({ id }: { id: string }) {
  const { meta, go } = useHr();
  const q = useHrQuery<TripDetail>(`trips/${id}`);
  const accounts = useCashAccounts();
  const [editing, setEditing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [paying, setPaying] = useState<"advance" | "settle" | null>(null);
  const act = useHrAction<{ path: string; body?: unknown }>((b) => ({ path: `trips/${id}/${b.path}`, body: b.body ?? {} }), { success: "Done" });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { trip: t, claims, balance: b, can } = q.data;
  return (
    <div>
      <button type="button" onClick={() => go("trips")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" />Trips</button>
      <PageHeader
        title={`${t.destination} · ${t.number}`}
        description={`${t.name} · ${dm(t.departOn)} – ${dm(t.returnOn)} (${tripDays(t.departOn, t.returnOn)} days) · ${t.mode}${t.international ? " · abroad" : ""} · ${t.purpose}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={t.status} />
            {can.edit && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {can.edit && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ path: "submit" })}>Send for approval</Button>}
            {can.decide && <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => act.mutate({ path: "decide", body: { approve: false } })}>Decline</Button>}
            {can.decide && <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => act.mutate({ path: "decide", body: { approve: true } })}>Approve trip</Button>}
            {can.pay && t.status === "approved" && t.advance > 0 && !t.advancePaidOn && <Button size="sm" onClick={() => setPaying("advance")}>Pay advance</Button>}
            {can.pay && t.status === "approved" && <Button size="sm" variant="primary" disabled={b.waiting > 0} onClick={() => setPaying("settle")}>Settle trip</Button>}
            {(can.edit || (can.claim && !t.advancePaidOn && !claims.length)) && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: "cancel" })}>Cancel trip</Button>}
          </div>
        }
      />
      {t.decisionNote && t.status === "rejected" && <div className="mb-4"><Notice tone="danger" title="Sent back">{t.decisionNote}</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estimate" value={inr(t.estimate)} />
        <Stat label="Advance" value={inr(t.advance)} sub={t.advancePaidOn ? `paid ${dm(t.advancePaidOn)}` : t.advance ? "not paid yet" : "none asked"} />
        <Stat label="Claimed (approved)" value={inr(b.claimed)} sub={b.waiting ? `${b.waiting} waiting for approval` : undefined} />
        <Stat label={t.status === "settled" ? "Settled" : b.net >= 0 ? "To pay them" : "To come back"} value={inr(Math.abs(t.status === "settled" ? t.balance : b.net))} sub={t.status === "settled" ? dm(t.settledOn) : undefined} />
      </div>
      <Section
        title="Claims on this trip"
        action={
          can.claim ? (
            <span className="flex gap-2">
              {q.data.perDiem > 0 && !claims.some((c) => c.kind === "per_diem" && c.status !== "rejected") && <Button size="sm" onClick={() => act.mutate({ path: "per-diem" })}>Per diem · {inr(q.data.perDiem)}</Button>}
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setClaiming(true)}>Claim</Button>
            </span>
          ) : undefined
        }
      >
        {!claims.length ? (
          <Empty>{t.status === "approved" ? "Add what was spent on this trip. Approved claims are settled against the advance." : "Claims are added once the trip is approved."}</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b className="font-medium">{c.category}</b> <span className="text-muted">· {dm(c.date)}{c.description ? ` · ${c.description}` : ""}</span>
                  {c.flags.length > 0 && <span className="block text-[12px] text-warning">{c.flags.map((x) => x.message).join(". ")}{c.justification ? ` — “${c.justification}”` : ""}</span>}
                </span>
                <b className="tabular-nums">{inr(c.amount)}</b>
                <StatusPill status={c.status} />
              </li>
            ))}
          </ul>
        )}
        {meta.me.payroll && b.waiting > 0 && <p className="mt-3 text-[12px] text-muted">Approve or decline the waiting claims (in Claims) before settling.</p>}
      </Section>
      {editing && <TripDialog trip={t} onClose={() => setEditing(false)} />}
      {claiming && <ClaimDialog tripId={t.id} projectId={t.projectId} onClose={() => setClaiming(false)} />}
      {paying && <PayDialog title={paying === "advance" ? `Pay the ${inr(t.advance)} advance` : b.net === 0 ? "Settle the trip" : b.net > 0 ? `Settle: pay ${inr(b.net)}` : `Settle: ${inr(-b.net)} comes back`} accounts={accounts} needAccount={paying === "advance" || b.net !== 0} onClose={() => setPaying(null)} onPay={(body) => act.mutateAsync({ path: paying === "advance" ? "advance" : "settle", body }).then(() => setPaying(null))} />}
    </div>
  );
}

function PayDialog({ title, accounts, needAccount, onClose, onPay }: { title: string; accounts: Account[]; needAccount: boolean; onClose: () => void; onPay: (b: { accountId: string | null; date: string }) => Promise<unknown> }) {
  const [accountId, setAccount] = useState("");
  const [date, setDate] = useState(todayIst());
  const [busy, setBusy] = useState(false);
  const acc = accountId || accounts[0]?.id || "";
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={needAccount && !acc} onClick={() => (setBusy(true), onPay({ accountId: needAccount ? acc : null, date }).finally(() => setBusy(false)))}>Confirm</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {needAccount && <Field label="Account">{(a) => <Select {...a} value={acc} onChange={(e) => setAccount(e.target.value)}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}</Field>}
        <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-[12px] text-muted">This is posted to your accounts when they next sync.</p>
    </Dialog>
  );
}

// ── Company cards ───────────────────────────────────────────────────────────

type Card = { id: string; employeeId: string; holder: string; name: string; last4: string; active: boolean };
type Txn = { id: string; employeeId: string; holder: string; card: string; date: string; merchant: string; reference: string; amount: number; status: string; claimId: string | null };

export function CardsView() {
  const { meta, orgId } = useHr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "all">("open");
  const txns = useHrQuery<{ txns: Txn[] }>(`card-txns${meta.me.payroll ? "" : "?mine=1"}`);
  const cards = useHrQuery<{ cards: Card[] }>("cards");
  const accounts = useCashAccounts();
  const [explaining, setExplaining] = useState<Txn | null>(null);
  const [repaying, setRepaying] = useState<Txn | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const act = useHrAction<{ id: string; path: string; body?: unknown }>((b) => ({ path: `card-txns/${b.id}/${b.path}`, body: b.body ?? {} }), { success: "Done" });
  const rows = (txns.data?.txns ?? []).filter((t) => tab === "all" || t.status === "open" || t.status === "personal");
  return (
    <div>
      <PageHeader
        title="Company cards"
        description="Spends on company cards, from the card statement. Each one is explained by the cardholder (and approved like a claim) or marked personal and repaid."
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportMenu name="card-spends" columns={[{ key: "date", label: "Date" }, { key: "card", label: "Card" }, { key: "holder", label: "Cardholder" }, { key: "merchant", label: "Merchant" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", money: true }, { key: "status", label: "Status" }]} rows={txns.data?.txns ?? []} />
            {meta.me.payroll && (
              <ImportButton target={target("hr.card_txns")} label="Import statement" onImport={(rows, mode) => api(hrApi(orgId, "card-txns-import"), { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["hr", orgId] })} />
            )}
            {meta.me.payroll && <Button size="sm" icon={<CreditCard className="size-4" />} onClick={() => setAddingCard(true)}>Add card</Button>}
          </div>
        }
      />
      {cards.data && cards.data.cards.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {cards.data.cards.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[12.5px]"><CreditCard className="size-3.5 text-muted" />{c.name} ··{c.last4} <span className="text-muted">{c.holder}</span></span>
          ))}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: "open", label: "To sort out" }, { value: "all", label: "All spends" }]} />
      {!txns.data ? (
        <Skeleton className="h-40 rounded-[20px]" />
      ) : !rows.length ? (
        <Empty>{tab === "open" ? "Nothing to explain." : meta.me.payroll ? "Add a card for each cardholder, then import the card statement (CSV or Excel) — lines are matched to cards by their last four digits." : "No spends on your card yet."}</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface px-4 shadow-sm">
          {rows.map((t) => {
            const mine = t.employeeId === meta.me.employeeId;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px]">{t.merchant || "Card spend"}</b>
                  <span className="text-[12.5px] text-muted">{dm(t.date)} · {t.card} · {t.holder}{t.reference ? ` · ${t.reference}` : ""}</span>
                </span>
                <b className="tabular-nums">{inr(t.amount)}</b>
                <StatusPill status={t.status === "open" ? "to_explain" : t.status} />
                {t.status === "open" && (mine || meta.me.payroll) && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="primary" aria-label={`Explain ${t.merchant}`} onClick={() => setExplaining(t)}>Explain</Button>
                    <Button size="sm" variant="ghost" aria-label={`${t.merchant} was personal`} onClick={() => act.mutate({ id: t.id, path: "personal" })}>Personal</Button>
                  </span>
                )}
                {t.status === "personal" && meta.me.payroll && <Button size="sm" onClick={() => setRepaying(t)}>Repaid</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {explaining && <ClaimDialog txn={explaining} onClose={() => setExplaining(null)} />}
      {repaying && <PayDialog title={`${repaying.holder} repaid ${inr(repaying.amount)}`} accounts={accounts} needAccount onClose={() => setRepaying(null)} onPay={(body) => act.mutateAsync({ id: repaying.id, path: "repaid", body }).then(() => setRepaying(null))} />}
      {addingCard && <CardDialog onClose={() => setAddingCard(false)} />}
    </div>
  );
}

function CardDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useHr();
  const people = meta.people.filter((p) => p.status !== "exited");
  const [f, setF] = useState({ employeeId: people[0]?.id ?? "", name: "", last4: "" });
  const save = useHrAction(() => ({ path: "cards", body: f }), { success: "Card added", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Add a company card" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim() || !/^\d{4}$/.test(f.last4)} loading={save.isPending} onClick={() => save.mutate()}>Add</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cardholder">{(a) => <Select {...a} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        <Field label="Card name">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. HDFC Corporate" />}</Field>
        <Field label="Last four digits" hint="Only these are kept, never the full number">{(a) => <Input {...a} inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} />}</Field>
      </div>
    </Dialog>
  );
}
