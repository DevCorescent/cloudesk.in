"use client";

// Every workspace's subscription: what the platform earns (MRR from real
// subscription amounts), who's on a trial, who owes money, and per workspace
// the plan, invoices and timeline — with the actions the platform team needs:
// extend or end a trial, assign a plan (paid or complimentary), add credit,
// record a bank/UPI payment, void an invoice, cancel, reactivate or end now.
// Money moves ask for the password again (the server decides; see useRun).
import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog, Segmented } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { dateTime } from "@/lib/client/format";
import { money, quote, QuoteError, taxOf, type CatalogPlan, type Choice, type Interval, type Pricing } from "@/lib/billing/catalog";
import { MODULE_GROUPS, MODULE_IDS, MODULES, moduleById, withRequirements, type ModuleId } from "@/lib/workspace/modules";
import { num, Section, Stat, useAdmin, useCan, useRun } from "./common";

// ── Shapes the API returns ──────────────────────────────────────────────────

type Status = "trialing" | "active" | "past_due" | "canceled" | "expired";
type Row = { orgId: string; name: string; slug: string; planId: string; planName: string; status: Status; interval: Interval; amount: number; monthly: number; currency: string; trialEndsAt: string | null; currentPeriodEnd: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean; complimentary: boolean; compUntil: string | null; credit: number; updatedAt: string; mrr: number; due: number };
type Stats = { currency: string; counts: Record<Status | "total", number>; mrr: number; arr: number; paying: number; trialsEndingThisWeek: number; collected30d: number; outstanding: number; openInvoices: number; everPaid: number; byPlan: { plan: string; workspaces: number; mrr: number }[] };
type Limits = { projects: number | null; seats: number | null; customDomains: number | null; automationsPerProject: number | null };
type Snapshot = { planId: string; planName: string; modules: ModuleId[] | null; interval: Interval; amount: number; monthly: number; currency: string; effectiveAt?: string };
export type SubState = "trial" | "active" | "grace" | "canceling" | "expired" | "unrestricted";
export type Invoice = { id: string; number: string; kind: string; description: string; lines: { label: string; amount: number }[]; subtotal: number; creditApplied: number; taxLabel: string; taxBps: number; tax: number; total: number; currency: string; periodStart: string | null; periodEnd: string | null; status: "open" | "paid" | "void"; dueAt: string | null; paidAt: string | null; paidVia: string | null; createdAt: string };
export type Overview = {
  enforced: boolean;
  state: SubState;
  entitled: ModuleId[] | null;
  limits: Limits;
  usage: { projects: number; seats: number; customDomains: number };
  subscription: {
    planId: string; planName: string; modules: ModuleId[] | null; limits: Limits; seats: number; interval: Interval; amount: number; monthly: number; currency: string; lines: { label: string; amount: number }[]; status: Status;
    trialStartedAt: string | null; trialEndsAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean; pending: Snapshot | null; credit: number; complimentary: boolean; compUntil: string | null;
  } | null;
  stats: { trialDaysLeft: number | null; trialDays: number; periodDaysLeft: number | null; paidTotal: number; paidInvoices: number; customerSince: string | null; due: number; nextDueAt: string | null; featuresIncluded: number; featuresTotal: number };
  plans: CatalogPlan[];
  pricing: Omit<Pricing, "enforce" | "renewalNoticeDays">;
  providers: string[];
  invoices: Invoice[];
  events: { id: string; kind: string; detail: Record<string, unknown>; byPlatform: boolean; createdAt: string; actor: string | null }[];
};

// ── Small shared pieces (Plans & pricing uses them too) ─────────────────────

/** Rupees typed by a person → paise, without float errors (19.99 → 1999). NaN for anything that isn't a number. */
export const toPaise = (s: string) => (s.trim() === "" || !/^-?\d*(\.\d{0,2})?$/.test(s.trim()) ? NaN : Math.round(Number(s) * 100));
export const toRupees = (p: number) => (p % 100 ? (p / 100).toFixed(2) : String(p / 100));
const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** An amount in rupees, kept as typed (so "12." works) while reporting paise. */
export function MoneyInput({ value, onChange, className, ...a }: { value: number | null; onChange: (paise: number | null) => void; className?: string; id?: string; "aria-label"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value === null ? "" : toRupees(value));
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    const typed = toPaise(text);
    if (!(value === null ? text.trim() === "" : typed === value)) setText(value === null ? "" : toRupees(value));
  }
  return (
    <div className={cx("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-subtle">₹</span>
      <Input
        {...a}
        inputMode="decimal"
        className="pl-6 tabular-nums"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = toPaise(e.target.value);
          onChange(Number.isFinite(p) ? p : null);
        }}
      />
    </div>
  );
}

