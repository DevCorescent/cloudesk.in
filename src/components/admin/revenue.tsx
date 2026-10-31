"use client";

// Revenue across the platform: what clients take through it (store, POS,
// invoices, restaurant bills, bookings, fees, clinic and construction
// receipts) per currency, month by month, and by client — plus the platform's
// own subscription revenue, shown only when billing is connected.
import { useState } from "react";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { ChartView, type Result } from "@/components/bi/chart";
import { errorMessage } from "@/lib/client/api";
import type { RevenueOverview } from "@/server/platform/clients";
import { ClientDetail } from "./client";
import { num, Section, Stat, useAdmin } from "./common";

export const SOURCE_LABEL: Record<string, string> = {
  store: "Online store",
  pos: "Point of sale",
  invoices: "Invoice payments",
  restaurant: "Restaurant & hotel bills",
  bookings: "Paid bookings",
  education: "School fees",
  clinic: "Clinic bills",
  construction: "Construction receipts",
};

/** Minor units in a currency, e.g. 1234500 INR → ₹12,345. */
export function money(minor: number, currency: string, compact = false) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: compact || Math.abs(minor) >= 1e7 ? 0 : 2, notation: compact ? "compact" : "standard" }).format(minor / 100);
  } catch {
    return `${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

const growth = (g: number | null) => (g === null ? "no earlier period" : `${g > 0 ? "+" : ""}${g}% vs previous 30 days`);

/** Twelve months of one currency as a report chart (amounts in major units). */
export function MonthlyChart({ points, currency }: { points: { month: string; amount: number }[]; currency: string }) {
  const r: Result = {
    dims: 1,
    columns: [{ key: "month", label: "Month", type: "date", bucket: "month" }, { key: "amount", label: `Revenue (${currency})`, type: "number" }],
    rows: points.map((p) => [`${p.month}-01`, Math.round(p.amount) / 100]),
    totals: [null, points.reduce((a, p) => a + p.amount, 0) / 100],
    range: { from: points[0] ? `${points[0].month}-01` : null, to: points.length ? `${points[points.length - 1]!.month}-01` : null },
    truncated: false,
  };
  return <ChartView r={r} kind="bar" compact />;
}

export function RevenuePanel() {
  const q = useAdmin<RevenueOverview>("revenue", { refetchInterval: 120_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { gmv, platform } = q.data;
  return (
    <div className="space-y-8">
      <Section title="Revenue clients take through the platform" sub="Paid payments recorded in their workspaces, net of refunds. Each currency is shown on its own.">
        {gmv.byCurrency.length === 0 ? (
          <Card className="p-6 text-center text-[13px] text-muted">No paid orders, invoice payments or bills recorded yet.</Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {gmv.byCurrency.map((c) => (
              <div key={c.currency} className="contents">
                <Stat label={`Last 30 days · ${c.currency}`} value={money(c.last30, c.currency, true)} sub={growth(c.growthPct)} tone={c.growthPct !== null && c.growthPct < 0 ? "warning" : c.growthPct ? "success" : undefined} />
                <Stat label={`All time · ${c.currency}`} value={money(c.allTime, c.currency, true)} sub={`${c.bySource.length} source${c.bySource.length === 1 ? "" : "s"}`} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {gmv.byCurrency.slice(0, 3).map((c) => (
        <div key={c.currency} className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="min-w-0 p-4">
            <h3 className="text-[14px] font-semibold">Monthly revenue · {c.currency}</h3>
            <p className="mb-2 text-[12px] text-muted">Last 12 months, every source</p>
            <MonthlyChart currency={c.currency} points={gmv.monthly.filter((m) => m.currency === c.currency)} />
          </Card>
          <Card className="min-w-0 p-4">
            <h3 className="mb-3 text-[14px] font-semibold">By source · {c.currency}</h3>
            <ul className="space-y-2.5 text-[13px]">
              {c.bySource.map((s) => {
                const pct = c.allTime ? Math.round((s.allTime / c.allTime) * 100) : 0;
                return (
                  <li key={s.source}>
                    <div className="flex justify-between gap-2"><span className="truncate">{SOURCE_LABEL[s.source] ?? s.source}</span><b className="tabular-nums">{money(s.allTime, c.currency, true)}</b></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${pct}%` }} /></div>
                    <p className="mt-0.5 text-[11.5px] text-muted">{pct}% of all time · {money(s.last30, c.currency, true)} in 30 days</p>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ))}
      {gmv.byCurrency.length > 3 && <p className="text-[12px] text-muted">Charts show the three largest currencies; the rest are in the totals above.</p>}

      <Section title="Top clients" sub="By revenue in the last 30 days — open one for its full profile">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="border-b border-border text-xs text-subtle"><tr><th className="px-4 py-2.5 font-medium">#</th><th className="px-4 py-2.5 font-medium">Workspace</th><th className="px-4 py-2.5 text-right font-medium">Last 30 days</th></tr></thead>
            <tbody className="divide-y divide-border">
              {gmv.topClients.map((t, i) => (
                <tr key={`${t.orgId}-${t.currency}`} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(t.orgId)}>
                  <td className="px-4 py-2.5 text-muted tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5"><b className="font-medium">{t.name}</b><span className="block text-[12px] text-muted">{t.slug}</span></td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(t.last30, t.currency)}</td>
                </tr>
              ))}
              {!gmv.topClients.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted">No revenue in the last 30 days.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Platform subscription revenue" sub="What clients pay for their plans">
        <Card className="space-y-4 p-4 text-[13px]">
          {platform.billingConfigured ? (
            <p className="text-[22px] font-semibold tabular-nums">{platform.mrr && platform.mrr.length ? platform.mrr.map((m) => money(m.amount, m.currency)).join(" + ") : "0"}<span className="ml-2 text-[13px] font-normal text-muted">monthly recurring revenue</span></p>
          ) : (
            <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-warning"><b className="font-medium">Billing isn&apos;t connected.</b> <span className="text-fg">Connect Stripe or Razorpay in Integrations; MRR is then worked out from the provider&apos;s real prices.</span></p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {platform.perPlan.map((p) => (
              <div key={p.plan} className="flex items-center justify-between rounded-[12px] bg-surface-2 px-3 py-2">
                <span className="capitalize">{p.plan} <span className="text-muted">· {num(p.paying)} paying</span></span>
                <b className="tabular-nums">{p.mrr !== null && p.currency ? `${money(p.mrr, p.currency)}/mo` : "—"}</b>
              </div>
            ))}
          </div>
          <p className="flex flex-wrap gap-1.5">
            <Badge tone="success">{platform.counts.paying} paying</Badge>
            <Badge tone="accent">{platform.counts.trialing} trialing</Badge>
            <Badge>{platform.counts.comp} complimentary</Badge>
            <Badge tone={platform.counts.pastDue ? "danger" : "neutral"}>{platform.counts.pastDue} past due</Badge>
            <Badge>{platform.counts.canceled} canceled</Badge>
          </p>
        </Card>
      </Section>
      {open && <ClientDetail orgId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
