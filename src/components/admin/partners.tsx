"use client";

// Admin → Partners: applications to review, every partner with what they've
// brought and earned, payout requests to approve and mark sent, and the
// program's terms (rates per kind of partner, tiers, holds, payouts, tax).
import clsx from "clsx";
import { Eye, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, Segmented, Tabs } from "@/components/ui/overlays";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { date, inr, LEAD_LABEL, PAYOUT_TONE, SOURCE_LABEL, STATE_LABEL, type Commission, type Dashboard, type Lead, type PartnerProfile, type Payout } from "@/components/partners/types";
import { api, errorMessage } from "@/lib/client/api";
import { DEFAULT_PROGRAM, discountText, months, PARTNER_TYPES, pct, TYPE_INFO, type PartnerType, type Program } from "@/lib/partners/program";
import { Section, Stat, useAdmin, useCan, useReauth, useRun } from "./common";

type Row = PartnerProfile & { commissionBps: number | null; customers: number; earned: number };
type List = { stats: { pending: number; approved: number; partners: number; customers: number; revenue: number; earned: number; payoutsOpen: number; payoutsOwed: number; paidOut: number }; rows: Row[]; program: Program };
type Detail = Dashboard & { account: { name: string; email: string } | null; overrides: { commissionBps: number | null; commissionMonths: number | null }; adminNote: string; commissions: Commission[]; payouts: Payout[]; leads: Lead[] };
type QueueRow = Payout & { partner: { id: string; name: string; email: string; type: PartnerType; code: string } };

const STATUS_TONE = { pending: "accent", approved: "success", rejected: "danger", suspended: "warning" } as const;

/** A note typed before an action (the partner sees it for rejections and suspensions). */
function useAsk() {
  const [ask, setAsk] = useState<{ title: string; label: string; required: boolean; confirm: string; danger?: boolean; run: (v: string) => Promise<unknown> } | null>(null);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const ui = ask && (
    <Dialog open onClose={() => setAsk(null)} size="sm" title={ask.title} footer={<><Button onClick={() => setAsk(null)}>Cancel</Button><Button variant={ask.danger ? "danger" : "primary"} loading={busy} disabled={ask.required && v.trim().length < 3} onClick={async () => { setBusy(true); await ask.run(v.trim()); setBusy(false); setAsk(null); }}>{ask.confirm}</Button></>}>
      <Field label={ask.label}>{(a) => <Textarea {...a} value={v} onChange={(e) => setV(e.target.value)} maxLength={500} autoFocus />}</Field>
    </Dialog>
  );
  return { ui, open: (a: NonNullable<typeof ask>) => (setV(""), setAsk(a)) };
}

export function PartnersPanel() {
  const [tab, setTab] = useState<"partners" | "payouts" | "program">(() => (typeof window !== "undefined" && window.location.hash.includes("/payouts") ? "payouts" : typeof window !== "undefined" && window.location.hash.includes("/program") ? "program" : "partners"));
  const list = useAdmin<List>("partners");
  const s = list.data?.stats;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Applications to review" value={s ? s.pending : "—"} tone={s?.pending ? "warning" : undefined} sub={s ? `${s.approved} approved of ${s.partners}` : undefined} />
        <Stat label="Customers from partners" value={s ? s.customers : "—"} sub={s ? `${inr(s.revenue)} paid by them (before tax)` : undefined} />
        <Stat label="Commission earned" value={s ? inr(s.earned) : "—"} sub={s ? `${inr(s.paidOut)} paid out` : undefined} />
        <Stat label="Payouts to process" value={s ? s.payoutsOpen : "—"} tone={s?.payoutsOpen ? "warning" : undefined} sub={s ? `${inr(s.payoutsOwed)} requested` : undefined} />
      </div>
      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); history.replaceState(null, "", t === "partners" ? "#partners" : `#partners/${t}`); }}
        tabs={[{ value: "partners", label: <>Partners{s?.pending ? <Badge tone="accent">{s.pending}</Badge> : null}</> }, { value: "payouts", label: <>Payouts{s?.payoutsOpen ? <Badge tone="warning">{s.payoutsOpen}</Badge> : null}</> }, { value: "program", label: "Program & rates" }]}
      />
      {tab === "partners" && <PartnerList />}
      {tab === "payouts" && <PayoutQueue />}
      {tab === "program" && (list.data ? <ProgramForm program={list.data.program} /> : <Skeleton className="h-96" />)}
    </div>
  );
}

