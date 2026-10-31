"use client";

// The partner's business with Cloudesk at a glance: what they can withdraw,
// what they earned this month, the customers paying, the last 12 months, the
// path from a click to a paying customer, and how far the next tier is.
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Check, Copy, Crown, MousePointerClick, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { months, pct, TYPE_INFO } from "@/lib/partners/program";
import { inr, monthLabel, type Dashboard } from "./types";

export function copyText(text: string, toast: ReturnType<typeof useToast>, what = "Copied") {
  void navigator.clipboard?.writeText(text).then(
    () => toast({ tone: "success", title: what }),
    () => toast({ tone: "error", title: "Couldn't copy — select and copy it instead" }),
  );
}

export function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-surface-2 py-1 pr-1 pl-3">
        <span className={clsx("min-w-0 flex-1 truncate text-[13px]", mono && "font-mono")}>{value}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Copy ${label}`}
          icon={done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={() => {
            copyText(value, toast);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** `origin` and `hello` fix the link and greeting (the public page's example renders the same on the server and in the browser). */
export function Overview({ d, person, go, origin: fixedOrigin, hello }: { d: Dashboard; person: string; go: (tab: string) => void; origin?: string; hello?: string }) {
  const t = d.totals;
  const origin = fixedOrigin ?? (typeof window === "undefined" ? "" : window.location.origin);
  const link = `${origin}/go/${d.partner.code}`;
  const change = t.lastMonth ? Math.round(((t.thisMonth - t.lastMonth) / t.lastMonth) * 100) : null;
  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[24px] bg-surface p-5 ring-1 ring-border sm:p-6">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-end">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-muted uppercase">{TYPE_INFO[d.partner.type].name} · {d.partner.name}</p>
            <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight">{hello ?? greeting()}, {person.split(" ")[0]}</h1>
            <p className="mt-1 text-[14px] text-muted">
              You earn <b className="text-fg">{pct(d.rate.rate)}</b> of what each customer pays, {months(d.terms.commissionMonths)}
              {d.rate.bonus > 0 && <> — including your {d.rate.tier} bonus of {pct(d.rate.bonus)}</>}.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning"><Crown className="size-3.5" /> {d.rate.tier} tier</div>
          </div>
          <div className="grid gap-2.5">
            <CopyRow label="Your link" value={link} />
            <CopyRow label="Your code" value={d.partner.code} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Wallet />} label="Available to withdraw" value={inr(Math.max(0, t.available))} sub={t.onHold > 0 ? `${inr(t.onHold)} on hold` : "Nothing on hold"} action={<Button size="sm" variant="primary" onClick={() => go("payouts")} disabled={t.available < d.terms.minPayout}>Withdraw</Button>} />
        <Tile icon={<TrendingUp />} label="Earned this month" value={inr(t.thisMonth)} sub={change === null ? (t.lastMonth === 0 && t.thisMonth > 0 ? "Your first earnings this month" : "Last month: ₹0") : <span className={clsx("inline-flex items-center gap-0.5", change >= 0 ? "text-success" : "text-danger")}>{change >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(change)}% vs last month</span>} />
        <Tile icon={<Users />} label="Paying customers" value={String(t.paying)} sub={`${t.trials} on trial · ${t.signups} signed up`} />
        <Tile icon={<TrendingUp />} label="Monthly earnings now" value={inr(t.earningMrr)} sub={`From ${inr(t.mrr)} a month your customers pay`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Your earnings, last 12 months</h2>
            <p className="text-[12.5px] text-muted">Lifetime {inr(t.earned)} · paid out {inr(t.paidOut)}</p>
          </div>
          <EarningsChart series={d.series} />
        </section>
        <div className="grid gap-5">
          <Funnel t={t} />
          <TierCard d={d} />
        </div>
      </div>

      <section className="grid gap-3 rounded-[20px] bg-surface p-5 ring-1 ring-border sm:grid-cols-3">
        <Figure label="Revenue you've brought" value={inr(t.revenue)} hint="What your customers paid Cloudesk, before tax" />
        <Figure label="Lifetime earnings" value={inr(t.earned)} hint={t.tdsWithheld ? `${inr(t.tdsWithheld)} tax withheld so far` : "Before any tax withheld at payout"} />
        <Figure label="In payouts" value={inr(t.pendingPayout)} hint={t.pendingPayout ? "Requested — being processed" : "No payout in progress"} />
      </section>
    </div>
  );
}

function Tile({ icon, label, value, sub, action }: { icon: React.ReactNode; label: string; value: string; sub: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[18px] bg-surface p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-8 place-items-center rounded-[10px] bg-surface-2 text-muted [&>svg]:size-4">{icon}</span>
        {action}
      </div>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="truncate text-[22px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-[12px] text-subtle">{sub}</p>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{value}</p>
      <p className="text-[12px] text-subtle">{hint}</p>
    </div>
  );
}

/** One series (what you earned per month); hovering a bar shows that month's numbers. */
function EarningsChart({ series }: { series: Dashboard["series"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.earned));
  const W = 600, H = 200, padB = 22, padT = 10;
  const bw = W / series.length;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const empty = series.every((s) => s.earned === 0);
  const h = hover !== null ? series[hover]! : null;
  return (
    <div className="relative mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" role="img" aria-label="Earnings per month for the last 12 months">
        {ticks.map((v) => {
          const y = padT + (H - padB - padT) * (1 - v / max);
          return <line key={v} x1={0} x2={W} y1={y} y2={y} stroke="var(--border)" strokeDasharray={v === 0 ? undefined : "3 4"} />;
        })}
        {series.map((s, i) => {
          const bh = ((H - padB - padT) * s.earned) / max;
          const x = i * bw + bw * 0.22;
          const w = bw * 0.56;
          return (
            <g key={s.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {s.earned > 0 && <rect x={x} y={H - padB - bh} width={w} height={bh} rx={4} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.45} />}
              <text x={i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--subtle, #8b8b92)">{monthLabel(s.month)}</text>
            </g>
          );
        })}
      </svg>
      {empty && <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-[13px] text-muted">Your earnings will show here once your first customer pays.</p>}
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-[12px] bg-surface-solid px-3 py-2 text-[12px] shadow-lg ring-1 ring-border" style={{ left: `clamp(0px, calc(${((hover! + 0.5) / series.length) * 100}% - 70px), calc(100% - 150px))` }}>
          <p className="font-medium">{new Date(`${h.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <p className="tabular-nums">You earned <b>{inr(h.earned)}</b></p>
          <p className="text-muted tabular-nums">Customers paid {inr(h.revenue)}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>Earnings per month</caption>
        <tbody>{series.map((s) => <tr key={s.month}><th>{s.month}</th><td>{inr(s.earned)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Funnel({ t }: { t: Dashboard["totals"] }) {
  const steps = [
    { icon: <MousePointerClick />, label: "Link visits", n: t.clicks },
    { icon: <UserPlus />, label: "Signed up", n: t.signups },
    { icon: <Users />, label: "Paying", n: t.paying },
  ];
  const top = Math.max(1, ...steps.map((s) => s.n));
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
      <h2 className="text-[15px] font-semibold">From a click to a customer</h2>
      <ul className="mt-3 grid gap-2.5">
        {steps.map((s) => (
          <li key={s.label} className="grid gap-1">
            <div className="flex items-center justify-between text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-muted [&>svg]:size-3.5">{s.icon}{s.label}</span>
              <span className="font-medium tabular-nums">{s.n.toLocaleString("en-IN")}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (s.n / top) * 100)}%` }} /></div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-subtle">Visits → sign-ups {rate(t.signups, t.clicks)} · sign-ups → paying {rate(t.paying, t.signups)} · {t.clicks30.toLocaleString("en-IN")} visits in the last 30 days. Sign-ups from codes and leads count without a visit.</p>
    </section>
  );
}

function TierCard({ d }: { d: Dashboard }) {
  const tiers = [...d.rate.tiers].sort((a, b) => a.minActive - b.minActive);
  const next = tiers.find((x) => x.name === d.rate.next);
  const cur = tiers.find((x) => x.name === d.rate.tier) ?? tiers[0]!;
  const share = next ? Math.min(1, (d.totals.paying - cur.minActive) / Math.max(1, next.minActive - cur.minActive)) : 1;
  return (
    <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
      <h2 className="text-[15px] font-semibold">Tier</h2>
      {next ? (
        <p className="mt-1 text-[13px] text-muted"><b className="text-fg">{d.rate.toNext}</b> more paying customer{d.rate.toNext === 1 ? "" : "s"} to <b className="text-fg">{next.name}</b> — {pct(d.rate.base + next.bonusBps)} on every customer.</p>
      ) : (
        <p className="mt-1 text-[13px] text-muted">You&apos;re at the top tier. Thank you!</p>
      )}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-warning" style={{ width: `${Math.max(3, share * 100)}%` }} /></div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {tiers.map((x) => (
          <li key={x.name} className={clsx("rounded-full px-2.5 py-1 text-[11.5px]", x.name === d.rate.tier ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
            {x.name} · {x.minActive}+ · {x.bonusBps ? `+${pct(x.bonusBps)}` : "base"}
          </li>
        ))}
      </ul>
    </section>
  );
}