const STATUS: Record<Status, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  trialing: { label: "Trial", tone: "accent" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment due", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
  expired: { label: "Ended", tone: "neutral" },
};
export const STATE: Record<SubState, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger"; line: string }> = {
  trial: { label: "On trial", tone: "accent", line: "Every feature until the trial ends." },
  active: { label: "Active", tone: "success", line: "Paid up (or complimentary) — the plan's features and limits apply." },
  grace: { label: "Payment overdue", tone: "danger", line: "The renewal wasn't paid. Everything works until the grace period ends, then the workspace becomes read-only." },
  canceling: { label: "Cancelling", tone: "warning", line: "Works until the end of the paid period, then ends." },
  expired: { label: "Ended", tone: "danger", line: "Read-only until a plan is paid for. Nothing has been deleted." },
  unrestricted: { label: "Unrestricted", tone: "neutral", line: "Subscriptions aren't enforced on this platform (Plans & pricing), so nothing is restricted." },
};
export const StatusChip = ({ s, trialEndsAt }: { s: Status; trialEndsAt?: string | null }) =>
  s === "trialing" && trialEndsAt && new Date(trialEndsAt) < new Date() ? <Badge tone="warning">Trial ended</Badge> : <Badge tone={STATUS[s]?.tone ?? "neutral"}>{STATUS[s]?.label ?? s}</Badge>;

