"use client";

// The partner dashboard's tabs other than the overview.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, Megaphone, Plus, Target, TicketPercent, Wallet } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { discountText, months, payoutSplit, pct, TYPE_INFO } from "@/lib/partners/program";
import { CopyRow, copyText } from "./overview";
import { date, inr, LEAD_LABEL, MINE_KEY, PAYOUT_TONE, SOURCE_LABEL, STATE_LABEL, type Commission, type Dashboard, type Lead, type PartnerProfile, type Payout } from "./types";

const Section = ({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) => (
  <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

function Table({ head, rows, empty, right = [] }: { head: string[]; rows: ReactNode[][]; empty: ReactNode; right?: number[] }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted">
            {head.map((h, i) => <th key={h} className={clsx("py-2 pr-3 font-medium whitespace-nowrap", right.includes(i) && "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => <td key={j} className={clsx("py-2.5 pr-3 align-top", right.includes(j) && "text-right tabular-nums")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const useRefresh = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["partner"] });
};

// ─── Customers ─────────────────────────────────────────────────────────────

export function Customers({ d }: { d: Dashboard }) {
  const [filter, setFilter] = useState<"all" | "paying" | "trial" | "other">("all");
  const rows = d.customers.filter((c) => filter === "all" || (filter === "other" ? !["paying", "trial"].includes(c.state) : c.state === filter));
  return (
    <Section
      title="Customers you brought"
      sub="Businesses that signed up with your link, code or a lead you registered. You earn on what they pay while their window is open."
      action={<Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: `All ${d.customers.length}` }, { value: "paying", label: `Paying ${d.totals.paying}` }, { value: "trial", label: `Trial ${d.totals.trials}` }, { value: "other", label: "Other" }]} />}
    >
      <Table
        head={["Business", "Joined", "How", "Status", "Plan", "Pays / month", "Paid so far", "You earned", "You earn until"]}
        right={[5, 6, 7]}
        rows={rows.map((c) => [
          <span key="n" className="font-medium">{c.name}</span>,
          date(c.joinedAt),
          <span key="s" className="text-muted">{SOURCE_LABEL[c.source]}{c.campaign ? ` · ${c.campaign}` : c.source === "coupon" ? ` · ${c.code}` : ""}</span>,
          <Badge key="b" tone={STATE_LABEL[c.state].tone}>{STATE_LABEL[c.state].label}</Badge>,
          c.plan || "—",
          c.monthly ? inr(c.monthly) : "—",
          inr(c.paid),
          <b key="e">{inr(c.earned)}</b>,
          c.commissionUntil ? (c.inWindow ? date(c.commissionUntil) : <span key="x" className="text-subtle">Ended {date(c.commissionUntil)}</span>) : "As long as they pay",
        ])}
        empty={<EmptyState icon={<Megaphone />} title="No customers yet" description="Share your link or code — businesses that sign up with it appear here, with what they pay and what you earn." />}
      />
    </Section>
  );
}

// ─── Links, campaigns and coupons ──────────────────────────────────────────

const PAGES = [
  { to: "/", label: "Home page" },
  { to: "/pricing", label: "Pricing" },
  { to: "/start", label: "Start free (sign-up)" },
  { to: "/features", label: "Features" },
];

export function LinksAndCoupons({ d, origin: fixedOrigin }: { d: Dashboard; origin?: string }) {
  const [campaign, setCampaign] = useState("");
  const [to, setTo] = useState("/");
  const [creating, setCreating] = useState(false);
  const refresh = useRefresh();
  const toast = useToast();
  const origin = fixedOrigin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const c = campaign.trim().replace(/[^\w .-]/g, "").slice(0, 60);
  const link = `${origin}/go/${d.partner.code}${c || to !== "/" ? "?" : ""}${c ? `c=${encodeURIComponent(c)}` : ""}${c && to !== "/" ? "&" : ""}${to !== "/" ? `to=${encodeURIComponent(to)}` : ""}`;
  const toggle = useMutation({ mutationFn: (x: { id: string; active: boolean }) => api(`/api/v1/partner/coupons/${x.id}`, { method: "PATCH", body: { active: x.active } }), onSuccess: refresh, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const influencer = d.partner.type === "influencer";
  return (
    <div className="grid gap-5">
      <Section title="Make a tracked link" sub={`Name a campaign to see what each post, video or ad brings. A visit is remembered for ${d.terms.cookieDays} days, and the sign-up is yours if it comes within that time.`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name" hint="e.g. diwali-reel, newsletter-oct, youtube-review">{(a) => <Input {...a} value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={60} placeholder="Optional" />}</Field>
          <Field label="Lands on">{(a) => <Select {...a} value={to} onChange={(e) => setTo(e.target.value)}>{PAGES.map((p) => <option key={p.to} value={p.to}>{p.label}</option>)}</Select>}</Field>
        </div>
        <div className="mt-3"><CopyRow label="Your link" value={link} /></div>
        {d.terms.discountBps > 0 && <p className="mt-2 text-[12.5px] text-subtle">People who arrive through your link get your code&apos;s discount automatically: {discountText(d.coupons.find((x) => x.primary)?.discountBps ?? d.terms.discountBps, d.coupons.find((x) => x.primary)?.discountPayments ?? d.terms.discountPayments)}.</p>}
      </Section>

      {d.campaigns.length > 0 && (
        <Section title="Campaigns" sub="Visits counted per campaign and day; bots and link previews aren't counted.">
          <Table head={["Campaign", "Visits", "Sign-ups", "Paying", "Conversion", "You earned"]} right={[1, 2, 3, 4, 5]} rows={d.campaigns.map((x) => [x.campaign || <span key="d" className="text-muted">No campaign name</span>, x.clicks.toLocaleString("en-IN"), x.signups, x.paying, x.clicks ? `${((x.signups / x.clicks) * 100).toFixed(1)}%` : "—", inr(x.earned)])} empty={null} />
        </Section>
      )}

      <Section
        title={influencer ? "Your coupon codes" : "Codes"}
        sub={`Customers type a code when they sign up or in Billing and get its discount; you earn on what they pay. You can make up to ${d.terms.maxCoupons} codes, giving up to ${pct(d.terms.maxDiscountBps)} off.`}
        action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New code</Button>}
      >
        <Table
          head={["Code", "For", "Customer gets", "Used", "Sign-ups", "Paying", "You earned", "On"]}
          right={[3, 4, 5, 6]}
          rows={d.coupons.map((x) => [
            <button key="c" type="button" onClick={() => copyText(x.code, toast, `Copied ${x.code}`)} className="font-mono font-semibold hover:underline">{x.code}</button>,
            x.primary ? <span key="p" className="text-muted">Your own code</span> : x.label,
            x.discount || <span key="n" className="text-subtle">No discount</span>,
            `${x.uses}${x.maxUses ? ` / ${x.maxUses}` : ""}`,
            x.signups,
            x.paying,
            inr(x.earned),
            x.primary ? <Badge key="a" tone="success">Always</Badge> : <Switch key="s" checked={x.active} onChange={(v) => toggle.mutate({ id: x.id, active: v })} label={`${x.code} on`} />,
          ])}
          empty={null}
        />
      </Section>
      {creating && <NewCoupon d={d} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCoupon({ d, onClose }: { d: Dashboard; onClose: () => void }) {
  const refresh = useRefresh();
  const [f, setF] = useState({ label: "", code: "", discount: Math.min(d.terms.discountBps, d.terms.maxDiscountBps) / 100, payments: d.terms.discountPayments, maxUses: "", expires: "" });
  const save = useMutation({
    mutationFn: () => api("/api/v1/partner/coupons", { method: "POST", body: { label: f.label, code: f.code, discountBps: Math.round(f.discount * 100), discountPayments: f.payments, maxUses: f.maxUses ? Number(f.maxUses) : null, expiresAt: f.expires ? new Date(`${f.expires}T23:59:59`).toISOString() : null } }),
    onSuccess: () => (refresh(), onClose()),
  });
  const err = save.error instanceof ApiClientError ? save.error.fieldErrors() : {};
  const max = d.terms.maxDiscountBps / 100;
  return (
    <Dialog open onClose={onClose} title="New code" description="Make a code for one campaign or platform, to see which one works best." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.label.trim()} onClick={() => save.mutate()}>Make code</Button></>}>
      <div className="grid gap-3">
        {save.error && !Object.keys(err).length && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
        <Field label="What it's for" error={err.label?.[0]}>{(a) => <Input {...a} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Instagram — Diwali" maxLength={60} autoFocus />}</Field>
        <Field label="Code" hint="4–20 letters and numbers. Leave empty to make one up." error={err.code?.[0] ?? (save.error && Object.keys(err).length === 0 ? undefined : undefined)}>{(a) => <Input {...a} className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) })} placeholder="RIYADIWALI" />}</Field>
        <Field label={`Customer's discount: ${f.discount}% off`} hint={`Up to ${max}% — from your commission's point of view, a bigger discount converts better.`} error={err.discountBps?.[0]}>{(a) => <input {...a} type="range" min={0} max={max} step={1} value={f.discount} onChange={(e) => setF({ ...f, discount: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="On how many payments" error={err.discountPayments?.[0]}>{(a) => <Select {...a} value={f.payments} onChange={(e) => setF({ ...f, payments: Number(e.target.value) })}>{Array.from({ length: Math.max(d.terms.discountPayments, 3) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "First payment" : `First ${n}`}</option>)}</Select>}</Field>
          <Field label="Most uses">{(a) => <Input {...a} inputMode="numeric" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/\D/g, "") })} placeholder="No limit" />}</Field>
          <Field label="Ends">{(a) => <Input {...a} type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Leads ─────────────────────────────────────────────────────────────────

const LEAD_TONE: Record<Lead["status"], "neutral" | "accent" | "warning" | "success" | "danger"> = { registered: "neutral", contacted: "accent", demo: "warning", signed_up: "accent", won: "success", lost: "danger" };

/** `sample` shows given leads instead of loading them (the public page's example). */
export function Leads({ d, sample }: { d: Dashboard; sample?: Lead[] }) {
  const loaded = useQuery({ queryKey: ["partner", "leads"], queryFn: () => api<{ leads: Lead[] }>("/api/v1/partner/leads"), enabled: !sample });
  const q = sample ? { data: { leads: sample } } : loaded;
  const [adding, setAdding] = useState(false);
  const refresh = useRefresh();
  const toast = useToast();
  const set = useMutation({ mutationFn: (x: { id: string; status: string }) => api(`/api/v1/partner/leads/${x.id}`, { method: "PATCH", body: { status: x.status } }), onSuccess: refresh, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const leads = q.data?.leads ?? [];
  const open = leads.filter((l) => ["registered", "contacted", "demo"].includes(l.status));
  const pipeline = open.reduce((a, l) => a + l.value, 0);
  const stages: Lead["status"][] = ["registered", "contacted", "demo", "signed_up", "won", "lost"];
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Open leads", String(open.length)], ["Pipeline / month", inr(pipeline)], ["Signed up", String(leads.filter((l) => l.status === "signed_up").length)], ["Won", String(leads.filter((l) => l.status === "won").length)]].map(([k, v]) => (
          <div key={k} className="rounded-[18px] bg-surface p-4 ring-1 ring-border"><p className="text-[12.5px] text-muted">{k}</p><p className="mt-1 text-[22px] font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Section
        title="Your leads"
        sub={`Register a business before it signs up: for ${d.terms.leadDays} days it's protected as yours, and when someone signs up with that email it becomes your customer — no code needed.`}
        action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Register a lead</Button>}
      >
        {!q.data ? (
          <Skeleton className="h-40" />
        ) : (
          <Table
            head={["Business", "Contact", "Value / month", "Stage", "Protected until", "Notes"]}
            right={[2]}
            rows={leads.map((l) => [
              <span key="c" className="font-medium">{l.company}</span>,
              <span key="p" className="text-muted">{l.contactName ? `${l.contactName} · ` : ""}{l.email}</span>,
              l.value ? inr(l.value) : "—",
              ["signed_up", "won"].includes(l.status) ? (
                <Badge key="s" tone={LEAD_TONE[l.status]}>{LEAD_LABEL[l.status]}</Badge>
              ) : (
                <Select key="s" aria-label={`Stage for ${l.company}`} className="h-8 w-[140px]" value={l.status} onChange={(e) => set.mutate({ id: l.id, status: e.target.value })}>
                  {stages.filter((s) => !["signed_up", "won"].includes(s)).map((s) => <option key={s} value={s}>{LEAD_LABEL[s]}</option>)}
                </Select>
              ),
              new Date(l.expiresAt) > new Date() || l.orgId ? date(l.expiresAt) : <span key="x" className="text-subtle">Expired</span>,
              <span key="n" className="line-clamp-2 max-w-[240px] text-muted">{l.notes || "—"}</span>,
            ])}
            empty={<EmptyState icon={<Target />} title="No leads yet" description="Register the businesses you're talking to, so they're protected as yours while you close them." />}
          />
        )}
      </Section>
      {adding && <NewLead onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewLead({ onClose }: { onClose: () => void }) {
  const refresh = useRefresh();
  const [f, setF] = useState({ company: "", contactName: "", email: "", phone: "", value: "", notes: "" });
  const save = useMutation({ mutationFn: () => api("/api/v1/partner/leads", { method: "POST", body: { ...f, value: Math.round(Number(f.value || 0) * 100) } }), onSuccess: () => (refresh(), onClose()) });
  const err = save.error instanceof ApiClientError ? save.error.fieldErrors() : {};
  return (
    <Dialog open onClose={onClose} title="Register a lead" description="Use the email the business will sign up with." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Register</Button></>}>
      <div className="grid gap-3">
        {save.error && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
        <Field label="Business" error={err.company?.[0]}>{(a) => <Input {...a} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoFocus />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name">{(a) => <Input {...a} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />}</Field>
          <Field label="Their email" error={err.email?.[0]}>{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label="Expected ₹ / month" hint="Your estimate, for your pipeline.">{(a) => <Input {...a} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^\d.]/g, "") })} />}</Field>
        </div>
        <Field label="Notes">{(a) => <Textarea {...a} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} />}</Field>
      </div>
    </Dialog>
  );
}

// ─── Earnings ──────────────────────────────────────────────────────────────

const COMMISSION_TONE = { on_hold: "warning", available: "success", void: "danger" } as const;
const COMMISSION_LABEL = { on_hold: "On hold", available: "Available", void: "Cancelled" } as const;

export function Earnings({ sample }: { sample?: Commission[] } = {}) {
  const loaded = useQuery({ queryKey: ["partner", "commissions"], queryFn: () => api<{ commissions: Commission[] }>("/api/v1/partner/commissions"), enabled: !sample });
  const q = sample ? { data: { commissions: sample } } : loaded;
  const rows = useMemo(() => q.data?.commissions ?? [], [q.data]);
  const csv = useMemo(() => [["Date", "Customer", "Invoice", "Paid (before tax)", "Rate", "Commission", "Status", "Available from", "Note"], ...rows.map((r) => [r.createdAt.slice(0, 10), r.customer, r.invoice ?? "", (r.basis / 100).toFixed(2), `${r.rateBps / 100}%`, (r.amount / 100).toFixed(2), COMMISSION_LABEL[r.status], r.availableAt.slice(0, 10), r.note])].map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n"), [rows]);
  return (
    <Section
      title="Every commission"
      sub="One line for each payment a customer of yours made, and any adjustment by the Cloudesk team. Each is held for a while after the customer pays, then you can withdraw it."
      action={rows.length > 0 && <Button icon={<Download className="size-4" />} onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "cloudesk-commissions.csv"; a.click(); URL.revokeObjectURL(a.href); }}>CSV</Button>}
    >
      {!q.data ? (
        <Skeleton className="h-40" />
      ) : (
        <Table
          head={["Date", "Customer", "Invoice", "They paid", "Rate", "You earn", "Status", "Available from"]}
          right={[3, 4, 5]}
          rows={rows.map((r) => [
            date(r.createdAt),
            r.kind === "adjustment" ? <span key="a">Adjustment<span className="block text-[12px] text-muted">{r.note}</span></span> : r.customer,
            r.invoice ? <span key="i" className="font-mono text-[12px]">{r.invoice}</span> : "—",
            r.kind === "invoice" ? inr(r.basis, { exact: true }) : "—",
            r.kind === "invoice" ? pct(r.rateBps) : "—",
            <b key="e" className={clsx(r.status === "void" && "line-through opacity-60")}>{inr(r.amount, { exact: true })}</b>,
            <Badge key="s" tone={COMMISSION_TONE[r.status]}>{COMMISSION_LABEL[r.status]}</Badge>,
            date(r.availableAt),
          ])}
          empty={<EmptyState icon={<TicketPercent />} title="No commissions yet" description="When a customer you brought pays an invoice, your share shows here." />}
        />
      )}
    </Section>
  );
}

// ─── Payouts ───────────────────────────────────────────────────────────────

export function Payouts({ d, sample }: { d: Dashboard; sample?: Payout[] }) {
  const loaded = useQuery({ queryKey: ["partner", "payouts"], queryFn: () => api<{ payouts: Payout[] }>("/api/v1/partner/payouts"), enabled: !sample });
  const q = sample ? { data: { payouts: sample } } : loaded;
  const [asking, setAsking] = useState(false);
  const refresh = useRefresh();
  const toast = useToast();
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/v1/partner/payouts/${id}/cancel`, { method: "POST" }), onSuccess: refresh, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const t = d.totals;
  const open = (q.data?.payouts ?? []).find((p) => p.status === "requested" || p.status === "approved");
  const canAsk = t.available >= d.terms.minPayout && !open && !!d.partner.payoutMethod;
  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-[24px] bg-surface p-5 ring-1 ring-border sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["Available", inr(Math.max(0, t.available)), "text-success"], ["On hold", inr(t.onHold), ""], ["Being paid", inr(t.pendingPayout), ""], ["Paid out", inr(t.paidOut), ""]].map(([k, v, c]) => (
            <div key={k}><p className="text-[12.5px] text-muted">{k}</p><p className={clsx("mt-0.5 text-[22px] font-semibold tabular-nums", c)}>{v}</p></div>
          ))}
        </div>
        <div className="grid gap-1.5 justify-items-start lg:justify-items-end">
          <Button variant="primary" size="lg" icon={<Wallet className="size-4" />} disabled={!canAsk} onClick={() => setAsking(true)}>Withdraw</Button>
          <p className="text-[12px] text-subtle">{open ? "A payout is already in progress." : !d.partner.payoutMethod ? "Add payout details below first." : t.available < d.terms.minPayout ? `From ${inr(d.terms.minPayout)} available.` : `Held ${d.terms.holdDays} days after each payment.`}</p>
        </div>
      </section>

      <Section title="Payout history" sub="Withdrawals are checked and sent by the Cloudesk team, usually within 7 working days of approval. You'll get an email at each step.">
        {!q.data ? (
          <Skeleton className="h-32" />
        ) : (
          <Table
            head={["Request", "Asked on", "Amount", "Tax withheld", "You receive", "To", "Status", ""]}
            right={[2, 3, 4]}
            rows={q.data.payouts.map((p) => [
              <span key="n" className="font-mono text-[12px]">{p.number}</span>,
              date(p.createdAt),
              inr(p.amount, { exact: true }),
              p.tds ? inr(p.tds, { exact: true }) : "—",
              <b key="net">{inr(p.net, { exact: true })}</b>,
              <span key="m" className="text-muted">{p.method}</span>,
              <span key="s" className="grid justify-items-start gap-0.5"><Badge tone={PAYOUT_TONE[p.status]}>{p.status[0]!.toUpperCase() + p.status.slice(1)}</Badge>{p.reference && <span className="text-[11.5px] text-muted">Ref {p.reference}</span>}{p.adminNote && <span className="text-[11.5px] text-muted">{p.adminNote}</span>}</span>,
              p.status === "requested" ? <Button key="c" size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(p.id)}>Cancel</Button> : null,
            ])}
            empty={<EmptyState icon={<Wallet />} title="No payouts yet" description="When you have earnings past the hold, ask for a payout here." />}
          />
        )}
      </Section>

      <Section title="Payout details" sub="Where we send your money. Stored encrypted; only a hint is shown back. Changing them doesn't affect a payout already requested.">
        <PayoutDetailsForm partner={d.partner} />
      </Section>
      {asking && <Withdraw d={d} onClose={() => setAsking(false)} />}
    </div>
  );
}

function Withdraw({ d, onClose }: { d: Dashboard; onClose: () => void }) {
  const refresh = useRefresh();
  const [amount, setAmount] = useState(String(Math.floor(d.totals.available) / 100));
  const [note, setNote] = useState("");
  const paise = Math.round(Number(amount || 0) * 100);
  const split = payoutSplit(paise, d.terms.tdsBps);
  const save = useMutation({ mutationFn: () => api("/api/v1/partner/payouts", { method: "POST", body: { amount: paise, note } }), onSuccess: () => (refresh(), onClose()) });
  return (
    <Dialog open onClose={onClose} title="Withdraw earnings" description={`To ${d.partner.payoutHint}. We'll review it and email you when it's sent.`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={paise < d.terms.minPayout || paise > d.totals.available} onClick={() => save.mutate()}>Ask for {inr(split.net, { exact: true })}</Button></>}>
      <div className="grid gap-3">
        {save.error && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
        <Field label="Amount (₹)" hint={`Available: ${inr(d.totals.available, { exact: true })} · smallest payout ${inr(d.terms.minPayout)}`}>{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} autoFocus />}</Field>
        <dl className="grid gap-1 rounded-[14px] bg-surface-2 p-3 text-[13px] tabular-nums">
          <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd>{inr(split.amount, { exact: true })}</dd></div>
          {d.terms.tdsBps > 0 && <div className="flex justify-between"><dt className="text-muted">Tax withheld (TDS {pct(d.terms.tdsBps)})</dt><dd>−{inr(split.tds, { exact: true })}</dd></div>}
          <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>You receive</dt><dd>{inr(split.net, { exact: true })}</dd></div>
        </dl>
        <Field label="Note for us" hint="Optional.">{(a) => <Input {...a} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
      </div>
    </Dialog>
  );
}

export function PayoutDetailsForm({ partner }: { partner: PartnerProfile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(!partner.payoutMethod);
  const [method, setMethod] = useState<"upi" | "bank" | "wire">(partner.payoutMethod ?? (partner.country === "IN" ? "upi" : "wire"));
  const [f, setF] = useState<Record<string, string>>({ country: partner.country });
  const save = useMutation({
    mutationFn: () => api("/api/v1/partner/payout-details", { method: "PUT", body: { method, ...f } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MINE_KEY });
      setEditing(false);
      setF({ country: partner.country });
      toast({ tone: "success", title: "Payout details saved" });
    },
  });
  const err = save.error instanceof ApiClientError ? save.error.fieldErrors() : {};
  if (!editing)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-surface-2 px-4 py-3">
        <div className="text-[13px]"><p className="font-medium">{partner.payoutHint}</p><p className="text-muted">{partner.payoutMethod === "upi" ? "UPI" : partner.payoutMethod === "bank" ? "Bank transfer (India)" : "International wire"}</p></div>
        <Button size="sm" onClick={() => setEditing(true)}>Change</Button>
      </div>
    );
  const input = (id: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} hint={hint} error={err[id]?.[0]}>{(a) => <Input {...a} {...props} value={f[id] ?? ""} onChange={(e) => setF({ ...f, [id]: e.target.value })} />}</Field>
  );
  return (
    <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
      <Segmented label="Payout method" value={method} onChange={(v) => setMethod(v)} options={[{ value: "upi", label: "UPI" }, { value: "bank", label: "Bank (India)" }, { value: "wire", label: "International" }]} />
      {save.error && !Object.keys(err).length && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {input("holder", "Account holder's name", { autoComplete: "name" })}
        {method === "upi" && input("upiId", "UPI ID", { placeholder: "name@okhdfc", autoComplete: "off" })}
        {method === "bank" && (
          <>
            {input("account", "Account number", { inputMode: "numeric", autoComplete: "off" })}
            {input("ifsc", "IFSC", { placeholder: "HDFC0001234", className: "uppercase" })}
            {input("bank", "Bank name")}
          </>
        )}
        {method === "wire" && (
          <>
            {input("account", "Account number / IBAN", { autoComplete: "off" })}
            {input("swift", "SWIFT / BIC", { className: "uppercase" })}
            {input("bank", "Bank name")}
            {input("country", "Bank's country (2 letters)", { maxLength: 2, className: "uppercase" })}
          </>
        )}
        {method !== "wire" && input("pan", "PAN", { className: "uppercase", maxLength: 10 }, "Optional — needed if tax is withheld at source.")}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>Save details</Button>
        {partner.payoutMethod && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </form>
  );
}

// ─── Profile and playbook ──────────────────────────────────────────────────

export function Profile({ d }: { d: Dashboard }) {
  const p = d.partner;
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: p.name, phone: p.phone, city: p.city, website: p.website });
  const save = useMutation({ mutationFn: () => api("/api/v1/partner/profile", { method: "PUT", body: f }), onSuccess: () => (void qc.invalidateQueries({ queryKey: MINE_KEY }), toast({ tone: "success", title: "Profile saved" })) });
  const err = save.error instanceof ApiClientError ? save.error.fieldErrors() : {};
  const info = TYPE_INFO[p.type];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <Section title="Your profile" sub={`${info.name} · partner since ${date(p.approvedAt)} · ${p.email}`}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
          <Field label={info.company ? "Organisation" : "Name shown to customers"} error={err.name?.[0]}>{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Phone" error={err.phone?.[0]}>{(a) => <Input {...a} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label="City" error={err.city?.[0]}>{(a) => <Input {...a} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
          <Field label="Website" error={err.website?.[0]}>{(a) => <Input {...a} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" />}</Field>
          <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={save.isPending}>Save</Button></div>
        </form>
        {Object.keys(p.profile).length > 0 && (
          <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-2">
            {info.fields.filter((x) => p.profile[x.id]).map((x) => <div key={x.id}><dt className="text-muted">{x.label}</dt><dd className="break-words">{p.profile[x.id]}</dd></div>)}
          </dl>
        )}
      </Section>
      <Section title="Your terms">
        <ul className="grid gap-2 text-[13px]">
          <li className="flex justify-between gap-3"><span className="text-muted">Commission</span><b>{pct(d.terms.commissionBps)}{d.rate.bonus ? ` + ${pct(d.rate.bonus)} ${d.rate.tier}` : ""}</b></li>
          <li className="flex justify-between gap-3"><span className="text-muted">For each customer</span><b>{months(d.terms.commissionMonths)}</b></li>
          <li className="flex justify-between gap-3"><span className="text-muted">Customer discount</span><b>{discountText(d.terms.discountBps, d.terms.discountPayments) || "None"}</b></li>
          <li className="flex justify-between gap-3"><span className="text-muted">Hold after payment</span><b>{d.terms.holdDays} days</b></li>
          <li className="flex justify-between gap-3"><span className="text-muted">Smallest payout</span><b>{inr(d.terms.minPayout)}</b></li>
          {d.terms.tdsBps > 0 && <li className="flex justify-between gap-3"><span className="text-muted">Tax withheld</span><b>{pct(d.terms.tdsBps)}</b></li>}
          <li className="flex justify-between gap-3"><span className="text-muted">Link remembered for</span><b>{d.terms.cookieDays} days</b></li>
        </ul>
        <a href="/partner-terms" target="_blank" className="mt-4 inline-block text-[13px] font-medium underline underline-offset-2">Read the partner terms</a>
      </Section>
    </div>
  );
}

const MESSAGES: Record<string, (code: string, link: string) => string[]> = {
  default: (code, link) => [
    `I've been setting businesses up on Cloudesk — website, billing with GST, CRM, inventory and more in one place. Start free for 30 days: ${link}`,
    `If you're juggling separate tools for invoices, stock and customers, try Cloudesk. Use my code ${code} for a discount when you choose a plan: ${link}`,
  ],
  influencer: (code, link) => [
    `Run a small business? I use Cloudesk for invoices, a store and customer follow-ups in one app. Use code ${code} for a discount 👉 ${link} #ad`,
    `My honest take on Cloudesk for small businesses — 30 days free, then code ${code} saves you more. Link in bio. (Paid partnership)`,
  ],
};

export function Playbook({ d }: { d: Dashboard }) {
  const info = TYPE_INFO[d.partner.type];
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = `${origin}/go/${d.partner.code}`;
  const msgs = (MESSAGES[d.partner.type] ?? MESSAGES.default!)(d.partner.code, link);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Your scope of work" sub={info.who}>
        <ul className="grid gap-2 text-[13.5px]">{info.scope.map((s) => <li key={s} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />{s}</li>)}</ul>
      </Section>
      <Section title="Ready-to-use messages" sub="Copy, adapt to your voice, and share.">
        <div className="grid gap-2.5">{msgs.map((m) => <CopyRow key={m} label="Message" value={m} mono={false} />)}</div>
      </Section>
      <Section title="What converts best">
        <ul className="grid gap-2 text-[13.5px] text-muted">
          <li><b className="text-fg">Show, don&apos;t tell.</b> A two-minute screen recording of an invoice with GST, or a store going live, beats any description.</li>
          <li><b className="text-fg">Lead with the trial.</b> Everyone gets 30 days of every feature free — nobody has to pay to try.</li>
          <li><b className="text-fg">Pick an industry.</b> Restaurants, clinics, retail and manufacturers each have their own features; speak to one at a time.</li>
          <li><b className="text-fg">Follow up near the trial&apos;s end.</b> Most decisions happen in the last week — your customers table shows who&apos;s on trial.</li>
        </ul>
      </Section>
      <Section title="Rules that keep it fair">
        <ul className="grid gap-2 text-[13.5px] text-muted">
          <li>Don&apos;t bid on “Cloudesk” in search ads, or pretend to be Cloudesk.</li>
          <li>Mark paid posts as ads or partnerships (in India, ASCI&apos;s influencer guidelines).</li>
          <li>No spam, no fake reviews, no promises Cloudesk doesn&apos;t make.</li>
          <li>Your own workspaces don&apos;t earn commission.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/icon.svg" download="cloudesk-logo.svg" className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-border hover:bg-surface-2"><Download className="size-4" /> Logo (SVG)</a>
          <a href="/partner-terms" target="_blank" className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium ring-1 ring-border hover:bg-surface-2">Partner terms</a>
        </div>
      </Section>
    </div>
  );
}