function PartnerList() {
  const [status, setStatus] = useState<"pending" | "approved" | "suspended" | "rejected" | "all">("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(() => (typeof window !== "undefined" ? (/^#partners\/([0-9a-f-]{36})/.exec(window.location.hash)?.[1] ?? null) : null));
  const list = useAdmin<List>(`partners?status=${status}&type=${type}&q=${encodeURIComponent(q)}`);
  return (
    <Section
      title="Partners"
      sub="Applications waiting for review come first. Open one to see the answers, approve it, and set its terms."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "pending", label: "To review" }, { value: "approved", label: "Approved" }, { value: "suspended", label: "Paused" }, { value: "rejected", label: "Declined" }]} />
          <Select aria-label="Kind of partner" className="h-8 w-[170px]" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">Every kind</option>
            {PARTNER_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].name}</option>)}
          </Select>
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" /><Input aria-label="Search partners" className="h-8 w-[200px] pl-8" placeholder="Name, email or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
      }
    >
      <Card className="overflow-x-auto p-0">
        {list.isError ? <div className="p-4"><ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /></div> : !list.data ? <Skeleton className="m-4 h-48" /> : list.data.rows.length === 0 ? <EmptyState className="py-12" title="No partners here" description="Applications from /partners appear here." /> : (
          <table className="w-full min-w-[820px] text-[13px]">
            <thead><tr className="border-b border-border text-left text-[12px] text-muted">{["Partner", "Kind", "Status", "Code", "Customers", "Earned", "Applied"].map((h, i) => <th key={h} className={clsx("px-4 py-2.5 font-medium", i >= 4 && i <= 5 && "text-right")}>{h}</th>)}</tr></thead>
            <tbody>
              {list.data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2" onClick={() => { setOpen(r.id); history.replaceState(null, "", `#partners/${r.id}`); }}>
                  <td className="px-4 py-2.5"><p className="font-medium">{r.name}</p><p className="text-[12px] text-muted">{r.email}{r.city ? ` · ${r.city}` : ""}</p></td>
                  <td className="px-4 py-2.5">{TYPE_INFO[r.type].name}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{r.code}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.customers}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.earned)}</td>
                  <td className="px-4 py-2.5 text-muted">{date(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <PartnerDrawer id={open} onClose={() => { setOpen(null); history.replaceState(null, "", "#partners"); }} />}
    </Section>
  );
}

function PartnerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdmin<Detail>(`partners/${id}`);
  const run = useRun();
  const can = useCan();
  const ask = useAsk();
  const d = q.data;
  const p = d?.partner;
  const write = can("tenants:write");
  const act = (action: string, note?: string) => run(`partners/${id}`, "POST", { action, ...(note !== undefined ? { note } : {}) }, { approve: "Approved — the partner has been emailed", reject: "Declined — the applicant has been emailed", suspend: "Paused", reactivate: "Active again" }[action]);
  return (
    <Dialog open onClose={onClose} size="2xl" title={p?.name ?? "Partner"} description={p ? `${TYPE_INFO[p.type].name} · ${p.email}${p.phone ? ` · ${p.phone}` : ""}` : undefined} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !d || !p ? <Skeleton className="h-96" /> : (
        <div className="min-w-0 space-y-6 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
            <Badge>Code {p.code}</Badge>
            <Badge>{d.rate.tier} · {pct(d.rate.rate)}</Badge>
            {p.reviewNote && <span className="text-muted">“{p.reviewNote}”</span>}
            {write && (
              <div className="ml-auto flex flex-wrap gap-2">
                {(p.status === "pending" || p.status === "rejected") && <Button variant="primary" onClick={() => void act("approve")}>Approve</Button>}
                {p.status === "pending" && <Button variant="danger" onClick={() => ask.open({ title: "Decline this application", label: "Why? The applicant sees this.", required: true, confirm: "Decline", danger: true, run: (v) => act("reject", v) })}>Decline</Button>}
                {p.status === "approved" && <Button onClick={() => ask.open({ title: "Pause this partner", label: "Why? The partner sees this. Their codes stop working until you make them active again.", required: true, confirm: "Pause", danger: true, run: (v) => act("suspend", v) })}>Pause</Button>}
                {p.status === "suspended" && <Button variant="primary" onClick={() => void act("reactivate")}>Make active again</Button>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Customers" value={d.totals.signups} sub={`${d.totals.paying} paying · ${d.totals.trials} on trial`} />
            <Stat label="They paid" value={inr(d.totals.revenue)} sub={`${inr(d.totals.mrr)} a month now`} />
            <Stat label="Earned" value={inr(d.totals.earned)} sub={`${inr(d.totals.onHold)} on hold`} />
            <Stat label="Available" value={inr(Math.max(0, d.totals.available))} sub={`${inr(d.totals.paidOut)} paid out`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Application">
              <dl className="grid gap-2">
                <div><dt className="text-muted">Account</dt><dd>{d.account ? `${d.account.name} · ${d.account.email}` : "—"}</dd></div>
                <div><dt className="text-muted">Location</dt><dd>{[p.city, p.country].filter(Boolean).join(", ")}</dd></div>
                {p.website && <div><dt className="text-muted">Website</dt><dd><a className="underline" href={p.website} target="_blank" rel="noreferrer noopener">{p.website}</a></dd></div>}
                {TYPE_INFO[p.type].fields.filter((f) => p.profile[f.id]).map((f) => <div key={f.id}><dt className="text-muted">{f.label}</dt><dd className="break-words whitespace-pre-wrap">{/^https?:\/\//.test(p.profile[f.id]!) ? <a className="underline" href={p.profile[f.id]} target="_blank" rel="noreferrer noopener">{p.profile[f.id]}</a> : p.profile[f.id]}</dd></div>)}
                <div><dt className="text-muted">Applied</dt><dd>{date(p.createdAt)}{p.approvedAt ? ` · approved ${date(p.approvedAt)}` : ""}</dd></div>
              </dl>
            </Section>
            <TermsForm id={id} d={d} disabled={!write} />
          </div>

          <CouponsBlock id={id} d={d} disabled={!write} />
          <CustomersBlock id={id} d={d} disabled={!write} />
          <MoneyBlock id={id} d={d} disabled={!write} />
          {d.leads.length > 0 && (
            <Section title="Registered leads">
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[600px] text-[13px]"><tbody>{d.leads.map((l) => <tr key={l.id} className="border-b border-border/60 last:border-0"><td className="px-4 py-2 font-medium">{l.company}</td><td className="px-4 py-2 text-muted">{l.email}</td><td className="px-4 py-2">{LEAD_LABEL[l.status]}</td><td className="px-4 py-2 text-right tabular-nums">{l.value ? `${inr(l.value)}/mo` : "—"}</td><td className="px-4 py-2 text-muted">until {date(l.expiresAt)}</td></tr>)}</tbody></table>
              </Card>
            </Section>
          )}
          {ask.ui}
        </div>
      )}
    </Dialog>
  );
}

function TermsForm({ id, d, disabled }: { id: string; d: Detail; disabled: boolean }) {
  const run = useRun();
  const p = d.partner;
  const [f, setF] = useState({ type: p.type, rate: d.overrides.commissionBps === null ? "" : String(d.overrides.commissionBps / 100), months: d.overrides.commissionMonths === null ? "" : String(d.overrides.commissionMonths), code: p.code, note: d.adminNote });
  const typeTerms = d.rate.base;
  return (
    <Section title="Terms" sub="Leave the rate or window empty to use the kind of partner's — changes apply to future payments.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void run(`partners/${id}`, "PUT", { type: f.type, commissionBps: f.rate === "" ? null : Math.round(Number(f.rate) * 100), commissionMonths: f.months === "" ? null : Number(f.months), code: f.code, adminNote: f.note }, "Terms saved"); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind of partner">{(a) => <Select {...a} disabled={disabled} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PartnerType })}>{PARTNER_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].name}</option>)}</Select>}</Field>
          <Field label="Code" hint="Their link and own coupon.">{(a) => <Input {...a} disabled={disabled} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) })} />}</Field>
          <Field label="Commission % (override)" hint={`Now ${pct(typeTerms)}${d.rate.bonus ? ` + ${pct(d.rate.bonus)} tier` : ""}`}>{(a) => <Input {...a} disabled={disabled} inputMode="decimal" placeholder="Kind's rate" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, "") })} />}</Field>
          <Field label="Window in months (override)" hint={`Now ${months(d.terms.commissionMonths)} · 0 = as long as they pay`}>{(a) => <Input {...a} disabled={disabled} inputMode="numeric" placeholder="Kind's window" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value.replace(/\D/g, "") })} />}</Field>
        </div>
        <Field label="Private note" hint="Only admins see this.">{(a) => <Textarea {...a} disabled={disabled} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} />}</Field>
        {!disabled && <Button type="submit" variant="primary" className="justify-self-start">Save terms</Button>}
      </form>
    </Section>
  );
}