/** Features picked from the catalogue, grouped like the sidebar. Requirements come along automatically. */
export function ModulePicker({ value, onChange, prices, locked = [], disabled }: { value: ModuleId[]; onChange: (v: ModuleId[]) => void; prices?: Partial<Record<ModuleId, number>>; locked?: ModuleId[]; disabled?: boolean }) {
  const set = new Set([...value, ...locked]);
  const toggle = (id: ModuleId, on: boolean) => {
    if (on) onChange(withRequirements([...value, id]).filter((m) => !locked.includes(m)));
    else onChange(value.filter((m) => m !== id && !moduleById(m)?.requires?.includes(id)));
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MODULE_GROUPS.map((g) => {
        const mods = MODULES.filter((m) => m.group === g.id);
        if (!mods.length) return null;
        return (
          <fieldset key={g.id} disabled={disabled} className="rounded-[12px] border border-border p-3">
            <legend className="px-1 text-[12px] font-semibold text-muted">{g.label}</legend>
            <ul className="grid gap-1">
              {mods.map((m) => (
                <li key={m.id}>
                  <label className={cx("flex items-center gap-2 text-[13px]", locked.includes(m.id) && "text-muted")}>
                    <input type="checkbox" checked={set.has(m.id)} disabled={locked.includes(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {locked.includes(m.id) ? <span className="text-[11.5px]">in base</span> : prices && <span className="text-[11.5px] text-muted tabular-nums">{typeof prices[m.id] === "number" ? `${money(prices[m.id]!)}/mo` : "not sold"}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Holds a dialog opened from inside another dialog. React passes a dialog's
 * close/cancel events up through the components around it, so without this,
 * closing the inner one would close the outer one too.
 */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
export const Nested = ({ children }: { children: ReactNode }) => <div className="contents" {...({ onClose: stop, onCancel: stop } as object)}>{children}</div>;

/** Asks before a money or destructive action; optional typed confirmation and extra fields. */
function Confirm({ open, onClose, title, children, confirmLabel, destructive, typed, ready = true, onConfirm }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; confirmLabel: string; destructive?: boolean; typed?: string; ready?: boolean; onConfirm: () => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = ready && (!typed || text.trim() === typed.trim());
  const close = () => { setText(""); onClose(); };
  return (
    <Nested>
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title={title}
      footer={<><Button onClick={close}>Cancel</Button><Button variant={destructive ? "danger" : "primary"} loading={busy} disabled={!ok} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setText(""); } }}>{confirmLabel}</Button></>}
    >
      <div className="grid gap-3 text-[13px]">
        {children}
        {typed && <Field label={`Type “${typed}” to confirm`}>{(a) => <Input {...a} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />}</Field>}
      </div>
    </Dialog>
    </Nested>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

const FILTERS: { value: "" | Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "trialing", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment due" },
  { value: "canceled", label: "Canceled" },
  { value: "expired", label: "Ended" },
];
const hashOrg = () => (typeof location !== "undefined" ? (/^#subscriptions\/([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? null) : null);

/** Opens a workspace's subscription in the Subscriptions section (from anywhere in the console). */
export const openSubscription = (orgId: string) => { window.location.hash = `subscriptions/${orgId}`; };

export function SubscriptionsPanel() {
  const [state, setState] = useState<"" | Status>("");
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeb(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [open, setOpen] = useState<string | null>(hashOrg);
  useEffect(() => {
    const on = () => { const id = hashOrg(); if (id) setOpen(id); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [limit, setLimit] = useState(50);
  const qs = new URLSearchParams({ state, q: deb }).toString();
  const list = useAdmin<{ stats: Stats; rows: Row[] }>(`subscriptions?${qs}&limit=${limit}`);
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const s = list.data?.stats;
  const cur = s?.currency ?? "INR";
  const show = (id: string) => { setOpen(id); history.replaceState(null, "", `#subscriptions/${id}`); };
  return (
    <div className="space-y-6">
      {!s ? <Skeleton className="h-40" /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label="MRR" value={money(s.mrr, cur)} sub="From active subscriptions; complimentary excluded" />
          <Stat label="ARR" value={money(s.arr, cur)} sub="MRR × 12" />
          <Stat label="Paying workspaces" value={num(s.paying)} sub={`${num(s.everPaid)} have ever paid`} />
          <Stat label="On trial" value={num(s.counts.trialing)} sub={`of ${num(s.counts.total)} workspaces`} />
          <Stat label="Trials ending this week" value={num(s.trialsEndingThisWeek)} tone={s.trialsEndingThisWeek ? "warning" : undefined} />
          <Stat label="Payment due" value={num(s.counts.past_due)} sub="Renewal unpaid, in grace" tone={s.counts.past_due ? "danger" : undefined} />
          <Stat label="Ended" value={num(s.counts.expired + s.counts.canceled)} sub={`${num(s.counts.expired)} ended · ${num(s.counts.canceled)} canceled`} />
          <Stat label="Collected (30 days)" value={money(s.collected30d, cur)} sub="Paid invoices, not credit" tone={s.collected30d ? "success" : undefined} />
          <Stat label="Outstanding" value={money(s.outstanding, cur)} sub={`${num(s.openInvoices)} open invoice${s.openInvoices === 1 ? "" : "s"}`} tone={s.outstanding ? "warning" : undefined} />
        </div>
      )}
      {s && s.byPlan.length > 0 && (
        <Section title="By plan" sub="Active and payment-due subscriptions. MRR counts what each workspace pays per month; complimentary plans count as zero.">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">Plan</th><th className="px-4 py-2.5 text-right font-medium">Workspaces</th><th className="px-4 py-2.5 text-right font-medium">MRR</th><th className="px-4 py-2.5 text-right font-medium">Share of MRR</th></tr></thead>
              <tbody className="divide-y divide-border">
                {[...s.byPlan].sort((a, b) => b.mrr - a.mrr || b.workspaces - a.workspaces).map((p) => (
                  <tr key={p.plan}><td className="px-4 py-2">{p.plan}</td><td className="px-4 py-2 text-right tabular-nums">{num(p.workspaces)}</td><td className="px-4 py-2 text-right tabular-nums">{money(p.mrr, cur)}</td><td className="px-4 py-2 text-right text-muted tabular-nums">{s.mrr ? `${Math.round((p.mrr / s.mrr) * 100)}%` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
      )}
      <Section title="Workspaces" sub="Newest change first. Click one to manage it.">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={state === f.value} onClick={() => setState(f.value)} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-medium", state === f.value ? "border-fg bg-surface-2 text-fg" : "border-border text-muted hover:bg-surface-2")}>
                {f.label}{s && <span className="ml-1 tabular-nums text-subtle">{f.value ? s.counts[f.value] : s.counts.total}</span>}
              </button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search workspaces" className="pl-8" placeholder="Name or address" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <a href={`/api/v1/admin/subscriptions/csv?${qs}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Export CSV</a>
        </div>
        {!list.data ? <Skeleton className="h-60" /> : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[13px]">
              <thead className="border-b border-border text-xs text-subtle">
                <tr><th className="px-4 py-2.5 font-medium">Workspace</th><th className="px-4 py-2.5 font-medium">Plan</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">MRR</th><th className="px-4 py-2.5 font-medium">Ends</th><th className="px-4 py-2.5 text-right font-medium">Due</th><th className="px-4 py-2.5 font-medium">Flags</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.rows.map((r) => {
                  const ends = r.status === "trialing" ? ["Trial", r.trialEndsAt] : r.status === "past_due" ? ["Grace", r.graceEndsAt] : r.complimentary ? ["Comp", r.compUntil] : ["Period", r.currentPeriodEnd];
                  return (
                    <tr key={r.orgId} className="cursor-pointer hover:bg-surface-2" onClick={() => show(r.orgId)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") show(r.orgId); }}>
                      <td className="px-4 py-2.5"><b className="font-medium">{r.name}</b><span className="block text-[12px] text-muted">{r.slug}</span></td>
                      <td className="px-4 py-2.5">{r.planName}<span className="block text-[12px] text-muted">{r.planId === "trial" ? "—" : `${money(r.amount, r.currency)} / ${r.interval}`}</span></td>
                      <td className="px-4 py-2.5"><StatusChip s={r.status} trialEndsAt={r.trialEndsAt} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.mrr ? money(r.mrr, r.currency) : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-2.5">{ends[1] ? <span>{day(ends[1])}<span className="block text-[12px] text-muted">{ends[0]}</span></span> : <span className="text-muted">{r.complimentary ? "Until removed" : "—"}</span>}</td>
                      <td className={cx("px-4 py-2.5 text-right tabular-nums", r.due ? "text-danger" : "text-muted")}>{r.due ? money(r.due, r.currency) : "—"}</td>
                      <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1">{r.cancelAtPeriodEnd && <Badge tone="warning">Cancelling</Badge>}{r.complimentary && <Badge tone="accent">Complimentary</Badge>}{r.credit > 0 && <Badge>Credit {money(r.credit, r.currency)}</Badge>}</span></td>
                    </tr>
                  );
                })}
                {!list.data.rows.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No subscriptions match.</td></tr>}
              </tbody>
            </table>
          </Card>
        )}
        {list.data && list.data.rows.length >= limit && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span>Showing the {num(limit)} most recently changed.</span>
            {limit < 500 ? <Button size="sm" variant="ghost" onClick={() => setLimit(Math.min(500, limit + 100))}>Show more</Button> : <span>Search or filter to narrow it, or export the CSV.</span>}
          </div>
        )}
      </Section>
      {open && <SubscriptionDrawer orgId={open} name={list.data?.rows.find((r) => r.orgId === open)?.name} onClose={() => { setOpen(null); history.replaceState(null, "", "#subscriptions"); }} />}
    </div>
  );
}

// ── One workspace ───────────────────────────────────────────────────────────

const EVENT: Record<string, string> = {
  trial_started: "Trial started",
  trial_extended: "Trial extended",
  trial_ended: "Trial ended",
  trial_ended_by_platform: "Trial ended by the platform",
  plan_chosen: "Plan chosen",
  change_scheduled: "Change scheduled",
  plan_assigned: "Plan assigned (invoice raised)",
  complimentary_given: "Complimentary plan given",
  complimentary_ended: "Complimentary plan ended",
  cancel_requested: "Set to cancel at period end",
  cancel_undone: "Cancellation undone",
  expired: "Ended",
  credit: "Credit changed",
  invoice_voided: "Invoice voided",
  renewal_invoiced: "Renewal invoiced",
  paid: "Payment received",
  activated: "Plan started",
};
const detailText = (d: Record<string, unknown>, currency: string) =>
  Object.entries(d ?? {})
    .filter(([, v]) => v !== null && v !== "" && v !== undefined && typeof v !== "object")
    .map(([k, v]) => (["amount", "total"].includes(k) && typeof v === "number" ? `${k}: ${money(v, currency)}` : k === "invoice" ? `invoice #${v}` : ["until", "at"].includes(k) && typeof v === "string" ? `${k}: ${day(v)}` : `${k}: ${String(v)}`))
    .join(" · ");
const limitText = (n: number | null | undefined) => (n === null || n === undefined ? "unlimited" : num(n));

export function SubscriptionDrawer({ orgId, name: known, onClose }: { orgId: string; name?: string; onClose: () => void }) {
  const q = useAdmin<Overview>(`subscriptions/${orgId}`);
  // Opened from a link to a workspace that isn't in the list: look its name up.
  const profile = useAdmin<{ profile: { name: string } }>(`clients/${orgId}`, { enabled: !known });
  const name = known ?? profile.data?.profile.name;
  const can = useCan();
  const d = q.data;
  const sub = d?.subscription;
  const cur = sub?.currency ?? d?.pricing.currency ?? "INR";
  return (
    <Dialog open onClose={onClose} size="xl" title={name ?? "Subscription"} description={d ? `${STATE[d.state].label} — ${STATE[d.state].line}` : undefined} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-80" /> : (
        <div className="min-w-0 space-y-6 text-[13px]" data-testid="subscription-drawer">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATE[d.state].tone}>{STATE[d.state].label}</Badge>
            {sub && STATUS[sub.status]?.label !== STATE[d.state].label && <StatusChip s={sub.status} trialEndsAt={sub.trialEndsAt} />}
            {sub?.complimentary && <Badge tone="accent">Complimentary{sub.compUntil ? ` until ${day(sub.compUntil)}` : " until removed"}</Badge>}
            {sub?.cancelAtPeriodEnd && <Badge tone="warning">Cancels at period end</Badge>}
            {!d.enforced && <Badge>Enforcement off</Badge>}
          </div>
          {!sub ? <Notice tone="warning">This workspace has no subscription record yet.</Notice> : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Plan" value={sub.planName} sub={sub.planId === "trial" ? "Free trial" : sub.complimentary ? "Complimentary — no charge" : `${money(sub.amount, sub.currency)} / ${sub.interval}`} />
                <Stat label={sub.status === "trialing" ? "Trial left" : "Period left"} value={sub.status === "trialing" ? (d.stats.trialDaysLeft === null ? "—" : `${d.stats.trialDaysLeft} d`) : d.stats.periodDaysLeft === null ? "—" : `${d.stats.periodDaysLeft} d`} sub={sub.status === "trialing" ? `of a ${d.stats.trialDays}-day trial` : sub.currentPeriodEnd ? `ends ${day(sub.currentPeriodEnd)}` : undefined} />
                <Stat label="Paid to date" value={money(d.stats.paidTotal, cur)} sub={d.stats.customerSince ? `${d.stats.paidInvoices} paid · since ${day(d.stats.customerSince)}` : "Never paid"} />
                <Stat label="Due now" value={money(d.stats.due, cur)} sub={d.stats.nextDueAt ? `next due ${day(d.stats.nextDueAt)}` : "Nothing open"} tone={d.stats.due ? "warning" : undefined} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-2 font-semibold">Plan</h3>
                  <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
                    <dt className="text-muted">Plan</dt><dd>{sub.planName} {sub.planId !== "trial" && <span className="text-muted">· {sub.interval === "year" ? "yearly" : "monthly"} · {money(sub.monthly, sub.currency)}/mo</span>}</dd>
                    <dt className="text-muted">Features</dt><dd>{sub.modules === null ? `Every feature (${MODULE_IDS.length})` : `${sub.modules.length} of ${MODULE_IDS.length}`}{d.state === "trial" && sub.modules !== null && <span className="block text-[12px] text-muted">During the trial every feature is on; these apply after it.</span>}</dd>
                    <dt className="text-muted">Limits</dt><dd>{limitText(sub.limits.projects)} web apps · {limitText(sub.limits.seats)} seats · {limitText(sub.limits.customDomains)} domains · {limitText(sub.limits.automationsPerProject)} automations/app</dd>
                    <dt className="text-muted">Using now</dt><dd>{num(d.usage.projects)} / {limitText(d.limits.projects)} web apps · {num(d.usage.seats)} / {limitText(d.limits.seats)} seats · {num(d.usage.customDomains)} / {limitText(d.limits.customDomains)} domains</dd>
                    <dt className="text-muted">Credit</dt><dd className="tabular-nums">{money(sub.credit, sub.currency)}</dd>
                  </dl>
                  {sub.modules && sub.modules.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{sub.modules.map((m) => <Badge key={m}>{moduleById(m)?.name ?? m}</Badge>)}</div>}
                </Card>
                <Card className="p-4">
                  <h3 className="mb-2 font-semibold">Dates</h3>
                  <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
                    <dt className="text-muted">Trial</dt><dd>{sub.trialStartedAt ? `${day(sub.trialStartedAt)} → ${day(sub.trialEndsAt)}` : "—"}</dd>
                    <dt className="text-muted">Current period</dt><dd>{sub.currentPeriodStart ? `${day(sub.currentPeriodStart)} → ${day(sub.currentPeriodEnd)}` : "—"}</dd>
                    <dt className="text-muted">Grace ends</dt><dd>{day(sub.graceEndsAt)}</dd>
                    <dt className="text-muted">Complimentary</dt><dd>{sub.complimentary ? (sub.compUntil ? `until ${day(sub.compUntil)}` : "until removed") : "—"}</dd>
                  </dl>
                  {sub.pending && (
                    <div className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2">
                      <p className="font-medium">Pending change</p>
                      <p className="text-muted">{sub.pending.planName} · {sub.pending.interval === "year" ? "yearly" : "monthly"} · {money(sub.pending.amount, sub.pending.currency)}{sub.pending.effectiveAt ? ` · from ${day(sub.pending.effectiveAt)}` : ""}</p>
                    </div>
                  )}
                </Card>
              </div>
              <Invoices orgId={orgId} invoices={d.invoices} write={can("tenants:write")} />
              {can("tenants:write") && <Actions orgId={orgId} name={name ?? "this workspace"} d={d} />}
              <Section title="Timeline" sub="Everything that happened to this subscription, newest first.">
                {!d.events.length ? <p className="text-muted">Nothing yet.</p> : (
                  <ol className="space-y-2 border-l border-border pl-4">
                    {d.events.map((e) => (
                      <li key={e.id}>
                        <p><b className="font-medium">{EVENT[e.kind] ?? e.kind}</b> <span className="text-muted">· {dateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ""}</span>{e.byPlatform && <Badge className="ml-1.5">platform</Badge>}</p>
                        {detailText(e.detail, cur) && <p className="text-[12px] break-words text-muted">{detailText(e.detail, cur)}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Invoices({ orgId, invoices, write }: { orgId: string; invoices: Invoice[]; write: boolean }) {
  const run = useRun();
  const [pay, setPay] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [ref, setRef] = useState("");
  return (
    <Section title="Invoices" sub="Record a payment received by bank transfer or UPI, or void an invoice raised by mistake.">
      {!invoices.length ? <p className="text-muted">No invoices yet.</p> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-3 py-2 font-medium">Invoice</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Due / paid</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-border">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2"><b className="font-medium">{i.number}</b><span className="block text-[12px] text-muted">{i.description}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(i.total, i.currency)}<span className="block text-[11.5px] text-muted">{i.tax ? `incl. ${i.taxLabel} ${money(i.tax, i.currency)}` : ""}{i.creditApplied ? ` · credit ${money(i.creditApplied, i.currency)}` : ""}</span></td>
                  <td className="px-3 py-2"><Badge tone={i.status === "paid" ? "success" : i.status === "open" ? "warning" : "neutral"}>{i.status === "open" ? "Open" : i.status === "paid" ? "Paid" : "Void"}</Badge></td>
                  <td className="px-3 py-2 text-muted">{i.status === "paid" ? `${day(i.paidAt)}${i.paidVia ? ` · ${i.paidVia}` : ""}` : day(i.dueAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {write && i.status === "open" && (
                      <span className="inline-flex gap-1.5">
                        <Button size="sm" onClick={() => { setRef(""); setPay(i); }}>Record payment</Button>
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(i)}>Void</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Confirm open={!!pay} onClose={() => setPay(null)} title={`Record payment for ${pay?.number ?? ""}`} confirmLabel="Record payment" ready={ref.trim().length >= 2} onConfirm={async () => { if (pay && (await run(`subscriptions/${orgId}`, "POST", { action: "record_payment", invoiceId: pay.id, reference: ref.trim() }, "Payment recorded"))) setPay(null); }}>
        <p>Marks {pay && money(pay.total, pay.currency)} as received and applies the invoice (the plan starts or renews). Only do this once the money is in the bank.</p>
        <Field label="Payment reference" hint="The bank transfer or UPI reference, kept on the invoice.">{(a) => <Input {...a} autoFocus value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. UTR 4012 3456 7890" />}</Field>
      </Confirm>
      <Confirm open={!!voiding} onClose={() => setVoiding(null)} destructive title={`Void ${voiding?.number ?? ""}?`} confirmLabel="Void invoice" onConfirm={async () => { if (voiding && (await run(`subscriptions/${orgId}`, "POST", { action: "void_invoice", invoiceId: voiding.id }, "Invoice voided"))) setVoiding(null); }}>
        <p>The workspace will no longer be asked to pay {voiding && money(voiding.total, voiding.currency)}. What the invoice would have started won&apos;t happen.</p>
      </Confirm>
    </Section>
  );
}

type Ask = null | "end_trial" | "assign" | "credit" | "cancel" | "end_comp" | "expire";

function Actions({ orgId, name, d }: { orgId: string; name: string; d: Overview }) {
  const run = useRun();
  const sub = d.subscription!;
  const cur = sub.currency;
  const [ask, setAsk] = useState<Ask>(null);
  const [days, setDays] = useState("14");
  const [credit, setCredit] = useState<{ amount: number | null; sign: 1 | -1; note: string }>({ amount: null, sign: 1, note: "" });
  // Assign a plan
  const [mode, setMode] = useState<"plan" | "custom">("plan");
  const [planId, setPlanId] = useState(d.plans[0]?.id ?? "");
  const [interval, setInterval] = useState<Interval>("month");
  const [mods, setMods] = useState<ModuleId[]>([]);
  const [seats, setSeats] = useState(String(d.pricing.customSeatsIncluded));
  const [comp, setComp] = useState(false);
  const [forever, setForever] = useState(false);
  const [months, setMonths] = useState("3");
  const [note, setNote] = useState("");
  const act = (body: Record<string, unknown>, done: string) => run(`subscriptions/${orgId}`, "POST", body, done);
  const close = () => setAsk(null);
  const inTrial = d.state === "trial";
  const choice: Choice = mode === "plan" ? { kind: "plan", planId, interval } : { kind: "custom", modules: mods, seats: Number(seats), interval };
  const priced = useMemo(() => {
    try {
      return { q: quote(choice, d.plans, { ...d.pricing, enforce: true, renewalNoticeDays: 7 } as Pricing), err: "" };
    } catch (e) {
      return { q: null, err: e instanceof QuoteError ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, planId, interval, mods, seats, d.plans, d.pricing]);
  const monthsN = Number(months);
  const assignOk = !!priced.q && (!comp || forever || (Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 60));
  const daysN = Number(days);
  return (
    <Section title="Actions" sub="Each is written to the timeline and the audit log. Money moves ask for your password again.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">Trial</h3>
          <p className="text-muted">{inTrial ? `Ends ${day(sub.trialEndsAt)}. Extending adds days to that.` : "Not on a trial. Extending starts a new trial from today with every feature."}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Days">{(a) => <Input {...a} className="!w-24" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
            {[7, 14, 30].map((n) => <Button key={n} size="sm" variant="ghost" onClick={() => setDays(String(n))}>+{n}</Button>)}
            <Button disabled={!Number.isInteger(daysN) || daysN < 1 || daysN > 365} onClick={() => void act({ action: "extend_trial", days: daysN }, inTrial ? `Trial extended by ${daysN} days` : `Trial started for ${daysN} days`)}>{inTrial ? "Extend trial" : "Start trial"}</Button>
            {inTrial && <Button variant="ghost" onClick={() => setAsk("end_trial")}>End trial now</Button>}
          </div>
        </Card>
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">Credit</h3>
          <p className="text-muted">On account: <b className="tabular-nums">{money(sub.credit, cur)}</b>. Credit is used up by the next invoices.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Segmented label="Add or remove" value={credit.sign === 1 ? "add" : "remove"} onChange={(v) => setCredit({ ...credit, sign: v === "add" ? 1 : -1 })} options={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }]} />
            <Field label="Amount">{(a) => <MoneyInput {...a} className="w-32" value={credit.amount} onChange={(p) => setCredit({ ...credit, amount: p })} />}</Field>
          </div>
          <Field label="Why" hint="Required — shown on the timeline.">{(a) => <Input {...a} value={credit.note} maxLength={300} onChange={(e) => setCredit({ ...credit, note: e.target.value })} placeholder="e.g. Downtime on 12 Oct" />}</Field>
          <Button disabled={!credit.amount || credit.amount <= 0 || !credit.note.trim()} onClick={() => setAsk("credit")}>{credit.sign === 1 ? "Add credit" : "Remove credit"}</Button>
        </Card>
      </div>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="font-semibold">Assign a plan</h3>
          <p className="text-muted">{comp ? "Complimentary: the plan applies now, free of charge." : inTrial ? "Raises an invoice for the workspace to pay; the plan starts when the trial ends (if paid)." : "Raises an invoice for the workspace to pay; the plan starts when it's paid. Open invoices are replaced."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Plan source" value={mode} onChange={setMode} options={[{ value: "plan", label: "From the catalogue" }, { value: "custom", label: "Build one" }]} />
          <Segmented label="Billing interval" value={interval} onChange={setInterval} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />
        </div>
        {mode === "plan" ? (
          <Field label="Plan">{(a) => <Select {...a} className="sm:!w-80" value={planId} onChange={(e) => setPlanId(e.target.value)}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.monthly, p.currency)}/mo · {money(p.yearly, p.currency)}/yr</option>)}</Select>}</Field>
        ) : (
          <div className="space-y-3">
            <Field label="Seats" hint={`${d.pricing.customSeatsIncluded} included; each extra ${money(d.pricing.seatPrice, d.pricing.currency)}/mo.`}>{(a) => <Input {...a} className="!w-28" type="number" min={d.pricing.customSeatsIncluded} max={10000} value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
            <ModulePicker value={mods} onChange={setMods} prices={d.pricing.modulePrices} locked={d.pricing.customBaseModules} />
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2"><Switch label="Complimentary" checked={comp} onChange={setComp} /> Complimentary (free)</label>
          {comp && (
            <>
              <Field label="For months">{(a) => <Input {...a} className="!w-24" type="number" min={1} max={60} disabled={forever} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
              <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={forever} onChange={(e) => setForever(e.target.checked)} /> Until removed</label>
            </>
          )}
        </div>
        <Field label="Note (optional)" hint="Why — on the timeline and in the audit log.">{(a) => <Textarea {...a} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-surface-2 px-3 py-2">
          {priced.q ? (
            <span>
              <b>{priced.q.name}</b> · {priced.q.modules === null ? "every feature" : `${priced.q.modules.length} features`} · {priced.q.seats} seats ·{" "}
              {comp ? <b>no charge</b> : <span className="tabular-nums">{money(priced.q.amount, priced.q.currency)} + {d.pricing.taxLabel} {money(taxOf(priced.q.amount, d.pricing.taxBps), priced.q.currency)} = <b>{money(priced.q.amount + taxOf(priced.q.amount, d.pricing.taxBps), priced.q.currency)}</b> per {interval}</span>}
            </span>
          ) : <span className="text-danger">{priced.err}</span>}
          <Button variant="primary" disabled={!assignOk} onClick={() => setAsk("assign")}>Assign…</Button>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Cancel, end or restore</h3>
        <div className="flex flex-wrap gap-2">
          {sub.cancelAtPeriodEnd ? <Button onClick={() => void act({ action: "reactivate" }, "Cancellation undone")}>Reactivate</Button> : <Button onClick={() => setAsk("cancel")}>Cancel at period end</Button>}
          {sub.complimentary && <Button onClick={() => setAsk("end_comp")}>End complimentary</Button>}
          <Button variant="danger" onClick={() => setAsk("expire")}>Expire now</Button>
        </div>
      </Card>

      <Confirm open={ask === "end_trial"} onClose={close} destructive title="End the trial now?" confirmLabel="End trial" onConfirm={async () => { if (await act({ action: "end_trial" }, "Trial ended")) close(); }}>
        <p>{name} loses trial access now. Unless a plan is paid for, the workspace becomes read-only.</p>
      </Confirm>
      <Confirm open={ask === "credit"} onClose={close} title={credit.sign === 1 ? "Add credit?" : "Remove credit?"} confirmLabel={credit.sign === 1 ? "Add credit" : "Remove credit"} onConfirm={async () => { if (await act({ action: "credit", amount: credit.sign * (credit.amount ?? 0), note: credit.note.trim() }, "Credit updated")) { setCredit({ amount: null, sign: 1, note: "" }); close(); } }}>
        <p>{credit.sign === 1 ? "Adds" : "Removes"} <b>{money(credit.amount ?? 0, cur)}</b> {credit.sign === 1 ? "to" : "from"} {name}&apos;s account (now {money(sub.credit, cur)}). “{credit.note}”</p>
      </Confirm>
      <Confirm open={ask === "assign"} onClose={close} title={`Assign ${priced.q?.name ?? "plan"}?`} confirmLabel={comp ? "Give complimentary plan" : "Raise invoice"} onConfirm={async () => { if (await act({ action: "assign", choice, complimentary: comp, months: comp ? (forever ? null : monthsN) : undefined, note: note.trim() || undefined }, comp ? "Complimentary plan given" : "Plan assigned — invoice raised")) { setNote(""); close(); } }}>
        {comp ? <p>{name} gets {priced.q?.name} free of charge {forever ? "until you remove it" : `for ${monthsN} month${monthsN === 1 ? "" : "s"}`}, starting now. Open invoices are voided.</p> : <p>{name} is invoiced <b>{priced.q && money(priced.q.amount + taxOf(priced.q.amount, d.pricing.taxBps), priced.q.currency)}</b> (incl. {d.pricing.taxLabel}) for {priced.q?.name}, {interval === "year" ? "yearly" : "monthly"}. Other open invoices are voided.</p>}
      </Confirm>
      <Confirm open={ask === "cancel"} onClose={close} destructive title="Cancel at period end?" confirmLabel="Cancel at period end" onConfirm={async () => { if (await act({ action: "cancel" }, "Set to cancel at period end")) close(); }}>
        <p>{name} keeps working until {day(sub.currentPeriodEnd)}, then ends. No renewal invoice is raised; an open one is voided. You can undo this until then.</p>
      </Confirm>
      <Confirm open={ask === "end_comp"} onClose={close} destructive title="End the complimentary plan?" confirmLabel="End complimentary" onConfirm={async () => { if (await act({ action: "end_complimentary" }, "Complimentary plan ended")) close(); }}>
        <p>{sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date() ? `${name} falls back to its paid period (until ${day(sub.currentPeriodEnd)}).` : `${name} has no paid period, so it becomes read-only now until a plan is paid for.`}</p>
      </Confirm>
      <Confirm open={ask === "expire"} onClose={close} destructive typed={name} title="End this subscription now?" confirmLabel="Expire now" onConfirm={async () => { if (await act({ action: "expire" }, "Subscription ended")) close(); }}>
        <Notice tone="danger">{name} becomes read-only immediately: trial, paid period and any complimentary plan end now, and an open renewal is voided. Nothing is deleted or refunded.</Notice>
      </Confirm>
    </Section>
  );
}

/** A workspace's subscription in a few lines, with a way into the Subscriptions section (Workspaces, Client 360). */
export function SubscriptionSummary({ orgId, onOpen }: { orgId: string; onOpen?: () => void }) {
  const q = useAdmin<Overview>(`subscriptions/${orgId}`);
  if (q.isError) return <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>;
  const d = q.data;
  if (!d) return <Skeleton className="h-16" />;
  const sub = d.subscription;
  const ends = !sub ? null : d.state === "trial" ? `Trial ends ${day(sub.trialEndsAt)}${d.stats.trialDaysLeft !== null ? ` (${d.stats.trialDaysLeft} d left)` : ""}` : sub.complimentary ? `Complimentary ${sub.compUntil ? `until ${day(sub.compUntil)}` : "until removed"}` : d.state === "grace" ? `Grace ends ${day(sub.graceEndsAt)}` : sub.currentPeriodEnd ? `${sub.cancelAtPeriodEnd ? "Ends" : "Renews"} ${day(sub.currentPeriodEnd)}` : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-surface-2 p-3 text-[13px]" data-testid="subscription-summary">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1.5"><b className="font-medium">{sub?.planName ?? "No subscription"}</b><Badge tone={STATE[d.state].tone}>{STATE[d.state].label}</Badge>{sub && sub.planId !== "trial" && !sub.complimentary && <span className="text-muted tabular-nums">{money(sub.amount, sub.currency)} / {sub.interval}</span>}</p>
        <p className="text-muted">{[ends, d.stats.due ? `${money(d.stats.due, sub?.currency ?? "INR")} due` : null, sub?.credit ? `${money(sub.credit, sub.currency)} credit` : null].filter(Boolean).join(" · ") || STATE[d.state].line}</p>
      </div>
      <Button size="sm" onClick={() => { onOpen?.(); openSubscription(orgId); }}>Manage subscription</Button>
    </div>
  );
}
