"use client";

// Platform analytics: growth, activity, plans and revenue, the funnel, module
// adoption and the busiest workspaces — all counted live from the database.
import { Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { DailyChart, num, Section, Stat, useAdmin } from "./common";

type Pt = { day: string; n: number };
export type Overview = {
  totals: Record<string, number>;
  series: { signups: Pt[]; workspaces: Pt[]; activeWorkspaces: Pt[]; logins: Pt[]; loginFailures: Pt[] };
  plans: { inForce: Record<string, number>; paying: Record<string, number>; subscriptionStatus: Record<string, number>; trials: number; trialsEnding: number; comp: number; billingConfigured: boolean; mrr: { currency: string; amount: number }[] | null };
  funnel: { step: string; n: number }[];
  modules: { id: string; name: string; workspaces: number }[];
  industries: { industry: string; count: number }[];
  storeRevenue30: { currency: string; orders: number; gross: number }[];
  topWorkspaces: { id: string; name: string; slug: string; events: number }[];
};

const money = (minor: number, cur: string) => `${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${cur.toUpperCase()}`;

function Bars({ rows, total }: { rows: { label: string; n: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="grid gap-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[12.5px]">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="min-w-[5.5rem] whitespace-nowrap text-right tabular-nums">{num(r.n)}{total ? <span className="text-subtle"> · {Math.round((r.n / total) * 100)}%</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPanel() {
  const q = useAdmin<Overview>("overview", { refetchInterval: 60_000 });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { totals: t, series, plans, funnel } = q.data;
  const top = funnel[0]?.n || 1;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Workspaces" value={num(t.orgs)} sub={`+${num(t.orgs30)} in 30 days · ${t.suspended} suspended`} />
        <Stat label="People" value={num(t.users)} sub={`+${num(t.users7)} this week · +${num(t.users30)} in 30 days`} />
        <Stat label="Active workspaces" value={num(t.active7)} sub={`today ${t.active1} · 30 days ${t.active30}`} />
        <Stat label="Active people" value={num(t.dau)} sub={`today · ${num(t.mau)} in 30 days`} />
        <Stat label="Monthly recurring revenue" value={plans.mrr ? (plans.mrr.length ? plans.mrr.map((m) => money(m.amount, m.currency)).join(" + ") : "0") : "—"} sub={plans.billingConfigured ? `${Object.values(plans.paying).reduce((a, b) => a + b, 0)} paying workspaces` : "Billing isn't connected"} />
        <Stat label="Trials" value={num(plans.trials)} sub={`${plans.trialsEnding} end within 7 days · ${plans.comp} complimentary`} tone={plans.trialsEnding ? "warning" : undefined} />
        <Stat label="Web apps" value={num(t.projects)} sub={`${num(t.live)} live · ${num(t.domains)} custom domains`} />
        <Stat label="Deployments (30 days)" value={num(t.deploys30)} sub={`${t.deploysFailed30} failed`} tone={t.deploysFailed30 ? "warning" : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">Sign-ups</h3>
          <p className="mb-2 text-[12px] text-muted">New people per day, last 30 days</p>
          <DailyChart series={[{ label: "Sign-ups", points: series.signups }]} />
        </Card>
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">Active workspaces</h3>
          <p className="mb-2 text-[12px] text-muted">Workspaces with any activity, per day</p>
          <DailyChart kind="line" series={[{ label: "Active", points: series.activeWorkspaces }]} />
        </Card>
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">New workspaces</h3>
          <p className="mb-2 text-[12px] text-muted">Per day, last 30 days</p>
          <DailyChart series={[{ label: "Workspaces", points: series.workspaces }]} />
        </Card>
        <Card className="min-w-0 p-4">
          <h3 className="text-[14px] font-semibold">Sign-ins</h3>
          <p className="mb-2 text-[12px] text-muted">Successful and failed, last 14 days</p>
          <DailyChart series={[{ label: "Signed in", points: series.logins }, { label: "Failed", points: series.loginFailures }]} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Funnel" sub="From sign-up to paying">
          <Card className="p-4"><Bars rows={funnel.map((f) => ({ label: f.step, n: f.n }))} total={top} /></Card>
        </Section>
        <Section title="Plans in force" sub="Paid, trial or complimentary — whichever is higher">
          <Card className="space-y-3 p-4">
            <Bars rows={Object.entries(plans.inForce).map(([k, n]) => ({ label: k, n }))} total={t.orgs} />
            {Object.keys(plans.subscriptionStatus).length > 0 && <p className="text-[12px] text-muted">Subscriptions: {Object.entries(plans.subscriptionStatus).map(([k, n]) => `${k} ${n}`).join(" · ")}</p>}
          </Card>
        </Section>
        <Section title="Module adoption" sub="Workspaces with each module switched on">
          <Card className="max-h-[22rem] overflow-y-auto p-4"><Bars rows={q.data.modules.map((m) => ({ label: m.name, n: m.workspaces }))} total={t.orgs} /></Card>
        </Section>
        <Section title="Industries" sub="Chosen during onboarding">
          <Card className="max-h-[22rem] overflow-y-auto p-4"><Bars rows={q.data.industries.map((i) => ({ label: i.industry, n: i.count }))} total={t.orgs} /></Card>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Store sales (30 days)" sub="Paid orders across all workspaces, net of refunds">
          <Card className="p-4 text-[13px]">
            {q.data.storeRevenue30.length ? q.data.storeRevenue30.map((r) => <p key={r.currency} className="flex justify-between"><span>{num(r.orders)} orders</span><b className="tabular-nums">{money(r.gross, r.currency)}</b></p>) : <p className="text-muted">No paid orders yet.</p>}
            <p className="mt-2 text-[12px] text-muted">{num(t.orders30)} orders placed in total.</p>
          </Card>
        </Section>
        <Section title="Usage (30 days)">
          <Card className="space-y-1 p-4 text-[13px]">
            <p className="flex justify-between"><span>AI tasks</span><b className="tabular-nums">{num(t.ai30)}</b></p>
            <p className="flex justify-between"><span>AI cost</span><b className="tabular-nums">${(t.aiCost30 / 1e6).toFixed(2)}</b></p>
            <p className="flex justify-between"><span>Emails sent</span><b className="tabular-nums">{num(t.emails30)}</b></p>
            <p className="flex justify-between"><span>Emails failed</span><b className={`tabular-nums ${t.emailsFailed30 ? "text-danger" : ""}`}>{num(t.emailsFailed30)}</b></p>
          </Card>
        </Section>
        <Section title="Busiest workspaces" sub="Actions in the last 30 days">
          <Card className="p-4 text-[13px]">
            {q.data.topWorkspaces.length ? (
              <ol className="space-y-1">{q.data.topWorkspaces.map((w) => <li key={w.id} className="flex justify-between gap-2"><span className="truncate">{w.name}</span><span className="tabular-nums text-muted">{num(w.events)}</span></li>)}</ol>
            ) : <p className="text-muted">No activity yet.</p>}
          </Card>
        </Section>
      </div>
    </div>
  );
}