function CouponsBlock({ id, d, disabled }: { id: string; d: Detail; disabled: boolean }) {
  const run = useRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ label: "", code: "", discount: "10", payments: "1", rate: "" });
  return (
    <Section title="Codes" sub="Switch a code off to stop new customers using it. A code's own commission overrides the partner's for customers who used it." actions={!disabled && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding((x) => !x)}>New code</Button>}>
      {adding && (
        <Card className="grid gap-3 p-4 sm:grid-cols-6">
          <Field label="For" className="sm:col-span-2">{(a) => <Input {...a} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Campaign" />}</Field>
          <Field label="Code">{(a) => <Input {...a} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="Auto" />}</Field>
          <Field label="Discount %">{(a) => <Input {...a} inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} />}</Field>
          <Field label="On payments">{(a) => <Input {...a} inputMode="numeric" value={f.payments} onChange={(e) => setF({ ...f, payments: e.target.value })} />}</Field>
          <Field label="Commission %">{(a) => <Input {...a} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="Partner's" />}</Field>
          <div className="sm:col-span-6"><Button variant="primary" disabled={!f.label.trim()} onClick={async () => { const r = await run(`partners/${id}/coupons`, "POST", { label: f.label, code: f.code, discountBps: Math.round(Number(f.discount || 0) * 100), discountPayments: Number(f.payments || 1), commissionBps: f.rate ? Math.round(Number(f.rate) * 100) : null }, "Code made"); if (r) setAdding(false); }}>Make code</Button></div>
        </Card>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[700px] text-[13px]">
          <thead><tr className="border-b border-border text-left text-[12px] text-muted">{["Code", "For", "Customer gets", "Commission", "Used", "Paying", "Earned", "On"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {d.coupons.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-2">{c.primary ? <span className="text-muted">Partner&apos;s own</span> : c.label}</td>
                <td className="px-4 py-2">{c.discount || "—"}</td>
                <td className="px-4 py-2">{c.commissionBps === null ? <span className="text-muted">Partner&apos;s</span> : pct(c.commissionBps)}</td>
                <td className="px-4 py-2 tabular-nums">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                <td className="px-4 py-2 tabular-nums">{c.paying}</td>
                <td className="px-4 py-2 tabular-nums">{inr(c.earned)}</td>
                <td className="px-4 py-2"><Switch checked={c.active} disabled={disabled} onChange={(v) => void run(`partner-coupons/${c.id}`, "PUT", { active: v }, v ? "Code on" : "Code off")} label={`${c.code} on`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

function CustomersBlock({ id, d, disabled }: { id: string; d: Detail; disabled: boolean }) {
  const run = useRun();
  const [find, setFind] = useState("");
  const [shown, setShown] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setShown(find), 250);
    return () => clearTimeout(t);
  }, [find]);
  const found = useAdmin<{ workspaces: { id: string; name: string }[] }>(`partners/workspaces?q=${encodeURIComponent(shown)}`, { enabled: shown.trim().length >= 2 });
  return (
    <Section title="Customers" sub="Reversing takes a workspace away from the partner: no further commission or discount from it.">
      {!disabled && (
        <div className="relative max-w-sm">
          <Input aria-label="Give a workspace to this partner" placeholder="Give a workspace to this partner…" value={find} onChange={(e) => setFind(e.target.value)} />
          {shown.trim().length >= 2 && found.data && (
            <Card className="absolute z-10 mt-1 w-full p-1">
              {found.data.workspaces.length === 0 ? <p className="px-3 py-2 text-muted">No workspace without a partner matches.</p> : found.data.workspaces.map((w) => (
                <button key={w.id} type="button" className="block w-full rounded-[8px] px-3 py-2 text-left hover:bg-surface-2" onClick={async () => { if (await run(`partners/${id}/referrals`, "POST", { orgId: w.id }, `${w.name} given to the partner`)) setFind(""); }}>{w.name}</button>
              ))}
            </Card>
          )}
        </div>
      )}
      <Card className="overflow-x-auto p-0">
        {d.customers.length === 0 ? <p className="p-4 text-muted">No customers yet.</p> : (
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="border-b border-border text-left text-[12px] text-muted">{["Workspace", "Joined", "How", "Status", "Pays / month", "Paid", "Earned", ""].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {d.customers.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">{date(c.joinedAt)}</td>
                  <td className="px-4 py-2 text-muted">{SOURCE_LABEL[c.source]}{c.campaign ? ` · ${c.campaign}` : c.source === "coupon" ? ` · ${c.code}` : ""}</td>
                  <td className="px-4 py-2"><Badge tone={STATE_LABEL[c.state].tone}>{STATE_LABEL[c.state].label}</Badge></td>
                  <td className="px-4 py-2 tabular-nums">{c.monthly ? inr(c.monthly) : "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{inr(c.paid)}</td>
                  <td className="px-4 py-2 tabular-nums">{inr(c.earned)}</td>
                  <td className="px-4 py-2 text-right">{!disabled && c.state !== "reversed" && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void run(`partner-referrals/${c.id}`, "DELETE", undefined, "Reversed")}>Reverse</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}

function MoneyBlock({ id, d, disabled }: { id: string; d: Detail; disabled: boolean }) {
  const run = useRun();
  const ask = useAsk();
  const reauth = useReauth();
  const [adj, setAdj] = useState({ amount: "", note: "" });
  const [details, setDetails] = useState<Record<string, string> | null | undefined>(undefined);
  const reveal = async () => {
    const get = () => api<{ details: Record<string, string> | null }>(`/api/v1/admin/partners/${id}/payout-details`);
    try {
      setDetails((await get()).details);
    } catch {
      if (await reauth()) setDetails((await get().catch(() => ({ details: null }))).details);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Commissions" sub="Cancel one if its payment was refunded or fraudulent.">
        <Card className="max-h-[340px] overflow-auto p-0">
          {d.commissions.length === 0 ? <p className="p-4 text-muted">None yet.</p> : (
            <table className="w-full text-[13px]"><tbody>{d.commissions.map((k) => (
              <tr key={k.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{date(k.createdAt)}<p className="text-[12px] text-muted">{k.kind === "adjustment" ? k.note : `${k.customer}${k.invoice ? ` · ${k.invoice}` : ""}`}</p></td>
                <td className="px-3 py-2 text-right tabular-nums"><b className={clsx(k.status === "void" && "line-through opacity-60")}>{inr(k.amount, { exact: true })}</b>{k.kind === "invoice" && <p className="text-[12px] text-muted">{pct(k.rateBps)} of {inr(k.basis)}</p>}</td>
                <td className="px-3 py-2 text-right">{k.status !== "void" && !disabled && <Button size="sm" variant="ghost" onClick={() => ask.open({ title: "Cancel this commission", label: "Why? The partner sees this.", required: true, confirm: "Cancel commission", danger: true, run: (v) => run(`partner-commissions/${k.id}/void`, "POST", { note: v }, "Commission cancelled") })}>Cancel</Button>}</td>
              </tr>
            ))}</tbody></table>
          )}
        </Card>
        {!disabled && (
          <Card className="grid gap-2 p-4">
            <p className="font-medium">Adjustment</p>
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Amount in rupees" className="w-[140px]" inputMode="decimal" placeholder="₹ (− to deduct)" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value.replace(/[^\d.-]/g, "") })} />
              <Input aria-label="Reason" className="min-w-0 flex-1" placeholder="Reason — the partner sees it" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
              <Button variant="primary" disabled={!Number(adj.amount) || adj.note.trim().length < 3} onClick={async () => { if (await run(`partners/${id}/adjust`, "POST", { amount: Math.round(Number(adj.amount) * 100), note: adj.note }, "Adjustment added")) setAdj({ amount: "", note: "" }); }}>Add</Button>
            </div>
          </Card>
        )}
      </Section>
      <Section title="Payouts" sub={d.partner.payoutHint ? `Pays to ${d.partner.payoutHint}` : "No payout details yet."} actions={d.partner.payoutMethod && !disabled ? <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => void reveal()}>Show full details</Button> : null}>
        {details && (
          <Notice tone="accent" title="Payout details (viewing is logged)">
            <dl className="mt-1 grid gap-0.5 font-mono text-[12.5px]">{Object.entries(details).filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="text-muted">{k}:</span> {v}</div>)}</dl>
          </Notice>
        )}
        <PayoutTable rows={d.payouts.map((p) => ({ ...p, partner: { id, name: d.partner.name, email: d.partner.email, type: d.partner.type, code: d.partner.code } }))} compact disabled={disabled} />
      </Section>
      {ask.ui}
    </div>
  );
}

function PayoutQueue() {
  const [status, setStatus] = useState<"open" | "paid" | "rejected" | "all">("open");
  const q = useAdmin<{ payouts: QueueRow[] }>(`partner-payouts?status=${status}`);
  const can = useCan();
  return (
    <Section title="Payout requests" sub="Approve, send the money by UPI or bank transfer, then mark it paid with the transfer reference (UTR). The partner is emailed at each step." actions={<Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "open", label: "To process" }, { value: "paid", label: "Paid" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} />}>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : <PayoutTable rows={q.data.payouts} disabled={!can("tenants:write")} />}
    </Section>
  );
}

function PayoutTable({ rows, compact, disabled }: { rows: QueueRow[]; compact?: boolean; disabled: boolean }) {
  const run = useRun();
  const ask = useAsk();
  const [paying, setPaying] = useState<QueueRow | null>(null);
  const [ref, setRef] = useState("");
  if (!rows.length) return <Card className="p-4 text-[13px] text-muted">No payouts here.</Card>;
  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className={clsx("w-full text-[13px]", !compact && "min-w-[900px]")}>
          <thead><tr className="border-b border-border text-left text-[12px] text-muted">{[compact ? null : "Partner", "Request", "Amount", "Tax", "Send", compact ? null : "To", "Status", ""].filter(Boolean).map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border/60 align-top last:border-0">
                {!compact && <td className="px-3 py-2"><p className="font-medium">{p.partner.name}</p><p className="text-[12px] text-muted">{TYPE_INFO[p.partner.type].name} · {p.partner.code}</p></td>}
                <td className="px-3 py-2"><span className="font-mono text-[12px]">{p.number}</span><p className="text-[12px] text-muted">{date(p.createdAt)}</p>{p.note && <p className="text-[12px] text-muted">“{p.note}”</p>}</td>
                <td className="px-3 py-2 tabular-nums">{inr(p.amount, { exact: true })}</td>
                <td className="px-3 py-2 tabular-nums">{p.tds ? inr(p.tds, { exact: true }) : "—"}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{inr(p.net, { exact: true })}</td>
                {!compact && <td className="px-3 py-2 text-muted">{p.method}</td>}
                <td className="px-3 py-2"><Badge tone={PAYOUT_TONE[p.status]}>{p.status}</Badge>{p.reference && <p className="text-[12px] text-muted">{p.reference}</p>}{p.adminNote && <p className="text-[12px] text-muted">{p.adminNote}</p>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {!disabled && p.status === "requested" && <Button size="sm" onClick={() => void run(`partner-payouts/${p.id}`, "POST", { action: "approve" }, "Approved")}>Approve</Button>}
                  {!disabled && (p.status === "requested" || p.status === "approved") && (
                    <>
                      <Button size="sm" variant="primary" className="ml-1" onClick={() => (setRef(""), setPaying(p))}>Mark paid</Button>
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => ask.open({ title: "Reject this payout", label: "Why? The partner sees this; the amount goes back to their balance.", required: true, confirm: "Reject", danger: true, run: (v) => run(`partner-payouts/${p.id}`, "POST", { action: "reject", note: v }, "Rejected") })}>Reject</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {paying && (
        <Dialog open onClose={() => setPaying(null)} size="sm" title={`Mark ${paying.number} paid`} description={`Only after ${inr(paying.net, { exact: true })} has been sent to ${paying.method}.`} footer={<><Button onClick={() => setPaying(null)}>Cancel</Button><Button variant="primary" disabled={ref.trim().length < 3} onClick={async () => { if (await run(`partner-payouts/${paying.id}`, "POST", { action: "paid", reference: ref.trim() }, "Marked paid — the partner has been emailed")) setPaying(null); }}>Mark paid</Button></>}>
          <Field label="Transfer reference (UTR)">{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} autoFocus maxLength={120} />}</Field>
        </Dialog>
      )}
      {ask.ui}
    </>
  );
}

// ─── The program's terms ───────────────────────────────────────────────────

const toPct = (bps: number) => String(bps / 100);
const fromPct = (s: string) => Math.round(Number(s || 0) * 100);

function ProgramForm({ program }: { program: Program }) {
  const run = useRun();
  const can = useCan();
  const disabled = !can("settings:write");
  const p = { ...DEFAULT_PROGRAM, ...program };
  const [f, setF] = useState(() => ({
    open: p.open,
    cookieDays: String(p.cookieDays),
    holdDays: String(p.holdDays),
    minPayout: String(p.minPayout / 100),
    tds: toPct(p.tdsBps),
    leadDays: String(p.leadDays),
    maxCoupons: String(p.maxCoupons),
    types: Object.fromEntries(PARTNER_TYPES.map((t) => [t, { rate: toPct(p.types[t].commissionBps), months: String(p.types[t].commissionMonths), discount: toPct(p.types[t].discountBps), payments: String(p.types[t].discountPayments), maxDiscount: toPct(p.types[t].maxDiscountBps) }])) as Record<PartnerType, { rate: string; months: string; discount: string; payments: string; maxDiscount: string }>,
    tiers: p.tiers.map((t) => ({ name: t.name, minActive: String(t.minActive), bonus: toPct(t.bonusBps) })),
  }));
  const save = () =>
    run("settings/partners", "PUT", {
      open: f.open,
      cookieDays: Number(f.cookieDays),
      holdDays: Number(f.holdDays),
      minPayout: Math.round(Number(f.minPayout) * 100),
      tdsBps: fromPct(f.tds),
      leadDays: Number(f.leadDays),
      maxCoupons: Number(f.maxCoupons),
      types: Object.fromEntries(PARTNER_TYPES.map((t) => [t, { commissionBps: fromPct(f.types[t].rate), commissionMonths: Number(f.types[t].months), discountBps: fromPct(f.types[t].discount), discountPayments: Number(f.types[t].payments), maxDiscountBps: fromPct(f.types[t].maxDiscount) }])),
      tiers: f.tiers.map((t) => ({ name: t.name.trim(), minActive: Number(t.minActive), bonusBps: fromPct(t.bonus) })),
    }, "Program saved — new rates apply to future payments");
  const num = (v: string, set: (s: string) => void, label: string, hint?: ReactNode) => <Field label={label} hint={hint}>{(a) => <Input {...a} disabled={disabled} inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ""))} />}</Field>;
  const setType = (t: PartnerType, k: keyof (typeof f.types)[PartnerType], v: string) => setF({ ...f, types: { ...f.types, [t]: { ...f.types[t], [k]: v.replace(/[^\d.]/g, "") } } });
  return (
    <div className="space-y-6">
      <Section title="Program" sub="Changes apply to payments from now on; commission already earned never changes. A customer's window is fixed when they join.">
        <Card className="grid gap-4 p-4">
          <div className="flex items-center gap-3">
            <Switch checked={f.open} disabled={disabled} onChange={(v) => setF({ ...f, open: v })} label="Taking new applications" />
            <span><b className="font-medium">Taking new applications</b><span className="block text-[12px] text-muted">{f.open ? "The apply form on /partners is open." : "The apply form says applications are closed; existing partners carry on."}</span></span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {num(f.holdDays, (v) => setF({ ...f, holdDays: v }), "Hold (days)", "Before earnings can be withdrawn")}
            {num(f.minPayout, (v) => setF({ ...f, minPayout: v }), "Smallest payout (₹)")}
            {num(f.tds, (v) => setF({ ...f, tds: v }), "Tax withheld %", "e.g. TDS u/s 194H")}
            {num(f.cookieDays, (v) => setF({ ...f, cookieDays: v }), "Link remembered (days)")}
            {num(f.leadDays, (v) => setF({ ...f, leadDays: v }), "Lead protected (days)")}
            {num(f.maxCoupons, (v) => setF({ ...f, maxCoupons: v }), "Codes per partner")}
          </div>
        </Card>
      </Section>
      <Section title="Rates by kind of partner" sub="Commission is on what the customer pays before tax. Window 0 = for as long as they pay.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="border-b border-border text-left text-[12px] text-muted">{["Kind", "Commission %", "Window (months)", "Customer discount %", "On payments", "Most a partner may give %", "In words"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {PARTNER_TYPES.map((t) => {
                const r = f.types[t];
                const cell = (k: keyof typeof r) => <td className="px-3 py-2"><Input aria-label={`${TYPE_INFO[t].name} ${k}`} disabled={disabled} className="h-8 w-[90px]" inputMode="decimal" value={r[k]} onChange={(e) => setType(t, k, e.target.value)} /></td>;
                return (
                  <tr key={t} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium">{TYPE_INFO[t].name}</td>
                    {cell("rate")}{cell("months")}{cell("discount")}{cell("payments")}{cell("maxDiscount")}
                    <td className="px-3 py-2 text-[12px] text-muted">{pct(fromPct(r.rate))} {months(Number(r.months))}{fromPct(r.discount) ? ` · ${discountText(fromPct(r.discount), Number(r.payments) || 1)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </Section>
      <Section title="Tiers" sub="Set by how many of a partner's customers are paying when a payment comes in. The bonus is added to their rate." actions={!disabled && f.tiers.length < 8 ? <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setF({ ...f, tiers: [...f.tiers, { name: "", minActive: "", bonus: "" }] })}>Add tier</Button> : null}>
        <Card className="grid gap-2 p-4">
          {f.tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label="Name">{(a) => <Input {...a} disabled={disabled} className="w-[160px]" value={t.name} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />}</Field>
              <Field label="From paying customers">{(a) => <Input {...a} disabled={disabled} className="w-[120px]" inputMode="numeric" value={t.minActive} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, minActive: e.target.value.replace(/\D/g, "") } : x)) })} />}</Field>
              <Field label="Bonus %">{(a) => <Input {...a} disabled={disabled} className="w-[100px]" inputMode="decimal" value={t.bonus} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, bonus: e.target.value.replace(/[^\d.]/g, "") } : x)) })} />}</Field>
              {!disabled && f.tiers.length > 1 && <Button variant="ghost" aria-label={`Remove ${t.name || "tier"}`} icon={<Trash2 className="size-4" />} onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })} />}
            </div>
          ))}
        </Card>
      </Section>
      {!disabled ? <Button variant="primary" onClick={() => void save()}>Save program</Button> : <Notice>Only platform owners can change the program&apos;s rates.</Notice>}
    </div>
  );
}
